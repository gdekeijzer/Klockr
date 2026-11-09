import {
  toBoardSnapshot,
  toShowStateSnapshot,
  toTimerSnapshot,
  type ApplicationEvent,
  type EventPublisher,
} from '@klockr/application';
import {
  realtimeEvents,
  type ClientToServerEvents,
  type ServerToClientEvents,
} from '@klockr/contracts';
import type { Clock, Show, ShowId } from '@klockr/domain';
import type { Server } from 'socket.io';

/** Management clients (Operator, Master, Boards admin) of a Show. */
export const operatorRoom = (showId: string): string => `show:${showId}:operators`;
/** All Boards of a Show (timer transitions; each Board filters to its own timers). */
export const boardsRoom = (showId: string): string => `show:${showId}:boards`;
/** One Board (its own scoped projection). */
export const boardRoom = (boardId: string): string => `board:${boardId}`;

export interface HubSources {
  readonly showMeta: (showId: ShowId) => Promise<Show | null>;
}

/**
 * Bridges committed application events to realtime clients. Never sends ticks:
 * - timer transition -> one `timer.state` to the Show's management clients and Boards;
 * - Show change -> `show.state` (authoritative management projection) to management clients and
 *   a freshly computed, server-side scoped `board.snapshot` to EACH Board of the Show (only its
 *   sources, audience-visible items, its messages).
 * Without an attached Socket.IO server it is a no-op, so commands never depend on delivery.
 */
export class RealtimeHub implements EventPublisher {
  #io: Server<ClientToServerEvents, ServerToClientEvents> | null = null;
  #sources: HubSources | null = null;

  constructor(private readonly clock: Clock) {}

  attach(io: Server<ClientToServerEvents, ServerToClientEvents>, sources: HubSources): void {
    this.#io = io;
    this.#sources = sources;
  }

  async publish(event: ApplicationEvent): Promise<void> {
    const io = this.#io;
    if (!io) return;
    const now = this.clock.now();
    switch (event.type) {
      case 'timer.transitioned':
        io.to([operatorRoom(event.showId), boardsRoom(event.showId)]).emit(
          realtimeEvents.timer,
          toTimerSnapshot(event.queueItemId, event.state, now),
        );
        return;
      case 'show.changed': {
        const meta = await this.#sources?.showMeta(event.showId);
        if (meta) {
          io.to(operatorRoom(event.showId)).emit(
            realtimeEvents.show,
            toShowStateSnapshot(meta, event.show, now),
          );
        }
        for (const board of event.show.boards) {
          io.to(boardRoom(board.id)).emit(
            realtimeEvents.boardSnapshot,
            toBoardSnapshot(board, event.show, now),
          );
        }
        return;
      }
    }
  }
}
