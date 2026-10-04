import type { ConfigService } from '@nestjs/config';
import {
  BulkOperationErrorCode,
  ItemSourceMatch,
  PriceSourceKind,
  SourceEntryStatus,
  UnitOfMeasure,
  type ItemEanPair,
  type ItemView,
  type SourceEntryDecisionOperation,
} from '@portfolio/luna-shopper/contracts';
import {
  ITEM_EAN_DETAIL,
  ITEM_EAN_HOLDER_DETAIL,
  ItemEanHeldException,
} from '@portfolio/luna-shopper/platform';
import type { FindOperator, Repository } from 'typeorm';
import type {
  HarvestRun,
  SourceCatalogEntry,
  SourceEntryAvailability,
  SourceEntryPrice,
  SupermarketSource,
} from '../entities';
import type { CatalogClient } from './catalog-client.service';
import type { PlatformAdminService } from './platform-admin.service';
import type { RunContext } from './run-context';
import { SourceEntryAvailabilityWriter } from './source-entry-availability';
import { SourceEntryBatchService } from './source-entry-batch.service';
import { SourceEntryPriceWriter } from './source-entry-write';
import { SourceEntryService } from './source-entry.service';
import { SourceIngest, type SourceObservation } from './source-ingest';
import type { SupermarketSourceService } from './supermarket-source.service';

/**
 * Accepting a row teaches its barcode (plan 0185).
 *
 * A maker prints a new barcode when it changes a factory, a supplier or a
 * label, and the product on the shelf is the same. The catalog held one EAN
 * per product, so the second barcode was recorded nowhere and its row stayed
 * in the queue for ever. Four rules, on both decision routes:
 *
 * - accepting a row whose real EAN no product holds gives that EAN to the
 *   product it is accepted onto;
 * - a later ingest that first sees a row printing that EAN binds it by itself,
 *   stamped `EAN`, because the match index maps every barcode of a product;
 * - accepting a row whose EAN **another** product holds is refused with a
 *   named code, and nothing is written;
 * - an in-store code teaches nothing and refuses nothing.
 *
 * The decision itself is still stamped `MANUAL` (plan 0184, as the owner
 * decided on 2026-10-04). `EAN` here is the ingest's own stamp.
 *
 * One fake catalog stands behind both decision services and the ingest, and
 * it holds barcodes the way the real one does: every barcode names one
 * product. So a barcode an accept teaches is one the ingest then matches on.
 */

const ADMIN = 'owner-1';
const MERCADONA = '11111111-1111-4111-8111-111111111111';
const OTHER_CHAIN = '55555555-5555-4555-8555-555555555555';
const SCOPE = '22222222-2222-4222-8222-222222222222';
const RUN = '33333333-3333-4333-8333-333333333333';
const NOW = new Date('2026-10-03T09:00:00.000Z');

/** Whole milk: the product's own barcode, and the one a second factory prints. */
const PRODUCT_EAN = '8402001002083';
const ROW_EAN = '8402001047251';
const IN_STORE = '2204500000000';

function milk(id: string, eans: string[]): ItemView {
  return {
    id,
    name: { es: 'Leche entera', en: 'Whole milk' },
    brand: 'Hacendado',
    imageUrl: null,
    sku: null,
    ean: eans[0] ?? null,
    eans,
    unitSize: 1000,
    packCount: null,
    categories: [],
    defaultUnit: UnitOfMeasure.MILLILITER,
    productGroupId: null,
  } as unknown as ItemView;
}

function queued(
  overrides: Partial<SourceCatalogEntry> = {}
): SourceCatalogEntry {
  return {
    id: 'e-1',
    supermarketId: MERCADONA,
    externalId: '10381',
    sourceKind: PriceSourceKind.OFFICIAL_API,
    name: 'Leche entera Hacendado',
    brand: 'Hacendado',
    ean: ROW_EAN,
    unitSize: 1,
    sizeFormat: '1 L',
    categoryPath: [],
    url: null,
    extra: null,
    timesSeen: 2,
    firstSeenAt: NOW,
    lastSeenAt: NOW,
    firstRunId: RUN,
    lastRunId: RUN,
    itemId: 'item-milk',
    candidateEntryId: null,
    status: SourceEntryStatus.CANDIDATE,
    matchedBy: ItemSourceMatch.NAME_BRAND_SIZE,
    confidence: 0.6,
    decidedAt: null,
    prices: [
      {
        id: 'sep-1',
        entryId: 'e-1',
        priceScopeId: SCOPE,
        price: 0.95,
        currency: 'EUR',
        unitPrice: 0.95,
        unitPriceLabel: '€/L',
        validFrom: null,
        validUntil: null,
        details: null,
        observedAt: NOW,
        runId: RUN,
        createdAt: NOW,
        updatedAt: NOW,
      } as unknown as SourceEntryPrice,
    ],
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  } as SourceCatalogEntry;
}

/** The ids an `In(...)` criterion names, whichever way TypeORM wrapped them. */
function idsOf(where: unknown): string[] {
  const id = (where as { id?: FindOperator<string> | string })?.id;
  if (typeof id === 'string') {
    return [id];
  }
  const value = (id as unknown as { value?: string[] })?.value;
  return Array.isArray(value) ? value : [];
}

/**
 * A catalog that holds barcodes the way the real one does: each names one
 * product, and teaching one a product does not hold adds it, unless another
 * product holds it.
 */
function fakeCatalog(products: ItemView[]) {
  const holderOf = (ean: string) =>
    products.find((product) => product.eans.includes(ean)) ?? null;

  const findItemByEan = jest.fn(async (ean: string) => ({
    item: holderOf(ean),
  }));
  const findItemsByEans = jest.fn(async (eans: string[]) => ({
    items: [
      ...new Set(
        eans.map(holderOf).filter((held): held is ItemView => held !== null)
      ),
    ],
  }));
  const teachItemEans = jest.fn(async (entries: ItemEanPair[]) => {
    let added = 0;
    const refused = [];
    for (const { itemId, ean } of entries) {
      const holder = holderOf(ean);
      const product = products.find((each) => each.id === itemId);
      if (holder && holder.id !== itemId) {
        refused.push({
          itemId,
          ean,
          reason: 'HELD' as const,
          heldBy: holder.id,
        });
      } else if (!holder && product) {
        product.eans.push(ean);
        product.ean = product.ean ?? ean;
        added += 1;
      }
    }
    return { added, refused };
  });
  const addPrices = jest.fn(async () => ({ inserted: 1, confirmed: 0 }));
  const client = {
    findItemByEan,
    findItemsByEans,
    teachItemEans,
    addPrices,
    // The page the ingest builds its match index from.
    searchItems: jest.fn(async () => ({ items: products, nextCursor: null })),
    getSupermarket: jest.fn(async () => ({
      id: MERCADONA,
      defaultPriceScopeId: SCOPE,
    })),
    setAvailability: jest.fn(async () => ({ updated: 1 })),
    setLocationAvailability: jest.fn(async () => ({
      written: 0,
      skipped: 0,
      conflicts: [],
    })),
  };
  return {
    client: client as unknown as CatalogClient,
    products,
    findItemByEan,
    findItemsByEans,
    teachItemEans,
    addPrices,
  };
}

const admin = {
  requireAdmin: jest.fn(async (credential: { userId: string }) => {
    expect(credential.userId).toBe(ADMIN);
    return credential.userId;
  }),
} as unknown as PlatformAdminService;

const sources = {
  findBySupermarket: jest.fn(
    async () => ({ adapterKey: 'mercadona-api' }) as SupermarketSource
  ),
} as unknown as SupermarketSourceService;

/**
 * What the chain EAN count query answers over these rows: how many rows of
 * each chain print each EAN, which is what `ChainEanIndex` counts.
 */
function chainEanRows(
  rows: readonly SourceCatalogEntry[],
  eans: readonly string[]
): { supermarketId: string; ean: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (row.ean && eans.includes(row.ean)) {
      const key = `${row.supermarketId}|${row.ean}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return [...counts].map(([key, count]) => {
    const [supermarketId, ean] = key.split('|');
    return { supermarketId, ean, count };
  });
}

/**
 * The one row route, over the fake catalog. `chain` is every row the harvester
 * holds, which is what the shared EAN count reads. The row alone when absent.
 */
function oneRowRoute(
  catalog: ReturnType<typeof fakeCatalog>,
  row: SourceCatalogEntry,
  chain: readonly SourceCatalogEntry[] = [row]
) {
  const saved: SourceCatalogEntry[] = [];
  const entries = {
    findOne: jest.fn(async () => row),
    find: jest.fn(async () => []),
    save: jest.fn(async (input: SourceCatalogEntry) => {
      saved.push({ ...input } as SourceCatalogEntry);
      return input;
    }),
    query: jest.fn(async (_sql: string, [eans]: [string[]]) =>
      chainEanRows(chain, eans)
    ),
  } as unknown as Repository<SourceCatalogEntry>;
  const availability = new SourceEntryAvailabilityWriter(
    {
      query: jest.fn(async () => []),
    } as unknown as Repository<SourceEntryAvailability>,
    catalog.client
  );
  const service = new SourceEntryService(
    entries,
    {} as Repository<SourceEntryPrice>,
    {} as Repository<HarvestRun>,
    catalog.client,
    sources,
    admin,
    new SourceEntryPriceWriter(catalog.client, entries),
    {} as ConfigService,
    availability
  );
  return { service, saved };
}

/** The bulk route, over the fake catalog. */
function bulkRoute(
  catalog: ReturnType<typeof fakeCatalog>,
  rows: SourceCatalogEntry[],
  // Every row the harvester holds. The file's own rows when absent.
  chain: readonly SourceCatalogEntry[] = rows
) {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const saved: SourceCatalogEntry[] = [];
  const named = (opts: { where?: unknown }) =>
    idsOf(opts?.where)
      .map((id) => byId.get(id))
      .filter(Boolean);
  const manager = {
    find: jest.fn(async (_target: unknown, opts: { where?: unknown }) =>
      named(opts)
    ),
    save: jest.fn(async (_target: unknown, row: SourceCatalogEntry) => {
      saved.push({ ...row });
      return row;
    }),
    transaction: jest.fn(async (work: (m: unknown) => Promise<unknown>) =>
      work(manager)
    ),
  };
  const entries = {
    manager,
    find: jest.fn(async (opts: { where?: unknown }) => named(opts)),
    query: jest.fn(async (_sql: string, [eans]: [string[]]) =>
      chainEanRows(chain, eans)
    ),
  } as unknown as Repository<SourceCatalogEntry>;
  const write = jest.fn(
    async (row: SourceCatalogEntry) => (row.prices ?? []).length
  );
  const writeForEntries = jest.fn(async () => ({
    written: 0,
    shops: 0,
    conflicts: [],
    pricelessOffers: 0,
  }));
  const service = new SourceEntryBatchService(
    entries,
    catalog.client,
    { write } as unknown as SourceEntryPriceWriter,
    admin,
    sources,
    { writeForEntries } as unknown as SourceEntryAvailabilityWriter
  );
  return { service, saved, write, writeForEntries };
}

const accept = (
  entryId: string,
  itemId: string
): SourceEntryDecisionOperation => ({
  op: 'accept',
  entryId,
  itemId,
  expect: {
    status: SourceEntryStatus.CANDIDATE,
    lastSeenAt: NOW.toISOString(),
  },
});

/** A run of one chain that sees one row for the first time. */
async function ingestFirstSight(
  catalog: ReturnType<typeof fakeCatalog>,
  supermarketId: string,
  ean: string
) {
  const saved: SourceCatalogEntry[] = [];
  const entries = {
    find: jest.fn(async () => []),
    create: jest.fn((row: SourceCatalogEntry) => ({ id: 'new-1', ...row })),
    save: jest.fn(async (row: SourceCatalogEntry) => {
      saved.push(row);
      return row;
    }),
  } as unknown as Repository<SourceCatalogEntry>;
  const prices = {
    upsert: jest.fn(async () => undefined),
  } as unknown as Repository<SourceEntryPrice>;
  const context = {
    runId: RUN,
    report: jest.fn(async () => undefined),
    warn: jest.fn(),
  } as unknown as RunContext;
  const observation: SourceObservation = {
    externalId: 'other-chain-milk',
    name: 'Leche entera 1 l',
    brand: null,
    ean,
    unitSize: null,
    sizeUnit: null,
    sizeFormat: null,
    categoryPath: [],
    url: null,
    observedAt: NOW,
    extra: null,
    prices: [
      {
        scopeKey: null,
        price: 0.99,
        currency: 'EUR',
        unitPrice: 0.99,
        unitPriceLabel: '€/L',
        validFrom: null,
        validUntil: null,
      },
    ],
  };
  const result = await new SourceIngest(entries, prices, catalog.client).ingest(
    context,
    {
      supermarketId,
      defaultPriceScopeId: SCOPE,
      sourceKind: PriceSourceKind.OFFICIAL_API,
      observations: [observation],
    }
  );
  return { ...result, saved };
}

describe('accepting a row teaches its barcode (plan 0185)', () => {
  describe('the one row route', () => {
    it('adds the row’s real EAN to the product, and a later ingest binds a row with that EAN by itself, stamped EAN', async () => {
      const catalog = fakeCatalog([milk('item-milk', [PRODUCT_EAN])]);

      // Before the decision, a run that sees the second barcode matches
      // nothing by EAN: the product does not hold it.
      const before = await ingestFirstSight(catalog, OTHER_CHAIN, ROW_EAN);
      expect(before.saved[0].matchedBy).not.toBe(ItemSourceMatch.EAN);
      expect(before.saved[0].status).not.toBe(SourceEntryStatus.ACTIVE);

      const { service, saved } = oneRowRoute(catalog, queued());
      const result = await service.accept({
        userId: ADMIN,
        entryId: 'e-1',
        itemId: 'item-milk',
      });

      // The barcode is the product's now, beside the one it had.
      expect(catalog.teachItemEans).toHaveBeenCalledWith([
        { itemId: 'item-milk', ean: ROW_EAN },
      ]);
      expect(catalog.products[0].eans).toEqual([PRODUCT_EAN, ROW_EAN]);
      expect(catalog.products[0].ean).toBe(PRODUCT_EAN);
      // The decision is a person's, so it is stamped MANUAL, and the row
      // keeps what the chain printed.
      expect(result.entry.status).toBe(SourceEntryStatus.ACTIVE);
      expect(result.entry.matchedBy).toBe(ItemSourceMatch.MANUAL);
      expect(saved[0].ean).toBe(ROW_EAN);
      expect(result.pricesWritten).toBe(1);

      // The next run that first sees a row printing the second barcode binds
      // it by itself. That stamp is the ingest's own, and it is EAN.
      const after = await ingestFirstSight(catalog, OTHER_CHAIN, ROW_EAN);
      expect(after.outcomes[0]).toMatchObject({
        rung: 2,
        created: true,
        itemId: 'item-milk',
      });
      expect(after.saved[0]).toMatchObject({
        status: SourceEntryStatus.ACTIVE,
        matchedBy: ItemSourceMatch.EAN,
        confidence: 1,
        itemId: 'item-milk',
      });
      expect(catalog.addPrices).toHaveBeenLastCalledWith(
        SCOPE,
        [expect.objectContaining({ itemId: 'item-milk', price: 0.99 })],
        RUN,
        PriceSourceKind.OFFICIAL_API,
        null
      );
    });

    it('writes the barcode after the prices, and teaches nothing for an in-store code or a barcode the product holds', async () => {
      const order: string[] = [];
      const catalog = fakeCatalog([milk('item-milk', [PRODUCT_EAN])]);
      catalog.addPrices.mockImplementation(async () => {
        order.push('prices');
        return { inserted: 1, confirmed: 0 };
      });
      const teach = catalog.teachItemEans.getMockImplementation();
      catalog.teachItemEans.mockImplementation(async (entries) => {
        order.push('barcode');
        return (teach as NonNullable<typeof teach>)(entries);
      });
      await oneRowRoute(catalog, queued()).service.accept({
        userId: ADMIN,
        entryId: 'e-1',
        itemId: 'item-milk',
      });
      expect(order).toEqual(['prices', 'barcode']);

      // The product holds it now, so accepting a second row that prints it
      // teaches nothing.
      catalog.teachItemEans.mockClear();
      await oneRowRoute(
        catalog,
        queued({ id: 'e-2', externalId: '10382', supermarketId: OTHER_CHAIN })
      ).service.accept({ userId: ADMIN, entryId: 'e-2', itemId: 'item-milk' });
      expect(catalog.teachItemEans).not.toHaveBeenCalled();

      // A code of one shop's scales is not a barcode: nothing is asked and
      // nothing is taught, and the accept lands.
      catalog.findItemByEan.mockClear();
      const inStore = await oneRowRoute(
        catalog,
        queued({ id: 'e-3', externalId: '10383', ean: IN_STORE })
      ).service.accept({ userId: ADMIN, entryId: 'e-3', itemId: 'item-milk' });
      expect(inStore.entry.status).toBe(SourceEntryStatus.ACTIVE);
      expect(catalog.findItemByEan).not.toHaveBeenCalled();
      expect(catalog.teachItemEans).not.toHaveBeenCalled();
    });

    it('refuses with item_ean_held when another product holds the row’s EAN, and writes nothing', async () => {
      const catalog = fakeCatalog([
        milk('item-milk', [PRODUCT_EAN]),
        milk('item-other', [ROW_EAN]),
      ]);
      const { service, saved } = oneRowRoute(catalog, queued());

      const refusal = await service
        .accept({ userId: ADMIN, entryId: 'e-1', itemId: 'item-milk' })
        .catch((error: unknown) => error);

      expect(refusal).toBeInstanceOf(ItemEanHeldException);
      expect((refusal as ItemEanHeldException).code).toBe('item_ean_held');
      expect((refusal as ItemEanHeldException).details).toEqual({
        [ITEM_EAN_DETAIL]: ROW_EAN,
        [ITEM_EAN_HOLDER_DETAIL]: 'item-other',
      });
      // Nothing is written: no bind, no price, no barcode.
      expect(saved).toEqual([]);
      expect(catalog.addPrices).not.toHaveBeenCalled();
      expect(catalog.teachItemEans).not.toHaveBeenCalled();
      expect(catalog.products[0].eans).toEqual([PRODUCT_EAN]);

      // Accepting it onto the product that holds the barcode is the answer,
      // and it lands.
      const onto = await service.accept({
        userId: ADMIN,
        entryId: 'e-1',
        itemId: 'item-other',
      });
      expect(onto.entry.itemId).toBe('item-other');
      expect(catalog.teachItemEans).not.toHaveBeenCalled();
    });
  });

  describe('the bulk route', () => {
    it('adds the barcode of every accepted row in one call, after the prices and the availability', async () => {
      const catalog = fakeCatalog([
        milk('item-milk', [PRODUCT_EAN]),
        milk('item-butter', []),
      ]);
      const { service, saved, write, writeForEntries } = bulkRoute(catalog, [
        queued(),
        queued({ id: 'e-2', externalId: '10382', ean: '4006381333931' }),
        queued({ id: 'e-3', externalId: '10383', ean: IN_STORE }),
        queued({ id: 'e-4', externalId: '10384', ean: PRODUCT_EAN }),
      ]);

      const result = await service.applyDecisions({
        userId: ADMIN,
        operations: [
          accept('e-1', 'item-milk'),
          accept('e-2', 'item-butter'),
          accept('e-3', 'item-butter'),
          // The product already holds this one.
          accept('e-4', 'item-milk'),
        ],
      });

      expect(result.applied).toBe(true);
      expect(result.priceSkips).toEqual([]);
      // One round trip to ask and one to write, however many rows.
      expect(catalog.findItemsByEans).toHaveBeenCalledTimes(1);
      expect(catalog.teachItemEans).toHaveBeenCalledTimes(1);
      expect(catalog.teachItemEans).toHaveBeenCalledWith([
        { itemId: 'item-milk', ean: ROW_EAN },
        { itemId: 'item-butter', ean: '4006381333931' },
      ]);
      expect(catalog.products[0].eans).toEqual([PRODUCT_EAN, ROW_EAN]);
      expect(catalog.products[1].eans).toEqual(['4006381333931']);
      // Every decision is a person's.
      expect(saved.map((row) => row.matchedBy)).toEqual([
        ItemSourceMatch.MANUAL,
        ItemSourceMatch.MANUAL,
        ItemSourceMatch.MANUAL,
        ItemSourceMatch.MANUAL,
      ]);
      // Step 4 in order: prices, availability, barcodes.
      const last = (mock: jest.Mock) =>
        Math.max(...mock.mock.invocationCallOrder);
      expect(last(write)).toBeLessThan(last(writeForEntries));
      expect(last(writeForEntries)).toBeLessThan(last(catalog.teachItemEans));

      // And the next run that first sees the second barcode binds it by EAN.
      const after = await ingestFirstSight(catalog, OTHER_CHAIN, ROW_EAN);
      expect(after.saved[0]).toMatchObject({
        status: SourceEntryStatus.ACTIVE,
        matchedBy: ItemSourceMatch.EAN,
        itemId: 'item-milk',
      });
    });

    it('refuses the whole file at VALIDATE with EAN_HELD when another product holds a row’s EAN, and writes nothing', async () => {
      const catalog = fakeCatalog([
        milk('item-milk', [PRODUCT_EAN]),
        milk('item-other', [ROW_EAN]),
        milk('item-butter', []),
      ]);
      const { service, saved, write, writeForEntries } = bulkRoute(catalog, [
        queued({ id: 'e-0', externalId: '10380', ean: '4006381333931' }),
        queued(),
      ]);

      const result = await service.applyDecisions({
        userId: ADMIN,
        operations: [accept('e-0', 'item-butter'), accept('e-1', 'item-milk')],
      });

      expect(result.applied).toBe(false);
      expect(result.failedStep).toBe('VALIDATE');
      expect(result.results.map((outcome) => outcome.applied)).toEqual([
        false,
        false,
      ]);
      expect(result.results[0].error).toBeNull();
      expect(result.results[1].error).toMatchObject({
        code: BulkOperationErrorCode.EAN_HELD,
      });
      expect(result.results[1].error?.detail).toContain(ROW_EAN);
      expect(result.results[1].error?.detail).toContain('item-other');
      // The file applies completely or not at all: the first operation was
      // fine and did not land either.
      expect(saved).toEqual([]);
      expect(write).not.toHaveBeenCalled();
      expect(writeForEntries).not.toHaveBeenCalled();
      expect(catalog.teachItemEans).not.toHaveBeenCalled();
      expect(catalog.products[2].eans).toEqual([]);
    });

    it('refuses two accepts of one file that give one barcode to two products', async () => {
      const catalog = fakeCatalog([
        milk('item-milk', [PRODUCT_EAN]),
        milk('item-butter', []),
      ]);
      // Two chains, one row each: the barcode is shared inside neither, so
      // it names one product and cannot go to two.
      const { service, saved } = bulkRoute(catalog, [
        queued(),
        queued({ id: 'e-2', externalId: '10382', supermarketId: OTHER_CHAIN }),
      ]);

      const result = await service.applyDecisions({
        userId: ADMIN,
        operations: [accept('e-1', 'item-milk'), accept('e-2', 'item-butter')],
      });

      expect(result.applied).toBe(false);
      expect(result.failedStep).toBe('VALIDATE');
      expect(result.results[0].error).toBeNull();
      expect(result.results[1].error?.code).toBe(
        BulkOperationErrorCode.EAN_HELD
      );
      expect(saved).toEqual([]);
      expect(catalog.teachItemEans).not.toHaveBeenCalled();
    });

    it('leaves every bind standing and names the row when the barcode write fails', async () => {
      const catalog = fakeCatalog([milk('item-milk', [PRODUCT_EAN])]);
      catalog.teachItemEans.mockRejectedValueOnce(new Error('catalog is away'));
      const { service, saved } = bulkRoute(catalog, [queued()]);

      const result = await service.applyDecisions({
        userId: ADMIN,
        operations: [accept('e-1', 'item-milk')],
      });

      expect(result.applied).toBe(true);
      expect(saved).toHaveLength(1);
      expect(result.results[0]).toMatchObject({
        applied: true,
        itemId: 'item-milk',
        pricesWritten: 1,
      });
      expect(result.priceSkips).toEqual([
        {
          entryId: 'e-1',
          itemId: 'item-milk',
          reason: `Barcode ${ROW_EAN}: catalog is away`,
        },
      ]);
    });

    it('names a barcode another product took between the check and the write', async () => {
      const catalog = fakeCatalog([
        milk('item-milk', [PRODUCT_EAN]),
        milk('item-other', []),
      ]);
      const { service } = bulkRoute(catalog, [queued()]);
      // The check finds nobody. Then another write gives the barcode away.
      catalog.findItemsByEans.mockImplementationOnce(async () => {
        catalog.products[1].eans.push(ROW_EAN);
        return { items: [] };
      });

      const result = await service.applyDecisions({
        userId: ADMIN,
        operations: [accept('e-1', 'item-milk')],
      });

      expect(result.applied).toBe(true);
      expect(result.priceSkips).toHaveLength(1);
      expect(result.priceSkips[0]).toMatchObject({
        entryId: 'e-1',
        itemId: 'item-milk',
      });
      expect(result.priceSkips[0].reason).toContain('item-other');
      expect(catalog.products[0].eans).toEqual([PRODUCT_EAN]);
    });
  });
});

/**
 * An EAN one chain prints on several products (plan 0155) names no single
 * product. Mercadona gives one EAN to five cuts of one fish, and each cut is a
 * product of its own. A row that prints such a barcode is bound as it was
 * before plan 0185: it teaches nothing, and it is not refused because another
 * product holds the barcode. "Shared" is the ingest's own count: more than one
 * row of the chain carries the EAN.
 */
describe('an EAN the chain prints on several rows (plan 0185)', () => {
  const DORADA = '8436000000016';
  const CUTS = ['entera', 'limpia', 'filetes', 'lomos', 'rodajas'];
  const cuts = () =>
    CUTS.map((cut, index) =>
      queued({
        id: `cut-${index + 1}`,
        externalId: `dorada-${index + 1}`,
        name: `Dorada ${cut}`,
        brand: null,
        ean: DORADA,
        itemId: null,
      })
    );
  const products = () =>
    CUTS.map((_cut, index) => milk(`item-cut-${index + 1}`, []));

  it('the one row route accepts each of five cuts onto its own product, refuses none and teaches nothing', async () => {
    const catalog = fakeCatalog(products());
    const rows = cuts();

    for (const [index, row] of rows.entries()) {
      const { service, saved } = oneRowRoute(catalog, row, rows);
      const result = await service.accept({
        userId: ADMIN,
        entryId: row.id,
        itemId: `item-cut-${index + 1}`,
      });
      expect(result.entry.status).toBe(SourceEntryStatus.ACTIVE);
      expect(result.entry.matchedBy).toBe(ItemSourceMatch.MANUAL);
      expect(result.entry.itemId).toBe(`item-cut-${index + 1}`);
      expect(result.pricesWritten).toBe(1);
      expect(saved).toHaveLength(1);
    }

    // Catalog was never asked who holds the barcode, and no product got it.
    expect(catalog.findItemByEan).not.toHaveBeenCalled();
    expect(catalog.teachItemEans).not.toHaveBeenCalled();
    expect(catalog.products.map((product) => product.eans)).toEqual([
      [],
      [],
      [],
      [],
      [],
    ]);
    expect(catalog.addPrices).toHaveBeenCalledTimes(5);
  });

  it('the one row route is not refused for a shared EAN that another product already holds', async () => {
    // What a database taught before this rule looks like: one product holds
    // the shared barcode. The next cut still lands on its own product.
    const catalog = fakeCatalog([
      milk('item-cut-1', [DORADA]),
      milk('item-cut-2', []),
    ]);
    const rows = cuts();
    const { service } = oneRowRoute(catalog, rows[1], rows);

    const result = await service.accept({
      userId: ADMIN,
      entryId: 'cut-2',
      itemId: 'item-cut-2',
    });

    expect(result.entry.itemId).toBe('item-cut-2');
    expect(catalog.teachItemEans).not.toHaveBeenCalled();
    expect(catalog.products[1].eans).toEqual([]);
  });

  it('the bulk route lands five sibling accepts of one file, each onto its own product, and teaches nothing', async () => {
    const catalog = fakeCatalog(products());
    const rows = cuts();
    const { service, saved, write } = bulkRoute(catalog, rows);

    const result = await service.applyDecisions({
      userId: ADMIN,
      operations: rows.map((row, index) =>
        accept(row.id, `item-cut-${index + 1}`)
      ),
    });

    expect(result.applied).toBe(true);
    expect(result.failedStep).toBeNull();
    expect(result.priceSkips).toEqual([]);
    expect(result.results.map((outcome) => outcome.itemId)).toEqual([
      'item-cut-1',
      'item-cut-2',
      'item-cut-3',
      'item-cut-4',
      'item-cut-5',
    ]);
    expect(saved.map((row) => row.matchedBy)).toEqual(
      CUTS.map(() => ItemSourceMatch.MANUAL)
    );
    expect(write).toHaveBeenCalledTimes(5);
    expect(catalog.findItemsByEans).not.toHaveBeenCalled();
    expect(catalog.teachItemEans).not.toHaveBeenCalled();
    expect(catalog.products.every((product) => product.eans.length === 0)).toBe(
      true
    );
  });

  it('the bulk route counts the chain, not the file: one cut in the file is still shared', async () => {
    // The other four cuts are in the queue and not in this file, and one
    // product already holds the barcode.
    const catalog = fakeCatalog([
      milk('item-cut-1', [DORADA]),
      milk('item-cut-2', []),
    ]);
    const rows = cuts();
    const { service } = bulkRoute(catalog, [rows[1]], rows);

    const result = await service.applyDecisions({
      userId: ADMIN,
      operations: [accept('cut-2', 'item-cut-2')],
    });

    expect(result.applied).toBe(true);
    expect(catalog.teachItemEans).not.toHaveBeenCalled();
  });

  it('a row of another chain with the same EAN is not shared: it still teaches, and is still refused', async () => {
    // The count is per chain. Another chain prints the barcode once, so there
    // it names one product.
    const rows = cuts();
    // A fresh row each time: an accept binds the object it is handed.
    const other = () =>
      queued({
        id: 'other-1',
        externalId: 'x-1',
        supermarketId: OTHER_CHAIN,
        ean: DORADA,
      });
    const all = [...rows, other()];

    const free = fakeCatalog([milk('item-fish', [])]);
    await oneRowRoute(free, other(), all).service.accept({
      userId: ADMIN,
      entryId: 'other-1',
      itemId: 'item-fish',
    });
    expect(free.teachItemEans).toHaveBeenCalledWith([
      { itemId: 'item-fish', ean: DORADA },
    ]);

    const held = fakeCatalog([
      milk('item-fish', []),
      milk('item-holder', [DORADA]),
    ]);
    await expect(
      oneRowRoute(held, other(), all).service.accept({
        userId: ADMIN,
        entryId: 'other-1',
        itemId: 'item-fish',
      })
    ).rejects.toBeInstanceOf(ItemEanHeldException);

    const bulk = await bulkRoute(held, [other()], all).service.applyDecisions({
      userId: ADMIN,
      operations: [accept('other-1', 'item-fish')],
    });
    expect(bulk.applied).toBe(false);
    expect(bulk.results[0].error?.code).toBe(BulkOperationErrorCode.EAN_HELD);
  });
});
