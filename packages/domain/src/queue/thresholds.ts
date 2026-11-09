import { err, ok, type Result } from '../result';
import { MAX_TIMER_DURATION_MS, type TimerThresholds } from '../timer';

/**
 * Inheritance of timer warning thresholds (FUNCTIONAL_DESIGN §7/§15, CLAUDE.md §6):
 *
 *   Show default -> Queue override -> Queue Item override
 *
 * An override replaces the whole rule (kind + both values); there is no per-field merging, so the
 * effective value is always exactly one visible rule from one visible source.
 */
export type ThresholdSource = 'show' | 'queue' | 'item';

export interface ResolvedThresholds {
  /** The rule in effect. */
  readonly rule: TimerThresholds;
  /** Where the rule in effect comes from. */
  readonly source: ThresholdSource;
  /** What the level would get without its own override (for "Reset to inherited"). */
  readonly inherited: { readonly rule: TimerThresholds; readonly source: ThresholdSource };
}

/** Effective thresholds for a Queue (no item level). */
export function resolveQueueThresholds(
  showDefault: TimerThresholds,
  queueOverride: TimerThresholds | null,
): ResolvedThresholds {
  const fromShow = { rule: showDefault, source: 'show' as const };
  return queueOverride
    ? { rule: queueOverride, source: 'queue', inherited: fromShow }
    : { ...fromShow, inherited: fromShow };
}

/** Effective thresholds for a Queue Item. */
export function resolveItemThresholds(
  showDefault: TimerThresholds,
  queueOverride: TimerThresholds | null,
  itemOverride: TimerThresholds | null,
): ResolvedThresholds {
  const queue = resolveQueueThresholds(showDefault, queueOverride);
  const inherited = { rule: queue.rule, source: queue.source };
  return itemOverride
    ? { rule: itemOverride, source: 'item', inherited }
    : { ...inherited, inherited };
}

/** Validate a threshold rule: critical must not be "earlier" than warning; values in range. */
export function validateThresholds(rule: TimerThresholds): Result<TimerThresholds, string> {
  if (rule.kind === 'percent') {
    const { warningPercent: w, criticalPercent: c } = rule;
    if (!Number.isInteger(w) || !Number.isInteger(c) || w < 0 || c < 0 || w > 100 || c > 100) {
      return err('percent thresholds must be whole numbers between 0 and 100');
    }
    if (c > w) return err('critical threshold must not be above the warning threshold');
    return ok(rule);
  }
  const { warningMs: w, criticalMs: c } = rule;
  if (!Number.isInteger(w) || !Number.isInteger(c) || w < 0 || c < 0) {
    return err('absolute thresholds must be non-negative whole milliseconds');
  }
  if (w > MAX_TIMER_DURATION_MS || c > MAX_TIMER_DURATION_MS) {
    return err('absolute thresholds out of range');
  }
  if (c > w) return err('critical threshold must not be above the warning threshold');
  return ok(rule);
}

export function sameThresholds(a: TimerThresholds | null, b: TimerThresholds | null): boolean {
  if (a === null || b === null) return a === b;
  if (a.kind === 'percent' && b.kind === 'percent') {
    return a.warningPercent === b.warningPercent && a.criticalPercent === b.criticalPercent;
  }
  if (a.kind === 'absolute' && b.kind === 'absolute') {
    return a.warningMs === b.warningMs && a.criticalMs === b.criticalMs;
  }
  return false;
}
