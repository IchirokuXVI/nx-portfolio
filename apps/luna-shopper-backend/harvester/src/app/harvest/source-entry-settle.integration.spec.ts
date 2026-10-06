import { ConfigService } from '@nestjs/config';
import {
  PriceSourceKind,
  SourceEntryStatus,
  type ItemView,
  type StatedItemPrice,
} from '@portfolio/luna-shopper/contracts';
import { ItemEanHeldException } from '@portfolio/luna-shopper/platform';
import {
  describeIntegration,
  requiredEnv,
} from '@portfolio/luna-shopper/test-fixtures/jest';
import { DataSource, type Repository } from 'typeorm';
import {
  HARVESTER_ENTITIES,
  HarvestRun,
  SourceCatalogEntry,
  SourceEntryAvailability,
  SourceEntryPrice,
} from '../entities';
import type { CatalogClient } from './catalog-client.service';
import type { PlatformAdminService } from './platform-admin.service';
import { SourceEntryAvailabilityWriter } from './source-entry-availability';
import { SourceEntrySettler } from './source-entry-settle';
import { SourceEntryPriceWriter } from './source-entry-write';
import { SourceEntryService } from './source-entry.service';
import type { SupermarketSourceService } from './supermarket-source.service';

/**
 * A row that leaves a product, against real Postgres (plan 0191).
 *
 * Everything the harvester decides here is a `where`: which rows are bound to
 * the product now, which other row prices the same scope, which other row
 * prints the same barcode. A fake repository answers whatever it is handed,
 * so it proves none of them. This runs the real services over the real table
 * and reads what they asked catalog for.
 *
 * Catalog is a recorder here. What it does with the two withdraw messages is
 * proved against its own database, in catalog's
 * `item-withdraw.integration.spec.ts`. The two halves over one stack are a
 * scripted run on an ephemeral slot, named in the plan's pull request.
 *
 *   LUNA_INTEGRATION=1 HARVESTER_DB_URL=postgres://... \
 *     npx nx run luna-shopper-backend-harvester:test-integration \
 *       --testFile=source-entry-settle.integration.spec.ts
 */
const ADMIN = 'owner-1';

/** Two chains nothing else in this database uses, so cleanup is exact. */
const ELJAMON = 'b1910000-0000-4000-a000-000000000001';
const OTHER_CHAIN = 'b1910000-0000-4000-a000-000000000002';

/** The product a row is wrongly bound to, and the one it belongs on. */
const WRONG = 'c1910000-0000-4000-a000-000000000001';
const RIGHT = 'c1910000-0000-4000-a000-000000000002';

/** The chain's default scope, and three scopes that fall through to it. */
const DEFAULT = 'd1910000-0000-4000-a000-000000000001';
const NORTH = 'd1910000-0000-4000-a000-000000000002';
const CENTRE = 'd1910000-0000-4000-a000-000000000003';
const SOUTH = 'd1910000-0000-4000-a000-000000000004';
const SCOPES = [DEFAULT, NORTH, CENTRE, SOUTH];

const RUN = 'e1910000-0000-4000-a000-000000000001';
const OBSERVED = '2026-10-05T06:00:00.000Z';
const BARCODE = '8402001047251';

const KINDS = [
  PriceSourceKind.OFFICIAL_API,
  PriceSourceKind.OFFICIAL_WEB,
  PriceSourceKind.OFFICIAL_LEAFLET,
];

describeIntegration('a row that leaves a product (real Postgres)', () => {
  let dataSource: DataSource;
  let entries: Repository<SourceCatalogEntry>;
  let service: SourceEntryService;
  let settler: SourceEntrySettler;

  /** What catalog was asked, in order. */
  let asked: {
    priceWrites: { priceScopeId: string; itemId: string; price: number }[];
    priceWithdraws: {
      itemId: string;
      priceScopeIds: string[];
      sourceKinds: PriceSourceKind[];
      stated: StatedItemPrice[];
      dryRun: boolean;
    }[];
    offerWithdraws: {
      itemId: string;
      supermarketId: string;
      priceScopeIds: string[];
      dryRun: unknown;
    }[];
    eanRemovals: { itemId: string; ean: string }[];
    eanTeaches: { itemId: string; ean: string }[];
    order: string[];
  };
  /** The product catalog says holds each barcode. */
  let eanHolders: Map<string, string>;

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: requiredEnv('HARVESTER_DB_URL'),
      entities: HARVESTER_ENTITIES,
      synchronize: false,
    });
    await dataSource.initialize();
    entries = dataSource.getRepository(SourceCatalogEntry);

    const catalog = {
      listAllPriceScopes: async () => SCOPES.map((id) => ({ id })),
      getSupermarket: async (id: string) => ({
        id,
        defaultPriceScopeId: DEFAULT,
      }),
      addPrices: async (
        priceScopeId: string,
        sent: { itemId: string; price: number }[]
      ) => {
        asked.order.push('addPrices');
        asked.priceWrites.push({
          priceScopeId,
          itemId: sent[0].itemId,
          price: sent[0].price,
        });
        return { inserted: 1, confirmed: 0 };
      },
      withdrawPrices: async (
        itemId: string,
        priceScopeIds: string[],
        sourceKinds: PriceSourceKind[],
        stated: StatedItemPrice[],
        dryRun = false
      ) => {
        asked.order.push('withdrawPrices');
        asked.priceWithdraws.push({
          itemId,
          priceScopeIds,
          sourceKinds,
          stated,
          dryRun,
        });
        return { deleted: 0, removed: [], recomputed: 0 };
      },
      withdrawOffers: async (
        itemId: string,
        supermarketId: string,
        priceScopeIds: string[],
        dryRun: unknown = null
      ) => {
        asked.order.push('withdrawOffers');
        asked.offerWithdraws.push({
          itemId,
          supermarketId,
          priceScopeIds,
          dryRun,
        });
        return {
          offersRemoved: [],
          offersKept: [],
          shopRowsRemoved: 0,
          shopRowsCleared: 0,
          conflicts: [],
        };
      },
      setAvailability: async () => ({ updated: 0 }),
      setLocationAvailability: async () => ({
        written: 0,
        skipped: 0,
        conflicts: [],
      }),
      findItemByEan: async (ean: string) => ({
        item: eanHolders.has(ean)
          ? ({ id: eanHolders.get(ean) } as ItemView)
          : null,
      }),
      removeItemEan: async (itemId: string, ean: string) => {
        asked.order.push('removeItemEan');
        asked.eanRemovals.push({ itemId, ean });
        eanHolders.delete(ean);
        return { id: itemId } as ItemView;
      },
      teachItemEans: async (pairs: { itemId: string; ean: string }[]) => {
        asked.order.push('teachItemEans');
        asked.eanTeaches.push(...pairs);
        return { added: pairs.length, refused: [] };
      },
    } as unknown as CatalogClient;

    const writer = new SourceEntryPriceWriter(catalog, entries);
    settler = new SourceEntrySettler(entries, catalog, writer);
    service = new SourceEntryService(
      entries,
      dataSource.getRepository(SourceEntryPrice),
      dataSource.getRepository(HarvestRun),
      catalog,
      // An accept and a reject read no source row of the chain.
      {} as unknown as SupermarketSourceService,
      {
        requireAdmin: async () => ADMIN,
      } as unknown as PlatformAdminService,
      writer,
      {} as unknown as ConfigService,
      new SourceEntryAvailabilityWriter(
        dataSource.getRepository(SourceEntryAvailability),
        catalog
      ),
      settler
    );
  }, 120_000);

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await clean();
      await dataSource.destroy();
    }
  });

  beforeEach(async () => {
    asked = {
      priceWrites: [],
      priceWithdraws: [],
      offerWithdraws: [],
      eanRemovals: [],
      eanTeaches: [],
      order: [],
    };
    eanHolders = new Map();
    await clean();
  });

  function clean() {
    // The price rows go with their entries: the foreign key cascades.
    return dataSource.query(
      `DELETE FROM "source_catalog_entries" WHERE "supermarketId" = ANY($1::uuid[])`,
      [[ELJAMON, OTHER_CHAIN]]
    );
  }

  let seq = 0;

  /** One row of a chain, with one price per scope it names. */
  async function row(
    over: {
      supermarketId?: string;
      itemId?: string | null;
      status?: SourceEntryStatus;
      sourceKind?: PriceSourceKind;
      ean?: string | null;
      soldByWeight?: boolean;
      decidedAt?: string;
    } = {},
    prices: Record<string, number> = { [DEFAULT]: 4.99 },
    priceOver: { validUntil?: string } = {}
  ): Promise<string> {
    seq += 1;
    const status = over.status ?? SourceEntryStatus.ACTIVE;
    const [inserted] = await dataSource.query(
      `INSERT INTO "source_catalog_entries"
              ("supermarketId", "externalId", "sourceKind", "name", "ean",
               "itemId", "status", "soldByWeight", "matchedBy", "decidedAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING "id"`,
      [
        over.supermarketId ?? ELJAMON,
        `plan0191-${seq}`,
        over.sourceKind ?? PriceSourceKind.OFFICIAL_WEB,
        `Artículo ${seq}`,
        over.ean ?? null,
        over.itemId === undefined ? WRONG : over.itemId,
        status,
        over.soldByWeight ?? false,
        status === SourceEntryStatus.ACTIVE ? 'MANUAL' : null,
        status === SourceEntryStatus.ACTIVE
          ? (over.decidedAt ??
            `2026-10-01T00:00:${String(seq).padStart(2, '0')}.000Z`)
          : null,
      ]
    );
    for (const [priceScopeId, price] of Object.entries(prices)) {
      await dataSource.query(
        `INSERT INTO "source_entry_prices"
                ("entryId", "priceScopeId", "price", "observedAt", "runId",
                 "validUntil")
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          inserted.id,
          priceScopeId,
          price,
          OBSERVED,
          RUN,
          priceOver.validUntil ?? null,
        ]
      );
    }
    return inserted.id as string;
  }

  const stored = (id: string) => entries.findOneOrFail({ where: { id } });

  describe('a bound row moved to another product', () => {
    it('gives the new product its price and asks catalog to take everything back from the old one', async () => {
      // The figurine: one row, wrongly bound, priced at the default scope.
      const figurine = await row();

      const result = await service.accept({
        userId: ADMIN,
        entryId: figurine,
        itemId: RIGHT,
      });

      expect(await stored(figurine)).toMatchObject({
        status: SourceEntryStatus.ACTIVE,
        itemId: RIGHT,
      });
      // The right product gets the price.
      expect(asked.priceWrites).toEqual([
        { priceScopeId: DEFAULT, itemId: RIGHT, price: 4.99 },
      ]);
      // No row of the chain names the wrong product now, so nothing is
      // stated for it: every run written price row goes, at every scope and
      // kind, and then its offers are asked about.
      expect(asked.priceWithdraws).toEqual([
        {
          itemId: WRONG,
          priceScopeIds: SCOPES,
          sourceKinds: KINDS,
          stated: [],
          dryRun: false,
        },
      ]);
      expect(asked.offerWithdraws).toEqual([
        {
          itemId: WRONG,
          supermarketId: ELJAMON,
          priceScopeIds: SCOPES,
          dryRun: null,
        },
      ]);
      // The new product is written before the old one is settled.
      expect(asked.order).toEqual([
        'addPrices',
        'withdrawPrices',
        'withdrawOffers',
      ]);
      expect(result.settled).toMatchObject({
        itemId: WRONG,
        supermarketId: ELJAMON,
        boundEntryIds: [],
      });
    }, 60_000);

    it('keeps what a second row of the chain still states for the old product, and its offers', async () => {
      const moving = await row({}, { [DEFAULT]: 2.95 });
      const staying = await row({}, { [DEFAULT]: 2.45, [NORTH]: 2.6 });

      const result = await service.accept({
        userId: ADMIN,
        entryId: moving,
        itemId: RIGHT,
      });

      // What the staying row states is spared from its own instant back, and
      // nothing else is.
      expect(asked.priceWithdraws).toHaveLength(1);
      expect(asked.priceWithdraws[0].itemId).toBe(WRONG);
      expect(asked.priceWithdraws[0].stated).toEqual([
        {
          priceScopeId: DEFAULT,
          sourceKind: PriceSourceKind.OFFICIAL_WEB,
          observedAt: OBSERVED,
        },
        {
          priceScopeId: NORTH,
          sourceKind: PriceSourceKind.OFFICIAL_WEB,
          observedAt: OBSERVED,
        },
      ]);
      // Its prices are written again on the old product, after the delete,
      // so the current row is the one a bound row states.
      expect(asked.priceWrites).toEqual([
        { priceScopeId: DEFAULT, itemId: RIGHT, price: 2.95 },
        { priceScopeId: DEFAULT, itemId: WRONG, price: 2.45 },
        { priceScopeId: NORTH, itemId: WRONG, price: 2.6 },
      ]);
      expect(asked.order).toEqual([
        'addPrices',
        'withdrawPrices',
        'addPrices',
        'addPrices',
      ]);
      // A chain that lists a product sells it: the offers are not asked about.
      expect(asked.offerWithdraws).toEqual([]);
      expect(result.settled).toMatchObject({
        boundEntryIds: [staying],
        pricesRestated: 2,
        offersRemoved: [],
      });
    }, 60_000);

    it('counts only an ACTIVE row of the same chain as naming the old product', async () => {
      const moving = await row();
      // None of these binds the wrong product at this chain.
      await row({ status: SourceEntryStatus.CANDIDATE });
      await row({ status: SourceEntryStatus.REJECTED });
      await row({ supermarketId: OTHER_CHAIN });
      await row({ itemId: RIGHT });

      const result = await service.accept({
        userId: ADMIN,
        entryId: moving,
        itemId: RIGHT,
      });

      expect(asked.priceWithdraws[0].stated).toEqual([]);
      expect(asked.offerWithdraws).toHaveLength(1);
      expect(result.settled?.boundEntryIds).toEqual([]);
    }, 60_000);

    it('settles nothing for a row accepted onto the product it is already on', async () => {
      const figurine = await row();

      const result = await service.accept({
        userId: ADMIN,
        entryId: figurine,
        itemId: WRONG,
      });

      expect(result.settled).toBeNull();
      expect(asked.priceWithdraws).toEqual([]);
      expect(asked.offerWithdraws).toEqual([]);
    }, 60_000);
  });

  describe('a bound row rejected', () => {
    it('rejects the row and asks catalog to take everything back from its product', async () => {
      const figurine = await row();

      const view = await service.reject({ userId: ADMIN, entryId: figurine });

      expect(view.status).toBe(SourceEntryStatus.REJECTED);
      expect(await stored(figurine)).toMatchObject({
        status: SourceEntryStatus.REJECTED,
        itemId: null,
      });
      expect(asked.priceWrites).toEqual([]);
      expect(asked.priceWithdraws).toEqual([
        {
          itemId: WRONG,
          priceScopeIds: SCOPES,
          sourceKinds: KINDS,
          stated: [],
          dryRun: false,
        },
      ]);
      expect(asked.offerWithdraws.map((each) => each.itemId)).toEqual([WRONG]);
    }, 60_000);

    it('keeps what a second row of the chain still states', async () => {
      const rejected = await row({}, { [DEFAULT]: 2.95 });
      await row({}, { [DEFAULT]: 2.45 });

      await service.reject({ userId: ADMIN, entryId: rejected });

      expect(asked.priceWithdraws[0].stated).toEqual([
        {
          priceScopeId: DEFAULT,
          sourceKind: PriceSourceKind.OFFICIAL_WEB,
          observedAt: OBSERVED,
        },
      ]);
      expect(asked.priceWrites).toEqual([
        { priceScopeId: DEFAULT, itemId: WRONG, price: 2.45 },
      ]);
      expect(asked.offerWithdraws).toEqual([]);
    }, 60_000);

    it('asks catalog for nothing when the row was only waiting', async () => {
      const waiting = await row({
        status: SourceEntryStatus.CANDIDATE,
        itemId: WRONG,
      });

      await service.reject({ userId: ADMIN, entryId: waiting });

      expect(asked.order).toEqual([]);
    }, 60_000);
  });

  describe('two articles of one chain on one product at one scope', () => {
    it('binds the second, writes no price where the two disagree, and names the first', async () => {
      // The El Pozo burger: 2.45 is bound, 2.95 is accepted beside it.
      const small = await row({ itemId: RIGHT }, { [DEFAULT]: 2.45 });
      const king = await row(
        { itemId: null, status: SourceEntryStatus.UNRESOLVED },
        { [DEFAULT]: 2.95, [NORTH]: 3.05 }
      );

      const result = await service.accept({
        userId: ADMIN,
        entryId: king,
        itemId: RIGHT,
      });

      expect(await stored(king)).toMatchObject({
        status: SourceEntryStatus.ACTIVE,
        itemId: RIGHT,
      });
      // The scope only the second article prices is written. The shared one
      // is not: the 2.45 that was current stays.
      expect(asked.priceWrites).toEqual([
        { priceScopeId: NORTH, itemId: RIGHT, price: 3.05 },
      ]);
      expect(result.pricesWritten).toBe(1);
      expect(result.pricesWithheld).toEqual([
        { entryId: king, priceScopeId: DEFAULT, otherEntryIds: [small] },
      ]);

      // The product's own read says which rows share a scope.
      const page = await service.listByItem({ userId: ADMIN, itemId: RIGHT });
      expect(
        Object.fromEntries(
          page.items.map((each) => [each.id, each.scopeSharedWith])
        )
      ).toEqual({ [small]: [king], [king]: [small] });
    }, 60_000);

    it('does not meet a row of another kind, another chain, another product, or one that is not bound', async () => {
      const king = await row(
        { itemId: null, status: SourceEntryStatus.UNRESOLVED },
        { [DEFAULT]: 2.95 }
      );
      await row(
        { itemId: RIGHT, sourceKind: PriceSourceKind.OFFICIAL_LEAFLET },
        { [DEFAULT]: 1.99 }
      );
      await row(
        { itemId: RIGHT, supermarketId: OTHER_CHAIN },
        { [DEFAULT]: 1.99 }
      );
      await row({ itemId: WRONG }, { [DEFAULT]: 1.99 });
      await row(
        { itemId: RIGHT, status: SourceEntryStatus.CANDIDATE },
        { [DEFAULT]: 1.99 }
      );
      // Bound, of this chain and kind, but its window has closed.
      await row(
        { itemId: RIGHT },
        { [DEFAULT]: 1.99 },
        {
          validUntil: '2020-01-01T00:00:00.000Z',
        }
      );

      const result = await service.accept({
        userId: ADMIN,
        entryId: king,
        itemId: RIGHT,
      });

      expect(result.pricesWithheld).toEqual([]);
      expect(asked.priceWrites).toEqual([
        { priceScopeId: DEFAULT, itemId: RIGHT, price: 2.95 },
      ]);
      const page = await service.listByItem({ userId: ADMIN, itemId: RIGHT });
      expect(
        page.items.every((each) => each.scopeSharedWith.length === 0)
      ).toBe(true);
    }, 60_000);

    it('writes the amount two rows agree on, read as money and not as text', async () => {
      await row({ itemId: RIGHT }, { [DEFAULT]: 2.5 });
      const twin = await row(
        { itemId: null, status: SourceEntryStatus.UNRESOLVED },
        { [DEFAULT]: 2.5 }
      );

      const result = await service.accept({
        userId: ADMIN,
        entryId: twin,
        itemId: RIGHT,
      });

      expect(result.pricesWithheld).toEqual([]);
      expect(asked.priceWrites).toEqual([
        { priceScopeId: DEFAULT, itemId: RIGHT, price: 2.5 },
      ]);
    }, 60_000);

    it('spares everything at the scope the two disagree on when their product is settled', async () => {
      const small = await row({ itemId: RIGHT }, { [DEFAULT]: 2.45 });
      const king = await row(
        { itemId: RIGHT },
        { [DEFAULT]: 2.95, [NORTH]: 3.05 }
      );

      const result = await settler.settle(RIGHT, ELJAMON);

      expect(asked.priceWithdraws[0].stated).toEqual([
        {
          priceScopeId: DEFAULT,
          sourceKind: PriceSourceKind.OFFICIAL_WEB,
          observedAt: null,
        },
        {
          priceScopeId: NORTH,
          sourceKind: PriceSourceKind.OFFICIAL_WEB,
          observedAt: OBSERVED,
        },
      ]);
      expect(asked.priceWrites).toEqual([
        { priceScopeId: NORTH, itemId: RIGHT, price: 3.05 },
      ]);
      expect(result.pricesWithheld).toEqual([
        { entryId: small, priceScopeId: DEFAULT, otherEntryIds: [king] },
        { entryId: king, priceScopeId: DEFAULT, otherEntryIds: [small] },
      ]);
    }, 60_000);
  });

  describe('the barcode moves with the row', () => {
    it('takes it off the old product and teaches it to the new one in the one accept', async () => {
      const bottle = await row({ ean: BARCODE });
      // Accepting the row onto the wrong product taught it the barcode.
      eanHolders.set(BARCODE, WRONG);
      // A row that only proposes the old product is no reason to keep it.
      await row({
        supermarketId: OTHER_CHAIN,
        ean: BARCODE,
        status: SourceEntryStatus.CANDIDATE,
      });

      await service.accept({ userId: ADMIN, entryId: bottle, itemId: RIGHT });

      expect(asked.eanRemovals).toEqual([{ itemId: WRONG, ean: BARCODE }]);
      expect(asked.eanTeaches).toEqual([{ itemId: RIGHT, ean: BARCODE }]);
      expect(asked.order.indexOf('removeItemEan')).toBeLessThan(
        asked.order.indexOf('teachItemEans')
      );
      // The old product no longer finds by that barcode.
      expect(eanHolders.has(BARCODE)).toBe(false);
    }, 60_000);

    it('refuses the move while a row of any chain that is bound to the old product prints it, and writes nothing', async () => {
      const bottle = await row({ ean: BARCODE });
      const sibling = await row({ supermarketId: OTHER_CHAIN, ean: BARCODE });
      eanHolders.set(BARCODE, WRONG);

      const refusal = await service
        .accept({ userId: ADMIN, entryId: bottle, itemId: RIGHT })
        .catch((error: unknown) => error);

      expect(refusal).toBeInstanceOf(ItemEanHeldException);
      // `item_ean_held` stands, and its sentence names the old product.
      expect((refusal as Error).message).toContain(WRONG);
      expect((refusal as Error).message).toContain(sibling);
      expect(await stored(bottle)).toMatchObject({ itemId: WRONG });
      expect(asked.order).toEqual([]);
    }, 60_000);
  });

  describe('a dry run', () => {
    it('asks catalog what it would remove, and sends no price', async () => {
      await row({}, { [DEFAULT]: 2.45 });

      const result = await service.settleItem({
        userId: ADMIN,
        itemId: WRONG,
        supermarketId: ELJAMON,
        dryRun: true,
      });

      expect(asked.priceWithdraws).toHaveLength(1);
      expect(asked.priceWithdraws[0].dryRun).toBe(true);
      expect(asked.priceWrites).toEqual([]);
      expect(result).toMatchObject({ dryRun: true, pricesRestated: 1 });
    }, 60_000);

    it('asks about the offers of a product no row names as if its prices were gone', async () => {
      await service.settleItem({
        userId: ADMIN,
        itemId: WRONG,
        supermarketId: ELJAMON,
        dryRun: true,
      });

      expect(asked.offerWithdraws).toEqual([
        {
          itemId: WRONG,
          supermarketId: ELJAMON,
          priceScopeIds: SCOPES,
          dryRun: { assumePricesWithdrawn: KINDS },
        },
      ]);
    }, 60_000);
  });
});
