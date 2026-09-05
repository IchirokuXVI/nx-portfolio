import {
  PriceSourceKind,
  SourceEntryStatus,
  validateHarvestDocument,
  type HarvestDocument,
} from '@portfolio/luna-shopper/contracts';
import type { SourceCatalogEntry, SourceEntryPrice } from '../entities';
import { buildHarvestDocument, digestOf, producerName } from './harvest-export';

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
