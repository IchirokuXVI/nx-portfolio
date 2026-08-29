import { TokenBucket } from './token-bucket';
import { runWorkerPool } from './worker-pool';

/**
 * The tests parallelism actually needs (plan 0038, section 9). All deterministic:
 * the "server" is a local function with a fixed delay and an injected clock, so
 * nothing here touches the network or a real timer's whims.
 */

/** A stub source: records what was asked for, and takes `latencyMs` to answer. */
function stubSource(latencyMs = 0) {
  const requested: string[] = [];
  const fetchOne = async (id: string): Promise<void> => {
    requested.push(id);
    if (latencyMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, latencyMs));
    }
  };
  return { requested, fetchOne };
}

const ids = (n: number) => Array.from({ length: n }, (_, i) => `p${i}`);

describe('runWorkerPool', () => {
  // The count alone is not enough: a double fetch and a miss cancel out in a
  // count, so the assertion is on the multiset of requested ids.
  it.each([1, 2, 4, 8, 16])(
    'fetches every queued item exactly once at %i workers',
    async (workers) => {
      const source = stubSource();
      const items = ids(200);

      const result = await runWorkerPool({
        items,
        workers,
        handle: (id) => source.fetchOne(id),
      });

      expect(result).toMatchObject({ processed: 200, failed: 0 });
      expect(source.requested).toHaveLength(200);
      expect(new Set(source.requested).size).toBe(200);
      expect([...source.requested].sort()).toEqual([...items].sort());
    }
  );

  it('keeps draining when a worker throws, and finishes the run', async () => {
    // A per item failure is counted and logged, and the worker takes the next
    // item. A run fails only when the source is unusable.
    const seen: string[] = [];
    const errors: string[] = [];
    const result = await runWorkerPool({
      items: ids(50),
      workers: 4,
      handle: async (id) => {
        if (id === 'p7' || id === 'p23') {
          throw new Error(`boom ${id}`);
        }
        seen.push(id);
      },
      onError: (_error, id) => {
        errors.push(id);
      },
    });

    expect(result).toMatchObject({ processed: 48, failed: 2 });
    expect(errors.sort()).toEqual(['p23', 'p7']);
    expect(seen).toHaveLength(48);
  });

  it('stops taking new work once the run is aborted', async () => {
    const controller = new AbortController();
    const source = stubSource();
    const result = await runWorkerPool({
      items: ids(100),
      workers: 2,
      signal: controller.signal,
      handle: async (id, index) => {
        await source.fetchOne(id);
        if (index === 4) {
          controller.abort();
        }
      },
    });

    expect(result.aborted).toBe(true);
    // Everything fetched before the abort is kept: prices already fetched are
    // valid data, which is why abort flushes rather than discards.
    expect(source.requested.length).toBeGreaterThan(0);
    expect(source.requested.length).toBeLessThan(100);
  });

  it('runs a single worker strictly in order', async () => {
    const source = stubSource();
    await runWorkerPool({
      items: ids(20),
      workers: 1,
      handle: (id) => source.fetchOne(id),
    });
    expect(source.requested).toEqual(ids(20));
  });
});

describe('TokenBucket', () => {
  /** A controllable clock, so rate assertions are exact rather than flaky. */
  function fakeClock() {
    let now = 0;
    return {
      now: () => now,
      sleep: async (ms: number) => {
        now += ms;
      },
      advance: (ms: number) => {
        now += ms;
      },
    };
  }

  it('holds the configured rate no matter how many workers run', async () => {
    // This is the bug section 6.3 names: four workers each pausing 250 ms is
    // sixteen requests per second, not four. One shared bucket is what makes the
    // number the owner set the number the source sees.
    for (const workers of [1, 4, 16, 32]) {
      const clock = fakeClock();
      const bucket = new TokenBucket({
        ratePerSecond: 4,
        burst: 1,
        now: clock.now,
        sleep: clock.sleep,
      });
      const times: number[] = [];

      await runWorkerPool({
        items: ids(40),
        workers,
        handle: async () => {
          await bucket.acquire();
          times.push(clock.now());
        },
      });

      expect(times).toHaveLength(40);
      const elapsedSeconds = (times[times.length - 1] - times[0]) / 1000;
      const observedRate = (times.length - 1) / elapsedSeconds;
      // At or under the configured rate, at every worker count.
      expect(observedRate).toBeLessThanOrEqual(4.001);
    }
  });

  it('lets an initial burst through, then settles to the rate', async () => {
    const clock = fakeClock();
    const bucket = new TokenBucket({
      ratePerSecond: 4,
      burst: 4,
      now: clock.now,
      sleep: clock.sleep,
    });

    // The bucket starts full, so the first four cost nothing.
    for (let i = 0; i < 4; i += 1) {
      await bucket.acquire();
    }
    expect(clock.now()).toBe(0);

    // The fifth waits for a token to be minted.
    await bucket.acquire();
    expect(clock.now()).toBeGreaterThan(0);
  });

  it('refills over real elapsed time rather than per call', async () => {
    const clock = fakeClock();
    const bucket = new TokenBucket({
      ratePerSecond: 2,
      burst: 2,
      now: clock.now,
      sleep: clock.sleep,
    });
    await bucket.acquire();
    await bucket.acquire();

    // A run that idles for a second has earned its tokens back.
    clock.advance(1000);
    await bucket.acquire();
    await bucket.acquire();
    expect(clock.now()).toBe(1000);
  });

  it('serializes concurrent acquires so two callers cannot take one token', async () => {
    // Without the internal queue the bucket leaks `workers - 1` requests per
    // refill: every concurrent caller reads the same token count and each takes
    // it. Invisible at four workers, obvious at thirty two.
    const clock = fakeClock();
    const bucket = new TokenBucket({
      ratePerSecond: 1,
      burst: 1,
      now: clock.now,
      sleep: clock.sleep,
    });
    const stamps: number[] = [];
    await Promise.all(
      Array.from({ length: 5 }, async () => {
        await bucket.acquire();
        stamps.push(clock.now());
      })
    );
    expect(stamps).toHaveLength(5);
    expect(new Set(stamps).size).toBe(5);
  });

  it('refuses a rate that would mean no requests at all', async () => {
    expect(() => new TokenBucket({ ratePerSecond: 0 })).toThrow(/positive rate/);
  });
});
