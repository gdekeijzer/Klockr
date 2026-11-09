import type { BoardId, QueueId, QueueItemId, ShowId } from '../ids';
import { err, ok, type Result } from '../result';
import type { DurationMs, EpochMs } from '../time';
import { presetDefaults, type Board } from '../board';
import type { Queue, QueueItem } from '../queue';
import { DEFAULT_SHOW_SCHEDULE, type ShowSchedule } from '../schedule/settings';
import {
  createTimer,
  DEFAULT_TIMER_THRESHOLDS,
  type TimerError,
  type TimerState,
  type TimerThresholds,
} from '../timer';

/** Nominal anonymous retention (docs/IDENTITY_AUTH_LIFECYCLE.md). Expiry = cleanup eligibility. */
export const ANONYMOUS_SHOW_TTL_MS: DurationMs = 7 * 24 * 60 * 60 * 1_000;

export type ShowOwnership = 'anonymous';

/** Standalone operational unit. Only the fields the Quick Timer slice needs exist yet. */
export interface Show {
  readonly id: ShowId;
  readonly title: string;
  readonly ownership: ShowOwnership;
  readonly primaryQueueId: QueueId;
  readonly createdAt: EpochMs;
  readonly lastActiveAt: EpochMs;
  /** When the anonymous Show becomes eligible for cleanup; not a deletion time. */
  readonly expiresAt: EpochMs;
  /** Show default warning thresholds (top of Show -> Queue -> Queue Item inheritance). */
  readonly warning: TimerThresholds;
  /** Schedule settings: timing mode default, timezone, show date, tolerance. */
  readonly schedule: ShowSchedule;
}

export interface QuickTimerShow {
  readonly show: Show;
  readonly queue: Queue;
  readonly item: QueueItem & { readonly timer: TimerState };
  readonly board: Board;
}

export interface QuickTimerIds {
  readonly showId: ShowId;
  readonly queueId: QueueId;
  readonly queueItemId: QueueItemId;
  readonly boardId: BoardId;
}

/**
 * The smallest expression of the full model: an anonymous Show with one Program Queue, one
 * timed (current) Queue Item and one Speaker Board. No Event, Room or account is involved.
 */
export function createQuickTimerShow(
  ids: QuickTimerIds,
  durationMs: DurationMs,
  now: EpochMs,
  schedule: Partial<ShowSchedule> = {},
): Result<QuickTimerShow, TimerError> {
  const timer = createTimer({ mode: 'countdown', durationMs });
  if (!timer.ok) return err(timer.error);
  return ok({
    show: {
      id: ids.showId,
      title: 'Quick Timer',
      ownership: 'anonymous',
      primaryQueueId: ids.queueId,
      createdAt: now,
      lastActiveAt: now,
      expiresAt: now + ANONYMOUS_SHOW_TTL_MS,
      warning: DEFAULT_TIMER_THRESHOLDS,
      schedule: { ...DEFAULT_SHOW_SCHEDULE, ...schedule },
    },
    queue: {
      id: ids.queueId,
      showId: ids.showId,
      name: 'Program',
      discipline: 'Program',
      position: 0,
      // A Quick Timer is immediately operable: its only item is current.
      currentItemId: ids.queueItemId,
      warning: null,
      timingMode: null,
      revision: 0,
    },
    item: {
      id: ids.queueItemId,
      queueId: ids.queueId,
      groupId: null,
      title: 'Timer',
      subtitle: null,
      notes: null,
      tags: [],
      position: 0,
      active: true,
      completedAt: null,
      startMode: 'manual',
      warning: null,
      visibility: null,
      notesAudiences: [],
      timer: timer.value,
      plannedStartAt: null,
      plannedDurationMs: null,
      fixedAnchor: false,
      actualStartAt: null,
      actualEndAt: null,
      createdAt: now,
      updatedAt: now,
      revision: 0,
    },
    board: speakerBoard(ids, now),
  });
}

/** The Quick Timer's Speaker Board: Speaker Confidence preset, audience Stage, Primary Queue. */
function speakerBoard(ids: QuickTimerIds, now: EpochMs): Board {
  const defaults = presetDefaults('speaker_confidence');
  return {
    id: ids.boardId,
    showId: ids.showId,
    name: 'Speaker Board',
    preset: 'speaker_confidence',
    audience: defaults.audience,
    sources: defaults.sources,
    components: defaults.components,
    presentation: defaults.presentation,
    createdAt: now,
    updatedAt: now,
    revision: 0,
  };
}
