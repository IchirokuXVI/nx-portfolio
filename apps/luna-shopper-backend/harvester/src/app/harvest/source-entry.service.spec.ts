import type { ConfigService } from '@nestjs/config';
import { splitCardName } from '@portfolio/luna-shopper/carrefour';
import {
  ItemSourceMatch,
  PriceSourceKind,
  SourceEntryStatus,
  UnitOfMeasure,
  type ItemView,
} from '@portfolio/luna-shopper/contracts';
import {
  CATEGORY_UNKNOWN_DETAIL,
  CategoryNotFoundException,
  ForbiddenException,
} from '@portfolio/luna-shopper/platform';
import type { Repository } from 'typeorm';
import type {
  HarvestRun,
  SourceCatalogEntry,
  SourceEntryAvailability,
  SourceEntryPrice,
  SupermarketSource,
} from '../entities';
import type { CatalogClient } from './catalog-client.service';
import { fakeCategoryTree } from './category-tree.fake';
import type { PlatformAdminService } from './platform-admin.service';
import { SourceEntryAvailabilityWriter } from './source-entry-availability';
import { SourceEntryPriceWriter } from './source-entry-write';
import { SourceEntryService } from './source-entry.service';
import type { SupermarketSourceService } from './supermarket-source.service';

/**
 * Deciding a row (plan 0086, sections 7 and 12).
 *
 * The four things worth asserting, and all four are rules a wrong
 * implementation would look correct without:
 *
 * - an accept writes **every open scope's** price, with that scope's own run and
 *   the row's own kind, and none of a window that has closed;
 * - `createItem` fetches the English name for an API row of an enabled Mercadona
 *   source and **for nothing else**, which is the hazard `sourceKind` exists for;
 * - a reject clears the item;
 * - none of the three ever rewrites `name`, which is what makes a product with
 *   no EAN resolvable at all (D8).
 */

const ADMIN = 'owner-1';
const CHAIN = 'chain-mercadona';
const NATIONAL = 'scope-national';
const CORDOBA = 'scope-cordoba';
const NOW = new Date('2026-09-10T09:00:00.000Z');

function makeAdmin(): jest.Mocked<PlatformAdminService> {
  return {
    requireAdmin: jest.fn(async (credential: { userId: string }) => {
      if (credential.userId !== ADMIN) {
        throw new ForbiddenException('nope');
      }
      return credential.userId;
    }),
  } as unknown as jest.Mocked<PlatformAdminService>;
}

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
    runId: 'run-monday',
    createdAt: NOW,
    updatedAt: NOW,
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
    firstSeenAt: NOW,
    lastSeenAt: NOW,
    firstRunId: 'run-monday',
    lastRunId: 'run-monday',
    itemId: null,
    candidateEntryId: null,
    status: SourceEntryStatus.UNRESOLVED,
    matchedBy: null,
    confidence: 0,
    decidedAt: null,
    prices: [price()],
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  } as SourceCatalogEntry;
}

function item(id = 'item-1'): ItemView {
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

function build(
  options: {
    row?: SourceCatalogEntry;
    source?: Partial<SupermarketSource> | null;
    english?: string | null;
    /** The chain's default scope. `null` is a chain that has none. */
    defaultScope?: string | null;
    /** The stored claims that are ready, as the writer's query answers them. */
    readyClaims?: Record<string, unknown>[];
  } = {}
) {
  const row = options.row ?? entry();
  const saved: SourceCatalogEntry[] = [];

  const entries = {
    findOne: jest.fn(async () => row),
    save: jest.fn(async (input: SourceCatalogEntry) => {
      saved.push({ ...input } as SourceCatalogEntry);
      return input;
    }),
    find: jest.fn(async () => [row]),
    delete: jest.fn(async () => ({ affected: 1 })),
    createQueryBuilder: jest.fn(),
  } as unknown as Repository<SourceCatalogEntry>;

  const prices = {
    delete: jest.fn(async () => ({ affected: 2 })),
  } as unknown as Repository<SourceEntryPrice>;

  const runs = {
    findOne: jest.fn(async () => null),
  } as unknown as Repository<HarvestRun>;

  const addPrices = jest.fn(async () => ({ inserted: 1, confirmed: 0 }));
  const createItem = jest.fn(async () => item());
  const categoryTree = jest.fn(async () => fakeCategoryTree());
  const setAvailability = jest.fn(
    async (
      _priceScopeId: string,
      _entries: { itemId: string; available: boolean }[]
    ) => ({ updated: 1 })
  );
  const setLocationAvailability = jest.fn(
    async (
      _supermarketLocationId: string,
      _entries: { itemId: string; available: boolean }[],
      _sourceRunId: string | null,
      _sourceKind: PriceSourceKind,
      _observedAt: Date
    ) => ({ written: 1, skipped: 0, conflicts: [] })
  );
  const catalog = {
    addPrices,
    createItem,
    categoryTree,
    findItemByEan: jest.fn(async () => ({ item: null })),
    getSupermarket: jest.fn(async () => ({
      id: CHAIN,
      defaultPriceScopeId:
        options.defaultScope === undefined ? NATIONAL : options.defaultScope,
    })),
    setAvailability,
    setLocationAvailability,
  } as unknown as CatalogClient;

  const sources = {
    findBySupermarket: jest.fn(async () =>
      options.source === undefined
        ? ({
            adapterKey: 'mercadona-api',
            enabled: true,
            config: { warehouse: '4661' },
          } as unknown as SupermarketSource)
        : (options.source as SupermarketSource | null)
    ),
  } as unknown as SupermarketSourceService;

  const config = {
    getOrThrow: jest.fn(() => ({
      userAgent: 'test',
      mercadonaBaseUrl: 'https://example.invalid',
    })),
  } as unknown as ConfigService;

  // Plan 0100 moved the price write into its own collaborator, shared with the
  // bulk replay. The real one is used here rather than a double, so every
  // assertion below about which scopes were written and with which run keeps
  // testing the thing it was written to test.
  const priceWriter = new SourceEntryPriceWriter(catalog, entries);

  // The availability half of a bind (plan 0182), the real one too, over a
  // repository that answers the claims a test says are ready. Which claims are
  // ready is a query, and that query is proved against real Postgres in
  // `source-entry-availability.integration.spec.ts`.
  const readClaims = jest.fn(
    async (_sql: string, _parameters: unknown[]) => options.readyClaims ?? []
  );
  const availability = new SourceEntryAvailabilityWriter(
    { query: readClaims } as unknown as Repository<SourceEntryAvailability>,
    catalog
  );

  const service = new SourceEntryService(
    entries,
    prices,
    runs,
    catalog,
    sources,
    makeAdmin(),
    priceWriter,
    config,
    availability
  );
  // The English fetch is one HTTP request to a storefront, and nothing in a unit
  // test may make one. Stubbing the private method rather than the client keeps
  // the assertion on *whether it was reached*, which is the rule under test.
  const fetchEnglish = jest
    .spyOn(
      service as unknown as { fetchEnglishName: () => Promise<string | null> },
      'fetchEnglishName'
    )
    .mockResolvedValue(options.english ?? null);

  return {
    service,
    entries,
    prices,
    saved,
    addPrices,
    createItem,
    categoryTree,
    fetchEnglish,
    setAvailability,
    setLocationAvailability,
    readClaims,
  };
}

describe('SourceEntryService', () => {
  describe('accept', () => {
    it('binds the row as MANUAL and never rewrites what the source printed', async () => {
      const { service, saved } = build();

      const result = await service.accept({
        userId: ADMIN,
        entryId: 'e-1',
        itemId: 'item-1',
      });

      expect(result.entry.status).toBe(SourceEntryStatus.ACTIVE);
      expect(result.entry.matchedBy).toBe(ItemSourceMatch.MANUAL);
      expect(result.entry.confidence).toBe(1);
      expect(result.entry.itemId).toBe('item-1');
      expect(result.entry.decidedAt).not.toBeNull();
      // D8: the name is the source's, and a decision does not touch it.
      expect(saved[0].name).toBe('Leche semidesnatada Hacendado');
      expect(saved[0].brand).toBe('Hacendado');
      expect(saved[0].sizeFormat).toBe('1 L');
    });

    it('writes every open scope price, each with its own run and the row kind', async () => {
      const { service, addPrices } = build({
        row: entry({
          prices: [
            price({ id: 'p-national', priceScopeId: NATIONAL, price: 1.19 }),
            price({
              id: 'p-cordoba',
              priceScopeId: CORDOBA,
              price: 1.09,
              runId: 'run-tuesday',
              // Open, relative to now: a fixed date made this price expire on
              // 2026-09-24 and the test fail every day after.
              validUntil: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
            }),
          ],
        }),
      });

      const result = await service.accept({
        userId: ADMIN,
        entryId: 'e-1',
        itemId: 'item-1',
      });

      // Two regional leaflets both get their price into their own scope from one
      // decision, which is what D3 keeps.
      expect(addPrices).toHaveBeenCalledTimes(2);
      expect(addPrices).toHaveBeenNthCalledWith(
        1,
        NATIONAL,
        [expect.objectContaining({ itemId: 'item-1', price: 1.19 })],
        'run-monday',
        PriceSourceKind.OFFICIAL_API,
        null
      );
      expect(addPrices).toHaveBeenNthCalledWith(
        2,
        CORDOBA,
        [expect.objectContaining({ price: 1.09 })],
        'run-tuesday',
        PriceSourceKind.OFFICIAL_API,
        null
      );
      expect(result.pricesWritten).toBe(2);
      expect(result.createdItem).toBeNull();
    });

    it('keeps a copied price’s provenance when it is accepted later (plan 0118)', async () => {
      const { service, addPrices } = build({
        row: entry({
          prices: [
            price({
              id: 'p-cordoba',
              priceScopeId: CORDOBA,
              price: 1.09,
              copiedFromScopeId: NATIONAL,
            }),
          ],
        }),
      });

      await service.accept({ userId: ADMIN, entryId: 'e-1', itemId: 'item-1' });

      expect(addPrices).toHaveBeenCalledWith(
        CORDOBA,
        [expect.objectContaining({ price: 1.09 })],
        'run-monday',
        PriceSourceKind.OFFICIAL_API,
        NATIONAL
      );
    });

    it('writes nothing for a window that has closed', async () => {
      const { service, addPrices } = build({
        row: entry({
          prices: [
            price({
              validUntil: new Date('2026-09-01T00:00:00.000Z'),
            }),
          ],
        }),
      });

      const result = await service.accept({
        userId: ADMIN,
        entryId: 'e-1',
        itemId: 'item-1',
      });

      // An expired price is not one anybody is charged, and inserting it only to
      // have the resolver filter it out is work with a wrong row at the end.
      expect(addPrices).not.toHaveBeenCalled();
      expect(result.pricesWritten).toBe(0);
    });

    it('answers zero for a row with no price, which is a DEZA row', async () => {
      const { service, addPrices } = build({
        row: entry({ sourceKind: PriceSourceKind.OFFICIAL_WEB, prices: [] }),
      });

      const result = await service.accept({
        userId: ADMIN,
        entryId: 'e-1',
        itemId: 'item-1',
      });

      expect(addPrices).not.toHaveBeenCalled();
      // Not a failure: the site prints no price, and the back office says so.
      expect(result.pricesWritten).toBe(0);
    });

    describe('what a bound row is owed besides its prices (plan 0182)', () => {
      const dezaRow = () =>
        entry({ sourceKind: PriceSourceKind.OFFICIAL_WEB, prices: [] });

      it('gives a row with no price an offer with no price in the default scope', async () => {
        const { service, setAvailability, addPrices } = build({
          row: dezaRow(),
        });

        await service.accept({
          userId: ADMIN,
          entryId: 'e-1',
          itemId: 'item-1',
        });

        // A chain that lists a product sells it. Before this, accepting a
        // DEZA row wrote nothing at all and the product was sold nowhere.
        expect(setAvailability).toHaveBeenCalledTimes(1);
        expect(setAvailability).toHaveBeenCalledWith(NATIONAL, [
          { itemId: 'item-1', available: true },
        ]);
        // Availability is the only write: no price is invented for it.
        expect(addPrices).not.toHaveBeenCalled();
      });

      it('writes the price and no such offer for a row that holds a price', async () => {
        const { service, setAvailability, addPrices } = build();

        await service.accept({
          userId: ADMIN,
          entryId: 'e-1',
          itemId: 'item-1',
        });

        expect(addPrices).toHaveBeenCalledTimes(1);
        expect(setAvailability).not.toHaveBeenCalled();
      });

      it('writes no offer for a chain that has no default scope', async () => {
        const { service, setAvailability } = build({
          row: dezaRow(),
          defaultScope: null,
        });

        await service.accept({
          userId: ADMIN,
          entryId: 'e-1',
          itemId: 'item-1',
        });

        expect(setAvailability).not.toHaveBeenCalled();
      });

      it('sends the stored claims of the product, one call per mapped shop', async () => {
        const observedAt = new Date('2026-10-01T08:00:00.000Z');
        const claim = (shop: string, available: boolean) => ({
          supermarketLocationId: `loc-${shop}`,
          shopCode: shop,
          itemId: 'item-1',
          sourceKind: PriceSourceKind.OFFICIAL_WEB,
          available,
          observedAt,
          runId: 'run-deza',
        });
        const { service, setLocationAvailability, readClaims } = build({
          row: dezaRow(),
          readyClaims: [claim('T1', true), claim('C1', false)],
        });

        await service.accept({
          userId: ADMIN,
          entryId: 'e-1',
          itemId: 'item-1',
        });

        // Read for the product the row is now bound to, in its own chain.
        expect(readClaims.mock.calls[0][1]).toEqual([['item-1'], [CHAIN]]);
        // A shop the popup did not name is written as false, never skipped.
        expect(setLocationAvailability.mock.calls).toEqual([
          [
            'loc-T1',
            [{ itemId: 'item-1', available: true }],
            'run-deza',
            PriceSourceKind.OFFICIAL_WEB,
            observedAt,
          ],
          [
            'loc-C1',
            [{ itemId: 'item-1', available: false }],
            'run-deza',
            PriceSourceKind.OFFICIAL_WEB,
            observedAt,
          ],
        ]);
      });

      it('does the same for a product it creates', async () => {
        const { service, setAvailability } = build({ row: dezaRow() });

        const result = await service.createItem({
          userId: ADMIN,
          entryId: 'e-1',
        });

        expect(setAvailability).toHaveBeenCalledWith(NATIONAL, [
          { itemId: result.createdItem?.id, available: true },
        ]);
      });
    });

    it('refuses somebody who is not a platform admin', async () => {
      const { service } = build();
      await expect(
        service.accept({ userId: 'stranger', entryId: 'e-1', itemId: 'item-1' })
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('createItem', () => {
    it('fills every field from the row and binds it', async () => {
      const { service, createItem, saved } = build();

      const result = await service.createItem({
        userId: ADMIN,
        entryId: 'e-1',
      });

      expect(createItem).toHaveBeenCalledWith(
        expect.objectContaining({
          name: { es: 'Leche semidesnatada Hacendado' },
          brand: 'Hacendado',
          unitSize: 1,
          imageUrl: null,
          // The row's own path, through the Mercadona table, as an id.
          categoryIds: ['cat-milk'],
        })
      );
      expect(result.createdItem).not.toBeNull();
      expect(result.entry.status).toBe(SourceEntryStatus.ACTIVE);
      // D8 again: creating the item does not rewrite the row either.
      expect(saved[0].name).toBe('Leche semidesnatada Hacendado');
    });

    describe('the pack count (plan 0162)', () => {
      /** A Carrefour six pack, split by the adapter exactly as a crawl splits it. */
      const card = splitCardName(
        'Leche entera CARREFOUR pack de 6 unidades de 1 l.',
        'l'
      );
      const sixPack = () =>
        entry({
          supermarketId: 'chain-carrefour',
          externalId: 'VC4AECOMM-6',
          sourceKind: PriceSourceKind.OFFICIAL_WEB,
          name: card.name,
          brand: 'CARREFOUR',
          unitSize: card.unitSize,
          sizeFormat: card.sizeFormat,
          packCount: card.packCount,
        });

      it('creates the item with the count the row read', async () => {
        const { service, createItem } = build({
          row: sixPack(),
          source: { adapterKey: 'carrefour-web', enabled: true, config: {} },
        });

        await service.createItem({ userId: ADMIN, entryId: 'e-1' });

        expect(card.packCount).toBe(6);
        expect(createItem).toHaveBeenCalledWith(
          expect.objectContaining({ packCount: 6, unitSize: 6 })
        );
      });

      it('takes the count the operator names over the row', async () => {
        const { service, createItem } = build({
          row: sixPack(),
          source: { adapterKey: 'carrefour-web', enabled: true, config: {} },
        });

        await service.createItem({
          userId: ADMIN,
          entryId: 'e-1',
          packCount: 4,
        });

        expect(createItem).toHaveBeenCalledWith(
          expect.objectContaining({ packCount: 4 })
        );
      });

      it('creates the item with none when the operator clears it', async () => {
        const { service, createItem } = build({
          row: sixPack(),
          source: { adapterKey: 'carrefour-web', enabled: true, config: {} },
        });

        await service.createItem({
          userId: ADMIN,
          entryId: 'e-1',
          packCount: null,
        });

        expect(createItem).toHaveBeenCalledWith(
          expect.objectContaining({ packCount: null })
        );
      });

      it('creates the item with none from a row that is not a pack', async () => {
        const { service, createItem } = build();

        await service.createItem({ userId: ADMIN, entryId: 'e-1' });

        expect(createItem).toHaveBeenCalledWith(
          expect.objectContaining({ packCount: null })
        );
      });
    });

    describe('the unit of a created item (plan 0177)', () => {
      const unitOf = async (
        row: Partial<SourceCatalogEntry>,
        req: { defaultUnit?: UnitOfMeasure } = {}
      ) => {
        const { service, createItem } = build({ row: entry(row) });
        await service.createItem({ userId: ADMIN, entryId: 'e-1', ...req });
        return createItem;
      };

      it('takes the unit the row states its size in, not a guess from the text', async () => {
        // A DEZA row: the text maps to no unit, and the size is millilitres.
        const createItem = await unitOf({
          unitSize: 750,
          sizeUnit: UnitOfMeasure.MILLILITER,
          sizeFormat: '75 cl',
        });
        expect(createItem).toHaveBeenCalledWith(
          expect.objectContaining({
            unitSize: 750,
            defaultUnit: UnitOfMeasure.MILLILITER,
          })
        );
      });

      it('takes the row unit over the text even when the text maps to one', async () => {
        const createItem = await unitOf({
          unitSize: 1980,
          sizeUnit: UnitOfMeasure.MILLILITER,
          sizeFormat: 'l',
        });
        expect(createItem).toHaveBeenCalledWith(
          expect.objectContaining({ defaultUnit: UnitOfMeasure.MILLILITER })
        );
      });

      it('takes the unit the operator names over the row', async () => {
        const createItem = await unitOf(
          {
            unitSize: 750,
            sizeUnit: UnitOfMeasure.MILLILITER,
            sizeFormat: '75 cl',
          },
          { defaultUnit: UnitOfMeasure.LITER }
        );
        expect(createItem).toHaveBeenCalledWith(
          expect.objectContaining({ defaultUnit: UnitOfMeasure.LITER })
        );
      });

      it('falls back to the printed text for a row with no unit, then to UNIT', async () => {
        // The text says kilograms, and a sized kilogram is written in grams
        // (plan 0183).
        expect(
          await unitOf({ unitSize: 0.5, sizeUnit: null, sizeFormat: 'kg' })
        ).toHaveBeenCalledWith(
          expect.objectContaining({
            unitSize: 500,
            defaultUnit: UnitOfMeasure.GRAM,
          })
        );
        expect(
          await unitOf({ unitSize: null, sizeUnit: null, sizeFormat: '75 cl' })
        ).toHaveBeenCalledWith(
          expect.objectContaining({ defaultUnit: UnitOfMeasure.UNIT })
        );
      });
    });

    describe('a created item is in a base unit (plan 0183)', () => {
      const sizeOf = async (
        row: Partial<SourceCatalogEntry>,
        req: { unitSize?: number | null; defaultUnit?: UnitOfMeasure } = {}
      ) => {
        const { service, createItem } = build({ row: entry(row) });
        await service.createItem({ userId: ADMIN, entryId: 'e-1', ...req });
        return createItem;
      };

      it('writes a row of 0.25 kg as 250 GRAM', async () => {
        expect(
          await sizeOf({
            unitSize: 0.25,
            sizeUnit: UnitOfMeasure.KILOGRAM,
            sizeFormat: 'kg',
          })
        ).toHaveBeenCalledWith(
          expect.objectContaining({
            unitSize: 250,
            defaultUnit: UnitOfMeasure.GRAM,
          })
        );
      });

      it('writes a row of 1.5 l as 1500 MILLILITER', async () => {
        expect(
          await sizeOf({
            unitSize: 1.5,
            sizeUnit: UnitOfMeasure.LITER,
            sizeFormat: '1,5 l',
          })
        ).toHaveBeenCalledWith(
          expect.objectContaining({
            unitSize: 1500,
            defaultUnit: UnitOfMeasure.MILLILITER,
          })
        );
      });

      it('keeps KILOGRAM for a row with no size, which is sold by weight', async () => {
        expect(
          await sizeOf({ unitSize: null, sizeUnit: null, sizeFormat: 'kg' })
        ).toHaveBeenCalledWith(
          expect.objectContaining({
            unitSize: null,
            defaultUnit: UnitOfMeasure.KILOGRAM,
          })
        );
      });

      describe('a row sold by weight (plan 0181)', () => {
        it('creates KILOGRAM with no size when the request names no size', async () => {
          expect(
            await sizeOf({
              soldByWeight: true,
              unitSize: null,
              sizeUnit: null,
              sizeFormat: 'kg',
            })
          ).toHaveBeenCalledWith(
            expect.objectContaining({
              unitSize: null,
              defaultUnit: UnitOfMeasure.KILOGRAM,
            })
          );
        });

        it('does so whatever the row prints as its size', async () => {
          // A leaflet tile priced by the kilo. The text maps to no unit, and
          // the guess from it used to be `UNIT`.
          expect(
            await sizeOf({
              soldByWeight: true,
              unitSize: null,
              sizeUnit: null,
              sizeFormat: 'pieza',
            })
          ).toHaveBeenCalledWith(
            expect.objectContaining({
              unitSize: null,
              defaultUnit: UnitOfMeasure.KILOGRAM,
            })
          );
        });

        it('reads a size named as null as no size named', async () => {
          expect(
            await sizeOf(
              {
                soldByWeight: true,
                unitSize: null,
                sizeUnit: null,
                sizeFormat: 'pieza',
              },
              { unitSize: null }
            )
          ).toHaveBeenCalledWith(
            expect.objectContaining({
              unitSize: null,
              defaultUnit: UnitOfMeasure.KILOGRAM,
            })
          );
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
              await sizeOf(
                {
                  soldByWeight: true,
                  unitSize: null,
                  sizeUnit: null,
                  sizeFormat: 'pieza',
                },
                { defaultUnit }
              )
            ).toHaveBeenCalledWith(
              expect.objectContaining({ unitSize: null, defaultUnit })
            );
          }
        );

        it('lets a request that names a size overrule it', async () => {
          // A person saying the pack is fixed after all.
          expect(
            await sizeOf(
              {
                soldByWeight: true,
                unitSize: null,
                sizeUnit: null,
                sizeFormat: 'kg',
              },
              { unitSize: 0.3 }
            )
          ).toHaveBeenCalledWith(
            expect.objectContaining({
              unitSize: 300,
              defaultUnit: UnitOfMeasure.GRAM,
            })
          );
        });
      });

      it('converts a size the request names with the row unit', async () => {
        expect(
          await sizeOf(
            {
              unitSize: 0.25,
              sizeUnit: UnitOfMeasure.KILOGRAM,
              sizeFormat: 'kg',
            },
            { unitSize: 0.5 }
          )
        ).toHaveBeenCalledWith(
          expect.objectContaining({
            unitSize: 500,
            defaultUnit: UnitOfMeasure.GRAM,
          })
        );
      });

      describe('a request that names the unit and leaves the size as read', () => {
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
          expect(await sizeOf(row, { defaultUnit })).toHaveBeenCalledWith(
            expect.objectContaining({ unitSize, defaultUnit })
          );
        });

        it('keeps the number when the two units are of different kinds', async () => {
          expect(
            await sizeOf(kilo, { defaultUnit: UnitOfMeasure.UNIT })
          ).toHaveBeenCalledWith(
            expect.objectContaining({
              unitSize: 0.25,
              defaultUnit: UnitOfMeasure.UNIT,
            })
          );
        });

        it('keeps the number when the row states no unit', async () => {
          expect(
            await sizeOf(
              { unitSize: 0.25, sizeUnit: null, sizeFormat: 'kg' },
              { defaultUnit: UnitOfMeasure.GRAM }
            )
          ).toHaveBeenCalledWith(
            expect.objectContaining({
              unitSize: 0.25,
              defaultUnit: UnitOfMeasure.GRAM,
            })
          );
        });
      });

      it('writes a unit the request names exactly as it was sent', async () => {
        // An admin can still write any unit by hand.
        expect(
          await sizeOf(
            {
              unitSize: 0.25,
              sizeUnit: UnitOfMeasure.KILOGRAM,
              sizeFormat: 'kg',
            },
            { unitSize: 1, defaultUnit: UnitOfMeasure.LITER }
          )
        ).toHaveBeenCalledWith(
          expect.objectContaining({
            unitSize: 1,
            defaultUnit: UnitOfMeasure.LITER,
          })
        );
      });
    });

    it('takes the operator overrides over the row defaults', async () => {
      const { service, createItem } = build();

      await service.createItem({
        userId: ADMIN,
        entryId: 'e-1',
        name: { es: 'Leche entera', en: 'Whole milk' },
        brand: null,
        categorySlugs: ['cola', 'orange'],
        defaultUnit: UnitOfMeasure.LITER,
      });

      expect(createItem).toHaveBeenCalledWith(
        expect.objectContaining({
          name: { es: 'Leche entera', en: 'Whole milk' },
          brand: null,
          categoryIds: ['cat-cola', 'cat-orange'],
          defaultUnit: UnitOfMeasure.LITER,
        })
      );
    });

    describe('the categories (plan 0166, section 7)', () => {
      it('files a path the table cannot place under uncategorised', async () => {
        const { service, createItem } = build({
          row: entry({ categoryPath: ['Nothing Mercadona has'] }),
        });

        await service.createItem({ userId: ADMIN, entryId: 'e-1' });

        expect(createItem).toHaveBeenCalledWith(
          expect.objectContaining({ categoryIds: ['cat-uncategorised'] })
        );
      });

      it('files a row with no path at all under uncategorised', async () => {
        const { service, createItem } = build({
          row: entry({ categoryPath: null }),
        });

        await service.createItem({ userId: ADMIN, entryId: 'e-1' });

        expect(createItem).toHaveBeenCalledWith(
          expect.objectContaining({ categoryIds: ['cat-uncategorised'] })
        );
      });

      it('reads the tree once for the product', async () => {
        const { service, categoryTree } = build();

        await service.createItem({ userId: ADMIN, entryId: 'e-1' });

        expect(categoryTree).toHaveBeenCalledTimes(1);
      });

      it('refuses an unknown override slug, naming it, before anything is fetched or written', async () => {
        const { service, createItem, fetchEnglish } = build();

        const refusal = await service
          .createItem({
            userId: ADMIN,
            entryId: 'e-1',
            categorySlugs: ['milk', 'ice-creem'],
          })
          .catch((error: unknown) => error);

        expect(refusal).toBeInstanceOf(CategoryNotFoundException);
        expect((refusal as CategoryNotFoundException).details).toEqual({
          [CATEGORY_UNKNOWN_DETAIL]: ['ice-creem'],
        });
        expect(fetchEnglish).not.toHaveBeenCalled();
        expect(createItem).not.toHaveBeenCalled();
      });
    });

    it('fetches the English name for an API row of a Mercadona source', async () => {
      const { service, fetchEnglish, createItem } = build({
        english: 'Semi skimmed milk',
      });

      await service.createItem({ userId: ADMIN, entryId: 'e-1' });

      expect(fetchEnglish).toHaveBeenCalled();
      expect(createItem).toHaveBeenCalledWith(
        expect.objectContaining({
          name: {
            es: 'Leche semidesnatada Hacendado',
            en: 'Semi skimmed milk',
          },
        })
      );
    });

    it('creates the item with the Spanish name alone when there is no English one', async () => {
      // Plan 0079: an absent `en` is a visible gap the admin can list, and a copy
      // of the Spanish string would be indistinguishable from a translation.
      const { service, createItem } = build({ english: null });

      await service.createItem({ userId: ADMIN, entryId: 'e-1' });

      expect(createItem).toHaveBeenCalledWith(
        expect.objectContaining({
          name: { es: 'Leche semidesnatada Hacendado' },
        })
      );
    });

    it('creates the item with the English name alone when that is all the operator gave', async () => {
      // **The regression plan 0111 exists for.** The old rule read `req.name.es`
      // and nothing else, so an operator who filled English and left Spanish
      // blank got the chain's printed Spanish string stored beside their typed
      // English: they wrote one name and the catalog held two, one of which
      // nobody had checked. No `es` key is the whole assertion.
      const { service, createItem } = build({ english: null });

      await service.createItem({
        userId: ADMIN,
        entryId: 'e-1',
        name: { en: 'Semi skimmed milk' },
      });

      expect(createItem).toHaveBeenCalledWith(
        expect.objectContaining({ name: { en: 'Semi skimmed milk' } })
      );
      const [[input]] = createItem.mock.calls;
      expect(input.name).not.toHaveProperty('es');
    });

    it('never lets the fetched English name overrule one the operator typed', async () => {
      // The fetch fills a language left blank and replaces none. An operator who
      // typed an English name has said what the product is called in English.
      const { service, createItem, fetchEnglish } = build({
        english: 'Semi skimmed milk',
      });

      await service.createItem({
        userId: ADMIN,
        entryId: 'e-1',
        name: { es: 'Leche entera', en: 'Whole milk' },
      });

      expect(fetchEnglish).not.toHaveBeenCalled();
      expect(createItem).toHaveBeenCalledWith(
        expect.objectContaining({
          name: { es: 'Leche entera', en: 'Whole milk' },
        })
      );
    });

    it('refuses when neither the request nor the row names the product', async () => {
      // The message used to offer a choice the code did not honour: it said any
      // one language would do while checking `es` alone. It is true now.
      const { service, createItem } = build({ row: entry({ name: '' }) });

      await expect(
        service.createItem({ userId: ADMIN, entryId: 'e-1' })
      ).rejects.toThrow('A product needs a name in at least one language.');
      expect(createItem).not.toHaveBeenCalled();
    });

    it('refuses when the chain does not say what language it prints in', async () => {
      // A printed string of unknown language is not a name in any particular
      // one, and guessing is what this plan removes (section 7). The operator
      // names the product instead.
      const { service, createItem } = build({ source: null });

      await expect(
        service.createItem({ userId: ADMIN, entryId: 'e-1' })
      ).rejects.toThrow('A product needs a name in at least one language.');
      expect(createItem).not.toHaveBeenCalled();
    });

    it('takes a name the operator typed even when the chain prints no language', async () => {
      // The refusal above is about having nothing to file, not about the chain.
      const { service, createItem } = build({ source: null });

      await service.createItem({
        userId: ADMIN,
        entryId: 'e-1',
        name: { es: 'Leche entera' },
      });

      expect(createItem).toHaveBeenCalledWith(
        expect.objectContaining({ name: { es: 'Leche entera' } })
      );
    });

    it('ignores a name key the operator left blank', async () => {
      // `{ en: '  ' }` would satisfy every "at least one language" check and put
      // an empty string on every screen, so a blank key is dropped and the row's
      // printed name answers instead.
      const { service, createItem } = build({ english: null });

      await service.createItem({
        userId: ADMIN,
        entryId: 'e-1',
        name: { en: '   ' },
      });

      expect(createItem).toHaveBeenCalledWith(
        expect.objectContaining({
          name: { es: 'Leche semidesnatada Hacendado' },
        })
      );
    });

    it('refuses an EAN the catalog already holds, naming the item', async () => {
      const { service } = build({ row: entry({ ean: '8480000123456' }) });
      const catalog = (
        service as unknown as {
          catalog: { findItemByEan: jest.Mock };
        }
      ).catalog;
      catalog.findItemByEan.mockResolvedValueOnce({ item: item('item-held') });

      await expect(
        service.createItem({ userId: ADMIN, entryId: 'e-1' })
      ).rejects.toThrow(/item-held/);
    });
  });

  describe('reject', () => {
    it('clears the item and leaves the printed name alone', async () => {
      const { service, saved } = build({
        row: entry({
          status: SourceEntryStatus.CANDIDATE,
          itemId: 'item-proposed',
          candidateEntryId: 'e-sibling',
          matchedBy: ItemSourceMatch.NAME_SIZE,
          confidence: 0.6,
        }),
      });

      const view = await service.reject({ userId: ADMIN, entryId: 'e-1' });

      expect(view.status).toBe(SourceEntryStatus.REJECTED);
      expect(view.itemId).toBeNull();
      expect(view.candidateEntryId).toBeNull();
      expect(view.decidedAt).not.toBeNull();
      expect(saved[0].name).toBe('Leche semidesnatada Hacendado');
    });
  });

  describe('list, filtered by brand key', () => {
    /**
     * A query builder that records its `andWhere` clauses and answers nothing.
     *
     * The filter under test is one clause and one parameter, so the clauses are
     * the whole assertion: a fake that returned rows would only be asserting
     * that the fake returned them.
     */
    function recordingBuilder() {
      const clauses: { sql: string; params?: Record<string, unknown> }[] = [];
      const qb = {
        leftJoinAndSelect: () => qb,
        orderBy: () => qb,
        addOrderBy: () => qb,
        take: () => qb,
        andWhere: (sql: string, params?: Record<string, unknown>) => {
          clauses.push({ sql, params });
          return qb;
        },
        getMany: async () => [],
      };
      return { qb, clauses };
    }

    it('keys the value before matching, so El Pozo finds elpozo', async () => {
      const { service, entries } = build();
      const { qb, clauses } = recordingBuilder();
      (entries.createQueryBuilder as jest.Mock).mockReturnValue(qb);

      await service.list({ userId: ADMIN, brandKey: 'El Pozo' });

      const clause = clauses.find((c) => c.sql.includes('e."brandKey"'));
      expect(clause?.params).toEqual({ brandKey: 'elpozo' });
    });

    it('matches nothing for a value that makes no key', async () => {
      const { service, entries } = build();
      const { qb, clauses } = recordingBuilder();
      (entries.createQueryBuilder as jest.Mock).mockReturnValue(qb);

      const page = await service.list({ userId: ADMIN, brandKey: '---' });

      // An empty list rather than a refusal: a person typing punctuation gets
      // no rows, which is the truthful answer, and not an error.
      expect(clauses.some((c) => c.sql === 'FALSE')).toBe(true);
      expect(page.items).toEqual([]);
    });

    it('leaves the queue alone when no brand key is asked for', async () => {
      const { service, entries } = build();
      const { qb, clauses } = recordingBuilder();
      (entries.createQueryBuilder as jest.Mock).mockReturnValue(qb);

      await service.list({ userId: ADMIN });

      expect(clauses.some((c) => c.sql.includes('e."brandKey"'))).toBe(false);
      expect(clauses.some((c) => c.sql === 'FALSE')).toBe(false);
    });
  });

  describe('the revert helpers', () => {
    it('deletes only the rows this run created and no later run observed', async () => {
      const { service, entries } = build();

      await service.deleteUndecidedFrom('run-monday');

      // Both run columns, which is what stops a revert taking a later run's
      // observation of a row this one happened to create (section 8).
      const [where] = (entries.delete as jest.Mock).mock.calls[0] as [
        Record<string, unknown>,
      ];
      expect(where['firstRunId']).toBe('run-monday');
      expect(where['lastRunId']).toBe('run-monday');
      expect((where['status'] as { value: string[] }).value).toEqual([
        SourceEntryStatus.CANDIDATE,
        SourceEntryStatus.UNRESOLVED,
      ]);
    });

    it('deletes the price observations the run made', async () => {
      const { service, prices } = build();

      const deleted = await service.deleteObservedPricesFrom('run-monday');

      expect(prices.delete).toHaveBeenCalledWith({ runId: 'run-monday' });
      expect(deleted).toBe(2);
    });
  });
});
