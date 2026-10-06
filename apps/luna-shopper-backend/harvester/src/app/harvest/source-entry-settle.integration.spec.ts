import { ConfigService } from '@nestjs/config';
import {
  PriceSourceKind,
  SourceEntryStatus,
  type HeldItemPrice,
  type ItemView,
  type LeftItemPrice,
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
  SupermarketSource,
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
 * `item-withdraw.integration.spec.ts`. The two halves over both databases
 * are `settle-across-services.integration.spec.ts`, beside this file.
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

/** A walk of the chain's website, and a leaflet an operator uploaded. */
const RUN = 'e1910000-0000-4000-a000-000000000001';
const LEAFLET_RUN = 'e1910000-0000-4000-a000-000000000002';
/** A run id no row of `harvest_runs` carries. */
const LOST_RUN = 'e1910000-0000-4000-a000-000000000003';
const OBSERVED = '2026-10-05T06:00:00.000Z';
const BARCODE = '8402001047251';

const KINDS = [
  PriceSourceKind.OFFICIAL_API,
  PriceSourceKind.OFFICIAL_WEB,
  PriceSourceKind.OFFICIAL_LEAFLET,
];

/**
 * The kind each run of this spec writes its prices with (plan 0190). A price
 * row carries the kind of the run that observed it, so the fixture stamps it
 * as a run does. A price of a run that is gone, or of no run, has no kind:
 * that is what the migration of plan 0190 leaves on such a row.
 */
const KIND_OF_RUN: Record<string, PriceSourceKind> = {
  [RUN]: PriceSourceKind.OFFICIAL_WEB,
  [LEAFLET_RUN]: PriceSourceKind.OFFICIAL_LEAFLET,
};

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
      held: HeldItemPrice[];
      stated: StatedItemPrice[];
      left: LeftItemPrice[];
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
  /** Set by a test to make the next price write to a product fail. */
  let failPriceWrite: Error | null;

  /** What a statement says, in the three fields the tests read. */
  const said = (each: StatedItemPrice) => ({
    priceScopeId: each.priceScopeId,
    sourceKind: each.sourceKind,
    sourceRunId: each.sourceRunId,
    price: each.price.price,
    observedAt: each.price.observedAt,
  });
  const WEB = PriceSourceKind.OFFICIAL_WEB;

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
        if (failPriceWrite) {
          throw failPriceWrite;
        }
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
        lists: {
          held: HeldItemPrice[];
          stated: StatedItemPrice[];
          left: LeftItemPrice[];
        },
        dryRun = false
      ) => {
        asked.order.push('withdrawPrices');
        asked.priceWithdraws.push({
          itemId,
          priceScopeIds,
          sourceKinds,
          ...lists,
          dryRun,
        });
        return {
          deleted: 0,
          removed: [],
          inserted: 0,
          confirmed: 0,
          keptAsWritten: [],
          notWritable: [],
          notCurrent: [],
          recomputed: 0,
        };
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
        for (const pair of pairs) {
          eanHolders.set(pair.ean, pair.itemId);
        }
        return { added: pairs.length, refused: [] };
      },
    } as unknown as CatalogClient;

    // The runs the prices name. The kind of a price is its run's, so the
    // settle reads these two tables, and a fake would prove no `where`.
    await cleanRuns();
    await dataSource.query(
      // Finished, because a chain holds one run at a time that is not.
      `INSERT INTO "harvest_runs"
              ("id", "supermarketId", "mode", "status", "input")
       VALUES ($1, $3, 'CATALOG_DISCOVERY', 'COMPLETED', '{}'::jsonb),
              ($2, $3, 'FILE_IMPORT', 'COMPLETED',
               '{"sourceKind":"OFFICIAL_LEAFLET"}'::jsonb)`,
      [RUN, LEAFLET_RUN, ELJAMON]
    );
    await dataSource.query(
      `INSERT INTO "supermarket_sources" ("supermarketId", "adapterKey")
       VALUES ($1, 'eljamon-web')`,
      [ELJAMON]
    );

    const writer = new SourceEntryPriceWriter(catalog, entries);
    settler = new SourceEntrySettler(
      entries,
      dataSource.getRepository(HarvestRun),
      dataSource.getRepository(SupermarketSource),
      catalog
    );
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
      await cleanRuns();
      await dataSource.destroy();
    }
  });

  async function cleanRuns() {
    await dataSource.query(
      `DELETE FROM "harvest_runs" WHERE "id" = ANY($1::uuid[])`,
      [[RUN, LEAFLET_RUN]]
    );
    await dataSource.query(
      `DELETE FROM "supermarket_sources" WHERE "supermarketId" = ANY($1::uuid[])`,
      [[ELJAMON, OTHER_CHAIN]]
    );
  }

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
    failPriceWrite = null;
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
    priceOver: {
      validUntil?: string;
      runId?: string | null;
      observedAt?: string;
      /** Absent: the kind of the run. Null: a price from before plan 0190. */
      sourceKind?: PriceSourceKind | null;
    } = {}
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
    const runId = priceOver.runId === undefined ? RUN : priceOver.runId;
    const sourceKind =
      priceOver.sourceKind === undefined
        ? ((runId ? KIND_OF_RUN[runId] : undefined) ?? null)
        : priceOver.sourceKind;
    for (const [priceScopeId, price] of Object.entries(prices)) {
      await dataSource.query(
        `INSERT INTO "source_entry_prices"
                ("entryId", "priceScopeId", "price", "observedAt", "runId",
                 "validUntil", "sourceKind")
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          inserted.id,
          priceScopeId,
          price,
          priceOver.observedAt ?? OBSERVED,
          runId,
          priceOver.validUntil ?? null,
          sourceKind,
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
      // No row of the chain names the wrong product now, so nothing is held
      // or stated for it: every run written price row goes, at every scope
      // and kind, and then its offers are asked about.
      expect(asked.priceWithdraws).toEqual([
        {
          itemId: WRONG,
          priceScopeIds: SCOPES,
          sourceKinds: KINDS,
          held: [],
          stated: [],
          // The run of the price the row that left holds.
          left: [{ priceScopeId: DEFAULT, sourceRunId: RUN }],
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
      // The old product is settled right after the bind, before the price
      // write, which can fail and cannot be made up for by a retry.
      expect(asked.order).toEqual([
        'withdrawPrices',
        'withdrawOffers',
        'addPrices',
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

      // What the staying row holds is accounted for, and what it states
      // travels inside the one withdraw, with its run and its instant.
      expect(asked.priceWithdraws).toHaveLength(1);
      expect(asked.priceWithdraws[0].itemId).toBe(WRONG);
      expect(asked.priceWithdraws[0].held).toEqual([
        { priceScopeId: DEFAULT, sourceKind: WEB, sourceRunId: RUN },
        { priceScopeId: NORTH, sourceKind: WEB, sourceRunId: RUN },
      ]);
      expect(asked.priceWithdraws[0].left).toEqual([
        { priceScopeId: DEFAULT, sourceRunId: RUN },
      ]);
      expect(asked.priceWithdraws[0].stated.map(said)).toEqual([
        {
          priceScopeId: DEFAULT,
          sourceKind: WEB,
          sourceRunId: RUN,
          price: 2.45,
          observedAt: OBSERVED,
        },
        {
          priceScopeId: NORTH,
          sourceKind: WEB,
          sourceRunId: RUN,
          price: 2.6,
          observedAt: OBSERVED,
        },
      ]);
      // The harvester sends no price of its own to the old product: catalog
      // writes what is stated in the transaction that removes the rest.
      expect(asked.priceWrites).toEqual([
        { priceScopeId: DEFAULT, itemId: RIGHT, price: 2.95 },
      ]);
      expect(asked.order).toEqual(['withdrawPrices', 'addPrices']);
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

      expect(asked.priceWithdraws[0].held).toEqual([]);
      expect(asked.priceWithdraws[0].stated).toEqual([]);
      expect(asked.offerWithdraws).toHaveLength(1);
      expect(result.settled?.boundEntryIds).toEqual([]);
    }, 60_000);

    it('has settled the old product when the price write to the new one fails, and says so', async () => {
      const figurine = await row();
      failPriceWrite = new Error('catalog is away');

      const failure = await service
        .accept({ userId: ADMIN, entryId: figurine, itemId: RIGHT })
        .catch((error: Error) => error);

      // The bind stands, and the old product was settled before the failure.
      expect(await stored(figurine)).toMatchObject({ itemId: RIGHT });
      expect(asked.priceWithdraws.map((each) => each.itemId)).toEqual([WRONG]);
      expect(asked.offerWithdraws.map((each) => each.itemId)).toEqual([WRONG]);
      expect((failure as Error).message).toContain('catalog is away');
      expect((failure as Error).message).toContain(WRONG);
      expect((failure as Error).message).toContain(ELJAMON);

      // The retry binds to the same product, so it settles nothing. That is
      // why the first call had to.
      failPriceWrite = null;
      const retried = await service.accept({
        userId: ADMIN,
        entryId: figurine,
        itemId: RIGHT,
      });
      expect(retried.settled).toBeNull();
      expect(asked.priceWithdraws).toHaveLength(1);
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
          held: [],
          stated: [],
          // The run of the price the row that left holds.
          left: [{ priceScopeId: DEFAULT, sourceRunId: RUN }],
          dryRun: false,
        },
      ]);
      expect(asked.offerWithdraws.map((each) => each.itemId)).toEqual([WRONG]);
    }, 60_000);

    it('keeps what a second row of the chain still states', async () => {
      const rejected = await row({}, { [DEFAULT]: 2.95 });
      await row({}, { [DEFAULT]: 2.45 });

      await service.reject({ userId: ADMIN, entryId: rejected });

      expect(asked.priceWithdraws[0].stated.map(said)).toEqual([
        {
          priceScopeId: DEFAULT,
          sourceKind: WEB,
          sourceRunId: RUN,
          price: 2.45,
          observedAt: OBSERVED,
        },
      ]);
      expect(asked.priceWrites).toEqual([]);
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

    it('does not meet a price of another kind, or a row of another chain, another product, or one that is not bound', async () => {
      const king = await row(
        { itemId: null, status: SourceEntryStatus.UNRESOLVED },
        { [DEFAULT]: 2.95 }
      );
      // A leaflet price. The kind that is compared is the kind of the price
      // (plan 0190), whatever the row says.
      await row({ itemId: RIGHT }, { [DEFAULT]: 1.99 }, { runId: LEAFLET_RUN });
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

      // The scope they disagree on is held and not stated.
      expect(asked.priceWithdraws[0].held).toEqual([
        { priceScopeId: DEFAULT, sourceKind: WEB, sourceRunId: RUN },
        { priceScopeId: NORTH, sourceKind: WEB, sourceRunId: RUN },
      ]);
      expect(asked.priceWithdraws[0].stated.map(said)).toEqual([
        {
          priceScopeId: NORTH,
          sourceKind: WEB,
          sourceRunId: RUN,
          price: 3.05,
          observedAt: OBSERVED,
        },
      ]);
      expect(asked.priceWrites).toEqual([]);
      expect(result.pricesWithheld).toEqual([
        { entryId: small, priceScopeId: DEFAULT, otherEntryIds: [king] },
        { entryId: king, priceScopeId: DEFAULT, otherEntryIds: [small] },
      ]);
    }, 60_000);
  });

  describe('the kind of a price is the kind of the run that observed it', () => {
    it('reads the kind a price row holds, also when its run is gone (plan 0190)', async () => {
      // The price row says its own kind since plan 0190, so a run that the
      // table no longer holds does not make the price unknown.
      await row(
        { sourceKind: PriceSourceKind.OFFICIAL_WEB },
        { [DEFAULT]: 1.99 },
        { runId: LOST_RUN, sourceKind: PriceSourceKind.OFFICIAL_LEAFLET }
      );

      await settler.settle(WRONG, ELJAMON);

      const [withdraw] = asked.priceWithdraws;
      expect(withdraw.held).toEqual([
        {
          priceScopeId: DEFAULT,
          sourceKind: PriceSourceKind.OFFICIAL_LEAFLET,
          sourceRunId: LOST_RUN,
        },
      ]);
      expect(withdraw.stated.map(said)).toEqual([
        {
          priceScopeId: DEFAULT,
          sourceKind: PriceSourceKind.OFFICIAL_LEAFLET,
          sourceRunId: LOST_RUN,
          price: 1.99,
          observedAt: OBSERVED,
        },
      ]);
    }, 60_000);

    it('states a leaflet price as a leaflet price on a row that says website, for a price that has no kind', async () => {
      // One shared row (plan 0190). A leaflet wrote its price before that
      // plan, so the price row has no kind, and the row says OFFICIAL_WEB.
      // The run is the fallback.
      await row(
        { sourceKind: PriceSourceKind.OFFICIAL_WEB },
        { [DEFAULT]: 1.99 },
        { runId: LEAFLET_RUN, sourceKind: null }
      );

      await settler.settle(WRONG, ELJAMON);

      const [withdraw] = asked.priceWithdraws;
      // Held and stated as what catalog holds it as. Read from the row, the
      // leaflet kind would be unaccounted for and its price row would go.
      expect(withdraw.held).toEqual([
        {
          priceScopeId: DEFAULT,
          sourceKind: PriceSourceKind.OFFICIAL_LEAFLET,
          sourceRunId: LEAFLET_RUN,
        },
      ]);
      expect(withdraw.stated.map(said)).toEqual([
        {
          priceScopeId: DEFAULT,
          sourceKind: PriceSourceKind.OFFICIAL_LEAFLET,
          sourceRunId: LEAFLET_RUN,
          price: 1.99,
          observedAt: OBSERVED,
        },
      ]);
    }, 60_000);

    it('spares every kind at the scope, and states nothing, for a price whose run is gone or absent', async () => {
      await row({}, { [DEFAULT]: 1.99 }, { runId: LOST_RUN });
      await row({}, { [NORTH]: 2.05 }, { runId: null });

      const result = await settler.settle(WRONG, ELJAMON);

      const [withdraw] = asked.priceWithdraws;
      expect(withdraw.held).toEqual([
        { priceScopeId: DEFAULT, sourceKind: null, sourceRunId: LOST_RUN },
        { priceScopeId: NORTH, sourceKind: null, sourceRunId: null },
      ]);
      expect(withdraw.stated).toEqual([]);
      expect(result.pricesRestated).toBe(0);
    }, 60_000);

    it('holds a price whose window closed, so the history of a leaflet that ended stays', async () => {
      await row(
        {},
        { [DEFAULT]: 1.99 },
        { runId: LEAFLET_RUN, validUntil: '2026-09-28T00:00:00.000Z' }
      );

      await settler.settle(WRONG, ELJAMON);

      const [withdraw] = asked.priceWithdraws;
      expect(withdraw.held).toEqual([
        {
          priceScopeId: DEFAULT,
          sourceKind: PriceSourceKind.OFFICIAL_LEAFLET,
          sourceRunId: LEAFLET_RUN,
        },
      ]);
      expect(withdraw.stated).toEqual([]);
    }, 60_000);
  });

  describe('the row that left', () => {
    it('names its runs to catalog on a move and on a reject, and none on the route a person calls', async () => {
      await row({}, { [DEFAULT]: 2.45 });
      const leaving = await row(
        {},
        { [DEFAULT]: 1.99, [NORTH]: 2.05 },
        { runId: LEAFLET_RUN }
      );

      await service.reject({ userId: ADMIN, entryId: leaving });

      expect(asked.priceWithdraws[0].left).toEqual([
        { priceScopeId: DEFAULT, sourceRunId: LEAFLET_RUN },
        { priceScopeId: NORTH, sourceRunId: LEAFLET_RUN },
      ]);

      await service.settleItem({
        userId: ADMIN,
        itemId: WRONG,
        supermarketId: ELJAMON,
      });

      expect(asked.priceWithdraws[1].left).toEqual([]);
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
      // The old product no longer finds by that barcode. The new one does.
      expect(eanHolders.get(BARCODE)).toBe(RIGHT);
    }, 60_000);

    it('has moved the barcode when the price write fails, so the retry is not refused with item_ean_held', async () => {
      const bottle = await row({ ean: BARCODE });
      eanHolders.set(BARCODE, WRONG);
      failPriceWrite = new Error('catalog is away');

      const failure = await service
        .accept({ userId: ADMIN, entryId: bottle, itemId: RIGHT })
        .catch((error: Error) => error);

      expect((failure as Error).message).toContain('catalog is away');
      expect(await stored(bottle)).toMatchObject({ itemId: RIGHT });
      // Settled, then the barcode, then the price write that failed.
      expect(asked.order).toEqual([
        'withdrawPrices',
        'withdrawOffers',
        'removeItemEan',
        'teachItemEans',
        'addPrices',
      ]);
      expect(eanHolders.get(BARCODE)).toBe(RIGHT);

      // The retry. The stored row names the new product, so no product is
      // "the one it leaves". With the barcode still on the old product this
      // was `item_ean_held`, thrown before any price was written, with the
      // old product already stripped of its price and its offers.
      failPriceWrite = null;
      const retried = await service.accept({
        userId: ADMIN,
        entryId: bottle,
        itemId: RIGHT,
      });

      expect(retried.pricesWritten).toBe(1);
      expect(asked.priceWrites).toEqual([
        { priceScopeId: DEFAULT, itemId: RIGHT, price: 4.99 },
      ]);
      // Nothing more to move.
      expect(asked.eanRemovals).toHaveLength(1);
      expect(asked.eanTeaches).toHaveLength(1);
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
    it('asks catalog what it would remove and write, and sends no price', async () => {
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
