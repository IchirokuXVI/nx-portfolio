import type { ConfigService } from '@nestjs/config';
import {
  ItemSourceMatch,
  SourceEntryStatus,
  SourceLocationStatus,
} from '@portfolio/luna-shopper/contracts';
import type { Repository } from 'typeorm';
import type {
  SourceCatalogEntry,
  SourceEntryPrice,
  SourceLocation,
  SupermarketSource,
} from '../entities';
import type { CatalogClient } from './catalog-client.service';
import { DezaCatalogRunner, entryKey } from './deza-catalog.runner';
import { startFakeListing, type FakeListing } from './deza-listing.fake';
import type { RunContext } from './run-context';
import { SourceIngest } from './source-ingest';
import type { SourceLocationService } from './source-location.service';

const CHAIN = '11111111-1111-4111-8111-111111111111';
const RUN = '33333333-3333-4333-8333-333333333333';

const SECTIONS = [
  {
    code: 'W010000000',
    name: 'FRIO',
    children: [{ code: 'W011', name: 'Carniceria' }],
  },
  {
    code: 'W050000000',
    name: 'PAN',
    children: [{ code: 'W051', name: 'Bolleria' }],
  },
];

/** 400 rows in one section: over the 300 the source answers, so it is capped. */
function cappedSection() {
  return Array.from({ length: 400 }, (_, index) => ({
    description: `Producto MARCA${index % 7} variante${index} ${index} g`,
    section: 'W011',
    shops: index % 3 === 0 ? ['T1', 'C1'] : ['T1'],
  }));
}

interface Built {
  runner: DezaCatalogRunner;
  context: RunContext;
  saved: SourceCatalogEntry[];
  catalog: {
    searchItems: jest.Mock;
    setLocationAvailability: jest.Mock;
    addPrices: jest.Mock;
  };
  priceUpsert: jest.Mock;
  observed: jest.Mock;
  report: Record<string, unknown>;
}

function build(listing: FakeListing, shops: Partial<SourceLocation>[]): Built {
  const saved: SourceCatalogEntry[] = [];
  const entries = {
    find: jest.fn(async () => [...saved]),
    create: jest.fn((row: SourceCatalogEntry) => ({
      id: `entry-${saved.length + 1}`,
      ...row,
    })),
    save: jest.fn(async (row: SourceCatalogEntry) => {
      const held = saved.find((each) => each.externalId === row.externalId);
      if (held) {
        Object.assign(held, row);
        return held;
      }
      saved.push(row);
      return row;
    }),
  } as unknown as Repository<SourceCatalogEntry>;

  // A crawl states no price, so nothing may reach this repository at all.
  const priceUpsert = jest.fn(async () => undefined);
  const prices = {
    upsert: priceUpsert,
  } as unknown as Repository<SourceEntryPrice>;

  const catalog = {
    // One catalog item whose Spanish name matches the first product exactly, so
    // the name rung fires for it and for nothing else.
    searchItems: jest.fn(async () => ({
      items: [
        {
          id: 'item-1',
          name: { es: 'Producto MARCA0 variante0', en: null },
          brand: 'MARCA0',
          ean: null,
          unitSize: null,
        },
      ],
      nextCursor: null,
    })),
    setLocationAvailability: jest.fn(async () => ({
      written: 1,
      skipped: 0,
      conflicts: [],
    })),
    addPrices: jest.fn(async () => ({ inserted: 0, confirmed: 0 })),
  };

  const observed = jest.fn(async () => shops as SourceLocation[]);
  const report: Record<string, unknown> = {};
  const context = {
    runId: RUN,
    signal: new AbortController().signal,
    acquire: async () => undefined,
    setStage: jest.fn(async () => undefined),
    setTotalPlanned: jest.fn(async () => undefined),
    report: jest.fn(async () => undefined),
    flush: jest.fn(async () => undefined),
    setReport: jest.fn(async (value: Record<string, unknown>) => {
      Object.assign(report, value);
    }),
  } as unknown as RunContext;

  const ingest = new SourceIngest(
    entries,
    prices,
    catalog as unknown as CatalogClient
  );
  const runner = new DezaCatalogRunner(
    ingest,
    catalog as unknown as CatalogClient,
    { observe: observed } as unknown as SourceLocationService,
    {
      getOrThrow: () => ({ userAgent: 'test' }),
    } as unknown as ConfigService
  );

  return { runner, context, saved, catalog, observed, report, priceUpsert };
}

const source = (
  config: Record<string, unknown>,
  workers = 1
): SupermarketSource =>
  ({
    adapterKey: 'deza-web',
    workers,
    config,
  }) as unknown as SupermarketSource;

describe('DezaCatalogRunner (plan 0085)', () => {
  let listing: FakeListing;

  afterEach(async () => {
    await listing?.close();
  });

  it('crawls an uncapped section once and does not split it', async () => {
    listing = await startFakeListing(SECTIONS, [
      {
        description: 'Pan de molde ALTEZA 400 g',
        section: 'W051',
        shops: ['T1'],
      },
      {
        description: 'Croissants ALTEZA 360 g',
        section: 'W051',
        shops: ['T1'],
      },
    ]);
    const { runner, context, saved } = build(listing, []);

    await runner.run(
      context,
      { supermarketId: CHAIN },
      source({ baseUrl: listing.url })
    );

    // Two sections, one query each, and neither narrowed by a term.
    expect(listing.queries).toEqual(['W011|', 'W051|']);
    expect(saved).toHaveLength(2);
  });

  it('splits a capped section by the most frequent unused term', async () => {
    listing = await startFakeListing(SECTIONS, cappedSection());
    const { runner, context } = build(listing, []);

    await runner.run(
      context,
      { supermarketId: CHAIN },
      source({ baseUrl: listing.url, sectionQueryBudget: 4 })
    );

    const carniceria = listing.queries.filter((query) =>
      query.startsWith('W011|')
    );
    expect(carniceria[0]).toBe('W011|');
    // Every query after the first carries a term drawn from the descriptions the
    // section had already shown, which is the split section 3 describes.
    expect(carniceria.slice(1).every((query) => query !== 'W011|')).toBe(true);
    expect(carniceria).toHaveLength(4);
  });

  it('stops at the budget and names the section with its open queries', async () => {
    listing = await startFakeListing(SECTIONS, cappedSection());
    const { runner, context, report } = build(listing, []);

    await runner.run(
      context,
      { supermarketId: CHAIN },
      source({ baseUrl: listing.url, sectionQueryBudget: 3 })
    );

    expect(
      listing.queries.filter((query) => query.startsWith('W011|'))
    ).toHaveLength(3);
    // Nothing pretends the catalog is whole: the section is named, with **every**
    // query that was still at the ceiling when the budget ran out. `producto`
    // appears in all 400 descriptions, so narrowing by it narrows nothing and it
    // is open too.
    expect(report['incompleteSections']).toEqual([
      {
        code: 'W011',
        name: 'Carniceria',
        openQueries: ['(the whole section)', 'producto'],
      },
    ]);
  });

  it('writes one entry for a description the listing repeats', async () => {
    // One product filed under two sections comes back in both.
    const repeated = {
      description: 'Perlas de perfume LENOR classic 195 g',
      shops: ['T1'],
    };
    listing = await startFakeListing(SECTIONS, [
      { ...repeated, section: 'W011' },
      { ...repeated, section: 'W051' },
    ]);
    const { runner, context, saved } = build(listing, []);

    await runner.run(
      context,
      { supermarketId: CHAIN },
      source({ baseUrl: listing.url })
    );

    expect(saved).toHaveLength(1);
    expect(saved[0].externalId).toBe(
      entryKey('Perlas de perfume LENOR classic', '195 g')
    );
    expect(saved[0]).toMatchObject({
      name: 'Perlas de perfume LENOR classic',
      sizeFormat: '195 g',
      brand: 'LENOR',
    });
  });

  it('writes no price of any kind', async () => {
    listing = await startFakeListing(SECTIONS, [
      {
        description: 'Pan de molde ALTEZA 400 g',
        section: 'W051',
        shops: ['T1'],
      },
    ]);
    const { runner, context, saved, catalog, priceUpsert } = build(listing, []);

    await runner.run(
      context,
      { supermarketId: CHAIN },
      source({ baseUrl: listing.url })
    );

    // The price columns left the row in plan 0086, so "no price" is now two
    // absences: no `source_entry_prices` row for any scope, and nothing sent to
    // catalog.
    expect(priceUpsert).not.toHaveBeenCalled();
    expect(catalog.addPrices).not.toHaveBeenCalled();
    expect(saved[0]).toMatchObject({
      // No EAN either, so the EAN rung of the ladder never fires and every
      // automatic match here is a candidate.
      ean: null,
      status: SourceEntryStatus.UNRESOLVED,
    });
  });

  it('sends every mapped shop a value for every product, positive and negative', async () => {
    listing = await startFakeListing(SECTIONS, [
      {
        description: 'Producto MARCA0 variante0',
        section: 'W011',
        shops: ['T1'],
      },
    ]);
    const { runner, context, catalog, observed } = build(listing, [
      {
        externalId: 'T1',
        printedName: 'Jesús Rescatado',
        supermarketLocationId: 'loc-1',
        status: SourceLocationStatus.ACTIVE,
        matchedBy: ItemSourceMatch.NAME_SIZE,
      },
      {
        externalId: 'C1',
        printedName: 'SuperCash (Quemadas)',
        supermarketLocationId: 'loc-2',
        status: SourceLocationStatus.ACTIVE,
        matchedBy: ItemSourceMatch.MANUAL,
      },
    ]);

    await runner.run(
      context,
      { supermarketId: CHAIN },
      source({ baseUrl: listing.url })
    );

    expect(observed).toHaveBeenCalledWith(
      CHAIN,
      [{ externalId: 'T1', printedName: 'Jesús Rescatado' }],
      RUN
    );
    expect(catalog.setLocationAvailability).toHaveBeenCalledTimes(2);
    expect(catalog.setLocationAvailability.mock.calls[0][0]).toBe('loc-1');
    expect(catalog.setLocationAvailability.mock.calls[0][1]).toEqual([
      { itemId: 'item-1', available: true },
    ]);
    // The shop the popup did not name gets the negative, which is the whole
    // claim this source makes.
    expect(catalog.setLocationAvailability.mock.calls[1][1]).toEqual([
      { itemId: 'item-1', available: false },
    ]);
  });

  it('skips an unmapped shop, names it, and still finishes', async () => {
    listing = await startFakeListing(SECTIONS, [
      {
        description: 'Producto MARCA0 variante0',
        section: 'W011',
        shops: ['T1', 'C1'],
      },
    ]);
    const { runner, context, catalog, report } = build(listing, [
      {
        externalId: 'T1',
        printedName: 'Jesús Rescatado',
        supermarketLocationId: 'loc-1',
        status: SourceLocationStatus.ACTIVE,
        matchedBy: ItemSourceMatch.NAME_SIZE,
      },
      {
        externalId: 'C1',
        printedName: 'SuperCash (Quemadas)',
        supermarketLocationId: null,
        status: SourceLocationStatus.UNMAPPED,
        matchedBy: ItemSourceMatch.NAME_SIZE,
      },
    ]);

    await runner.run(
      context,
      { supermarketId: CHAIN },
      source({ baseUrl: listing.url })
    );

    expect(catalog.setLocationAvailability).toHaveBeenCalledTimes(1);
    expect(report['shopsUnmapped']).toEqual([
      { externalId: 'C1', printedName: 'SuperCash (Quemadas)' },
    ]);
    expect(report['shopsWritten']).toBe(1);
  });

  it('puts every request of every worker through the one shared gate', async () => {
    // The rate is one token bucket for the whole run (plan 0038, section 6.3):
    // four workers each pausing is four times the rate the owner set. Each
    // in flight query gets its own client, for the session cookie, so the gate
    // is the only thing they can share and every one of them has to await it.
    listing = await startFakeListing(
      SECTIONS,
      cappedSection().concat(
        Array.from({ length: 40 }, (_, index) => ({
          description: `Bolleria ALTEZA numero${index} ${index} g`,
          section: 'W051',
          shops: ['T1'],
        }))
      )
    );
    const { runner, context } = build(listing, []);
    let acquired = 0;
    (context as { acquire: () => Promise<void> }).acquire = async () => {
      acquired += 1;
    };

    await runner.run(
      context,
      { supermarketId: CHAIN },
      source({ baseUrl: listing.url, sectionQueryBudget: 3 }, 4)
    );

    // Both sections crawled at four workers, over many pages each.
    expect(listing.requests()).toBeGreaterThan(10);
    expect(acquired).toBe(listing.requests());
  });

  it('reports an availability row a person owns rather than overwriting it', async () => {
    listing = await startFakeListing(SECTIONS, [
      {
        description: 'Producto MARCA0 variante0',
        section: 'W011',
        shops: ['T1'],
      },
    ]);
    const { runner, context, catalog, report } = build(listing, [
      {
        externalId: 'T1',
        printedName: 'Jesús Rescatado',
        supermarketLocationId: 'loc-1',
        status: SourceLocationStatus.ACTIVE,
        matchedBy: ItemSourceMatch.NAME_SIZE,
      },
    ]);
    catalog.setLocationAvailability.mockResolvedValue({
      written: 0,
      skipped: 1,
      conflicts: [{ itemId: 'item-1', held: false, offered: true }],
    });

    await runner.run(
      context,
      { supermarketId: CHAIN },
      source({ baseUrl: listing.url })
    );

    expect(report['availabilityConflicts']).toEqual([
      { shop: 'T1', itemId: 'item-1', held: false, offered: true },
    ]);
  });
});
