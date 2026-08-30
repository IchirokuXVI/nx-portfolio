/**
 * One token bucket per run, shared by every worker (plan 0038, section 6.3).
 *
 * **This is the piece that makes the politeness number honest.** A single per
 * worker delay is a bug at any concurrency above one: four workers each pausing
 * 250 ms between requests is sixteen requests per second, not four, and the
 * number the owner configured is not the number the source sees. So the rate
 * lives in one object that every worker blocks on, and concurrency exists to
 * absorb latency rather than to raise the rate.
 *
 * Effective throughput is `min(maxRequestsPerSecond, workers / latency)`. At the
 * 0.15 s latency measured against the live API, four workers could sustain 26
 * req/s, so at the default 4 req/s the bucket is what binds. That is the intended
 * relationship, not an accident of the numbers.
 */
export interface TokenBucketOptions {
  /** Sustained rate. Must be positive. */
  ratePerSecond: number;
  /**
   * How many requests may go out back to back after an idle period. Defaults to
   * one second's worth, which keeps a burst inside the sustained rate over any
   * window longer than a second.
   */
  burst?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export class TokenBucket {
  private tokens: number;
  private lastRefillAt: number;
  private readonly capacity: number;
  private readonly ratePerSecond: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  /**
   * Serializes `acquire` so concurrent callers cannot each read the same token
   * count and both take it. Without this the bucket leaks exactly `workers - 1`
   * requests per refill, which is invisible at four workers and obvious at
   * thirty two, and which is the whole failure this class exists to prevent.
   */
  private queue: Promise<void> = Promise.resolve();

  constructor(options: TokenBucketOptions) {
    if (!(options.ratePerSecond > 0)) {
      throw new Error(
        `A token bucket needs a positive rate; got ${options.ratePerSecond}`
      );
    }
    this.ratePerSecond = options.ratePerSecond;
    this.capacity = Math.max(1, options.burst ?? Math.ceil(options.ratePerSecond));
    this.tokens = this.capacity;
    this.now = options.now ?? (() => Date.now());
    this.sleep = options.sleep ?? defaultSleep;
    this.lastRefillAt = this.now();
  }

  /** Take one token, waiting for it if the bucket is empty. */
  acquire(): Promise<void> {
    const next = this.queue.then(() => this.take());
    // Swallow here only so one caller's rejection does not poison the chain for
    // every caller after it; the rejection still reaches its own awaiter.
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async take(): Promise<void> {
    for (;;) {
      this.refill();
      if (this.tokens >= 1) {
        this.tokens -= 1;
        return;
      }
      const deficit = 1 - this.tokens;
      await this.sleep(Math.ceil((deficit / this.ratePerSecond) * 1000));
    }
  }

  private refill(): void {
    const now = this.now();
    const elapsedMs = now - this.lastRefillAt;
    if (elapsedMs <= 0) {
      return;
    }
    this.lastRefillAt = now;
    this.tokens = Math.min(
      this.capacity,
      this.tokens + (elapsedMs / 1000) * this.ratePerSecond
    );
  }
}
