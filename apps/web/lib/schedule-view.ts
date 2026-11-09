import type { QueueSnapshot, ShowStateSnapshot, TimerSnapshot } from '@klockr/contracts';
import {
  BoardId,
  calculateShowSchedule,
  GroupId,
  QueueId,
  QueueItemId,
  ShowId,
  type Board,
  type QueueAggregate,
  type QueueState,
  type ShowAggregate,
  type ShowScheduleProjection,
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

function queueState(
  queue: QueueSnapshot,
  timers: Readonly<Record<string, TimerSnapshot>>,
): QueueState {
  const queueId = QueueId(queue.id);
  return {
    queue: {
      id: queueId,
      showId: ShowId(queue.showId),
      name: queue.name,
      discipline: queue.discipline,
      position: queue.position,
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
        visibility: i.visibility,
        notesAudiences: i.notesAudiences,
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

/**
 * Rebuild the domain Show aggregate from the authoritative management snapshot (plus the newest
 * timers), so the client runs the SAME pure schedule engine as the server. No planning logic
 * lives in React.
 */
export function showAggregateFromSnapshot(
  state: ShowStateSnapshot,
  timers: Readonly<Record<string, TimerSnapshot>>,
): ShowAggregate {
  const first = state.queues[0];
  const showId = ShowId(state.show.id);
  return {
    showId,
    title: state.show.title,
    revision: state.show.revision,
    primaryQueueId: QueueId(state.show.primaryQueueId),
    showWarning: first?.showWarning ?? { kind: 'percent', warningPercent: 20, criticalPercent: 5 },
    showSchedule: first?.showSchedule ?? {
      timingMode: 'strict',
      timeZone: 'UTC',
      scheduleDate: null,
      toleranceMs: 30_000,
      severeBehindMs: 300_000,
    },
    queues: state.queues.map((q) => queueState(q, timers)),
    locks: first?.locks ?? [],
    unlockRequests: first?.unlockRequests ?? [],
    relations: state.relations.map((r) => ({ ...r, createdAt: 0, updatedAt: 0 })),
    suggestions: state.suggestions.map((s) => ({
      ...s,
      targetCurrentAtCreation: null,
      resolvedAt: null,
    })),
    boards: state.boards.map((b): Board => ({
      ...b,
      id: BoardId(b.id),
      showId,
      sources:
        b.sources.kind === 'primary'
          ? { kind: 'primary' }
          : { kind: 'queues', queueIds: b.sources.queueIds.map(QueueId) },
      createdAt: 0,
      updatedAt: 0,
    })),
    messages: state.messages.map((m) => ({
      ...m,
      boardIds: m.boardIds.map(BoardId),
      clearedAt: null,
    })),
  };
}

/** Single-Queue domain view of one Queue of the snapshot (for M2/M3 helpers such as locks). */
export function aggregateFromSnapshot(
  state: ShowStateSnapshot,
  queueId: string,
  timers: Readonly<Record<string, TimerSnapshot>>,
): QueueAggregate | null {
  const show = showAggregateFromSnapshot(state, timers);
  const q = show.queues.find((x) => x.queue.id === queueId);
  if (!q) return null;
  return {
    showId: show.showId,
    showWarning: show.showWarning,
    showSchedule: show.showSchedule,
    locks: show.locks,
    unlockRequests: show.unlockRequests,
    queue: q.queue,
    groups: q.groups,
    items: q.items,
  };
}

export function projectShowSchedule(
  state: ShowStateSnapshot,
  timers: Readonly<Record<string, TimerSnapshot>>,
  now: number,
): ShowScheduleProjection {
  return calculateShowSchedule(showAggregateFromSnapshot(state, timers), now);
}
