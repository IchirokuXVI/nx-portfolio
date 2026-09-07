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
