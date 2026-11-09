/** Small fixed-window limiter for non-HTTP entry points (realtime handshakes). One instance. */
export class FixedWindowLimiter {
  readonly #hits = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    private readonly now: () => number,
  ) {}

  allow(key: string): boolean {
    const t = this.now();
    const entry = this.#hits.get(key);
    if (!entry || entry.resetAt <= t) {
      this.#hits.set(key, { count: 1, resetAt: t + this.windowMs });
      if (this.#hits.size > 10_000) this.#sweep(t);
      return true;
    }
    entry.count += 1;
    return entry.count <= this.max;
  }

  #sweep(t: number): void {
    for (const [key, entry] of this.#hits) if (entry.resetAt <= t) this.#hits.delete(key);
  }
}
