import {
  HarvestRunWrites,
  PriceSourceKind,
  SourceEntryStatus,
  SourceLocationStatus,
  type PackCountFill,
} from '@portfolio/luna-shopper/contracts';
import { packCountIn as dezaPackCount } from '@portfolio/luna-shopper/deza';
import { splitSize as elJamonSize } from '@portfolio/luna-shopper/eljamon';
import type { Repository } from 'typeorm';
import type { SourceCatalogEntry, SourceLocation } from '../entities';
import type { CatalogClient } from './catalog-client.service';
import type { DiscoveredPlaceService } from './discovered-place.service';
import type { RunScopeResolver } from './price-scope-resolver';
import type { RunContext } from './run-context';
import type { ObservedPlace } from './run-report';
import { RunReportSink } from './run-report.sink';
import type {
  AvailabilitySent,
  RunClaimCounts,
  SourceEntryAvailabilityWriter,
  StoredClaim,
} from './source-entry-availability';
import type {
  PriceConflict,
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
    sizeUnit: null,
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
    /** What sending the run's ready claims answered (plan 0182). */
    sent?: Partial<AvailabilitySent>;
    /** What became of the claims the run stored (plan 0182). */
    counts?: Partial<RunClaimCounts>;
    /** The offers with no price catalog created at the end of the run. */
    pricelessOffers?: number;
    /** The products whose offer could not be sent. */
    pricelessOffersFailed?: number;
    /** What the ingest counted, which the sink carries into the report. */
    counters?: Partial<SourceIngestCounters>;
    /** The conflicts the ingest named (plan 0191). */
    priceConflicts?: PriceConflict[];
    /** The scopes this run copies to, by the scope copied from (plan 0118). */
    copies?: Record<string, string[]>;
    /** What the ingest said its copies wrote. */
    pricesCopied?: Record<string, number>;
    pricedScopes?: string[];
    /** What the run writes of what it read (plan 0119). */
    writes?: HarvestRunWrites;
    /** Products whose pack count catalog already holds (plan 0162). */
    packCountSet?: string[];
  } = {}
) {
  const pushed: SourceObservation[][] = [];
  const opened: unknown[] = [];
  /** Every outcome a push answered, which is what `close` answers for the run. */
  const outcomes: unknown[] = [];
  const closed = jest.fn(async () => ({
    outcomes,
    counters: {
      created: 0,
      updated: 0,
      unchanged: 0,
      pricesRecorded: 0,
      pricesWritten: 0,
      pricesConfirmed: 0,
      ...options.counters,
    },
    copies: {
      pricedScopes: new Set(options.pricedScopes ?? []),
      pricesCopied: new Map(Object.entries(options.pricesCopied ?? {})),
    },
    priceConflicts: options.priceConflicts ?? [],
  }));
  const ingest = {
    open: jest.fn(async (_context: RunContext, input: unknown) => {
      opened.push(input);
      return {
        push: jest.fn(async (chunk: readonly SourceObservation[]) => {
          pushed.push([...chunk]);
          const answered = chunk.map((each) => {
            const resolved = options.resolves?.[each.externalId];
            return {
              entry: {
                // The row the observation was written to, bound or not.
                id: `entry-${each.externalId}`,
                externalId: each.externalId,
                itemId: resolved?.itemId ?? null,
                // The row holds what the observation stated (plan 0162).
                packCount: each.packCount ?? null,
              } as SourceCatalogEntry,
              created: true,
              rung: 1 as const,
              itemId: resolved?.active ? resolved.itemId : null,
            };
          });
          outcomes.push(...answered);
          return answered;
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
    // Catalog's rule, restated for the double: a count is written only where
    // the product has none. The real statement is proved against Postgres in
    // catalog's `item-pack-count.integration.spec.ts`.
    fillPackCounts: jest.fn(async (entries: PackCountFill[]) => ({
      written: entries.filter(
        (entry) => !options.packCountSet?.includes(entry.itemId)
      ).length,
    })),
  } as unknown as CatalogClient;

  // Where per shop claims are kept and what sends them (plan 0182). Which
  // stored claims are ready is a query over real Postgres, proved in
  // `source-entry-availability.integration.spec.ts`; here it answers what a
  // test says it sent.
  const storedClaims: StoredClaim[] = [];
  const availability = {
    store: jest.fn(async (claims: readonly StoredClaim[]) => {
      storedClaims.push(...claims);
      return claims.length;
    }),
    writeForRun: jest.fn(async () => ({
      written: 0,
      shops: 0,
      conflicts: [],
      pricelessOffers: 0,
      ...options.sent,
    })),
    countsForRun: jest.fn(async () => ({
      stored: storedClaims.length,
      written: 0,
      waitingForBinding: 0,
      waitingForShop: 0,
      ...options.counts,
    })),
    writePricelessOffersForRun: jest.fn(async () => ({
      written: options.pricelessOffers ?? 0,
      failed: options.pricelessOffersFailed ?? 0,
    })),
  } as unknown as SourceEntryAvailabilityWriter;

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
      copiesOf: (scopeId) => options.copies?.[scopeId] ?? [],
      writes: options.writes,
    },
    { ingest, scopes, places, shops, catalog, entries, availability }
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
    availability,
    storedClaims,
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

  /**
   * Plan 0191: the count said that a price was withheld and not for which
   * product, so finding the pair was a query. The report names it.
   */
  it('names the price conflicts the ingest counted, and no more than a report can hold', async () => {
    const conflict = (n: number): PriceConflict => ({
      itemId: `item-${n}`,
      priceScopeId: 'scope-1',
      entryIds: [`a-${n}`, `b-${n}`],
      firstWasSent: n % 2 === 0,
    });
    const many = Array.from({ length: 250 }, (_, n) => conflict(n));
    const { sink } = build({
      counters: { pricesConflicted: many.length },
      priceConflicts: many,
    });

    sink.product(observation({ externalId: 'a' }));
    const written = await sink.drain();

    // The count is the whole number. The names are the first two hundred.
    expect(written.pricesConflicted).toBe(250);
    expect(written.priceConflicts).toHaveLength(200);
    expect(written.priceConflicts[0]).toEqual(conflict(0));
  });

  describe('the pack count fill (plan 0162, section 3)', () => {
    it('sends every bound product with a count, once, and counts what catalog wrote', async () => {
      const { sink, catalog } = build({
        resolves: {
          six: { itemId: 'item-six', active: true },
          sixAgain: { itemId: 'item-six', active: true },
          kept: { itemId: 'item-kept', active: true },
          single: { itemId: 'item-single', active: true },
        },
        packCountSet: ['item-kept'],
      });

      sink.product(observation({ externalId: 'six', packCount: 6 }));
      sink.product(observation({ externalId: 'sixAgain', packCount: 6 }));
      sink.product(observation({ externalId: 'kept', packCount: 12 }));
      sink.product(observation({ externalId: 'single', packCount: null }));
      const written = await sink.drain();

      expect(catalog.fillPackCounts).toHaveBeenCalledTimes(1);
      expect(catalog.fillPackCounts).toHaveBeenCalledWith([
        { itemId: 'item-six', packCount: 6 },
        { itemId: 'item-kept', packCount: 12 },
      ]);
      // The product whose count was set already is sent, and catalog keeps it.
      expect(written.packCountsFilled).toBe(1);
      expect(written.packCountConflicts).toEqual([]);
    });

    it('sends nothing for a row that is not bound, or bound only as a proposal', async () => {
      const { sink, catalog } = build({
        resolves: { proposed: { itemId: 'item-p', active: false } },
      });

      sink.product(observation({ externalId: 'proposed', packCount: 6 }));
      sink.product(observation({ externalId: 'loose', packCount: 6 }));
      const written = await sink.drain();

      expect(catalog.fillPackCounts).not.toHaveBeenCalled();
      expect(written.packCountsFilled).toBe(0);
    });

    it('leaves out a product whose rows disagree, and names it in the report', async () => {
      const { sink, catalog } = build({
        resolves: {
          four: { itemId: 'item-merged', active: true },
          six: { itemId: 'item-merged', active: true },
          fine: { itemId: 'item-fine', active: true },
        },
      });

      sink.product(observation({ externalId: 'six', packCount: 6 }));
      sink.product(observation({ externalId: 'four', packCount: 4 }));
      sink.product(observation({ externalId: 'fine', packCount: 3 }));
      const written = await sink.drain();

      expect(catalog.fillPackCounts).toHaveBeenCalledWith([
        { itemId: 'item-fine', packCount: 3 },
      ]);
      expect(written.packCountConflicts).toEqual([
        { itemId: 'item-merged', packCounts: [4, 6] },
      ]);
    });

    it('receives no count from a dimension (plan 0183)', async () => {
      // The fill is unchanged. What changed is what the readers hand it:
      // `125x157 cm` used to arrive as a pack of 125 and `5x1.2 m` as a pack
      // of 5, and the fill wrote both onto the product.
      const { sink, catalog } = build({
        resolves: {
          cloth: { itemId: 'item-cloth', active: true },
          sheet: { itemId: 'item-sheet', active: true },
          jamonCloth: { itemId: 'item-cloth', active: true },
          cans: { itemId: 'item-cans', active: true },
        },
      });

      sink.product(
        observation({
          externalId: 'cloth',
          packCount: dezaPackCount('Mantel rectangular ALTEZA 125x157 cm'),
        })
      );
      sink.product(
        observation({
          externalId: 'sheet',
          packCount: dezaPackCount('Sábana ajustable ALTEZA 5x1.2 m'),
        })
      );
      sink.product(
        observation({
          externalId: 'jamonCloth',
          packCount: elJamonSize('mantel rectangular, 125x157 cm').packCount,
        })
      );
      sink.product(
        observation({
          externalId: 'cans',
          packCount: dezaPackCount('Cerveza MAHOU 6x33 cl'),
        })
      );
      const written = await sink.drain();

      expect(catalog.fillPackCounts).toHaveBeenCalledTimes(1);
      expect(catalog.fillPackCounts).toHaveBeenCalledWith([
        { itemId: 'item-cans', packCount: 6 },
      ]);
      expect(written.packCountConflicts).toEqual([]);
    });

    it('splits a long list into calls catalog accepts', async () => {
      const resolves: Record<string, { itemId: string; active: boolean }> = {};
      for (let i = 0; i < 1001; i += 1) {
        resolves[`p${i}`] = { itemId: `item-${i}`, active: true };
      }
      const { sink, catalog } = build({ resolves });

      for (let i = 0; i < 1001; i += 1) {
        sink.product(observation({ externalId: `p${i}`, packCount: 6 }));
      }
      const written = await sink.drain();

      expect(catalog.fillPackCounts).toHaveBeenCalledTimes(2);
      expect(written.packCountsFilled).toBe(1001);
    });
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

  it('writes the same availability at every scope the walked one is copied to (plan 0118)', async () => {
    const { sink, catalog } = build({
      resolves: { seen: { itemId: 'item-seen', active: true } },
      tracked: [{ externalId: 'gone', itemId: 'item-gone' }],
      copies: { [SCOPE]: ['scope-w2', 'scope-region'] },
    });

    sink.product(observation({ externalId: 'seen' }));
    sink.assortmentComplete(null);
    const written = await sink.drain();

    const calls = (catalog.setAvailability as jest.Mock).mock.calls as Array<
      [string, Array<{ itemId: string; available: boolean }>]
    >;
    expect(calls.map(([scopeId]) => scopeId)).toEqual([
      SCOPE,
      'scope-w2',
      'scope-region',
    ]);
    // The negative half is copied too: it is part of the one statement.
    for (const [, entries] of calls) {
      expect(entries).toEqual(calls[0][1]);
      expect(entries).toContainEqual({ itemId: 'item-gone', available: false });
    }
    // The walked scope's number keeps its meaning, and the copies are apart.
    expect(written.availabilityWritten).toBe(2);
    expect(written.availabilityCopied).toEqual({ [SCOPE]: 4 });
  });

  it('carries what the copies wrote into the result', async () => {
    const { sink } = build({
      pricedScopes: [SCOPE],
      pricesCopied: { [SCOPE]: 12 },
    });

    sink.product(observation({ externalId: 'a' }));
    const written = await sink.drain();

    expect(written.pricedScopes).toEqual([SCOPE]);
    expect(written.pricesCopied).toEqual({ [SCOPE]: 12 });
  });

  it('hands the ingest the copies, so a price is copied where it is written', async () => {
    const { sink, opened } = build({ copies: { [SCOPE]: ['scope-w2'] } });

    sink.product(observation({ externalId: 'a' }));
    await sink.drain();

    const copiesOf = (
      opened[0] as { copiesOf: (scopeId: string) => readonly string[] }
    ).copiesOf;
    expect(copiesOf(SCOPE)).toEqual(['scope-w2']);
    expect(copiesOf('scope-w2')).toEqual([]);
  });

  describe('writes (plan 0119)', () => {
    /** A walk that names one product, lacks another and states a shop claim. */
    async function walk(writes: HarvestRunWrites) {
      const built = build({
        writes,
        resolves: { seen: { itemId: 'item-seen', active: true } },
        tracked: [{ externalId: 'gone', itemId: 'item-gone' }],
        copies: { [SCOPE]: ['scope-w2'] },
        shops: [
          {
            id: 'shop-T1',
            externalId: 'T1',
            printedName: 'Centro',
            supermarketLocationId: 'loc-1',
            status: SourceLocationStatus.ACTIVE,
          } as Partial<SourceLocation>,
        ],
      });
      built.sink.product(observation({ externalId: 'seen' }));
      built.sink.availability({
        externalId: 'seen',
        available: true,
        shopCode: 'T1',
      });
      built.sink.assortmentComplete(null);
      const written = await built.sink.drain();
      return { ...built, written };
    }

    it('writes no availability, at the scope, its copies or a shop, for PRICES', async () => {
      const { catalog, shopsObserved, written, pushed, availability } =
        await walk(HarvestRunWrites.PRICES);

      // The products still reach the ingest, which writes the prices.
      expect(pushed.flat().map((each) => each.externalId)).toEqual(['seen']);
      expect(catalog.setAvailability).not.toHaveBeenCalled();
      // A shop claim is not even stored: this run states no stock at all.
      expect(availability.store).not.toHaveBeenCalled();
      expect(availability.writeForRun).not.toHaveBeenCalled();
      expect(shopsObserved).toEqual([]);
      expect(written.availabilityWritten).toBe(0);
      expect(written.availabilityCopied).toEqual({});
    });

    it('writes availability at the scope, its copies and a shop, for AVAILABILITY', async () => {
      const { catalog, written, availability } = await walk(
        HarvestRunWrites.AVAILABILITY
      );

      const scopes = (catalog.setAvailability as jest.Mock).mock.calls.map(
        ([scopeId]) => scopeId
      );
      expect(scopes).toEqual([SCOPE, 'scope-w2']);
      expect(availability.store).toHaveBeenCalledTimes(1);
      expect(availability.writeForRun).toHaveBeenCalledTimes(1);
      expect(written.availabilityCopied).toEqual({ [SCOPE]: 2 });
    });

    it('hands the ingest what the run writes, which is where prices are skipped', async () => {
      const { opened } = await walk(HarvestRunWrites.AVAILABILITY);

      expect(opened[0]).toMatchObject({
        writes: HarvestRunWrites.AVAILABILITY,
      });
    });

    it('pushes a product reported from the listing, and counts it as named', async () => {
      const { sink, pushed, catalog } = build({
        resolves: { seen: { itemId: 'item-seen', active: true } },
        tracked: [{ externalId: 'seen', itemId: 'item-seen' }],
      });

      sink.product({
        externalId: 'seen',
        detailFetched: false,
        observedAt: new Date('2026-09-09T10:00:00.000Z'),
        prices: [],
      });
      sink.assortmentComplete(null);
      await sink.drain();

      expect(pushed.flat()).toEqual([
        expect.objectContaining({ externalId: 'seen', detailFetched: false }),
      ]);
      // A listed product is stocked whether its detail was read or not.
      expect((catalog.setAvailability as jest.Mock).mock.calls[0][1]).toEqual([
        { itemId: 'item-seen', available: true },
      ]);
    });
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

  describe('per shop availability (plans 0084 and 0182)', () => {
    const shop = (
      code: string,
      supermarketLocationId: string | null
    ): Partial<SourceLocation> => ({
      id: `shop-${code}`,
      externalId: code,
      printedName: `Shop ${code}`,
      supermarketLocationId,
      status: supermarketLocationId
        ? SourceLocationStatus.ACTIVE
        : SourceLocationStatus.UNMAPPED,
    });

    it('stores every claim, whether or not the row is bound or the shop is mapped', async () => {
      // The first run of a chain: nothing resolves to a product, and one of the
      // two shops is mapped to nothing. Every claim used to be dropped here,
      // the first kind for having no item and the second for having no shop.
      const { sink, storedClaims, shopsObserved, catalog } = build({
        shops: [shop('T1', 'loc-1'), shop('C1', null)],
      });

      sink.product(observation({ externalId: 'p1' }));
      sink.product(observation({ externalId: 'p2' }));
      for (const externalId of ['p1', 'p2']) {
        sink.availability({
          externalId,
          shopCode: 'T1',
          shopName: 'Shop T1',
          available: true,
        });
        // A shop the popup did not name: the negative is a claim too.
        sink.availability({
          externalId,
          shopCode: 'C1',
          shopName: 'Shop C1',
          available: false,
        });
      }
      await sink.drain();

      expect(shopsObserved[0]).toEqual([
        { externalId: 'T1', printedName: 'Shop T1' },
        { externalId: 'C1', printedName: 'Shop C1' },
      ]);
      // Kept against the source's own row and the source's own shop.
      expect(storedClaims).toEqual([
        { entryId: 'entry-p1', sourceLocationId: 'shop-T1', available: true },
        { entryId: 'entry-p1', sourceLocationId: 'shop-C1', available: false },
        { entryId: 'entry-p2', sourceLocationId: 'shop-T1', available: true },
        { entryId: 'entry-p2', sourceLocationId: 'shop-C1', available: false },
      ]);
      // The sink itself sends nothing: what is ready is read from the table.
      expect(catalog.setLocationAvailability).not.toHaveBeenCalled();
    });

    it('stamps what it stores with the run, and sends what that run made ready', async () => {
      const { sink, availability } = build({
        resolves: { p1: { itemId: 'item-1', active: false } },
        shops: [shop('T1', 'loc-1')],
        sent: { written: 3, shops: 1 },
      });

      sink.product(observation({ externalId: 'p1' }));
      sink.availability({ externalId: 'p1', shopCode: 'T1', available: true });
      const written = await sink.drain();

      expect((availability.store as jest.Mock).mock.calls[0][1]).toBe(RUN);
      expect(availability.writeForRun).toHaveBeenCalledWith(RUN, CHAIN);
      expect(written.shopsWritten).toBe(1);
      expect(written.availabilityWritten).toBe(3);
    });

    it('drops a claim about a product the run did not report', async () => {
      const { sink, storedClaims } = build({ shops: [shop('T1', 'loc-1')] });

      sink.product(observation({ externalId: 'p1' }));
      sink.availability({
        externalId: 'never-reported',
        shopCode: 'T1',
        available: true,
      });
      await sink.drain();

      // There is no row to keep it against.
      expect(storedClaims).toEqual([]);
    });

    it('names an unmapped shop, and still finishes', async () => {
      // Plan 0084, section 6: the row is what the back office shows. Since
      // plan 0182 its claims are stored, and mapping the shop sends them.
      const { sink, storedClaims } = build({
        resolves: { p1: { itemId: 'item-1', active: false } },
        shops: [shop('C1', null)],
      });

      sink.product(observation({ externalId: 'p1' }));
      sink.availability({
        externalId: 'p1',
        shopCode: 'C1',
        shopName: 'Shop C1',
        available: true,
      });
      const written = await sink.drain();

      expect(written.shopsUnmapped).toEqual([{ code: 'C1', name: 'Shop C1' }]);
      expect(storedClaims).toHaveLength(1);
    });

    it('carries the three counts into the result', async () => {
      const { sink } = build({
        shops: [shop('T1', 'loc-1')],
        counts: {
          stored: 10,
          written: 4,
          waitingForBinding: 5,
          waitingForShop: 1,
        },
      });

      sink.product(observation({ externalId: 'p1' }));
      sink.availability({ externalId: 'p1', shopCode: 'T1', available: true });
      const written = await sink.drain();

      expect(written).toMatchObject({
        claimsStored: 10,
        claimsWritten: 4,
        // Waiting for a binding or a shop, and the two it is made of.
        claimsWaiting: 6,
        claimsWaitingForBinding: 5,
        claimsWaitingForShop: 1,
      });
    });

    describe('the offer with no price, at the end of a run', () => {
      it('asks for the offers of the rows this run saw, last, and counts what catalog created', async () => {
        const { sink, availability } = build({
          resolves: { p1: { itemId: 'item-1', active: true } },
          shops: [shop('T1', 'loc-1')],
          pricelessOffers: 7,
        });

        sink.product(observation({ externalId: 'p1' }));
        sink.availability({
          externalId: 'p1',
          shopCode: 'T1',
          available: true,
        });
        const written = await sink.drain();

        expect(availability.writePricelessOffersForRun).toHaveBeenCalledTimes(
          1
        );
        expect(availability.writePricelessOffersForRun).toHaveBeenCalledWith(
          RUN,
          CHAIN
        );
        expect(written.pricelessOffersWritten).toBe(7);
        expect(written.pricelessOffersFailed).toBe(0);
        // After the shop claims, so a row they derived is one it leaves alone.
        const order = (mock: unknown) =>
          (mock as jest.Mock).mock.invocationCallOrder[0];
        expect(order(availability.writeForRun)).toBeLessThan(
          order(availability.writePricelessOffersForRun)
        );
      });

      it('carries the products that could not be offered into the result, beside what was written', async () => {
        const { sink } = build({
          pricelessOffers: 500,
          pricelessOffersFailed: 500,
        });

        sink.product(observation({ externalId: 'p1' }));
        const written = await sink.drain();

        expect(written).toMatchObject({
          pricelessOffersWritten: 500,
          pricelessOffersFailed: 500,
        });
      });

      it('asks for none in a run that reported no product', async () => {
        const { sink, availability } = build();

        const written = await sink.drain();

        expect(availability.writePricelessOffersForRun).not.toHaveBeenCalled();
        expect(written.pricelessOffersWritten).toBe(0);
      });

      it('asks for none in a run that writes prices only (plan 0119)', async () => {
        const { sink, availability } = build({
          writes: HarvestRunWrites.PRICES,
        });

        sink.product(observation({ externalId: 'p1' }));
        await sink.drain();

        expect(availability.writePricelessOffersForRun).not.toHaveBeenCalled();
      });
    });

    it('counts no claim for a run that stated none', async () => {
      const { sink, availability } = build();

      sink.product(observation({ externalId: 'p1' }));
      const written = await sink.drain();

      expect(availability.store).not.toHaveBeenCalled();
      expect(written).toMatchObject({
        claimsStored: 0,
        claimsWritten: 0,
        claimsWaiting: 0,
      });
    });

    it('reports an availability row a person owns rather than overwriting it', async () => {
      // Plan 0084, section 3: a person always wins, and the run reports the
      // disagreement rather than applying it.
      const { sink } = build({
        resolves: { p1: { itemId: 'item-1', active: false } },
        shops: [shop('T1', 'loc-1')],
        sent: {
          conflicts: [
            { shop: 'T1', itemId: 'item-1', held: false, offered: true },
          ],
        },
      });

      sink.product(observation({ externalId: 'p1' }));
      sink.availability({ externalId: 'p1', shopCode: 'T1', available: true });
      const written = await sink.drain();

      expect(written.conflicts).toEqual([
        { shop: 'T1', itemId: 'item-1', held: false, offered: true },
      ]);
    });
  });
});
