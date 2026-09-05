import {
  PriceSourceKind,
  SourceEntryStatus,
  validateHarvestDocument,
  type HarvestDocument,
} from '@portfolio/luna-shopper/contracts';
import type { Repository } from 'typeorm';
import type {
  HarvestRun,
  SourceCatalogEntry,
  SourceEntryPrice,
} from '../entities';
import type { CatalogClient } from './catalog-client.service';
import { FileImportRunner } from './file-import.runner';
import { buildHarvestDocument, digestOf, producerName } from './harvest-export';
import type { RunContext } from './run-context';
import { SourceIngest } from './source-ingest';

/**
 * A run, as a file (plan 0086, sections 6.2 and 12).
 *
 * The three things the round trip depends on: the export holds the rows the run
 * observed **and their prices for its own scope**, it holds **no decision**, and
 * what it produces is a document the import can read.
 */

const RUN = 'run-monday';
const CHAIN = '11111111-1111-4111-8111-111111111111';
const NATIONAL = '22222222-2222-4222-8222-222222222222';
const CORDOBA = '33333333-3333-4333-8333-333333333333';
const PRODUCED = new Date('2026-09-10T09:00:00.000Z');

function price(overrides: Partial<SourceEntryPrice> = {}): SourceEntryPrice {
  return {
    id: 'sep-1',
    entryId: 'e-1',
    priceScopeId: NATIONAL,
    price: 0.89,
    currency: 'EUR',
    unitPrice: 0.89,
    unitPriceLabel: '€/L',
    validFrom: null,
    validUntil: null,
    details: null,
    observedAt: new Date('2026-09-09T06:00:00.000Z'),
    runId: RUN,
    createdAt: PRODUCED,
    updatedAt: PRODUCED,
    ...overrides,
  } as SourceEntryPrice;
}

function entry(
  overrides: Partial<SourceCatalogEntry> = {}
): SourceCatalogEntry {
  return {
    id: 'e-1',
    supermarketId: CHAIN,
    externalId: '4241',
    sourceKind: PriceSourceKind.OFFICIAL_API,
    name: 'Leche semidesnatada Hacendado',
    brand: 'Hacendado',
    ean: '8480000123456',
    unitSize: 1,
    sizeFormat: '1 L',
    categoryPath: ['Lácteos', 'Leche'],
    url: 'https://example.invalid/4241',
    extra: { page: 3, raw_text: ['LECHE 0,89'] },
    timesSeen: 2,
    firstSeenAt: PRODUCED,
    lastSeenAt: PRODUCED,
    firstRunId: RUN,
    lastRunId: RUN,
    // A decision, which is exactly what must not reach the file.
    itemId: 'item-local-1',
    candidateEntryId: null,
    status: SourceEntryStatus.ACTIVE,
    matchedBy: null,
    confidence: 1,
    decidedAt: PRODUCED,
    prices: [price()],
    createdAt: PRODUCED,
    updatedAt: PRODUCED,
    ...overrides,
  } as SourceCatalogEntry;
}

function build(
  entries: SourceCatalogEntry[],
  priceScopeId: string | null = NATIONAL
): Record<string, unknown> {
  return buildHarvestDocument({
    run: { id: RUN, supermarketId: CHAIN, priceScopeId },
    entries,
    producedAt: PRODUCED,
  }) as unknown as Record<string, unknown>;
}

function productsOf(document: Record<string, unknown>) {
  return document['products'] as Record<string, unknown>[];
}

describe('buildHarvestDocument', () => {
  it('names the harvester and the run, and fills the three hints', async () => {
    const document = build([entry()]);

    expect(document['schema_version']).toBe(1);
    // The run rides in the name because `producer` has three fields and none of
    // them is a run: the file schema is closed, and a field for one producer's
    // private handle is not one a file schema should carry.
    expect(document['producer']).toEqual({
      name: producerName(RUN),
      version: expect.any(String),
      produced_at: PRODUCED.toISOString(),
    });
    expect(producerName(RUN)).toContain(RUN);
    expect(document['hints']).toEqual({
      chain_id: CHAIN,
      price_scope_id: NATIONAL,
      source_kind: PriceSourceKind.OFFICIAL_API,
    });
  });

  it('holds the source group and no decision at all', async () => {
    const [product] = productsOf(build([entry()]));

    expect(product).toMatchObject({
      external_id: '4241',
      name: 'Leche semidesnatada Hacendado',
      brand: 'Hacendado',
      ean: '8480000123456',
      size: { label: '1 L', quantity: 1 },
      category_path: ['Lácteos', 'Leche'],
      url: 'https://example.invalid/4241',
      extra: { page: 3, raw_text: ['LECHE 0,89'] },
    });
    // An `itemId` means nothing on another cluster, and an EAN resolves there
    // through rung 2. So the decision stays behind (section 6.2).
    expect(Object.keys(product)).not.toContain('status');
    expect(Object.keys(product)).not.toContain('item_id');
    expect(Object.keys(product)).not.toContain('matched_by');
    expect(Object.keys(product)).not.toContain('confidence');
  });

  it('takes the run scope price and no other scope', async () => {
    const document = build([
      entry({
        prices: [
          price({ priceScopeId: NATIONAL, price: 1.19 }),
          price({ id: 'sep-2', priceScopeId: CORDOBA, price: 1.09 }),
        ],
      }),
    ]);

    expect(productsOf(document)[0]['price']).toEqual({
      amount: 1.19,
      currency: 'EUR',
    });
  });

  it('writes no price for a source that states none, which is DEZA', async () => {
    const document = build(
      [
        entry({
          sourceKind: PriceSourceKind.OFFICIAL_WEB,
          prices: [],
          ean: null,
        }),
      ],
      NATIONAL
    );
    const [product] = productsOf(document);

    expect(Object.keys(product)).not.toContain('price');
    expect(Object.keys(product)).not.toContain('unit_price');
    expect((document['hints'] as Record<string, unknown>)['source_kind']).toBe(
      PriceSourceKind.OFFICIAL_WEB
    );
  });

  it('states a window as the local days it was printed as, not the exclusive bound', async () => {
    // `validUntil` is the local midnight *after* the last valid day, so a file
    // that said "to 23 September" stored the 24th. Exporting the 24th would
    // extend every leaflet by a day on every round trip.
    const document = build([
      entry({
        sourceKind: PriceSourceKind.OFFICIAL_LEAFLET,
        prices: [
          price({
            validFrom: new Date('2026-09-09T22:00:00.000Z'),
            validUntil: new Date('2026-09-23T22:00:00.000Z'),
          }),
        ],
      }),
    ]);

    expect(productsOf(document)[0]['validity']).toEqual({
      from: '2026-09-10',
      until: '2026-09-23',
    });
  });

  it('carries a digest taken over the document with its own digest emptied', async () => {
    const document = build([entry()]);
    const stated = document['sha256'] as string;

    expect(stated).toMatch(/^[0-9a-f]{64}$/);
    expect(digestOf(document as unknown as HarvestDocument)).toBe(stated);
  });

  it('produces a document the import can read', async () => {
    // The round trip in one assertion: what a walk exports is a file the same
    // backend's import accepts, which is what makes a crawl on one machine and a
    // cluster that may not crawl the same thing (section 6.2).
    const { valid, failures } = validateHarvestDocument(build([entry()]));

    expect(failures).toEqual([]);
    expect(valid).toBe(true);
  });

  it('omits a size a source never stated rather than writing an empty one', async () => {
    const [product] = productsOf(
      build([entry({ sizeFormat: null, unitSize: null })])
    );

    expect(Object.keys(product)).not.toContain('size');
  });
});

/**
 * The other half of the round trip: importing an export (exit criterion four).
 *
 * The export above is a pure function over rows, and this is the same runner a
 * real upload uses over fake repositories, so the two halves meet with no
 * database and no network between them. What it proves is the sentence section
 * 6.2 is built on: **a walk that ran where there was room for 4,383 requests
 * reaches a cluster that may not crawl, and that cluster's rows are what a walk
 * there would have produced.**
 */
describe('importing a run this backend exported', () => {
  const OTHER_CHAIN = '44444444-4444-4444-8444-444444444441';
  const OTHER_SCOPE = '44444444-4444-4444-8444-444444444442';
  const IMPORT_RUN = '44444444-4444-4444-8444-444444444443';

  /** The receiving side: a chain with no rows at all, and the import runner. */
  function receiver(document: HarvestDocument, items: unknown[] = []) {
    const saved: SourceCatalogEntry[] = [];
    let created = 0;
    const entries = {
      find: jest.fn(async () => [...saved]),
      create: jest.fn((row: SourceCatalogEntry) => {
        created += 1;
        return { id: `imported-${created}`, ...row };
      }),
      save: jest.fn(async (row: SourceCatalogEntry) => {
        if (!saved.includes(row)) {
          saved.push(row);
        }
        return row;
      }),
    } as unknown as Repository<SourceCatalogEntry>;

    const priceRows: Record<string, unknown>[] = [];
    const prices = {
      upsert: jest.fn(async (rows: Record<string, unknown>[]) => {
        priceRows.push(...rows);
        return undefined;
      }),
    } as unknown as Repository<SourceEntryPrice>;

    const catalog = {
      searchItems: jest.fn(async () => ({ items, nextCursor: null })),
      addPrices: jest.fn(async () => ({ inserted: 1, confirmed: 0 })),
    };

    const context = {
      runId: IMPORT_RUN,
      run: {
        id: IMPORT_RUN,
        input: {
          supermarketId: OTHER_CHAIN,
          priceScopeId: OTHER_SCOPE,
          sourceKind: PriceSourceKind.OFFICIAL_API,
          document,
        },
      } as unknown as HarvestRun,
      setStage: jest.fn(async () => undefined),
      setTotalPlanned: jest.fn(async () => undefined),
      report: jest.fn(async () => undefined),
      warn: jest.fn(),
      flush: jest.fn(async () => undefined),
    } as unknown as RunContext;

    const runner = new FileImportRunner(
      new SourceIngest(entries, prices, catalog as unknown as CatalogClient)
    );
    return { runner, context, saved, priceRows, catalog };
  }

  const importInto = (
    document: HarvestDocument,
    items: unknown[] = [],
    sourceKind: PriceSourceKind = PriceSourceKind.OFFICIAL_API
  ) => {
    const parts = receiver(document, items);
    return {
      ...parts,
      run: () =>
        parts.runner.run(parts.context, {
          supermarketId: OTHER_CHAIN,
          priceScopeId: OTHER_SCOPE,
          sourceKind,
        }),
    };
  };

  it('reproduces the rows, the prices and the ladder in an empty chain', async () => {
    const document = buildHarvestDocument({
      run: { id: RUN, supermarketId: CHAIN, priceScopeId: NATIONAL },
      entries: [
        entry(),
        entry({
          id: 'e-2',
          externalId: '7012',
          name: 'Queso curado mezcla Hacendado',
          // No EAN, so this one has nothing but its name to resolve through and
          // waits in the importing cluster's queue.
          ean: null,
          sizeFormat: 'kg',
          unitSize: 0.35,
          extra: null,
          prices: [
            price({ id: 'sep-2', entryId: 'e-2', price: 11.29, unitPrice: null, unitPriceLabel: null }),
          ],
        }),
      ],
      producedAt: PRODUCED,
    });
    const parts = importInto(document, [
      {
        id: 'item-milk',
        name: { es: 'Nothing alike', en: null },
        brand: null,
        ean: '8480000123456',
        unitSize: null,
      },
    ]);

    await parts.run();

    expect(parts.saved.map((row) => row.externalId)).toEqual(['4241', '7012']);
    expect(parts.saved[0]).toMatchObject({
      name: 'Leche semidesnatada Hacendado',
      brand: 'Hacendado',
      ean: '8480000123456',
      sizeFormat: '1 L',
      unitSize: 1,
      categoryPath: ['Lácteos', 'Leche'],
      url: 'https://example.invalid/4241',
      extra: { page: 3, raw_text: ['LECHE 0,89'] },
      // Stamped with what observed the price, not with the upload (section 6.2).
      sourceKind: PriceSourceKind.OFFICIAL_API,
    });

    // The ladder answers the way it would have on the machine that crawled: the
    // EAN resolves and the nameless cheese waits for a person.
    expect(parts.saved[0].status).toBe(SourceEntryStatus.ACTIVE);
    expect(parts.saved[1].status).toBe(SourceEntryStatus.UNRESOLVED);

    // Both prices are observed per scope, and only the resolved row is owed one
    // in catalog.
    expect(parts.priceRows.map((row) => row['price'])).toEqual([0.89, 11.29]);
    expect(parts.catalog.addPrices).toHaveBeenCalledTimes(1);
    expect(parts.catalog.addPrices.mock.calls[0][3]).toBe(
      PriceSourceKind.OFFICIAL_API
    );
    const sent = parts.catalog.addPrices.mock.calls[0][1] as {
      itemId: string;
    }[];
    expect(sent.map((each) => each.itemId)).toEqual(['item-milk']);
  });

  it('does not lengthen a window by a day on every round trip', async () => {
    const document = buildHarvestDocument({
      run: { id: RUN, supermarketId: CHAIN, priceScopeId: NATIONAL },
      entries: [
        entry({
          sourceKind: PriceSourceKind.OFFICIAL_LEAFLET,
          prices: [
            price({
              validFrom: new Date('2026-09-09T22:00:00.000Z'),
              validUntil: new Date('2026-09-23T22:00:00.000Z'),
            }),
          ],
        }),
      ],
      producedAt: PRODUCED,
    });
    const parts = importInto(
      document,
      [],
      PriceSourceKind.OFFICIAL_LEAFLET
    );

    await parts.run();

    // Out as inclusive local days, back in as the same exclusive instants.
    expect((parts.priceRows[0]['validFrom'] as Date).toISOString()).toBe(
      '2026-09-09T22:00:00.000Z'
    );
    expect((parts.priceRows[0]['validUntil'] as Date).toISOString()).toBe(
      '2026-09-23T22:00:00.000Z'
    );
  });
});
