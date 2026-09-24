import { JwtService } from '@nestjs/jwt';
import { ItemCategory, UnitOfMeasure } from '@portfolio/luna-shopper/contracts';
import {
  describeIntegration,
  requiredEnv,
} from '@portfolio/luna-shopper/test-fixtures/jest';
import { DataSource, Repository } from 'typeorm';
import { CATALOG_MIGRATIONS } from '../db/migrations';
import {
  Brand,
  CATALOG_ENTITIES,
  CatalogAudit,
  Item,
  ProductGroup,
  SupermarketItem,
} from '../entities';
import { CatalogEventsPublisher } from '../events/catalog-events.publisher';
import { CatalogAuditService } from './catalog-audit.service';
import { ItemService } from './item.service';
import { PlatformAdminService } from './platform-admin.service';
import { ProductGroupService } from './product-group.service';

/**
 * The pack count against real Postgres (plan 0162, sections 2 and 3).
 *
 * Two claims a double cannot check: the column refuses a count outside 2 to
 * 1000, and the fill writes in one statement only where the count is null. Both
 * live in SQL, so a fake repository would agree with whatever the service said.
 *
 * It works in a scratch schema of its own and drops it afterwards.
 *
 *   LUNA_INTEGRATION=1 CATALOG_DB_URL=postgres://luna_catalog:luna_catalog@localhost:<port>/luna_catalog \
 *     npx nx run luna-shopper-backend-catalog:test-integration --testFile=item-pack-count
 */
const SCHEMA = 'plan0162_pack_count_test';

/** The harvester, through the service branch of the gate. */
const HARVESTER = '11111111-1111-4111-8111-111111111111';

describeIntegration('the pack count (real Postgres)', () => {
  let dataSource: DataSource;
  let rows: Repository<Item>;
  let trail: Repository<CatalogAudit>;
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

    const admin = new PlatformAdminService(new JwtService(), {
      getOrThrow: () => ({
        adminJwtPublicKey: '',
        serviceActorIds: [HARVESTER],
      }),
    } as never);
    const events = {
      itemGroupChanged: jest.fn(),
      productGroupDeleted: jest.fn(),
    } as unknown as CatalogEventsPublisher;
    const audit = new CatalogAuditService(dataSource);
    const groups = new ProductGroupService(
      dataSource.getRepository(ProductGroup),
      admin,
      audit,
      events
    );
    rows = dataSource.getRepository(Item);
    trail = dataSource.getRepository(CatalogAudit);
    items = new ItemService(
      rows,
      dataSource.getRepository(ProductGroup),
      dataSource.getRepository(SupermarketItem),
      dataSource.getRepository(Brand),
      groups,
      admin,
      audit,
      events
    );
  }, 120_000);

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
      await dataSource.destroy();
    }
  });

  function newItem(packCount?: number | null) {
    return items.create({
      userId: HARVESTER,
      name: { es: 'Leche entera' },
      category: ItemCategory.DAIRY,
      defaultUnit: UnitOfMeasure.LITER,
      unitSize: 6,
      ...(packCount === undefined ? {} : { packCount }),
    });
  }

  describe('the column', () => {
    it('holds a count from 2 to 1000, and null', async () => {
      expect((await newItem(2)).packCount).toBe(2);
      expect((await newItem(1000)).packCount).toBe(1000);
      expect((await newItem()).packCount).toBeNull();
    });

    it('refuses 1, 0 and a count past 1000 (chk_items_pack_count)', async () => {
      const item = await newItem();
      for (const count of [1, 0, 1001]) {
        await expect(
          dataSource.query(
            `UPDATE "items" SET "packCount" = $1 WHERE "id" = $2`,
            [count, item.id]
          )
        ).rejects.toThrow(/chk_items_pack_count/);
      }
    });
  });

  describe('item.fillPackCounts', () => {
    it('fills a null count, keeps a set one, and counts only what it wrote', async () => {
      const empty = await newItem();
      const corrected = await newItem(4);
      const gone = '99999999-9999-4999-8999-999999999999';

      const result = await items.fillPackCounts({
        userId: HARVESTER,
        entries: [
          { itemId: empty.id, packCount: 6 },
          { itemId: corrected.id, packCount: 6 },
          { itemId: gone, packCount: 6 },
        ],
      });

      expect(result).toEqual({ written: 1 });
      expect(
        (await items.get({ userId: HARVESTER, itemId: empty.id })).packCount
      ).toBe(6);
      // A person's correction survives the run.
      expect(
        (await items.get({ userId: HARVESTER, itemId: corrected.id })).packCount
      ).toBe(4);
    });

    it('records what it wrote in the audit trail, as the harvester', async () => {
      const empty = await newItem();
      await items.fillPackCounts({
        userId: HARVESTER,
        entries: [{ itemId: empty.id, packCount: 12 }],
      });
      const history = await trail.find({
        where: { entity: 'items', entityId: empty.id },
        order: { at: 'ASC' },
      });
      expect(history.at(-1)).toMatchObject({
        actorId: HARVESTER,
        before: { packCount: null },
        after: { packCount: 12 },
      });
    });

    it('writes nothing a second time over the same product', async () => {
      const empty = await newItem();
      const entries = [{ itemId: empty.id, packCount: 6 }];
      expect(
        await items.fillPackCounts({ userId: HARVESTER, entries })
      ).toEqual({ written: 1 });
      expect(
        await items.fillPackCounts({
          userId: HARVESTER,
          entries: [{ itemId: empty.id, packCount: 8 }],
        })
      ).toEqual({ written: 0 });
      expect((await rows.findOneByOrFail({ id: empty.id })).packCount).toBe(6);
    });

    it('leaves a count an update cleared open to the next fill', async () => {
      const item = await newItem(6);
      await items.update({
        userId: HARVESTER,
        itemId: item.id,
        packCount: null,
      });
      expect(
        await items.fillPackCounts({
          userId: HARVESTER,
          entries: [{ itemId: item.id, packCount: 3 }],
        })
      ).toEqual({ written: 1 });
    });
  });
});
