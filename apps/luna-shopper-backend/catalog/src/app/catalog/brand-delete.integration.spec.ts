import { JwtService } from '@nestjs/jwt';
import { UnitOfMeasure } from '@portfolio/luna-shopper/contracts';
import {
  BrandInUseException,
  ForbiddenException,
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
 * Deleting a brand that is nobody's spelling, against real Postgres (the
 * follow up of plan 0178).
 *
 * What is asserted here is what a mocked repository cannot say. Both foreign
 * keys that point at a brand from a product and from a spelling are
 * `ON DELETE SET NULL`, so a delete that forgot to refuse would not fail: it
 * would unbrand the products and free the spellings without a word. So every
 * refusal below reads the rows afterwards and finds them as they were.
 *
 * It works in a scratch schema of its own and drops it afterwards.
 *
 *   docker run -d --name tmp-pg-catalog -e POSTGRES_PASSWORD=pw \
 *     -e POSTGRES_DB=catalog -p 45991:5432 postgres:16-alpine
 *   LUNA_INTEGRATION=1 CATALOG_DB_URL=postgres://postgres:pw@localhost:45991/catalog \
 *     npx nx run luna-shopper-backend-catalog:test-integration
 */
const SCHEMA = 'plan0178_brand_delete_test';

const OWNER = '44444444-4444-4444-8444-444444444444';
const NOBODY = '99999999-9999-4999-8999-999999999999';
const MISSING = '77777777-7777-4777-8777-777777777777';

describeIntegration(
  'deleting a brand that nothing points at (real Postgres)',
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

    const product = (name: string, brand: string | null) =>
      items.create({
        userId: OWNER,
        name: { es: name },
        brand,
        categoryIds: [categoryId('uncategorised')],
        defaultUnit: UnitOfMeasure.UNIT,
      });

    const remove = (brandId: string, userId = OWNER) =>
      brands.remove({ userId, brandId });

    /** The refusal a delete answered with, or a failure if it answered none. */
    async function refusalOf(brandId: string): Promise<BrandInUseException> {
      try {
        await remove(brandId);
      } catch (error) {
        expect(error).toBeInstanceOf(BrandInUseException);
        return error as BrandInUseException;
      }
      throw new Error('The delete was not refused.');
    }

    async function itemRow(id: string) {
      const [row] = await dataSource.query(
        `SELECT "brand", "brandKey", "brandId" FROM "items" WHERE "id" = $1`,
        [id]
      );
      return row as {
        brand: string | null;
        brandKey: string | null;
        brandId: string | null;
      };
    }

    const brandRows = (): Promise<
      { label: string; key: string; canonicalBrandId: string | null }[]
    > =>
      dataSource.query(
        `SELECT "label", "key", "canonicalBrandId" FROM "brands" ORDER BY "key"`
      );

    const homonymRows = (): Promise<{ printedKey: string }[]> =>
      dataSource.query(
        `SELECT "printedKey" FROM "brand_homonyms" ORDER BY "printedKey"`
      );

    /** The trail since the last reset, without the rows that set the scene. */
    const deletesInTrail = (): Promise<{ entity: string; action: string }[]> =>
      dataSource.query(
        `SELECT "entity", "action" FROM "catalog_audit"
          WHERE "action" = 'DELETE' ORDER BY "entity"`
      );

    it('deletes a brand that nothing points at, with its homonyms', async () => {
      const notABrand = await register('D.O.');
      const other = await register('Prima');
      await brands.addHomonym({
        userId: OWNER,
        brandId: notABrand.id,
        printedKey: 'D.O.P.',
      });
      await brands.addHomonym({
        userId: OWNER,
        brandId: notABrand.id,
        printedKey: 'D.O.Ca.',
      });
      // Another brand's homonym, which must not go with it.
      await brands.addHomonym({
        userId: OWNER,
        brandId: other.id,
        printedKey: 'Primera',
      });
      // A product printed with another brand, which must not move.
      const wine = await product('Vino tinto crianza', 'Prima');

      const deleted = await remove(notABrand.id);

      expect(deleted).toEqual({ id: notABrand.id, movedItems: 0 });
      expect(await brandRows()).toEqual([
        { label: 'Prima', key: 'prima', canonicalBrandId: null },
      ]);
      expect(await homonymRows()).toEqual([{ printedKey: 'primera' }]);
      // The key leaves the registry with the row.
      expect((await brands.keys({ userId: OWNER })).keys).toEqual(['prima']);
      await expect(
        brands.get({ userId: OWNER, brandId: notABrand.id })
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(await itemRow(wine.id)).toEqual({
        brand: 'Prima',
        brandKey: 'prima',
        brandId: other.id,
      });
    }, 180_000);

    it('records the brand and each of its homonyms in the trail, with what they said', async () => {
      const notABrand = await register('D.O.');
      await brands.addHomonym({
        userId: OWNER,
        brandId: notABrand.id,
        printedKey: 'D.O.P.',
      });
      await dataSource.query(`DELETE FROM "catalog_audit"`);

      await remove(notABrand.id);

      const trail: {
        entity: string;
        entityId: string;
        action: string;
        actorId: string;
        before: Record<string, unknown>;
        after: unknown;
      }[] = await dataSource.query(
        `SELECT "entity", "entityId", "action", "actorId", "before", "after"
           FROM "catalog_audit" ORDER BY "entity"`
      );
      expect(trail.map((row) => [row.entity, row.action])).toEqual([
        ['brand_homonyms', 'DELETE'],
        ['brands', 'DELETE'],
      ]);
      expect(trail[0].before).toMatchObject({
        printedKey: 'dop',
        brandId: notABrand.id,
      });
      expect(trail[1]).toMatchObject({
        entityId: notABrand.id,
        actorId: OWNER,
        before: { key: 'do', label: 'D.O.', canonicalBrandId: null },
        after: null,
      });
    }, 180_000);

    it('refuses a brand that a product holds, with the count, and changes nothing', async () => {
      const notABrand = await register('D.O.');
      await brands.addHomonym({
        userId: OWNER,
        brandId: notABrand.id,
        printedKey: 'D.O.P.',
      });
      const first = await product('Vino tinto Toro', 'D.O.');
      const second = await product('Vino blanco Rueda', 'D.O');
      expect((await itemRow(first.id)).brandId).toBe(notABrand.id);
      await dataSource.query(`DELETE FROM "catalog_audit"`);

      const refusal = await refusalOf(notABrand.id);

      expect(refusal.code).toBe('brand_in_use');
      expect(refusal.exposesDetails).toBe(true);
      expect(refusal.details).toEqual({ itemCount: 2, linkCount: 0 });
      // The foreign key would have set both to null. Neither moved.
      for (const item of [first, second]) {
        expect(await itemRow(item.id)).toEqual({
          brand: 'D.O.',
          brandKey: 'do',
          brandId: notABrand.id,
        });
      }
      expect(await brandRows()).toEqual([
        { label: 'D.O.', key: 'do', canonicalBrandId: null },
      ]);
      expect(await homonymRows()).toEqual([{ printedKey: 'dop' }]);
      expect(await dataSource.query(`SELECT 1 FROM "catalog_audit"`)).toEqual(
        []
      );
    }, 180_000);

    it('refuses a brand that a spelling is linked to, and leaves the link', async () => {
      const brand = await register('Deborah');
      const spelling = await register('DEBORAH 48H', brand.id);

      const refusal = await refusalOf(brand.id);

      expect(refusal.details).toEqual({ itemCount: 0, linkCount: 1 });
      // The foreign key would have freed the spelling. It still points.
      expect(await brandRows()).toEqual([
        { label: 'Deborah', key: 'deborah', canonicalBrandId: null },
        {
          label: 'DEBORAH 48H',
          key: 'deborah48h',
          canonicalBrandId: brand.id,
        },
      ]);
      expect(spelling.canonicalBrandId).toBe(brand.id);
      expect(await deletesInTrail()).toEqual([]);
    }, 180_000);

    it('counts products and spellings together, and the spelling’s products among them', async () => {
      const brand = await register('Deborah');
      await register('DEBORAH 48H', brand.id);
      await product('Crema', 'Deborah');
      // Printed with the spelling, so it sits on the canonical brand.
      await product('Crema de noche', 'DEBORAH 48H');

      const refusal = await refusalOf(brand.id);

      expect(refusal.details).toEqual({ itemCount: 2, linkCount: 1 });
    }, 180_000);

    it('deletes the brand once its products and its spellings are gone', async () => {
      const brand = await register('D.O.');
      const wine = await product('Vino tinto Toro', 'D.O.');
      await refusalOf(brand.id);

      // What a person does first: the product is given its real brand.
      await register('Prima');
      await items.update({
        userId: OWNER,
        itemId: wine.id,
        brand: 'Prima',
      });

      expect(await remove(brand.id)).toEqual({ id: brand.id, movedItems: 0 });
      expect((await brands.keys({ userId: OWNER })).keys).toEqual(['prima']);
      expect((await itemRow(wine.id)).brand).toBe('Prima');
    }, 180_000);

    it('still deletes a spelling the way it did, and puts its products back', async () => {
      const brand = await register('Deborah');
      const spelling = await register('DEBORAH 48H', brand.id);
      const printed = await product('Crema', 'DEBORAH 48H');

      const deleted = await remove(spelling.id);

      expect(deleted).toEqual({ id: spelling.id, movedItems: 1 });
      expect(await itemRow(printed.id)).toEqual({
        brand: 'DEBORAH 48H',
        brandKey: 'deborah48h',
        brandId: null,
      });
      // And the brand it spelled is now one nothing points at.
      expect(await remove(brand.id)).toEqual({ id: brand.id, movedItems: 0 });
    }, 180_000);

    it('answers 404 for a brand that is not there, and refuses somebody who is not an admin', async () => {
      const brand = await register('D.O.');

      await expect(remove(MISSING)).rejects.toBeInstanceOf(NotFoundException);
      await expect(remove(brand.id, NOBODY)).rejects.toBeInstanceOf(
        ForbiddenException
      );
      expect(await brandRows()).toHaveLength(1);
    }, 180_000);
  }
);
