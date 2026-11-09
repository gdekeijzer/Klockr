import {
  toBoardSnapshot,
  toQueueSnapshot,
  toTimerSnapshot,
  type ApplicationEvent,
  type EventPublisher,
} from '@klockr/application';
import {
  realtimeEvents,
  type ClientToServerEvents,
  type ServerToClientEvents,
} from '@klockr/contracts';
import type { Board, Clock, ShowId } from '@klockr/domain';
import type { Server } from 'socket.io';

/** Management clients (Operator View, Queue Editor) of a Show. */
export const operatorRoom = (showId: string): string => `show:${showId}:operators`;
/** All Boards of a Show (timer transitions). */
export const boardsRoom = (showId: string): string => `show:${showId}:boards`;
/** One Board (its own projection). */
export const boardRoom = (boardId: string): string => `board:${boardId}`;

export interface HubSources {
  readonly boardOfShow: (showId: ShowId) => Promise<Board | null>;
}

/**
 * Bridges committed application events to realtime clients. Never sends ticks:
 * - timer transition -> one `timer.state` to operators and boards of the Show;
 * - Queue change -> `queue.state` (full Queue) to operators and a fresh `board.snapshot`
 *   (current item only) to each Board, so Boards follow Current automatically.
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
      case 'queue.changed': {
        io.to(operatorRoom(event.showId)).emit(
          realtimeEvents.queue,
          toQueueSnapshot(event.aggregate, now),
        );
        const board = await this.#sources?.boardOfShow(event.showId);
        if (board) {
          io.to(boardRoom(board.id)).emit(
            realtimeEvents.boardSnapshot,
            toBoardSnapshot(board, event.aggregate, now),
          );
        }
        return;
      }
    }
  }
}
