import type { TimerSnapshot } from '@klockr/contracts';

/**
 * Accept an authoritative timer snapshot only if it is not older than what we have.
 * Newest revision wins; an equal revision (e.g. a reconnect snapshot) is accepted so the latest
 * `serverTime` is kept. Stale or out-of-order updates are dropped.
 */
export function acceptTimer(current: TimerSnapshot | null, incoming: TimerSnapshot): TimerSnapshot {
  if (!current) return incoming;
  if (incoming.queueItemId !== current.queueItemId) return incoming;
  return incoming.revision >= current.revision ? incoming : current;
}

/**
 * Server-clock offset estimate from clock pings (NTP-style midpoint). Keeps the sample with the
 * lowest round trip from a small window, and only moves the applied offset when the change is
 * larger than `hysteresisMs`, so network jitter never makes a visible timer jump.
 */
export class ClockOffsetEstimator {
  #samples: { offsetMs: number; rttMs: number }[] = [];
  #applied: number | null = null;

  constructor(
    private readonly windowSize = 5,
    private readonly hysteresisMs = 150,
  ) {}

  /** `sentAt`/`receivedAt` are local times around the ping; `serverTime` is the ack value. */
  addSample(sentAt: number, serverTime: number, receivedAt: number): number {
    const rttMs = Math.max(0, receivedAt - sentAt);
    const offsetMs = serverTime - (sentAt + receivedAt) / 2;
    this.#samples = [...this.#samples, { offsetMs, rttMs }].slice(-this.windowSize);
    const best = this.#samples.reduce((a, b) => (b.rttMs < a.rttMs ? b : a));
    if (this.#applied === null || Math.abs(best.offsetMs - this.#applied) > this.hysteresisMs) {
      this.#applied = best.offsetMs;
    }
    return this.#applied;
  }

  /** Coarse fallback before any ping completed: use a snapshot's serverTime once. */
  seedFromServerTime(serverTime: number, receivedAt: number): number {
    this.#applied ??= serverTime - receivedAt;
    return this.#applied;
  }

  get offsetMs(): number {
    return this.#applied ?? 0;
  }
}
