import type { QueueAggregate, QueueItemId, TimerState } from '@klockr/domain';

/**
 * Timers that differ between two aggregates (by item id), including created/removed ones.
 * Persistence adapters write (compare-and-set) only these; all others keep their stored state.
 */
export function changedTimers(
  prev: QueueAggregate,
  next: QueueAggregate,
): { id: QueueItemId; before: TimerState | null; after: TimerState | null }[] {
  const before = new Map(prev.items.map((i) => [i.id, i.timer]));
  const after = new Map(next.items.map((i) => [i.id, i.timer]));
  const ids = new Set([...before.keys(), ...after.keys()]);
  return [...ids]
    .map((id) => ({ id, before: before.get(id) ?? null, after: after.get(id) ?? null }))
    .filter((c) => c.before !== c.after);
}
