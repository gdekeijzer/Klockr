import {
  firstLock,
  ok,
  type ActorRef,
  type LockTarget,
  type Permission,
  type QueueAggregate,
  type ShowId,
} from '@klockr/domain';
import type { Actor, CommandContext } from '../command';
import { appError, type AppError, type CommandResult } from '../errors';
import { stableStringify } from '../idempotency';
import type { ApplicationEvent, AuditRecord } from '../ports';
import type { QueueCommandDeps } from './queue-commands';

export const actorRef = (actor: Actor): ActorRef => ({ kind: actor.kind, id: actor.id });

/** What one attempt of a mutation produced (pure, from the loaded aggregate). */
export interface MutationResult<T> {
  readonly aggregate: QueueAggregate;
  readonly value: T;
  /** Audit records for this change (written atomically with it). */
  readonly audit?: readonly Omit<AuditRecord, 'id' | 'showId' | 'actor' | 'at'>[];
  /** Additional events to publish after commit (besides `queue.changed`). */
  readonly events?: readonly ApplicationEvent[];
}

export interface MutationSpec<T> {
  readonly commandId: string;
  readonly commandType: string;
  /** Fingerprint input for idempotency (type + payload). */
  readonly intent: unknown;
  readonly idempotencyKey?: string | undefined;
  /** Compared with the Queue revision (Queue commands) — or custom via `checkRevision`. */
  readonly expectedRevision?: number | undefined;
  readonly checkRevision?: (agg: QueueAggregate) => AppError | null;
  readonly permission: Permission;
  /** Lock targets this command touches (structure/configuration). Empty = never gated. */
  readonly lockTargets: (agg: QueueAggregate) => readonly LockTarget[];
  readonly override?: { readonly reason: string } | undefined;
  readonly apply: (
    agg: QueueAggregate,
    now: number,
  ) => CommandResult<MutationResult<T>> | MutationResult<T>;
}

const MAX_ATTEMPTS = 3;

function isResult<T>(
  value: CommandResult<MutationResult<T>> | MutationResult<T>,
): value is CommandResult<MutationResult<T>> {
  return 'ok' in value;
}

/**
 * The single mutation path for a Show's Program Queue aggregate (Queue commands AND live timer
 * commands). Order: permission -> idempotent replay -> load -> expected revision -> lock gate
 * (or audited Emergency Override) -> pure domain operation -> one atomic compare-and-set save
 * including audit records -> remember outcome -> publish -> record activity.
 *
 * Without an explicit expected revision a lost compare-and-set race is re-evaluated against the
 * fresh state (max. 3 attempts), as if the command had arrived a moment later.
 */
export async function mutateQueue<T>(
  showId: ShowId,
  spec: MutationSpec<T>,
  context: CommandContext,
  deps: QueueCommandDeps,
): Promise<CommandResult<{ aggregate: QueueAggregate; value: T }>> {
  if (!(await deps.authorizer.can(context.actor, spec.permission, { kind: 'show', id: showId }))) {
    return appError('forbidden', 'Not permitted to perform this action on this Show');
  }
  const mayOverride =
    spec.override !== undefined &&
    (await deps.authorizer.can(context.actor, 'lock.override', { kind: 'show', id: showId }));

  const scope = `${context.actor.kind}:${context.actor.id}`;
  const fingerprint = stableStringify({ showId, type: spec.commandType, intent: spec.intent });
  if (spec.idempotencyKey !== undefined) {
    const stored = await deps.idempotency.find(scope, spec.idempotencyKey);
    if (stored) {
      if (stored.fingerprint !== fingerprint) {
        return appError('idempotency_conflict', 'Idempotency key was used for a different command');
      }
      return stored.result as CommandResult<{ aggregate: QueueAggregate; value: T }>;
    }
  }

  const show = await deps.shows.getShow(showId);
  if (!show) return appError('not_found', 'Show not found');
  const actor = actorRef(context.actor);

  for (let attempt = 1; ; attempt++) {
    const prev = await deps.queues.loadQueue(show.primaryQueueId);
    if (!prev) return appError('not_found', 'Queue not found');
    const revisionError = spec.checkRevision
      ? spec.checkRevision(prev)
      : spec.expectedRevision !== undefined && spec.expectedRevision !== prev.queue.revision
        ? {
            code: 'revision_conflict' as const,
            message: 'Queue has changed since it was read',
            details: {
              expectedRevision: spec.expectedRevision,
              actualRevision: prev.queue.revision,
            },
          }
        : null;
    if (revisionError) return { ok: false, error: revisionError };

    const now = deps.clock.now();
    const lock = firstLock(prev, spec.lockTargets(prev));
    if (lock && !spec.override) {
      return appError('locked', `Locked by a lock on this ${lock.lock.target.kind}`, {
        lock: { id: lock.lock.id, target: lock.lock.target },
        inheritedFrom: lock.inheritedFrom,
      });
    }
    if (lock && !mayOverride) {
      return appError('forbidden', 'Emergency Override requires the lock.override permission');
    }

    const applied = spec.apply(prev, now);
    const outcome = isResult(applied) ? applied : ok(applied);
    if (!outcome.ok) return outcome;
    const { aggregate, value } = outcome.value;
    if (aggregate === prev) return ok({ aggregate, value });

    const audit: AuditRecord[] = (outcome.value.audit ?? []).map((record) => ({
      ...record,
      id: deps.ids.uuid(),
      showId,
      actor,
      at: now,
    }));
    if (lock && spec.override) {
      audit.unshift({
        id: deps.ids.uuid(),
        showId,
        actor,
        at: now,
        action: 'lock.override',
        resource: lock.lock.target,
        details: {
          reason: spec.override.reason,
          command: spec.commandType,
          commandId: spec.commandId,
          lockId: lock.lock.id,
          lockedBy: lock.lock.lockedBy,
          inheritedFrom: lock.inheritedFrom,
        },
      });
    }

    const saved = await deps.queues.saveQueue(prev, aggregate, audit);
    if (!saved.ok) {
      const pinned = spec.expectedRevision !== undefined;
      if (saved.error.code === 'revision_conflict' && !pinned && attempt < MAX_ATTEMPTS) continue;
      return saved;
    }

    const result = ok({ aggregate, value });
    if (spec.idempotencyKey !== undefined) {
      await deps.idempotency.remember(scope, spec.idempotencyKey, { fingerprint, result });
    }
    const events: ApplicationEvent[] = [
      ...(outcome.value.events ?? []),
      {
        type: 'queue.changed',
        commandId: spec.commandId,
        commandType: spec.commandType,
        showId,
        aggregate,
        occurredAt: now,
      },
    ];
    for (const event of events) {
      try {
        await deps.events.publish(event);
      } catch (error) {
        deps.onPublishError?.(error);
      }
    }
    await deps.shows.touch(showId, now);
    return result;
  }
}
