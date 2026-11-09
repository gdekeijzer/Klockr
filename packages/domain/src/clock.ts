import type { DurationMs, EpochMs } from './time';

/** Source of the current instant. Inject this everywhere time matters. */
export interface Clock {
  now(): EpochMs;
}

/** Production clock backed by the host system time (expected to be NTP-synchronised). */
export const systemClock: Clock = {
  now: () => Date.now(),
};

/**
 * Deterministic clock for tests and simulations. Time only moves when told to.
 * Never use sleeps in tests; advance this clock instead.
 */
export class ManualClock implements Clock {
  #now: EpochMs;

  constructor(start: EpochMs = Date.UTC(2026, 0, 1, 9, 0, 0)) {
    this.#now = start;
  }

  now(): EpochMs {
    return this.#now;
  }

  advance(ms: DurationMs): EpochMs {
    this.#now += ms;
    return this.#now;
  }

  set(instant: EpochMs): void {
    this.#now = instant;
  }
}
