import type { HarvestRun } from '../entities';
import { TokenBucket } from '../runner/token-bucket';
import type { HarvestRunStore } from './harvest-run.store';
import { RunContext } from './run-context';

const RUN = '33333333-3333-4333-8333-333333333333';

function build() {
  const store = {
    setStage: jest.fn(async () => undefined),
    setTotalPlanned: jest.fn(async () => undefined),
    setReport: jest.fn(async () => undefined),
    addCounters: jest.fn(async () => undefined),
    addWarnings: jest.fn(async () => undefined),
    touchHeartbeat: jest.fn(async () => undefined),
  };
  let now = 0;
  const context = new RunContext(
    { id: RUN } as HarvestRun,
    new AbortController().signal,
    new TokenBucket({ ratePerSecond: 1000 }),
    store as unknown as HarvestRunStore,
    () => now
  );
  return {
    store,
    context,
    tick: (ms: number) => {
      now += ms;
    },
  };
}

/**
 * The liveness half of the progress contract (plan 0038, section 6.6).
 *
 * A runner in a long fetch loop calls {@link RunContext.heartbeat} on every row
 * it sees, and the context turns that stream into one write per interval. The
 * stale reaper compares heartbeats, so a stage that counts nothing while it is
 * healthy, which is what DEZA's enumeration and Mercadona's tree walk are, must
 * still have something moving the timestamp, or a working run is reaped as
 * STALE and its lock released under it.
 */
describe('RunContext.heartbeat', () => {
  it('writes once per interval, however often it is called', async () => {
    const { store, context, tick } = build();

    await context.heartbeat();
    expect(store.touchHeartbeat).not.toHaveBeenCalled();

    tick(10_000);
    await context.heartbeat();
    expect(store.touchHeartbeat).toHaveBeenCalledTimes(1);

    await context.heartbeat();
    await context.heartbeat();
    expect(store.touchHeartbeat).toHaveBeenCalledTimes(1);

    tick(10_000);
    await context.heartbeat();
    expect(store.touchHeartbeat).toHaveBeenCalledTimes(2);
  });

  it('flushes accumulated counters instead of only touching', async () => {
    const { store, context, tick } = build();
    await context.report({ failed: 1 });

    tick(10_000);
    await context.heartbeat();

    // One statement writes the counters and the heartbeat together, exactly as
    // a flush from `report` would; a separate touch would be a second write.
    expect(store.addCounters).toHaveBeenCalledWith(
      RUN,
      expect.objectContaining({ failed: 1 })
    );
    expect(store.touchHeartbeat).not.toHaveBeenCalled();
  });
});

/**
 * One unit of progress for each run (plan 0217, section 4).
 *
 * The ingest and the sink count `processed` through `advance`. A runner whose
 * plan is in a unit of its own calls `countProgressItself`, and then only its
 * own `report({ processed })` moves the count, so the bar means one thing.
 */
describe('RunContext.advance', () => {
  const processedIn = (store: ReturnType<typeof build>['store']) =>
    (store.addCounters.mock.calls as unknown[][]).reduce(
      (sum, call) =>
        sum + ((call[1] as Record<string, number>)['processed'] ?? 0),
      0
    );

  it('adds to processed', async () => {
    const { store, context } = build();

    await context.advance(3);
    await context.advance(2);
    await context.flush();

    expect(processedIn(store)).toBe(5);
  });

  it('adds nothing after countProgressItself, while report still adds', async () => {
    const { store, context } = build();
    context.countProgressItself();

    await context.advance(45);
    await context.report({ processed: 1, failed: 1 });
    await context.flush();

    expect(processedIn(store)).toBe(1);
    expect(store.addCounters).toHaveBeenCalledWith(
      RUN,
      expect.objectContaining({ processed: 1, failed: 1 })
    );
  });

  it('flushes on the 10 second throttle, as report does', async () => {
    const { store, context, tick } = build();

    await context.advance(1);
    expect(store.addCounters).not.toHaveBeenCalled();

    tick(10_000);
    await context.advance(1);
    expect(store.addCounters).toHaveBeenCalledTimes(1);
    expect(processedIn(store)).toBe(2);

    await context.advance(1);
    expect(store.addCounters).toHaveBeenCalledTimes(1);
  });

  it('still keeps the heartbeat on the throttle after countProgressItself', async () => {
    const { store, context, tick } = build();
    context.countProgressItself();

    tick(10_000);
    await context.advance(5);

    // Nothing to count, so the flush is a touch and no counter write.
    expect(store.addCounters).not.toHaveBeenCalled();
    expect(store.touchHeartbeat).toHaveBeenCalledTimes(1);
  });
});
