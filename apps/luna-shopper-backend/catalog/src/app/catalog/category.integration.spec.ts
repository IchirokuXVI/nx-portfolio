import { JwtService } from '@nestjs/jwt';
import { UnitOfMeasure } from '@portfolio/luna-shopper/contracts';
import {
  CategoryInUseException,
  CategoryNotALeafException,
  CategoryNotFoundException,
  CategoryTooDeepException,
  ItemNeedsACategoryException,
  NotFoundException,
} from '@portfolio/luna-shopper/platform';
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
  ProductGroup,
  SupermarketItem,
} from '../entities';
import type { CatalogEventsPublisher } from '../events/catalog-events.publisher';
import { CatalogAuditService } from './catalog-audit.service';
import { CategoryService } from './category.service';
import { ItemService } from './item.service';
import { PlatformAdminService } from './platform-admin.service';
import { ProductGroupService } from './product-group.service';

/**
 * The category tree through the services, against real Postgres (plan 0166).
 *
 * The rules the database holds on its own are
 * `category-tree-migration.integration.spec.ts`'s claim. This file is about
 * what a caller sees: each rule refused with its own readable code before the
 * database is reached, products written onto their leaves in the order meant,
 * the counts a root answers, and the search filter over a root and a leaf.
 *
 * It works in a scratch schema of its own, seeded with the whole taxonomy, and
 * drops it afterwards.
 *
 *   LUNA_INTEGRATION=1 CATALOG_DB_URL=postgres://luna_catalog:luna_catalog@localhost:<port>/luna_catalog \
 *     npx nx run luna-shopper-backend-catalog:test-integration --testFile=category.integration.spec.ts
 */
const SCHEMA = 'plan0166_category_test';
const OWNER = 'ac700000-0000-4000-a000-000000000166';

describeIntegration('the category tree (real Postgres)', () => {
  let dataSource: DataSource;
  let categories: CategoryService;
  let items: ItemService;

  const leaf = (slug: string) => categoryId(slug);

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
      // `public` for the extensions the search reads, after the scratch schema,
      // as the search spec explains.
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
    categories = new CategoryService(
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
      categories
    );
  }, 180_000);

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
      await dataSource.destroy();
    }
  });

  /** What a promise was rejected with, so a spec can read its class and details. */
  async function refusal(promise: Promise<unknown>): Promise<unknown> {
    try {
      await promise;
    } catch (error) {
      return error;
    }
    throw new Error('expected a refusal');
  }

  const product = (name: string, categoryIds: string[]) =>
    items.create({
      userId: OWNER,
      name: { es: name },
      categoryIds,
      defaultUnit: UnitOfMeasure.UNIT,
    });

  describe('the tree', () => {
    it('answers roots then children, each by position', async () => {
      const { categories: rows } = await categories.tree({ userId: 'any' });
      expect(rows).toHaveLength(29 + 246);
      const roots = rows.slice(0, 29);
      expect(roots.every((row) => row.parentId === null)).toBe(true);
      expect(roots.map((row) => row.position)).toEqual(
        roots.map((_, index) => index)
      );
      // The children follow grouped under their roots, in the roots' order.
      const parents = rows.slice(29).map((row) => row.parentId);
      const firstSeen = [...new Set(parents)];
      expect(firstSeen).toEqual(roots.map((row) => row.id));
    });

    it('counts distinct products, and a root the distinct products under its children', async () => {
      // One pizza on two leaves of two roots, and one on two leaves of one root.
      await product('Pizza congelada', [
        leaf('pizzas-and-doughs'),
        leaf('frozen-pizzas'),
      ]);
      await product('Helado y postre', [
        leaf('ice-creams-and-ice'),
        leaf('cakes-and-churros'),
      ]);
      const { categories: rows } = await categories.tree({ userId: 'any' });
      const count = (slug: string) =>
        rows.find((row) => row.slug === slug)?.itemCount;
      expect(count('frozen-foods-and-ice-cream')).toBe(2);
      expect(count('ice-creams-and-ice')).toBe(1);
      expect(count('cakes-and-churros')).toBe(1);
      expect(count('prepared-meals-and-pizzas')).toBe(1);
      expect(count('frozen-pizzas')).toBe(1);
      expect(count('children')).toBe(0);
    });
  });

  describe('the rules, each with its own code', () => {
    it('R1: refuses a child of a child', async () => {
      const refused = await refusal(
        categories.create({
          userId: OWNER,
          parentId: leaf('frozen-pizzas'),
          slug: 'thin-crust',
          name: { en: 'Thin crust' },
        })
      );
      expect(refused).toBeInstanceOf(CategoryTooDeepException);
      expect(refused).toMatchObject({
        details: { categoryId: leaf('frozen-pizzas') },
      });
    });

    it('R1: refuses giving a parent to a root that has children', async () => {
      const refused = await refusal(
        categories.update({
          userId: OWNER,
          categoryId: leaf('pets'),
          parentId: leaf('cleaning-and-home'),
        })
      );
      expect(refused).toBeInstanceOf(CategoryTooDeepException);
      expect(refused).toMatchObject({ details: { categoryId: leaf('pets') } });
    });

    it('R2: refuses a product on a root, and names the root', async () => {
      const refused = await refusal(
        product('Raíz', [
          leaf('frozen-pizzas'),
          leaf('frozen-foods-and-ice-cream'),
        ])
      );
      expect(refused).toBeInstanceOf(CategoryNotALeafException);
      expect(refused).toMatchObject({
        details: { categoryId: leaf('frozen-foods-and-ice-cream') },
      });
    });

    it('R2: refuses making a root of a leaf that holds products', async () => {
      await expect(
        categories.update({
          userId: OWNER,
          categoryId: leaf('frozen-pizzas'),
          parentId: null,
        })
      ).rejects.toBeInstanceOf(CategoryNotALeafException);
    });

    it('R3: refuses a product with no category, on create and on update', async () => {
      await expect(product('Sin nada', [])).rejects.toBeInstanceOf(
        ItemNeedsACategoryException
      );
      const created = await product('Con algo', [leaf('water')]);
      await expect(
        items.update({ userId: OWNER, itemId: created.id, categoryIds: [] })
      ).rejects.toBeInstanceOf(ItemNeedsACategoryException);
    });

    it('R4: refuses deleting a category with products or children', async () => {
      await expect(
        categories.delete({ userId: OWNER, categoryId: leaf('frozen-pizzas') })
      ).rejects.toBeInstanceOf(CategoryInUseException);
      await expect(
        categories.delete({ userId: OWNER, categoryId: leaf('pets') })
      ).rejects.toBeInstanceOf(CategoryInUseException);
    });

    it('names every unknown id', async () => {
      const missing = '00000000-0000-4000-a000-000000000000';
      const refused = await refusal(
        product('Nada', [leaf('water'), missing, 'not-a-uuid'])
      );
      expect(refused).toBeInstanceOf(CategoryNotFoundException);
      expect(refused).toMatchObject({
        details: { unknown: [missing, 'not-a-uuid'] },
      });
    });
  });

  describe('a category written by the back office', () => {
    it('appends, moves between roots, and deletes once empty', async () => {
      const created = await categories.create({
        userId: OWNER,
        parentId: leaf('pets'),
        slug: 'birds',
        name: { en: 'Birds', es: 'Pájaros' },
      });
      expect(created).toMatchObject({
        id: categoryId('birds'),
        parentId: leaf('pets'),
        position: 6,
        itemCount: 0,
      });

      const moved = await categories.update({
        userId: OWNER,
        categoryId: created.id,
        parentId: leaf('other'),
      });
      expect(moved).toMatchObject({ parentId: leaf('other'), position: 1 });

      await expect(
        categories.create({
          userId: OWNER,
          slug: 'birds',
          name: { en: 'Birds again' },
        })
      ).rejects.toMatchObject({ code: 'conflict' });

      await categories.delete({ userId: OWNER, categoryId: created.id });
      await expect(
        categories.get({ userId: OWNER, categoryId: created.id })
      ).rejects.toBeInstanceOf(CategoryNotFoundException);
    });

    it('lists with filters that combine', async () => {
      const leaves = await categories.list({
        userId: OWNER,
        parentId: leaf('water-and-soft-drinks'),
        limit: 100,
      });
      expect(leaves.items.map((row) => row.slug)).toEqual([
        'water',
        'cola',
        'orange-lemon-and-lemon-lime',
        'tonic-sparkling-water-and-bitter',
        'iced-tea',
        'non-carbonated-soft-drinks',
        'isotonic-and-sports-drinks',
        'energy-drinks',
        'kombucha-and-vitamin-infused-waters',
        'water-and-soft-drink-packs',
      ]);
      const none = await categories.list({
        userId: OWNER,
        parentId: leaf('water-and-soft-drinks'),
        kind: 'root',
      });
      expect(none.items).toEqual([]);
      const found = await categories.list({
        userId: OWNER,
        query: 'charcuteria',
      });
      expect(found.items.map((row) => row.slug)).toContain('charcuterie');

      const first = await categories.list({ userId: OWNER, limit: 10 });
      const second = await categories.list({
        userId: OWNER,
        limit: 10,
        cursor: first.nextCursor ?? undefined,
      });
      expect(first.items).toHaveLength(10);
      expect(second.items[0].slug).not.toBe(first.items[9].slug);
    });
  });

  describe('a product’s categories', () => {
    it('keeps the order written, replaces the set, and answers it on every read', async () => {
      const created = await product('Queso en lonchas', [
        leaf('sliced'),
        leaf('semi-cured'),
      ]);
      expect(created.categories.map((c) => c.slug)).toEqual([
        'sliced',
        'semi-cured',
      ]);
      expect(created.categories[0].parentId).toBe(leaf('cheeses'));

      const updated = await items.update({
        userId: OWNER,
        itemId: created.id,
        categoryIds: [leaf('semi-cured')],
      });
      expect(updated.categories.map((c) => c.slug)).toEqual(['semi-cured']);

      const renamed = await items.update({
        userId: OWNER,
        itemId: created.id,
        name: { es: 'Queso en lonchas finas' },
      });
      expect(renamed.categories.map((c) => c.slug)).toEqual(['semi-cured']);
      const read = await items.get({ userId: OWNER, itemId: created.id });
      expect(read.categories.map((c) => c.slug)).toEqual(['semi-cured']);
    });

    it('updates many all or nothing', async () => {
      const a = await product('Agua uno', [leaf('water')]);
      const b = await product('Agua dos', [leaf('water')]);
      await expect(
        items.updateMany({
          userId: OWNER,
          items: [
            { itemId: a.id, categoryIds: [leaf('cola')] },
            { itemId: b.id, categoryIds: [leaf('water-and-soft-drinks')] },
          ],
        })
      ).rejects.toBeInstanceOf(CategoryNotALeafException);
      const untouched = await items.get({ userId: OWNER, itemId: a.id });
      expect(untouched.categories.map((c) => c.slug)).toEqual(['water']);

      await expect(
        items.updateMany({
          userId: OWNER,
          items: [
            { itemId: a.id, categoryIds: [leaf('cola')] },
            {
              itemId: '00000000-0000-4000-a000-00000000dead',
              categoryIds: [leaf('cola')],
            },
          ],
        })
      ).rejects.toBeInstanceOf(NotFoundException);

      const done = await items.updateMany({
        userId: OWNER,
        items: [
          { itemId: b.id, categoryIds: [leaf('iced-tea')] },
          { itemId: a.id, categoryIds: [leaf('cola'), leaf('water')] },
        ],
      });
      expect(
        done.items.map((item) => [item.id, item.categories.map((c) => c.slug)])
      ).toEqual([
        [b.id, ['iced-tea']],
        [a.id, ['cola', 'water']],
      ]);
    });

    it('searches by a leaf, by a root meaning its children, and answers nothing for an unknown id', async () => {
      const wine = await product('Vino tinto joven', [leaf('red-wine')]);
      const beer = await product('Cerveza rubia', [leaf('beers')]);

      const underRoot = await items.search({
        userId: OWNER,
        categoryId: leaf('beers-wines-and-spirits'),
        limit: 100,
      });
      const rootIds = underRoot.items.map((item) => item.id);
      expect(rootIds).toEqual(expect.arrayContaining([wine.id, beer.id]));
      // Once each, although a product can sit on two leaves of the root.
      expect(new Set(rootIds).size).toBe(rootIds.length);

      const underLeaf = await items.search({
        userId: OWNER,
        categoryId: leaf('beers'),
        limit: 100,
      });
      expect(underLeaf.items.map((item) => item.id)).toEqual([beer.id]);

      // The ranked branch applies the same filter.
      const ranked = await items.search({
        userId: OWNER,
        query: 'cerveza',
        categoryId: leaf('red-wine'),
      });
      expect(ranked.items).toEqual([]);
      const rankedHit = await items.search({
        userId: OWNER,
        query: 'cerveza',
        categoryId: leaf('beers-wines-and-spirits'),
      });
      expect(rankedHit.items.map((item) => item.id)).toEqual([beer.id]);

      expect(
        (
          await items.search({
            userId: OWNER,
            categoryId: '00000000-0000-4000-a000-000000000000',
          })
        ).items
      ).toEqual([]);
      expect(
        (await items.search({ userId: OWNER, categoryId: 'nope' })).items
      ).toEqual([]);
    });
  });
});
