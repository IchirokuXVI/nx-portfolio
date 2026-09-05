import {
  HarvestWarningCode,
  PriceSourceKind,
  SourceEntryStatus,
  validateHarvestDocument,
  type HarvestDocument,
  type HarvestRunWarning,
} from '@portfolio/luna-shopper/contracts';
import type { Repository } from 'typeorm';
import type { HarvestRun, SourceCatalogEntry, SourceEntryPrice } from '../entities';
import eljamon from './__fixtures__/eljamon.vision.harvest-document.json';
import type { CatalogClient } from './catalog-client.service';
import { FileImportRunner } from './file-import.runner';
import { entryKey } from './matching';
import type { RunContext } from './run-context';
import { SourceIngest } from './source-ingest';

/**
 * The import, over the real schema and the regenerated El Jamón reading (plan
 * 0086, section 5).
 *
 * **It interprets nothing.** Everything the leaflet import of plan 0081 decided
 * here, which number on a tile is the price, belongs to the producer now. What
 * is left to pin is the mapping, one product to one observation, and the two
 * things only the import can know: that two products collide on the key it
 * computes, and what the outcomes are worth telling a person.
 */

const CHAIN = '11111111-1111-4111-8111-111111111111';
const SCOPE = '22222222-2222-4222-8222-222222222222';
const RUN = '33333333-3333-4333-8333-333333333333';

function document(over: Partial<HarvestDocument> = {}): HarvestDocument {
  return {
    schema_version: 1,
    sha256: 'a'.repeat(64),
    producer: { name: 'test', produced_at: '2026-09-04T18:02:11Z' },
    products: [],
    ...over,
  };
}

function build(options: {
  document: HarvestDocument;
  rows?: Partial<SourceCatalogEntry>[];
  items?: unknown[];
  storedWindow?: { validFrom: string; validUntil: string };
}) {
  const stored = (options.rows ?? []).map(
    (row, index) =>
      ({
        id: `held-${index + 1}`,
        supermarketId: CHAIN,
        sourceKind: PriceSourceKind.OFFICIAL_LEAFLET,
        status: SourceEntryStatus.UNRESOLVED,
        timesSeen: 1,
        itemId: null,
        candidateEntryId: null,
        matchedBy: null,
        confidence: 0,
        decidedAt: null,
        brand: null,
        ean: null,
        unitSize: null,
        sizeFormat: null,
        categoryPath: [],
        url: null,
        extra: null,
        ...row,
      }) as SourceCatalogEntry
  );
  const saved: SourceCatalogEntry[] = [];
  let created = 0;

  const entries = {
    find: jest.fn(async () => stored),
    create: jest.fn((row: SourceCatalogEntry) => {
      created += 1;
      return { id: `new-${created}`, ...row };
    }),
    save: jest.fn(async (row: SourceCatalogEntry) => {
      if (!saved.includes(row) && !stored.includes(row)) {
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
    searchItems: jest.fn(async () => ({
      items: options.items ?? [],
      nextCursor: null,
    })),
    addPrices: jest.fn(async () => ({ inserted: 1, confirmed: 0 })),
  };

  const warnings: HarvestRunWarning[] = [];
  const reported: Record<string, number>[] = [];
  const context = {
    runId: RUN,
    run: {
      id: RUN,
      input: {
        supermarketId: CHAIN,
        priceScopeId: SCOPE,
        document: options.document,
        ...(options.storedWindow ?? {}),
      },
    } as unknown as HarvestRun,
    setStage: jest.fn(async () => undefined),
    setTotalPlanned: jest.fn(async () => undefined),
    report: jest.fn(async (counters: Record<string, number>) => {
      reported.push(counters);
    }),
    warn: jest.fn((warning: HarvestRunWarning) => {
      warnings.push(warning);
    }),
    flush: jest.fn(async () => undefined),
  } as unknown as RunContext;

  const ingest = new SourceIngest(
    entries,
    prices,
    catalog as unknown as CatalogClient
  );
  return {
    runner: new FileImportRunner(ingest),
    context,
    saved,
    priceRows,
    catalog,
    warnings,
    reported,
  };
}

const input = {
  supermarketId: CHAIN,
  priceScopeId: SCOPE,
  sourceKind: PriceSourceKind.OFFICIAL_LEAFLET,
};

const codes = (warnings: HarvestRunWarning[]): HarvestWarningCode[] =>
  warnings.map((warning) => warning.code);

describe('FileImportRunner (plan 0086)', () => {
  it('makes an observation of a product with a price, and one without', async () => {
    const { runner, context, saved, priceRows } = build({
      document: document({
        validity: { from: '2026-09-10', until: '2026-09-23' },
        products: [
          {
            name: 'Leche semidesnatada',
            size: { label: '1 L', quantity: 1, unit: 'l' },
            price: { amount: 0.89, currency: 'EUR' },
          },
          { name: 'Cerveza Radler', size: { label: 'lata 33 cl' } },
        ],
      }),
    });

    await runner.run(context, input);

    expect(saved).toHaveLength(2);
    expect(saved[0]).toMatchObject({
      externalId: entryKey('Leche semidesnatada', '1 L'),
      name: 'Leche semidesnatada',
      sizeFormat: '1 L',
      unitSize: 1,
      sourceKind: PriceSourceKind.OFFICIAL_LEAFLET,
      status: SourceEntryStatus.UNRESOLVED,
    });
    // One price row, for the one product that stated a price. The other is in
    // the queue with nothing attached.
    expect(priceRows).toHaveLength(1);
    expect(priceRows[0]).toMatchObject({ price: 0.89, currency: 'EUR' });
  });

  it('writes the unit price alone for a product with no till price', async () => {
    const { runner, context, priceRows } = build({
      document: document({
        products: [
          {
            name: 'Solomillo de cerdo',
            size: { label: 'al corte' },
            unit_price: { amount: 6.95, currency: 'EUR', label: 'el kilo' },
          },
        ],
      }),
    });

    await runner.run(context, input);

    expect(priceRows[0]).toMatchObject({
      price: null,
      unitPrice: 6.95,
      unitPriceLabel: 'el kilo',
    });
  });

  it('gives two products with one key no price at all, and warns once each', async () => {
    const { runner, context, priceRows, warnings } = build({
      document: document({
        products: [
          {
            id: 'p-0004',
            name: 'Aceite de oliva virgen extra',
            size: { label: 'garrafa 5 L' },
            price: { amount: 19.95, currency: 'EUR' },
          },
          {
            id: 'p-0005',
            name: 'Aceite de oliva virgen extra',
            size: { label: 'garrafa 5 L' },
            price: { amount: 21.5, currency: 'EUR' },
          },
        ],
      }),
    });

    await runner.run(context, input);

    // Only the import can see this: two products colliding on the key it
    // computes is a fact about the file and about nothing else.
    expect(priceRows).toHaveLength(0);
    const duplicates = warnings.filter(
      (warning) => warning.code === HarvestWarningCode.DUPLICATE_KEY
    );
    expect(duplicates.map((warning) => warning.offerId)).toEqual([
      'p-0004',
      'p-0005',
    ]);
  });

  it("prefers a product's own validity over the document's", async () => {
    const { runner, context, priceRows } = build({
      document: document({
        validity: { from: '2026-09-10', until: '2026-09-23' },
        products: [
          {
            name: 'Leche',
            price: { amount: 0.89, currency: 'EUR' },
            validity: { from: '2026-09-12', until: '2026-09-14' },
          },
          { name: 'Pan', price: { amount: 1.1, currency: 'EUR' } },
        ],
      }),
      // The instants the spawn resolved for the document, which the second
      // product falls back to.
      storedWindow: {
        validFrom: '2026-09-09T22:00:00.000Z',
        validUntil: '2026-09-23T22:00:00.000Z',
      },
    });

    await runner.run(context, input);

    // Local midnight in Spain on 12 September, and exclusive midnight after the
    // 14th: a window "to the 14th" covers the whole of the 14th.
    expect((priceRows[0]['validFrom'] as Date).toISOString()).toBe(
      '2026-09-11T22:00:00.000Z'
    );
    expect((priceRows[0]['validUntil'] as Date).toISOString()).toBe(
      '2026-09-14T22:00:00.000Z'
    );
    expect((priceRows[1]['validFrom'] as Date).toISOString()).toBe(
      '2026-09-09T22:00:00.000Z'
    );
  });

  it('lands the extra bag on the row and on the price row, untouched', async () => {
    const extra = {
      page: 3,
      loyalty: { required: true },
      whatever: ['a producer knows'],
    };
    const { runner, context, saved, priceRows } = build({
      document: document({
        products: [
          { name: 'Leche', price: { amount: 0.89, currency: 'EUR' }, extra },
        ],
      }),
    });

    await runner.run(context, input);

    expect(saved[0].extra).toEqual(extra);
    expect(priceRows[0]['details']).toEqual(extra);
  });

  it("carries the document's own warnings onto the run", async () => {
    const { runner, context, warnings } = build({
      document: document({
        products: [{ name: 'Leche', price: { amount: 0.89, currency: 'EUR' } }],
        warnings: [
          {
            message: 'Page 22 is a competition entry form and holds no products.',
            extra: { page: 22 },
          },
        ],
      }),
    });

    await runner.run(context, input);

    // A producer's warning arrives as text: it decided something the harvester's
    // own codes cannot name.
    expect(warnings[0]).toEqual({
      code: HarvestWarningCode.EXTRACTOR,
      offerId: null,
      page: 22,
      name: null,
      message: 'Page 22 is a competition entry form and holds no products.',
    });
  });

  it('records the warning each outcome implies, and nothing for an ACTIVE row', async () => {
    const { runner, context, warnings, reported } = build({
      document: document({
        products: [
          // Rung 1 onto a rejected row.
          { id: 'p-rej', name: 'Cerveza', size: { label: 'lata' } },
          // Rung 1 onto a queued row.
          { id: 'p-queued', name: 'Pan', size: { label: 'barra' } },
          // Rung 2: the EAN resolves, so it is priced and says nothing.
          {
            id: 'p-ean',
            name: 'Leche',
            ean: '8480000123456',
            price: { amount: 0.89, currency: 'EUR' },
          },
          // Rung 3: a name the catalog knows, proposed and not priced.
          {
            id: 'p-fuzzy',
            name: 'Aceite de oliva',
            brand: 'Hacendado',
            price: { amount: 4.5, currency: 'EUR' },
          },
          // Rung 5: nothing at all.
          { id: 'p-new', name: 'Algo que nadie conoce' },
        ],
      }),
      rows: [
        {
          externalId: entryKey('Cerveza', 'lata'),
          name: 'Cerveza',
          sizeFormat: 'lata',
          status: SourceEntryStatus.REJECTED,
        },
        {
          externalId: entryKey('Pan', 'barra'),
          name: 'Pan',
          sizeFormat: 'barra',
          status: SourceEntryStatus.CANDIDATE,
          itemId: 'item-pan',
        },
      ],
      items: [
        {
          id: 'item-milk',
          name: { es: 'Nothing alike', en: null },
          brand: null,
          ean: '8480000123456',
          unitSize: null,
        },
        {
          id: 'item-oil',
          name: { es: 'Aceite de oliva', en: null },
          brand: 'Hacendado',
          ean: null,
          unitSize: null,
        },
      ],
    });

    await runner.run(context, input);

    expect(codes(warnings)).toEqual([
      HarvestWarningCode.REJECTED_ALIAS,
      HarvestWarningCode.ALREADY_QUEUED,
      HarvestWarningCode.CANDIDATE_MATCH,
      HarvestWarningCode.NO_MATCH,
    ]);
    expect(warnings.map((warning) => warning.offerId)).toEqual([
      'p-rej',
      'p-queued',
      'p-fuzzy',
      'p-new',
    ]);
    // Four products reached a person rather than a price.
    expect(reported).toContainEqual({ skipped: 4 });
  });

  it('asserts nothing about availability', async () => {
    const { runner, context, catalog } = build({
      document: document({
        products: [{ name: 'Leche', price: { amount: 0.89, currency: 'EUR' } }],
      }),
    });

    await runner.run(context, input);

    // A file says what is in it, not what is not.
    expect(
      (catalog as unknown as Record<string, unknown>)['setAvailability']
    ).toBeUndefined();
  });

  it('imports the regenerated El Jamón reading end to end', async () => {
    const fixture = eljamon as unknown as HarvestDocument;
    expect(validateHarvestDocument(fixture).valid).toBe(true);

    const { runner, context, saved, priceRows, warnings } = build({
      document: fixture,
    });

    await runner.run(context, input);

    // Every product becomes a row, and only the ones the extractor priced carry
    // a price observation.
    expect(saved).toHaveLength(fixture.products.length);
    const priced = fixture.products.filter(
      (product) => product.price || product.unit_price
    );
    expect(priceRows.length).toBeLessThanOrEqual(priced.length);
    // Nothing was resolved, because this chain has no rows and no catalog item
    // matches, so every product is queued and says so.
    expect(new Set(codes(warnings))).toEqual(
      new Set([
        HarvestWarningCode.NO_MATCH,
        ...(fixture.warnings?.length ? [HarvestWarningCode.EXTRACTOR] : []),
        ...(priceRows.length < priced.length
          ? [HarvestWarningCode.DUPLICATE_KEY]
          : []),
      ])
    );
  });
});
