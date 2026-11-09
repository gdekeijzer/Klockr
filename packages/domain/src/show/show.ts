import type { BoardId, QueueId, QueueItemId, ShowId } from '../ids';
import { err, ok, type Result } from '../result';
import type { DurationMs, EpochMs } from '../time';
import { createTimer, type TimerError, type TimerState } from '../timer';

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
}

/** Peer lane of Queue Items. A Quick Timer has exactly one: the Program Queue. */
export interface Queue {
  readonly id: QueueId;
  readonly showId: ShowId;
  readonly name: string;
  readonly purpose: 'program';
  readonly position: number;
}

/** Universal Queue Item; the timer is an optional capability (ADR-0001). */
export interface QueueItem {
  readonly id: QueueItemId;
  readonly queueId: QueueId;
  readonly title: string;
  readonly position: number;
  readonly timer: TimerState | null;
}

/** Presentation definition over Show data (ADR-0002). M1 has the Speaker preset only. */
export interface Board {
  readonly id: BoardId;
  readonly showId: ShowId;
  readonly preset: 'speaker';
  readonly createdAt: EpochMs;
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
 * timed Queue Item and one Speaker Board. No Event, Room or account is involved.
 */
export function createQuickTimerShow(
  ids: QuickTimerIds,
  durationMs: DurationMs,
  now: EpochMs,
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
    },
    queue: {
      id: ids.queueId,
      showId: ids.showId,
      name: 'Program',
      purpose: 'program',
      position: 0,
    },
    item: {
      id: ids.queueItemId,
      queueId: ids.queueId,
      title: 'Timer',
      position: 0,
      timer: timer.value,
    },
    board: { id: ids.boardId, showId: ids.showId, preset: 'speaker', createdAt: now },
  });
}
