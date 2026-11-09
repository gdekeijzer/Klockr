import type { QueueSnapshot, TimerSnapshot } from '@klockr/contracts';
import {
  calculateSchedule,
  GroupId,
  QueueId,
  QueueItemId,
  ShowId,
  type QueueAggregate,
  type ScheduleProjection,
  type TimerState,
} from '@klockr/domain';

function timerState(t: TimerSnapshot): TimerState {
  return {
    mode: t.mode,
    status: t.status,
    durationMs: t.durationMs,
    adjustmentMs: t.adjustmentMs,
    startedAt: t.startedAt,
    pausedAt: t.pausedAt,
    pausedTotalMs: t.pausedTotalMs,
    stoppedAt: t.stoppedAt,
    revision: t.revision,
  };
}

/**
 * Rebuild the domain aggregate from the authoritative Queue snapshot (plus the newest timers), so
 * the client runs the SAME pure schedule engine as the server would. No planning logic lives in
 * React; this is the scheduling counterpart of `deriveTimer` for timers.
 */
export function aggregateFromSnapshot(
  queue: QueueSnapshot,
  timers: Readonly<Record<string, TimerSnapshot>>,
): QueueAggregate {
  const queueId = QueueId(queue.id);
  return {
    showId: ShowId(queue.showId),
    showWarning: queue.showWarning,
    showSchedule: queue.showSchedule,
    locks: queue.locks,
    unlockRequests: queue.unlockRequests,
    queue: {
      id: queueId,
      showId: ShowId(queue.showId),
      name: queue.name,
      purpose: 'program',
      position: 0,
      currentItemId: queue.currentItemId === null ? null : QueueItemId(queue.currentItemId),
      warning: queue.warning,
      timingMode: queue.timingMode,
      revision: queue.revision,
    },
    groups: queue.groups.map((g) => ({
      id: GroupId(g.id),
      queueId,
      title: g.title,
      position: g.position,
      createdAt: 0,
      updatedAt: 0,
    })),
    items: queue.items.map((i) => {
      const timer = timers[i.id] ?? i.timer;
      return {
        id: QueueItemId(i.id),
        queueId,
        groupId: i.groupId === null ? null : GroupId(i.groupId),
        title: i.title,
        subtitle: i.subtitle,
        notes: i.notes,
        tags: i.tags,
        position: i.position,
        active: i.active,
        completedAt: i.completedAt,
        startMode: i.startMode,
        warning: i.warning,
        timer: timer ? timerState(timer) : null,
        plannedStartAt: i.plannedStartAt,
        plannedDurationMs: i.plannedDurationMs,
        fixedAnchor: i.fixedAnchor,
        actualStartAt: i.actualStartAt,
        actualEndAt: i.actualEndAt,
        createdAt: i.createdAt,
        updatedAt: i.updatedAt,
        revision: i.revision,
      };
    }),
  };
}

export function projectSchedule(
  queue: QueueSnapshot,
  timers: Readonly<Record<string, TimerSnapshot>>,
  now: number,
): ScheduleProjection {
  return calculateSchedule(aggregateFromSnapshot(queue, timers), now);
}
