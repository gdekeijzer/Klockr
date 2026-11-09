import type { TimerSnapshot } from '@klockr/contracts';
import { deriveTimer } from '@klockr/domain';
import { describe, expect, it } from 'vitest';
import { acceptTimer, ClockOffsetEstimator } from './timer-sync';

const base: TimerSnapshot = {
  queueItemId: '7c1e2d3f-5a6b-4c7d-8e9f-0a1b2c3d4e5f',
  mode: 'countdown',
  status: 'running',
  durationMs: 600_000,
  adjustmentMs: 0,
  startedAt: 1_000_000,
  pausedAt: null,
  pausedTotalMs: 0,
  stoppedAt: null,
  revision: 3,
  serverTime: 1_000_500,
};

describe('acceptTimer', () => {
  it('newest revision wins and stale updates are ignored', () => {
    const newer = { ...base, revision: 4, status: 'paused' as const, pausedAt: 1_010_000 };
    expect(acceptTimer(base, newer)).toBe(newer);
    expect(acceptTimer(newer, base)).toBe(newer);
  });

  it('accepts an equal revision (reconnect snapshot) and a first snapshot', () => {
    const again = { ...base, serverTime: 1_090_000 };
    expect(acceptTimer(base, again)).toBe(again);
    expect(acceptTimer(null, base)).toBe(base);
  });
});

describe('offline projection', () => {
  it('keeps deriving the running timer from the last authoritative snapshot', () => {
    // Connection lost right after receiving `base`; five seconds later the board still renders.
    const at = 1_000_000 + 65_000;
    expect(deriveTimer(base, at).remainingMs).toBe(535_000);
  });

  it('a reconnect snapshot with an unchanged revision produces no jump', () => {
    const at = 1_070_000;
    const after = acceptTimer(base, { ...base, serverTime: at });
    expect(deriveTimer(after, at).remainingMs).toBe(deriveTimer(base, at).remainingMs);
  });
});

describe('ClockOffsetEstimator', () => {
  it('computes the midpoint offset and prefers the lowest round trip', () => {
    const c = new ClockOffsetEstimator();
    expect(c.addSample(1000, 6050, 1100)).toBe(5000);
    // Slow sample with a skewed estimate is ignored in favour of the fast one.
    expect(c.addSample(2000, 7600, 2800)).toBe(5000);
  });

  it('ignores jitter below the hysteresis and follows real drift', () => {
    const c = new ClockOffsetEstimator(5, 150);
    c.addSample(0, 5050, 100);
    expect(c.addSample(1000, 6150, 1100)).toBe(5000); // +100 ms: jitter, ignored
    const d = new ClockOffsetEstimator(1, 150);
    d.addSample(0, 5050, 100);
    expect(d.addSample(1000, 6550, 1100)).toBe(5500); // +500 ms: real drift, applied
  });

  it('seeds once from a snapshot before any ping', () => {
    const c = new ClockOffsetEstimator();
    expect(c.seedFromServerTime(10_000, 9_000)).toBe(1_000);
    expect(c.seedFromServerTime(20_000, 9_000)).toBe(1_000);
  });
});
