import {
  HarvestWarningCode,
  PriceSourceKind,
  SourceEntryStatus,
  validateHarvestDocument,
  type HarvestDocument,
  type HarvestRunWarning,
} from '@portfolio/luna-shopper/contracts';
import type { Repository } from 'typeorm';
import type {
  HarvestRun,
  SourceCatalogEntry,
  SourceEntryPrice,
} from '../entities';
import eljamon from './__fixtures__/eljamon.vision.harvest-document.json';
import type { CatalogClient } from './catalog-client.service';
import { FileImportRunner } from './file-import.runner';
import { entryKey } from './matching';
import { PriceScopeResolver } from './price-scope-resolver';
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
    // The scopes a version 2 document declares are resolved through this before
    // anything is written (plan 0103, section 5.1). A leaflet declares none, so
    // most cases here never reach it.
    runner: new FileImportRunner(
      ingest,
      new PriceScopeResolver(catalog as unknown as CatalogClient)
    ),
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

  it('writes the size with the unit the document states it in (plan 0177)', async () => {
    const { runner, context, saved } = build({
      document: document({
        products: [
          // The shape the leaflet tool writes: the label is what was printed,
          // and the quantity is already millilitres.
          {
            name: 'Vino verdejo',
            size: { label: '75 cl', quantity: 750, unit: 'ml' },
          },
          // A producer that kept the printed unit: centilitres are written as
          // millilitres, as every adapter writes them.
          {
            name: 'Cerveza especial',
            size: { label: '33 cl', quantity: 33, unit: 'cl' },
          },
          {
            name: 'Aceite de oliva',
            size: { label: '1 L', quantity: 1, unit: 'l' },
          },
          {
            name: 'Arroz redondo',
            size: { label: '1 kg', quantity: 1, unit: 'kg' },
          },
          {
            name: 'Café en cápsulas',
            size: { label: '16 ud', quantity: 16, unit: 'unit' },
          },
          // What `harvest-export` writes for a row that states its unit.
          {
            name: 'Leche entera',
            size: { label: '1,5 l', quantity: 1500, unit: 'MILLILITER' },
          },
          // No unit, which is every document written before this plan: the
          // quantity is kept and nothing claims to know what it counts.
          { name: 'Yogur natural', size: { label: '4x125 g', quantity: 500 } },
          // A length, which is a dimension and not a size (plan 0183): the
          // label is kept, because it is half of the key, and the number is
          // not.
          {
            name: 'Papel de aluminio',
            size: { label: '30 m', quantity: 30, unit: 'm' },
          },
          { name: 'Pan de molde' },
        ],
      }),
    });

    await runner.run(context, input);

    expect(
      saved.map((row) => [row.name, row.sizeFormat, row.unitSize, row.sizeUnit])
    ).toEqual([
      ['Vino verdejo', '75 cl', 750, 'MILLILITER'],
      ['Cerveza especial', '33 cl', 330, 'MILLILITER'],
      ['Aceite de oliva', '1 L', 1, 'LITER'],
      ['Arroz redondo', '1 kg', 1, 'KILOGRAM'],
      ['Café en cápsulas', '16 ud', 16, 'UNIT'],
      ['Leche entera', '1,5 l', 1500, 'MILLILITER'],
      ['Yogur natural', '4x125 g', 500, null],
      ['Papel de aluminio', '30 m', null, null],
      ['Pan de molde', null, null, null],
    ]);
    // The key is built from the name and the printed label, and from nothing
    // this plan reads.
    expect(saved[0].externalId).toBe(entryKey('Vino verdejo', '75 cl'));
    expect(saved[1].externalId).toBe(entryKey('Cerveza especial', '33 cl'));
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

  describe('a product sold by weight (plan 0181)', () => {
    it('writes the headline price of a kg basis offer as its price', async () => {
      const { runner, context, priceRows, saved } = build({
        document: document({
          products: [
            {
              // The shape the leaflet producer writes for a tile priced by
              // the kilo: no till price, and the headline in the unit price.
              name: 'Solomillo de Cerdo Blanco',
              size: { label: 'Kilo', unit: 'kg' },
              unit_price: { amount: 7.95, currency: 'EUR', label: 'kg' },
              extra: {
                basis: 'kg',
                headline_price: { amount: 7.95, currency: 'EUR' },
              },
            },
          ],
        }),
      });

      await runner.run(context, input);

      expect(priceRows[0]).toMatchObject({
        price: 7.95,
        unitPrice: 7.95,
        unitPriceLabel: 'kg',
      });
      expect(saved[0]).toMatchObject({
        soldByWeight: true,
        unitSize: null,
        sizeUnit: null,
        // The key is what the leaflet printed, as it was before this plan.
        sizeFormat: 'Kilo',
        externalId: entryKey('Solomillo de Cerdo Blanco', 'Kilo'),
      });
    });

    it('writes null for an l basis offer, which is not a way to sell', async () => {
      const { runner, context, priceRows, saved } = build({
        document: document({
          products: [
            {
              name: 'Aceite de oliva a granel',
              size: { label: 'litro', unit: 'l' },
              unit_price: { amount: 6.5, currency: 'EUR', label: 'l' },
              extra: {
                basis: 'l',
                headline_price: { amount: 6.5, currency: 'EUR' },
              },
            },
          ],
        }),
      });

      await runner.run(context, input);

      expect(priceRows[0]).toMatchObject({
        price: null,
        unitPrice: 6.5,
        unitPriceLabel: 'l',
      });
      expect(saved[0].soldByWeight).toBe(false);
    });

    it('keeps a till price the producer stated on a kg basis offer', async () => {
      const { runner, context, priceRows } = build({
        document: document({
          products: [
            {
              name: 'Queso curado',
              price: { amount: 4.2, currency: 'EUR' },
              unit_price: { amount: 14, currency: 'EUR', label: 'kg' },
              extra: { basis: 'kg' },
            },
          ],
        }),
      });

      await runner.run(context, input);

      expect(priceRows[0]).toMatchObject({ price: 4.2, unitPrice: 14 });
    });

    it('writes no price for a kg basis offer that states no figure at all', async () => {
      // A tile that needs the loyalty card: the producer states no price and
      // no unit price, and the headline in `extra` is the card's.
      const { runner, context, priceRows, saved } = build({
        document: document({
          products: [
            {
              name: 'Lomo de cerdo',
              extra: {
                basis: 'kg',
                headline_price: { amount: 5.95, currency: 'EUR' },
                loyalty: { required: true, program: 'Club' },
              },
            },
          ],
        }),
      });

      await runner.run(context, input);

      expect(priceRows).toEqual([]);
      expect(saved[0].soldByWeight).toBe(true);
    });

    it('prices every kg tile of the El Jamón reading by the kilo', async () => {
      const fixture = eljamon as unknown as HarvestDocument;
      const { runner, context, saved, priceRows } = build({
        document: fixture,
      });

      await runner.run(context, input);

      const weighed = saved.filter((row) => row.soldByWeight);
      expect(weighed).toHaveLength(
        fixture.products.filter((product) => product.extra?.['basis'] === 'kg')
          .length
      );
      expect(weighed.length).toBeGreaterThan(0);
      const ids = new Set(weighed.map((row) => row.id));
      const rows = priceRows.filter((row) => ids.has(row['entryId'] as string));
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        expect(row['price']).not.toBeNull();
        expect(row['price']).toBe(row['unitPrice']);
      }
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
            message:
              'Page 22 is a competition entry form and holds no products.',
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
