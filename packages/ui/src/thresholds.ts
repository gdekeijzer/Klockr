import type { ThresholdSource, TimerThresholds } from '@klockr/domain';
import { formatDuration } from './timer-format';

/** Human summary of a threshold rule, e.g. "Warning ≤ 20 % · Critical ≤ 5 %". */
export function formatThresholds(rule: TimerThresholds): string {
  return rule.kind === 'percent'
    ? `Warning ≤ ${String(rule.warningPercent)} % · Critical ≤ ${String(rule.criticalPercent)} %`
    : `Warning ≤ ${formatDuration(rule.warningMs)} · Critical ≤ ${formatDuration(rule.criticalMs)}`;
}

/** Visible source of an inherited setting (CLAUDE.md §6: no hidden overrides). */
export function thresholdSourceLabel(source: ThresholdSource): string {
  switch (source) {
    case 'show':
      return 'Show default';
    case 'queue':
      return 'Queue override';
    case 'item':
      return 'Item override';
  }
}
