import {
  HarvestWarningCode,
  ItemSourceMatch,
  PriceSourceKind,
  SourceEntryStatus,
  UnitOfMeasure,
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
import {
  FileImportFailedAfterIngestError,
  FileImportRunner,
  unpayableForOne,
  type FileImportInput,
  type FileImportStepAfterIngest,
} from './file-import.runner';
import { entryKey } from './matching';
import { PriceScopeResolver } from './price-scope-resolver';
import type { RunContext } from './run-context';
import { withEntryWrites } from './source-entry-writes.fake';
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

  const entries = withEntryWrites(
    {
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
    },
    () => [...stored, ...saved]
  ) as unknown as Repository<SourceCatalogEntry>;

  const linked: { sourceEntryId: string; url?: string }[] = [];
  const unlinked: string[] = [];
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
    // The photo links of the bound rows (plan 0198), recorded so a case can
    // say which rows were linked and which were unlinked.
    linkItemImages: jest.fn(async (links: { sourceEntryId: string }[]) => {
      linked.push(...links);
      return { linked: links.length, moved: 0, unchanged: 0, rejected: [] };
    }),
    unlinkItemImages: jest.fn(async (ids: string[]) => {
      unlinked.push(...ids);
      return { unlinked: ids.length };
    }),
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
    advance: jest.fn(async () => undefined),
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
    ingest,
    stored,
    saved,
    priceRows,
    catalog,
    warnings,
    reported,
    linked,
    unlinked,
  };
}

const input: FileImportInput = {
  supermarketId: CHAIN,
  priceScopeId: SCOPE,
  sourceKind: PriceSourceKind.OFFICIAL_LEAFLET,
  adapterKey: null,
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

    describe('a conditional promotion on a kg basis offer', () => {
      /** What the leaflet producer writes for a multibuy priced by the kilo. */
      const multibuy = (promotion: Record<string, unknown>) =>
        document({
          products: [
            {
              name: 'Chuleta de cerdo',
              size: { label: 'Kilo', unit: 'kg' },
              unit_price: { amount: 4.95, currency: 'EUR', label: 'kg' },
              extra: { basis: 'kg', promotion },
            },
          ],
        });

      it.each([
        'second_unit_discount',
        'multibuy_unit_price',
        'multibuy_total',
        'buy_n_get_free',
      ])(
        'keeps the price null for %s with no single unit price',
        async (type) => {
          const { runner, context, priceRows, saved } = build({
            document: multibuy({ type, raw_text: '2a unidad -50%' }),
          });

          await runner.run(context, input);

          // The number is one nobody pays for one unit, so it stays the
          // comparison figure it was before this plan.
          expect(priceRows[0]).toMatchObject({ price: null, unitPrice: 4.95 });
          // The row is still sold by weight: that is what the tile is.
          expect(saved[0].soldByWeight).toBe(true);
        }
      );

      it('writes the single unit price when the tile prints one', async () => {
        // The producer put that number in the unit price, and it is what one
        // kilo costs.
        const { runner, context, priceRows } = build({
          document: multibuy({
            type: 'second_unit_discount',
            single_unit_price: { amount: 4.95, currency: 'EUR' },
          }),
        });

        await runner.run(context, input);

        expect(priceRows[0]).toMatchObject({ price: 4.95, unitPrice: 4.95 });
      });

      it('writes the price for a promotion that sets no condition', async () => {
        const { runner, context, priceRows } = build({
          document: multibuy({ type: 'price_drop', raw_text: 'ANTES 5,95' }),
        });

        await runner.run(context, input);

        expect(priceRows[0]).toMatchObject({ price: 4.95, unitPrice: 4.95 });
      });
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
      // Every one of them, less the tiles whose only number is conditional.
      const unpayable = new Set(
        weighed
          .filter((row) =>
            unpayableForOne({ name: row.name, extra: row.extra })
          )
          .map((row) => row.id)
      );
      for (const row of rows) {
        if (unpayable.has(row['entryId'] as string)) {
          expect(row['price']).toBeNull();
        } else {
          expect(row['price']).not.toBeNull();
          expect(row['price']).toBe(row['unitPrice']);
        }
      }
      expect(unpayable.size).toBeLessThan(rows.length);
    });
  });

  describe('the weight of one piece (plan 0244, section 5.5)', () => {
    const tile = (over: Record<string, unknown> = {}) =>
      document({
        schema_version: 2,
        products: [
          {
            name: 'Queso curado pieza',
            size: { label: 'pieza 1,5 kg aprox' },
            approx_weight: 1500,
            prices: [
              {
                amount: null,
                currency: 'EUR',
                unit_price: { amount: 12.9, label: 'kg' },
              },
            ],
            extra: { basis: 'kg' },
            ...over,
          },
        ],
      } as Partial<HarvestDocument>);

    it('passes approx_weight to the observation, and the row holds it', async () => {
      const { runner, context, saved } = build({ document: tile() });

      await runner.run(context, input);

      expect(saved[0]).toMatchObject({
        soldByWeight: true,
        unitSize: null,
        approxWeight: 1500,
        sizeFormat: 'pieza 1,5 kg aprox',
      });
    });

    it('refuses approx_weight beside a size', async () => {
      const { runner, context } = build({
        document: tile({
          size: { label: '1,5 kg', quantity: 1.5, unit: 'kg' },
        }),
      });

      await expect(runner.run(context, input)).rejects.toThrow(
        /approx_weight .*beside a size/
      );
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

  describe('the one category path of a product (plan 0268)', () => {
    const DAIRY = ['Lácteos', 'Leche'];

    it('adds the path of a product that states one, and writes nothing for one with none', async () => {
      const { runner, context, saved } = build({
        document: document({
          products: [
            {
              name: 'Leche semidesnatada',
              size: { label: '1 L' },
              category_path: DAIRY,
            },
            { name: 'Pan de molde', size: { label: '500 g' } },
            { name: 'Cerveza', size: { label: 'lata' }, category_path: [] },
          ],
        }),
      });

      const counters = await runner.run(context, input);

      const byName = new Map(saved.map((row) => [row.name, row]));
      expect(byName.get('Leche semidesnatada')?.categoryPaths).toEqual([DAIRY]);
      // `categoryPath` is what it was, and the one path of the row.
      expect(byName.get('Leche semidesnatada')?.categoryPath).toEqual(DAIRY);
      // A product with no path, or an empty one, makes no write.
      expect(byName.get('Pan de molde')?.categoryPaths).toBeUndefined();
      expect(byName.get('Cerveza')?.categoryPaths).toBeUndefined();
      expect(counters.categoryPathsWritten).toBe(1);
    });

    it('keeps the paths a row holds and adds the document path after them', async () => {
      const WALKED = ['Alimentación', 'Lácteos', 'Leche entera'];
      const { runner, context, stored } = build({
        rows: [
          {
            externalId: entryKey('Leche semidesnatada', '1 L'),
            name: 'Leche semidesnatada',
            sizeFormat: '1 L',
            categoryPaths: [WALKED],
          },
        ],
        document: document({
          products: [
            {
              name: 'Leche semidesnatada',
              size: { label: '1 L' },
              category_path: DAIRY,
            },
          ],
        }),
      });

      const counters = await runner.run(context, input);

      // ADD: one document has not shown that the walked path is gone.
      expect(stored[0].categoryPaths).toEqual([WALKED, DAIRY]);
      expect(counters.categoryPathsWritten).toBe(1);
    });

    it('changes nothing for a row that already holds the path', async () => {
      const { runner, context, stored } = build({
        rows: [
          {
            externalId: entryKey('Leche semidesnatada', '1 L'),
            name: 'Leche semidesnatada',
            sizeFormat: '1 L',
            categoryPaths: [DAIRY],
          },
        ],
        document: document({
          products: [
            {
              name: 'Leche semidesnatada',
              size: { label: '1 L' },
              category_path: DAIRY,
            },
          ],
        }),
      });

      const counters = await runner.run(context, input);

      expect(stored[0].categoryPaths).toEqual([DAIRY]);
      expect(counters.categoryPathsWritten).toBe(0);
    });

    it('adds the paths of two products that resolve to one row together', async () => {
      const { runner, context, saved } = build({
        document: document({
          products: [
            {
              name: 'Leche semidesnatada',
              size: { label: '1 L' },
              category_path: DAIRY,
            },
            {
              name: 'Leche semidesnatada',
              size: { label: '1 L' },
              category_path: ['Desayuno'],
            },
          ],
        }),
      });

      await runner.run(context, input);

      expect(saved).toHaveLength(1);
      expect(saved[0].categoryPaths).toEqual([DAIRY, ['Desayuno']]);
    });
  });

  describe('a field the document does not state leaves the row alone', () => {
    const PHOTO = 'https://prod-mercadona.imgix.net/images/1001.jpg';
    const LINK = 'https://tienda.mercadona.es/product/1001/leche-entera';
    const DAIRY = ['Lácteos', 'Leche'];
    /** A row a walk wrote, bound to a product that shows its chain photo. */
    const walked = (): Partial<SourceCatalogEntry> => ({
      externalId: '1001',
      name: 'Leche entera',
      sizeFormat: '1 L',
      sourceKind: PriceSourceKind.OFFICIAL_WEB,
      status: SourceEntryStatus.ACTIVE,
      itemId: 'item-milk',
      matchedBy: ItemSourceMatch.EAN,
      confidence: 1,
      brand: 'Hacendado',
      ean: '8480000123456',
      url: LINK,
      imageUrl: PHOTO,
      extra: { packaging: 'Brik' },
      categoryPath: DAIRY,
      categoryPaths: [DAIRY],
    });
    const asWalk = {
      ...input,
      sourceKind: PriceSourceKind.OFFICIAL_WEB,
      adapterKey: 'mercadona-api',
    };

    it('keeps the photo, link, extra, EAN, brand and path of a walked row (defects 1 and 2)', async () => {
      const { runner, context, stored, linked, unlinked } = build({
        rows: [walked()],
        document: document({
          products: [
            {
              external_id: '1001',
              name: 'Leche entera',
              size: { label: '1 L' },
              price: { amount: 0.95, currency: 'EUR' },
            },
          ],
        }),
      });

      await runner.run(context, asWalk);

      expect(stored[0]).toMatchObject({
        imageUrl: PHOTO,
        url: LINK,
        extra: { packaging: 'Brik' },
        ean: '8480000123456',
        brand: 'Hacendado',
        categoryPath: DAIRY,
        categoryPaths: [DAIRY],
      });
      // The bound product keeps its chain photo: the link is sent again and
      // nothing is unlinked.
      expect(unlinked).toEqual([]);
      expect(linked).toEqual([
        expect.objectContaining({ sourceEntryId: 'held-1', url: PHOTO }),
      ]);
    });

    it('keeps what a leaflet does not state on a row a leaflet wrote', async () => {
      const { runner, context, stored } = build({
        rows: [
          {
            externalId: entryKey('Cerveza Radler', 'lata 33 cl'),
            name: 'Cerveza Radler',
            sizeFormat: 'lata 33 cl',
            brand: 'Mahou',
            ean: '8410000000001',
            url: 'https://example.org/folleto/3',
            extra: { page: 3 },
          },
        ],
        document: document({
          products: [{ name: 'Cerveza Radler', size: { label: 'lata 33 cl' } }],
        }),
      });

      await runner.run(context, input);

      expect(stored[0]).toMatchObject({
        brand: 'Mahou',
        ean: '8410000000001',
        url: 'https://example.org/folleto/3',
        extra: { page: 3 },
      });
    });

    it('writes each field the document states, a null included', async () => {
      const { runner, context, stored, unlinked } = build({
        rows: [walked()],
        document: document({
          schema_version: 2,
          products: [
            {
              external_id: '1001',
              name: 'Leche entera',
              size: { label: '1 L' },
              brand: null,
              ean: '8480000654321',
              url: null,
              image_url: null,
              extra: {},
              category_path: ['Desayuno'],
              prices: [],
            },
          ],
        }),
      });

      await runner.run(context, asWalk);

      expect(stored[0]).toMatchObject({
        brand: null,
        ean: '8480000654321',
        url: null,
        imageUrl: null,
        extra: {},
        categoryPath: ['Desayuno'],
      });
      // A stated null is the source saying it prints no photo, so the bound
      // product loses this row's link, as a walk that saw none takes it away.
      expect(unlinked).toEqual(['held-1']);
    });

    describe('how the product is sold (plan 0181)', () => {
      /** A row a walk sells by the kilo: no size, the label kept. */
      const weighed = (): Partial<SourceCatalogEntry> => ({
        ...walked(),
        externalId: '3401',
        name: 'Queso curado',
        sizeFormat: '1 kg',
        unitSize: null,
        sizeUnit: null,
        soldByWeight: true,
      });
      const product = (over: Record<string, unknown> = {}) =>
        document({
          schema_version: 2,
          products: [
            {
              external_id: '3401',
              name: 'Queso curado',
              size: { label: '1 kg' },
              prices: [],
              ...over,
            },
          ],
        });

      it('keeps the flag of a walked row when the document does not say', async () => {
        const { runner, context, stored } = build({
          rows: [weighed()],
          document: product(),
        });

        await runner.run(context, asWalk);

        expect(stored[0].soldByWeight).toBe(true);
      });

      it('keeps it for a basis that is not kg too, which says nothing either', async () => {
        const { runner, context, stored } = build({
          rows: [weighed()],
          document: product({ extra: { basis: 'unit' } }),
        });

        await runner.run(context, asWalk);

        expect(stored[0].soldByWeight).toBe(true);
      });

      it('writes the flag the document states, false included', async () => {
        const { runner, context, stored } = build({
          rows: [weighed(), { ...walked(), soldByWeight: false }],
          document: document({
            schema_version: 2,
            products: [
              {
                external_id: '3401',
                name: 'Queso curado',
                size: { label: '1 kg' },
                sold_by_weight: false,
                prices: [],
              },
              {
                external_id: '1001',
                name: 'Leche entera',
                size: { label: '1 L', quantity: 1, unit: 'l' },
                sold_by_weight: true,
                prices: [],
              },
            ],
          }),
        });

        await runner.run(context, asWalk);

        expect(stored[0].soldByWeight).toBe(false);
        // Sold by weight holds no size, whatever the document printed.
        expect(stored[1]).toMatchObject({ soldByWeight: true, unitSize: null });
      });

      it('writes a stated flag over the kg basis of the bag', async () => {
        const { runner, context, saved } = build({
          document: product({ sold_by_weight: false, extra: { basis: 'kg' } }),
        });

        await runner.run(context, asWalk);

        expect(saved[0].soldByWeight).toBe(false);
      });

      it('reads a size quantity with no flag as a fixed pack, so no row sold by weight holds a size', async () => {
        const piece = { ...weighed(), approxWeight: 950 };
        for (const extra of [{ basis: 'unit' }, undefined]) {
          const { runner, context, stored } = build({
            rows: [{ ...piece }],
            document: product({
              size: { label: '500 g', quantity: 500, unit: 'g' },
              ...(extra ? { extra } : {}),
            }),
          });

          await runner.run(context, asWalk);

          // What `origin/dev` wrote for this file.
          expect(stored[0]).toMatchObject({
            soldByWeight: false,
            unitSize: 500,
            sizeUnit: 'GRAM',
            approxWeight: null,
          });
        }
      });

      it('keeps the flag, the size and the piece weight when the document states neither a flag nor a size quantity', async () => {
        const { runner, context, stored } = build({
          rows: [{ ...weighed(), approxWeight: 950 }],
          document: product({ extra: { basis: 'unit' } }),
        });

        await runner.run(context, asWalk);

        expect(stored[0]).toMatchObject({
          soldByWeight: true,
          unitSize: null,
          sizeUnit: null,
          approxWeight: 950,
        });
      });

      it('keeps the size text beside the size of a fixed pack when the document states no size at all', async () => {
        const { runner, context, stored } = build({
          rows: [
            {
              ...walked(),
              externalId: '9001',
              name: 'Leche',
              sizeFormat: '1 L',
              unitSize: 1000,
              sizeUnit: UnitOfMeasure.MILLILITER,
              soldByWeight: false,
            },
          ],
          document: document({
            schema_version: 2,
            products: [{ external_id: '9001', name: 'Leche', prices: [] }],
          }),
        });

        const counters = await runner.run(context, asWalk);

        expect(stored[0]).toMatchObject({
          sizeFormat: '1 L',
          unitSize: 1000,
          sizeUnit: UnitOfMeasure.MILLILITER,
        });
        expect(counters).toMatchObject({ unchanged: 1, updated: 0 });
      });

      it('keeps the text and the size for a size text with no quantity', async () => {
        const { runner, context, stored } = build({
          rows: [
            {
              ...walked(),
              sizeFormat: '1 L',
              unitSize: 1000,
              sizeUnit: UnitOfMeasure.MILLILITER,
              soldByWeight: false,
            },
          ],
          document: document({
            schema_version: 2,
            products: [
              {
                external_id: '1001',
                name: 'Leche entera',
                size: { label: '250 g' },
                prices: [],
              },
            ],
          }),
        });

        await runner.run(context, asWalk);

        expect(stored[0]).toMatchObject({
          sizeFormat: '1 L',
          unitSize: 1000,
          sizeUnit: UnitOfMeasure.MILLILITER,
        });
      });

      it('reads a stated quantity that converts to no size as a fixed pack with no size, as origin/dev did', async () => {
        // Rows from before plan 0270 still hold a wash count or a length as
        // their size.
        for (const size of [
          { label: '40 lavados', quantity: 40, unit: 'lavados' },
          { label: '30 m', quantity: 30, unit: 'm' },
        ]) {
          const { runner, context, stored } = build({
            rows: [
              {
                ...walked(),
                sizeFormat: size.label,
                unitSize: size.quantity,
                sizeUnit: null,
                soldByWeight: false,
              },
            ],
            document: document({
              schema_version: 2,
              products: [
                {
                  external_id: '1001',
                  name: 'Leche entera',
                  size,
                  prices: [],
                },
              ],
            }),
          });

          await runner.run(context, asWalk);

          expect(stored[0]).toMatchObject({
            soldByWeight: false,
            unitSize: null,
            sizeUnit: null,
            sizeFormat: size.label,
          });
        }
      });

      it('makes a new row the document does not say about a fixed pack', async () => {
        const { runner, context, saved } = build({ document: product() });

        await runner.run(context, asWalk);

        expect(saved[0].soldByWeight).toBe(false);
      });
    });

    describe('the photo link a document states (plan 0198)', () => {
      const MOVED = 'https://prod-mercadona.imgix.net/images/1001-b.jpg';
      const stating = (imageUrl: string) =>
        document({
          schema_version: 2,
          products: [
            {
              external_id: '1001',
              name: 'Leche entera',
              size: { label: '1 L' },
              image_url: imageUrl,
              prices: [],
            },
          ],
        });

      it('writes a link that passes the host rule of the chain', async () => {
        const { runner, context, stored, linked } = build({
          rows: [walked()],
          document: stating(MOVED),
        });

        await runner.run(context, asWalk);

        expect(stored[0].imageUrl).toBe(MOVED);
        expect(linked).toEqual([
          expect.objectContaining({ sourceEntryId: 'held-1', url: MOVED }),
        ]);
      });

      it('drops a link on a host outside the chain list and keeps the stored one', async () => {
        const { runner, context, stored, unlinked } = build({
          rows: [walked()],
          document: stating('https://example.com/1001.jpg'),
        });

        await runner.run(context, asWalk);

        expect(stored[0].imageUrl).toBe(PHOTO);
        expect(unlinked).toEqual([]);
      });

      it('takes no link for a chain whose adapter states no photo', async () => {
        const { runner, context, stored, saved } = build({
          rows: [walked()],
          document: document({
            schema_version: 2,
            products: [
              {
                external_id: '1001',
                name: 'Leche entera',
                size: { label: '1 L' },
                image_url: MOVED,
                prices: [],
              },
              {
                external_id: '1002',
                name: 'Leche desnatada',
                size: { label: '1 L' },
                image_url: MOVED,
                prices: [],
              },
            ],
          }),
        });

        await runner.run(context, { ...asWalk, adapterKey: null });

        expect(stored[0].imageUrl).toBe(PHOTO);
        expect(saved[0].imageUrl).toBeNull();
      });
    });

    it('adds every category path the document states after the stored ones (plan 0268)', async () => {
      const WRONG = ['Bebidas'];
      const SECOND = ['Desayuno', 'Leche'];
      const { runner, context, stored } = build({
        rows: [{ ...walked(), categoryPaths: [WRONG] }],
        document: document({
          schema_version: 2,
          products: [
            {
              external_id: '1001',
              name: 'Leche entera',
              size: { label: '1 L' },
              category_path: DAIRY,
              category_paths: [DAIRY, SECOND],
              prices: [],
            },
          ],
        }),
      });

      const counters = await runner.run(context, asWalk);

      // ADD: the document does not say the run read every shelf of the
      // product, so the stored trail stays and the two are added after it.
      expect(stored[0].categoryPaths).toEqual([WRONG, DAIRY, SECOND]);
      expect(counters.categoryPathsWritten).toBe(1);
    });
  });

  describe('a step that fails after the ingest wrote (owner decisions 96c and 102b)', () => {
    const DAIRY = ['Lácteos', 'Leche'];
    const twoPriced = () =>
      build({
        document: document({
          products: [
            {
              name: 'Leche semidesnatada',
              size: { label: '1 L' },
              price: { amount: 0.89, currency: 'EUR' },
              category_path: DAIRY,
            },
            {
              name: 'Pan de molde',
              size: { label: '500 g' },
              price: { amount: 1.2, currency: 'EUR' },
              category_path: ['Panadería'],
            },
          ],
        }),
      });
    type Built = ReturnType<typeof twoPriced>;
    const failing = (built: Built) =>
      built.runner.run(built.context, input).then(
        () => null,
        (error: unknown) => error
      );

    it.each<{
      step: FileImportStepAfterIngest;
      breaks: (built: Built) => void;
      categoryPathsWritten: number;
    }>([
      {
        // Both products matched nothing, so both are skipped, and the count
        // of skipped rows does not land. The ingest's own counts did.
        step: 'OUTCOMES',
        breaks: ({ context }) =>
          (context.report as jest.Mock).mockImplementation(
            async (counters: Record<string, number>) => {
              if ('skipped' in counters) {
                throw new Error('connection terminated');
              }
            }
          ),
        categoryPathsWritten: 0,
      },
      {
        // One row lands, then the database goes away.
        step: 'CATEGORY_PATHS',
        breaks: ({ ingest }) =>
          jest
            .spyOn(ingest, 'writeCategoryPaths')
            .mockImplementation(
              async (_writes, onWritten = () => undefined) => {
                onWritten();
                throw new Error('connection terminated');
              }
            ),
        categoryPathsWritten: 1,
      },
      {
        // Every path landed; the last flush of the counters does not.
        step: 'FLUSH',
        breaks: ({ context }) =>
          (context.flush as jest.Mock).mockRejectedValueOnce(
            new Error('connection terminated')
          ),
        categoryPathsWritten: 2,
      },
    ])(
      'carries what was written on an error when $step fails',
      async ({ step, breaks, categoryPathsWritten }) => {
        const built = twoPriced();
        breaks(built);

        const failure = await failing(built);

        expect(failure).toBeInstanceOf(FileImportFailedAfterIngestError);
        const error = failure as FileImportFailedAfterIngestError;
        expect(error.step).toBe(step);
        // The run's sentence is the step's own.
        expect(error.message).toBe('connection terminated');
        // The ingest wrote both rows and both prices before the step.
        expect(built.saved).toHaveLength(2);
        expect(built.priceRows).toHaveLength(2);
        expect(error.counters).toMatchObject({
          created: 2,
          pricesRecorded: 2,
          categoryPathsWritten,
        });
      }
    );

    it('raises the error of an ingest that fails as it is, with nothing to carry', async () => {
      const built = twoPriced();
      const broken = new Error('connection refused');
      jest.spyOn(built.ingest, 'ingest').mockRejectedValueOnce(broken);

      const failure = await failing(built);

      expect(failure).toBe(broken);
      expect(built.context.report).not.toHaveBeenCalled();
      expect(built.context.flush).not.toHaveBeenCalled();
    });
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
