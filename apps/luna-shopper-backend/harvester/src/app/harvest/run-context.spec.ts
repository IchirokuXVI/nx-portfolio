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
