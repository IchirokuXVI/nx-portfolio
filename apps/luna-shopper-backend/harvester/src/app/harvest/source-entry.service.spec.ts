import type { ConfigService } from '@nestjs/config';
import { splitCardName } from '@portfolio/luna-shopper/carrefour';
import {
  ItemSourceMatch,
  PriceSourceKind,
  SourceEntryStatus,
  UnitOfMeasure,
  type CreateItemInput,
  type ItemView,
  type SettleItemAtChainResult,
} from '@portfolio/luna-shopper/contracts';
import {
  CATEGORY_UNKNOWN_DETAIL,
  CategoryNotFoundException,
  ForbiddenException,
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
import { fakeCategoryTree } from './category-tree.fake';
import type { PlatformAdminService } from './platform-admin.service';
import { SourceEntryAvailabilityWriter } from './source-entry-availability';
import type { SourceEntrySettler } from './source-entry-settle';
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
    /** The product catalog says holds the barcode it is asked about. */
    eanHolder?: ItemView | null;
    /** How many rows of the row's chain print its EAN. One when absent. */
    chainRowsWithEan?: number;
    /** What catalog answers when it cannot write the barcode it is taught. */
    teachRefusal?: {
      reason: 'HELD' | 'INVALID' | 'NOT_FOUND';
      heldBy: string | null;
    };
    /**
     * The other rows the table holds (plan 0191). With it, `find` filters as
     * the two queries of a move do. Without it, `find` answers the row.
     */
    others?: SourceCatalogEntry[];
    /** Fail the settle of the product a row left (plan 0191). */
    failSettle?: Error;
  } = {}
) {
  const row = options.row ?? entry();
  const saved: SourceCatalogEntry[] = [];
  /** Every write a decision makes, in order, by the name of what it called. */
  const calls: string[] = [];

  const entries = {
    findOne: jest.fn(async () => row),
    save: jest.fn(async (input: SourceCatalogEntry) => {
      saved.push({ ...input } as SourceCatalogEntry);
      calls.push('save');
      return input;
    }),
    find: jest.fn(
      async (query?: {
        where?: Partial<Record<keyof SourceCatalogEntry, unknown>>;
      }) => {
        if (!options.others) {
          return [row];
        }
        // The rows another query would answer: every clause it names holds.
        const where = query?.where ?? {};
        return options.others.filter((other) =>
          Object.entries(where).every(([key, wanted]) => {
            const held = other[key as keyof SourceCatalogEntry];
            const operator = wanted as FindOperator<unknown>;
            if (operator?.type === 'not') {
              return held !== operator.value;
            }
            if (operator?.type === 'in') {
              return (operator.value as unknown[]).includes(held);
            }
            return held === wanted;
          })
        );
      }
    ),
    delete: jest.fn(async () => ({ affected: 1 })),
    createQueryBuilder: jest.fn(),
    // How many rows of the chain print each EAN (plan 0185). One, unless a
    // test says the chain prints the row's barcode on other rows too.
    query: jest.fn(async (_sql: string, [eans]: [string[]]) =>
      eans.map((ean) => ({
        supermarketId: row.supermarketId,
        ean,
        count: options.chainRowsWithEan ?? 1,
      }))
    ),
  } as unknown as Repository<SourceCatalogEntry>;

  const prices = {
    delete: jest.fn(async () => ({ affected: 2 })),
  } as unknown as Repository<SourceEntryPrice>;

  const runs = {
    findOne: jest.fn(async () => null),
  } as unknown as Repository<HarvestRun>;

  const addPrices = jest.fn(async () => {
    calls.push('addPrices');
    return { inserted: 1, confirmed: 0 };
  });
  const createItem = jest.fn(
    async (input: CreateItemInput): Promise<ItemView> =>
      // Catalog answers the product as it stored it, barcode included.
      ({ ...item(), ean: input.ean ?? null }) as ItemView
  );
  // Plan 0191: the barcode a moving row takes off the product it leaves.
  const removeItemEan = jest.fn(async (itemId: string, _ean: string) => {
    calls.push('removeItemEan');
    return item(itemId);
  });
  const findItemByEan = jest.fn(async (_ean: string) => ({
    item: options.eanHolder ?? null,
  }));
  // Plan 0185: the barcode a bound row gives its product. It answers what
  // catalog would for a barcode nobody holds, unless a test says otherwise.
  const teachItemEans = jest.fn(
    async (entries: { itemId: string; ean: string }[]) => {
      calls.push('teachItemEans');
      return options.teachRefusal
        ? {
            added: 0,
            refused: entries.map((pair) => ({
              ...pair,
              ...(options.teachRefusal as {
                reason: 'HELD' | 'INVALID' | 'NOT_FOUND';
                heldBy: string | null;
              }),
            })),
          }
        : { added: entries.length, refused: [] };
    }
  );
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
    findItemByEan,
    teachItemEans,
    removeItemEan,
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

  // What a row that leaves a product takes with it (plan 0191). What the
  // settle does is its own spec. What matters here is when a decision calls
  // it, for which product, and what its failure does to the answer.
  const settle = jest.fn(
    async (
      itemId: string,
      supermarketId: string,
      settleOptions: { dryRun?: boolean } = {}
    ): Promise<SettleItemAtChainResult> => {
      calls.push('settle');
      if (options.failSettle) {
        throw options.failSettle;
      }
      return settled(itemId, supermarketId, settleOptions.dryRun === true);
    }
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
    availability,
    { settle } as unknown as SourceEntrySettler
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
    findItemByEan,
    teachItemEans,
    categoryTree,
    fetchEnglish,
    setAvailability,
    setLocationAvailability,
    readClaims,
    removeItemEan,
    settle,
    calls,
    catalog,
  };
}

/** What the settle double answers: nothing to do, for that product and chain. */
function settled(
  itemId: string,
  supermarketId: string,
  dryRun = false
): SettleItemAtChainResult {
  return {
    itemId,
    supermarketId,
    dryRun,
    boundEntryIds: [],
    pricesWithdrawn: 1,
    pricesWithdrawnAt: [],
    pricesRestated: 0,
    pricesWithheld: [],
    offersRemoved: [],
    offersKept: [],
    shopRowsRemoved: 0,
    shopRowsCleared: 0,
    shopRowConflicts: [],
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

    /**
     * Every decision is `MANUAL` (plan 0184, Target state 7, which was not
     * built). `unbindSharedEans` reopens an `ACTIVE` row stamped `EAN` when
     * a second row of the chain prints the same barcode, and it skips
     * `MANUAL` rows, so the stamp is what keeps a run from undoing a
     * person's decision.
     */
    describe('what the bound row says matched it (plan 0184)', () => {
      const EAN = '8480000123459';

      it('stamps MANUAL, also when the product holds the row’s own real barcode', async () => {
        const { service, teachItemEans } = build({
          row: entry({ ean: EAN }),
          eanHolder: { ...item('item-1'), ean: EAN } as ItemView,
        });

        const result = await service.accept({
          userId: ADMIN,
          entryId: 'e-1',
          itemId: 'item-1',
        });

        expect(result.entry.matchedBy).toBe(ItemSourceMatch.MANUAL);
        expect(result.entry.confidence).toBe(1);
        expect(result.entry.status).toBe(SourceEntryStatus.ACTIVE);
        // The stamp does not depend on who holds the barcode. An accept
        // does ask catalog who holds it since plan 0185, and the product
        // that already holds it is taught nothing.
        expect(teachItemEans).not.toHaveBeenCalled();
      });

      it.each([
        ['no barcode', null],
        ['an in-store code', '2204500000000'],
        ['an invalid code', '84100100012'],
      ])('stamps MANUAL for a row with %s', async (_what, ean) => {
        const { service } = build({ row: entry({ ean }) });

        const result = await service.accept({
          userId: ADMIN,
          entryId: 'e-1',
          itemId: 'item-1',
        });

        expect(result.entry.matchedBy).toBe(ItemSourceMatch.MANUAL);
      });
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
        // Create only: a row catalog already holds keeps the flag it derived
        // from the shops.
        expect(setAvailability).toHaveBeenCalledWith(
          NATIONAL,
          [{ itemId: 'item-1', available: true }],
          { onlyIfMissing: true }
        );
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

        expect(setAvailability).toHaveBeenCalledWith(
          NATIONAL,
          [{ itemId: result.createdItem?.id, available: true }],
          { onlyIfMissing: true }
        );
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
      const { service } = build({
        row: entry({ ean: '8480000123459' }),
        eanHolder: item('item-held'),
      });

      await expect(
        service.createItem({ userId: ADMIN, entryId: 'e-1' })
      ).rejects.toThrow(/item-held/);
    });

    /**
     * Plan 0184: a product holds a real barcode or none, and the row keeps
     * what the chain printed.
     */
    describe('the EAN (plan 0184)', () => {
      it('creates a product with a null EAN from a row whose EAN starts with 2, and the row keeps its code', async () => {
        const { service, createItem, findItemByEan, saved } = build({
          row: entry({ ean: '2204500000000' }),
        });

        const result = await service.createItem({
          userId: ADMIN,
          entryId: 'e-1',
        });

        expect(createItem).toHaveBeenCalledWith(
          expect.objectContaining({ ean: null })
        );
        expect(saved[0].ean).toBe('2204500000000');
        expect(result.entry.ean).toBe('2204500000000');
        // Nothing is asked about a code no product will hold.
        expect(findItemByEan).not.toHaveBeenCalled();
        expect(result.entry.matchedBy).toBe(ItemSourceMatch.MANUAL);
      });

      it.each([
        ['an 11 digit code', '84100100012'],
        ['a wrong check digit', '8480000123456'],
      ])('creates a product with a null EAN from %s', async (_what, ean) => {
        const { service, createItem, saved } = build({ row: entry({ ean }) });

        await service.createItem({ userId: ADMIN, entryId: 'e-1' });

        expect(createItem).toHaveBeenCalledWith(
          expect.objectContaining({ ean: null })
        );
        expect(saved[0].ean).toBe(ean);
      });

      it('drops an in-store code the operator typed, too', async () => {
        const { service, createItem } = build();

        await service.createItem({
          userId: ADMIN,
          entryId: 'e-1',
          ean: '2000000000008',
        });

        expect(createItem).toHaveBeenCalledWith(
          expect.objectContaining({ ean: null })
        );
      });

      it('writes a real barcode, and the row still says MANUAL', async () => {
        const { service, createItem } = build({
          row: entry({ ean: '8480000123459' }),
        });

        const result = await service.createItem({
          userId: ADMIN,
          entryId: 'e-1',
        });

        expect(createItem).toHaveBeenCalledWith(
          expect.objectContaining({ ean: '8480000123459' })
        );
        expect(result.entry.matchedBy).toBe(ItemSourceMatch.MANUAL);
      });
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

/**
 * A row that leaves a product takes its offers with it (plan 0191).
 *
 * A bound row can be decided again on these three routes. Before the plan the
 * new product got the prices and the old one kept everything, because nothing
 * read the old `itemId` before overwriting it.
 */
describe('SourceEntryService, a bound row that is decided again (plan 0191)', () => {
  const REAL_EAN = '8402001047251';
  /** A row a person accepted onto `item-old`. */
  const bound = (overrides: Partial<SourceCatalogEntry> = {}) =>
    entry({
      status: SourceEntryStatus.ACTIVE,
      matchedBy: ItemSourceMatch.MANUAL,
      confidence: 1,
      itemId: 'item-old',
      decidedAt: NOW,
      ...overrides,
    });

  describe('accept onto another product', () => {
    it('settles the product the row left, at the row’s chain, after the prices', async () => {
      const { service, settle, calls } = build({ row: bound() });

      const result = await service.accept({
        userId: ADMIN,
        entryId: 'e-1',
        itemId: 'item-new',
      });

      expect(settle).toHaveBeenCalledTimes(1);
      expect(settle).toHaveBeenCalledWith('item-old', CHAIN);
      // The row is bound to the new product and its prices are written
      // before the old product is settled: the settle reads the rows bound
      // to the old product now, and this row must no longer be one of them.
      expect(calls.indexOf('save')).toBeLessThan(calls.indexOf('settle'));
      expect(calls.indexOf('addPrices')).toBeLessThan(calls.indexOf('settle'));
      expect(result.entry.itemId).toBe('item-new');
      expect(result.settled).toEqual(settled('item-old', CHAIN));
    });

    it('settles nothing when the row is accepted onto the product it is bound to', async () => {
      const { service, settle } = build({ row: bound() });

      const result = await service.accept({
        userId: ADMIN,
        entryId: 'e-1',
        itemId: 'item-old',
      });

      expect(settle).not.toHaveBeenCalled();
      expect(result.settled).toBeNull();
    });

    it('settles nothing for a row that only proposed a product', async () => {
      // A CANDIDATE carries a product as a proposal. It wrote nothing on it.
      const { service, settle } = build({
        row: entry({
          status: SourceEntryStatus.CANDIDATE,
          itemId: 'item-proposed',
        }),
      });

      const result = await service.accept({
        userId: ADMIN,
        entryId: 'e-1',
        itemId: 'item-new',
      });

      expect(settle).not.toHaveBeenCalled();
      expect(result.settled).toBeNull();
    });

    it('leaves the decision standing when the settle fails, and answers with its error', async () => {
      const { service, saved } = build({
        row: bound(),
        failSettle: new Error('catalog is away'),
      });

      await expect(
        service.accept({ userId: ADMIN, entryId: 'e-1', itemId: 'item-new' })
      ).rejects.toThrow('catalog is away');

      expect(saved).toHaveLength(1);
      expect(saved[0]).toMatchObject({
        status: SourceEntryStatus.ACTIVE,
        itemId: 'item-new',
      });
    });
  });

  describe('createItem from a bound row', () => {
    it('settles the product the row left', async () => {
      const { service, settle } = build({ row: bound() });

      const result = await service.createItem({
        userId: ADMIN,
        entryId: 'e-1',
      });

      expect(settle).toHaveBeenCalledWith('item-old', CHAIN);
      expect(result.createdItem).not.toBeNull();
      expect(result.settled).toEqual(settled('item-old', CHAIN));
    });
  });

  describe('reject', () => {
    it('settles the product a bound row was on, after the row is saved', async () => {
      const { service, settle, saved, calls } = build({ row: bound() });

      const view = await service.reject({ userId: ADMIN, entryId: 'e-1' });

      expect(view.status).toBe(SourceEntryStatus.REJECTED);
      expect(view.itemId).toBeNull();
      expect(saved[0]).toMatchObject({
        status: SourceEntryStatus.REJECTED,
        itemId: null,
      });
      expect(settle).toHaveBeenCalledWith('item-old', CHAIN);
      expect(calls).toEqual(['save', 'settle']);
    });

    it('settles nothing for a row that was waiting', async () => {
      const { service, settle } = build();

      await service.reject({ userId: ADMIN, entryId: 'e-1' });

      expect(settle).not.toHaveBeenCalled();
    });

    it('leaves the row rejected when the settle fails, and answers with its error', async () => {
      const { service, saved } = build({
        row: bound(),
        failSettle: new Error('catalog is away'),
      });

      await expect(
        service.reject({ userId: ADMIN, entryId: 'e-1' })
      ).rejects.toThrow('catalog is away');

      expect(saved[0].status).toBe(SourceEntryStatus.REJECTED);
    });
  });

  describe('the barcode moves with the row', () => {
    it('takes it off the old product and teaches it to the new one, with no manual clear', async () => {
      // The Fanta bottle of the A5 proposal: three calls before the plan.
      const row = bound({ ean: REAL_EAN });
      const { service, removeItemEan, teachItemEans, calls } = build({
        row,
        others: [row],
        eanHolder: item('item-old'),
      });

      await service.accept({
        userId: ADMIN,
        entryId: 'e-1',
        itemId: 'item-new',
      });

      expect(removeItemEan).toHaveBeenCalledWith('item-old', REAL_EAN);
      expect(teachItemEans).toHaveBeenCalledWith([
        { itemId: 'item-new', ean: REAL_EAN },
      ]);
      // Off the old product first: catalog holds a barcode on one product.
      expect(calls.indexOf('removeItemEan')).toBeLessThan(
        calls.indexOf('teachItemEans')
      );
    });

    it('refuses the move when another row bound to the old product prints the barcode, and writes nothing', async () => {
      const row = bound({ ean: REAL_EAN });
      const sibling = bound({
        id: 'e-2',
        supermarketId: 'chain-other',
        ean: REAL_EAN,
      });
      const { service, saved, removeItemEan, settle } = build({
        row,
        others: [row, sibling],
        eanHolder: item('item-old'),
      });

      const refusal = await service
        .accept({ userId: ADMIN, entryId: 'e-1', itemId: 'item-new' })
        .catch((error: unknown) => error);

      expect(refusal).toBeInstanceOf(ItemEanHeldException);
      // `item_ean_held` stands, and its sentence names the old product and
      // the row that keeps the barcode there.
      expect((refusal as Error).message).toMatch(/item-old/);
      expect((refusal as Error).message).toMatch(/e-2/);
      expect(
        (refusal as ItemEanHeldException).details?.[ITEM_EAN_HOLDER_DETAIL]
      ).toBe('item-old');
      expect(saved).toHaveLength(0);
      expect(removeItemEan).not.toHaveBeenCalled();
      expect(settle).not.toHaveBeenCalled();
    });

    it('still refuses a barcode a third product holds', async () => {
      const row = bound({ ean: REAL_EAN });
      const { service, saved, removeItemEan } = build({
        row,
        others: [row],
        eanHolder: item('item-third'),
      });

      await expect(
        service.accept({ userId: ADMIN, entryId: 'e-1', itemId: 'item-new' })
      ).rejects.toBeInstanceOf(ItemEanHeldException);

      expect(saved).toHaveLength(0);
      expect(removeItemEan).not.toHaveBeenCalled();
    });

    it('creates the product with no barcode and moves the barcode to it after the bind', async () => {
      const row = bound({ ean: REAL_EAN });
      const { service, createItem, removeItemEan, teachItemEans, calls } =
        build({
          row,
          others: [row],
          eanHolder: item('item-old'),
        });

      const result = await service.createItem({
        userId: ADMIN,
        entryId: 'e-1',
      });

      // The old product still holds the barcode while the new one is made.
      expect(createItem).toHaveBeenCalledWith(
        expect.objectContaining({ ean: null })
      );
      expect(removeItemEan).toHaveBeenCalledWith('item-old', REAL_EAN);
      expect(teachItemEans).toHaveBeenCalledWith([
        { itemId: result.createdItem?.id, ean: REAL_EAN },
      ]);
      expect(calls.indexOf('save')).toBeLessThan(
        calls.indexOf('removeItemEan')
      );
    });

    it('leaves the barcode on the product when the row is rejected', async () => {
      const row = bound({ ean: REAL_EAN });
      const { service, removeItemEan } = build({
        row,
        others: [row],
        eanHolder: item('item-old'),
      });

      await service.reject({ userId: ADMIN, entryId: 'e-1' });

      expect(removeItemEan).not.toHaveBeenCalled();
    });
  });

  describe('a second article of the chain on the product', () => {
    it('binds the row, writes no price for the shared scope, and names the other row', async () => {
      // The El Pozo burger: 2.45 already bound, 2.95 accepted beside it.
      const small = bound({
        id: 'e-small',
        itemId: 'item-1',
        prices: [price({ entryId: 'e-small', price: 2.45, unitPrice: null })],
      });
      const king = entry({
        id: 'e-king',
        prices: [price({ entryId: 'e-king', price: 2.95, unitPrice: null })],
      });
      const { service, addPrices, saved } = build({
        row: king,
        others: [small],
      });

      const result = await service.accept({
        userId: ADMIN,
        entryId: 'e-king',
        itemId: 'item-1',
      });

      expect(saved[0]).toMatchObject({
        status: SourceEntryStatus.ACTIVE,
        itemId: 'item-1',
      });
      expect(addPrices).not.toHaveBeenCalled();
      expect(result.pricesWritten).toBe(0);
      expect(result.pricesWithheld).toEqual([
        {
          entryId: 'e-king',
          priceScopeId: NATIONAL,
          otherEntryIds: ['e-small'],
        },
      ]);
    });

    it('withholds nothing for the one row of its product', async () => {
      const { service } = build({ others: [] });

      const result = await service.accept({
        userId: ADMIN,
        entryId: 'e-1',
        itemId: 'item-1',
      });

      expect(result.pricesWritten).toBe(1);
      expect(result.pricesWithheld).toEqual([]);
    });
  });

  describe('settleItem, the route for a person', () => {
    it('is gated, checks the chain, and settles the product at it', async () => {
      const { service, settle, catalog } = build();

      await expect(
        service.settleItem({
          userId: 'somebody-else',
          itemId: 'item-old',
          supermarketId: CHAIN,
        })
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(settle).not.toHaveBeenCalled();

      const result = await service.settleItem({
        userId: ADMIN,
        itemId: 'item-old',
        supermarketId: CHAIN,
      });

      expect(catalog.getSupermarket).toHaveBeenCalledWith(CHAIN);
      expect(settle).toHaveBeenCalledWith('item-old', CHAIN, { dryRun: false });
      expect(result).toEqual(settled('item-old', CHAIN));
    });

    it('passes a dry run on', async () => {
      const { service, settle } = build();

      const result = await service.settleItem({
        userId: ADMIN,
        itemId: 'item-old',
        supermarketId: CHAIN,
        dryRun: true,
      });

      expect(settle).toHaveBeenCalledWith('item-old', CHAIN, { dryRun: true });
      expect(result.dryRun).toBe(true);
    });
  });
});
