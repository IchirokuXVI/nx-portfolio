import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  comparablePriceOf,
  PriceScopeKind,
  PriceSourceKind,
  UnitOfMeasure,
  type CreateItemRequest,
  type ItemView,
} from '@portfolio/luna-shopper/contracts';
import {
  describeIntegration,
  requiredEnv,
} from '@portfolio/luna-shopper/test-fixtures/jest';
import { DataSource } from 'typeorm';
import { CATALOG_MIGRATIONS } from '../db/migrations';
import { categoryId } from '../db/taxonomy/ids';
import {
  Brand,
  CATALOG_ENTITIES,
  Category,
  Item,
  ItemPrice,
  PriceScope,
  ProductGroup,
  Supermarket,
  SupermarketItem,
} from '../entities';
import { CatalogEventsPublisher } from '../events/catalog-events.publisher';
import { CatalogAuditService } from './catalog-audit.service';
import { CategoryService } from './category.service';
import { recomputeComparablePrices } from './comparable-price.sql';
import {
  EffectivePriceService,
  recomputeEffectivePrices,
} from './effective-price.service';
import { itemEanStoreOf } from './item-ean.store';
import { ItemPriceService } from './item-price.service';
import { ItemService } from './item.service';
import { PlatformAdminService } from './platform-admin.service';
import { PriceScopeService } from './price-scope.service';
import { ProductGroupService } from './product-group.service';

/**
 * The comparable price of plan 0245 against real Postgres.
 *
 * Every claim here lives in SQL: the migration's backfill and the recompute
 * are translations of `comparablePriceOf`, and this proves them equal on every
 * kind of row of section 1; the edits rewrite the pair inside their own
 * transaction; and the orderings read the pair in basis blocks. A double
 * would agree with whatever the service said.
 *
 * It works in a scratch schema of its own and drops it afterwards.
 *
 *   bash k8s/e2e/luna-shopper-backend/luna-slot.sh --ephemeral --up 5 --services catalog
 *   LUNA_INTEGRATION=1 CATALOG_DB_URL=postgres://luna_catalog:luna_catalog@localhost:<port>/luna_catalog \
 *     npx nx run luna-shopper-backend-catalog:test-integration --testFile=comparable-price.integration.spec.ts
 */
const SCHEMA = 'plan0245_comparable_price_test';

const HARVESTER = '11111111-1111-4111-8111-111111111111';
const OPERATOR = '24524524-2452-4452-8452-245245245245';
const RUN = '33333333-3333-4333-8333-333333333333';
const SHOPPER = 'shopper';
const OBSERVED = new Date('2026-11-01T10:00:00.000Z');

describeIntegration('the comparable price of plan 0245 (real Postgres)', () => {
  let dataSource: DataSource;
  let items: ItemService;
  let groups: ProductGroupService;
  let prices: ItemPriceService;
  let chainId: string;
  let firstScope: string;
  let secondScope: string;

  beforeAll(async () => {
    const url = requiredEnv('CATALOG_DB_URL');
    const bootstrap = new DataSource({ type: 'postgres', url });
    await bootstrap.initialize();
    await bootstrap.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
    await bootstrap.query(`CREATE SCHEMA "${SCHEMA}"`);
    await bootstrap.destroy();

    dataSource = new DataSource({
      type: 'postgres',
      url,
      schema: SCHEMA,
      entities: CATALOG_ENTITIES,
      migrations: CATALOG_MIGRATIONS,
      synchronize: false,
      extra: { options: `-c search_path=${SCHEMA},public` },
    });
    await dataSource.initialize();
    await dataSource.runMigrations();

    const gate = new PlatformAdminService(new JwtService({}), {
      getOrThrow: () => ({
        authJwtPublicKey: '',
        adminJwtPublicKey: '',
        serviceActorIds: [HARVESTER, OPERATOR],
      }),
    } as unknown as ConfigService);
    const events = {
      itemGroupChanged: () => undefined,
      productGroupDeleted: () => undefined,
      itemMerged: () => undefined,
    } as unknown as CatalogEventsPublisher;
    const audit = new CatalogAuditService(dataSource);
    groups = new ProductGroupService(
      dataSource.getRepository(ProductGroup),
      gate,
      audit,
      events
    );
    items = new ItemService(
      dataSource.getRepository(Item),
      dataSource.getRepository(ProductGroup),
      dataSource.getRepository(SupermarketItem),
      dataSource.getRepository(Brand),
      groups,
      gate,
      audit,
      events,
      new CategoryService(dataSource.getRepository(Category), gate, audit),
      itemEanStoreOf(dataSource)
    );
    const effective = new EffectivePriceService();
    prices = new ItemPriceService(
      dataSource.getRepository(ItemPrice),
      dataSource.getRepository(Item),
      dataSource.getRepository(PriceScope),
      gate,
      audit,
      effective
    );
    const scopes = new PriceScopeService(
      dataSource.getRepository(PriceScope),
      dataSource.getRepository(Supermarket),
      gate,
      audit,
      effective
    );
    const supermarkets = dataSource.getRepository(Supermarket);
    const chain = (name: string) =>
      supermarkets.save(supermarkets.create({ name: { en: name, es: name } }));
    chainId = (await chain('Lidl')).id;
    firstScope = (
      await scopes.create({
        userId: OPERATOR,
        supermarketId: chainId,
        kind: PriceScopeKind.NATIONAL,
        externalKey: null,
      })
    ).id;
    secondScope = (
      await scopes.create({
        userId: OPERATOR,
        supermarketId: (await chain('Mercadona')).id,
        kind: PriceScopeKind.NATIONAL,
        externalKey: null,
      })
    ).id;
  }, 120_000);

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
      await dataSource.destroy();
    }
  });

  function product(extra: Partial<Omit<CreateItemRequest, 'userId'>>) {
    return items.create({
      userId: OPERATOR,
      name: { es: 'Producto de prueba' },
      categoryIds: [categoryId('milk')],
      defaultUnit: UnitOfMeasure.UNIT,
      ...extra,
    });
  }

  /** A materialized row written straight, as the orderings read it. */
  async function offer(
    itemId: string,
    priceScopeId: string,
    price: number | null,
    unitPrice: number | null = null,
    unitPriceLabel: string | null = null
  ) {
    const repository = dataSource.getRepository(SupermarketItem);
    await repository.save(
      repository.create({
        itemId,
        priceScopeId,
        price,
        currency: 'EUR',
        unitPrice,
        unitPriceLabel,
        priceObservedAt: OBSERVED,
        priceSourceKind: PriceSourceKind.OFFICIAL_API,
        available: true,
      })
    );
  }

  interface PairRow {
    itemId: string;
    price: string | null;
    comparablePrice: string | null;
    comparableBasis: string | null;
    unitSize: string | null;
    defaultUnit: UnitOfMeasure;
    packCount: number | null;
    approxWeight: string | null;
    xmin: string;
  }

  const pairs = (itemIds: readonly string[]): Promise<PairRow[]> =>
    dataSource.query(
      `SELECT si."itemId", si."price", si."comparablePrice", si."comparableBasis",
              i."unitSize", i."defaultUnit", i."packCount", i."approxWeight",
              si.xmin::text AS "xmin"
         FROM "supermarket_items" si
         JOIN "items" i ON i."id" = si."itemId"
        WHERE si."itemId" = ANY($1::uuid[])
        ORDER BY si."itemId", si."priceScopeId"`,
      [[...itemIds]]
    );

  const num = (value: string | number | null) =>
    value === null ? null : Number(value);

  /** What the function answers for a row, read back from the database. */
  const expected = (row: PairRow) => {
    const pair = comparablePriceOf({
      price: num(row.price),
      unitSize: num(row.unitSize),
      defaultUnit: row.defaultUnit,
      packCount: num(row.packCount),
      approxWeight: num(row.approxWeight),
    });
    return {
      comparablePrice: pair?.price ?? null,
      comparableBasis: pair?.basis ?? null,
    };
  };

  const stored = (row: PairRow) => ({
    comparablePrice: num(row.comparablePrice),
    comparableBasis: row.comparableBasis,
  });

  /** The pairs of one product's rows, lowest figure first, whatever the scope ids. */
  const storedByFigure = async (itemId: string) =>
    (await pairs([itemId]))
      .map(stored)
      .sort(
        (a, b) =>
          (a.comparablePrice ?? Infinity) - (b.comparablePrice ?? Infinity)
      );

  describe('the derivation in SQL (sections 1, 3 and 6)', () => {
    /** One product per kind of row of section 1, each with one priced row. */
    const kinds: { id: string; want: [number, string] | null }[] = [];

    beforeAll(async () => {
      const make = async (
        extra: Partial<Omit<CreateItemRequest, 'userId'>>,
        price: number | null,
        want: [number, string] | null,
        raw?: string
      ) => {
        const created = await product(extra);
        if (raw) {
          await dataSource.query(`UPDATE "items" SET ${raw} WHERE "id" = $1`, [
            created.id,
          ]);
        }
        await offer(created.id, firstScope, price);
        kinds.push({ id: created.id, want });
      };
      await make({ defaultUnit: UnitOfMeasure.GRAM, unitSize: 500 }, 2.5, [
        5,
        'KILOGRAM',
      ]);
      await make(
        { defaultUnit: UnitOfMeasure.MILLILITER, unitSize: 330 },
        0.99,
        [3, 'LITER']
      );
      await make({ defaultUnit: UnitOfMeasure.GRAM }, 1, null);
      await make({ defaultUnit: UnitOfMeasure.MILLILITER }, 1, null);
      await make(
        { defaultUnit: UnitOfMeasure.GRAM, unitSize: 500 },
        null,
        null
      );
      await make({ defaultUnit: UnitOfMeasure.UNIT, unitSize: 12 }, 3, [
        0.25,
        'UNIT',
      ]);
      await make({ defaultUnit: UnitOfMeasure.UNIT, packCount: 6 }, 3, [
        0.5,
        'UNIT',
      ]);
      await make(
        { defaultUnit: UnitOfMeasure.UNIT, unitSize: 10, packCount: 6 },
        5,
        [0.5, 'UNIT']
      );
      await make({ defaultUnit: UnitOfMeasure.UNIT }, 1.2, [1.2, 'UNIT']);
      await make({ defaultUnit: UnitOfMeasure.KILOGRAM }, 13.42, [
        13.42,
        'KILOGRAM',
      ]);
      await make({ defaultUnit: UnitOfMeasure.UNIT, approxWeight: 750 }, 4.2, [
        4.2,
        'UNIT',
      ]);
      // The legacy units a create refuses, written as old rows hold them.
      await make(
        { defaultUnit: UnitOfMeasure.MILLILITER },
        1.5,
        [1, 'LITER'],
        `"defaultUnit" = 'LITER', "unitSize" = 1.5`
      );
      await make(
        { defaultUnit: UnitOfMeasure.GRAM },
        2,
        [5, 'KILOGRAM'],
        `"defaultUnit" = 'KILOGRAM', "unitSize" = 0.4`
      );
      await make(
        { defaultUnit: UnitOfMeasure.UNIT, unitSize: 4 },
        2,
        [0.5, 'UNIT'],
        `"defaultUnit" = 'PACK'`
      );
      await make({ defaultUnit: UnitOfMeasure.GRAM, unitSize: 3 }, 1, [
        333.3333,
        'KILOGRAM',
      ]);
      await make({ defaultUnit: UnitOfMeasure.UNIT, unitSize: 3 }, 2, [
        0.6667,
        'UNIT',
      ]);
    });

    it('the migration backfills every kind of row as the function derives it, and down drops it', async () => {
      // The rows were written straight, so the pair is null on each. Down
      // drops the columns, and up adds them back and backfills them.
      await dataSource.undoLastMigration();
      const dropped: { count: string }[] = await dataSource.query(
        `SELECT count(*)::text AS count FROM information_schema.columns
          WHERE table_schema = $1 AND table_name = 'supermarket_items'
            AND column_name IN ('comparablePrice', 'comparableBasis')`,
        [SCHEMA]
      );
      expect(dropped[0].count).toBe('0');
      const types: { count: string }[] = await dataSource.query(
        `SELECT count(*)::text AS count FROM pg_type t
           JOIN pg_namespace n ON n.oid = t.typnamespace
          WHERE n.nspname = $1 AND t.typname = 'comparable_basis'`,
        [SCHEMA]
      );
      expect(types[0].count).toBe('0');

      await dataSource.runMigrations();

      const rows = await pairs(kinds.map((kind) => kind.id));
      expect(rows).toHaveLength(kinds.length);
      for (const row of rows) {
        expect(stored(row)).toEqual(expected(row));
        const want = kinds.find((kind) => kind.id === row.itemId)?.want;
        expect(stored(row)).toEqual(
          want
            ? { comparablePrice: want[0], comparableBasis: want[1] }
            : { comparablePrice: null, comparableBasis: null }
        );
      }
    });

    it('the recompute writes the same pair, and a second run writes nothing', async () => {
      const itemIds = kinds.map((kind) => kind.id);
      await dataSource.query(
        `UPDATE "supermarket_items"
            SET "comparablePrice" = NULL, "comparableBasis" = NULL
          WHERE "itemId" = ANY($1::uuid[])`,
        [itemIds]
      );
      await recomputeComparablePrices(dataSource.manager, itemIds);
      const first = await pairs(itemIds);
      for (const row of first) {
        expect(stored(row)).toEqual(expected(row));
      }

      await recomputeComparablePrices(dataSource.manager, itemIds);
      const second = await pairs(itemIds);
      expect(second.map((row) => row.xmin)).toEqual(
        first.map((row) => row.xmin)
      );
    });

    it('refuses a figure with no basis (supermarket_item_comparable_pair)', async () => {
      await expect(
        dataSource.query(
          `UPDATE "supermarket_items" SET "comparableBasis" = NULL
            WHERE "itemId" = $1`,
          [kinds[0].id]
        )
      ).rejects.toThrow(/supermarket_item_comparable_pair/);
    });
  });

  describe('the write beside the price (section 2)', () => {
    it('writes the pair beside the price, and a second run writes nothing', async () => {
      const pack = await product({
        defaultUnit: UnitOfMeasure.GRAM,
        unitSize: 400,
      });
      await prices.addBatch({
        userId: HARVESTER,
        priceScopeId: firstScope,
        sourceKind: PriceSourceKind.OFFICIAL_API,
        sourceRunId: RUN,
        entries: [
          {
            itemId: pack.id,
            price: 1.8,
            currency: 'EUR',
            observedAt: new Date(Date.now() - 60_000).toISOString(),
          },
        ],
      });
      const [written] = await pairs([pack.id]);
      expect(stored(written)).toEqual({
        comparablePrice: 4.5,
        comparableBasis: 'KILOGRAM',
      });

      await recomputeEffectivePrices(dataSource.manager, [
        { itemId: pack.id, priceScopeId: firstScope },
      ]);
      const [again] = await pairs([pack.id]);
      expect(again.xmin).toBe(written.xmin);
    });
  });

  describe('an item edit rewrites its rows (section 3)', () => {
    async function pricedPack() {
      const pack = await product({
        defaultUnit: UnitOfMeasure.GRAM,
        unitSize: 500,
      });
      await offer(pack.id, firstScope, 2);
      await offer(pack.id, secondScope, 3);
      await recomputeComparablePrices(dataSource.manager, [pack.id]);
      return pack;
    }

    it('on a unitSize edit, every row of the item', async () => {
      const pack = await pricedPack();
      await items.update({ userId: OPERATOR, itemId: pack.id, unitSize: 250 });
      expect(await storedByFigure(pack.id)).toEqual([
        { comparablePrice: 8, comparableBasis: 'KILOGRAM' },
        { comparablePrice: 12, comparableBasis: 'KILOGRAM' },
      ]);
    });

    it('on a defaultUnit edit', async () => {
      const pack = await pricedPack();
      await items.update({
        userId: OPERATOR,
        itemId: pack.id,
        defaultUnit: UnitOfMeasure.MILLILITER,
      });
      expect(await storedByFigure(pack.id)).toEqual([
        { comparablePrice: 4, comparableBasis: 'LITER' },
        { comparablePrice: 6, comparableBasis: 'LITER' },
      ]);
    });

    it('on a packCount edit and on a pack count fill', async () => {
      const counted = await product({ defaultUnit: UnitOfMeasure.UNIT });
      await offer(counted.id, firstScope, 3);
      await recomputeComparablePrices(dataSource.manager, [counted.id]);
      expect(stored((await pairs([counted.id]))[0])).toEqual({
        comparablePrice: 3,
        comparableBasis: 'UNIT',
      });

      await items.fillPackCounts({
        userId: HARVESTER,
        entries: [{ itemId: counted.id, packCount: 6 }],
      });
      expect(stored((await pairs([counted.id]))[0])).toEqual({
        comparablePrice: 0.5,
        comparableBasis: 'UNIT',
      });

      await items.update({
        userId: OPERATOR,
        itemId: counted.id,
        packCount: 4,
      });
      expect(stored((await pairs([counted.id]))[0])).toEqual({
        comparablePrice: 0.75,
        comparableBasis: 'UNIT',
      });
    });

    it('on a weight fill, which rewrites the pair though the weight derives none', async () => {
      const piece = await product({ defaultUnit: UnitOfMeasure.UNIT });
      await offer(piece.id, firstScope, 4.2);
      // A pair out of date, which only the fill's recompute corrects.
      await dataSource.query(
        `UPDATE "supermarket_items"
            SET "comparablePrice" = 99, "comparableBasis" = 'KILOGRAM'
          WHERE "itemId" = $1`,
        [piece.id]
      );
      await items.setApproxWeights({
        userId: HARVESTER,
        entries: [{ itemId: piece.id, approxWeight: 750 }],
      });
      expect(stored((await pairs([piece.id]))[0])).toEqual({
        comparablePrice: 4.2,
        comparableBasis: 'UNIT',
      });
    });
  });

  describe('the orderings (section 4)', () => {
    const ids = {
      group: '',
      lidl: '',
      perKilo: '',
      perLitre: '',
      counted: '',
      none: '',
      kiloMember: '',
      unitMember: '',
    };
    const names = new Map<string, string>();

    beforeAll(async () => {
      // One group holds the listing's products, so each read names it and
      // sees them and nothing else.
      ids.group = (
        await groups.create({
          userId: OPERATOR,
          name: { en: 'Comparable listing', es: 'Listado comparable' },
          slug: 'plan-0245-listing',
          referenceUnit: UnitOfMeasure.GRAM,
          synonyms: { en: [], es: [] },
        })
      ).id;
      const listed = async (
        key: keyof typeof ids,
        extra: Partial<Omit<CreateItemRequest, 'userId'>>
      ) => {
        const created = await product({
          name: { es: `Comparable ${key}` },
          productGroupId: ids.group,
          ...extra,
        });
        ids[key] = created.id;
        names.set(created.id, key);
      };
      await listed('lidl', { defaultUnit: UnitOfMeasure.GRAM, unitSize: 500 });
      await listed('perKilo', {
        defaultUnit: UnitOfMeasure.GRAM,
        unitSize: 1000,
      });
      await listed('perLitre', {
        defaultUnit: UnitOfMeasure.MILLILITER,
        unitSize: 1000,
      });
      await listed('counted', { defaultUnit: UnitOfMeasure.UNIT });
      await listed('none', { defaultUnit: UnitOfMeasure.GRAM });

      // LIDL prints no unit price: 1 € for 500 g is 2 € a kilo.
      await offer(ids.lidl, firstScope, 1);
      // The chain's figure says 0.5 € a kilo, which the size disproves.
      await offer(ids.perKilo, secondScope, 3, 0.5, 'kg');
      await offer(ids.perLitre, secondScope, 2.5, 2.5, 'l');
      // The lowest number of all, and a price per piece.
      await offer(ids.counted, secondScope, 0.1, 0.1, 'ud');
      // A gram product with no size derives no figure.
      await offer(ids.none, firstScope, 0.05);
      await recomputeComparablePrices(dataSource.manager, [
        ids.lidl,
        ids.perKilo,
        ids.perLitre,
        ids.counted,
        ids.none,
      ]);
    });

    const keysOf = (page: readonly ItemView[]) =>
      page.map((item) => names.get(item.id));

    async function walk(limit: number): Promise<(string | undefined)[][]> {
      const pages: (string | undefined)[][] = [];
      let cursor: string | undefined;
      for (let turn = 0; turn < 8; turn += 1) {
        const page = await items.search({
          userId: SHOPPER,
          productGroupId: ids.group,
          order: 'unitPrice',
          priceScopeIds: [firstScope, secondScope],
          limit,
          cursor,
        });
        pages.push(keysOf(page.items));
        if (page.nextCursor === null) {
          return pages;
        }
        cursor = page.nextCursor;
      }
      throw new Error('The unitPrice order never reached its last page.');
    }

    it('places a LIDL row by its derived figure, and a counted product after every kilo and litre figure', async () => {
      expect((await walk(10)).flat()).toEqual([
        'lidl',
        'perLitre',
        'perKilo',
        'counted',
        'none',
      ]);
    });

    it('pages through the two blocks and the null tail with no repeat and no gap', async () => {
      expect(await walk(1)).toEqual([
        ['lidl'],
        ['perLitre'],
        ['perKilo'],
        ['counted'],
        ['none'],
      ]);
      expect(await walk(2)).toEqual([
        ['lidl', 'perLitre'],
        ['perKilo', 'counted'],
        ['none'],
      ]);
    });

    it('attaches the row that placed the product, with its pair', async () => {
      const page = await items.search({
        userId: SHOPPER,
        productGroupId: ids.group,
        order: 'unitPrice',
        priceScopeIds: [firstScope, secondScope],
      });
      expect(page.items[0].bestOffer).toMatchObject({
        price: 1,
        unitPrice: null,
        comparablePrice: 2,
        comparableBasis: 'KILOGRAM',
      });
    });

    it('picks the row with the lowest comparablePrice of one product, not the lowest unitPrice', async () => {
      const pack = await product({
        defaultUnit: UnitOfMeasure.GRAM,
        unitSize: 500,
      });
      // The chain's figure at the first scope is the lower one, and its
      // till price the higher.
      await offer(pack.id, firstScope, 2, 0.1, 'kg');
      await offer(pack.id, secondScope, 1.5, 3, 'kg');
      await recomputeComparablePrices(dataSource.manager, [pack.id]);
      for (const request of [
        { ids: [pack.id] },
        { ids: [pack.id], offers: 'all' as const },
      ]) {
        const read = await items.getMany({
          ...request,
          priceScopeIds: [firstScope, secondScope],
        });
        expect(read.items[0].bestOffer).toMatchObject({
          priceScopeId: secondScope,
          comparablePrice: 3,
        });
      }
    });

    it('answers the kilo member of a group as its cheapestItem, whatever the figures', async () => {
      const group = await groups.create({
        userId: OPERATOR,
        name: { en: 'Quesitos mixtos', es: 'Quesitos mixtos' },
        slug: 'plan-0245-two-bases',
        referenceUnit: UnitOfMeasure.GRAM,
        synonyms: { en: [], es: [] },
      });
      ids.kiloMember = (
        await product({
          defaultUnit: UnitOfMeasure.GRAM,
          unitSize: 1000,
          productGroupId: group.id,
        })
      ).id;
      ids.unitMember = (
        await product({
          defaultUnit: UnitOfMeasure.UNIT,
          productGroupId: group.id,
        })
      ).id;
      await offer(ids.kiloMember, firstScope, 9);
      await offer(ids.unitMember, firstScope, 0.5);
      await recomputeComparablePrices(dataSource.manager, [
        ids.kiloMember,
        ids.unitMember,
      ]);

      const page = await items.searchOffers({
        userId: SHOPPER,
        query: 'quesitos mixtos',
        priceScopeIds: [firstScope],
        members: 2,
      });
      const answer = page.items.find((row) => row.group.id === group.id);
      expect(answer?.cheapestItem?.id).toBe(ids.kiloMember);
      expect(answer?.offer).toMatchObject({
        price: 9,
        comparablePrice: 9,
        comparableBasis: 'KILOGRAM',
      });
      expect(answer?.members?.map((member) => member.id)).toEqual([
        ids.kiloMember,
        ids.unitMember,
      ]);
    });
  });
});
