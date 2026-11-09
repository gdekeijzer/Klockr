import type { TimerView } from './timer';

/** Visual/operational timer phase derived from a view; never persisted. */
export type TimerPhase = 'normal' | 'warning' | 'critical' | 'overtime';

/**
 * Thresholds as a percentage of the ORIGINAL configured duration (adjustments do not move them).
 * M2 adds Show -> Queue -> Queue Item inheritance; absolute-time thresholds may be added later.
 */
export interface TimerThresholds {
  /** Warning when remaining <= this percentage of the configured duration. */
  readonly warningPercent: number;
  /** Critical when remaining <= this percentage of the configured duration. */
  readonly criticalPercent: number;
}

/** KLOCKR defaults (decision 2026-11-09, OPEN_QUESTIONS #5): warning <= 20 %, critical <= 5 %. */
export const DEFAULT_TIMER_THRESHOLDS: TimerThresholds = {
  warningPercent: 20,
  criticalPercent: 5,
};

/** remaining <= percent% of duration, in integer arithmetic (no floating-point edge errors). */
function within(remainingMs: number, durationMs: number, percent: number): boolean {
  return remainingMs * 100 <= durationMs * percent;
}

/**
 * Overtime (remaining < 0) always dominates; then critical, then warning. An idle timer is
 * always normal: it only shows its configured value and is not running out.
 */
export function timerPhase(
  view: TimerView,
  thresholds: TimerThresholds = DEFAULT_TIMER_THRESHOLDS,
): TimerPhase {
  if (view.remainingMs === null) return 'normal';
  if (view.isOvertime) return 'overtime';
  if (view.status === 'idle') return 'normal';
  if (within(view.remainingMs, view.durationMs, thresholds.criticalPercent)) return 'critical';
  if (within(view.remainingMs, view.durationMs, thresholds.warningPercent)) return 'warning';
  return 'normal';
}
