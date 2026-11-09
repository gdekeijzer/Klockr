import { toTimerSnapshot, type ApplicationEvent, type EventPublisher } from '@klockr/application';
import {
  realtimeEvents,
  type ClientToServerEvents,
  type ServerToClientEvents,
} from '@klockr/contracts';
import type { Clock } from '@klockr/domain';
import type { Server } from 'socket.io';

export const showRoom = (showId: string): string => `show:${showId}`;

/**
 * Bridges committed application events to realtime clients. Sends one authoritative timer
 * snapshot per transition (never ticks). Without an attached Socket.IO server it is a no-op,
 * so the timer engine never depends on realtime delivery.
 */
export class RealtimeHub implements EventPublisher {
  #io: Server<ClientToServerEvents, ServerToClientEvents> | null = null;

  constructor(private readonly clock: Clock) {}

  attach(io: Server<ClientToServerEvents, ServerToClientEvents>): void {
    this.#io = io;
  }

  publish(event: ApplicationEvent): Promise<void> {
    if (this.#io) {
      this.#io
        .to(showRoom(event.showId))
        .emit(
          realtimeEvents.timer,
          toTimerSnapshot(event.queueItemId, event.state, this.clock.now()),
        );
    }
    return Promise.resolve();
  }
}
