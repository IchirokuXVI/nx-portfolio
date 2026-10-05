import { JwtService } from '@nestjs/jwt';
import {
  ADMIN_PRICE_ITEM_IDS_MAX,
  PriceScopeKind,
  UnitOfMeasure,
} from '@portfolio/luna-shopper/contracts';
import {
  describeIntegration,
  requiredEnv,
} from '@portfolio/luna-shopper/test-fixtures/jest';
import { DataSource } from 'typeorm';
import { CATALOG_MIGRATIONS } from '../db/migrations';
import { categoryId } from '../db/taxonomy/ids';
import { seedTaxonomy } from '../db/taxonomy/taxonomy-seed';
import {
  Brand,
  CATALOG_ENTITIES,
  Category,
  Item,
  PriceScope,
  ProductGroup,
  Supermarket,
  SupermarketItem,
  SupermarketLocation,
} from '../entities';
import type { CatalogEventsPublisher } from '../events/catalog-events.publisher';
import { CatalogAuditService } from './catalog-audit.service';
import { CategoryService } from './category.service';
import { itemEanStoreOf } from './item-ean.store';
import { ItemService } from './item.service';
import { LocationScopeService } from './location-scopes';
import { PlatformAdminService } from './platform-admin.service';
import { ProductGroupService } from './product-group.service';
import { SupermarketItemService } from './supermarket-item.service';

/**
 * The two reads the back office's product list gained (admin plan 0043,
 * section 2), against real Postgres.
 *
 * - `withoutCategory` on the product search: the products on no category at
 *   all, on the listing branch and on the ranked one.
 * - `itemIds` on the admin price list: the price row of every product of one
 *   page, at one scope, in one read.
 *
 * Both are a clause in a statement, and a fake repository that returns rows
 * proves neither. So this runs the statements.
 *
 *   LUNA_INTEGRATION=1 CATALOG_DB_URL=postgres://luna_catalog:luna_catalog@localhost:<port>/luna_catalog \
 *     npx nx run luna-shopper-backend-catalog:test-integration --testFile=admin-product-list.integration.spec.ts
 */
const SCHEMA = 'admin0043_product_list_test';
const OWNER = 'ac700000-0000-4000-a000-000000000043';

describeIntegration(
  'the product list of the back office (real Postgres)',
  () => {
    let dataSource: DataSource;
    let items: ItemService;
    let prices: SupermarketItemService;

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
        // `public` for the extensions the search reads, after the scratch schema.
        extra: { options: `-c search_path=${SCHEMA},public` },
      });
      await dataSource.initialize();
      await dataSource.runMigrations();
      await dataSource.transaction((m) => seedTaxonomy(m));

      const admin = new PlatformAdminService(new JwtService(), {
        getOrThrow: () => ({ adminJwtPublicKey: '', serviceActorIds: [OWNER] }),
      } as never);
      const events = {
        itemGroupChanged: () => undefined,
        productGroupDeleted: () => undefined,
      } as unknown as CatalogEventsPublisher;
      const audit = new CatalogAuditService(dataSource);
      const categories = new CategoryService(
        dataSource.getRepository(Category),
        admin,
        audit
      );
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
        categories,
        itemEanStoreOf(dataSource)
      );
      prices = new SupermarketItemService(
        dataSource.getRepository(SupermarketItem),
        dataSource.getRepository(Item),
        dataSource.getRepository(PriceScope),
        dataSource.getRepository(SupermarketLocation),
        admin,
        audit,
        new LocationScopeService()
      );
    }, 180_000);

    afterAll(async () => {
      if (dataSource?.isInitialized) {
        await dataSource.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
        await dataSource.destroy();
      }
    });

    /**
     * A product with no category. The service refuses to write one, so it goes
     * in as a source leaves it: a row of `items` and no row of
     * `item_categories`.
     */
    const uncategorized = async (name: string): Promise<string> => {
      const repository = dataSource.getRepository(Item);
      const row = await repository.save(
        repository.create({
          name: { es: name },
          defaultUnit: UnitOfMeasure.UNIT,
        })
      );
      return row.id;
    };

    describe('the products on no category', () => {
      it('lists them alone, and a search keeps to them', async () => {
        const loose = await uncategorized('Garbanzos sueltos');
        const other = await uncategorized('Lentejas sueltas');
        const placed = await items.create({
          userId: OWNER,
          name: { es: 'Garbanzos cocidos' },
          categoryIds: [categoryId('beers')],
          defaultUnit: UnitOfMeasure.UNIT,
        });

        const listed = await items.search({
          userId: OWNER,
          withoutCategory: true,
          limit: 100,
        });
        const ids = listed.items.map((item) => item.id);
        expect(ids).toEqual(expect.arrayContaining([loose, other]));
        expect(ids).not.toContain(placed.id);

        // The ranked branch applies the same clause: "garbanzos" matches a
        // product on a category and one on none, and only the second answers.
        const ranked = await items.search({
          userId: OWNER,
          query: 'garbanzos',
          withoutCategory: true,
        });
        expect(ranked.items.map((item) => item.id)).toEqual([loose]);

        // Beside a category the two ask for nothing.
        const both = await items.search({
          userId: OWNER,
          withoutCategory: true,
          categoryId: categoryId('beers'),
        });
        expect(both.items).toEqual([]);

        // Absent and false are the same: every product.
        const every = await items.search({
          userId: OWNER,
          withoutCategory: false,
          limit: 100,
        });
        expect(every.items.map((item) => item.id)).toEqual(
          expect.arrayContaining([loose, other, placed.id])
        );
      });
    });

    describe('the prices of one page of products', () => {
      let scopeId: string;
      let otherScopeId: string;
      let productIds: string[];

      beforeAll(async () => {
        const supermarkets = dataSource.getRepository(Supermarket);
        const chain = await supermarkets.save(
          supermarkets.create({ name: { en: 'Chain', es: 'Cadena' } })
        );
        const scopes = dataSource.getRepository(PriceScope);
        const scope = (kind: PriceScopeKind, externalKey: string | null) =>
          scopes.save(
            scopes.create({ supermarketId: chain.id, kind, externalKey })
          );
        scopeId = (await scope(PriceScopeKind.NATIONAL, null)).id;
        otherScopeId = (await scope(PriceScopeKind.REGION, 'south')).id;

        productIds = [];
        for (const name of ['Uno', 'Dos', 'Tres', 'Cuatro']) {
          productIds.push(await uncategorized(`Producto ${name}`));
        }

        // Rows through the one write this table still takes: whether a scope
        // carries a product. No price is written, here or anywhere.
        await prices.setAvailability({
          userId: OWNER,
          priceScopeId: scopeId,
          entries: productIds
            .slice(0, 3)
            .map((itemId) => ({ itemId, available: true })),
        });
        await prices.setAvailability({
          userId: OWNER,
          priceScopeId: otherScopeId,
          entries: [{ itemId: productIds[0], available: false }],
        });
      });

      it('answers the rows of the named products at the named scope, and no others', async () => {
        const [first, second, , fourth] = productIds;

        const page = await prices.adminList({
          userId: OWNER,
          priceScopeId: scopeId,
          itemIds: [first, second, fourth],
          limit: 100,
        });

        // The fourth has no row at this scope, and the third was not asked for.
        expect(page.items.map((row) => row.itemId).sort()).toEqual(
          [first, second].sort()
        );
        expect(page.items.every((row) => row.priceScopeId === scopeId)).toBe(
          true
        );
        // The name still rides along, as it does on every admin price read.
        expect(page.items.every((row) => row.itemName !== null)).toBe(true);
        expect(page.nextCursor).toBeNull();
      });

      it('answers every scope of the named products when no scope is named', async () => {
        const page = await prices.adminList({
          userId: OWNER,
          itemIds: [productIds[0]],
          limit: 100,
        });

        expect(page.items.map((row) => row.priceScopeId).sort()).toEqual(
          [scopeId, otherScopeId].sort()
        );
      });

      it('reads an empty list as no filter, as an absent one is', async () => {
        const page = await prices.adminList({
          userId: OWNER,
          priceScopeId: scopeId,
          itemIds: [],
          limit: 100,
        });

        expect(page.items).toHaveLength(3);
      });

      it('takes a whole page of ids in one statement', async () => {
        // The most the route lets through. Most of them name nothing, which is
        // what a page of products mostly without a price at the scope looks
        // like.
        const padding = Array.from(
          { length: ADMIN_PRICE_ITEM_IDS_MAX - 3 },
          (_, index) =>
            `00000000-0000-4000-a000-${String(index).padStart(12, '0')}`
        );

        const page = await prices.adminList({
          userId: OWNER,
          priceScopeId: scopeId,
          itemIds: [...productIds.slice(0, 3), ...padding],
          limit: 100,
        });

        expect(page.items).toHaveLength(3);
      });
    });
  }
);
