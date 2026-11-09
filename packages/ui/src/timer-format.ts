import type { TimerView } from '@klockr/domain';

function clock(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${String(h)}:${mm}:${ss}` : `${mm}:${ss}`;
}

/**
 * Display text for a timer view (presentation only; the value comes from `deriveTimer`).
 * Countdown remaining is floored and overtime is ceiled, so every displayed second lasts one
 * second and the documented sequence holds: `00:01 -> 00:00 -> +00:01 -> +00:02`.
 */
export function formatTimer(view: TimerView): string {
  if (view.remainingMs === null) return clock(Math.floor(view.elapsedMs / 1000));
  if (view.isOvertime) return `+${clock(Math.ceil(view.overtimeMs / 1000))}`;
  return clock(Math.floor(view.remainingMs / 1000));
}

/** Format a duration in ms as mm:ss / h:mm:ss (labels such as the target). */
export function formatDuration(ms: number): string {
  return clock(Math.max(0, Math.round(ms / 1000)));
}

/** Remaining fraction 1 -> 0 for progress bars; 0 in overtime; null for count-up. */
export function remainingFraction(view: TimerView, durationMs: number): number | null {
  if (view.remainingMs === null || durationMs <= 0) return null;
  return Math.min(1, Math.max(0, view.remainingMs / durationMs));
}
