import type { HarvestRun } from '@portfolio/luna-shopper-admin/models';
import { GatewayError } from '../gateway-error';
import { RUN_POLL_INTERVAL_MS, RunWatch, type RunReader } from './run-watch';

/**
 * The polling rules of plan 0006 section 2, asserted one at a time.
 *
 * All three are properties of this class alone, which is why it is a plain class
 * rather than a component concern: none of these needs a template, a router or a
 * change detector to be true.
 */

function run(over: Partial<HarvestRun> = {}): HarvestRun {
  return {
    id: 'run-1',
    supermarketId: null,
    sourceId: null,
    mode: 'CATALOG_DISCOVERY',
    trigger: 'MANUAL',
    status: 'RUNNING',
    requestedAt: '2026-09-03T09:00:00.000Z',
    startedAt: '2026-09-03T09:00:01.000Z',
    finishedAt: null,
    heartbeatAt: '2026-09-03T09:05:00.000Z',
    totalPlanned: 100,
    processed: 40,
    created: 10,
    updated: 10,
    unchanged: 20,
    notFound: 0,
    failed: 0,
    stage: 'fetch',
    stageLabel: 'Fetching',
    abortRequestedAt: null,
    error: null,
    correlationId: null,
    requestedByUserId: null,
    ...over,
  };
}

/** A document whose visibility a spec can set, and whose listeners it can fire. */
function fakeDocument(state: DocumentVisibilityState = 'visible') {
  const listeners: (() => void)[] = [];

  return {
    visibilityState: state,
    addEventListener: (_: string, handler: EventListener) =>
      listeners.push(handler as () => void),
    removeEventListener: (_: string, handler: EventListener) => {
      const index = listeners.indexOf(handler as () => void);
      if (index >= 0) {
        listeners.splice(index, 1);
      }
    },
    /** What `visibilitychange` firing looks like from outside. */
    change(next: DocumentVisibilityState) {
      this.visibilityState = next;
      for (const listener of [...listeners]) {
        listener();
      }
    },
  };
}

function reader(reads: readonly HarvestRun[]): RunReader & { calls: number } {
  let call = 0;
  return {
    get calls() {
      return call;
    },
    readRun: async () => {
      const answer = reads[Math.min(call, reads.length - 1)];
      call += 1;
      return answer;
    },
    abortRun: async () => run({ status: 'ABORTED', abortRequestedAt: 'x' }),
  };
}

/** Let every pending microtask settle, without a real clock. */
const settle = () => Promise.resolve().then(() => undefined);

describe('RunWatch', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('keeps reading while the run is going', async () => {
    const service = reader([run(), run({ processed: 55 })]);
    const watch = new RunWatch(service, fakeDocument(), 'run-1');

    watch.start();
    await settle();
    expect(service.calls).toBe(1);

    jest.advanceTimersByTime(RUN_POLL_INTERVAL_MS);
    await settle();

    expect(service.calls).toBe(2);
    expect(watch.run()?.processed).toBe(55);
    watch.stop();
  });

  /**
   * The first terminal read is the last read. A finished run cannot change, so
   * a poll that carried on would be asking a question with a fixed answer every
   * two seconds for as long as the tab stayed open.
   */
  it.each(['COMPLETED', 'FAILED', 'ABORTED', 'STALE'] as const)(
    'stops reading once the run is %s',
    async (status) => {
      const service = reader([run({ status })]);
      const watch = new RunWatch(service, fakeDocument(), 'run-1');

      watch.start();
      await settle();
      expect(service.calls).toBe(1);

      jest.advanceTimersByTime(RUN_POLL_INTERVAL_MS * 5);
      await settle();

      expect(service.calls).toBe(1);
      expect(watch.finished()).toBe(true);
      watch.stop();
    }
  );

  it('pauses while the tab is hidden and says so', async () => {
    const service = reader([run()]);
    const document = fakeDocument();
    const watch = new RunWatch(service, document, 'run-1');

    watch.start();
    await settle();
    expect(service.calls).toBe(1);

    document.change('hidden');
    jest.advanceTimersByTime(RUN_POLL_INTERVAL_MS * 3);
    await settle();

    expect(service.calls).toBe(1);
    // A different sentence from "finished", because the numbers on screen are
    // still those of a run that is presumably still going.
    expect(watch.paused()).toBe(true);
    expect(watch.finished()).toBe(false);
    watch.stop();
  });

  /**
   * Coming back reads at once rather than waiting out the interval, which is the
   * arrival case section 2 says must be correct.
   */
  it('reads immediately when the tab comes back', async () => {
    const service = reader([run()]);
    const document = fakeDocument();
    const watch = new RunWatch(service, document, 'run-1');

    watch.start();
    await settle();
    document.change('hidden');
    await settle();

    document.change('visible');
    await settle();

    expect(service.calls).toBe(2);
    expect(watch.paused()).toBe(false);
    watch.stop();
  });

  /**
   * A run opened halfway through renders from that one read alone. Nothing here
   * accumulates across polls, so there is no state a late arrival is missing.
   */
  it('renders a run it never saw start', async () => {
    const service = reader([
      run({ processed: 3_000, totalPlanned: 4_383, stageLabel: 'Fetching' }),
    ]);
    const watch = new RunWatch(service, fakeDocument(), 'run-1');

    watch.start();
    await settle();

    expect(watch.loading()).toBe(false);
    expect(watch.progress()).toEqual({
      processed: 3_000,
      total: 4_383,
      percent: 68,
    });
    watch.stop();
  });

  it('offers no percentage before the run knows its own size', async () => {
    const service = reader([run({ totalPlanned: null, processed: 12 })]);
    const watch = new RunWatch(service, fakeDocument(), 'run-1');

    watch.start();
    await settle();

    expect(watch.progress()).toEqual({
      processed: 12,
      total: null,
      percent: null,
    });
    watch.stop();
  });

  it('stops reading after stop, even mid flight', async () => {
    const service = reader([run()]);
    const watch = new RunWatch(service, fakeDocument(), 'run-1');

    watch.start();
    await settle();
    watch.stop();

    jest.advanceTimersByTime(RUN_POLL_INTERVAL_MS * 4);
    await settle();

    expect(service.calls).toBe(1);
  });

  /**
   * A failed poll leaves the numbers alone. They are still true, and clearing
   * them would turn one dropped request into the loss of everything on screen.
   */
  it('keeps the last good run when a poll fails', async () => {
    let call = 0;
    const service: RunReader = {
      readRun: async () => {
        call += 1;
        if (call === 1) {
          return run({ processed: 40 });
        }
        throw new GatewayError({ code: '', status: 0, correlationId: '' });
      },
      abortRun: async () => run(),
    };
    const watch = new RunWatch(service, fakeDocument(), 'run-1');

    watch.start();
    await settle();
    jest.advanceTimersByTime(RUN_POLL_INTERVAL_MS);
    await settle();

    expect(watch.run()?.processed).toBe(40);
    expect(watch.error()).not.toBeNull();
    expect(watch.failed()).toBe(false);
    watch.stop();
  });

  it('is failed when the first read never answered', async () => {
    const service: RunReader = {
      readRun: async () => {
        throw new GatewayError({ code: '', status: 0, correlationId: '' });
      },
      abortRun: async () => run(),
    };
    const watch = new RunWatch(service, fakeDocument(), 'run-1');

    watch.start();
    await settle();

    expect(watch.failed()).toBe(true);
    watch.stop();
  });

  /**
   * The abort button goes away the moment the request lands, not when the run
   * finalizes. In between the run is flushing what it has, which takes long
   * enough that a live button would be pressed again.
   */
  it('offers the abort once and updates from the reply', async () => {
    const service: RunReader = {
      readRun: async () => run(),
      abortRun: async () =>
        run({ abortRequestedAt: '2026-09-03T09:06:00.000Z' }),
    };
    const watch = new RunWatch(service, fakeDocument(), 'run-1');

    watch.start();
    await settle();
    expect(watch.canAbort()).toBe(true);

    await watch.abort();

    expect(watch.canAbort()).toBe(false);
    expect(watch.run()?.abortRequestedAt).not.toBeNull();
    watch.stop();
  });

  it('does not offer an abort on a finished run', async () => {
    const service = reader([run({ status: 'COMPLETED' })]);
    const watch = new RunWatch(service, fakeDocument(), 'run-1');

    watch.start();
    await settle();

    expect(watch.canAbort()).toBe(false);
    watch.stop();
  });
});
