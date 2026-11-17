import type { ConfigService } from '@nestjs/config';
import {
  HarvestRunMode,
  HarvestRunStatus,
  type HarvestRunWarning,
} from '@portfolio/luna-shopper/contracts';
import type { HarvesterConfig } from '../config/app-config';
import type { HarvestRun, SupermarketSource } from '../entities';
import type { CatalogClient } from './catalog-client.service';
import type { CatalogDiscoveryRunner } from './catalog-discovery.runner';
import type { DiscoveredPlaceService } from './discovered-place.service';
import type { HarvestRunStore } from './harvest-run.store';
import type { PriceScopeResolver } from './price-scope-resolver';
import type { RunContext } from './run-context';
import { RunExecutor } from './run-executor.service';
import type { ObservedPlace, RunReport } from './run-report';
import type { SourceIngest, SourceObservation } from './source-ingest';
import type { StoreDiscoveryRunner } from './store-discovery.runner';
import type { SupermarketSourceService } from './supermarket-source.service';

/**
 * What a run states and when it finishes when the work it queued is still
 * writing as it fails (plan 0269, D11).
 *
 * The sink is the real one, so the chain, the totals and the kind of the
 * failed work are its own. The ingest, the places and the scopes are fakes
 * whose writes wait on a gate the spec opens, which is how a chunk is still
 * writing when the runner throws.
 */

const CHAIN = '02690269-0000-4000-a000-000000000011';

function observation(externalId: string): SourceObservation {
  return {
    externalId,
    name: 'Agua',
    brand: null,
    ean: null,
    unitSize: null,
    sizeUnit: null,
    sizeFormat: null,
    categoryPath: [],
    url: null,
    observedAt: new Date('2026-11-17T10:00:00.000Z'),
    extra: null,
    prices: [],
  };
}

function place(n: number): ObservedPlace {
  return {
    provider: 'OSM',
    externalRef: `node/${n}`,
    brandKey: null,
    brandName: null,
    name: `Shop ${n}`,
    latitude: 37.9,
    longitude: -4.8,
    street: null,
    city: null,
    postalCode: null,
    postalCodeSource: null,
    country: 'es',
    website: null,
    openingHours: null,
    tags: {},
  };
}

/** A promise the spec resolves by hand. */
function gate(): { opened: Promise<void>; open: () => void } {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => (open = resolve));
  return { opened, open };
}

function build(mode: HarvestRunMode) {
  /** What happened, in order, for the assertions on the order. */
  const events: string[] = [];

  let row = {
    id: 'run-1',
    mode,
    supermarketId: CHAIN,
    priceScopeId: null,
    input: {},
    report: {} as Record<string, unknown>,
    failed: 0,
    totalPlanned: null,
    warnings: [] as HarvestRunWarning[],
  } as unknown as HarvestRun;

  const store = {
    load: jest.fn(async () => row),
    markRunning: jest.fn(async () => undefined),
    isAbortRequested: jest.fn(async () => false),
    touchHeartbeat: jest.fn(async () => events.push('heartbeat')),
    addCounters: jest.fn(async () => undefined),
    addWarnings: jest.fn(async () => undefined),
    setStage: jest.fn(async () => undefined),
    setTotalPlanned: jest.fn(async () => undefined),
    setReport: jest.fn(async (_id: string, report: Record<string, unknown>) => {
      row = { ...row, report } as HarvestRun;
    }),
    finish: jest.fn(async () => {
      events.push('finish');
    }),
  } as unknown as HarvestRunStore & { finish: jest.Mock };

  const source = {
    id: 'src-1',
    supermarketId: CHAIN,
    // No refusal policy, so no guard.
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
  } as unknown as SupermarketSourceService;

  /** One gate per product chunk, opened by the spec. */
  const pushGates = [gate(), gate()];
  const pushed: number[] = [];
  const close = jest.fn();
  const ingest = {
    open: jest.fn(async () => ({
      push: jest.fn(async (chunk: readonly SourceObservation[]) => {
        const index = pushed.length;
        pushed.push(chunk.length);
        await pushGates[index].opened;
        // The chain's lock is still held while the chunk writes.
        events.push(
          `push ${index + 1} written, running ${executor.isRunning('run-1')}`
        );
        return [];
      }),
      close,
      totals: () => ({
        outcomes: [],
        counters: {
          created: 0,
          updated: 0,
          unchanged: 0,
          // What the two written chunks counted.
          pricesRecorded: 2 * pushed.length,
          pricesWritten: pushed.length,
          pricesConfirmed: 0,
          pricesConflicted: 0,
          wordOrderProposals: 0,
          wordOrderRejectedPointers: 0,
          sizesDisproved: 0,
          probablePackCounts: 0,
        },
        sizeDoubts: [],
        copies: { pricedScopes: new Set(), pricesCopied: new Map() },
        priceConflicts: [],
        images: {
          linked: 0,
          moved: 0,
          unchanged: 0,
          rejected: 0,
          unlinked: 0,
          failed: 0,
        },
      }),
      activeItemsOf: jest.fn(async () => new Map()),
    })),
  } as unknown as SourceIngest & { open: jest.Mock };

  /** The place write fails, after a while, as a database that went away. */
  const placeGate = gate();
  const places = {
    observe: jest.fn(async () => {
      await placeGate.opened;
      throw new Error('could not write the places');
    }),
  } as unknown as DiscoveredPlaceService;

  const declared: string[] = [];
  const scopes = {
    forRun: () => ({
      declare: jest.fn(async (declaration: { key: string }) => {
        declared.push(declaration.key);
        return `scope-${declaration.key}`;
      }),
      idFor: () => null,
      createdCount: 0,
      keys: declared,
    }),
  } as unknown as PriceScopeResolver;

  const catalog = {
    getSupermarket: jest.fn(async () => ({
      externalBrandKey: null,
      name: { es: 'Cadena' },
    })),
    setAvailability: jest.fn(),
    fillPackCounts: jest.fn(),
    setApproxWeights: jest.fn(),
  } as unknown as CatalogClient & {
    setAvailability: jest.Mock;
    fillPackCounts: jest.Mock;
    setApproxWeights: jest.Mock;
  };

  /** A runner that queues two whole chunks, keeps a partial one and throws. */
  const catalogDiscovery = {
    run: jest.fn(async (_context: RunContext, report: RunReport) => {
      for (let n = 0; n < 850; n += 1) {
        report.product(observation(`p${n}`));
      }
      throw new Error('the listing page could not be parsed');
    }),
  } as unknown as CatalogDiscoveryRunner;

  /**
   * A store discovery: one scope, a whole chunk of places, a second scope
   * declared while the places are still writing, and the walk goes on until
   * the failed write stops it through the signal.
   */
  const storeDiscovery = {
    run: jest.fn(async (context: RunContext, report: RunReport) => {
      report.scope({ key: 'A', kind: 'REGION', name: null } as never);
      for (let n = 0; n < 100; n += 1) {
        report.place(place(n));
      }
      report.scope({ key: 'B', kind: 'REGION', name: null } as never);
      placeGate.open();
      for (;;) {
        if (context.signal.aborted) {
          throw context.signal.reason;
        }
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
    }),
  } as unknown as StoreDiscoveryRunner;

  const config = {
    getOrThrow: () =>
      ({
        defaultMaxRequestsPerSecond: 4,
        failureRatio: 0.25,
        postalCodeDeriveMaxMetres: 5000,
      }) as HarvesterConfig,
  } as unknown as ConfigService;

  // Read by the ingest fake only while a chunk writes, long after this line.
  const executor: RunExecutor = new RunExecutor(
    { find: jest.fn(async () => []) } as never,
    store,
    sources,
    storeDiscovery,
    catalogDiscovery,
    undefined as never,
    ingest,
    scopes,
    places,
    undefined as never,
    catalog,
    config,
    undefined as never,
    undefined as never
  );
  return {
    executor,
    store,
    events,
    pushGates,
    pushed,
    close,
    catalog,
    declared,
  };
}

describe('RunExecutor and a runner that throws while its writes are queued (plan 0269, D11)', () => {
  it('writes the queued chunks before the run is finished and its lock released, states them in the report, and ends FAILED with the runner error', async () => {
    const { executor, store, events, pushGates, pushed, close, catalog } =
      build(HarvestRunMode.CATALOG_DISCOVERY);

    const done = executor.runToCompletion('run-1');
    // Both whole chunks are queued and the first is writing; the runner has
    // thrown by now. Nothing is finished while they write.
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(store.finish).not.toHaveBeenCalled();
    pushGates[0].open();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(store.finish).not.toHaveBeenCalled();
    pushGates[1].open();

    await expect(done).resolves.toBe(HarvestRunStatus.FAILED);

    // Both queued chunks were written, while the run still held its chain,
    // and before the row was finished. The partial chunk of 50 the runner
    // never queued was not written, because the run failed.
    expect(pushed).toEqual([400, 400]);
    expect(events.filter((event) => event !== 'heartbeat')).toEqual([
      'push 1 written, running true',
      'push 2 written, running true',
      'finish',
    ]);
    // Nothing of a completed drain: no close, no availability, no fills.
    expect(close).not.toHaveBeenCalled();
    expect(catalog.setAvailability).not.toHaveBeenCalled();
    expect(catalog.fillPackCounts).not.toHaveBeenCalled();
    expect(catalog.setApproxWeights).not.toHaveBeenCalled();

    const [, status, error] = store.finish.mock.calls[0];
    expect(status).toBe(HarvestRunStatus.FAILED);
    expect(error).toBe('the listing page could not be parsed');
    expect((await store.load('run-1')).report).toEqual(
      expect.objectContaining({
        productsWritten: 800,
        pricesRecorded: 4,
        pricesPublished: 2,
      })
    );
    expect(executor.isRunning('run-1')).toBe(false);
  });

  it('keeps the runner error as the sentence when a queued chunk fails while it settles, and counts the chunks before it', async () => {
    const { executor, store, pushGates } = build(
      HarvestRunMode.CATALOG_DISCOVERY
    );
    // The second chunk fails while the run settles.
    pushGates[1].opened = Promise.reject(new Error('deadlock detected'));
    pushGates[1].opened.catch(() => undefined);

    const done = executor.runToCompletion('run-1');
    await new Promise((resolve) => setTimeout(resolve, 10));
    pushGates[0].open();

    await expect(done).resolves.toBe(HarvestRunStatus.FAILED);
    const [, status, error] = store.finish.mock.calls[0];
    expect(status).toBe(HarvestRunStatus.FAILED);
    expect(error).toBe('the listing page could not be parsed');
    expect((await store.load('run-1')).report).toEqual(
      expect.objectContaining({ productsWritten: 400 })
    );
  });
});

describe('RunExecutor and a store discovery whose place chunk fails (plan 0269, D11)', () => {
  it('counts only the scope declarations that ran', async () => {
    const { executor, store, declared } = build(HarvestRunMode.STORE_DISCOVERY);

    await expect(executor.runToCompletion('run-1')).resolves.toBe(
      HarvestRunStatus.FAILED
    );

    // B was declared while the places wrote, and the failure skipped it.
    expect(declared).toEqual(['A']);
    expect((await store.load('run-1')).report).toEqual(
      expect.objectContaining({ scopesDeclared: 1, placesCreated: 0 })
    );
  });

  it('ends FAILED with a sentence that speaks of places, not products', async () => {
    const { executor, store } = build(HarvestRunMode.STORE_DISCOVERY);

    await expect(executor.runToCompletion('run-1')).resolves.toBe(
      HarvestRunStatus.FAILED
    );

    const [, status, error] = store.finish.mock.calls[0];
    expect(status).toBe(HarvestRunStatus.FAILED);
    expect(error).toContain('a chunk of the places the run read failed');
    expect(error).toContain('could not write the places');
    expect(error).not.toMatch(/product/);
  });
});
