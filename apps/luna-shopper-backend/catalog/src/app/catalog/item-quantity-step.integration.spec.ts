import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  UnitOfMeasure,
  type CreateItemRequest,
} from '@portfolio/luna-shopper/contracts';
import { ItemQuantityStepNotAllowedException } from '@portfolio/luna-shopper/platform';
import {
  describeIntegration,
  requiredEnv,
} from '@portfolio/luna-shopper/test-fixtures/jest';
import { DataSource } from 'typeorm';
import { CATALOG_MIGRATIONS } from '../db/migrations';
import { ItemQuantityStep1759500000000 } from '../db/migrations/1759500000000-ItemQuantityStep';
import { categoryId } from '../db/taxonomy/ids';
import {
  AuditAction,
  Brand,
  CATALOG_ENTITIES,
  CatalogAudit,
  Category,
  Item,
  ProductGroup,
  SupermarketItem,
} from '../entities';
import { CatalogEventsPublisher } from '../events/catalog-events.publisher';
import { CatalogAuditService } from './catalog-audit.service';
import { CategoryService } from './category.service';
import { itemEanStoreOf } from './item-ean.store';
import { ItemService } from './item.service';
import { PlatformAdminService } from './platform-admin.service';
import { ProductGroupService } from './product-group.service';

/**
 * The step of a product sold by the kilo or the litre against real Postgres
 * (plan 0261).
 *
 * What only the database can say: the migration up and down, the two checks
 * refusing what the write rule refuses, the rule answering before them on
 * every write, the audit row of a change of step, and the weight fill's
 * statement skipping a stepped product and counting it.
 *
 * It works in a scratch schema of its own and drops it afterwards.
 *
 *   bash k8s/e2e/luna-shopper-backend/luna-slot.sh --ephemeral --up 7 --services catalog
 *   LUNA_INTEGRATION=1 CATALOG_DB_URL=postgres://luna_catalog:luna_catalog@localhost:<port>/luna_catalog \
 *     npx nx run luna-shopper-backend-catalog:test-integration --testFile=item-quantity-step.integration.spec.ts
 */
const SCHEMA = 'plan0261_quantity_step_test';

/** The harvester and the operator, both service actors of the real gate. */
const HARVESTER = '11111111-1111-4111-8111-111111111111';
const OPERATOR = '26126126-2612-4612-8612-261261261261';

describeIntegration('the step of a product (real Postgres)', () => {
  let dataSource: DataSource;
  let items: ItemService;

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
    items = new ItemService(
      dataSource.getRepository(Item),
      dataSource.getRepository(ProductGroup),
      dataSource.getRepository(SupermarketItem),
      dataSource.getRepository(Brand),
      new ProductGroupService(
        dataSource.getRepository(ProductGroup),
        gate,
        audit,
        events
      ),
      gate,
      audit,
      events,
      new CategoryService(dataSource.getRepository(Category), gate, audit),
      itemEanStoreOf(dataSource)
    );
  }, 120_000);

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
      await dataSource.destroy();
    }
  });

  /** A chicken, sold by the kilo, unless told otherwise. */
  function product(extra: Partial<Omit<CreateItemRequest, 'userId'>> = {}) {
    return items.create({
      userId: OPERATOR,
      name: { es: 'Pollo entero' },
      categoryIds: [categoryId('milk')],
      defaultUnit: UnitOfMeasure.KILOGRAM,
      ...extra,
    });
  }

  const row = (id: string) =>
    dataSource.getRepository(Item).findOneByOrFail({ id });

  async function refused(work: Promise<unknown>) {
    const error = await work.then(
      () => {
        throw new Error('expected the call to be refused');
      },
      (caught: unknown) => caught
    );
    expect(error).toBeInstanceOf(ItemQuantityStepNotAllowedException);
    return error as ItemQuantityStepNotAllowedException;
  }

  describe('the migration (section 2.1)', () => {
    async function columns(): Promise<string[]> {
      const found = (await dataSource.query(
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema = $1 AND table_name = 'items'
            AND column_name = 'quantityStep'`,
        [SCHEMA]
      )) as { column_name: string }[];
      return found.map((r) => r.column_name);
    }

    async function checks(): Promise<string[]> {
      const found = (await dataSource.query(
        `SELECT c.conname FROM pg_constraint c
           JOIN pg_namespace n ON n.oid = c.connamespace
          WHERE n.nspname = $1 AND c.conname LIKE 'item_quantity_step_%'
          ORDER BY c.conname`,
        [SCHEMA]
      )) as { conname: string }[];
      return found.map((r) => r.conname);
    }

    it('adds the column null on every existing row, and down removes it and its checks', async () => {
      const before = await product({ name: { es: 'Anterior' } });
      expect(await columns()).toEqual(['quantityStep']);
      expect(await checks()).toEqual([
        'item_quantity_step_allowed',
        'item_quantity_step_on_loose',
      ]);
      expect((await row(before.id)).quantityStep).toBeNull();

      // Down to this migration, whatever lands after it.
      const name = new ItemQuantityStep1759500000000().name;
      for (;;) {
        const ran = (await dataSource.query(
          `SELECT name FROM "${SCHEMA}".migrations ORDER BY id DESC LIMIT 1`
        )) as { name: string }[];
        await dataSource.undoLastMigration();
        if (ran[0]?.name === name) {
          break;
        }
      }
      expect(await columns()).toEqual([]);
      expect(await checks()).toEqual([]);

      await dataSource.runMigrations();
      expect(await columns()).toEqual(['quantityStep']);
      expect((await row(before.id)).quantityStep).toBeNull();
    });

    it('refuses a step off the list in raw SQL (item_quantity_step_allowed)', async () => {
      const chicken = await product();
      await expect(
        dataSource.query(
          `UPDATE "items" SET "quantityStep" = 30 WHERE "id" = $1`,
          [chicken.id]
        )
      ).rejects.toThrow(/item_quantity_step_allowed/);
    });

    it('refuses a step on a pack and on a kilo piece in raw SQL (item_quantity_step_on_loose)', async () => {
      const pack = await product({
        name: { es: 'Arroz' },
        defaultUnit: UnitOfMeasure.GRAM,
        unitSize: 1000,
      });
      await expect(
        dataSource.query(
          `UPDATE "items" SET "quantityStep" = 100 WHERE "id" = $1`,
          [pack.id]
        )
      ).rejects.toThrow(/item_quantity_step_on_loose/);
      const piece = await product({ approxWeight: 1560 });
      await expect(
        dataSource.query(
          `UPDATE "items" SET "quantityStep" = 100 WHERE "id" = $1`,
          [piece.id]
        )
      ).rejects.toThrow(/item_quantity_step_on_loose/);
    });

    it('lets a step on a legacy product by the litre through in raw SQL', async () => {
      const oil = await product({ name: { es: 'Aceite a granel' } });
      await dataSource.query(
        `UPDATE "items" SET "defaultUnit" = 'LITER', "quantityStep" = 250 WHERE "id" = $1`,
        [oil.id]
      );
      expect((await row(oil.id)).quantityStep).toBe(250);
    });
  });

  describe('the write rule (section 2.2)', () => {
    it('saves a step on a product sold by the kilo and serves it on every read', async () => {
      const chicken = await product({ quantityStep: 100 });
      expect(chicken.quantityStep).toBe(100);
      expect((await row(chicken.id)).quantityStep).toBe(100);
      expect(
        (await items.get({ userId: OPERATOR, itemId: chicken.id })).quantityStep
      ).toBe(100);
      const [many] = (await items.getMany({ ids: [chicken.id] })).items;
      expect(many.quantityStep).toBe(100);
    });

    it('refuses a step on a pack before the database does, with its details', async () => {
      const error = await refused(
        product({
          name: { es: 'Arroz' },
          defaultUnit: UnitOfMeasure.GRAM,
          unitSize: 1000,
          quantityStep: 100,
        })
      );
      expect(error.details).toEqual({
        quantityStep: 100,
        allowed: [1, 5, 10, 25, 50, 100, 200, 250, 500, 1000],
        defaultUnit: UnitOfMeasure.GRAM,
        unitSize: 1000,
        approxWeight: null,
      });
    });

    it('refuses an edit that gives a stepped product a size, and saves it with a null step', async () => {
      const chicken = await product({ quantityStep: 100 });
      const error = await refused(
        items.update({
          userId: OPERATOR,
          itemId: chicken.id,
          defaultUnit: UnitOfMeasure.GRAM,
          unitSize: 1400,
        })
      );
      expect(error.details).toMatchObject({ itemId: chicken.id });
      expect((await row(chicken.id)).quantityStep).toBe(100);

      const saved = await items.update({
        userId: OPERATOR,
        itemId: chicken.id,
        defaultUnit: UnitOfMeasure.GRAM,
        unitSize: 1400,
        quantityStep: null,
      });
      expect(saved).toMatchObject({ unitSize: 1400, quantityStep: null });
    });

    it('refuses a change of unit alone on a stepped product, which only the check would catch', async () => {
      const chicken = await product({ quantityStep: 100 });
      await refused(
        items.update({
          userId: OPERATOR,
          itemId: chicken.id,
          defaultUnit: UnitOfMeasure.UNIT,
        })
      );
      expect((await row(chicken.id)).defaultUnit).toBe(UnitOfMeasure.KILOGRAM);
    });

    it('audits a change of step with its before and after', async () => {
      const chicken = await product();
      await items.update({
        userId: OPERATOR,
        itemId: chicken.id,
        quantityStep: 100,
      });
      await items.update({
        userId: OPERATOR,
        itemId: chicken.id,
        quantityStep: 250,
      });
      const trail = await dataSource.getRepository(CatalogAudit).find({
        where: {
          entityId: chicken.id,
          action: AuditAction.UPDATE,
        },
        order: { at: 'ASC' },
      });
      expect(trail.map((entry) => [entry.before, entry.after])).toEqual([
        [{ quantityStep: null }, { quantityStep: 100 }],
        [{ quantityStep: 100 }, { quantityStep: 250 }],
      ]);
    });
  });

  describe('item.setApproxWeights (section 2.3, S6)', () => {
    it('skips a stepped product and counts it, and writes an unstepped one as before', async () => {
      const stepped = await product({ quantityStep: 100 });
      const loose = await product({ name: { es: 'Pollo troceado' } });

      const result = await items.setApproxWeights({
        userId: HARVESTER,
        entries: [
          { itemId: stepped.id, approxWeight: 1400 },
          { itemId: loose.id, approxWeight: 1400 },
        ],
      });

      expect(result).toEqual({
        written: 1,
        skippedHasSize: 0,
        skippedSetByAdmin: 0,
        skippedHasStep: 1,
      });
      const kept = await row(stepped.id);
      expect(kept.quantityStep).toBe(100);
      expect(kept.approxWeight).toBeNull();
      expect(Number((await row(loose.id)).approxWeight)).toBe(1400);
    });
  });
});
