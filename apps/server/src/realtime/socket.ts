import {
  authenticateDevice,
  authenticateToken,
  getDeviceDisplay,
  getEventState,
  getShowStateWithContext,
  readSharedBoard,
  recordDevicePresence,
  type Actor,
  type PlatformDeps,
} from '@klockr/application';
import {
  REALTIME_PATH,
  realtimeAuthSchema,
  realtimeEvents,
  type ClientToServerEvents,
  type ServerToClientEvents,
} from '@klockr/contracts';
import { LAST_SEEN_WRITE_INTERVAL_MS, ShowId, type BoardId, type Device } from '@klockr/domain';
import { parseCookie } from 'cookie';
import type { Server as HttpServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import { eventOwnerFromCookies, managementFromCookies } from '../http/auth';
import { FixedWindowLimiter } from '../infra/rate-limiter';
import { boardRoom, deviceRoom, eventRoom, grantRoom, operatorRoom, type RealtimeHub } from './hub';

type Subscription =
  | { readonly role: 'operator'; readonly showId: ShowId; readonly actor: Actor }
  | {
      readonly role: 'board';
      readonly boardId: BoardId;
      readonly grantId: string;
      readonly actor: Actor;
    }
  | { readonly role: 'event'; readonly eventId: string; readonly actor: Actor }
  | { readonly role: 'device'; readonly device: Device };

interface SocketData {
  subscription: Subscription;
}

type KlockrServer = Server<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  SocketData
>;
type KlockrSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  SocketData
>;

/**
 * Socket.IO is a read channel: Operators (Show or Event owner cookie), Event managers (Event
 * cookie), Boards (board token) and paired Devices (device credential) subscribe to their rooms.
 * Every connect and reconnect sends a fresh authoritative snapshot; afterwards only transition
 * snapshots and projections arrive. Mutations go through HTTP commands.
 */
export interface RealtimeLogger {
  info(obj: object, msg: string): void;
  warn(obj: object, msg: string): void;
}

const silentLogger: RealtimeLogger = { info: () => undefined, warn: () => undefined };

export function attachRealtime(
  httpServer: HttpServer,
  services: PlatformDeps,
  hub: RealtimeHub,
  logger: RealtimeLogger = silentLogger,
): KlockrServer {
  const io: KlockrServer = new Server(httpServer, {
    path: REALTIME_PATH,
    serveClient: false,
    // Same-origin only (behind the reverse proxy / Next rewrites); no cross-origin access.
    cors: { origin: false },
    pingInterval: 5_000,
    pingTimeout: 4_000,
  });
  const limiter = new FixedWindowLimiter(60, 60_000, () => services.clock.now());

  io.use((socket: KlockrSocket, next) => {
    void (async () => {
      if (!limiter.allow(socket.handshake.address)) throw new Error('rate_limited');
      const auth = realtimeAuthSchema.safeParse(socket.handshake.auth);
      if (!auth.success) throw new Error('invalid_auth');

      const cookies = () => parseCookie(socket.handshake.headers.cookie ?? '');
      switch (auth.data.role) {
        case 'operator': {
          const principal = await managementFromCookies(cookies(), auth.data.showId, services);
          if (!principal) throw new Error('unauthorized');
          socket.data.subscription = {
            role: 'operator',
            showId: ShowId(auth.data.showId),
            actor: principal.actor,
          };
          break;
        }
        case 'board': {
          const board = await authenticateToken(auth.data.boardShareToken, 'board', services);
          if (!board?.grant.boardId) throw new Error('unauthorized');
          socket.data.subscription = {
            role: 'board',
            boardId: board.grant.boardId,
            grantId: board.grant.id,
            actor: board.actor,
          };
          break;
        }
        case 'event': {
          const principal = await eventOwnerFromCookies(cookies(), auth.data.eventId, services);
          if (!principal) throw new Error('unauthorized');
          socket.data.subscription = {
            role: 'event',
            eventId: auth.data.eventId,
            actor: principal.actor,
          };
          break;
        }
        case 'device': {
          const device = await authenticateDevice(auth.data.deviceToken, services);
          if (!device) throw new Error('unauthorized');
          socket.data.subscription = { role: 'device', device };
          break;
        }
      }
    })().then(
      () => {
        next();
      },
      (error: unknown) => {
        const reason = error instanceof Error ? error.message : 'unauthorized';
        // Never log credentials: only the claimed role and the rejection reason.
        logger.warn(
          { reason, role: (socket.handshake.auth as { role?: unknown }).role },
          'realtime handshake rejected',
        );
        next(error instanceof Error ? error : new Error('unauthorized'));
      },
    );
  });

  io.on('connection', (socket: KlockrSocket) => {
    const sub = socket.data.subscription;
    const label =
      sub.role === 'operator'
        ? { showId: sub.showId }
        : sub.role === 'board'
          ? { boardId: sub.boardId }
          : sub.role === 'event'
            ? { eventId: sub.eventId }
            : { deviceId: sub.device.id };
    logger.info(
      { role: sub.role, ...label, transport: socket.conn.transport.name },
      'realtime client connected',
    );
    let presenceTimer: ReturnType<typeof setInterval> | null = null;
    socket.on('disconnect', (reason) => {
      logger.info({ role: sub.role, ...label, reason }, 'realtime client disconnected');
      if (sub.role === 'device') {
        if (presenceTimer) clearInterval(presenceTimer);
        hub.deviceDisconnected(sub.device.id);
        void (async () => {
          await recordDevicePresence(sub.device, true, services);
          await hub.publish(presenceChanged(sub.device, services.clock.now()));
        })();
      }
    });

    socket.on(realtimeEvents.clock, (ack) => {
      if (typeof ack === 'function') ack({ serverTime: services.clock.now() });
    });

    void (async () => {
      // Join first, then snapshot: a transition between the two is delivered as a newer revision.
      switch (sub.role) {
        case 'operator': {
          await socket.join(operatorRoom(sub.showId));
          const state = await getShowStateWithContext(sub.showId, { actor: sub.actor }, services);
          if (state.ok) socket.emit(realtimeEvents.showSnapshot, state.value);
          else socket.disconnect(true);
          return;
        }
        case 'board': {
          await socket.join([boardRoom(sub.boardId), grantRoom(sub.grantId)]);
          const state = await readSharedBoard(sub.boardId, { actor: sub.actor }, services);
          if (state.ok) socket.emit(realtimeEvents.boardSnapshot, state.value);
          else socket.disconnect(true);
          return;
        }
        case 'event': {
          await socket.join(eventRoom(sub.eventId));
          const state = await getEventState(sub.eventId, { actor: sub.actor }, services);
          if (state.ok) socket.emit(realtimeEvents.event, state.value);
          else socket.disconnect(true);
          return;
        }
        case 'device': {
          const display = await getDeviceDisplay(sub.device, services);
          await socket.join([
            deviceRoom(sub.device.id),
            ...(display.board ? [boardRoom(display.board.board.id)] : []),
          ]);
          socket.emit(realtimeEvents.device, display);
          hub.deviceConnected(sub.device.id);
          await recordDevicePresence(sub.device, true, services);
          await hub.publish(presenceChanged(sub.device, services.clock.now()));
          // Sparse presence history while connected (never per second).
          presenceTimer = setInterval(() => {
            void (async () => {
              const fresh = await services.deviceStore.findDevice(sub.device.id);
              if (fresh) await recordDevicePresence(fresh, false, services);
            })();
          }, LAST_SEEN_WRITE_INTERVAL_MS);
          presenceTimer.unref();
          return;
        }
      }
    })();
  });

  hub.attach(io, services);
  return io;
}

/** Presence changed: managers of the Device's scope get a fresh status (no Device re-routing). */
function presenceChanged(device: Device, now: number) {
  return {
    type: 'devices.changed' as const,
    scope: { showId: device.scope.showId, eventId: device.scope.eventId },
    deviceIds: [],
    revoked: false,
    occurredAt: now,
  };
}
