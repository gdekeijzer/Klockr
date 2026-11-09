import type { QueueAggregate } from '../queue/model';
import { sameTarget, type Lock, type LockTarget } from './lock';

export interface EffectiveLock {
  readonly lock: Lock;
  /** Where the lock sits: the target itself, or a parent (Group, Queue, Show). */
  readonly inheritedFrom: LockTarget | null;
}

/** Targets from the given one up to the Show: item -> group -> queue -> show. */
export function lockChain(agg: QueueAggregate, target: LockTarget): LockTarget[] {
  const show: LockTarget = { kind: 'show', id: agg.showId };
  const queue: LockTarget = { kind: 'queue', id: agg.queue.id };
  switch (target.kind) {
    case 'show':
      return [show];
    case 'queue':
      return [queue, show];
    case 'group':
      return [target, queue, show];
    case 'item': {
      const item = agg.items.find((i) => i.id === target.id);
      const group: LockTarget[] = item?.groupId ? [{ kind: 'group', id: item.groupId }] : [];
      return [target, ...group, queue, show];
    }
  }
}

export function ownLock(agg: QueueAggregate, target: LockTarget): Lock | null {
  return agg.locks.find((l) => sameTarget(l.target, target)) ?? null;
}

/**
 * Effective lock state: a lock on the target or on any parent applies (inheritance downwards).
 * Returns the nearest lock, or null when the target is effectively unlocked.
 */
export function effectiveLock(agg: QueueAggregate, target: LockTarget): EffectiveLock | null {
  for (const level of lockChain(agg, target)) {
    const lock = ownLock(agg, level);
    if (lock) {
      return { lock, inheritedFrom: sameTarget(level, target) ? null : level };
    }
  }
  return null;
}

/** The first effective lock among several targets a command touches, if any. */
export function firstLock(
  agg: QueueAggregate,
  targets: readonly LockTarget[],
): EffectiveLock | null {
  for (const target of targets) {
    const found = effectiveLock(agg, target);
    if (found) return found;
  }
  return null;
}

export function targetExists(agg: QueueAggregate, target: LockTarget): boolean {
  switch (target.kind) {
    case 'show':
      return target.id === agg.showId;
    case 'queue':
      return target.id === agg.queue.id;
    case 'group':
      return agg.groups.some((g) => g.id === target.id);
    case 'item':
      return agg.items.some((i) => i.id === target.id);
  }
}

/** Remove locks/requests of items or groups that no longer exist (after deletes). */
export function pruneLocks(agg: QueueAggregate): QueueAggregate {
  const locks = agg.locks.filter((l) => targetExists(agg, l.target));
  if (locks.length === agg.locks.length) return agg;
  const ids = new Set(locks.map((l) => l.id));
  return {
    ...agg,
    locks,
    unlockRequests: agg.unlockRequests.filter((r) => ids.has(r.lockId)),
  };
}
