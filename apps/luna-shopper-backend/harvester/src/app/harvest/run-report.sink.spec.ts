import {
  PriceSourceKind,
  SourceEntryStatus,
  SourceLocationStatus,
} from '@portfolio/luna-shopper/contracts';
import type { Repository } from 'typeorm';
import type { SourceCatalogEntry, SourceLocation } from '../entities';
import type { CatalogClient } from './catalog-client.service';
import type { DiscoveredPlaceService } from './discovered-place.service';
import type { RunScopeResolver } from './price-scope-resolver';
import type { RunContext } from './run-context';
import type { ObservedPlace } from './run-report';
import { RunReportSink } from './run-report.sink';
import type {
  SourceIngest,
  SourceIngestCounters,
  SourceObservation,
} from './source-ingest';
import type { SourceLocationService } from './source-location.service';

/**
 * The other side of a report (plan 0103, section 2.3).
 *
 * Everything a runner used to do for itself is here: the ingest session, the
 * places, the shop codes, and both halves of availability. These are the
 * assertions that left the runner specs, and they are here once instead of once
 * per runner.
 */

const CHAIN = '11111111-1111-4111-8111-111111111111';
const SCOPE = '22222222-2222-4222-8222-222222222222';
const RUN = '33333333-3333-4333-8333-333333333333';

function observation(over: Partial<SourceObservation> = {}): SourceObservation {
  return {
    externalId: 'p1',
    name: 'Agua',
    brand: null,
    ean: null,
    unitSize: null,
    sizeFormat: null,
    categoryPath: [],
    url: null,
    observedAt: new Date('2026-09-09T10:00:00.000Z'),
    extra: null,
    prices: [],
    ...over,
  };
}

const place = (over: Partial<ObservedPlace> = {}): ObservedPlace => ({
  provider: 'OSM',
  externalRef: 'node/1',
  brandKey: null,
  brandName: null,
  name: 'A shop',
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
  ...over,
});

function build(
  options: {
    /** The item each pushed external id resolves to, and whether it is ACTIVE. */
    resolves?: Record<string, { itemId: string; active: boolean }>;
    /** The chain's tracked rows, for the negative availability diff. */
    tracked?: Array<{ externalId: string; itemId: string }>;
    shops?: Array<Partial<SourceLocation>>;
    conflicts?: Array<Record<string, unknown>>;
    /** What the ingest counted, which the sink carries into the report. */
    counters?: Partial<SourceIngestCounters>;
  } = {}
) {
  const pushed: SourceObservation[][] = [];
  const opened: unknown[] = [];
  const closed = jest.fn(async () => ({
    outcomes: [],
    counters: {
      created: 0,
      updated: 0,
      unchanged: 0,
      pricesRecorded: 0,
      pricesWritten: 0,
      pricesConfirmed: 0,
      ...options.counters,
    },
  }));
  const ingest = {
    open: jest.fn(async (_context: RunContext, input: unknown) => {
      opened.push(input);
      return {
        push: jest.fn(async (chunk: readonly SourceObservation[]) => {
          pushed.push([...chunk]);
          return chunk.map((each) => {
            const resolved = options.resolves?.[each.externalId];
            return {
              entry: {
                externalId: each.externalId,
                itemId: resolved?.itemId ?? null,
              } as SourceCatalogEntry,
              created: true,
              rung: 1 as const,
              itemId: resolved?.active ? resolved.itemId : null,
            };
          });
        }),
        close: closed,
      };
    }),
  } as unknown as SourceIngest;

  const placesObserved: ObservedPlace[][] = [];
  const places = {
    observe: jest.fn(async (chunk: readonly ObservedPlace[]) => {
      placesObserved.push([...chunk]);
      return {
        created: chunk.length,
        refreshed: 0,
        imported: 0,
        blocked: [],
      };
    }),
  } as unknown as DiscoveredPlaceService;

  const shopsObserved: unknown[] = [];
  const shops = {
    observe: jest.fn(async (_chain: string, seen: unknown[]) => {
      shopsObserved.push(seen);
      return (options.shops ?? []) as SourceLocation[];
    }),
  } as unknown as SourceLocationService;

  const catalog = {
    setAvailability: jest.fn(async () => ({ updated: 1 })),
    setLocationAvailability: jest.fn(async () => ({
      written: 1,
      skipped: 0,
      conflicts: options.conflicts ?? [],
    })),
  } as unknown as CatalogClient;

  const entries = {
    find: jest.fn(async () =>
      (options.tracked ?? []).map(
        (row) =>
          ({
            ...row,
            status: SourceEntryStatus.ACTIVE,
          }) as SourceCatalogEntry
      )
    ),
  } as unknown as Repository<SourceCatalogEntry>;

  const declared: string[] = [];
  const scopes = {
    declare: jest.fn(async (declaration: { key: string }) => {
      declared.push(declaration.key);
      return `scope-${declaration.key}`;
    }),
    idFor: (key: string) => (declared.includes(key) ? `scope-${key}` : null),
    createdCount: 0,
    keys: declared,
  } as unknown as RunScopeResolver;

  const context = {
    runId: RUN,
    report: jest.fn(async () => undefined),
  } as unknown as RunContext;

  const sink = new RunReportSink(
    context,
    {
      supermarketId: CHAIN,
      defaultPriceScopeId: SCOPE,
      sourceKind: PriceSourceKind.OFFICIAL_API,
      postalCodeDeriveMaxMetres: 5000,
      // Every chain is untrusted until an operator says otherwise (plan 0107,
      // D2); the trusted path has its own spec.
      autoImportPlaces: false,
    },
    { ingest, scopes, places, shops, catalog, entries }
  );

  return {
    sink,
    pushed,
    opened,
    placesObserved,
    shopsObserved,
    catalog,
    ingest,
    scopes,
  };
}

describe('RunReportSink', () => {
  it('opens one session and pushes everything reported into it', async () => {
    const { sink, pushed, opened, ingest } = build();

    sink.product(observation({ externalId: 'a' }));
    sink.product(observation({ externalId: 'b' }));
    const written = await sink.drain();

    expect(ingest.open).toHaveBeenCalledTimes(1);
    expect(opened[0]).toMatchObject({
      supermarketId: CHAIN,
      defaultPriceScopeId: SCOPE,
      sourceKind: PriceSourceKind.OFFICIAL_API,
    });
    expect(pushed.flat().map((each) => each.externalId)).toEqual(['a', 'b']);
    expect(written.products).toBe(2);
  });

  /**
   * The session's counters used to be dropped on the floor: `close` was called
   * for its side effect and its answer discarded, so a run's report named no
   * price and the back office fell back to `updated`, which is rows the ladder
   * changed. A LIDL walk then read "prices written: 0" beside 8,154 prices on
   * its own source rows.
   */
  it('carries the prices the ingest counted into the result', async () => {
    const { sink } = build({
      counters: {
        pricesRecorded: 8154,
        pricesWritten: 0,
        pricesConfirmed: 0,
      },
    });

    sink.product(observation({ externalId: 'a' }));
    const written = await sink.drain();

    // Recorded and published are two different numbers, and a chain nobody has
    // matched yet is exactly where they differ most.
    expect(written.pricesRecorded).toBe(8154);
    expect(written.pricesPublished).toBe(0);
    expect(written.pricesConfirmed).toBe(0);
  });

  it('reports no price for a run that opened no session', async () => {
    const { sink } = build();

    // A store discovery reports places and no product, so no session is opened
    // and there is nothing to count.
    const written = await sink.drain();

    expect(written.pricesRecorded).toBe(0);
    expect(written.pricesPublished).toBe(0);
  });

  it('resolves a declared scope before the prices that name it are written', async () => {
    // **Declared before any price refers to it** (plan 0103, section 2.2). The
    // sink keeps one serial chain, so the resolution queued by a declaration
    // has happened by the time the chunk that names it flushes.
    const { sink, opened, scopes } = build();

    sink.scope({ key: '21', kind: 'REGION' as never, name: 'Huesca' });
    sink.product(observation({ externalId: 'a' }));
    await sink.drain();

    expect(scopes.declare).toHaveBeenCalledTimes(1);
    const scopeIdFor = (opened[0] as { scopeIdFor: (k: string) => string })
      .scopeIdFor;
    expect(scopeIdFor('21')).toBe('scope-21');
  });

  it('writes the places it was given, and counts them', async () => {
    const { sink, placesObserved } = build();

    sink.place(place({ externalRef: 'node/1' }));
    sink.place(place({ externalRef: 'node/2' }));
    const written = await sink.drain();

    expect(placesObserved.flat().map((each) => each.externalRef)).toEqual([
      'node/1',
      'node/2',
    ]);
    expect(written.placesCreated).toBe(2);
  });

  it('says a tracked product the run did not name is not stocked', async () => {
    // The diff the Mercadona runner used to make for itself, from the rows it
    // loaded through a repository of its own (plan 0103, section 6.1).
    const { sink, catalog } = build({
      resolves: { seen: { itemId: 'item-seen', active: true } },
      tracked: [{ externalId: 'gone', itemId: 'item-gone' }],
    });

    sink.product(observation({ externalId: 'seen' }));
    sink.assortmentComplete(null);
    await sink.drain();

    const entries = (catalog.setAvailability as jest.Mock).mock
      .calls[0][1] as Array<{ itemId: string; available: boolean }>;
    expect(entries).toContainEqual({ itemId: 'item-seen', available: true });
    expect(entries).toContainEqual({ itemId: 'item-gone', available: false });
  });

  it('says nothing at all when the run did not walk a whole assortment', async () => {
    // **An aborted run declares nothing**, so it asserts no absence. A walk
    // that stopped early has not proved anything absent, and under-claiming is
    // the safe way to be wrong.
    const { sink, catalog } = build({
      resolves: { seen: { itemId: 'item-seen', active: true } },
      tracked: [{ externalId: 'gone', itemId: 'item-gone' }],
    });

    sink.product(observation({ externalId: 'seen' }));
    await sink.drain();

    expect(catalog.setAvailability).not.toHaveBeenCalled();
  });

  it('writes per shop availability through the shop a person mapped', async () => {
    const { sink, catalog, shopsObserved } = build({
      // A fuzzy `CANDIDATE` row, which per shop availability reads and a price
      // does not: DEZA publishes no EAN, so an `ACTIVE` row there would only
      // ever be one a person accepted, and reading `ACTIVE` alone would silence
      // the whole crawl.
      resolves: { p1: { itemId: 'item-1', active: false } },
      shops: [
        {
          externalId: 'T1',
          printedName: 'Jesús Rescatado',
          supermarketLocationId: 'loc-1',
          status: SourceLocationStatus.ACTIVE,
        } as Partial<SourceLocation>,
      ],
    });

    sink.product(observation({ externalId: 'p1' }));
    sink.availability({
      externalId: 'p1',
      shopCode: 'T1',
      shopName: 'Jesús Rescatado',
      available: true,
    });
    const written = await sink.drain();

    expect(shopsObserved[0]).toEqual([
      { externalId: 'T1', printedName: 'Jesús Rescatado' },
    ]);
    expect(catalog.setLocationAvailability).toHaveBeenCalledTimes(1);
    expect(
      (catalog.setLocationAvailability as jest.Mock).mock.calls[0][1]
    ).toEqual([{ itemId: 'item-1', available: true }]);
    expect(written.shopsWritten).toBe(1);
  });

  it('skips an unmapped shop, names it, and still finishes', async () => {
    // Plan 0084, section 6: the run writes nothing for it and finishes, and the
    // row is what the back office shows. Mapping it later does not backfill
    // what this run skipped.
    const { sink, catalog } = build({
      resolves: { p1: { itemId: 'item-1', active: false } },
      shops: [
        {
          externalId: 'C1',
          printedName: 'SuperCash (Quemadas)',
          supermarketLocationId: null,
          status: SourceLocationStatus.UNMAPPED,
        } as Partial<SourceLocation>,
      ],
    });

    sink.product(observation({ externalId: 'p1' }));
    sink.availability({
      externalId: 'p1',
      shopCode: 'C1',
      shopName: 'SuperCash (Quemadas)',
      available: true,
    });
    const written = await sink.drain();

    expect(catalog.setLocationAvailability).not.toHaveBeenCalled();
    expect(written.shopsUnmapped).toEqual([
      { code: 'C1', name: 'SuperCash (Quemadas)' },
    ]);
  });

  it('reports an availability row a person owns rather than overwriting it', async () => {
    // Plan 0084, section 3: a person always wins, and the run reports the
    // disagreement rather than applying it.
    const { sink } = build({
      resolves: { p1: { itemId: 'item-1', active: false } },
      shops: [
        {
          externalId: 'T1',
          printedName: 'Jesús Rescatado',
          supermarketLocationId: 'loc-1',
          status: SourceLocationStatus.ACTIVE,
        } as Partial<SourceLocation>,
      ],
      conflicts: [{ itemId: 'item-1', held: false, offered: true }],
    });

    sink.product(observation({ externalId: 'p1' }));
    sink.availability({
      externalId: 'p1',
      shopCode: 'T1',
      shopName: 'Jesús Rescatado',
      available: true,
    });
    const written = await sink.drain();

    expect(written.conflicts).toEqual([
      { shop: 'T1', itemId: 'item-1', held: false, offered: true },
    ]);
  });
});
