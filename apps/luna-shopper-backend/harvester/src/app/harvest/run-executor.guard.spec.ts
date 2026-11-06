import type { ConfigService } from '@nestjs/config';
import {
  HarvestRunMode,
  HarvestRunStatus,
  HarvestRunStopReason,
  HarvestWarningCode,
  type HarvestRunWarning,
} from '@portfolio/luna-shopper/contracts';
import { SourceBlockedError } from '@portfolio/luna-shopper/source-guard';
import type { HarvesterConfig } from '../config/app-config';
import type { HarvestRun, SupermarketSource } from '../entities';
import type { CatalogDiscoveryRunner } from './catalog-discovery.runner';
import type { HarvestRunStore } from './harvest-run.store';
import { toHarvestRunView } from './harvest.mappers';
import type { PriceScopeResolver } from './price-scope-resolver';
import type { RunContext } from './run-context';
import { RunExecutor, SHUTDOWN_STOPPED_RUN } from './run-executor.service';
import { RunReportSink } from './run-report.sink';
import type { SupermarketSourceService } from './supermarket-source.service';

jest.mock('./run-report.sink', () => ({ RunReportSink: jest.fn() }));

/**
 * How a run ends when the chain keeps refusing it (plan 0215, sections 5 to 7).
 *
 * The runner is a fake that drives the run's own context: it calls `acquire`
 * as a client does and tells the run's guard what the chain answered. The sink
 * is a fake too, so what is pinned is the executor: the drain on the abort
 * path, the status and its reason, the sentence, and the report block.
 */

const CHAIN = '02150215-0000-4000-a000-000000000001';

/** How the fake runner behaves once the guard has stopped it. */
type Ending = 'returns' | 'throws';

function build(adapterKey: string, ending: Ending = 'returns') {
  let row = {
    id: 'run-1',
    mode: HarvestRunMode.CATALOG_DISCOVERY,
    supermarketId: CHAIN,
    priceScopeId: null,
    input: {},
    report: {} as Record<string, unknown>,
    failed: 0,
    totalPlanned: 100,
    warnings: [] as HarvestRunWarning[],
  } as unknown as HarvestRun;

  const store = {
    load: jest.fn(async () => row),
    markRunning: jest.fn(async () => undefined),
    isAbortRequested: jest.fn(async () => false),
    touchHeartbeat: jest.fn(async () => undefined),
    addCounters: jest.fn(async () => undefined),
    addWarnings: jest.fn(async (_id: string, warnings: HarvestRunWarning[]) => {
      row.warnings.push(...warnings);
    }),
    setStage: jest.fn(async () => undefined),
    setReport: jest.fn(async (_id: string, report: Record<string, unknown>) => {
      row = { ...row, report } as HarvestRun;
    }),
    finish: jest.fn(async () => undefined),
  } as unknown as HarvestRunStore & {
    finish: jest.Mock;
    setStage: jest.Mock;
  };

  const source = {
    id: 'src-1',
    supermarketId: CHAIN,
    adapterKey,
    maxRequestsPerSecond: 100,
    workers: 4,
    config: {},
    consecutiveFailures: 0,
  } as unknown as SupermarketSource;
  const sources = {
    findBySupermarket: jest.fn(async () => source),
    recordRunStarted: jest.fn(async () => undefined),
    recordRunFinished: jest.fn(async () => undefined),
  } as unknown as SupermarketSourceService & { recordRunFinished: jest.Mock };

  const drain = jest.fn(async () => ({
    products: 3,
    pricedScopes: [],
    pricesCopied: {},
    availabilityCopied: {},
    wordOrderProposals: 2,
    wordOrderRejectedPointers: 1,
  }));
  (RunReportSink as unknown as jest.Mock).mockImplementation(() => ({
    drain,
    // No whole listing, so the delisting count (plan 0220) has nothing to count.
    delistingListings: () => ({ whole: [], notWhole: [] }),
  }));

  let started!: (context: RunContext) => void;
  const running = new Promise<RunContext>((resolve) => (started = resolve));
  /** Five refusals in a row, as a client reports them. */
  const refuse = (context: RunContext): Array<'retry' | 'fail'> =>
    [1, 2, 3, 4, 5].map(
      (n) => context.guard?.refused(403, `https://shop.test/p/${n}`) ?? 'fail'
    );
  const catalogDiscovery = {
    run: jest.fn(async (context: RunContext) => {
      await context.acquire();
      try {
        refuse(context);
        started(context);
        // A client sends the refused request again through the gate, which
        // holds it for the pause.
        await context.acquire();
      } catch (error) {
        if (ending === 'throws' || !(error instanceof SourceBlockedError)) {
          throw error;
        }
      }
    }),
  } as unknown as CatalogDiscoveryRunner & { run: jest.Mock };

  const config = {
    getOrThrow: () =>
      ({
        defaultMaxRequestsPerSecond: 4,
        failureRatio: 0.25,
        postalCodeDeriveMaxMetres: 5000,
      }) as HarvesterConfig,
  } as unknown as ConfigService;

  const executor = new RunExecutor(
    { find: jest.fn(async () => []) } as never,
    store,
    sources,
    undefined as never,
    catalogDiscovery,
    undefined as never,
    undefined as never,
    { forRun: () => null } as unknown as PriceScopeResolver,
    undefined as never,
    undefined as never,
    undefined as never,
    config,
    undefined as never
  );
  return {
    executor,
    store,
    sources,
    drain,
    running,
    catalogDiscovery,
    row: () => row,
  };
}

describe('RunExecutor and the refusal guard (plan 0215)', () => {
  it('ends a stopped run FAILED with its reason, its sentence, its report block and a drained sink', async () => {
    const { executor, store, drain, row } = build('dia-api');

    await expect(executor.runToCompletion('run-1')).resolves.toBe(
      HarvestRunStatus.FAILED
    );

    expect(drain).toHaveBeenCalledTimes(1);
    const [, status, error, reason] = store.finish.mock.calls[0];
    expect(status).toBe(HarvestRunStatus.FAILED);
    expect(reason).toBe(HarvestRunStopReason.SOURCE_BLOCKED);
    expect(error).toMatch(
      /^Stopped: the chain refused 5 requests in a row at \d\d:\d\d UTC, and the run does not pause for this chain\. The 3 product\(s\) read before are kept\.$/
    );
    expect(row().report['refusals']).toEqual(
      expect.objectContaining({
        isolated: 0,
        paused: null,
        lastStatus: 403,
        lastUrl: 'https://shop.test/p/5',
        stoppedAt: expect.any(String),
      })
    );
    // The drain's own report is kept beside the block.
    expect(row().report['productsWritten']).toBe(3);
    // And the two word order counts of plan 0221.
    expect(row().report['wordOrderProposals']).toBe(2);
    expect(row().report['wordOrderRejectedPointers']).toBe(1);
  });

  it('drains what a runner reported when it throws after the stop', async () => {
    const { executor, store, drain } = build('dia-api', 'throws');

    await expect(executor.runToCompletion('run-1')).resolves.toBe(
      HarvestRunStatus.FAILED
    );

    expect(drain).toHaveBeenCalledTimes(1);
    expect(store.finish).toHaveBeenCalledWith(
      'run-1',
      HarvestRunStatus.FAILED,
      expect.stringMatching(/^Stopped: /),
      HarvestRunStopReason.SOURCE_BLOCKED
    );
  });

  it('is FAILED even when its failed share is under the ratio', async () => {
    // The fake run has 0 of 100 items failed, which the ratio calls COMPLETED.
    const { executor } = build('carrefour-web');

    await expect(executor.runToCompletion('run-1')).resolves.toBe(
      HarvestRunStatus.FAILED
    );
  });

  it('counts a stopped run as one failure of the source, and it is not interrupted', async () => {
    const { executor, sources, store, row } = build('dia-api');

    await executor.runToCompletion('run-1');

    expect(sources.recordRunFinished).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'src-1' }),
      false
    );
    const [, status, error, stopReason] = store.finish.mock.calls[0];
    const view = toHarvestRunView({
      ...row(),
      requestedAt: new Date(),
      status,
      error,
      stopReason,
      abortRequestedAt: null,
    } as HarvestRun);
    expect(view.interrupted).toBe(false);
    expect(view.stopReason).toBe(HarvestRunStopReason.SOURCE_BLOCKED);
  });

  it('pauses a pausing chain: the stage reads PAUSED and a warning says why', async () => {
    const { executor, store, running, row } = build('mercadona-api');

    const done = executor.runToCompletion('run-1');
    const context = await running;
    await new Promise((resolve) => setImmediate(resolve));

    expect(context.guard?.stop).toBeNull();
    expect(store.setStage).toHaveBeenCalledWith(
      'run-1',
      'PAUSED',
      'The chain refused 5 requests in a row. Waiting 10 minutes before trying one more.'
    );
    executor.cancel('run-1');
    await done;
    expect(row().warnings).toEqual([
      expect.objectContaining({ code: HarvestWarningCode.SOURCE_PAUSED }),
    ]);
  });

  it('ends ABORTED with no reason when a person aborts during a pause', async () => {
    const { executor, store, running, drain } = build('mercadona-api');

    const done = executor.runToCompletion('run-1');
    await running;
    executor.cancel('run-1');

    await expect(done).resolves.toBe(HarvestRunStatus.ABORTED);
    // The runner threw on the abort, and what it reported is still drained.
    expect(drain).toHaveBeenCalledTimes(1);
    const call = store.finish.mock.calls[0];
    expect(call[1]).toBe(HarvestRunStatus.ABORTED);
    expect(call).toHaveLength(3);
  });

  it('writes the shutdown sentence when a shutdown stops a run during a pause', async () => {
    const { executor, store, running, sources } = build('mercadona-api');

    const done = executor.runToCompletion('run-1');
    await running;
    executor.onApplicationShutdown();

    await expect(done).resolves.toBe(HarvestRunStatus.ABORTED);
    expect(store.finish).toHaveBeenCalledWith(
      'run-1',
      HarvestRunStatus.ABORTED,
      SHUTDOWN_STOPPED_RUN
    );
    expect(sources.recordRunFinished).not.toHaveBeenCalled();
  });

  it('builds no guard for a chain whose adapter has no policy', async () => {
    const { executor, catalogDiscovery, row } = build('osm-places');

    await expect(executor.runToCompletion('run-1')).resolves.toBe(
      HarvestRunStatus.COMPLETED
    );
    const context = catalogDiscovery.run.mock.calls[0][0] as RunContext;
    expect(context.guard).toBeUndefined();
    expect(row().report['refusals']).toBeUndefined();
  });
});
