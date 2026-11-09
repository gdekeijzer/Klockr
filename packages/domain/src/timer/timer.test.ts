import { describe, expect, it } from 'vitest';
import { ManualClock } from '../clock';
import type { Result } from '../result';
import { MINUTE_MS, SECOND_MS } from '../time';
import {
  adjustTimer,
  configureTimer,
  createTimer,
  deriveTimer,
  pauseTimer,
  resumeTimer,
  startTimer,
  stopTimer,
  type TimerError,
  type TimerState,
} from './timer';

function unwrap(result: Result<TimerState, TimerError>): TimerState {
  if (!result.ok) throw new Error(`unexpected error: ${JSON.stringify(result.error)}`);
  return result.value;
}

function countdown(durationMs: number): TimerState {
  return unwrap(createTimer({ mode: 'countdown', durationMs }));
}

function setup(durationMs = 20 * MINUTE_MS) {
  const clock = new ManualClock();
  const timer = countdown(durationMs);
  const view = (state: TimerState) => deriveTimer(state, clock.now());
  return { clock, timer, view };
}

describe('countdown configuration', () => {
  it('creates an idle timer showing the full duration', () => {
    const { timer, view } = setup();
    expect(timer.status).toBe('idle');
    expect(timer.revision).toBe(0);
    expect(view(timer)).toMatchObject({ remainingMs: 20 * MINUTE_MS, displayMs: 20 * MINUTE_MS });
  });

  it.each([0, -1, 1.5, 8 * 24 * 60 * MINUTE_MS])('rejects invalid countdown duration %s', (d) => {
    const result = createTimer({ mode: 'countdown', durationMs: d });
    expect(result.ok).toBe(false);
  });

  it('allows a count-up timer without target duration', () => {
    expect(createTimer({ mode: 'countup', durationMs: 0 }).ok).toBe(true);
  });

  it('can be reconfigured while idle or stopped, not while live', () => {
    const { clock, timer } = setup();
    const reconfigured = unwrap(
      configureTimer(timer, { mode: 'countdown', durationMs: 5 * MINUTE_MS }),
    );
    expect(reconfigured.durationMs).toBe(5 * MINUTE_MS);
    expect(reconfigured.revision).toBe(1);

    const running = unwrap(startTimer(reconfigured, clock.now()));
    expect(configureTimer(running, { mode: 'countdown', durationMs: MINUTE_MS })).toEqual({
      ok: false,
      error: { code: 'invalid_transition', command: 'configure', status: 'running' },
    });

    const stopped = unwrap(stopTimer(running, clock.advance(SECOND_MS)));
    expect(configureTimer(stopped, { mode: 'countup', durationMs: 0 }).ok).toBe(true);
  });
});

describe('start / pause / resume', () => {
  it('derives remaining time from the start timestamp without ticking', () => {
    const { clock, timer, view } = setup();
    const running = unwrap(startTimer(timer, clock.now()));
    expect(running.startedAt).toBe(clock.now());

    clock.advance(90 * SECOND_MS);
    expect(view(running).remainingMs).toBe(18 * MINUTE_MS + 30 * SECOND_MS);
    // The stored state did not change while time passed.
    expect(running.revision).toBe(1);
  });

  it('freezes the value while paused and excludes paused time after resume', () => {
    const { clock, timer, view } = setup();
    let state = unwrap(startTimer(timer, clock.now()));
    clock.advance(60 * SECOND_MS);
    state = unwrap(pauseTimer(state, clock.now()));
    const atPause = view(state).remainingMs;

    clock.advance(5 * MINUTE_MS);
    expect(view(state).remainingMs).toBe(atPause);

    state = unwrap(resumeTimer(state, clock.now()));
    expect(state.pausedTotalMs).toBe(5 * MINUTE_MS);
    clock.advance(30 * SECOND_MS);
    expect(view(state).remainingMs).toBe(18 * MINUTE_MS + 30 * SECOND_MS);
  });

  it('accumulates multiple pause intervals', () => {
    const { clock, timer, view } = setup(10 * MINUTE_MS);
    let state = unwrap(startTimer(timer, clock.now()));
    for (let i = 0; i < 3; i++) {
      clock.advance(MINUTE_MS);
      state = unwrap(pauseTimer(state, clock.now()));
      clock.advance(10 * MINUTE_MS);
      state = unwrap(resumeTimer(state, clock.now()));
    }
    expect(state.pausedTotalMs).toBe(30 * MINUTE_MS);
    expect(view(state).remainingMs).toBe(7 * MINUTE_MS);
  });

  it('rejects repeated or out-of-order commands without changing state', () => {
    const { clock, timer } = setup();
    expect(pauseTimer(timer, clock.now()).ok).toBe(false);
    expect(resumeTimer(timer, clock.now()).ok).toBe(false);

    const running = unwrap(startTimer(timer, clock.now()));
    expect(startTimer(running, clock.now())).toEqual({
      ok: false,
      error: { code: 'invalid_transition', command: 'start', status: 'running' },
    });
    expect(resumeTimer(running, clock.now()).ok).toBe(false);

    const paused = unwrap(pauseTimer(running, clock.now()));
    expect(pauseTimer(paused, clock.now()).ok).toBe(false);
    expect(startTimer(paused, clock.now()).ok).toBe(false);
  });

  it('increments revision on every accepted transition', () => {
    const { clock, timer } = setup();
    let state = unwrap(startTimer(timer, clock.now()));
    state = unwrap(pauseTimer(state, clock.advance(SECOND_MS)));
    state = unwrap(resumeTimer(state, clock.advance(SECOND_MS)));
    state = unwrap(adjustTimer(state, 30 * SECOND_MS, clock.now()));
    state = unwrap(stopTimer(state, clock.advance(SECOND_MS)));
    expect(state.revision).toBe(5);
  });
});

describe('overtime', () => {
  it('runs through zero into overtime on the same timer', () => {
    const { clock, timer, view } = setup(MINUTE_MS);
    const running = unwrap(startTimer(timer, clock.now()));

    clock.advance(59 * SECOND_MS);
    expect(view(running)).toMatchObject({
      remainingMs: SECOND_MS,
      isOvertime: false,
      displayMs: SECOND_MS,
    });

    clock.advance(SECOND_MS);
    expect(view(running)).toMatchObject({ remainingMs: 0, isOvertime: false, displayMs: 0 });

    clock.advance(SECOND_MS);
    expect(view(running)).toMatchObject({
      status: 'running',
      remainingMs: -SECOND_MS,
      isOvertime: true,
      overtimeMs: SECOND_MS,
      displayMs: SECOND_MS,
    });

    clock.advance(2 * MINUTE_MS);
    expect(view(running).overtimeMs).toBe(2 * MINUTE_MS + SECOND_MS);
    expect(running.status).toBe('running');
  });

  it('freezes overtime while paused', () => {
    const { clock, timer, view } = setup(MINUTE_MS);
    let state = unwrap(startTimer(timer, clock.now()));
    clock.advance(90 * SECOND_MS);
    state = unwrap(pauseTimer(state, clock.now()));
    clock.advance(10 * MINUTE_MS);
    expect(view(state)).toMatchObject({
      status: 'paused',
      isOvertime: true,
      overtimeMs: 30 * SECOND_MS,
    });
  });
});

describe('time adjustment', () => {
  it('adds and removes remaining time before zero', () => {
    const { clock, timer, view } = setup(5 * MINUTE_MS);
    let state = unwrap(startTimer(timer, clock.now()));
    state = unwrap(adjustTimer(state, 30 * SECOND_MS, clock.now()));
    expect(view(state).remainingMs).toBe(5 * MINUTE_MS + 30 * SECOND_MS);
    state = unwrap(adjustTimer(state, -MINUTE_MS, clock.now()));
    expect(view(state).remainingMs).toBe(4 * MINUTE_MS + 30 * SECOND_MS);
  });

  it('keeps a pre-start adjustment when the run starts', () => {
    const { clock, timer, view } = setup(5 * MINUTE_MS);
    let state = unwrap(adjustTimer(timer, MINUTE_MS, clock.now()));
    state = unwrap(startTimer(state, clock.now()));
    expect(view(state).remainingMs).toBe(6 * MINUTE_MS);
  });

  it('can push a countdown into overtime with a large negative adjustment', () => {
    const { clock, timer, view } = setup(MINUTE_MS);
    let state = unwrap(startTimer(timer, clock.now()));
    state = unwrap(adjustTimer(state, -90 * SECOND_MS, clock.now()));
    expect(view(state)).toMatchObject({ isOvertime: true, overtimeMs: 30 * SECOND_MS });
  });

  it('handles large adjustments without drift', () => {
    const { clock, timer, view } = setup(MINUTE_MS);
    let state = unwrap(startTimer(timer, clock.now()));
    state = unwrap(adjustTimer(state, 24 * 60 * MINUTE_MS, clock.now()));
    clock.advance(12 * 60 * MINUTE_MS);
    expect(view(state).remainingMs).toBe(12 * 60 * MINUTE_MS + MINUTE_MS);
  });

  it('rejects zero, fractional, out-of-range and stopped-state adjustments', () => {
    const { clock, timer } = setup();
    expect(adjustTimer(timer, 0, clock.now()).ok).toBe(false);
    expect(adjustTimer(timer, 0.5, clock.now()).ok).toBe(false);
    expect(adjustTimer(timer, 8 * 24 * 60 * MINUTE_MS, clock.now()).ok).toBe(false);

    const running = unwrap(startTimer(timer, clock.now()));
    const stopped = unwrap(stopTimer(running, clock.advance(SECOND_MS)));
    expect(adjustTimer(stopped, SECOND_MS, clock.now())).toEqual({
      ok: false,
      error: { code: 'invalid_transition', command: 'adjust', status: 'stopped' },
    });
  });

  it('never lets a count-up timer go below zero elapsed', () => {
    const clock = new ManualClock();
    let state = unwrap(createTimer({ mode: 'countup', durationMs: 0 }));
    state = unwrap(startTimer(state, clock.now()));
    clock.advance(20 * SECOND_MS);
    state = unwrap(adjustTimer(state, -MINUTE_MS, clock.now()));
    expect(deriveTimer(state, clock.now()).elapsedMs).toBe(0);
    clock.advance(5 * SECOND_MS);
    expect(deriveTimer(state, clock.now()).elapsedMs).toBe(5 * SECOND_MS);
    expect(
      adjustTimer(unwrap(createTimer({ mode: 'countup', durationMs: 0 })), -1, clock.now()).ok,
    ).toBe(false);
  });
});

describe('adjustment contract examples (zero boundary may be crossed both ways)', () => {
  /** Start a 1-minute countdown and advance so that the signed remaining time is `remainingMs`. */
  function runningAt(remainingMs: number) {
    const { clock, timer, view } = setup(MINUTE_MS);
    const state = unwrap(startTimer(timer, clock.now()));
    clock.advance(MINUTE_MS - remainingMs);
    return { clock, state, view };
  }

  it('02:00 remaining + 00:30 -> 02:30 remaining', () => {
    const { clock, timer, view } = setup(2 * MINUTE_MS);
    const state = unwrap(
      adjustTimer(unwrap(startTimer(timer, clock.now())), 30 * SECOND_MS, clock.now()),
    );
    expect(view(state)).toMatchObject({
      isOvertime: false,
      remainingMs: 2 * MINUTE_MS + 30 * SECOND_MS,
    });
  });

  it('+00:10 overtime - 00:30 -> 00:20 remaining', () => {
    const { clock, state, view } = runningAt(-10 * SECOND_MS);
    expect(view(state)).toMatchObject({ isOvertime: true, overtimeMs: 10 * SECOND_MS });
    const adjusted = unwrap(adjustTimer(state, -30 * SECOND_MS, clock.now()));
    expect(view(adjusted)).toMatchObject({ isOvertime: false, remainingMs: 20 * SECOND_MS });
  });

  it('+02:14 overtime + 00:30 -> +02:44 overtime', () => {
    const { clock, state, view } = runningAt(-(2 * MINUTE_MS + 14 * SECOND_MS));
    const adjusted = unwrap(adjustTimer(state, 30 * SECOND_MS, clock.now()));
    expect(view(adjusted)).toMatchObject({
      isOvertime: true,
      overtimeMs: 2 * MINUTE_MS + 44 * SECOND_MS,
    });
  });

  it('overtime is derived, never persisted: the stored state has no overtime field', () => {
    const { clock, state } = runningAt(-5 * SECOND_MS);
    const adjusted = unwrap(adjustTimer(state, 30 * SECOND_MS, clock.now()));
    expect(Object.keys(adjusted).sort()).toEqual([
      'adjustmentMs',
      'durationMs',
      'mode',
      'pausedAt',
      'pausedTotalMs',
      'revision',
      'startedAt',
      'status',
      'stoppedAt',
    ]);
  });
});

describe('STOP and RESTART', () => {
  it('stopped -> start restarts from the full configured duration', () => {
    const { clock, timer, view } = setup(10 * MINUTE_MS);
    let state = unwrap(startTimer(timer, clock.now()));
    clock.advance(3 * MINUTE_MS);
    state = unwrap(stopTimer(state, clock.now()));
    expect(state.status).toBe('stopped');

    clock.advance(MINUTE_MS);
    expect(view(state).remainingMs).toBe(7 * MINUTE_MS);

    state = unwrap(startTimer(state, clock.now()));
    expect(state).toMatchObject({ status: 'running', stoppedAt: null, startedAt: clock.now() });
    expect(view(state).remainingMs).toBe(10 * MINUTE_MS);
  });

  it('adjustments from the previous run do not leak into the restarted run', () => {
    const { clock, timer, view } = setup(10 * MINUTE_MS);
    let state = unwrap(adjustTimer(timer, MINUTE_MS, clock.now())); // pre-start adjustment
    state = unwrap(startTimer(state, clock.now()));
    state = unwrap(adjustTimer(state, 2 * MINUTE_MS, clock.now()));
    clock.advance(MINUTE_MS);
    state = unwrap(stopTimer(state, clock.now()));
    expect(view(state).remainingMs).toBe(12 * MINUTE_MS);

    state = unwrap(startTimer(state, clock.now()));
    expect(state.adjustmentMs).toBe(0);
    expect(view(state).remainingMs).toBe(10 * MINUTE_MS);
  });

  it('restart after an overtime run starts cleanly from the full duration', () => {
    const { clock, timer, view } = setup(MINUTE_MS);
    let state = unwrap(startTimer(timer, clock.now()));
    clock.advance(3 * MINUTE_MS);
    state = unwrap(stopTimer(state, clock.now()));
    expect(view(state)).toMatchObject({ isOvertime: true, overtimeMs: 2 * MINUTE_MS });
    state = unwrap(startTimer(state, clock.now()));
    expect(view(state)).toMatchObject({ isOvertime: false, remainingMs: MINUTE_MS });
  });

  it('STOP from paused folds the open pause interval', () => {
    const { clock, timer, view } = setup(10 * MINUTE_MS);
    let state = unwrap(startTimer(timer, clock.now()));
    clock.advance(MINUTE_MS);
    state = unwrap(pauseTimer(state, clock.now()));
    clock.advance(5 * MINUTE_MS);
    const stopped = unwrap(stopTimer(state, clock.now()));
    expect(stopped.pausedTotalMs).toBe(5 * MINUTE_MS);
    expect(view(stopped).remainingMs).toBe(9 * MINUTE_MS);
  });

  it('cannot STOP a timer that never started, nor STOP twice', () => {
    const { clock, timer } = setup();
    expect(stopTimer(timer, clock.now()).ok).toBe(false);
    const stopped = unwrap(stopTimer(unwrap(startTimer(timer, clock.now())), clock.now()));
    expect(stopTimer(stopped, clock.now())).toEqual({
      ok: false,
      error: { code: 'invalid_transition', command: 'stop', status: 'stopped' },
    });
  });

  it('the timer state set is exactly idle | running | paused | stopped', () => {
    const { clock, timer } = setup();
    const seen = new Set<string>([timer.status]);
    let state = unwrap(startTimer(timer, clock.now()));
    seen.add(state.status);
    state = unwrap(pauseTimer(state, clock.advance(SECOND_MS)));
    seen.add(state.status);
    state = unwrap(stopTimer(state, clock.advance(SECOND_MS)));
    seen.add(state.status);
    expect([...seen].sort()).toEqual(['idle', 'paused', 'running', 'stopped']);
  });
});

describe('snapshot derivation and clock skew', () => {
  it('derives the same value from a serialized snapshot at any later instant (reconnect)', () => {
    const { clock, timer } = setup(15 * MINUTE_MS);
    let state = unwrap(startTimer(timer, clock.now()));
    clock.advance(2 * MINUTE_MS);
    state = unwrap(pauseTimer(state, clock.now()));
    clock.advance(MINUTE_MS);
    state = unwrap(resumeTimer(state, clock.now()));

    const snapshot = JSON.parse(JSON.stringify(state)) as TimerState;
    for (const offset of [0, 1, 999, 60 * SECOND_MS, 30 * MINUTE_MS]) {
      const at = clock.now() + offset;
      expect(deriveTimer(snapshot, at)).toEqual(deriveTimer(state, at));
    }
    expect(deriveTimer(snapshot, clock.now() + 13 * MINUTE_MS + SECOND_MS).overtimeMs).toBe(
      SECOND_MS,
    );
  });

  it('never reports negative elapsed time when the observer clock is behind the start', () => {
    const { clock, timer } = setup(MINUTE_MS);
    const running = unwrap(startTimer(timer, clock.now()));
    const view = deriveTimer(running, clock.now() - 5 * SECOND_MS);
    expect(view.elapsedMs).toBe(0);
    expect(view.remainingMs).toBe(MINUTE_MS);
  });

  it('never accumulates negative pause when a resume timestamp precedes the pause', () => {
    const { clock, timer } = setup(MINUTE_MS);
    let state = unwrap(startTimer(timer, clock.now()));
    state = unwrap(pauseTimer(state, clock.advance(10 * SECOND_MS)));
    state = unwrap(resumeTimer(state, clock.now() - SECOND_MS));
    expect(state.pausedTotalMs).toBe(0);
  });

  it('supports multiple independent timers running simultaneously', () => {
    const clock = new ManualClock();
    const a = unwrap(startTimer(countdown(10 * MINUTE_MS), clock.now()));
    clock.advance(MINUTE_MS);
    const b = unwrap(startTimer(countdown(MINUTE_MS), clock.now()));
    clock.advance(2 * MINUTE_MS);
    expect(deriveTimer(a, clock.now()).remainingMs).toBe(7 * MINUTE_MS);
    expect(deriveTimer(b, clock.now())).toMatchObject({ isOvertime: true, overtimeMs: MINUTE_MS });
  });
});
