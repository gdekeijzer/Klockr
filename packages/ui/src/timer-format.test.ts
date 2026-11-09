import { createTimer, deriveTimer, startTimer, timerPhase, type TimerState } from '@klockr/domain';
import { describe, expect, it } from 'vitest';
import { formatDuration, formatTimer, remainingFraction } from './timer-format';
import { timerDigitColor, timerStatusChip } from './timer-presentation';

function running(durationMs: number): TimerState {
  const c = createTimer({ mode: 'countdown', durationMs });
  if (!c.ok) throw new Error('setup');
  const s = startTimer(c.value, 0);
  if (!s.ok) throw new Error('setup');
  return s.value;
}

describe('formatTimer', () => {
  const t = running(20 * 60_000);
  it.each([
    [0, '20:00'],
    [1, '19:59'],
    [20 * 60_000 - 1_000, '00:01'],
    [20 * 60_000 - 1, '00:00'],
    [20 * 60_000, '00:00'],
    [20 * 60_000 + 1, '+00:01'],
    [20 * 60_000 + 1_000, '+00:01'],
    [20 * 60_000 + 1_001, '+00:02'],
  ])('at %i ms shows %s', (at, text) => {
    expect(formatTimer(deriveTimer(t, at))).toBe(text);
  });

  it('shows hours for long timers', () => {
    expect(formatTimer(deriveTimer(running(2 * 3_600_000), 0))).toBe('2:00:00');
    expect(formatDuration(90_000)).toBe('01:30');
  });

  it('progress runs from 1 to 0 and stays 0 in overtime', () => {
    expect(remainingFraction(deriveTimer(t, 0), 20 * 60_000)).toBe(1);
    expect(remainingFraction(deriveTimer(t, 10 * 60_000), 20 * 60_000)).toBe(0.5);
    expect(remainingFraction(deriveTimer(t, 30 * 60_000), 20 * 60_000)).toBe(0);
  });
});

describe('timer presentation', () => {
  it('normal running digits are white, never green', () => {
    const view = deriveTimer(running(20 * 60_000), 0);
    expect(timerDigitColor(timerPhase(view))).toBe('var(--k-text-primary)');
    expect(timerStatusChip('running')).toEqual({ label: 'RUNNING', variant: 'success' });
  });

  it('warning is amber; critical and overtime are red', () => {
    expect(timerDigitColor('warning')).toBe('var(--k-state-warning)');
    expect(timerDigitColor('critical')).toBe('var(--k-state-critical)');
    expect(timerDigitColor('overtime')).toBe('var(--k-state-critical)');
  });
});

describe('threshold presentation', () => {
  it('summarizes percent and absolute rules and names the source', async () => {
    const { formatThresholds, thresholdSourceLabel } = await import('./thresholds');
    expect(formatThresholds({ kind: 'percent', warningPercent: 20, criticalPercent: 5 })).toBe(
      'Warning ≤ 20 % · Critical ≤ 5 %',
    );
    expect(formatThresholds({ kind: 'absolute', warningMs: 300_000, criticalMs: 60_000 })).toBe(
      'Warning ≤ 05:00 · Critical ≤ 01:00',
    );
    expect(thresholdSourceLabel('queue')).toBe('Queue override');
  });
});
