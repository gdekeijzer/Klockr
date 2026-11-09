import {
  buildEventState,
  deviceList,
  getDeviceDisplay,
  loadEventView,
  showContextOf,
  toBoardSnapshot,
  toEventBoardSnapshot,
  toShowStateSnapshot,
  toTimerSnapshot,
  type ApplicationEvent,
  type DevicePresence,
  type EventPublisher,
  type PlatformDeps,
} from '@klockr/application';
import {
  realtimeEvents,
  type ClientToServerEvents,
  type ServerToClientEvents,
} from '@klockr/contracts';
import { DeviceId, ShowId, type Clock } from '@klockr/domain';
import type { Server } from 'socket.io';

/** Management clients (Operator, Master, Boards admin) of a Show. */
export const operatorRoom = (showId: string): string => `show:${showId}:operators`;
/** All Boards of a Show (kept for compatibility; Boards receive their own scoped projection). */
export const boardsRoom = (showId: string): string => `show:${showId}:boards`;
/** One Board (its own scoped projection): Board share links AND Devices showing it. */
export const boardRoom = (boardId: string): string => `board:${boardId}`;
/** M5: Event management clients (Event Dashboard, Room View, Device management). */
export const eventRoom = (eventId: string): string => `event:${eventId}`;
/** M5: every socket of one paired Device. */
export const deviceRoom = (deviceId: string): string => `device:${deviceId}`;
/** M5: every socket authenticated with one Board share credential (for revocation). */
export const grantRoom = (grantId: string): string => `grant:${grantId}`;

type Io = Server<ClientToServerEvents, ServerToClientEvents>;

/**
 * Bridges committed application events to realtime clients. Never sends ticks:
 * - timer transition -> `timer.state` to the Show's management clients;
 * - Show change -> `show.state` (with its Event/Room context) to management clients, a scoped
 *   `board.snapshot` to each Board of the Show, and a refresh of its Event (dashboard + Event
 *   Boards) when the Show is placed in one;
 * - Event change -> `event.state` and Event Board projections; Shows whose placement changed get a
 *   fresh `show.state` (breadcrumb);
 * - Device change -> re-route the Device to its (new) Board or cut it off when revoked;
 * - share revocation -> `access.revoked` and disconnect.
 * Without an attached Socket.IO server it is a no-op, so commands never depend on delivery. It is
 * also the live Device presence source (connected sockets per Device).
 */
export class RealtimeHub implements EventPublisher, DevicePresence {
  #io: Io | null = null;
  #deps: PlatformDeps | null = null;
  readonly #connected = new Map<string, number>();

  constructor(private readonly clock: Clock) {}

  attach(io: Io, deps: PlatformDeps): void {
    this.#io = io;
    this.#deps = deps;
  }

  isConnected(deviceId: string): boolean {
    return (this.#connected.get(deviceId) ?? 0) > 0;
  }

  deviceConnected(deviceId: string): void {
    this.#connected.set(deviceId, (this.#connected.get(deviceId) ?? 0) + 1);
  }

  deviceDisconnected(deviceId: string): void {
    const n = (this.#connected.get(deviceId) ?? 1) - 1;
    if (n <= 0) this.#connected.delete(deviceId);
    else this.#connected.set(deviceId, n);
  }

  async publish(event: ApplicationEvent): Promise<void> {
    const io = this.#io;
    const deps = this.#deps;
    if (!io || !deps) return;
    const now = this.clock.now();
    switch (event.type) {
      case 'timer.transitioned':
        // Boards get timer data only through their scoped projection (sent with the
        // `show.changed` of the same commit), never raw timers of Queues outside their sources.
        io.to(operatorRoom(event.showId)).emit(
          realtimeEvents.timer,
          toTimerSnapshot(event.queueItemId, event.state, now),
        );
        return;
      case 'show.changed': {
        const meta = await deps.shows.getShow(event.showId);
        if (meta) {
          io.to(operatorRoom(event.showId)).emit(
            realtimeEvents.show,
            toShowStateSnapshot(meta, event.show, now, await showContextOf(meta, deps)),
          );
        }
        for (const board of event.show.boards) {
          io.to(boardRoom(board.id)).emit(
            realtimeEvents.boardSnapshot,
            toBoardSnapshot(board, event.show, now),
          );
        }
        if (meta?.eventId) await this.#refreshEvent(meta.eventId);
        return;
      }
      case 'event.changed':
        await this.#refreshEvent(event.eventId);
        for (const showId of event.showIds) await this.#refreshShow(showId);
        return;
      case 'devices.changed':
        for (const deviceId of event.deviceIds) {
          if (event.revoked) this.#cutOff(deviceRoom(deviceId), 'device_revoked');
          else await this.#refreshDevice(deviceId);
        }
        if (event.scope.eventId) await this.#refreshEvent(event.scope.eventId);
        if (event.scope.showId) {
          const list = await deviceList(event.scope, deps);
          io.to(operatorRoom(event.scope.showId)).emit(realtimeEvents.devices, {
            devices: list.devices,
          });
        }
        return;
      case 'access.revoked':
        this.#cutOff(grantRoom(event.grantId), 'share_revoked');
        return;
    }
  }

  #cutOff(room: string, reason: 'device_revoked' | 'share_revoked'): void {
    const io = this.#io;
    if (!io) return;
    io.to(room).emit(realtimeEvents.revoked, { reason });
    io.in(room).disconnectSockets(true);
  }

  async #refreshShow(showId: string): Promise<void> {
    const io = this.#io;
    const deps = this.#deps;
    if (!io || !deps) return;
    const [meta, show] = await Promise.all([
      deps.shows.getShow(ShowId(showId)),
      deps.state.loadShowAggregate(ShowId(showId)),
    ]);
    if (!meta || !show) return;
    io.to(operatorRoom(showId)).emit(
      realtimeEvents.show,
      toShowStateSnapshot(meta, show, this.clock.now(), await showContextOf(meta, deps)),
    );
  }

  async #refreshEvent(eventId: string): Promise<void> {
    const io = this.#io;
    const deps = this.#deps;
    if (!io || !deps) return;
    const state = await buildEventState(eventId, deps);
    if (state) io.to(eventRoom(eventId)).emit(realtimeEvents.event, state);
    const view = await loadEventView(eventId, deps);
    if (!view) return;
    const now = this.clock.now();
    for (const board of view.agg.boards) {
      io.to(boardRoom(board.id)).emit(
        realtimeEvents.boardSnapshot,
        toEventBoardSnapshot(board, view.agg, view.shows, now),
      );
    }
  }

  /** Move a Device's sockets to the room of its (newly) assigned Board and resend its display. */
  async #refreshDevice(deviceId: string): Promise<void> {
    const io = this.#io;
    const deps = this.#deps;
    if (!io || !deps) return;
    const device = await deps.deviceStore.findDevice(DeviceId(deviceId));
    if (!device || device.revokedAt !== null) {
      this.#cutOff(deviceRoom(deviceId), 'device_revoked');
      return;
    }
    const display = await getDeviceDisplay(device, deps);
    const sockets = await io.in(deviceRoom(deviceId)).fetchSockets();
    for (const socket of sockets) {
      for (const room of socket.rooms) if (room.startsWith('board:')) socket.leave(room);
      if (display.board) socket.join(boardRoom(display.board.board.id));
      socket.emit(realtimeEvents.device, display);
    }
  }
}
