import type { EpochMs, QueueItemId, Result, TimerState } from '@klockr/domain';
import type { Actor } from './command';
import type { AppError, CommandResult } from './errors';

/** Capabilities are checked, never role names. Roles are bundles of these (AUTH_RBAC.md). */
export type Permission = 'timer.control';

export interface ResourceRef {
  readonly kind: 'queueItem';
  readonly id: string;
}

export interface Authorizer {
  can(actor: Actor, permission: Permission, resource: ResourceRef): Promise<boolean>;
}

export interface TimerRepository {
  get(queueItemId: QueueItemId): Promise<TimerState | null>;
  /**
   * Persist `next` only if the stored revision still equals `previousRevision` (compare-and-set).
   * Returns `revision_conflict` otherwise, so concurrent writers can never overwrite newer state.
   */
  save(
    queueItemId: QueueItemId,
    next: TimerState,
    previousRevision: number,
  ): Promise<Result<void, AppError>>;
}

export interface StoredOutcome {
  /** Fingerprint of the command intent (type + payload) the key was first used with. */
  readonly fingerprint: string;
  readonly result: CommandResult<unknown>;
}

export interface IdempotencyStore {
  find(scope: string, key: string): Promise<StoredOutcome | null>;
  remember(scope: string, key: string, outcome: StoredOutcome): Promise<void>;
}

export interface TimerTransitionedEvent {
  readonly type: 'timer.transitioned';
  readonly commandId: string;
  readonly commandType: string;
  readonly queueItemId: QueueItemId;
  readonly state: TimerState;
  readonly occurredAt: EpochMs;
}

export type ApplicationEvent = TimerTransitionedEvent;

/**
 * Receives committed transitions (realtime hub, future Actions). Delivery failures must never
 * roll back or block the core timer engine.
 */
export interface EventPublisher {
  publish(event: ApplicationEvent): Promise<void>;
}
