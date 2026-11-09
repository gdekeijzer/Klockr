import type { QueueAggregate, QueueItemId, ShowAggregate, TimerState } from '@klockr/domain';

type Items = Pick<QueueAggregate, 'items'> | ShowAggregate;

function allItems(source: Items) {
  return 'queues' in source ? source.queues.flatMap((q) => q.items) : source.items;
}

/**
 * Timers that differ between two aggregates (by item id), including created/removed ones.
 * Persistence adapters write (compare-and-set) only these; all others keep their stored state.
 */
export function changedTimers(
  prev: Items,
  next: Items,
): { id: QueueItemId; before: TimerState | null; after: TimerState | null }[] {
  const before = new Map(allItems(prev).map((i) => [i.id, i.timer]));
  const after = new Map(allItems(next).map((i) => [i.id, i.timer]));
  const ids = new Set([...before.keys(), ...after.keys()]);
  return [...ids]
    .map((id) => ({ id, before: before.get(id) ?? null, after: after.get(id) ?? null }))
    .filter((c) => c.before !== c.after);
}
