import {
  describeIntegration,
  requiredEnv,
} from '@portfolio/luna-shopper/test-fixtures/jest';
import { DataSource } from 'typeorm';
import { CATALOG_MIGRATIONS } from './migrations';
import { DIA_CATEGORY_TREE } from './migrations/1758500000000-DiaCategoryTree';
import {
  CategoriesBeyondDia1758600000000,
  FIRST_NEW_ROOT_POSITION,
  NEW_LEAVES_UNDER_DIA_ROOTS,
  NEW_ROOTS,
  OTHER_POSITION_AFTER,
  OTHER_POSITION_BEFORE,
} from './migrations/1758600000000-CategoriesBeyondDia';
import { referenceCategoryRows } from './taxonomy/categories';
import { categoryId } from './taxonomy/ids';

/**
 * The migration that adds the categories DIA does not sell, against real
 * Postgres (plan 0179).
 *
 * Two databases, each a scratch schema of its own migrated through a
 * **prefix** of the list and dropped afterwards. The prefix ends at this
 * migration by index, so a migration added after it changes nothing here:
 *
 * - one that holds DIA's tree with products and shop sections on it, which is
 *   a cluster. It goes up, is refused on the way down while a product or a
 *   section points at a new row, goes down once they are gone, and up again.
 * - one where four of the new rows already exist under the ids their slugs
 *   derive, with other names, which is a development database the demo seed
 *   reached first.
 *
 *   LUNA_INTEGRATION=1 CATALOG_DB_URL=postgres://luna_catalog:luna_catalog@localhost:<port>/luna_catalog \
 *     npx nx run luna-shopper-backend-catalog:test-integration --testFile=categories-beyond-dia-migration.integration.spec.ts
 */
const SCHEMA = 'plan0179_migration_test';

const indexOf = (name: string) =>
  CATALOG_MIGRATIONS.findIndex((m) => m.name === name);
const THROUGH = CATALOG_MIGRATIONS.slice(
  0,
  indexOf('CategoriesBeyondDia1758600000000') + 1
);
const BEFORE = THROUGH.slice(0, -1);

interface TreeRow {
  id: string;
  parentId: string | null;
  slug: string;
  name: { en: string; es: string };
  position: number;
}

const bySlug = (a: TreeRow, b: TreeRow) => a.slug.localeCompare(b.slug);

/** DIA's tree as the rows `DiaCategoryTree1758500000000` leaves. */
const DIA_ROWS: TreeRow[] = DIA_CATEGORY_TREE.flatMap((root, position) => [
  {
    id: categoryId(root.slug),
    parentId: null,
    slug: root.slug,
    name: root.name,
    position,
  },
  ...root.children.map((leaf, index) => ({
    id: categoryId(leaf.slug),
    parentId: categoryId(root.slug),
    slug: leaf.slug,
    name: leaf.name,
    position: index,
  })),
]).sort(bySlug);

/** The thirty four rows this migration adds. */
const NEW_ROWS: TreeRow[] = [
  ...NEW_ROOTS.map((root, index) => ({
    id: categoryId(root.slug),
    parentId: null,
    slug: root.slug,
    name: root.name,
    position: FIRST_NEW_ROOT_POSITION + index,
  })),
  ...NEW_ROOTS.flatMap((root) =>
    root.children.map((leaf, position) => ({
      id: categoryId(leaf.slug),
      parentId: categoryId(root.slug),
      slug: leaf.slug,
      name: leaf.name,
      position,
    }))
  ),
  ...NEW_LEAVES_UNDER_DIA_ROOTS.map((leaf) => ({
    id: categoryId(leaf.slug),
    parentId: categoryId(leaf.root),
    slug: leaf.slug,
    name: leaf.name,
    position: leaf.position,
  })),
];

/** DIA's rows with `other` moved to the end, and the new rows beside them. */
const AFTER_ROWS: TreeRow[] = [
  ...DIA_ROWS.map((row) =>
    row.slug === 'other' ? { ...row, position: OTHER_POSITION_AFTER } : row
  ),
  ...NEW_ROWS,
].sort(bySlug);

describeIntegration(
  'the migration for what DIA does not sell (real Postgres)',
  () => {
    const url = () => requiredEnv('CATALOG_DB_URL');
    const open: DataSource[] = [];

    function connect(
      schema: string,
      migrations: typeof CATALOG_MIGRATIONS
    ): Promise<DataSource> {
      return new DataSource({
        type: 'postgres',
        url: url(),
        schema,
        migrations,
        synchronize: false,
        extra: { options: `-c search_path=${schema},public` },
      }).initialize();
    }

    /** A scratch schema migrated through `BEFORE`, then handed to `seed`. */
    async function migrated(
      schema: string,
      seed: (db: DataSource) => Promise<void>
    ): Promise<DataSource> {
      const bootstrap = new DataSource({ type: 'postgres', url: url() });
      await bootstrap.initialize();
      await bootstrap.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await bootstrap.query(`CREATE SCHEMA "${schema}"`);
      await bootstrap.destroy();

      const before = await connect(schema, BEFORE);
      try {
        await before.runMigrations();
        await seed(before);
      } finally {
        await before.destroy();
      }
      const db = await connect(schema, THROUGH);
      open.push(db);
      return db;
    }

    afterAll(async () => {
      for (const db of open) {
        if (!db.isInitialized) continue;
        const { schema } = db.options as { schema: string };
        await db.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await db.destroy();
      }
    });

    async function addProduct(
      db: DataSource,
      name: string,
      slugs: string[]
    ): Promise<string> {
      const [{ id }] = await db.query(
        `INSERT INTO "items" ("name", "defaultUnit")
         VALUES ($1::jsonb, 'UNIT') RETURNING "id"`,
        [JSON.stringify({ es: name })]
      );
      for (const [position, slug] of slugs.entries()) {
        await db.query(
          `INSERT INTO "item_categories" ("itemId", "categoryId", "position")
           VALUES ($1, $2, $3)`,
          [id, categoryId(slug), position]
        );
      }
      return id;
    }

    async function addSection(
      db: DataSource,
      slug: string,
      slugs: string[]
    ): Promise<string> {
      const [{ id: chain }] = await db.query(
        `INSERT INTO "supermarkets" ("name")
         VALUES ($1::jsonb) RETURNING "id"`,
        [JSON.stringify({ es: `Cadena ${slug}` })]
      );
      const [{ id }] = await db.query(
        `INSERT INTO "supermarket_sections" ("supermarketId", "slug", "name", "position")
         VALUES ($1, $2, $3::jsonb, 0) RETURNING "id"`,
        [chain, slug, JSON.stringify({ es: slug })]
      );
      for (const category of slugs) {
        await db.query(
          `INSERT INTO "section_categories" ("sectionId", "categoryId")
           VALUES ($1, $2)`,
          [id, categoryId(category)]
        );
      }
      return id;
    }

    async function tree(db: DataSource): Promise<TreeRow[]> {
      const rows: TreeRow[] = await db.query(
        `SELECT "id", "parentId", "slug", "name", "position" FROM "categories"`
      );
      return rows.sort(bySlug);
    }

    /** Every product's categories by slug, in position order. */
    async function products(db: DataSource): Promise<Record<string, string[]>> {
      const rows: { es: string; slug: string; position: number }[] =
        await db.query(
          `SELECT i."name" ->> 'es' AS "es", c."slug", ic."position"
             FROM "items" i
             JOIN "item_categories" ic ON ic."itemId" = i."id"
             JOIN "categories" c ON c."id" = ic."categoryId"
            ORDER BY i."id", ic."position"`
        );
      const out: Record<string, string[]> = {};
      for (const row of rows) {
        out[row.es] = [...(out[row.es] ?? []), `${row.position}:${row.slug}`];
      }
      return out;
    }

    /** Every section's categories by slug, sorted. */
    async function sections(db: DataSource): Promise<Record<string, string[]>> {
      const rows: { section: string; slug: string }[] = await db.query(
        `SELECT s."slug" AS "section", c."slug"
           FROM "supermarket_sections" s
           JOIN "section_categories" sc ON sc."sectionId" = s."id"
           JOIN "categories" c ON c."id" = sc."categoryId"`
      );
      const out: Record<string, string[]> = {};
      for (const row of rows) {
        out[row.section] = [...(out[row.section] ?? []), row.slug].sort();
      }
      return out;
    }

    async function executed(db: DataSource): Promise<string[]> {
      const rows: { name: string }[] = await db.query(
        `SELECT "name" FROM "migrations" ORDER BY "id"`
      );
      return rows.map((row) => row.name);
    }

    /** What a promise was rejected with. */
    async function refusal(promise: Promise<unknown>): Promise<Error> {
      try {
        await promise;
      } catch (error) {
        return error as Error;
      }
      throw new Error('expected a refusal');
    }

    it('is the last step of the prefix it is tested through', () => {
      expect(THROUGH[THROUGH.length - 1]).toBe(
        CategoriesBeyondDia1758600000000
      );
      expect(BEFORE).not.toContain(CategoriesBeyondDia1758600000000);
      expect(BEFORE[BEFORE.length - 1].name).toBe(
        'DiaCategoryTree1758500000000'
      );
    });

    it('states 4 roots and 30 leaves, and the tree the taxonomy file holds', () => {
      expect(NEW_ROWS.filter((row) => row.parentId === null)).toHaveLength(4);
      expect(NEW_ROWS.filter((row) => row.parentId !== null)).toHaveLength(30);
      expect(OTHER_POSITION_BEFORE).toBe(28);
      expect(OTHER_POSITION_AFTER).toBe(32);
      expect(AFTER_ROWS).toEqual(referenceCategoryRows().sort(bySlug));
    });

    describe('a database that holds the DIA tree, with products and sections on it', () => {
      let db: DataSource;

      const PRODUCTS: Record<string, string[]> = {
        'Pintalabios filed under facial care': ['facial-care'],
        'Libro Altitud': ['uncategorised'],
        'Leche y yogur': ['milk', 'greek-yogurts'],
      };
      const SECTIONS: Record<string, string[]> = {
        'on-a-root': ['pets'],
        'on-leaves': ['facial-care', 'uncategorised'],
        'on-other': ['other'],
      };
      const PRODUCTS_BEFORE = {
        'Pintalabios filed under facial care': ['0:facial-care'],
        'Libro Altitud': ['0:uncategorised'],
        'Leche y yogur': ['0:milk', '1:greek-yogurts'],
      };
      const SECTIONS_BEFORE = {
        'on-a-root': ['pets'],
        'on-leaves': ['facial-care', 'uncategorised'],
        'on-other': ['other'],
      };

      beforeAll(async () => {
        db = await migrated(`${SCHEMA}_cluster`, async (before) => {
          expect(await tree(before)).toEqual(DIA_ROWS);
          for (const [name, slugs] of Object.entries(PRODUCTS)) {
            await addProduct(before, name, slugs);
          }
          for (const [slug, slugs] of Object.entries(SECTIONS)) {
            await addSection(before, slug, slugs);
          }
        });
        await db.runMigrations();
      }, 300_000);

      it('holds 29 + 4 roots and 246 + 30 leaves', async () => {
        const rows = await tree(db);
        expect(rows.filter((row) => row.parentId === null)).toHaveLength(
          29 + 4
        );
        expect(rows.filter((row) => row.parentId !== null)).toHaveLength(
          246 + 30
        );
        expect(rows).toEqual(AFTER_ROWS);
      });

      it('changes no row DIA had but the position of other, which stays last', async () => {
        const rows = await tree(db);
        const bySlugName = new Map(rows.map((row) => [row.slug, row]));
        for (const row of DIA_ROWS) {
          expect(bySlugName.get(row.slug)).toEqual(
            row.slug === 'other'
              ? { ...row, position: OTHER_POSITION_AFTER }
              : row
          );
        }
        const roots = rows
          .filter((row) => row.parentId === null)
          .sort((a, b) => a.position - b.position);
        expect(roots.map((row) => row.position)).toEqual(
          roots.map((_, index) => index)
        );
        expect(roots.slice(-5).map((row) => row.slug)).toEqual([
          'makeup',
          'home-and-garden',
          'leisure-and-stationery',
          'clothing-and-accessories',
          'other',
        ]);
      });

      it('numbers the children of every root from 0 with no gap', async () => {
        const rows = await tree(db);
        for (const root of rows.filter((row) => row.parentId === null)) {
          const positions = rows
            .filter((row) => row.parentId === root.id)
            .map((row) => row.position)
            .sort((a, b) => a - b);
          expect(`${root.slug}: ${positions}`).toBe(
            `${root.slug}: ${positions.map((_, index) => index)}`
          );
        }
      });

      it('moves no product and no section', async () => {
        expect(await products(db)).toEqual(PRODUCTS_BEFORE);
        expect(await sections(db)).toEqual(SECTIONS_BEFORE);
      });

      it('lets a product sit on a new leaf, and refuses one on a new root', async () => {
        const id = await addProduct(db, 'Probe', ['lip-makeup']);
        const error = await refusal(addProduct(db, 'On a root', ['makeup']));
        expect(error.message).toContain('category_not_a_leaf');
        await db.query(`DELETE FROM "items" WHERE "id" = $1`, [id]);
        await db.query(`DELETE FROM "items" WHERE "name" ->> 'es' = $1`, [
          'On a root',
        ]);
      });

      it('down refuses while a product points at a new leaf, and changes nothing', async () => {
        const id = await addProduct(db, 'Libro Arderá el viento', [
          'uncategorised',
          'books',
        ]);

        const error = await refusal(db.undoLastMigration());
        expect(error.message).toContain(
          'cannot be undone while a product or a shop section points at a category it added'
        );
        expect(error.message).toContain('books (1 products, 0 sections)');

        expect(await tree(db)).toEqual(AFTER_ROWS);
        expect(await executed(db)).toContain(
          'CategoriesBeyondDia1758600000000'
        );
        expect((await products(db))['Libro Arderá el viento']).toEqual([
          '0:uncategorised',
          '1:books',
        ]);

        await db.query(`DELETE FROM "items" WHERE "id" = $1`, [id]);
      }, 120_000);

      it('down refuses while a section points at a new root or a new leaf, and names each', async () => {
        const id = await addSection(db, 'kiosco', [
          'leisure-and-stationery',
          'shoe-care',
        ]);

        const error = await refusal(db.undoLastMigration());
        expect(error.message).toContain(
          'leisure-and-stationery (0 products, 1 sections)'
        );
        expect(error.message).toContain('shoe-care (0 products, 1 sections)');
        expect(await tree(db)).toEqual(AFTER_ROWS);
        expect(await executed(db)).toContain(
          'CategoriesBeyondDia1758600000000'
        );

        await db.query(`DELETE FROM "supermarket_sections" WHERE "id" = $1`, [
          id,
        ]);
      }, 120_000);

      it('down removes only its own rows once nothing points at them, and up runs again', async () => {
        await db.undoLastMigration();

        expect(await tree(db)).toEqual(DIA_ROWS);
        expect(await executed(db)).not.toContain(
          'CategoriesBeyondDia1758600000000'
        );
        expect(await products(db)).toEqual(PRODUCTS_BEFORE);
        expect(await sections(db)).toEqual(SECTIONS_BEFORE);

        await db.runMigrations();
        expect(await tree(db)).toEqual(AFTER_ROWS);
        expect(await products(db)).toEqual(PRODUCTS_BEFORE);
        expect(await sections(db)).toEqual(SECTIONS_BEFORE);
      }, 120_000);
    });

    describe('a database where the demo seed wrote some of the rows first', () => {
      let db: DataSource;

      beforeAll(async () => {
        db = await migrated(`${SCHEMA}_seeded`, async (before) => {
          const insert = (
            slug: string,
            parent: string | null,
            position: number
          ) =>
            before.query(
              `INSERT INTO "categories" ("id", "parentId", "slug", "name", "position")
               VALUES ($1, $2, $3, $4::jsonb, $5)`,
              [
                categoryId(slug),
                parent === null ? null : categoryId(parent),
                slug,
                JSON.stringify({ en: 'Stale', es: 'Viejo' }),
                position,
              ]
            );
          await insert('makeup', null, 40);
          await insert('lip-makeup', 'makeup', 7);
          await insert('shoe-care', 'cleaning-and-home', 30);
          // On a product already, which the upsert must not disturb.
          await addProduct(before, 'Pintalabios', ['lip-makeup']);
        });
        await db.runMigrations();
      }, 300_000);

      it('writes over them by id, so the tree is the same as on a fresh database', async () => {
        expect(await tree(db)).toEqual(AFTER_ROWS);
        expect(await products(db)).toEqual({ Pintalabios: ['0:lip-makeup'] });
      });
    });
  }
);
