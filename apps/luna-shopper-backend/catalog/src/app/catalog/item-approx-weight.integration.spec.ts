import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  PriceScopeKind,
  PriceSourceKind,
  UnitOfMeasure,
  type AdminCredential,
  type CreateItemRequest,
} from '@portfolio/luna-shopper/contracts';
import {
  ForbiddenException,
  ITEM_APPROX_WEIGHT_DETAIL,
  ITEM_UNIT_SIZE_DETAIL,
  ItemApproxWeightBesideSizeException,
  ItemKilogramHasSizeException,
  ItemMergeFormatDiffersException,
  ValidationException,
} from '@portfolio/luna-shopper/platform';
import {
  describeIntegration,
  requiredEnv,
} from '@portfolio/luna-shopper/test-fixtures/jest';
import { DataSource } from 'typeorm';
import { CATALOG_MIGRATIONS } from '../db/migrations';
import { categoryId } from '../db/taxonomy/ids';
import {
  AuditAction,
  Brand,
  CATALOG_ENTITIES,
  CatalogAudit,
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
import { EffectivePriceService } from './effective-price.service';
import { itemEanStoreOf } from './item-ean.store';
import { ItemPriceService } from './item-price.service';
import type { ItemReferences, QueueUsage } from './item-references.client';
import { ItemService } from './item.service';
import {
  PlatformAdminService,
  type CatalogActor,
} from './platform-admin.service';
import { PriceScopeService } from './price-scope.service';
import { ProductGroupService } from './product-group.service';

/**
 * The approximate weight of a piece against real Postgres (plan 0244).
 *
 * The claims here live in SQL or span a transaction, so a double would agree
 * with whatever the service said: the two checks of the migration, the write
 * rule on a create and an edit as the row will be saved, the fill's one
 * statement and its audit rows, a merge of two pieces, and the piece price on
 * a priced read.
 *
 * It works in a scratch schema of its own and drops it afterwards.
 *
 *   bash k8s/e2e/luna-shopper-backend/luna-slot.sh --ephemeral --up 7 --services catalog
 *   LUNA_INTEGRATION=1 CATALOG_DB_URL=postgres://luna_catalog:luna_catalog@localhost:<port>/luna_catalog \
 *     npx nx run luna-shopper-backend-catalog:test-integration --testFile=item-approx-weight.integration.spec.ts
 */
const SCHEMA = 'plan0244_approx_weight_test';

/** The harvester and the operator, both service actors of the real gate. */
const HARVESTER = '11111111-1111-4111-8111-111111111111';
const OPERATOR = '24424424-2442-4442-8442-244244244244';
const RUN = '33333333-3333-4333-8333-333333333333';
const AS_OPERATOR: AdminCredential = { userId: OPERATOR };

/** Nothing in the harvester or core names any product of this spec. */
class NoReferences implements ItemReferences {
  async queueUsage(
    _credential: AdminCredential,
    itemIds: readonly string[]
  ): Promise<Map<string, QueueUsage>> {
    return new Map(
      itemIds.map((id) => [id, { rowCount: 0, activeSupermarketIds: [] }])
    );
  }

  async lineUsage(
    _credential: AdminCredential,
    itemIds: readonly string[]
  ): Promise<Map<string, number>> {
    return new Map(itemIds.map((id) => [id, 0]));
  }
}

describeIntegration('the approximate weight of a piece (real Postgres)', () => {
  let dataSource: DataSource;
  let items: ItemService;
  /** The same service behind a gate that answers an operator, for a merge. */
  let operator: ItemService;
  let prices: ItemPriceService;
  let nationalId: string;

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
    const build = (admin: PlatformAdminService) =>
      new ItemService(
        dataSource.getRepository(Item),
        dataSource.getRepository(ProductGroup),
        dataSource.getRepository(SupermarketItem),
        dataSource.getRepository(Brand),
        new ProductGroupService(
          dataSource.getRepository(ProductGroup),
          admin,
          audit,
          events
        ),
        admin,
        audit,
        events,
        new CategoryService(dataSource.getRepository(Category), admin, audit),
        itemEanStoreOf(dataSource),
        new NoReferences()
      );
    items = build(gate);
    operator = build({
      requireAdmin: async (): Promise<CatalogActor> => ({
        kind: 'admin',
        actorId: OPERATOR,
      }),
    } as unknown as PlatformAdminService);
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
    const chain = await supermarkets.save(
      supermarkets.create({ name: { en: 'Mercadona', es: 'Mercadona' } })
    );
    nationalId = (
      await scopes.create({
        userId: OPERATOR,
        supermarketId: chain.id,
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

  /** A cheese, sold by the kilo, unless told otherwise. */
  function product(
    extra: Partial<Omit<CreateItemRequest, 'userId'>> = {},
    userId = OPERATOR
  ) {
    return items.create({
      userId,
      name: { es: 'Queso viejo tostado mezcla' },
      categoryIds: [categoryId('milk')],
      defaultUnit: UnitOfMeasure.KILOGRAM,
      ...extra,
    });
  }

  const row = (id: string) =>
    dataSource.getRepository(Item).findOneByOrFail({ id });

  async function refused<T>(
    work: Promise<unknown>,
    type: new (...a: never[]) => T
  ) {
    const error = await work.then(
      () => {
        throw new Error('expected the call to be refused');
      },
      (caught: unknown) => caught
    );
    expect(error).toBeInstanceOf(type);
    return error as T & { details?: Record<string, unknown> };
  }

  describe('the columns (section 3.1)', () => {
    it('refuses a sized product with a weight in raw SQL (item_approx_weight_beside_no_size)', async () => {
      const pack = await product({
        defaultUnit: UnitOfMeasure.GRAM,
        unitSize: 1560,
      });
      await expect(
        dataSource.query(
          `UPDATE "items" SET "approxWeight" = 1560, "approxWeightSetBy" = 'SOURCE' WHERE "id" = $1`,
          [pack.id]
        )
      ).rejects.toThrow(/item_approx_weight_beside_no_size/);
    });

    it('refuses a weight at zero in raw SQL', async () => {
      const piece = await product();
      await expect(
        dataSource.query(
          `UPDATE "items" SET "approxWeight" = 0, "approxWeightSetBy" = 'SOURCE' WHERE "id" = $1`,
          [piece.id]
        )
      ).rejects.toThrow(/item_approx_weight_beside_no_size/);
    });

    it('refuses a weight with no writer, and a writer with no weight (item_approx_weight_has_a_writer)', async () => {
      const piece = await product();
      await expect(
        dataSource.query(
          `UPDATE "items" SET "approxWeight" = 1560 WHERE "id" = $1`,
          [piece.id]
        )
      ).rejects.toThrow(/item_approx_weight_has_a_writer/);
      await expect(
        dataSource.query(
          `UPDATE "items" SET "approxWeightSetBy" = 'ADMIN' WHERE "id" = $1`,
          [piece.id]
        )
      ).rejects.toThrow(/item_approx_weight_has_a_writer/);
    });
  });

  describe('the write rule (section 3.2)', () => {
    it('saves a KILOGRAM piece of 1560 g as ADMIN', async () => {
      const piece = await product({ approxWeight: 1560 });
      expect(piece).toMatchObject({
        defaultUnit: UnitOfMeasure.KILOGRAM,
        unitSize: null,
        approxWeight: 1560,
        approxWeightSetBy: 'ADMIN',
      });
    });

    it('saves a UNIT piece of 580 g with no size', async () => {
      const salad = await product({
        name: { es: 'Ensaladilla rusa mediana' },
        defaultUnit: UnitOfMeasure.UNIT,
        approxWeight: 580,
      });
      expect(salad).toMatchObject({
        defaultUnit: UnitOfMeasure.UNIT,
        unitSize: null,
        approxWeight: 580,
      });
    });

    it("saves the harvester's weight as SOURCE when the create says so", async () => {
      const piece = await product(
        { approxWeight: 1540, approxWeightSetBy: 'SOURCE' },
        HARVESTER
      );
      expect(piece.approxWeightSetBy).toBe('SOURCE');
      expect((await row(piece.id)).approxWeightSetBy).toBe('SOURCE');
    });

    it('names no writer for a create with no weight, whatever it states', async () => {
      const loose = await product({ approxWeightSetBy: 'SOURCE' });
      expect(loose).toMatchObject({
        approxWeight: null,
        approxWeightSetBy: null,
      });
    });

    it('refuses GRAM 1560 with a weight, and names the weight, the size and the unit', async () => {
      const error = await refused(
        product({
          defaultUnit: UnitOfMeasure.GRAM,
          unitSize: 1560,
          approxWeight: 1560,
        }),
        ItemApproxWeightBesideSizeException
      );
      expect(error.details).toEqual({
        [ITEM_APPROX_WEIGHT_DETAIL]: 1560,
        [ITEM_UNIT_SIZE_DETAIL]: 1560,
        defaultUnit: UnitOfMeasure.GRAM,
      });
    });

    it('refuses the same in a bulk create, naming the entry', async () => {
      const error = await refused(
        items.createMany({
          userId: HARVESTER,
          items: [
            {
              name: { es: 'Uno' },
              categoryIds: [categoryId('milk')],
              defaultUnit: UnitOfMeasure.KILOGRAM,
              approxWeight: 900,
              approxWeightSetBy: 'SOURCE',
            },
            {
              name: { es: 'Dos' },
              categoryIds: [categoryId('milk')],
              defaultUnit: UnitOfMeasure.GRAM,
              unitSize: 500,
              approxWeight: 500,
            },
          ],
        }),
        ItemApproxWeightBesideSizeException
      );
      expect(error.details).toMatchObject({ index: 1 });
    });

    it('still answers item_kilogram_has_size for a KILOGRAM with a size', async () => {
      await refused(
        product({ unitSize: 1.56, approxWeight: 1560 }),
        ItemKilogramHasSizeException
      );
    });

    it('refuses an edit that sets a size on a piece without approxWeight null', async () => {
      const piece = await product({ approxWeight: 1560 });
      await refused(
        items.update({
          ...AS_OPERATOR,
          itemId: piece.id,
          defaultUnit: UnitOfMeasure.GRAM,
          unitSize: 1560,
        }),
        ItemApproxWeightBesideSizeException
      );
      expect((await row(piece.id)).unitSize).toBeNull();
    });

    it('saves the same edit when it also sends approxWeight null', async () => {
      const piece = await product({ approxWeight: 1560 });
      const pack = await items.update({
        ...AS_OPERATOR,
        itemId: piece.id,
        defaultUnit: UnitOfMeasure.GRAM,
        unitSize: 1560,
        approxWeight: null,
      });
      expect(pack).toMatchObject({
        unitSize: 1560,
        approxWeight: null,
        approxWeightSetBy: null,
      });
    });

    it('saves an edit of defaultUnit from KILOGRAM to UNIT on a piece', async () => {
      const piece = await product({ approxWeight: 240 });
      const fuet = await items.update({
        ...AS_OPERATOR,
        itemId: piece.id,
        defaultUnit: UnitOfMeasure.UNIT,
      });
      expect(fuet).toMatchObject({
        defaultUnit: UnitOfMeasure.UNIT,
        approxWeight: 240,
      });
    });

    it("writes a person's weight as ADMIN, in a batch too", async () => {
      const piece = await product(
        { approxWeight: 1540, approxWeightSetBy: 'SOURCE' },
        HARVESTER
      );
      const [edited] = (
        await items.updateMany({
          ...AS_OPERATOR,
          items: [{ itemId: piece.id, approxWeight: 1560 }],
        })
      ).items;
      expect(edited).toMatchObject({
        approxWeight: 1560,
        approxWeightSetBy: 'ADMIN',
      });
    });

    it('compares the weight an edit expects', async () => {
      const piece = await product({ approxWeight: 1560 });
      await expect(
        items.update({
          ...AS_OPERATOR,
          itemId: piece.id,
          name: { es: 'Queso viejo' },
          expect: { approxWeight: 395 },
        })
      ).rejects.toMatchObject({ code: 'item_expectation_failed' });
      await expect(
        items.update({
          ...AS_OPERATOR,
          itemId: piece.id,
          name: { es: 'Queso viejo' },
          expect: { approxWeight: 1560 },
        })
      ).resolves.toMatchObject({ name: { es: 'Queso viejo' } });
    });
  });

  describe("a service states a run's weight on an edit (section 7)", () => {
    it('converts a sized piece in one edit and one audit row, as SOURCE', async () => {
      const piece = await product({
        defaultUnit: UnitOfMeasure.GRAM,
        unitSize: 1560,
      });
      const converted = await items.update({
        userId: HARVESTER,
        itemId: piece.id,
        defaultUnit: UnitOfMeasure.KILOGRAM,
        unitSize: null,
        approxWeight: 1560,
        approxWeightSetBy: 'SOURCE',
        expect: {
          defaultUnit: UnitOfMeasure.GRAM,
          unitSize: 1560,
          approxWeight: null,
        },
      });
      expect(converted).toMatchObject({
        defaultUnit: UnitOfMeasure.KILOGRAM,
        unitSize: null,
        approxWeight: 1560,
        approxWeightSetBy: 'SOURCE',
      });
      const saved = await row(piece.id);
      expect(saved.approxWeightSetBy).toBe('SOURCE');
      const history = await dataSource.getRepository(CatalogAudit).find({
        where: {
          entity: 'items',
          entityId: piece.id,
          action: AuditAction.UPDATE,
        },
      });
      expect(history).toHaveLength(1);
      expect(history[0]).toMatchObject({
        actorId: HARVESTER,
        after: {
          defaultUnit: UnitOfMeasure.KILOGRAM,
          unitSize: null,
          approxWeight: 1560,
          approxWeightSetBy: 'SOURCE',
        },
      });
      // A run may move it afterwards, which is why the task states SOURCE.
      expect(
        (
          await items.setApproxWeights({
            userId: HARVESTER,
            entries: [{ itemId: piece.id, approxWeight: 1580 }],
          })
        ).written
      ).toBe(1);
    });

    it('writes ADMIN when a service leaves the field out', async () => {
      const piece = await product();
      await items.update({
        userId: HARVESTER,
        itemId: piece.id,
        approxWeight: 1560,
      });
      expect((await row(piece.id)).approxWeightSetBy).toBe('ADMIN');
    });

    it("refuses a service's SOURCE weight over a person's, on an edit and a batch, and keeps the person's", async () => {
      const piece = await product({
        defaultUnit: UnitOfMeasure.KILOGRAM,
        unitSize: null,
        approxWeight: 1560,
      });
      expect((await row(piece.id)).approxWeightSetBy).toBe('ADMIN');
      await refused(
        items.update({
          userId: HARVESTER,
          itemId: piece.id,
          approxWeight: 1580,
          approxWeightSetBy: 'SOURCE',
        }),
        ForbiddenException
      );
      await refused(
        items.updateMany({
          userId: HARVESTER,
          items: [
            {
              itemId: piece.id,
              approxWeight: 1580,
              approxWeightSetBy: 'SOURCE',
            },
          ],
        }),
        ForbiddenException
      );
      const kept = await row(piece.id);
      expect(Number(kept.approxWeight)).toBe(1560);
      expect(kept.approxWeightSetBy).toBe('ADMIN');
    });

    it('refuses SOURCE from an operator on an edit, a batch and a create, and writes nothing', async () => {
      const piece = await product();
      await refused(
        operator.update({
          userId: OPERATOR,
          itemId: piece.id,
          approxWeight: 1560,
          approxWeightSetBy: 'SOURCE',
        }),
        ForbiddenException
      );
      await refused(
        operator.updateMany({
          userId: OPERATOR,
          items: [
            {
              itemId: piece.id,
              approxWeight: 1560,
              approxWeightSetBy: 'SOURCE',
            },
          ],
        }),
        ForbiddenException
      );
      expect((await row(piece.id)).approxWeight).toBeNull();
      await refused(
        operator.create({
          userId: OPERATOR,
          name: { es: 'Queso de una persona' },
          categoryIds: [categoryId('milk')],
          defaultUnit: UnitOfMeasure.KILOGRAM,
          approxWeight: 1560,
          approxWeightSetBy: 'SOURCE',
        }),
        ForbiddenException
      );
      // The same edit with the field left out is a person's weight.
      await expect(
        operator.update({
          userId: OPERATOR,
          itemId: piece.id,
          approxWeight: 1560,
        })
      ).resolves.toMatchObject({ approxWeightSetBy: 'ADMIN' });
    });
  });

  describe('item.findCreatedFromEntry (section 7.4)', () => {
    const entry = (n: number) => `chain-0244:2470${n}`;

    it('records the row only in the CREATE audit row, and finds the product by it', async () => {
      const made = await product({ createdFromEntry: entry(1) });
      const [created] = await dataSource.getRepository(CatalogAudit).find({
        where: {
          entity: 'items',
          entityId: made.id,
          action: AuditAction.CREATE,
        },
      });
      expect(created.after).toMatchObject({ createdFromEntry: entry(1) });
      expect('createdFromEntry' in made).toBe(false);

      const found = await items.findCreatedFromEntry({
        userId: HARVESTER,
        createdFromEntry: entry(1),
      });
      expect(found.item?.id).toBe(made.id);
    });

    it('answers null for a row no create named', async () => {
      await product();
      await expect(
        items.findCreatedFromEntry({
          userId: HARVESTER,
          createdFromEntry: entry(9),
        })
      ).resolves.toEqual({ item: null });
    });

    it('answers the oldest of two products created for one row', async () => {
      const first = await product({ createdFromEntry: entry(2) });
      await product({ createdFromEntry: entry(2) });
      const found = await items.findCreatedFromEntry({
        userId: HARVESTER,
        createdFromEntry: entry(2),
      });
      expect(found.item?.id).toBe(first.id);
    });

    it('records it from a bulk create too, per product', async () => {
      const { items: made } = await items.createMany({
        userId: HARVESTER,
        items: [
          {
            name: { es: 'Queso A' },
            categoryIds: [categoryId('milk')],
            defaultUnit: UnitOfMeasure.KILOGRAM,
            createdFromEntry: entry(3),
          },
          {
            name: { es: 'Queso B' },
            categoryIds: [categoryId('milk')],
            defaultUnit: UnitOfMeasure.KILOGRAM,
          },
        ],
      });
      const found = await items.findCreatedFromEntry({
        userId: HARVESTER,
        createdFromEntry: entry(3),
      });
      expect(found.item?.id).toBe(made[0].id);
    });
  });

  describe('item.setApproxWeights (section 3.4)', () => {
    it('writes an empty or SOURCE weight on a product with no size of either unit', async () => {
      const loose = await product();
      const fromRun = await product(
        { approxWeight: 1540, approxWeightSetBy: 'SOURCE' },
        HARVESTER
      );
      const salad = await product({ defaultUnit: UnitOfMeasure.UNIT });

      const result = await items.setApproxWeights({
        userId: HARVESTER,
        entries: [
          { itemId: loose.id, approxWeight: 1560 },
          { itemId: fromRun.id, approxWeight: 1560 },
          { itemId: salad.id, approxWeight: 580 },
        ],
      });

      expect(result).toEqual({
        written: 3,
        skippedHasSize: 0,
        skippedSetByAdmin: 0,
      });
      for (const [id, weight] of [
        [loose.id, 1560],
        [fromRun.id, 1560],
        [salad.id, 580],
      ] as const) {
        const saved = await row(id);
        expect(Number(saved.approxWeight)).toBe(weight);
        expect(saved.approxWeightSetBy).toBe('SOURCE');
      }
      // It does not change the unit.
      expect((await row(salad.id)).defaultUnit).toBe(UnitOfMeasure.UNIT);
    });

    it('skips a weight a person typed, and a sized product, and counts both', async () => {
      const typed = await product({ approxWeight: 1500 });
      const pack = await product({
        defaultUnit: UnitOfMeasure.GRAM,
        unitSize: 1560,
      });
      const gone = '99999999-9999-4999-8999-999999999999';

      const result = await items.setApproxWeights({
        userId: HARVESTER,
        entries: [
          { itemId: typed.id, approxWeight: 1560 },
          { itemId: pack.id, approxWeight: 1560 },
          { itemId: gone, approxWeight: 1560 },
        ],
      });

      expect(result).toEqual({
        written: 0,
        skippedHasSize: 1,
        skippedSetByAdmin: 1,
      });
      expect(Number((await row(typed.id)).approxWeight)).toBe(1500);
      expect((await row(typed.id)).approxWeightSetBy).toBe('ADMIN');
      expect((await row(pack.id)).approxWeight).toBeNull();
    });

    it('writes one audit row per change, as the harvester, and none for the same weight', async () => {
      const piece = await product();
      const fill = (approxWeight: number) =>
        items.setApproxWeights({
          userId: HARVESTER,
          entries: [{ itemId: piece.id, approxWeight }],
        });
      expect((await fill(1560)).written).toBe(1);
      expect((await fill(1560)).written).toBe(0);
      expect((await fill(1580)).written).toBe(1);

      const history = await dataSource.getRepository(CatalogAudit).find({
        where: {
          entity: 'items',
          entityId: piece.id,
          action: AuditAction.UPDATE,
        },
        order: { at: 'ASC' },
      });
      expect(history).toHaveLength(2);
      expect(history[0]).toMatchObject({
        actorId: HARVESTER,
        before: { approxWeight: null, approxWeightSetBy: null },
        after: { approxWeight: 1560, approxWeightSetBy: 'SOURCE' },
      });
      expect(history[1]).toMatchObject({
        before: { approxWeight: 1560 },
        after: { approxWeight: 1580 },
      });
    });

    it('refuses a product named twice, and writes nothing', async () => {
      const piece = await product();
      await refused(
        items.setApproxWeights({
          userId: HARVESTER,
          entries: [
            { itemId: piece.id, approxWeight: 1560 },
            { itemId: piece.id, approxWeight: 395 },
          ],
        }),
        ValidationException
      );
      expect((await row(piece.id)).approxWeight).toBeNull();
    });

    it('lets a weight a person handed back be filled by the next run', async () => {
      const piece = await product({ approxWeight: 1500 });
      await items.update({
        ...AS_OPERATOR,
        itemId: piece.id,
        approxWeight: null,
      });
      expect(
        (
          await items.setApproxWeights({
            userId: HARVESTER,
            entries: [{ itemId: piece.id, approxWeight: 1560 }],
          })
        ).written
      ).toBe(1);
    });
  });

  describe('the piece price on a priced read (section 3.3)', () => {
    it('answers 20.94 for the cheese of 1560 g at 13.42 a kilo, and the kilo stays the price', async () => {
      const cheese = await product({ approxWeight: 1560 });
      const salad = await product({
        defaultUnit: UnitOfMeasure.UNIT,
        approxWeight: 580,
      });
      for (const [itemId, price] of [
        [cheese.id, 13.42],
        [salad.id, 6.5],
      ] as const) {
        await prices.addBatch({
          userId: HARVESTER,
          priceScopeId: nationalId,
          sourceKind: PriceSourceKind.OFFICIAL_API,
          sourceRunId: RUN,
          entries: [
            {
              itemId,
              price,
              currency: 'EUR',
              observedAt: new Date(Date.now() - 60_000).toISOString(),
            },
          ],
        });
      }

      const best = await items.getMany({
        ids: [cheese.id, salad.id],
        priceScopeIds: [nationalId],
      });
      const all = await items.getMany({
        ids: [cheese.id],
        priceScopeIds: [nationalId],
        offers: 'all',
      });

      const byId = new Map(best.items.map((item) => [item.id, item]));
      expect(byId.get(cheese.id)?.bestOffer).toMatchObject({
        price: 13.42,
        piecePrice: 20.94,
      });
      expect(byId.get(salad.id)?.bestOffer).toMatchObject({
        price: 6.5,
        piecePrice: null,
      });
      expect(all.items[0].offers?.[0]).toMatchObject({ piecePrice: 20.94 });
    });
  });

  describe('a merge of two pieces (section 3.5)', () => {
    it("refuses two kilo pieces of different weights, and keeps the survivor's weight when allowed", async () => {
      const small = await product({ approxWeight: 395 });
      const large = await product(
        { approxWeight: 1560, approxWeightSetBy: 'SOURCE' },
        HARVESTER
      );

      const error = await refused(
        operator.merge({
          ...AS_OPERATOR,
          itemId: small.id,
          intoItemId: large.id,
        }),
        ItemMergeFormatDiffersException
      );
      expect(error.details).toEqual({
        item: {
          unitSize: null,
          defaultUnit: UnitOfMeasure.KILOGRAM,
          approxWeight: 395,
        },
        into: {
          unitSize: null,
          defaultUnit: UnitOfMeasure.KILOGRAM,
          approxWeight: 1560,
        },
      });

      const done = await operator.merge({
        ...AS_OPERATOR,
        itemId: small.id,
        intoItemId: large.id,
        allowFormatDifference: true,
      });
      expect(done.mergedIntoId).toBe(large.id);
      const survivor = await row(large.id);
      expect(Number(survivor.approxWeight)).toBe(1560);
      expect(survivor.approxWeightSetBy).toBe('SOURCE');
      // The merged row keeps its own weight, as it keeps its size.
      expect(Number((await row(small.id)).approxWeight)).toBe(395);
    });

    it('refuses a piece with a weight beside a product sold by the kilo with none', async () => {
      const piece = await product({ approxWeight: 1560 });
      const loose = await product();
      await refused(
        operator.merge({
          ...AS_OPERATOR,
          itemId: piece.id,
          intoItemId: loose.id,
        }),
        ItemMergeFormatDiffersException
      );
    });
  });
});
