import type { DurationMs } from '../time';
import type { TimerView } from './timer';

/** Visual/operational timer phase derived from a view; never persisted. */
export type TimerPhase = 'normal' | 'warning' | 'critical' | 'overtime';

export interface TimerThresholds {
  /** Remaining time at or below which the countdown is in warning. */
  readonly warningMs: DurationMs;
  /** Remaining time at or below which the countdown is critical. */
  readonly criticalMs: DurationMs;
}

/**
 * PROVISIONAL default (OPEN_QUESTIONS #5 is still open): taken from the examples in
 * FUNCTIONAL_DESIGN.md ("Warning at 05:00 remaining, Critical at 01:00 remaining").
 * Show -> Queue -> Queue Item inheritance of thresholds arrives with M2.
 */
export const PROVISIONAL_DEFAULT_THRESHOLDS: TimerThresholds = {
  warningMs: 5 * 60 * 1_000,
  criticalMs: 60 * 1_000,
};

export function timerPhase(
  view: TimerView,
  thresholds: TimerThresholds = PROVISIONAL_DEFAULT_THRESHOLDS,
): TimerPhase {
  if (view.remainingMs === null) return 'normal';
  if (view.isOvertime) return 'overtime';
  // An untouched idle timer is not "running out"; it only shows its configured value.
  if (view.status === 'idle') return 'normal';
  if (view.remainingMs <= thresholds.criticalMs) return 'critical';
  if (view.remainingMs <= thresholds.warningMs) return 'warning';
  return 'normal';
}
