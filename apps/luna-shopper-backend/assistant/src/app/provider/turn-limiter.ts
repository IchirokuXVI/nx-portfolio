/**
 * The two limits that sit in front of the provider (plan 0039, section 9).
 *
 * Both are **per instance and in memory**. Neither survives a restart and neither
 * is shared across replicas, which is a known weakness written down here rather
 * than discovered later: fixing it properly needs storage this plan declines
 * (section 4), and the gateway's own throttler still applies to every call the
 * assistant makes on the caller's behalf.
 */

/**
 * A fixed window count of turns per caller per minute.
 *
 * Fixed window rather than sliding, because the whole point of the thing is to
 * be able to answer "how many seconds until you may try again" with a number the
 * limiter actually knows (rule A5), and a sliding window's answer is a different,
 * more expensive question. The cost is the usual one: a caller may spend two
 * windows' worth across a boundary. At this volume that is not worth a byte of
 * extra code.
 */
export class TurnLimiter {
  private readonly windows = new Map<
    string,
    { count: number; startedAtMs: number }
  >();

  constructor(
    private readonly limit: number,
    private readonly windowMs = 60_000,
    private readonly now: () => number = Date.now
  ) {}

  /**
   * Counts a turn against `key`, and reports how long to wait when it does not
   * fit. `retryAfterSeconds` is always at least 1: a zero would tell a client to
   * retry immediately, which is the behaviour rule A5 exists to prevent.
   */
  take(
    key: string
  ): { allowed: true } | { allowed: false; retryAfterSeconds: number } {
    const nowMs = this.now();
    const window = this.windows.get(key);

    if (!window || nowMs - window.startedAtMs >= this.windowMs) {
      this.windows.set(key, { count: 1, startedAtMs: nowMs });
      this.sweep(nowMs);
      return { allowed: true };
    }

    if (window.count < this.limit) {
      window.count += 1;
      return { allowed: true };
    }

    const remainingMs = this.windowMs - (nowMs - window.startedAtMs);
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil(remainingMs / 1000)),
    };
  }

  /** Seconds until `key`'s current window rolls, for a provider 429 with no hint. */
  secondsUntilWindowRolls(key: string): number | undefined {
    const window = this.windows.get(key);
    if (!window) {
      return undefined;
    }
    const remainingMs = this.windowMs - (this.now() - window.startedAtMs);
    return remainingMs > 0
      ? Math.max(1, Math.ceil(remainingMs / 1000))
      : undefined;
  }

  /**
   * Drops windows that have rolled. Without it the map is an unbounded per user
   * leak in a long lived process, which is the ordinary way an in memory limiter
   * becomes an incident.
   */
  private sweep(nowMs: number): void {
    for (const [key, window] of this.windows) {
      if (nowMs - window.startedAtMs >= this.windowMs) {
        this.windows.delete(key);
      }
    }
  }
}

/**
 * A small gate in front of the provider call, so a burst **queues briefly instead
 * of becoming a burst of 429s** (section 9).
 *
 * Queuing is preferable to failing here, and the plan says why: waiting two
 * seconds is invisible, being told to come back is not.
 */
export class ConcurrencyGate {
  private inFlight = 0;
  private readonly waiting: (() => void)[] = [];

  constructor(private readonly limit: number) {}

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.inFlight >= this.limit) {
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    }
    this.inFlight += 1;
    try {
      return await task();
    } finally {
      this.inFlight -= 1;
      this.waiting.shift()?.();
    }
  }
}
