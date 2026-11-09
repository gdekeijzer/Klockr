import {
  normalizeShow,
  ok,
  reconcileSuggestions,
  showFirstLock,
  type ActorRef,
  type LockTarget,
  type Permission,
  type ShowAggregate,
  type ShowId,
} from '@klockr/domain';
import type { Actor, CommandContext } from '../command';
import { appError, type AppError, type CommandResult } from '../errors';
import { stableStringify } from '../idempotency';
import type {
  ApplicationEvent,
  AuditRecord,
  Authorizer,
  EventPublisher,
  IdempotencyStore,
  IdGenerator,
  ShowRepository,
  ShowStateRepository,
} from '../ports';
import type { Clock } from '@klockr/domain';

export const actorRef = (actor: Actor): ActorRef => ({ kind: actor.kind, id: actor.id });

export interface MutationDeps {
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly shows: ShowRepository;
  readonly state: ShowStateRepository;
  readonly idempotency: IdempotencyStore;
  readonly authorizer: Authorizer;
  readonly events: EventPublisher;
  readonly onPublishError?: (error: unknown) => void;
}

export type AuditDraft = Omit<AuditRecord, 'id' | 'showId' | 'actor' | 'at'>;

/** What one attempt of a mutation produced (pure, from the loaded Show). */
export interface MutationResult<T> {
  readonly show: ShowAggregate;
  readonly value: T;
  /** Audit records for this change (written atomically with it). */
  readonly audit?: readonly AuditDraft[];
  /** Additional events to publish after commit (besides `show.changed`). */
  readonly events?: readonly ApplicationEvent[];
}

export interface MutationSpec<T> {
  readonly commandId: string;
  readonly commandType: string;
  /** Fingerprint input for idempotency (type + payload). */
  readonly intent: unknown;
  readonly idempotencyKey?: string | undefined;
  /** Pinned revision (Queue or timer, see `checkRevision`); disables automatic re-evaluation. */
  readonly expectedRevision?: number | undefined;
  readonly checkRevision?: (show: ShowAggregate) => AppError | null;
  readonly permission: Permission;
  /** Lock targets this command touches (structure/configuration). Empty = never gated. */
  readonly lockTargets: (show: ShowAggregate) => readonly LockTarget[];
  readonly override?: { readonly reason: string } | undefined;
  readonly apply: (show: ShowAggregate, now: number) => CommandResult<MutationResult<T>>;
}

const MAX_ATTEMPTS = 3;

/**
 * The single mutation path of a Show (every Queue command, live timer command, relation,
 * suggestion, Board and Message command). Order: capability -> idempotent replay -> load ->
 * expected revision -> lock gate (or audited Emergency Override) -> pure domain operation ->
 * suggested-follow reconciliation + reference normalization -> ONE atomic compare-and-set save
 * including audit -> remember outcome -> publish -> record activity.
 *
 * Without a pinned revision a lost compare-and-set race is re-evaluated against the fresh state
 * (max. 3 attempts), as if the command had arrived a moment later.
 */
export async function mutateShow<T>(
  showId: ShowId,
  spec: MutationSpec<T>,
  context: CommandContext,
  deps: MutationDeps,
): Promise<CommandResult<{ show: ShowAggregate; value: T }>> {
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
      return stored.result as CommandResult<{ show: ShowAggregate; value: T }>;
    }
  }

  const actor = actorRef(context.actor);
  for (let attempt = 1; ; attempt++) {
    const prev = await deps.state.loadShowAggregate(showId);
    if (!prev) return appError('not_found', 'Show not found');
    const revisionError = spec.checkRevision ? spec.checkRevision(prev) : null;
    if (revisionError) return { ok: false, error: revisionError };

    const now = deps.clock.now();
    const lock = showFirstLock(prev, spec.lockTargets(prev));
    if (lock && !spec.override) {
      return appError('locked', `Locked by a lock on this ${lock.lock.target.kind}`, {
        lock: { id: lock.lock.id, target: lock.lock.target },
        inheritedFrom: lock.inheritedFrom,
      });
    }
    if (lock && !mayOverride) {
      return appError('forbidden', 'Emergency Override requires the lock.override permission');
    }

    const outcome = spec.apply(prev, now);
    if (!outcome.ok) return outcome;
    const { value } = outcome.value;
    if (outcome.value.show === prev) return ok({ show: prev, value });
    const show = normalizeShow(
      reconcileSuggestions(prev, outcome.value.show, { now, newId: () => deps.ids.uuid() }),
      now,
    );

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

    const saved = await deps.state.saveShowAggregate(prev, show, audit);
    if (!saved.ok) {
      const pinned = spec.expectedRevision !== undefined;
      if (saved.error.code === 'revision_conflict' && !pinned && attempt < MAX_ATTEMPTS) continue;
      return saved;
    }

    const result = ok({ show, value });
    if (spec.idempotencyKey !== undefined) {
      await deps.idempotency.remember(scope, spec.idempotencyKey, { fingerprint, result });
    }
    const events: ApplicationEvent[] = [
      ...(outcome.value.events ?? []),
      {
        type: 'show.changed',
        commandId: spec.commandId,
        commandType: spec.commandType,
        showId,
        show,
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

/** Pinned Queue revision check for commands that target one Queue. */
export function queueRevisionCheck(
  expected: number | undefined,
  queueId: (show: ShowAggregate) => string | undefined,
): (show: ShowAggregate) => AppError | null {
  return (show) => {
    if (expected === undefined) return null;
    const id = queueId(show);
    const queue = show.queues.find((q) => q.queue.id === id)?.queue;
    const actual = queue ? queue.revision : show.revision;
    return expected === actual
      ? null
      : {
          code: 'revision_conflict',
          message: 'Queue has changed since it was read',
          details: { expectedRevision: expected, actualRevision: actual },
        };
  };
}
