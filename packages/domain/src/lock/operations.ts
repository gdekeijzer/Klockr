import { commit, invalid, notFound } from '../queue/operations';
import type { QueueAggregate } from '../queue/model';
import { ok, type Result } from '../result';
import type { EpochMs } from '../time';
import type { QueueError } from '../queue/operations';
import { effectiveLock, ownLock, targetExists } from './effective';
import { type ActorRef, type Lock, type LockTarget, type UnlockRequest } from './lock';

interface LockContext {
  readonly now: EpochMs;
  readonly newId: () => string;
  readonly actor: ActorRef;
}

/** Lock a target (Show, Queue, Group or Queue Item). One own lock per target. */
export function setLock(
  agg: QueueAggregate,
  target: LockTarget,
  ctx: LockContext,
): Result<{ aggregate: QueueAggregate; lock: Lock }, QueueError> {
  if (!targetExists(agg, target)) return notFound('lock target not found');
  if (ownLock(agg, target)) return invalid('already locked');
  const lock: Lock = { id: ctx.newId(), target, lockedAt: ctx.now, lockedBy: ctx.actor };
  return ok({ aggregate: commit({ ...agg, locks: [...agg.locks, lock] }), lock });
}

/**
 * Release the target's OWN lock. A lock inherited from a parent must be released on the parent.
 * Open unlock requests for the released lock are resolved with it.
 */
export function releaseLock(
  agg: QueueAggregate,
  target: LockTarget,
): Result<
  { aggregate: QueueAggregate; lock: Lock; resolvedRequests: readonly UnlockRequest[] },
  QueueError
> {
  const lock = ownLock(agg, target);
  if (!lock) {
    const inherited = effectiveLock(agg, target);
    return inherited
      ? invalid(`locked via ${inherited.lock.target.kind}; release that lock instead`)
      : invalid('not locked');
  }
  const resolvedRequests = agg.unlockRequests.filter((r) => r.lockId === lock.id);
  return ok({
    aggregate: commit({
      ...agg,
      locks: agg.locks.filter((l) => l.id !== lock.id),
      unlockRequests: agg.unlockRequests.filter((r) => r.lockId !== lock.id),
    }),
    lock,
    resolvedRequests,
  });
}

/** Request Unlock: records who asks to release the lock that applies to `target`. */
export function requestUnlock(
  agg: QueueAggregate,
  target: LockTarget,
  reason: string | null,
  ctx: LockContext,
): Result<{ aggregate: QueueAggregate; request: UnlockRequest }, QueueError> {
  if (!targetExists(agg, target)) return notFound('target not found');
  const effective = effectiveLock(agg, target);
  if (!effective) return invalid('not locked');
  const text = reason?.trim() ? reason.trim().slice(0, 500) : null;
  const request: UnlockRequest = {
    id: ctx.newId(),
    lockId: effective.lock.id,
    target: effective.lock.target,
    requestedAt: ctx.now,
    requestedBy: ctx.actor,
    reason: text,
  };
  return ok({
    aggregate: commit({ ...agg, unlockRequests: [...agg.unlockRequests, request] }),
    request,
  });
}
