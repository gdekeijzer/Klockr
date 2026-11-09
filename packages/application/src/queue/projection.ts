import type { BoardStateSnapshot, QueueItemSnapshot, QueueSnapshot } from '@klockr/contracts';
import {
  currentItem,
  lifecycleOf,
  nextItem,
  orderedItems,
  resolveItemThresholds,
  resolveQueueThresholds,
  type Board,
  type EpochMs,
  type QueueAggregate,
  type QueueItem,
} from '@klockr/domain';
import { toTimerSnapshot } from '../timer';

function itemSnapshot(agg: QueueAggregate, item: QueueItem, now: EpochMs): QueueItemSnapshot {
  return {
    id: item.id,
    groupId: item.groupId,
    title: item.title,
    subtitle: item.subtitle,
    notes: item.notes,
    tags: [...item.tags],
    position: item.position,
    active: item.active,
    completedAt: item.completedAt,
    lifecycle: lifecycleOf(agg, item),
    startMode: item.startMode,
    warning: item.warning,
    effectiveWarning: resolveItemThresholds(agg.showWarning, agg.queue.warning, item.warning),
    timer: item.timer ? toTimerSnapshot(item.id, item.timer, now) : null,
    plannedStartAt: item.plannedStartAt,
    plannedDurationMs: item.plannedDurationMs,
    fixedAnchor: item.fixedAnchor,
    actualStartAt: item.actualStartAt,
    actualEndAt: item.actualEndAt,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    revision: item.revision,
  };
}

/** Management projection of a Queue: items in operational order, derived current/next. */
export function toQueueSnapshot(agg: QueueAggregate, now: EpochMs): QueueSnapshot {
  return {
    id: agg.queue.id,
    showId: agg.showId,
    name: agg.queue.name,
    revision: agg.queue.revision,
    currentItemId: agg.queue.currentItemId,
    nextItemId: nextItem(agg)?.id ?? null,
    showWarning: agg.showWarning,
    warning: agg.queue.warning,
    effectiveWarning: resolveQueueThresholds(agg.showWarning, agg.queue.warning),
    showSchedule: agg.showSchedule,
    timingMode: agg.queue.timingMode,
    locks: agg.locks.map((l) => ({ ...l, target: { ...l.target }, lockedBy: { ...l.lockedBy } })),
    unlockRequests: agg.unlockRequests.map((r) => ({
      ...r,
      target: { ...r.target },
      requestedBy: { ...r.requestedBy },
    })),
    groups: [...agg.groups]
      .sort((a, b) => a.position - b.position)
      .map((g) => ({ id: g.id, title: g.title, position: g.position })),
    items: orderedItems(agg).map((item) => itemSnapshot(agg, item, now)),
    serverTime: now,
  };
}

/**
 * Speaker Board projection: the current item's title/subtitle, its effective thresholds and its
 * timer — nothing else (no notes, tags, other items or management data).
 */
export function toBoardSnapshot(
  board: Board,
  agg: QueueAggregate,
  now: EpochMs,
): BoardStateSnapshot {
  const item = currentItem(agg);
  const warning = resolveItemThresholds(agg.showWarning, agg.queue.warning, item?.warning ?? null);
  return {
    board: { id: board.id, preset: board.preset },
    queueRevision: agg.queue.revision,
    current: item ? { id: item.id, title: item.title, subtitle: item.subtitle } : null,
    warning: warning.rule,
    timer: item?.timer ? toTimerSnapshot(item.id, item.timer, now) : null,
    serverTime: now,
  };
}
