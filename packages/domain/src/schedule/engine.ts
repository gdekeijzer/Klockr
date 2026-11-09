import type { QueueAggregate, QueueItem } from '../queue/model';
import { orderedItems } from '../queue/order';
import type { DurationMs, EpochMs } from '../time';
import { deriveTimer } from '../timer';
import { resolveTimingMode, type TimingMode } from './settings';

/**
 * Projected schedule engine — pure, deterministic, no clock reads (`now` is passed in).
 *
 * Three explicit time layers (docs/QUEUES_SCHEDULING.md):
 * - Planned: the baseline. Explicit `plannedStartAt` where set, otherwise chained after the
 *   previous active item's planned end. Durations: the timer's configured duration, or
 *   `plannedDurationMs` for items without timer. Never changed by live operation.
 * - Projected: the expected timing given the live situation (actuals, running timers including
 *   adjustments, current position, timing mode, fixed anchors). Always derived, never stored.
 * - Actual: `actualStartAt` / `actualEndAt` as recorded by operational commands.
 *
 * Projection never shortens anything: every future item keeps its full duration.
 */

export type OffsetStatus = 'ahead' | 'on_time' | 'behind' | 'severe';
export type AnchorStatus = 'on_track' | 'risk' | 'missed';

export interface ItemSchedule {
  readonly id: string;
  /** Excluded from the timeline: inactive, or passed over by a jump forward. */
  readonly skipped: boolean;
  readonly plannedStart: EpochMs | null;
  readonly plannedEnd: EpochMs | null;
  readonly plannedDurationMs: DurationMs;
  /** True when the planned start is an explicit planning value (not chained). */
  readonly explicitStart: boolean;
  readonly fixedAnchor: boolean;
  readonly projectedStart: EpochMs | null;
  readonly projectedEnd: EpochMs | null;
  readonly actualStart: EpochMs | null;
  readonly actualEnd: EpochMs | null;
  /** projectedStart - plannedStart (positive = later than planned). */
  readonly startShiftMs: DurationMs | null;
  /** Soft scheduled start: how long ago a `scheduled` item should have started. */
  readonly shouldHaveStartedMs: DurationMs | null;
}

export interface AnchorProjection {
  readonly itemId: string;
  readonly plannedStart: EpochMs;
  /** When the preceding items are projected to hand over to the anchor. */
  readonly projectedArrival: EpochMs;
  /** Time that must be won back before the anchor (0 when on track). Not the Show offset. */
  readonly recoveryMs: DurationMs;
  /** Time still available to win back (remaining current + not-started items before it). */
  readonly recoverableMs: DurationMs;
  readonly status: AnchorStatus;
}

export interface ScheduleProjection {
  readonly timingMode: { readonly mode: TimingMode; readonly source: 'show' | 'queue' };
  /** Items in operational order. */
  readonly items: readonly ItemSchedule[];
  /** Dominant Show offset (projected - planned of the relevant milestone), null if unplanned. */
  readonly showOffsetMs: DurationMs | null;
  readonly showOffsetBasis: { readonly itemId: string; readonly milestone: 'start' | 'end' } | null;
  /** The next fixed anchor that is not yet current/completed. */
  readonly nextAnchor: AnchorProjection | null;
  readonly toleranceMs: DurationMs;
  readonly severeBehindMs: DurationMs;
}

/** Planned duration of an item: its timer's configured duration, else plannedDurationMs, else 0. */
export function plannedDurationOf(item: QueueItem): DurationMs {
  return item.timer ? item.timer.durationMs : (item.plannedDurationMs ?? 0);
}

const max = (a: number, b: number) => (a > b ? a : b);

function timerStarted(item: QueueItem): boolean {
  return item.timer !== null && item.timer.status !== 'idle';
}

/** Projected end of the current (or a running) item at `now`. Never earlier than `now`. */
function projectedEndOfLive(item: QueueItem, start: EpochMs, now: EpochMs): EpochMs {
  if (item.completedAt !== null) return item.actualEndAt ?? item.completedAt;
  const timer = item.timer;
  if (!timer) return max(now, start + plannedDurationOf(item));
  switch (timer.status) {
    case 'idle':
      return start + timer.durationMs + timer.adjustmentMs;
    case 'stopped':
      // Stopped but not ENDed: it ends when the operator ENDs it, at the earliest now.
      return now;
    case 'running': {
      // Exact from the authoritative timestamps (independent of the observer's clock while the
      // timer is within its time): start + paused time + duration (+ countdown adjustment).
      // In overtime the item ends now at the earliest.
      const adjustment = timer.mode === 'countdown' ? timer.adjustmentMs : -timer.adjustmentMs;
      const end = (timer.startedAt ?? start) + timer.pausedTotalMs + timer.durationMs + adjustment;
      return max(now, end);
    }
    case 'paused': {
      // While paused the remaining time is frozen; the end moves with the clock.
      const view = deriveTimer(timer, now);
      const remaining = view.remainingMs ?? timer.durationMs - view.elapsedMs; // count-up: target - elapsed
      return now + max(0, remaining);
    }
  }
}

/**
 * Calculate planned chain and projected schedule for a Queue at instant `now`.
 * Strict vs Sliding differ only in how far an item may be pulled EARLIER: in Strict an item
 * with an explicit planned start never projects before it; in Sliding only fixed anchors hold.
 * Lateness always propagates (nothing is shortened).
 */
export function calculateSchedule(agg: QueueAggregate, now: EpochMs): ScheduleProjection {
  const ordered = orderedItems(agg);
  const timingMode = resolveTimingMode(agg.showSchedule.timingMode, agg.queue.timingMode);
  const strict = timingMode.mode === 'strict';
  const currentId = agg.queue.currentItemId;
  const currentIndex = currentId === null ? -1 : ordered.findIndex((i) => i.id === currentId);

  // 1. Planned chain.
  const planned = new Map<string, { start: EpochMs | null; end: EpochMs | null }>();
  let prevPlannedEnd: EpochMs | null = null;
  for (const item of ordered) {
    if (!item.active) {
      planned.set(item.id, { start: null, end: null });
      continue;
    }
    const start: EpochMs | null = item.plannedStartAt ?? prevPlannedEnd;
    const end: EpochMs | null = start === null ? null : start + plannedDurationOf(item);
    planned.set(item.id, { start, end });
    if (end !== null) prevPlannedEnd = end;
  }

  // 2. Projection.
  const out: ItemSchedule[] = [];
  const arrivals = new Map<string, EpochMs | null>();
  let cursor: EpochMs | null = null;
  ordered.forEach((item, index) => {
    const plan = planned.get(item.id) ?? { start: null, end: null };
    const base = {
      id: item.id,
      plannedStart: plan.start,
      plannedEnd: plan.end,
      plannedDurationMs: plannedDurationOf(item),
      explicitStart: item.plannedStartAt !== null,
      fixedAnchor: item.fixedAnchor,
      actualStart: item.actualStartAt,
      actualEnd: item.actualEndAt,
    };
    const skip = (): ItemSchedule => ({
      ...base,
      skipped: true,
      projectedStart: null,
      projectedEnd: null,
      startShiftMs: null,
      shouldHaveStartedMs: null,
    });
    arrivals.set(item.id, cursor);

    if (!item.active) {
      out.push(skip());
      return;
    }
    const isCurrent = index === currentIndex;
    const afterCurrent = currentIndex >= 0 && index > currentIndex;
    let start: EpochMs | null;
    let end: EpochMs | null;

    if (item.completedAt !== null && !isCurrent) {
      // Done: actuals are the truth. A completed item after Current (re-run elsewhere) does not
      // consume time again.
      start = item.actualStartAt ?? plan.start;
      end = item.actualEndAt ?? item.completedAt;
      if (!afterCurrent) cursor = cursor === null ? end : max(cursor, end);
    } else if (currentIndex >= 0 && index < currentIndex) {
      out.push(skip()); // passed over by a jump forward; it will not run
      return;
    } else if (isCurrent) {
      const started = item.actualStartAt ?? (timerStarted(item) ? item.timer?.startedAt : null);
      if (started !== null && started !== undefined) {
        start = started;
      } else {
        let earliest = now;
        if (plan.start !== null && (item.fixedAnchor || (strict && item.plannedStartAt !== null))) {
          earliest = max(earliest, plan.start);
        }
        start = earliest;
      }
      end = projectedEndOfLive(item, start, now);
      cursor = end;
    } else {
      // Upcoming.
      let candidate: EpochMs | null = cursor ?? plan.start;
      if (candidate !== null) {
        if (plan.start !== null && (item.fixedAnchor || (strict && item.plannedStartAt !== null))) {
          candidate = max(candidate, plan.start);
        }
        candidate = max(candidate, now);
      }
      start = candidate;
      const duration =
        item.timer && item.timer.status === 'idle'
          ? item.timer.durationMs + item.timer.adjustmentMs
          : plannedDurationOf(item);
      end = start === null ? null : start + duration;
      if (end !== null) cursor = end;
    }

    const notStarted =
      !isCurrent && item.completedAt === null && item.actualStartAt === null && !timerStarted(item);
    const overdue =
      item.startMode === 'scheduled' && notStarted && plan.start !== null && now > plan.start
        ? now - plan.start
        : null;
    out.push({
      ...base,
      skipped: false,
      projectedStart: start,
      projectedEnd: end,
      startShiftMs: start !== null && plan.start !== null ? start - plan.start : null,
      shouldHaveStartedMs: overdue,
    });
  });

  // 3. Dominant Show offset.
  let showOffsetMs: number | null = null;
  let showOffsetBasis: ScheduleProjection['showOffsetBasis'] = null;
  const current = currentIndex >= 0 ? ordered[currentIndex] : undefined;
  const currentSchedule = current ? out[currentIndex] : undefined;
  if (current && currentSchedule && !currentSchedule.skipped) {
    const started =
      current.completedAt !== null || current.actualStartAt !== null || timerStarted(current);
    if (started && currentSchedule.projectedEnd !== null && currentSchedule.plannedEnd !== null) {
      showOffsetMs = currentSchedule.projectedEnd - currentSchedule.plannedEnd;
      showOffsetBasis = { itemId: current.id, milestone: 'end' };
    } else if (currentSchedule.startShiftMs !== null) {
      showOffsetMs = currentSchedule.startShiftMs;
      showOffsetBasis = { itemId: current.id, milestone: 'start' };
    }
  } else {
    const first = out.find((s, i) => !s.skipped && ordered[i]?.completedAt === null);
    if (first?.startShiftMs !== undefined && first.startShiftMs !== null) {
      showOffsetMs = first.startShiftMs;
      showOffsetBasis = { itemId: first.id, milestone: 'start' };
    }
  }

  // 4. Next fixed anchor and recovery required before it.
  let nextAnchor: AnchorProjection | null = null;
  const from = Math.max(0, currentIndex + 1);
  for (let i = from; i < ordered.length; i++) {
    const item = ordered[i];
    const schedule = out[i];
    if (!item || !schedule || schedule.skipped || !item.fixedAnchor) continue;
    if (item.completedAt !== null || schedule.plannedStart === null) continue;
    const arrival = arrivals.get(item.id) ?? now;
    const recoveryMs = max(0, arrival - schedule.plannedStart);
    let recoverableMs = 0;
    if (currentSchedule && current?.completedAt === null && currentSchedule.projectedEnd !== null) {
      recoverableMs += max(0, currentSchedule.projectedEnd - now);
    }
    for (let j = from; j < i; j++) {
      const s = out[j];
      const it = ordered[j];
      if (s && it && !s.skipped && it.completedAt === null) recoverableMs += s.plannedDurationMs;
    }
    const status: AnchorStatus =
      recoveryMs === 0 ? 'on_track' : recoveryMs <= recoverableMs ? 'risk' : 'missed';
    nextAnchor = {
      itemId: item.id,
      plannedStart: schedule.plannedStart,
      projectedArrival: arrival,
      recoveryMs,
      recoverableMs,
      status,
    };
    break;
  }

  return {
    timingMode,
    items: out,
    showOffsetMs,
    showOffsetBasis,
    nextAnchor,
    toleranceMs: agg.showSchedule.toleranceMs,
    severeBehindMs: agg.showSchedule.severeBehindMs,
  };
}

/**
 * Classify an offset: negative = AHEAD, positive = BEHIND, |offset| <= tolerance = ON TIME,
 * BEHIND above `severeBehindMs` = severe. With `previous`, a small hysteresis band keeps the
 * status from flickering around the tolerance edges.
 */
export function classifyOffset(
  offsetMs: DurationMs,
  toleranceMs: DurationMs,
  severeBehindMs: DurationMs,
  previous: OffsetStatus | null = null,
): OffsetStatus {
  const hysteresis = Math.min(10_000, Math.floor(toleranceMs / 3));
  const behindAt =
    previous === 'behind' || previous === 'severe' ? toleranceMs - hysteresis : toleranceMs;
  const aheadAt = previous === 'ahead' ? -toleranceMs + hysteresis : -toleranceMs;
  if (offsetMs > behindAt) {
    const severeAt = previous === 'severe' ? severeBehindMs - hysteresis : severeBehindMs;
    return offsetMs > severeAt ? 'severe' : 'behind';
  }
  if (offsetMs < aheadAt) return 'ahead';
  return 'on_time';
}
