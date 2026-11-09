import { ok, type QueueItemId, type Result, type TimerState } from '@klockr/domain';
import { appError, type AppError } from '../errors';
import type {
  ApplicationEvent,
  Authorizer,
  EventPublisher,
  IdempotencyStore,
  StoredOutcome,
  TimerRepository,
} from '../ports';

/** In-memory adapters for tests (and early prototyping before persistence adapters exist). */
export class InMemoryTimerRepository implements TimerRepository {
  readonly #timers = new Map<string, TimerState>();

  seed(queueItemId: QueueItemId, state: TimerState): void {
    this.#timers.set(queueItemId, state);
  }

  get(queueItemId: QueueItemId): Promise<TimerState | null> {
    return Promise.resolve(this.#timers.get(queueItemId) ?? null);
  }

  save(
    queueItemId: QueueItemId,
    next: TimerState,
    previousRevision: number,
  ): Promise<Result<void, AppError>> {
    const stored = this.#timers.get(queueItemId);
    if (stored?.revision !== previousRevision) {
      return Promise.resolve(appError('revision_conflict', 'Timer was modified concurrently'));
    }
    this.#timers.set(queueItemId, next);
    return Promise.resolve(ok(undefined));
  }
}

export class InMemoryIdempotencyStore implements IdempotencyStore {
  readonly #outcomes = new Map<string, StoredOutcome>();

  find(scope: string, key: string): Promise<StoredOutcome | null> {
    return Promise.resolve(this.#outcomes.get(`${scope}\u0000${key}`) ?? null);
  }

  remember(scope: string, key: string, outcome: StoredOutcome): Promise<void> {
    this.#outcomes.set(`${scope}\u0000${key}`, outcome);
    return Promise.resolve();
  }
}

export class RecordingEventPublisher implements EventPublisher {
  readonly events: ApplicationEvent[] = [];

  publish(event: ApplicationEvent): Promise<void> {
    this.events.push(event);
    return Promise.resolve();
  }
}

export const allowAllAuthorizer: Authorizer = { can: () => Promise.resolve(true) };
export const denyAllAuthorizer: Authorizer = { can: () => Promise.resolve(false) };
