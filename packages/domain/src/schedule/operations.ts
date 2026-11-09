import type { QueueItemId } from '../ids';
import type { QueueAggregate } from '../queue/model';
import { findItem } from '../queue/order';
import {
  badInput,
  commit,
  notFound,
  replaceItem,
  touchItem,
  type OperationContext,
  type QueueError,
  type QueueResult,
} from '../queue/operations';
import { ok, type Result } from '../result';
import type { DurationMs, EpochMs } from '../time';
import {
  MAX_TIMER_DURATION_MS,
  type TimerError,
  type TimerResult,
  type TimerState,
} from '../timer';
import type { ShowSchedule, TimingMode } from './settings';

/**
 * Planning edits. These are the ONLY operations that change Planned values; live operation
 * (START, adjust, END, current changes) never does.
 */
export interface ItemSchedulePatch {
  /** Explicit planned start (UTC); null = chained after the previous item. */
  readonly plannedStartAt?: EpochMs | null | undefined;
  /** Planned duration for items without timer; ignored (must be null) for timed items. */
  readonly plannedDurationMs?: DurationMs | null | undefined;
  readonly fixedAnchor?: boolean | undefined;
}

export function setItemSchedule(
  agg: QueueAggregate,
  input: { readonly id: QueueItemId; readonly patch: ItemSchedulePatch },
  ctx: OperationContext,
): QueueResult {
  const item = findItem(agg, input.id);
  if (!item) return notFound('item not found');
  const { patch } = input;
  const plannedStartAt =
    patch.plannedStartAt === undefined ? item.plannedStartAt : patch.plannedStartAt;
  const plannedDurationMs =
    patch.plannedDurationMs === undefined ? item.plannedDurationMs : patch.plannedDurationMs;
  const fixedAnchor = patch.fixedAnchor ?? item.fixedAnchor;

  if (plannedStartAt !== null && (!Number.isInteger(plannedStartAt) || plannedStartAt < 0)) {
    return badInput('invalid planned start');
  }
  if (plannedDurationMs !== null) {
    if (item.timer) return badInput('a timed item uses its timer duration as planned duration');
    if (
      !Number.isInteger(plannedDurationMs) ||
      plannedDurationMs < 0 ||
      plannedDurationMs > MAX_TIMER_DURATION_MS
    ) {
      return badInput('invalid planned duration');
    }
  }
  if (fixedAnchor && plannedStartAt === null) {
    return badInput('a fixed anchor needs an explicit planned start');
  }
  if (
    plannedStartAt === item.plannedStartAt &&
    plannedDurationMs === item.plannedDurationMs &&
    fixedAnchor === item.fixedAnchor
  ) {
    return ok(agg);
  }
  return ok(
    commit(
      replaceItem(
        agg,
        touchItem(item, { plannedStartAt, plannedDurationMs, fixedAnchor }, ctx.now),
      ),
    ),
  );
}

/** Queue override of the timing mode; null = inherit the Show default. */
export function setQueueTimingMode(agg: QueueAggregate, mode: TimingMode | null): QueueResult {
  if (agg.queue.timingMode === mode) return ok(agg);
  return ok(commit({ ...agg, queue: { ...agg.queue, timingMode: mode } }));
}

function validTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Show-level schedule settings (timing mode default, timezone, show date, tolerance). */
export function setShowSchedule(agg: QueueAggregate, patch: Partial<ShowSchedule>): QueueResult {
  const next: ShowSchedule = { ...agg.showSchedule, ...patch };
  if (!validTimeZone(next.timeZone)) return badInput('unknown time zone');
  if (next.scheduleDate !== null && !/^\d{4}-\d{2}-\d{2}$/.test(next.scheduleDate)) {
    return badInput('schedule date must be YYYY-MM-DD');
  }
  if (!Number.isInteger(next.toleranceMs) || next.toleranceMs < 0 || next.toleranceMs > 600_000) {
    return badInput('tolerance must be between 0 and 10 minutes');
  }
  if (
    !Number.isInteger(next.severeBehindMs) ||
    next.severeBehindMs < next.toleranceMs ||
    next.severeBehindMs > MAX_TIMER_DURATION_MS
  ) {
    return badInput('severe behind threshold must be at least the tolerance');
  }
  const same = (Object.keys(next) as (keyof ShowSchedule)[]).every(
    (k) => next[k] === agg.showSchedule[k],
  );
  return ok(same ? agg : commit({ ...agg, showSchedule: next }));
}

/**
 * Apply a timer transition to an item inside the aggregate (live transport). The first START
 * records `actualStartAt`; later restarts never rewrite it. Planned values are untouched.
 */
export function transitionItemTimer(
  agg: QueueAggregate,
  input: { readonly id: QueueItemId; readonly transition: (state: TimerState) => TimerResult },
  ctx: Pick<OperationContext, 'now'>,
): Result<{ aggregate: QueueAggregate; state: TimerState }, QueueError | TimerError> {
  const item = findItem(agg, input.id);
  if (!item?.timer) return notFound('timer not found');
  const next = input.transition(item.timer);
  if (!next.ok) return next;
  const actualStartAt = item.actualStartAt ?? (next.value.status === 'running' ? ctx.now : null);
  const updated = touchItem(item, { timer: next.value, actualStartAt }, ctx.now);
  return ok({ aggregate: commit(replaceItem(agg, updated)), state: next.value });
}
