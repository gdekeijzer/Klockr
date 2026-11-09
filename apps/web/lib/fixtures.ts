import type {
  BoardStateSnapshot,
  QueueItemSnapshot,
  QueueSnapshot,
  ShowStateSnapshot,
  TimerSnapshot,
} from '@klockr/contracts';

/** Test fixtures for client-side Queue logic. */
const rule = { kind: 'percent', warningPercent: 20, criticalPercent: 5 } as const;
const resolved = { rule, source: 'show', inherited: { rule, source: 'show' } } as const;

export function timerFixture(
  id: string,
  revision = 0,
  patch: Partial<TimerSnapshot> = {},
): TimerSnapshot {
  return {
    queueItemId: id,
    mode: 'countdown',
    status: 'idle',
    durationMs: 600_000,
    adjustmentMs: 0,
    startedAt: null,
    pausedAt: null,
    pausedTotalMs: 0,
    stoppedAt: null,
    revision,
    serverTime: 0,
    ...patch,
  };
}

export function itemFixture(id: string, patch: Partial<QueueItemSnapshot> = {}): QueueItemSnapshot {
  return {
    id,
    groupId: null,
    title: id,
    subtitle: null,
    notes: null,
    tags: [],
    position: 0,
    active: true,
    completedAt: null,
    lifecycle: 'upcoming',
    startMode: 'manual',
    warning: null,
    effectiveWarning: resolved,
    timer: timerFixture(id),
    plannedStartAt: null,
    plannedDurationMs: null,
    fixedAnchor: false,
    actualStartAt: null,
    actualEndAt: null,
    visibility: null,
    notesAudiences: [],
    createdAt: 0,
    updatedAt: 0,
    revision: 0,
    ...patch,
  };
}

export function queueFixture(
  items: QueueItemSnapshot[],
  patch: Partial<QueueSnapshot> = {},
): QueueSnapshot {
  return {
    id: 'q',
    showId: 's',
    name: 'Program',
    discipline: 'Program',
    position: 0,
    isPrimary: true,
    revision: 1,
    currentItemId: null,
    nextItemId: null,
    showWarning: rule,
    warning: null,
    effectiveWarning: { rule, source: 'show', inherited: { rule, source: 'show' } },
    showSchedule: {
      timingMode: 'strict',
      timeZone: 'UTC',
      scheduleDate: null,
      toleranceMs: 30_000,
      severeBehindMs: 300_000,
    },
    timingMode: null,
    locks: [],
    unlockRequests: [],
    groups: [],
    items,
    serverTime: 0,
    ...patch,
  };
}

export function showFixture(queues: QueueSnapshot[], revision = 1): ShowStateSnapshot {
  return {
    show: {
      id: 's',
      title: 'Show',
      ownership: 'anonymous',
      createdAt: 0,
      expiresAt: 0,
      revision,
      context: null,
      primaryQueueId: queues[0]?.id ?? 'q',
    },
    queues,
    relations: [],
    suggestions: [],
    boards: [],
    messages: [],
    serverTime: 0,
  };
}

export function boardFixture(
  version: number,
  currentId: string | null,
  timerRevision = 0,
): BoardStateSnapshot {
  return {
    board: {
      id: 'b',
      name: 'Speaker',
      preset: 'speaker_confidence',
      audience: 'stage',
      components: [],
      presentation: { lowLight: false, showTimes: false },
    },
    version,
    timeZone: 'UTC',
    queues: [
      {
        id: 'q',
        name: 'Program',
        discipline: null,
        isPrimary: true,
        current: currentId
          ? {
              id: currentId,
              title: currentId,
              subtitle: null,
              durationMs: 600_000,
              plannedStart: null,
              projectedStart: null,
              fixedAnchor: false,
            }
          : null,
        standBy: false,
        currentNotes: null,
        next: null,
        upcoming: [],
        timers: currentId ? [timerFixture(currentId, timerRevision)] : [],
        warning: { kind: 'percent', warningPercent: 20, criticalPercent: 5 },
        offsetMs: null,
        growsAfter: null,
        toleranceMs: 30_000,
        severeBehindMs: 300_000,
        anchor: null,
        locked: false,
        suggestion: null,
      },
    ],
    messages: [],
    serverTime: 0,
  };
}
