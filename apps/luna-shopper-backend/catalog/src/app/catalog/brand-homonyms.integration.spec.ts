import { JwtService } from '@nestjs/jwt';
import { UnitOfMeasure } from '@portfolio/luna-shopper/contracts';
import {
  BrandHomonymIsOwnKeyException,
  BrandLabelEmptyException,
  NotFoundException,
} from '@portfolio/luna-shopper/platform';
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
  ProductGroup,
  SupermarketItem,
} from '../entities';
import type { CatalogEventsPublisher } from '../events/catalog-events.publisher';
import { BrandService } from './brand.service';
import { CatalogAuditService } from './catalog-audit.service';
import { CategoryService } from './category.service';
import { itemEanStoreOf } from './item-ean.store';
import { ItemService } from './item.service';
import { PlatformAdminService } from './platform-admin.service';
import { ProductGroupService } from './product-group.service';

/**
 * A printed key that names more than one brand, against real Postgres
 * (plan 0178).
 *
 * What is asserted here is what a mocked repository cannot say: that the brand
 * key stays unique and stays its own brand's while a second brand answers to
 * it, that a homonym moves no product, that the same pair written twice is one
 * row, and that the read answers the key's own brand first through a link.
 *
 * It works in a scratch schema of its own and drops it afterwards.
 *
 *   docker run -d --name tmp-pg-catalog -e POSTGRES_PASSWORD=pw \
 *     -e POSTGRES_DB=catalog -p 45991:5432 postgres:16-alpine
 *   LUNA_INTEGRATION=1 CATALOG_DB_URL=postgres://postgres:pw@localhost:45991/catalog \
 *     npx nx run luna-shopper-backend-catalog:test-integration
 */
const SCHEMA = 'plan0178_brand_homonyms_test';

const OWNER = '44444444-4444-4444-8444-444444444444';
const NOBODY = '99999999-9999-4999-8999-999999999999';

describeIntegration(
  'a printed key that names more than one brand (real Postgres)',
  () => {
    let dataSource: DataSource;
    let brands: BrandService;
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
          serviceActorIds: [OWNER],
        }),
      } as never);
      const events = {
        itemGroupChanged: jest.fn(),
        productGroupDeleted: jest.fn(),
      } as unknown as CatalogEventsPublisher;
      const audit = new CatalogAuditService(dataSource);

      brands = new BrandService(dataSource.getRepository(Brand), admin, audit);
      items = new ItemService(
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
        itemEanStoreOf(dataSource)
      );
    }, 180_000);

    afterAll(async () => {
      if (dataSource?.isInitialized) {
        await dataSource.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
        await dataSource.destroy();
      }
    });

    beforeEach(async () => {
      await dataSource.query(`DELETE FROM "catalog_audit"`);
      await dataSource.query(`DELETE FROM "items"`);
      await dataSource.query(`DELETE FROM "brand_homonyms"`);
      await dataSource.query(`UPDATE "brands" SET "canonicalBrandId" = NULL`);
      await dataSource.query(`DELETE FROM "brands"`);
    });

    const register = (label: string, canonicalBrandId?: string) =>
      brands.create({ userId: OWNER, label, canonicalBrandId });

    const add = (brandId: string, printedKey: string) =>
      brands.addHomonym({ userId: OWNER, brandId, printedKey });

    const remove = (brandId: string, printedKey: string) =>
      brands.removeHomonym({ userId: OWNER, brandId, printedKey });

    const matchesOf = async (...keys: string[]) =>
      (await brands.matches({ userId: OWNER, keys })).matches;

    it('refuses a homonym whose key equals the brand’s own key', async () => {
      const poseidon = await register('Poseidon');

      // Every spelling of the brand's own name makes the brand's own key.
      for (const printed of ['poseidon', 'Poseidón', ' POSEIDON ']) {
        await expect(add(poseidon.id, printed)).rejects.toBeInstanceOf(
          BrandHomonymIsOwnKeyException
        );
      }
      const [{ count }] = await dataSource.query(
        `SELECT count(*)::int AS "count" FROM "brand_homonyms"`
      );
      expect(count).toBe(0);
    }, 180_000);

    it('refuses a printed key with no letter or digit, and a brand that does not exist', async () => {
      const food = await register('Poseidon Food');

      await expect(add(food.id, '---')).rejects.toBeInstanceOf(
        BrandLabelEmptyException
      );
      await expect(add(NOBODY, 'poseidon')).rejects.toBeInstanceOf(
        NotFoundException
      );
    }, 180_000);

    it('lets one printed key name two brands, the key’s own brand first', async () => {
      const poseidon = await register('Poseidon');
      const food = await register('Poseidon Food');

      const view = await add(food.id, 'Poseidón');

      // Keyed with the function every brand is keyed with.
      expect(view).toEqual({ brandId: food.id, printedKeys: ['poseidon'] });
      expect(await matchesOf('poseidon')).toEqual([
        {
          printedKey: 'poseidon',
          brands: [
            {
              brandId: poseidon.id,
              key: 'poseidon',
              label: 'Poseidon',
              privateLabelSupermarketId: null,
              printedAs: null,
            },
            {
              brandId: food.id,
              key: 'poseidonfood',
              label: 'Poseidon Food',
              privateLabelSupermarketId: null,
              printedAs: null,
            },
          ],
        },
      ]);
    }, 180_000);

    it('leaves the brand key unique, and both brands holding the key they had', async () => {
      const poseidon = await register('Poseidon');
      const food = await register('Poseidon Food');
      await add(food.id, 'poseidon');

      const rows: { id: string; key: string }[] = await dataSource.query(
        `SELECT "id", "key" FROM "brands" ORDER BY "key" ASC`
      );
      expect(rows).toEqual([
        { id: poseidon.id, key: 'poseidon' },
        { id: food.id, key: 'poseidonfood' },
      ]);
      // A homonym is an extra pointer, not a second key: the registry still
      // refuses a second brand on the key.
      await expect(
        dataSource.query(
          `INSERT INTO "brands" ("key", "label") VALUES ('poseidon', 'Otro')`
        )
      ).rejects.toThrow(/uq_brands_key/);
    }, 180_000);

    it('moves no product: the ones under the key’s own brand stay there', async () => {
      const poseidon = await register('Poseidon');
      const food = await register('Poseidon Food');
      const cologne = await items.create({
        userId: OWNER,
        name: { es: 'Colonia' },
        brand: 'Poseidón',
        categoryIds: [categoryId('uncategorised')],
        defaultUnit: UnitOfMeasure.UNIT,
      });

      await add(food.id, 'poseidon');

      const [row] = await dataSource.query(
        `SELECT "brand", "brandKey", "brandId" FROM "items" WHERE "id" = $1`,
        [cologne.id]
      );
      expect(row).toEqual({
        brand: 'Poseidon',
        brandKey: 'poseidon',
        brandId: poseidon.id,
      });
      expect(
        (await brands.get({ userId: OWNER, brandId: food.id })).itemCount
      ).toBe(0);
    }, 180_000);

    it('writes the same homonym once, and answers the list both times', async () => {
      const food = await register('Poseidon Food');

      await add(food.id, 'poseidon');
      const again = await add(food.id, 'POSEIDÓN');

      expect(again.printedKeys).toEqual(['poseidon']);
      const [{ count }] = await dataSource.query(
        `SELECT count(*)::int AS "count" FROM "brand_homonyms"`
      );
      expect(count).toBe(1);
      // One audit row for the one write that changed something.
      const audit: { action: string }[] = await dataSource.query(
        `SELECT "action" FROM "catalog_audit" WHERE "entity" = 'brand_homonyms'`
      );
      expect(audit).toEqual([{ action: 'CREATE' }]);
    }, 180_000);

    it('answers a brand’s homonyms sorted, and several brands for one key in label order', async () => {
      await register('Royal');
      const smoked = await register('Royal Ahumados');
      const desserts = await register('Royal Postres');

      await add(smoked.id, 'royal');
      await add(desserts.id, 'royal');
      const view = await add(desserts.id, 'gelatina royal');

      expect(view.printedKeys).toEqual(['gelatinaroyal', 'royal']);
      const [match] = await matchesOf('royal');
      expect(match.brands.map((brand) => brand.label)).toEqual([
        'Royal',
        'Royal Ahumados',
        'Royal Postres',
      ]);
    }, 180_000);

    it('answers a homonym on a key no brand holds as the only brand that key names', async () => {
      const food = await register('Poseidon Food');
      await add(food.id, 'salmones del norte');

      expect(await matchesOf('salmonesdelnorte', 'nadie')).toEqual([
        {
          printedKey: 'salmonesdelnorte',
          brands: [expect.objectContaining({ brandId: food.id })],
        },
      ]);
    }, 180_000);

    it('resolves both ends through a link, and answers one brand once', async () => {
      const deborah = await register('Deborah');
      const spelling = await register('DEBORAH 48H', deborah.id);
      const poseidon = await register('Poseidon');
      // A homonym registered on the spelling answers the brand it spells.
      await add(spelling.id, 'poseidon');
      // And one that points a spelling's own key back at its canonical brand
      // is the same brand twice, answered once.
      await add(deborah.id, 'deborah48h');

      expect(await matchesOf('poseidon', 'deborah48h')).toEqual([
        {
          printedKey: 'poseidon',
          brands: [
            expect.objectContaining({ brandId: poseidon.id, printedAs: null }),
            {
              brandId: deborah.id,
              key: 'deborah',
              label: 'Deborah',
              privateLabelSupermarketId: null,
              printedAs: null,
            },
          ],
        },
        {
          printedKey: 'deborah48h',
          brands: [
            {
              brandId: deborah.id,
              key: 'deborah',
              label: 'Deborah',
              privateLabelSupermarketId: null,
              // The key's own brand is a spelling, and the spelling is kept.
              printedAs: 'DEBORAH 48H',
            },
          ],
        },
      ]);
    }, 180_000);

    it('removes a homonym and nothing else, and answers 404 for one that is not there', async () => {
      const poseidon = await register('Poseidon');
      const food = await register('Poseidon Food');
      await add(food.id, 'poseidon');

      expect(await remove(food.id, 'Poseidón')).toEqual({
        brandId: food.id,
        printedKeys: [],
      });
      expect((await matchesOf('poseidon'))[0].brands).toEqual([
        expect.objectContaining({ brandId: poseidon.id }),
      ]);
      const [{ count }] = await dataSource.query(
        `SELECT count(*)::int AS "count" FROM "brands"`
      );
      expect(count).toBe(2);

      await expect(remove(food.id, 'poseidon')).rejects.toBeInstanceOf(
        NotFoundException
      );
    }, 180_000);

    it('takes its homonyms with a spelling that is deleted', async () => {
      const deborah = await register('Deborah');
      const spelling = await register('DEBORAH 48H', deborah.id);
      await add(spelling.id, 'poseidon');

      await brands.remove({ userId: OWNER, brandId: spelling.id });

      expect(await matchesOf('poseidon')).toEqual([]);
    }, 180_000);

    it('answers nothing for no keys, without a query', async () => {
      expect(await matchesOf()).toEqual([]);
    }, 180_000);
  }
);
