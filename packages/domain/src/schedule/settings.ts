import type { DurationMs } from '../time';

/**
 * Timing strategy (FUNCTIONAL_DESIGN §20). Resolved `Show default -> Queue override`.
 * - `strict`: the planned schedule stays the operational target; projection reports where the
 *   show will land, but an item with an explicit planned start is never projected earlier than
 *   planned. Nothing is shortened or shifted in the plan.
 * - `sliding`: projected times of future items follow live deviations (late AND early), except
 *   fixed anchors which never move earlier than their planned time.
 * In both modes Planned is never rewritten by live operation.
 */
export type TimingMode = 'strict' | 'sliding';

export interface ShowSchedule {
  /** Show default timing mode. */
  readonly timingMode: TimingMode;
  /** IANA timezone in which human schedule times (HH:MM) are entered and shown. */
  readonly timeZone: string;
  /** Show day (YYYY-MM-DD in `timeZone`) that planned HH:MM times refer to; null = not set. */
  readonly scheduleDate: string | null;
  /** ON TIME band: |offset| <= tolerance. Default 30 s. */
  readonly toleranceMs: DurationMs;
  /** BEHIND turns severe (red) above this offset. Default 5 min. */
  readonly severeBehindMs: DurationMs;
}

export const DEFAULT_SHOW_SCHEDULE: ShowSchedule = {
  timingMode: 'strict',
  timeZone: 'UTC',
  scheduleDate: null,
  toleranceMs: 30_000,
  severeBehindMs: 5 * 60_000,
};

export function resolveTimingMode(
  show: TimingMode,
  queue: TimingMode | null,
): { readonly mode: TimingMode; readonly source: 'show' | 'queue' } {
  return queue ? { mode: queue, source: 'queue' } : { mode: show, source: 'show' };
}
