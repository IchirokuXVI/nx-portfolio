import {
  BulkOperationErrorCode,
  ItemSourceMatch,
  PriceSourceKind,
  SourceEntryStatus,
  UnitOfMeasure,
  type ApplySourceEntryDecisionsRequest,
  type ItemView,
  type SourceEntryDecisionOperation,
} from '@portfolio/luna-shopper/contracts';
import {
  ForbiddenException,
  ValidationException,
} from '@portfolio/luna-shopper/platform';
import type { FindOperator, Repository } from 'typeorm';
import type { SourceCatalogEntry, SourceEntryPrice } from '../entities';
import type { CatalogClient } from './catalog-client.service';
import { fakeCategoryTree } from './category-tree.fake';
import type { PlatformAdminService } from './platform-admin.service';
import type { SourceEntryAvailabilityWriter } from './source-entry-availability';
import { SourceEntryBatchService } from './source-entry-batch.service';
import type { SourceEntryPriceWriter } from './source-entry-write';
import type { SupermarketSourceService } from './supermarket-source.service';

/**
 * A whole decisions file, applied in one call (plan 0100).
 *
 * The four things worth asserting are the four steps, and each one is a rule a
 * wrong implementation would look correct without:
 *
 * - a clean file lands whole, binding every row and writing every price;
 * - **one bad `expect` refuses the whole file with zero writes**, which is the
 *   entire reason this route exists rather than a loop over the per row ones;
 * - a bind that fails after the products were created deletes them, and names
 *   the ones it could not delete;
 * - a price write that fails skips **that row's prices only**, leaves its bind
 *   standing, and says so. Step four is the one place this is not atomic, and
 *   nothing else may quietly become non atomic beside it.
 */

const ADMIN = 'owner-1';
const CHAIN = 'chain-mercadona';
const SEEN = new Date('2026-09-10T09:00:00.000Z');

function price(overrides: Partial<SourceEntryPrice> = {}): SourceEntryPrice {
  return {
    id: 'sep-1',
    entryId: 'e-1',
    priceScopeId: 'scope-national',
    price: 0.89,
    currency: 'EUR',
    unitPrice: 0.89,
    unitPriceLabel: '€/L',
    validFrom: null,
    validUntil: null,
    details: null,
    observedAt: SEEN,
    runId: 'run-monday',
    createdAt: SEEN,
    updatedAt: SEEN,
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
    ean: null,
    unitSize: 1,
    sizeFormat: '1 L',
    categoryPath: ['Huevos, leche y mantequilla', 'Leche y bebidas vegetales'],
    url: null,
    extra: null,
    timesSeen: 3,
    firstSeenAt: SEEN,
    lastSeenAt: SEEN,
    firstRunId: 'run-monday',
    lastRunId: 'run-monday',
    itemId: null,
    candidateEntryId: null,
    status: SourceEntryStatus.UNRESOLVED,
    matchedBy: null,
    confidence: 0,
    decidedAt: null,
    prices: [price()],
    createdAt: SEEN,
    updatedAt: SEEN,
    ...overrides,
  } as SourceCatalogEntry;
}

function item(id: string): ItemView {
  return {
    id,
    name: { es: 'Leche' },
    brand: null,
    ean: null,
    unitSize: null,
    imageUrl: null,
    sku: null,
    defaultUnit: UnitOfMeasure.LITER,
  } as unknown as ItemView;
}

/** The ids an `In(...)` criterion names, whichever way TypeORM wrapped them. */
function idsOf(where: unknown): string[] {
  const id = (where as { id?: FindOperator<string> | string })?.id;
  if (typeof id === 'string') {
    return [id];
  }
  const value = (id as { value?: string[] })?.value;
  return Array.isArray(value) ? value : [];
}

function build(
  options: {
    rows?: SourceCatalogEntry[];
    /** Fail the save of this entry, which is a step three failure. */
    failSaveOf?: string;
    /** Fail the price write for these entries, which is a step four skip. */
    failPricesOf?: string[];
    /** Fail the availability write, which is a step four skip of every row. */
    failAvailability?: boolean;
    /** Fail the cleanup delete, so the product is reported as an orphan. */
    failDelete?: boolean;
    createItems?: jest.Mock;
    /** Barcodes catalog already holds, and the product holding each. */
    takenEans?: Record<string, string>;
    /** The chain's adapter, which decides what language its printed name is in. */
    adapterKey?: string | null;
  } = {}
) {
  const rows = options.rows ?? [entry()];
  const byId = new Map(rows.map((row) => [row.id, row]));
  const saved: SourceCatalogEntry[] = [];

  const manager = {
    find: jest.fn(async (_target: unknown, opts: { where?: unknown }) =>
      idsOf(opts?.where)
        .map((id) => byId.get(id))
        .filter(Boolean)
    ),
    save: jest.fn(async (_target: unknown, row: SourceCatalogEntry) => {
      if (options.failSaveOf === row.id) {
        throw new Error('deadlock detected');
      }
      saved.push({ ...row });
      return row;
    }),
    transaction: jest.fn(async (work: (m: unknown) => Promise<unknown>) =>
      work(manager)
    ),
  };

  const entries = {
    manager,
    find: jest.fn(async (opts: { where?: unknown }) =>
      idsOf(opts?.where)
        .map((id) => byId.get(id))
        .filter(Boolean)
    ),
  } as unknown as Repository<SourceCatalogEntry>;

  const createItems =
    options.createItems ??
    jest.fn(async (inputs: unknown[]) => ({
      items: inputs.map((_input, index) => item(`item-new-${index + 1}`)),
    }));
  const deleteItem = jest.fn(async (itemId: string) => {
    if (options.failDelete) {
      throw new Error('catalog said no');
    }
    return { id: itemId };
  });
  const findItemsByEans = jest.fn(async (eans: string[]) => ({
    items: eans.flatMap((ean) => {
      const holder = options.takenEans?.[ean];
      return holder ? [{ ...item(holder), ean }] : [];
    }),
  }));
  const categoryTree = jest.fn(async () => fakeCategoryTree());
  const catalog = {
    createItems,
    categoryTree,
    deleteItem,
    findItemsByEans,
  } as unknown as CatalogClient;

  const write = jest.fn(async (row: SourceCatalogEntry) => {
    if (options.failPricesOf?.includes(row.id)) {
      throw new Error('scope is gone');
    }
    return (row.prices ?? []).length;
  });
  const prices = { write } as unknown as SourceEntryPriceWriter;

  // The availability half of step four (plan 0182). What it sends is its own
  // spec; what matters here is when it is called, with which rows, and what a
  // failure does to the answer.
  const writeAvailability = jest.fn(
    async (_bound: readonly SourceCatalogEntry[]) => {
      if (options.failAvailability) {
        throw new Error('catalog is away');
      }
      return { written: 0, shops: 0, conflicts: [], pricelessOffers: 0 };
    }
  );
  const availability = {
    writeForEntries: writeAvailability,
  } as unknown as SourceEntryAvailabilityWriter;

  const admin = {
    requireAdmin: jest.fn(async (credential: { userId: string }) => {
      if (credential.userId !== ADMIN) {
        throw new ForbiddenException('nope');
      }
      return credential.userId;
    }),
  } as unknown as PlatformAdminService;

  // Every row in these files belongs to Mercadona, which prints Spanish, so a
  // row accepted with no name of its own files the printed string under `es`.
  // `in` rather than `??`, so a test can say `adapterKey: null` and mean it:
  // null is the chain whose printed language nothing knows, and `??` would read
  // it as "not provided" and hand back Mercadona.
  const adapterKey =
    'adapterKey' in options ? options.adapterKey : 'mercadona-api';
  const sources = {
    findBySupermarket: jest.fn(async () =>
      adapterKey === null ? null : { adapterKey }
    ),
  } as unknown as SupermarketSourceService;

  const service = new SourceEntryBatchService(
    entries,
    catalog,
    prices,
    admin,
    sources,
    availability
  );
  return {
    service,
    writeAvailability,
    saved,
    createItems,
    categoryTree,
    deleteItem,
    findItemsByEans,
    write,
    manager,
    admin,
  };
}

function request(
  operations: SourceEntryDecisionOperation[]
): ApplySourceEntryDecisionsRequest {
  return { userId: ADMIN, runId: 'session-1', operations };
}

const expectFresh = {
  status: SourceEntryStatus.UNRESOLVED,
  lastSeenAt: SEEN.toISOString(),
};

/**
 * A name in both languages, for the files whose name is not what the test is
 * about. A `createItem` with no English name is refused (plan 0184).
 */
const BOTH = { es: 'Leche', en: 'Milk' };

describe('SourceEntryBatchService', () => {
  it('refuses a caller who is not the platform admin', async () => {
    const { service } = build();
    await expect(
      service.applyDecisions({
        userId: 'someone-else',
        operations: [
          {
            op: 'accept',
            entryId: 'e-1',
            itemId: 'i-1',
            expect: expectFresh,
          },
        ],
      })
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses an empty file and one over the cap, before it reads a row', async () => {
    const { service, manager } = build();
    await expect(service.applyDecisions(request([]))).rejects.toBeInstanceOf(
      ValidationException
    );

    const tooMany = Array.from({ length: 1001 }, (_value, index) => ({
      op: 'accept' as const,
      entryId: `e-${index}`,
      itemId: 'i-1',
      expect: expectFresh,
    }));
    await expect(
      service.applyDecisions(request(tooMany))
    ).rejects.toBeInstanceOf(ValidationException);
    expect(manager.transaction).not.toHaveBeenCalled();
  });

  it('lands a clean file whole: binds every row and writes every price', async () => {
    const rows = [entry(), entry({ id: 'e-2', externalId: '4242' })];
    const { service, saved, createItems, write } = build({ rows });

    const result = await service.applyDecisions(
      request([
        {
          op: 'createItem',
          entryId: 'e-1',
          ref: 'milk',
          item: { name: { es: 'Leche semidesnatada', en: 'In English' } },
          expect: expectFresh,
        },
        // The second row of the same product, bound to the item the first
        // operation creates, before that item has an id.
        {
          op: 'accept',
          entryId: 'e-2',
          itemRef: 'milk',
          expect: expectFresh,
        },
      ])
    );

    expect(result.applied).toBe(true);
    expect(result.failedStep).toBeNull();
    // Echoed, so a report can be filed under the session that decided the file.
    expect(result.runId).toBe('session-1');
    expect(createItems).toHaveBeenCalledTimes(1);
    expect(saved.map((row) => row.id)).toEqual(['e-1', 'e-2']);
    expect(saved.every((row) => row.status === SourceEntryStatus.ACTIVE)).toBe(
      true
    );
    expect(saved.every((row) => row.matchedBy === ItemSourceMatch.MANUAL)).toBe(
      true
    );
    expect(saved.every((row) => row.confidence === 1)).toBe(true);
    // Both rows carry the id the one create answered.
    expect(new Set(saved.map((row) => row.itemId))).toEqual(
      new Set(['item-new-1'])
    );
    expect(result.results.every((outcome) => outcome.applied)).toBe(true);
    expect(result.results.map((outcome) => outcome.pricesWritten)).toEqual([
      1, 1,
    ]);
    expect(write).toHaveBeenCalledTimes(2);
  });

  it('never rewrites what the source printed, whatever the item is called', async () => {
    const { service, saved } = build();
    await service.applyDecisions(
      request([
        {
          op: 'createItem',
          entryId: 'e-1',
          ref: 'milk',
          item: {
            name: { es: 'Something else entirely', en: 'In English' },
            brand: 'Other',
          },
          expect: expectFresh,
        },
      ])
    );

    // Plan 0086, D8: the row keeps the source's own strings so the next run
    // that produces this key still resolves through it.
    expect(saved[0].name).toBe('Leche semidesnatada Hacendado');
    expect(saved[0].brand).toBe('Hacendado');
    expect(saved[0].sizeFormat).toBe('1 L');
  });

  /**
   * The name a created product gets, over the same four cases the one at a time
   * route is tested on (plan 0111, section 6 and section 12).
   *
   * The two routes are tested separately and deliberately: they drifted once
   * already, the batch copy silently required Spanish the way the other one did,
   * and the only difference between them that is meant to exist is the English
   * fetch, which this route does not pay for.
   */
  describe('the pack count a created product gets (plan 0162)', () => {
    async function created(
      item: Record<string, unknown>,
      row: Partial<SourceCatalogEntry>
    ) {
      const { service, createItems } = build({ rows: [entry(row)] });
      await service.applyDecisions(
        request([
          {
            op: 'createItem',
            entryId: 'e-1',
            ref: 'milk',
            item,
            expect: expectFresh,
          },
        ])
      );
      return createItems;
    }

    it("takes the row's count when the operation names none", async () => {
      const createItems = await created(
        { name: { es: 'Leche entera', en: 'In English' } },
        { sizeFormat: 'pack de 6 unidades de 1 l.', packCount: 6 }
      );
      expect(createItems).toHaveBeenCalledWith([
        expect.objectContaining({ packCount: 6 }),
      ]);
    });

    it('takes the count the operation names over the row', async () => {
      const createItems = await created(
        { name: { es: 'Leche entera', en: 'In English' }, packCount: 4 },
        { sizeFormat: 'pack de 6 unidades de 1 l.', packCount: 6 }
      );
      expect(createItems).toHaveBeenCalledWith([
        expect.objectContaining({ packCount: 4 }),
      ]);
    });

    it('creates none from a row that is not a pack', async () => {
      const createItems = await created(
        { name: { es: 'Leche', en: 'In English' } },
        {}
      );
      expect(createItems).toHaveBeenCalledWith([
        expect.objectContaining({ packCount: null }),
      ]);
    });

    describe('the unit of a created product (plan 0177)', () => {
      const wine = {
        unitSize: 750,
        sizeUnit: UnitOfMeasure.MILLILITER,
        sizeFormat: '75 cl',
      };

      it('takes the unit the row states its size in, not a guess from the text', async () => {
        // The text maps to no unit, and the size is already millilitres.
        const createItems = await created(
          { name: { es: 'Vino', en: 'In English' } },
          wine
        );
        expect(createItems).toHaveBeenCalledWith([
          expect.objectContaining({
            unitSize: 750,
            defaultUnit: UnitOfMeasure.MILLILITER,
          }),
        ]);
      });

      it('takes the unit the operation names over the row', async () => {
        const createItems = await created(
          {
            name: { es: 'Vino', en: 'In English' },
            defaultUnit: UnitOfMeasure.LITER,
          },
          wine
        );
        expect(createItems).toHaveBeenCalledWith([
          expect.objectContaining({ defaultUnit: UnitOfMeasure.LITER }),
        ]);
      });

      it('falls back to the printed text for a row with no unit, then to UNIT', async () => {
        expect(
          await created(
            { name: { es: 'Queso', en: 'In English' } },
            { unitSize: 0.5, sizeUnit: null, sizeFormat: 'kg' }
          )
        ).toHaveBeenCalledWith([
          // The text says kilograms, and a sized kilogram is written in grams
          // (plan 0183).
          expect.objectContaining({
            unitSize: 500,
            defaultUnit: UnitOfMeasure.GRAM,
          }),
        ]);
        expect(
          await created(
            { name: { es: 'Vino', en: 'In English' } },
            { unitSize: null, sizeUnit: null, sizeFormat: '75 cl' }
          )
        ).toHaveBeenCalledWith([
          expect.objectContaining({ defaultUnit: UnitOfMeasure.UNIT }),
        ]);
      });
    });

    describe('a created product is in a base unit (plan 0183)', () => {
      it('writes a row of 0.25 kg as 250 GRAM', async () => {
        expect(
          await created(
            { name: { es: 'Queso', en: 'In English' } },
            {
              unitSize: 0.25,
              sizeUnit: UnitOfMeasure.KILOGRAM,
              sizeFormat: 'kg',
            }
          )
        ).toHaveBeenCalledWith([
          expect.objectContaining({
            unitSize: 250,
            defaultUnit: UnitOfMeasure.GRAM,
          }),
        ]);
      });

      it('writes a row of 1.5 l as 1500 MILLILITER', async () => {
        expect(
          await created(
            { name: { es: 'Agua', en: 'In English' } },
            {
              unitSize: 1.5,
              sizeUnit: UnitOfMeasure.LITER,
              sizeFormat: '1,5 l',
            }
          )
        ).toHaveBeenCalledWith([
          expect.objectContaining({
            unitSize: 1500,
            defaultUnit: UnitOfMeasure.MILLILITER,
          }),
        ]);
      });

      it('keeps KILOGRAM for a row with no size, which is sold by weight', async () => {
        expect(
          await created(
            { name: { es: 'Bacon', en: 'In English' } },
            { unitSize: null, sizeUnit: null, sizeFormat: 'kg' }
          )
        ).toHaveBeenCalledWith([
          expect.objectContaining({
            unitSize: null,
            defaultUnit: UnitOfMeasure.KILOGRAM,
          }),
        ]);
      });

      describe('a row sold by weight (plan 0181)', () => {
        it('creates KILOGRAM with no size when the operation names no size', async () => {
          expect(
            await created(
              { name: { es: 'Queso semicurado', en: 'In English' } },
              {
                soldByWeight: true,
                unitSize: null,
                sizeUnit: null,
                sizeFormat: 'kg',
              }
            )
          ).toHaveBeenCalledWith([
            expect.objectContaining({
              unitSize: null,
              defaultUnit: UnitOfMeasure.KILOGRAM,
            }),
          ]);
        });

        it('does so whatever the row prints as its size', async () => {
          expect(
            await created(
              { name: { es: 'Solomillo de cerdo', en: 'In English' } },
              {
                soldByWeight: true,
                unitSize: null,
                sizeUnit: null,
                sizeFormat: 'pieza',
              }
            )
          ).toHaveBeenCalledWith([
            expect.objectContaining({
              unitSize: null,
              defaultUnit: UnitOfMeasure.KILOGRAM,
            }),
          ]);
        });

        it('reads a size named as null as no size named', async () => {
          expect(
            await created(
              {
                name: { es: 'Solomillo de cerdo', en: 'In English' },
                ...{ unitSize: null },
              },
              {
                soldByWeight: true,
                unitSize: null,
                sizeUnit: null,
                sizeFormat: 'pieza',
              }
            )
          ).toHaveBeenCalledWith([
            expect.objectContaining({
              unitSize: null,
              defaultUnit: UnitOfMeasure.KILOGRAM,
            }),
          ]);
        });

        it.each([
          UnitOfMeasure.KILOGRAM,
          UnitOfMeasure.GRAM,
          UnitOfMeasure.UNIT,
        ])(
          'takes a unit named alone as %p, with no size',
          async (defaultUnit) => {
            // The row holds no size to carry over, so only the unit is named.
            expect(
              await created(
                {
                  name: { es: 'Solomillo de cerdo', en: 'In English' },
                  ...{ defaultUnit },
                },
                {
                  soldByWeight: true,
                  unitSize: null,
                  sizeUnit: null,
                  sizeFormat: 'pieza',
                }
              )
            ).toHaveBeenCalledWith([
              expect.objectContaining({ unitSize: null, defaultUnit }),
            ]);
          }
        );

        it('lets an operation that names a size overrule it', async () => {
          expect(
            await created(
              { name: { es: 'Queso', en: 'In English' }, unitSize: 0.3 },
              {
                soldByWeight: true,
                unitSize: null,
                sizeUnit: null,
                sizeFormat: 'kg',
              }
            )
          ).toHaveBeenCalledWith([
            expect.objectContaining({
              unitSize: 300,
              defaultUnit: UnitOfMeasure.GRAM,
            }),
          ]);
        });
      });

      it('converts a size the operation names with the row unit', async () => {
        expect(
          await created(
            { name: { es: 'Queso', en: 'In English' }, unitSize: 0.5 },
            {
              unitSize: 0.25,
              sizeUnit: UnitOfMeasure.KILOGRAM,
              sizeFormat: 'kg',
            }
          )
        ).toHaveBeenCalledWith([
          expect.objectContaining({
            unitSize: 500,
            defaultUnit: UnitOfMeasure.GRAM,
          }),
        ]);
      });

      describe('an operation that names the unit and leaves the size as read', () => {
        const kilo = {
          unitSize: 0.25,
          sizeUnit: UnitOfMeasure.KILOGRAM,
          sizeFormat: 'kg',
        };

        it.each([
          [kilo, UnitOfMeasure.GRAM, 250],
          [kilo, UnitOfMeasure.KILOGRAM, 0.25],
          [
            { unitSize: 1.5, sizeUnit: UnitOfMeasure.LITER, sizeFormat: 'l' },
            UnitOfMeasure.MILLILITER,
            1500,
          ],
          [
            {
              unitSize: 750,
              sizeUnit: UnitOfMeasure.MILLILITER,
              sizeFormat: '75 cl',
            },
            UnitOfMeasure.LITER,
            0.75,
          ],
        ])('expresses %p in %p as %p', async (row, defaultUnit, unitSize) => {
          expect(
            await created(
              { name: { es: 'Queso', en: 'In English' }, defaultUnit },
              row
            )
          ).toHaveBeenCalledWith([
            expect.objectContaining({ unitSize, defaultUnit }),
          ]);
        });

        it('keeps the number when the two units are of different kinds', async () => {
          expect(
            await created(
              {
                name: { es: 'Queso', en: 'In English' },
                defaultUnit: UnitOfMeasure.UNIT,
              },
              kilo
            )
          ).toHaveBeenCalledWith([
            expect.objectContaining({
              unitSize: 0.25,
              defaultUnit: UnitOfMeasure.UNIT,
            }),
          ]);
        });

        it('keeps the number when the row states no unit', async () => {
          expect(
            await created(
              {
                name: { es: 'Queso', en: 'In English' },
                defaultUnit: UnitOfMeasure.GRAM,
              },
              { unitSize: 0.25, sizeUnit: null, sizeFormat: 'kg' }
            )
          ).toHaveBeenCalledWith([
            expect.objectContaining({
              unitSize: 0.25,
              defaultUnit: UnitOfMeasure.GRAM,
            }),
          ]);
        });
      });

      it('writes a unit the operation names exactly as it was sent', async () => {
        expect(
          await created(
            {
              name: { es: 'Agua', en: 'In English' },
              unitSize: 1,
              defaultUnit: UnitOfMeasure.LITER,
            },
            {
              unitSize: 1.5,
              sizeUnit: UnitOfMeasure.LITER,
              sizeFormat: '1,5 l',
            }
          )
        ).toHaveBeenCalledWith([
          expect.objectContaining({
            unitSize: 1,
            defaultUnit: UnitOfMeasure.LITER,
          }),
        ]);
      });
    });
  });

  describe('the categories a created product gets (plan 0166, section 7)', () => {
    const rows = () => [
      entry({ id: 'e-1' }),
      entry({ id: 'e-2', externalId: '4242', categoryPath: ['Nada'] }),
    ];

    it('resolves every slug through one read of the tree for the whole file', async () => {
      const { service, createItems, categoryTree } = build({ rows: rows() });

      const result = await service.applyDecisions(
        request([
          {
            op: 'createItem',
            entryId: 'e-1',
            ref: 'milk',
            item: { name: { es: 'Leche', en: 'In English' } },
            expect: expectFresh,
          },
          {
            op: 'createItem',
            entryId: 'e-2',
            ref: 'cola',
            item: {
              name: { es: 'Refresco', en: 'In English' },
              categorySlugs: ['cola', 'orange'],
            },
            expect: expectFresh,
          },
        ])
      );

      expect(result.applied).toBe(true);
      expect(categoryTree).toHaveBeenCalledTimes(1);
      expect(createItems).toHaveBeenCalledWith([
        // The row's own path, through the Mercadona table.
        expect.objectContaining({ categoryIds: ['cat-milk'] }),
        // The override, in the order the file wrote it.
        expect.objectContaining({
          categoryIds: ['cat-cola', 'cat-orange'],
        }),
      ]);
    });

    it('files a path the table cannot place under uncategorised', async () => {
      const { service, createItems } = build({ rows: rows() });

      await service.applyDecisions(
        request([
          {
            op: 'createItem',
            entryId: 'e-2',
            ref: 'unknown',
            item: { name: { es: 'Algo', en: 'In English' } },
            expect: expectFresh,
          },
        ])
      );

      expect(createItems).toHaveBeenCalledWith([
        expect.objectContaining({ categoryIds: ['cat-uncategorised'] }),
      ]);
    });

    it('refuses the file at VALIDATE when a slug names no category, and creates nothing', async () => {
      const { service, createItems, saved } = build({ rows: rows() });

      const result = await service.applyDecisions(
        request([
          {
            op: 'createItem',
            entryId: 'e-1',
            ref: 'milk',
            item: {
              name: { es: 'Leche', en: 'In English' },
              categorySlugs: ['ice-creem'],
            },
            expect: expectFresh,
          },
          {
            op: 'createItem',
            entryId: 'e-2',
            ref: 'cola',
            item: { name: { es: 'Refresco', en: 'In English' } },
            expect: expectFresh,
          },
        ])
      );

      expect(result.applied).toBe(false);
      expect(result.failedStep).toBe('VALIDATE');
      expect(result.results[0].error).toEqual({
        code: BulkOperationErrorCode.NOT_FOUND,
        detail: expect.stringContaining('ice-creem'),
      });
      expect(result.results[1].error).toBeNull();
      expect(createItems).not.toHaveBeenCalled();
      expect(saved).toEqual([]);
    });

    it('reads no tree for a file that creates nothing', async () => {
      const { service, categoryTree } = build({
        rows: [entry({ id: 'e-1' })],
      });

      await service.applyDecisions(
        request([
          {
            op: 'reject',
            entryId: 'e-1',
            expect: expectFresh,
          },
        ])
      );

      expect(categoryTree).not.toHaveBeenCalled();
    });
  });

  describe('the name a created product gets', () => {
    /** The single `createItem` input this file produced. */
    async function nameFrom(
      item: Record<string, unknown>,
      options: Parameters<typeof build>[0] = {}
    ) {
      const { service, createItems } = build(options);
      const result = await service.applyDecisions(
        request([
          {
            op: 'createItem',
            entryId: 'e-1',
            ref: 'milk',
            item,
            expect: expectFresh,
          },
        ])
      );
      return { result, createItems };
    }

    /**
     * Plan 0184. This route translates nothing, so a product with no English
     * name is refused on its own operation, before a row is locked for the
     * bind or a product is created. 100 products of the first catalog had no
     * `en` key, and every one of them came through here with `{ es }` alone.
     */
    it('refuses a create with only Spanish, naming the code, and writes nothing', async () => {
      const { result, createItems } = await nameFrom({
        name: { es: 'Leche entera' },
      });

      expect(result.applied).toBe(false);
      expect(result.failedStep).toBe('VALIDATE');
      expect(result.results[0].error).toEqual({
        code: BulkOperationErrorCode.NAME_EN_MISSING,
        detail: expect.stringContaining('no English name'),
      });
      expect(createItems).not.toHaveBeenCalled();
    });

    it('reads a blank English name as no English name', async () => {
      const { result, createItems } = await nameFrom({
        name: { es: 'Leche entera', en: '   ' },
      });

      expect(result.results[0].error?.code).toBe(
        BulkOperationErrorCode.NAME_EN_MISSING
      );
      expect(createItems).not.toHaveBeenCalled();
    });

    it('refuses only the operation that lacks it, and still lands nothing', async () => {
      const rows = [entry(), entry({ id: 'e-2', externalId: '4242' })];
      const { service, createItems, saved } = build({ rows });

      const result = await service.applyDecisions(
        request([
          {
            op: 'createItem',
            entryId: 'e-1',
            ref: 'milk',
            item: { name: { es: 'Leche entera', en: 'Whole milk' } },
            expect: expectFresh,
          },
          {
            op: 'createItem',
            entryId: 'e-2',
            ref: 'cream',
            item: { name: { es: 'Nata' } },
            expect: expectFresh,
          },
        ])
      );

      expect(result.applied).toBe(false);
      expect(result.results[0].error).toBeNull();
      expect(result.results[1].error?.code).toBe(
        BulkOperationErrorCode.NAME_EN_MISSING
      );
      expect(createItems).not.toHaveBeenCalled();
      expect(saved).toEqual([]);
    });

    it('takes English alone, and writes no Spanish key', async () => {
      // The regression: the old rule read `item.name.es` and fell back to the
      // row's printed string, so an English only decision stored the chain's
      // Spanish name beside it. This route never fetches English, so what the
      // file said is the whole answer.
      const { createItems } = await nameFrom({ name: { en: 'Whole milk' } });

      expect(createItems).toHaveBeenCalledWith([
        expect.objectContaining({ name: { en: 'Whole milk' } }),
      ]);
      const [[[input]]] = createItems.mock.calls;
      expect(input.name).not.toHaveProperty('es');
    });

    it('takes both when the file gave both', async () => {
      const { createItems } = await nameFrom({
        name: { es: 'Leche entera', en: 'Whole milk' },
      });

      expect(createItems).toHaveBeenCalledWith([
        expect.objectContaining({
          name: { es: 'Leche entera', en: 'Whole milk' },
        }),
      ]);
    });

    it('refuses a file that names nothing for a chain that prints Spanish', async () => {
      // The fallback is the printed string under the language the chain
      // prints in, which is Spanish here, so the product would have no
      // English name. The file has to state one (plan 0184).
      const { result, createItems } = await nameFrom({});

      expect(result.results[0].error?.code).toBe(
        BulkOperationErrorCode.NAME_EN_MISSING
      );
      expect(createItems).not.toHaveBeenCalled();
    });

    it('refuses the file when nothing names the product', async () => {
      // A refusal here lands nothing at all, which is this route's whole point:
      // the throw happens before `createItems`, so no product exists to orphan.
      const { result, createItems } = await nameFrom(
        {},
        { rows: [entry({ name: '' })] }
      );

      expect(result.applied).toBe(false);
      expect(createItems).not.toHaveBeenCalled();
    });

    it('refuses the file when the chain names no language it prints in', async () => {
      const { result, createItems } = await nameFrom({}, { adapterKey: null });

      expect(result.applied).toBe(false);
      expect(createItems).not.toHaveBeenCalled();
    });
  });

  it('refuses the whole file for one stale expect, and writes nothing anywhere', async () => {
    const rows = [entry(), entry({ id: 'e-2', externalId: '4242' })];
    const { service, saved, createItems, writeAvailability } = build({ rows });

    const result = await service.applyDecisions(
      request([
        {
          op: 'createItem',
          entryId: 'e-1',
          ref: 'milk',
          item: { name: BOTH },
          expect: expectFresh,
        },
        {
          op: 'accept',
          entryId: 'e-2',
          itemId: 'item-9',
          // The row was observed again after the decision was made about it.
          expect: {
            status: SourceEntryStatus.UNRESOLVED,
            lastSeenAt: '2026-09-01T00:00:00.000Z',
          },
        },
      ])
    );

    expect(result.applied).toBe(false);
    expect(result.failedStep).toBe('VALIDATE');
    expect(saved).toEqual([]);
    // Step two never ran, so the catalog holds nothing this file created.
    expect(createItems).not.toHaveBeenCalled();
    // Nor step four: a refused file states no availability either (plan 0182).
    expect(writeAvailability).not.toHaveBeenCalled();
    expect(result.results[0].error).toBeNull();
    expect(result.results[0].applied).toBe(false);
    expect(result.results[1].error?.code).toBe(
      BulkOperationErrorCode.EXPECT_MISMATCH
    );
  });

  it('refuses a row somebody else has already decided', async () => {
    const rows = [entry({ status: SourceEntryStatus.ACTIVE, itemId: 'i-9' })];
    const { service, saved } = build({ rows });

    const result = await service.applyDecisions(
      request([
        { op: 'accept', entryId: 'e-1', itemId: 'i-1', expect: expectFresh },
      ])
    );

    expect(result.applied).toBe(false);
    expect(result.results[0].error?.code).toBe(
      BulkOperationErrorCode.NOT_PENDING
    );
    expect(saved).toEqual([]);
  });

  it('refuses a file that contradicts itself, before it reads a row', async () => {
    const { service, manager } = build();

    const result = await service.applyDecisions(
      request([
        { op: 'accept', entryId: 'e-1', itemId: 'i-1', expect: expectFresh },
        // The same row decided twice, and an accept naming both alternatives.
        {
          op: 'accept',
          entryId: 'e-1',
          itemId: 'i-2',
          itemRef: 'milk',
          expect: expectFresh,
        },
      ])
    );

    expect(result.applied).toBe(false);
    expect(result.failedStep).toBe('VALIDATE');
    expect(result.results[1].error?.code).toBe(
      BulkOperationErrorCode.DUPLICATE_SUBJECT
    );
    expect(manager.transaction).not.toHaveBeenCalled();
  });

  it('refuses an accept naming a product no operation of the file creates', async () => {
    const { service } = build();

    const result = await service.applyDecisions(
      request([
        {
          op: 'accept',
          entryId: 'e-1',
          itemRef: 'ghost',
          expect: expectFresh,
        },
      ])
    );

    expect(result.results[0].error?.code).toBe(
      BulkOperationErrorCode.UNKNOWN_REFERENCE
    );
  });

  it('deletes the products it created when the bind fails, and names what would not go', async () => {
    const rows = [entry(), entry({ id: 'e-2', externalId: '4242' })];
    const { service, deleteItem, write } = build({
      rows,
      failSaveOf: 'e-2',
    });

    const result = await service.applyDecisions(
      request([
        {
          op: 'createItem',
          entryId: 'e-1',
          ref: 'milk',
          item: { name: BOTH },
          expect: expectFresh,
        },
        {
          op: 'createItem',
          entryId: 'e-2',
          ref: 'bread',
          item: { name: BOTH },
          expect: expectFresh,
        },
      ])
    );

    expect(result.applied).toBe(false);
    expect(result.failedStep).toBe('BIND');
    expect(deleteItem.mock.calls.map((call) => call[0])).toEqual([
      'item-new-1',
      'item-new-2',
    ]);
    expect(result.orphanedItemIds).toEqual([]);
    // Nothing was bound, so nothing may have written a price.
    expect(write).not.toHaveBeenCalled();
  });

  it('reports the products a failed cleanup left behind rather than swallowing them', async () => {
    const { service, deleteItem } = build({
      failSaveOf: 'e-1',
      failDelete: true,
    });

    const result = await service.applyDecisions(
      request([
        {
          op: 'createItem',
          entryId: 'e-1',
          ref: 'milk',
          item: { name: BOTH },
          expect: expectFresh,
        },
      ])
    );

    expect(result.applied).toBe(false);
    expect(deleteItem).toHaveBeenCalledTimes(1);
    expect(result.orphanedItemIds).toEqual(['item-new-1']);
  });

  it('skips only the failing row when a price write fails, and leaves its bind standing', async () => {
    const rows = [entry(), entry({ id: 'e-2', externalId: '4242' })];
    const { service, saved } = build({ rows, failPricesOf: ['e-1'] });

    const result = await service.applyDecisions(
      request([
        { op: 'accept', entryId: 'e-1', itemId: 'i-1', expect: expectFresh },
        { op: 'accept', entryId: 'e-2', itemId: 'i-2', expect: expectFresh },
      ])
    );

    // Step four is the one place this is not atomic, decided in review: prices
    // are recoverable and a cross service rollback is not worth a saga.
    expect(result.applied).toBe(true);
    expect(saved).toHaveLength(2);
    expect(result.results[0].applied).toBe(true);
    expect(result.results[0].pricesWritten).toBe(0);
    expect(result.results[1].pricesWritten).toBe(1);
    // Named once, in a list of its own, so a caller reads "these rows are bound
    // and still want their prices" rather than scanning every outcome.
    expect(result.priceSkips).toEqual([
      { entryId: 'e-1', itemId: 'i-1', reason: 'scope is gone' },
    ]);
  });

  describe('the availability the bound rows are owed (plan 0182)', () => {
    const twoRows = () => [entry(), entry({ id: 'e-2', externalId: '4242' })];
    const twoAccepts = () =>
      request([
        { op: 'accept', entryId: 'e-1', itemId: 'i-1', expect: expectFresh },
        { op: 'accept', entryId: 'e-2', itemId: 'i-2', expect: expectFresh },
      ]);

    it('writes it once for the whole file, after every price, with the rows as bound', async () => {
      const { service, write, writeAvailability } = build({ rows: twoRows() });

      const result = await service.applyDecisions(twoAccepts());

      expect(result.applied).toBe(true);
      // One pass and not one per row: a DEZA row has no price and up to ten
      // shops, and a thousand of them a row at a time outlasts the route.
      expect(writeAvailability).toHaveBeenCalledTimes(1);
      const [bound] = writeAvailability.mock.calls[0];
      expect(bound.map((row) => [row.id, row.itemId])).toEqual([
        ['e-1', 'i-1'],
        ['e-2', 'i-2'],
      ]);
      // The rule the prices follow in this route: after the bind, in step four.
      expect(Math.max(...write.mock.invocationCallOrder)).toBeLessThan(
        writeAvailability.mock.invocationCallOrder[0]
      );
      expect(result.priceSkips).toEqual([]);
    });

    it('leaves every bind standing when it fails, and names the rows', async () => {
      const { service, saved } = build({
        rows: twoRows(),
        failAvailability: true,
      });

      const result = await service.applyDecisions(twoAccepts());

      expect(result.applied).toBe(true);
      expect(saved).toHaveLength(2);
      expect(result.results.map((outcome) => outcome.applied)).toEqual([
        true,
        true,
      ]);
      // The prices landed, and the answer still says so.
      expect(result.results.map((outcome) => outcome.pricesWritten)).toEqual([
        1, 1,
      ]);
      expect(result.priceSkips).toEqual([
        {
          entryId: 'e-1',
          itemId: 'i-1',
          reason: 'Availability: catalog is away',
        },
        {
          entryId: 'e-2',
          itemId: 'i-2',
          reason: 'Availability: catalog is away',
        },
      ]);
    });

    it('names a row once when its prices and the availability both fail', async () => {
      const { service } = build({
        rows: twoRows(),
        failPricesOf: ['e-1'],
        failAvailability: true,
      });

      const result = await service.applyDecisions(twoAccepts());

      expect(result.priceSkips).toEqual([
        { entryId: 'e-1', itemId: 'i-1', reason: 'scope is gone' },
        {
          entryId: 'e-2',
          itemId: 'i-2',
          reason: 'Availability: catalog is away',
        },
      ]);
    });
  });

  it('refuses a create whose barcode catalog holds, naming the row and the product', async () => {
    const rows = [entry(), entry({ id: 'e-2', externalId: '4242' })];
    const { service, saved, createItems } = build({
      rows,
      takenEans: { '8480000123459': 'item-held' },
    });

    const result = await service.applyDecisions(
      request([
        {
          op: 'createItem',
          entryId: 'e-1',
          ref: 'milk',
          item: { name: BOTH, ean: '8480000123459' },
          expect: expectFresh,
        },
        {
          op: 'createItem',
          entryId: 'e-2',
          ref: 'cream',
          item: { name: BOTH, ean: '8480000999993' },
          expect: expectFresh,
        },
      ])
    );

    expect(result.applied).toBe(false);
    expect(result.failedStep).toBe('VALIDATE');
    expect(result.results[0].error).toEqual({
      code: BulkOperationErrorCode.ALREADY_TAKEN,
      detail: expect.stringContaining(
        'Catalog already holds an item with EAN 8480000123459 (item-held)'
      ),
    });
    expect(result.results[1].error).toBeNull();
    expect(createItems).not.toHaveBeenCalled();
    expect(saved).toEqual([]);
  });

  it('asks catalog about the barcode the row printed when the file names none', async () => {
    const { service, findItemsByEans } = build({
      rows: [entry({ ean: '8480000123459' })],
      takenEans: { '8480000123459': 'item-held' },
    });

    const result = await service.applyDecisions(
      request([
        {
          op: 'createItem',
          entryId: 'e-1',
          ref: 'milk',
          item: { name: BOTH },
          expect: expectFresh,
        },
      ])
    );

    expect(findItemsByEans).toHaveBeenCalledWith(['8480000123459']);
    expect(result.results[0].error?.code).toBe(
      BulkOperationErrorCode.ALREADY_TAKEN
    );
  });

  // One request per barcode made a file of a thousand products outlast the
  // gateway's route timeout, so the whole file is one question.
  it('asks catalog about every barcode of the file in one request', async () => {
    const rows = [
      entry(),
      entry({ id: 'e-2', externalId: '4242' }),
      entry({ id: 'e-3', externalId: '4243' }),
    ];
    const { service, findItemsByEans } = build({
      rows,
      takenEans: { '8480000999993': 'item-held' },
    });

    const result = await service.applyDecisions(
      request([
        {
          op: 'createItem',
          entryId: 'e-1',
          ref: 'milk',
          item: { name: BOTH, ean: '8480000123459' },
          expect: expectFresh,
        },
        {
          op: 'createItem',
          entryId: 'e-2',
          ref: 'cream',
          item: { name: BOTH, ean: '8480000999993' },
          expect: expectFresh,
        },
        {
          op: 'createItem',
          entryId: 'e-3',
          ref: 'butter',
          item: { name: BOTH, ean: '8480000123459' },
          expect: expectFresh,
        },
      ])
    );

    expect(findItemsByEans).toHaveBeenCalledTimes(1);
    expect(findItemsByEans).toHaveBeenCalledWith([
      '8480000123459',
      '8480000999993',
    ]);
    expect(result.results[0].error).toBeNull();
    expect(result.results[1].error?.code).toBe(
      BulkOperationErrorCode.ALREADY_TAKEN
    );
  });

  /**
   * Plan 0184: a product holds a real barcode or none, and the row keeps what
   * the chain printed.
   */
  describe('the EAN a created product gets (plan 0184)', () => {
    async function createdFrom(
      row: Partial<SourceCatalogEntry>,
      item: Record<string, unknown> = {}
    ) {
      const built = build({ rows: [entry(row)] });
      const result = await built.service.applyDecisions(
        request([
          {
            op: 'createItem',
            entryId: 'e-1',
            ref: 'cheese',
            item: { name: BOTH, ...item },
            expect: expectFresh,
          },
        ])
      );
      return { ...built, result };
    }

    it('creates a product with a null EAN from a row whose EAN starts with 2, and the row keeps its code', async () => {
      const { result, createItems, saved, findItemsByEans } = await createdFrom(
        { ean: '2204500000000' }
      );

      expect(result.applied).toBe(true);
      expect(createItems).toHaveBeenCalledWith([
        expect.objectContaining({ ean: null }),
      ]);
      // The row is the chain's own record: the matcher and the approximate
      // weight work both read the code it printed.
      expect(saved[0].ean).toBe('2204500000000');
      expect(saved[0].status).toBe(SourceEntryStatus.ACTIVE);
      // Nothing is asked about a code no product will hold.
      expect(findItemsByEans).not.toHaveBeenCalled();
    });

    it('does the same for an in-store code the file itself names', async () => {
      const { createItems } = await createdFrom(
        { ean: null },
        { ean: '2000000000008' }
      );

      expect(createItems).toHaveBeenCalledWith([
        expect.objectContaining({ ean: null }),
      ]);
    });

    it.each([
      ['an 11 digit code', '84100100012'],
      ['a wrong check digit', '8480000123456'],
    ])('creates a product with a null EAN from %s', async (_what, ean) => {
      const { createItems, saved } = await createdFrom({ ean });

      expect(createItems).toHaveBeenCalledWith([
        expect.objectContaining({ ean: null }),
      ]);
      expect(saved[0].ean).toBe(ean);
    });

    it('writes a real barcode as it is', async () => {
      const { createItems } = await createdFrom({ ean: '8480000123459' });

      expect(createItems).toHaveBeenCalledWith([
        expect.objectContaining({ ean: '8480000123459' }),
      ]);
    });
  });

  /** Plan 0184: `matchedBy` says what matched. */
  describe('what a bound row says matched it (plan 0184)', () => {
    it('stamps EAN when the product holds the row’s own real barcode', async () => {
      const { service, saved, findItemsByEans } = build({
        rows: [entry({ ean: '8480000123459' })],
        takenEans: { '8480000123459': 'item-held' },
      });

      const result = await service.applyDecisions(
        request([
          {
            op: 'accept',
            entryId: 'e-1',
            itemId: 'item-held',
            expect: expectFresh,
          },
        ])
      );

      expect(result.applied).toBe(true);
      expect(findItemsByEans).toHaveBeenCalledWith(['8480000123459']);
      expect(saved[0].matchedBy).toBe(ItemSourceMatch.EAN);
      expect(saved[0].confidence).toBe(1);
    });

    it('stamps MANUAL when the product holds no EAN', async () => {
      // Catalog answers no holder for the row's barcode, so the product the
      // accept names does not carry it.
      const { service, saved } = build({
        rows: [entry({ ean: '8480000123459' })],
      });

      await service.applyDecisions(
        request([
          {
            op: 'accept',
            entryId: 'e-1',
            itemId: 'item-with-no-ean',
            expect: expectFresh,
          },
        ])
      );

      expect(saved[0].matchedBy).toBe(ItemSourceMatch.MANUAL);
    });

    it('stamps MANUAL when another product holds the row’s barcode', async () => {
      const { service, saved } = build({
        rows: [entry({ ean: '8480000123459' })],
        takenEans: { '8480000123459': 'item-held' },
      });

      await service.applyDecisions(
        request([
          {
            op: 'accept',
            entryId: 'e-1',
            itemId: 'another-item',
            expect: expectFresh,
          },
        ])
      );

      expect(saved[0].matchedBy).toBe(ItemSourceMatch.MANUAL);
    });

    it('stamps MANUAL for a row with an in-store code, and asks catalog nothing', async () => {
      const { service, saved, findItemsByEans } = build({
        rows: [entry({ ean: '2204500000000' })],
      });

      await service.applyDecisions(
        request([
          {
            op: 'accept',
            entryId: 'e-1',
            itemId: 'item-held',
            expect: expectFresh,
          },
        ])
      );

      expect(saved[0].matchedBy).toBe(ItemSourceMatch.MANUAL);
      expect(findItemsByEans).not.toHaveBeenCalled();
    });

    it('stamps EAN on a created product’s own row and on a second row with the same barcode', async () => {
      const rows = [
        entry({ ean: '8480000123459' }),
        entry({ id: 'e-2', externalId: '4242', ean: '8480000123459' }),
        entry({ id: 'e-3', externalId: '4243', ean: null }),
      ];
      // Catalog answers the product as it stored it, barcode included.
      const createItems = jest.fn(async (inputs: { ean: string | null }[]) => ({
        items: inputs.map((input, index) => ({
          ...item(`item-new-${index + 1}`),
          ean: input.ean,
        })),
      }));
      const { service, saved } = build({ rows, createItems });

      await service.applyDecisions(
        request([
          {
            op: 'createItem',
            entryId: 'e-1',
            ref: 'milk',
            item: { name: BOTH },
            expect: expectFresh,
          },
          {
            op: 'accept',
            entryId: 'e-2',
            itemRef: 'milk',
            expect: expectFresh,
          },
          {
            op: 'accept',
            entryId: 'e-3',
            itemRef: 'milk',
            expect: expectFresh,
          },
        ])
      );

      expect(saved.map((row) => row.matchedBy)).toEqual([
        ItemSourceMatch.EAN,
        ItemSourceMatch.EAN,
        ItemSourceMatch.MANUAL,
      ]);
    });
  });

  /**
   * A NATS error arrives as the problem object catalog's filter built, not as
   * an `Error`, and used to reach the operator as "[object Object]" (plan
   * 0158). Catalog's 409 is now only the backstop for a barcode taken between
   * the check and the write, and its sentence is what the answer carries.
   */
  it('binds nothing when the products could not be created, and says why', async () => {
    const createItems = jest.fn(async () => {
      throw {
        type: 'https://errors.luna-shopper-backend/conflict',
        title: 'conflict',
        status: 409,
        code: 'conflict',
        detail:
          'A product of this batch carries EAN 8480000123459, which the ' +
          'catalog already holds, so none of them were created.',
        message: 'That conflicts with the current state.',
        correlationId: 'c-1',
      };
    });
    const { service, saved } = build({ createItems });

    const result = await service.applyDecisions(
      request([
        {
          op: 'createItem',
          entryId: 'e-1',
          ref: 'milk',
          item: { name: BOTH },
          expect: expectFresh,
        },
      ])
    );

    expect(result.applied).toBe(false);
    expect(result.failedStep).toBe('CREATE_ITEMS');
    expect(result.error).toContain('EAN 8480000123459');
    expect(result.error).not.toContain('[object Object]');
    expect(saved).toEqual([]);
  });
});
