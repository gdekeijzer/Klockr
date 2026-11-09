import { describe, expect, it } from 'vitest';
import { MINUTE_MS, SECOND_MS } from '../time';
import { DEFAULT_TIMER_THRESHOLDS, timerPhase } from './phase';
import { adjustTimer, createTimer, deriveTimer, startTimer, type TimerState } from './timer';

function running(durationMs: number): TimerState {
  const created = createTimer({ mode: 'countdown', durationMs });
  if (!created.ok) throw new Error('setup');
  const started = startTimer(created.value, 0);
  if (!started.ok) throw new Error('setup');
  return started.value;
}

/** Phase when exactly `remainingMs` is left on a running timer of `durationMs`. */
function phaseAt(durationMs: number, remainingMs: number) {
  return timerPhase(deriveTimer(running(durationMs), durationMs - remainingMs));
}

describe('KLOCKR default thresholds: warning <= 20 %, critical <= 5 % of configured duration', () => {
  it('defaults are 20 % and 5 %', () => {
    expect(DEFAULT_TIMER_THRESHOLDS).toEqual({
      kind: 'percent',
      warningPercent: 20,
      criticalPercent: 5,
    });
  });

  it.each([
    // [label, duration, warning from, critical from]
    ['20:00 timer', 20 * MINUTE_MS, 4 * MINUTE_MS, 1 * MINUTE_MS],
    ['05:00 timer', 5 * MINUTE_MS, 1 * MINUTE_MS, 15 * SECOND_MS],
    ['01:00 timer', 1 * MINUTE_MS, 12 * SECOND_MS, 3 * SECOND_MS],
  ])('%s: warning from %#', (_label, duration, warningFrom, criticalFrom) => {
    expect(phaseAt(duration, duration)).toBe('normal');
    expect(phaseAt(duration, warningFrom + 1)).toBe('normal');
    expect(phaseAt(duration, warningFrom)).toBe('warning');
    expect(phaseAt(duration, criticalFrom + 1)).toBe('warning');
    expect(phaseAt(duration, criticalFrom)).toBe('critical');
    expect(phaseAt(duration, 0)).toBe('critical');
    expect(phaseAt(duration, -1)).toBe('overtime');
  });

  it('20:00 timer: warning from 04:00, critical from 01:00', () => {
    expect(phaseAt(20 * MINUTE_MS, 4 * MINUTE_MS)).toBe('warning');
    expect(phaseAt(20 * MINUTE_MS, 1 * MINUTE_MS)).toBe('critical');
  });

  it('05:00 timer: warning from 01:00, critical from 00:15', () => {
    expect(phaseAt(5 * MINUTE_MS, 1 * MINUTE_MS)).toBe('warning');
    expect(phaseAt(5 * MINUTE_MS, 15 * SECOND_MS)).toBe('critical');
  });

  it('01:00 timer: warning from 00:12, critical from 00:03', () => {
    expect(phaseAt(MINUTE_MS, 12 * SECOND_MS)).toBe('warning');
    expect(phaseAt(MINUTE_MS, 3 * SECOND_MS)).toBe('critical');
  });

  it('a short timer starts normal (no longer amber/red from its first second)', () => {
    expect(phaseAt(MINUTE_MS, MINUTE_MS - SECOND_MS)).toBe('normal');
  });

  it('uses the original configured duration, not the adjusted one', () => {
    // 10:00 timer + 05:00 adjustment: thresholds stay at 02:00 / 00:30 remaining.
    let state = running(10 * MINUTE_MS);
    const adjusted = adjustTimer(state, 5 * MINUTE_MS, 0);
    if (!adjusted.ok) throw new Error('setup');
    state = adjusted.value;
    const at = (remainingMs: number) =>
      timerPhase(deriveTimer(state, 15 * MINUTE_MS - remainingMs));
    expect(at(2 * MINUTE_MS + 1)).toBe('normal');
    expect(at(2 * MINUTE_MS)).toBe('warning');
    expect(at(30 * SECOND_MS)).toBe('critical');
  });

  it('overtime always dominates critical', () => {
    expect(phaseAt(MINUTE_MS, -SECOND_MS)).toBe('overtime');
    expect(
      timerPhase(deriveTimer(running(MINUTE_MS), 2 * MINUTE_MS), {
        kind: 'percent',
        warningPercent: 100,
        criticalPercent: 100,
      }),
    ).toBe('overtime');
  });

  it('an idle timer is normal', () => {
    const created = createTimer({ mode: 'countdown', durationMs: 30 * SECOND_MS });
    if (!created.ok) throw new Error('setup');
    expect(timerPhase(deriveTimer(created.value, 0))).toBe('normal');
  });

  it('accepts explicit thresholds', () => {
    expect(
      timerPhase(deriveTimer(running(10 * MINUTE_MS), 0), {
        kind: 'percent',
        warningPercent: 100,
        criticalPercent: 0,
      }),
    ).toBe('warning');
  });
});

describe('absolute thresholds', () => {
  const absolute = { kind: 'absolute', warningMs: 5 * MINUTE_MS, criticalMs: MINUTE_MS } as const;
  const phase = (durationMs: number, remainingMs: number) =>
    timerPhase(deriveTimer(running(durationMs), durationMs - remainingMs), absolute);

  it('warning at 05:00 remaining, critical at 01:00 remaining, regardless of duration', () => {
    expect(phase(20 * MINUTE_MS, 5 * MINUTE_MS + 1)).toBe('normal');
    expect(phase(20 * MINUTE_MS, 5 * MINUTE_MS)).toBe('warning');
    expect(phase(20 * MINUTE_MS, MINUTE_MS + 1)).toBe('warning');
    expect(phase(20 * MINUTE_MS, MINUTE_MS)).toBe('critical');
    expect(phase(20 * MINUTE_MS, -1)).toBe('overtime');
  });

  it('a timer shorter than the warning threshold is warning from its start (but idle is normal)', () => {
    expect(phase(3 * MINUTE_MS, 3 * MINUTE_MS)).toBe('warning');
    const idle = createTimer({ mode: 'countdown', durationMs: 3 * MINUTE_MS });
    if (!idle.ok) throw new Error('setup');
    expect(timerPhase(deriveTimer(idle.value, 0), absolute)).toBe('normal');
  });
});
