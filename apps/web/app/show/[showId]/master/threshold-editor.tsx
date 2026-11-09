'use client';

import type { ResolvedThresholdsDto, ThresholdRule } from '@klockr/contracts';
import { formatDuration, formatThresholds, thresholdSourceLabel } from '@klockr/ui';
import { useState } from 'react';
import { parseDurationInput } from '../../../../lib/duration-input';
import styles from '../show.module.css';
import editor from './editor.module.css';

/** Absolute values may be 00:00 (e.g. critical only at zero); plain parse refuses zero. */
function parseThresholdTime(text: string): number | null {
  const value = text.trim();
  if (/^0{1,2}:0{2}$/.test(value) || value === '0') return 0;
  return parseDurationInput(value);
}

function parseRule(
  kind: ThresholdRule['kind'],
  warning: string,
  critical: string,
): ThresholdRule | null {
  if (kind === 'percent') {
    const w = Number(warning);
    const c = Number(critical);
    if (
      !Number.isInteger(w) ||
      !Number.isInteger(c) ||
      w < 0 ||
      c < 0 ||
      w > 100 ||
      c > 100 ||
      c > w
    ) {
      return null;
    }
    if (warning.trim() === '' || critical.trim() === '') return null;
    return { kind: 'percent', warningPercent: w, criticalPercent: c };
  }
  const w = parseThresholdTime(warning);
  const c = parseThresholdTime(critical);
  if (w === null || c === null || c > w) return null;
  return { kind: 'absolute', warningMs: w, criticalMs: c };
}

function fieldsOf(rule: ThresholdRule): { warning: string; critical: string } {
  return rule.kind === 'percent'
    ? { warning: String(rule.warningPercent), critical: String(rule.criticalPercent) }
    : { warning: formatDuration(rule.warningMs), critical: formatDuration(rule.criticalMs) };
}

/**
 * Inherited setting editor (Show default -> Queue override -> Queue Item override). Always shows
 * the effective value and where it comes from; an own override can be reset to the inherited
 * value with one action. Nothing is overridden implicitly.
 */
export function ThresholdEditor(props: {
  /** Which level this editor configures. */
  level: 'show' | 'queue' | 'item';
  resolved: ResolvedThresholdsDto;
  /** This level's own value (null = inherits). Show level always has one. */
  own: ThresholdRule | null;
  disabled: boolean;
  onSave: (rule: ThresholdRule) => void;
  onReset?: () => void;
  testId: string;
}) {
  const { resolved, own, level } = props;
  const [kind, setKind] = useState<ThresholdRule['kind']>(resolved.rule.kind);
  const initial = fieldsOf(resolved.rule);
  const [warning, setWarning] = useState(initial.warning);
  const [critical, setCritical] = useState(initial.critical);
  const rule = parseRule(kind, warning, critical);
  const overridden = level !== 'show' && own !== null;
  const unit = kind === 'percent' ? '%' : 'mm:ss remaining';

  return (
    <div className={editor.thresholds} data-testid={props.testId}>
      <div className={styles.thresholds}>
        <span data-testid={`${props.testId}-effective`}>{formatThresholds(resolved.rule)}</span>
        <span
          className={styles.source}
          data-override={resolved.source !== 'show'}
          data-testid={`${props.testId}-source`}
        >
          {thresholdSourceLabel(resolved.source)}
        </span>
      </div>
      {overridden && props.onReset && (
        <button
          type="button"
          className={`${styles.button} ${styles.small}`}
          disabled={props.disabled}
          onClick={props.onReset}
          title={`Inherited: ${formatThresholds(resolved.inherited.rule)} (${thresholdSourceLabel(resolved.inherited.source)})`}
        >
          Reset to inherited ({thresholdSourceLabel(resolved.inherited.source)})
        </button>
      )}
      <form
        className={editor.thresholdForm}
        onSubmit={(e) => {
          e.preventDefault();
          if (rule) props.onSave(rule);
        }}
      >
        <label className={editor.field}>
          <span className="label">Type</span>
          <select
            className={styles.input}
            value={kind}
            onChange={(e) => {
              const next = e.target.value as ThresholdRule['kind'];
              setKind(next);
              const defaults =
                next === 'percent'
                  ? { warning: '20', critical: '5' }
                  : { warning: '05:00', critical: '01:00' };
              setWarning(defaults.warning);
              setCritical(defaults.critical);
            }}
          >
            <option value="percent">Percentage of duration</option>
            <option value="absolute">Time remaining</option>
          </select>
        </label>
        <label className={editor.field}>
          <span className="label">Warning ({unit})</span>
          <input
            className={`${styles.input} mono`}
            value={warning}
            aria-invalid={rule === null}
            onChange={(e) => {
              setWarning(e.target.value);
            }}
          />
        </label>
        <label className={editor.field}>
          <span className="label">Critical ({unit})</span>
          <input
            className={`${styles.input} mono`}
            value={critical}
            aria-invalid={rule === null}
            onChange={(e) => {
              setCritical(e.target.value);
            }}
          />
        </label>
        <button type="submit" className={styles.button} disabled={props.disabled || rule === null}>
          {level === 'show' ? 'Save Show default' : overridden ? 'Update override' : 'Override'}
        </button>
      </form>
    </div>
  );
}
