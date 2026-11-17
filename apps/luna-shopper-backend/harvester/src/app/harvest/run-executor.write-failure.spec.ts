import type { ConfigService } from '@nestjs/config';
import {
  HarvestRunMode,
  HarvestRunStatus,
  type HarvestRunWarning,
} from '@portfolio/luna-shopper/contracts';
import type { HarvesterConfig } from '../config/app-config';
import type { HarvestRun, SupermarketSource } from '../entities';
import type { CatalogDiscoveryRunner } from './catalog-discovery.runner';
import type { HarvestRunStore } from './harvest-run.store';
import type { PriceScopeResolver } from './price-scope-resolver';
import type { RunContext } from './run-context';
import { RunExecutor } from './run-executor.service';
import type { RunReport } from './run-report';
import { RunReportSink } from './run-report.sink';
import type { SupermarketSourceService } from './supermarket-source.service';

// The sink is a fake, and the error a failed write aborts with is the real
// one, because the executor tells it apart by its class.
jest.mock('./run-report.sink', () => ({
  ...jest.requireActual('./run-report.sink'),
  RunReportSink: jest.fn(),
}));

/**
 * How a run ends when a write of what it read fails during the walk (plan
 * 0269, section 1).
 *
 * The runner is a fake that reads pages as a runner does: it checks the run's
 * signal before each page and reports one product per page. The sink is a
 * fake that fails the write of the first product and tells the executor
 * through the callback the executor gave it, as the real sink does. What is
 * pinned is the executor: the abort reaches the runner through the signal it
 * already reads, and the run ends `FAILED` with the sentence of the write.
 */

const CHAIN = '02690269-0000-4000-a000-000000000001';
const PAGES = 5;

/**
 * What the fake sink says its chunks wrote before a failure (plan 0269, D9):
 * the first chunk landed, with its prices and photo links.
 */
const WRITTEN_BEFORE = {
  products: 400,
  pricesRecorded: 9,
  pricesPublished: 7,
  pricesConfirmed: 1,
  pricesConflicted: 0,
  imagesLinked: 2,
  scopesCreated: 1,
  availabilityWritten: 0,
  packCountsFilled: 0,
  approxWeightsWritten: 0,
  pricedScopes: [],
  pricesCopied: {},
  availabilityCopied: {},
};

function build(options: {
  failWrite: boolean;
  /** A failure of the drain's own work after the chain, with no write failed. */
  drainFails?: Error;
}) {
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
    addWarnings: jest.fn(async () => undefined),
    setStage: jest.fn(async () => undefined),
    setReport: jest.fn(async (_id: string, report: Record<string, unknown>) => {
      row = { ...row, report } as HarvestRun;
    }),
    finish: jest.fn(async () => undefined),
  } as unknown as HarvestRunStore & { finish: jest.Mock };

  const source = {
    id: 'src-1',
    supermarketId: CHAIN,
    // No refusal policy, so no guard: the write is the only stop.
    adapterKey: 'osm-places',
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

  const failure = new Error('connection terminated unexpectedly');
  let failed = false;
  const drain = jest.fn(async () => {
    if (failed) {
      throw failure;
    }
    if (options.drainFails) {
      throw options.drainFails;
    }
    return {
      products: 0,
      pricedScopes: [],
      pricesCopied: {},
      availabilityCopied: {},
    };
  });
  (RunReportSink as unknown as jest.Mock).mockImplementation(
    (
      _context: RunContext,
      _input: unknown,
      deps: { onWriteFailed?: (error: unknown) => void }
    ) => ({
      product: jest.fn(() => {
        if (options.failWrite && !failed) {
          failed = true;
          // The real sink tells the executor from its chain, after the write
          // rejected, while the runner is already on its next request.
          queueMicrotask(() => deps.onWriteFailed?.(failure));
        }
      }),
      drain,
      // What landed before the failure, which the real sink keeps (D9).
      writtenSoFar: WRITTEN_BEFORE,
      get failure() {
        return failed ? failure : null;
      },
      // The failed write was a chunk of products (plan 0269, D11).
      get failedWork() {
        return failed ? 'products' : null;
      },
      settle: jest.fn(async () => WRITTEN_BEFORE),
      delistingListings: () => ({ whole: [], notWhole: [] }),
    })
  );

  /** The pages the fake runner read, in order. */
  const read: number[] = [];
  let started!: () => void;
  const running = new Promise<void>((resolve) => (started = resolve));
  const catalogDiscovery = {
    run: jest.fn(async (context: RunContext, report: RunReport) => {
      started();
      for (let page = 1; page <= PAGES; page += 1) {
        if (context.signal.aborted) {
          // Every runner stops this way: the signal it already reads.
          throw context.signal.reason;
        }
        read.push(page);
        report.product({
          externalId: `p${page}`,
          detailFetched: false,
          observedAt: new Date(),
          prices: [],
        });
        // A page is a request, which takes a while.
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
    }),
  } as unknown as CatalogDiscoveryRunner;

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
    undefined as never,
    undefined as never
  );
  return { executor, store, sources, drain, read, running };
}

describe('RunExecutor and a write that fails during a walk (plan 0269)', () => {
  it('stops the runner through its signal before its next page, and ends the run FAILED with the sentence of the write', async () => {
    const { executor, store, drain, read, sources } = build({
      failWrite: true,
    });

    await expect(executor.runToCompletion('run-1')).resolves.toBe(
      HarvestRunStatus.FAILED
    );

    // The first page was reported and its write failed. The runner read no
    // page after the one in flight when the executor heard of it.
    expect(read).toEqual([1]);
    expect(drain).toHaveBeenCalledTimes(1);
    const [, status, error] = store.finish.mock.calls[0];
    expect(status).toBe(HarvestRunStatus.FAILED);
    expect(error).toBe(
      'Stopped: writing a chunk of the products the run read failed ' +
        '(connection terminated unexpectedly), so the walk stopped there and ' +
        'wrote nothing after it. The rows of the chunks written before it ' +
        'are kept, and the report counts what they wrote. The chunk that ' +
        'failed may have written part of its rows and prices before it ' +
        'failed, and the report does not count those.'
    );
    // A failed write counts as a failure of the chain, as a failed drain
    // always did (plan 0269, D4).
    expect(sources.recordRunFinished).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'src-1' }),
      false
    );
  });

  it('states in the report what the chunks before the failed one wrote, with the fields of a completed run (D9)', async () => {
    const { executor, store } = build({ failWrite: true });

    await expect(executor.runToCompletion('run-1')).resolves.toBe(
      HarvestRunStatus.FAILED
    );

    const report = (await store.load('run-1')).report;
    expect(report).toEqual(
      expect.objectContaining({
        productsWritten: 400,
        pricesRecorded: 9,
        pricesPublished: 7,
        pricesConfirmed: 1,
        imagesLinked: 2,
        scopesCreated: 1,
        availabilityWritten: 0,
        packCountsFilled: 0,
        approxWeightsWritten: 0,
        // The resolved settings, as a completed walk states them.
        writes: expect.any(String),
        details: expect.any(String),
      })
    );
  });

  it('ends FAILED with the bare error when the drain fails after the chain, and still states what landed (D9)', async () => {
    const { executor, store } = build({
      failWrite: false,
      drainFails: new Error('availability write timed out'),
    });

    await expect(executor.runToCompletion('run-1')).resolves.toBe(
      HarvestRunStatus.FAILED
    );

    const [, status, error] = store.finish.mock.calls[0];
    expect(status).toBe(HarvestRunStatus.FAILED);
    expect(error).toBe('availability write timed out');
    expect((await store.load('run-1')).report).toEqual(
      expect.objectContaining({ productsWritten: 400, pricesPublished: 7 })
    );
  });

  it('still ends ABORTED when a person aborts and every write succeeded', async () => {
    const { executor, store, running, sources } = build({ failWrite: false });

    const done = executor.runToCompletion('run-1');
    await running;
    executor.cancel('run-1');

    await expect(done).resolves.toBe(HarvestRunStatus.ABORTED);
    expect(store.finish.mock.calls[0][1]).toBe(HarvestRunStatus.ABORTED);
    expect(sources.recordRunFinished).not.toHaveBeenCalled();
  });

  it('completes a walk whose writes all succeed', async () => {
    const { executor, read } = build({ failWrite: false });

    await expect(executor.runToCompletion('run-1')).resolves.toBe(
      HarvestRunStatus.COMPLETED
    );
    expect(read).toEqual([1, 2, 3, 4, 5]);
  });
});
