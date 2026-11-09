import { err, ok, type Result } from '../result';
import type { DurationMs, EpochMs } from '../time';

/**
 * Timer runtime state for one Queue Item timer capability.
 *
 * Only transitions and timestamps are stored. The visible value is always derived with
 * {@link deriveTimer}; nothing in this model ticks. Overtime is a derived condition of a
 * running countdown, not a separate status (see docs/TIMER_ENGINE.md, ADR-0003).
 *
 * The timer has pure timer states only. Ending a Queue Item (END / NEXT) is a Queue Item /
 * show-control concern that also exists for items without a timer; it is deliberately not
 * modelled here and arrives with Queue Items. STOP is the only way to halt a timer.
 */
export type TimerMode = 'countdown' | 'countup';

export type TimerStatus = 'idle' | 'running' | 'paused' | 'stopped';

export interface TimerState {
  readonly mode: TimerMode;
  readonly status: TimerStatus;
  /** Configured nominal duration. For count-up it is the target used for reference only. */
  readonly durationMs: DurationMs;
  /**
   * Accumulated operator adjustments, expressed on the underlying timeline:
   * countdown: added to the remaining time; count-up: added to the elapsed time.
   */
  readonly adjustmentMs: DurationMs;
  readonly startedAt: EpochMs | null;
  /** Set while paused. */
  readonly pausedAt: EpochMs | null;
  /** Total paused time folded in at each RESUME/STOP. */
  readonly pausedTotalMs: DurationMs;
  readonly stoppedAt: EpochMs | null;
  /** Monotonic per-timer revision; increments on every accepted transition. */
  readonly revision: number;
}

export interface TimerConfig {
  readonly mode: TimerMode;
  readonly durationMs: DurationMs;
}

export type TimerCommandName = 'configure' | 'start' | 'pause' | 'resume' | 'stop' | 'adjust';

export type TimerError =
  | {
      readonly code: 'invalid_transition';
      readonly command: TimerCommandName;
      readonly status: TimerStatus;
    }
  | { readonly code: 'invalid_config'; readonly reason: string }
  | { readonly code: 'invalid_adjustment'; readonly reason: string };

export type TimerResult = Result<TimerState, TimerError>;

/** Upper bound for a configured duration (7 days) to keep arithmetic and UI sane. */
export const MAX_TIMER_DURATION_MS: DurationMs = 7 * 24 * 60 * 60 * 1_000;

function validateConfig(config: TimerConfig): TimerError | null {
  if (!Number.isInteger(config.durationMs)) {
    return { code: 'invalid_config', reason: 'durationMs must be an integer' };
  }
  if (config.durationMs < 0 || config.durationMs > MAX_TIMER_DURATION_MS) {
    return { code: 'invalid_config', reason: 'durationMs out of range' };
  }
  if (config.mode === 'countdown' && config.durationMs === 0) {
    return { code: 'invalid_config', reason: 'countdown requires a positive duration' };
  }
  return null;
}

/** Create an idle timer. Fails on invalid configuration. */
export function createTimer(config: TimerConfig): TimerResult {
  const invalid = validateConfig(config);
  if (invalid) return err(invalid);
  return ok({
    mode: config.mode,
    status: 'idle',
    durationMs: config.durationMs,
    adjustmentMs: 0,
    startedAt: null,
    pausedAt: null,
    pausedTotalMs: 0,
    stoppedAt: null,
    revision: 0,
  });
}

function reject(command: TimerCommandName, state: TimerState): TimerResult {
  return err({ code: 'invalid_transition', command, status: state.status });
}

function next(state: TimerState, patch: Partial<TimerState>): TimerResult {
  return ok({ ...state, ...patch, revision: state.revision + 1 });
}

/** Paused time accumulated so far, including an open pause interval up to `now`. */
function foldPause(state: TimerState, now: EpochMs): DurationMs {
  if (state.pausedAt === null) return state.pausedTotalMs;
  return state.pausedTotalMs + Math.max(0, now - state.pausedAt);
}

/** Change mode/duration. Only allowed while the timer is not live. Resets adjustments. */
export function configureTimer(state: TimerState, config: TimerConfig): TimerResult {
  if (state.status !== 'idle' && state.status !== 'stopped') return reject('configure', state);
  const invalid = validateConfig(config);
  if (invalid) return err(invalid);
  return next(state, {
    mode: config.mode,
    durationMs: config.durationMs,
    status: 'idle',
    adjustmentMs: 0,
    startedAt: null,
    pausedAt: null,
    pausedTotalMs: 0,
    stoppedAt: null,
  });
}

/**
 * START. From `idle` the run begins with any pre-start adjustment kept.
 * From `stopped` this is functionally a RESTART: a fresh run from the full configured duration.
 * Adjustments from the previous run never carry over (no configuration exists that keeps them).
 * UIs should label this action RESTART while the timer is stopped.
 */
export function startTimer(state: TimerState, now: EpochMs): TimerResult {
  if (state.status !== 'idle' && state.status !== 'stopped') return reject('start', state);
  return next(state, {
    status: 'running',
    adjustmentMs: state.status === 'stopped' ? 0 : state.adjustmentMs,
    startedAt: now,
    pausedAt: null,
    pausedTotalMs: 0,
    stoppedAt: null,
  });
}

export function pauseTimer(state: TimerState, now: EpochMs): TimerResult {
  if (state.status !== 'running') return reject('pause', state);
  return next(state, { status: 'paused', pausedAt: now });
}

export function resumeTimer(state: TimerState, now: EpochMs): TimerResult {
  if (state.status !== 'paused') return reject('resume', state);
  return next(state, { status: 'running', pausedAt: null, pausedTotalMs: foldPause(state, now) });
}

/**
 * STOP affects only this timer: it triggers no next-item behaviour and no end actions, and is
 * never an alias for Queue Item END. A stopped timer can be restarted with START.
 */
export function stopTimer(state: TimerState, now: EpochMs): TimerResult {
  if (state.status !== 'running' && state.status !== 'paused') return reject('stop', state);
  return next(state, {
    status: 'stopped',
    pausedAt: null,
    pausedTotalMs: foldPause(state, now),
    stoppedAt: now,
  });
}

/**
 * Adjust the timer by `deltaMs` as seen on the displayed value.
 *
 * - Countdown before/at zero: the remaining time changes by `deltaMs` (+30 at 05:00 -> 05:30).
 * - Countdown in overtime: the displayed overtime changes by `deltaMs` (+30 at +02:14 -> +02:44).
 *   This is the accepted product decision (docs/TIMER_ENGINE.md, OPEN_QUESTIONS #3).
 *   The math is continuous: -30 at +00:10 yields 00:20 remaining.
 * - Count-up: the elapsed time changes by `deltaMs`, never below zero.
 */
export function adjustTimer(state: TimerState, deltaMs: DurationMs, now: EpochMs): TimerResult {
  if (state.status !== 'idle' && state.status !== 'running' && state.status !== 'paused') {
    return reject('adjust', state);
  }
  if (!Number.isInteger(deltaMs) || deltaMs === 0) {
    return err({ code: 'invalid_adjustment', reason: 'deltaMs must be a non-zero integer' });
  }
  if (Math.abs(deltaMs) > MAX_TIMER_DURATION_MS) {
    return err({ code: 'invalid_adjustment', reason: 'deltaMs out of range' });
  }

  const view = deriveTimer(state, now);
  let applied: DurationMs;
  if (state.mode === 'countup') {
    applied = Math.max(deltaMs, -view.elapsedMs);
  } else {
    applied = view.isOvertime ? -deltaMs : deltaMs;
  }
  if (applied === 0) {
    return err({ code: 'invalid_adjustment', reason: 'count-up elapsed time is already zero' });
  }
  return next(state, { adjustmentMs: state.adjustmentMs + applied });
}

export interface TimerView {
  readonly mode: TimerMode;
  readonly status: TimerStatus;
  /** The originally configured duration (adjustments excluded); basis for percentage thresholds. */
  readonly durationMs: DurationMs;
  /** Effective run time on the timer timeline (pause excluded, adjustments included for count-up). */
  readonly elapsedMs: DurationMs;
  /** Countdown only: signed remaining time; negative means overtime. Null for count-up. */
  readonly remainingMs: DurationMs | null;
  /** Countdown only: true when remaining time has crossed below zero. */
  readonly isOvertime: boolean;
  /** Countdown only: magnitude past zero; 0 when not in overtime. */
  readonly overtimeMs: DurationMs;
  /** The value a display shows, as an unsigned magnitude (remaining, overtime or elapsed). */
  readonly displayMs: DurationMs;
}

/**
 * Pure projection of a timer at instant `at`. Server, Boards and tests all use this.
 * Clock skew safety: an instant before the run started never yields negative elapsed time.
 */
export function deriveTimer(state: TimerState, at: EpochMs): TimerView {
  const runMs = runningTimeMs(state, at);

  if (state.mode === 'countup') {
    const elapsedMs = Math.max(0, runMs + state.adjustmentMs);
    return {
      mode: state.mode,
      status: state.status,
      durationMs: state.durationMs,
      elapsedMs,
      remainingMs: null,
      isOvertime: false,
      overtimeMs: 0,
      displayMs: elapsedMs,
    };
  }

  const remainingMs = state.durationMs + state.adjustmentMs - runMs;
  const isOvertime = remainingMs < 0;
  const overtimeMs = isOvertime ? -remainingMs : 0;
  return {
    mode: state.mode,
    status: state.status,
    durationMs: state.durationMs,
    elapsedMs: runMs,
    remainingMs,
    isOvertime,
    overtimeMs,
    displayMs: isOvertime ? overtimeMs : remainingMs,
  };
}

function runningTimeMs(state: TimerState, at: EpochMs): DurationMs {
  if (state.startedAt === null) return 0;
  let reference: EpochMs;
  switch (state.status) {
    case 'paused':
      reference = state.pausedAt ?? at;
      break;
    case 'stopped':
      reference = state.stoppedAt ?? at;
      break;
    case 'idle':
    case 'running':
      reference = at;
      break;
  }
  return Math.max(0, reference - state.startedAt - state.pausedTotalMs);
}
