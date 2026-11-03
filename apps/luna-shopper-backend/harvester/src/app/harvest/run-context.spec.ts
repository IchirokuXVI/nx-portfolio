import { HarvestWarningCode } from '@portfolio/luna-shopper/contracts';
import { SourceBlockedError } from '@portfolio/luna-shopper/source-guard';
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

/**
 * The run's one refusal guard, as the context wires it (plan 0215, section
 * 5). The pause here is 60 ms of real time, so no fake timer is involved.
 */
describe('RunContext.guardWith', () => {
  const POLICY = {
    consecutive: 2,
    window: null,
    coolDowns: 1 as const,
    coolDownMs: 60,
    probes: 1,
  };
  const settle = (): Promise<void> =>
    new Promise((resolve) => setImmediate(resolve));

  it('holds every acquire through a pause, says so, and puts the stage back on resume', async () => {
    const { store, context, tick } = build();
    const onStop = jest.fn();
    const guard = context.guardWith(POLICY, onStop);
    expect(context.guard).toBe(guard);
    await context.setStage('DETAIL', 'Fetching detail for 40 product(s)');

    expect(guard.refused(403, 'https://shop.test/p/1')).toBe('fail');
    expect(guard.refused(403, 'https://shop.test/p/2')).toBe('retry');
    await settle();

    expect(store.setStage).toHaveBeenLastCalledWith(
      RUN,
      'PAUSED',
      'The chain refused 2 requests in a row. Waiting 0 minutes before trying one more.'
    );
    expect(store.addWarnings).toHaveBeenCalledWith(RUN, [
      expect.objectContaining({ code: HarvestWarningCode.SOURCE_PAUSED }),
    ]);

    let admitted = false;
    const waiting = context.acquire().then(() => {
      admitted = true;
    });
    await settle();
    expect(admitted).toBe(false);

    // The pause keeps the heartbeat moving while it lasts.
    tick(10_000);
    await waiting;
    expect(store.touchHeartbeat).toHaveBeenCalled();

    // The probe was answered: the stage the runner set comes back.
    guard.answered();
    await settle();
    expect(store.setStage).toHaveBeenLastCalledWith(
      RUN,
      'DETAIL',
      'Fetching detail for 40 product(s)'
    );
    expect(store.addWarnings).toHaveBeenLastCalledWith(RUN, [
      expect.objectContaining({ code: HarvestWarningCode.SOURCE_RESUMED }),
    ]);
    expect(onStop).not.toHaveBeenCalled();
  });

  it('holds a worker that was waiting in the bucket when the guard tripped', async () => {
    const store = build().store;
    // A bucket of one token a second, on a clock the spec moves, whose wait
    // the spec ends by hand.
    let clock = 0;
    let refill: () => void = () => undefined;
    const bucket = new TokenBucket({
      ratePerSecond: 1,
      burst: 1,
      now: () => clock,
      sleep: () =>
        new Promise<void>((resolve) => {
          refill = resolve;
        }),
    });
    const context = new RunContext(
      { id: RUN } as HarvestRun,
      new AbortController().signal,
      bucket,
      store as unknown as HarvestRunStore
    );
    const guard = context.guardWith(POLICY, jest.fn());

    await context.acquire();
    let sent = false;
    const waiting = context.acquire().then(() => {
      sent = true;
    });
    await settle();
    expect(sent).toBe(false);

    // The trip comes while the second worker waits for its token.
    expect(guard.refused(403, 'https://shop.test/p/1')).toBe('fail');
    expect(guard.refused(403, 'https://shop.test/p/2')).toBe('retry');

    // Its token arrives during the pause, and it is held at the gate.
    clock += 1_000;
    refill();
    await settle();
    expect(sent).toBe(false);

    // The 60 ms pause ends, and it goes out as the one probe.
    await waiting;
    expect(sent).toBe(true);
    expect(guard.summary().paused).not.toBeNull();
  });

  it('writes no pause for a trip that stops the run, and hands the stop on', async () => {
    const { store, context } = build();
    const onStop = jest.fn();
    const guard = context.guardWith(
      { ...POLICY, coolDowns: 0, consecutive: 1 },
      onStop
    );

    expect(() => guard.refused(403, 'https://shop.test/p/1')).toThrow(
      SourceBlockedError
    );
    await settle();

    expect(onStop).toHaveBeenCalledTimes(1);
    expect(store.setStage).not.toHaveBeenCalled();
    await expect(context.acquire()).rejects.toBeInstanceOf(SourceBlockedError);
  });
});
