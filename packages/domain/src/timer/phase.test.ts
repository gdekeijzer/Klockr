import { describe, expect, it } from 'vitest';
import { MINUTE_MS, SECOND_MS } from '../time';
import { timerPhase } from './phase';
import { createTimer, deriveTimer, startTimer, type TimerState } from './timer';

function running(durationMs: number): TimerState {
  const created = createTimer({ mode: 'countdown', durationMs });
  if (!created.ok) throw new Error('setup');
  const started = startTimer(created.value, 0);
  if (!started.ok) throw new Error('setup');
  return started.value;
}

describe('timerPhase (provisional defaults: warning 05:00, critical 01:00)', () => {
  const state = running(10 * MINUTE_MS);
  it.each([
    [0, 'normal'],
    [5 * MINUTE_MS - 1, 'normal'],
    [5 * MINUTE_MS, 'warning'],
    [9 * MINUTE_MS - 1, 'warning'],
    [9 * MINUTE_MS, 'critical'],
    [10 * MINUTE_MS, 'critical'],
    [10 * MINUTE_MS + SECOND_MS, 'overtime'],
  ])('at %i ms elapsed the phase is %s', (at, phase) => {
    expect(timerPhase(deriveTimer(state, at))).toBe(phase);
  });

  it('an idle timer is normal even when its duration is below the thresholds', () => {
    const created = createTimer({ mode: 'countdown', durationMs: 30 * SECOND_MS });
    if (!created.ok) throw new Error('setup');
    expect(timerPhase(deriveTimer(created.value, 0))).toBe('normal');
  });

  it('accepts explicit thresholds', () => {
    expect(timerPhase(deriveTimer(state, 0), { warningMs: 10 * MINUTE_MS, criticalMs: 0 })).toBe(
      'warning',
    );
  });
});
