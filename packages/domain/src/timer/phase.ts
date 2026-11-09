import type { TimerView } from './timer';

/** Visual/operational timer phase derived from a view; never persisted. */
export type TimerPhase = 'normal' | 'warning' | 'critical' | 'overtime';

/**
 * Warning/critical thresholds. Two kinds (FUNCTIONAL_DESIGN §15):
 * - `percent`: remaining <= N % of the ORIGINAL configured duration (adjustments do not move it);
 * - `absolute`: remaining <= a fixed amount of time (e.g. warning at 05:00, critical at 01:00).
 * Inheritance (Show default -> Queue override -> Queue Item override) lives in `thresholds.ts`.
 */
export type TimerThresholds =
  | {
      readonly kind: 'percent';
      /** Warning when remaining <= this percentage of the configured duration. */
      readonly warningPercent: number;
      /** Critical when remaining <= this percentage of the configured duration. */
      readonly criticalPercent: number;
    }
  | {
      readonly kind: 'absolute';
      /** Warning when remaining <= this many milliseconds. */
      readonly warningMs: number;
      /** Critical when remaining <= this many milliseconds. */
      readonly criticalMs: number;
    };

/** KLOCKR defaults (decision 2026-11-09, OPEN_QUESTIONS #5): warning <= 20 %, critical <= 5 %. */
export const DEFAULT_TIMER_THRESHOLDS: TimerThresholds = {
  kind: 'percent',
  warningPercent: 20,
  criticalPercent: 5,
};

/** remaining <= percent% of duration, in integer arithmetic (no floating-point edge errors). */
function within(remainingMs: number, durationMs: number, percent: number): boolean {
  return remainingMs * 100 <= durationMs * percent;
}

function reaches(view: TimerView, thresholds: TimerThresholds, level: 'warning' | 'critical') {
  const remainingMs = view.remainingMs ?? 0;
  if (thresholds.kind === 'percent') {
    const pct = level === 'warning' ? thresholds.warningPercent : thresholds.criticalPercent;
    return within(remainingMs, view.durationMs, pct);
  }
  return remainingMs <= (level === 'warning' ? thresholds.warningMs : thresholds.criticalMs);
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
  if (reaches(view, thresholds, 'critical')) return 'critical';
  if (reaches(view, thresholds, 'warning')) return 'warning';
  return 'normal';
}
