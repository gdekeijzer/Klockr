import {
  authenticateToken,
  getBoardState,
  getShowState,
  type Actor,
  type ShowServiceDeps,
} from '@klockr/application';
import {
  REALTIME_PATH,
  realtimeAuthSchema,
  realtimeEvents,
  type ClientToServerEvents,
  type ServerToClientEvents,
} from '@klockr/contracts';
import type { BoardId, ShowId } from '@klockr/domain';
import { parseCookie } from 'cookie';
import type { Server as HttpServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import { ownerTokenFromCookies } from '../http/auth';
import { FixedWindowLimiter } from '../infra/rate-limiter';
import { boardRoom, boardsRoom, operatorRoom, type RealtimeHub } from './hub';

type Subscription =
  | { readonly role: 'operator'; readonly showId: ShowId; readonly actor: Actor }
  | {
      readonly role: 'board';
      readonly showId: ShowId;
      readonly boardId: BoardId;
      readonly actor: Actor;
    };

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
 * Socket.IO is a read channel: Operators (owner cookie) and Boards (board token) subscribe to one
 * Show room. Every connect and reconnect sends a fresh authoritative snapshot; afterwards only
 * transition snapshots and Queue/Board projections arrive. Mutations go through HTTP commands.
 */
export interface RealtimeLogger {
  info(obj: object, msg: string): void;
  warn(obj: object, msg: string): void;
}

const silentLogger: RealtimeLogger = { info: () => undefined, warn: () => undefined };

export function attachRealtime(
  httpServer: HttpServer,
  services: ShowServiceDeps,
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

      if (auth.data.role === 'operator') {
        const cookies = parseCookie(socket.handshake.headers.cookie ?? '');
        const token = ownerTokenFromCookies(cookies, auth.data.showId);
        const owner = token ? await authenticateToken(token, 'owner', services) : null;
        if (!owner || owner.grant.showId !== auth.data.showId) throw new Error('unauthorized');
        socket.data.subscription = {
          role: 'operator',
          showId: owner.grant.showId,
          actor: owner.actor,
        };
      } else {
        const board = await authenticateToken(auth.data.boardShareToken, 'board', services);
        if (!board?.grant.boardId) throw new Error('unauthorized');
        socket.data.subscription = {
          role: 'board',
          showId: board.grant.showId,
          boardId: board.grant.boardId,
          actor: board.actor,
        };
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
    logger.info(
      { role: sub.role, showId: sub.showId, transport: socket.conn.transport.name },
      'realtime client connected',
    );
    socket.on('disconnect', (reason) => {
      logger.info({ role: sub.role, showId: sub.showId, reason }, 'realtime client disconnected');
    });

    socket.on(realtimeEvents.clock, (ack) => {
      if (typeof ack === 'function') ack({ serverTime: services.clock.now() });
    });

    void (async () => {
      // Join first, then snapshot: a transition between the two is delivered as a newer revision.
      if (sub.role === 'operator') {
        await socket.join(operatorRoom(sub.showId));
        const state = await getShowState(sub.showId, { actor: sub.actor }, services);
        if (state.ok) socket.emit(realtimeEvents.showSnapshot, state.value);
        else socket.disconnect(true);
      } else {
        await socket.join([boardsRoom(sub.showId), boardRoom(sub.boardId)]);
        const state = await getBoardState(sub.boardId, { actor: sub.actor }, services);
        if (state.ok) socket.emit(realtimeEvents.boardSnapshot, state.value);
        else socket.disconnect(true);
      }
    })();
  });

  hub.attach(io, { showMeta: (showId) => services.shows.getShow(showId) });
  return io;
}
