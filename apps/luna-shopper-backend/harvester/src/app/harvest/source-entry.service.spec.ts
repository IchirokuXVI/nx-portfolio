import type { ConfigService } from '@nestjs/config';
import {
  ItemCategory,
  ItemSourceMatch,
  PriceSourceKind,
  SourceEntryStatus,
  UnitOfMeasure,
  type ItemView,
} from '@portfolio/luna-shopper/contracts';
import { ForbiddenException } from '@portfolio/luna-shopper/platform';
import type { Repository } from 'typeorm';
import type {
  HarvestRun,
  SourceCatalogEntry,
  SourceEntryPrice,
  SupermarketSource,
} from '../entities';
import type { CatalogClient } from './catalog-client.service';
import type { PlatformAdminService } from './platform-admin.service';
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
    categoryPath: ['Lácteos', 'Leche'],
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
    category: ItemCategory.DAIRY,
    defaultUnit: UnitOfMeasure.LITER,
  } as unknown as ItemView;
}

function build(
  options: {
    row?: SourceCatalogEntry;
    source?: Partial<SupermarketSource> | null;
    english?: string | null;
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
  const catalog = {
    addPrices,
    createItem,
    findItemByEan: jest.fn(async () => ({ item: null })),
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

  const service = new SourceEntryService(
    entries,
    prices,
    runs,
    catalog,
    sources,
    makeAdmin(),
    config
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
    fetchEnglish,
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
              validUntil: new Date('2026-09-24T00:00:00.000Z'),
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
        PriceSourceKind.OFFICIAL_API
      );
      expect(addPrices).toHaveBeenNthCalledWith(
        2,
        CORDOBA,
        [expect.objectContaining({ price: 1.09 })],
        'run-tuesday',
        PriceSourceKind.OFFICIAL_API
      );
      expect(result.pricesWritten).toBe(2);
      expect(result.createdItem).toBeNull();
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
        })
      );
      expect(result.createdItem).not.toBeNull();
      expect(result.entry.status).toBe(SourceEntryStatus.ACTIVE);
      // D8 again: creating the item does not rewrite the row either.
      expect(saved[0].name).toBe('Leche semidesnatada Hacendado');
    });

    it('takes the operator overrides over the row defaults', async () => {
      const { service, createItem } = build();

      await service.createItem({
        userId: ADMIN,
        entryId: 'e-1',
        name: { es: 'Leche entera', en: 'Whole milk' },
        brand: null,
        category: ItemCategory.BEVERAGES,
        defaultUnit: UnitOfMeasure.LITER,
      });

      expect(createItem).toHaveBeenCalledWith(
        expect.objectContaining({
          name: { es: 'Leche entera', en: 'Whole milk' },
          brand: null,
          category: ItemCategory.BEVERAGES,
          defaultUnit: UnitOfMeasure.LITER,
        })
      );
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
