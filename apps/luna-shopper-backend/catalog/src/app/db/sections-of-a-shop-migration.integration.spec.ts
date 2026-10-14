import {
  describeIntegration,
  requiredEnv,
} from '@portfolio/luna-shopper/test-fixtures/jest';
import { DataSource } from 'typeorm';
import { CATALOG_MIGRATIONS } from './migrations';
import { SectionsOfAShop1759000000000 } from './migrations/1759000000000-SectionsOfAShop';
import { categoryId } from './taxonomy/ids';

/**
 * The migration that gives each shop its own sections, against real Postgres
 * (plan 0200, section 2).
 *
 * A database is migrated up to the step before it and filled the way plan 0167
 * left one: a chain with four sections, two shops that selected different ones
 * in different orders, a third shop that selected nothing, a shop of another
 * chain, and one pin. Then the migration runs. The spec asserts:
 *
 * - the copies: one section per selection, with the slug, the name and the
 *   categories of the chain section and the position of the selection
 * - the third shop has no section, because nothing is inherited
 * - every row of the four old tables is still there, pin included
 * - `down` removes the two new tables and nothing else, and `up` works again
 *
 * It works in a scratch schema of its own and drops it afterwards.
 *
 *   LUNA_INTEGRATION=1 CATALOG_DB_URL=postgres://luna_catalog:luna_catalog@localhost:<port>/luna_catalog \
 *     npx nx run luna-shopper-backend-catalog:test-integration --testFile=sections-of-a-shop-migration.integration.spec.ts
 */
const SCHEMA = 'plan0200_migration_test';

const AT = CATALOG_MIGRATIONS.indexOf(SectionsOfAShop1759000000000);
const BEFORE = CATALOG_MIGRATIONS.slice(0, AT);
const THROUGH = CATALOG_MIGRATIONS.slice(0, AT + 1);

const OLD_TABLES = [
  'supermarket_sections',
  'section_categories',
  'location_sections',
  'supermarket_item_sections',
] as const;
const NEW_TABLES = ['shop_sections', 'shop_section_categories'];
const OLD_TRIGGERS = [
  'tg_item_sections_same_chain',
  'tg_location_sections_same_chain',
];

interface Copy {
  slug: string;
  name: Record<string, string>;
  position: number;
  categories: string[];
}

describeIntegration('the sections of a shop migration (real Postgres)', () => {
  let db: DataSource;

  let chain: string;
  let north: string;
  let south: string;
  let empty: string;
  let elsewhere: string;
  let pinned: string;
  /** Every row of the four old tables, as text, before the migration ran. */
  let oldRowsBefore: Record<string, string[]>;

  const MILK = categoryId('milk');
  const PETS = categoryId('pets');
  const FACIAL = categoryId('facial-care');

  function connect(migrations: typeof CATALOG_MIGRATIONS): Promise<DataSource> {
    return new DataSource({
      type: 'postgres',
      url: requiredEnv('CATALOG_DB_URL'),
      schema: SCHEMA,
      migrations,
      synchronize: false,
      extra: { options: `-c search_path=${SCHEMA},public` },
    }).initialize();
  }

  async function one(
    on: DataSource,
    sql: string,
    params: unknown[]
  ): Promise<string> {
    const [{ id }] = (await on.query(sql, params)) as { id: string }[];
    return id;
  }

  const addChain = (on: DataSource, name: string) =>
    one(
      on,
      `INSERT INTO "supermarkets" ("name") VALUES ($1::jsonb) RETURNING "id"::text AS "id"`,
      [JSON.stringify({ es: name })]
    );

  const addShop = (on: DataSource, supermarketId: string, city: string) =>
    one(
      on,
      `INSERT INTO "supermarket_locations" ("supermarketId", "city")
       VALUES ($1, $2) RETURNING "id"::text AS "id"`,
      [supermarketId, city]
    );

  async function addChainSection(
    on: DataSource,
    supermarketId: string,
    slug: string,
    name: Record<string, string>,
    position: number,
    categories: string[]
  ): Promise<string> {
    const id = await one(
      on,
      `INSERT INTO "supermarket_sections" ("supermarketId", "slug", "name", "position")
       VALUES ($1, $2, $3::jsonb, $4) RETURNING "id"::text AS "id"`,
      [supermarketId, slug, JSON.stringify(name), position]
    );
    for (const category of categories) {
      await on.query(
        `INSERT INTO "section_categories" ("sectionId", "categoryId") VALUES ($1, $2)`,
        [id, category]
      );
    }
    return id;
  }

  async function select(
    on: DataSource,
    shop: string,
    sectionIds: string[]
  ): Promise<void> {
    for (const [position, sectionId] of sectionIds.entries()) {
      await on.query(
        `INSERT INTO "location_sections" ("supermarketLocationId", "sectionId", "position")
         VALUES ($1, $2, $3)`,
        [shop, sectionId, position]
      );
    }
  }

  /** Every row of the four old tables, each as one sorted list of texts. */
  async function oldRows(on: DataSource): Promise<Record<string, string[]>> {
    const rows: Record<string, string[]> = {};
    for (const table of OLD_TABLES) {
      const found = (await on.query(
        `SELECT t::text AS "row" FROM "${table}" t ORDER BY 1`
      )) as { row: string }[];
      rows[table] = found.map((entry) => entry.row);
    }
    return rows;
  }

  /** The sections of one shop as the migration wrote them, in their order. */
  async function copiesOf(shop: string): Promise<Copy[]> {
    return (await db.query(
      `SELECT s."slug" AS "slug", s."name" AS "name", s."position" AS "position",
              coalesce(
                array_agg(sc."categoryId"::text ORDER BY sc."categoryId"::text)
                  FILTER (WHERE sc."categoryId" IS NOT NULL),
                '{}'
              ) AS "categories"
         FROM "shop_sections" s
         LEFT JOIN "shop_section_categories" sc ON sc."sectionId" = s."id"
        WHERE s."supermarketLocationId" = $1
        GROUP BY s."id"
        ORDER BY s."position"`,
      [shop]
    )) as Copy[];
  }

  async function present(names: readonly string[]): Promise<string[]> {
    const rows = (await db.query(
      `SELECT table_name AS "name" FROM information_schema.tables
        WHERE table_schema = $1 AND table_name = ANY($2) ORDER BY 1`,
      [SCHEMA, [...names]]
    )) as { name: string }[];
    return rows.map((row) => row.name);
  }

  async function count(table: string): Promise<number> {
    const [{ rows }] = (await db.query(
      `SELECT count(*)::int AS "rows" FROM "${table}"`
    )) as { rows: number }[];
    return rows;
  }

  const sorted = (ids: string[]) => [...ids].sort();

  beforeAll(async () => {
    const bootstrap = new DataSource({
      type: 'postgres',
      url: requiredEnv('CATALOG_DB_URL'),
    });
    await bootstrap.initialize();
    await bootstrap.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
    await bootstrap.query(`CREATE SCHEMA "${SCHEMA}"`);
    await bootstrap.destroy();

    const before = await connect(BEFORE);
    try {
      await before.runMigrations();

      chain = await addChain(before, 'Cadena');
      const other = await addChain(before, 'Otra cadena');
      north = await addShop(before, chain, 'Norte');
      south = await addShop(before, chain, 'Sur');
      empty = await addShop(before, chain, 'Sin selección');
      elsewhere = await addShop(before, other, 'Otra');

      // The chain's order: Lácteos, Mascotas, Belleza, Ofertas.
      const dairy = await addChainSection(
        before,
        chain,
        'lacteos',
        { es: 'Lácteos', en: 'Dairy' },
        0,
        [MILK]
      );
      const pets = await addChainSection(
        before,
        chain,
        'mascotas',
        { es: 'Mascotas' },
        1,
        // A root: it is copied as written, and never expanded.
        [PETS]
      );
      const beauty = await addChainSection(
        before,
        chain,
        'belleza',
        { es: 'Belleza' },
        2,
        [FACIAL, MILK]
      );
      // Covers nothing and is selected by nobody.
      await addChainSection(before, chain, 'ofertas', { es: 'Ofertas' }, 3, []);
      const theirs = await addChainSection(
        before,
        other,
        'lacteos',
        { es: 'Lácteos de la otra' },
        0,
        [MILK]
      );

      // Two shops of one chain, with different selections in different orders.
      await select(before, north, [beauty, dairy]);
      await select(before, south, [dairy, pets, beauty]);
      await select(before, elsewhere, [theirs]);

      pinned = await one(
        before,
        `INSERT INTO "items" ("name", "defaultUnit")
         VALUES ('{"es":"Leche fijada"}'::jsonb, 'UNIT') RETURNING "id"::text AS "id"`,
        []
      );
      await before.query(
        `INSERT INTO "supermarket_item_sections" ("supermarketId", "itemId", "sectionId")
         VALUES ($1, $2, $3)`,
        [chain, pinned, dairy]
      );

      oldRowsBefore = await oldRows(before);
    } finally {
      await before.destroy();
    }

    db = await connect(THROUGH);
    await db.runMigrations();
  }, 300_000);

  afterAll(async () => {
    if (db?.isInitialized) {
      await db.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
      await db.destroy();
    }
  });

  it('is the last step of the prefix it is tested through', () => {
    expect(AT).toBeGreaterThan(0);
    expect(THROUGH[THROUGH.length - 1]).toBe(SectionsOfAShop1759000000000);
    expect(BEFORE).not.toContain(SectionsOfAShop1759000000000);
  });

  it('seeded what plan 0167 left: 5 sections, 5 categories, 6 selections and 1 pin', () => {
    expect(
      Object.fromEntries(
        Object.entries(oldRowsBefore).map(([table, rows]) => [
          table,
          rows.length,
        ])
      )
    ).toEqual({
      supermarket_sections: 5,
      section_categories: 5,
      location_sections: 6,
      supermarket_item_sections: 1,
    });
  });

  it('copies the selection of each shop, in the order of that shop', async () => {
    expect(await copiesOf(north)).toEqual([
      {
        slug: 'belleza',
        name: { es: 'Belleza' },
        position: 0,
        categories: sorted([FACIAL, MILK]),
      },
      {
        slug: 'lacteos',
        name: { es: 'Lácteos', en: 'Dairy' },
        position: 1,
        categories: [MILK],
      },
    ]);
    expect(await copiesOf(south)).toEqual([
      {
        slug: 'lacteos',
        name: { es: 'Lácteos', en: 'Dairy' },
        position: 0,
        categories: [MILK],
      },
      {
        slug: 'mascotas',
        name: { es: 'Mascotas' },
        position: 1,
        categories: [PETS],
      },
      {
        slug: 'belleza',
        name: { es: 'Belleza' },
        position: 2,
        categories: sorted([FACIAL, MILK]),
      },
    ]);
    expect(await copiesOf(elsewhere)).toEqual([
      {
        slug: 'lacteos',
        name: { es: 'Lácteos de la otra' },
        position: 0,
        categories: [MILK],
      },
    ]);
  });

  it('gives two shops that selected one chain section a row each', async () => {
    const rows = (await db.query(
      `SELECT "id"::text AS "id", "supermarketLocationId"::text AS "shop"
         FROM "shop_sections" WHERE "slug" = 'belleza'`
    )) as { id: string; shop: string }[];
    expect(sorted(rows.map((row) => row.shop))).toEqual(sorted([north, south]));
    expect(new Set(rows.map((row) => row.id)).size).toBe(2);
  });

  it('copies one row for each selection and one for each category of a selected section', async () => {
    // 2 + 3 + 1 selections. Their categories: 2 + 1, then 1 + 1 + 2, then 1.
    expect(await count('shop_sections')).toBe(6);
    expect(await count('shop_section_categories')).toBe(8);
  });

  it('gives a shop that selected nothing no section, whatever its chain holds', async () => {
    expect(await copiesOf(empty)).toEqual([]);
    // The section nobody selected was copied to no shop.
    const [{ offers }] = (await db.query(
      `SELECT count(*)::int AS "offers" FROM "shop_sections" WHERE "slug" = 'ofertas'`
    )) as { offers: number }[];
    expect(offers).toBe(0);
  });

  it('copies no pin: a product is in a section through a category alone', async () => {
    const columns = (await db.query(
      `SELECT table_name AS "table", column_name AS "column"
         FROM information_schema.columns
        WHERE table_schema = $1 AND table_name = ANY($2) AND column_name = 'itemId'`,
      [SCHEMA, NEW_TABLES]
    )) as unknown[];
    expect(columns).toEqual([]);
  });

  it('deletes and changes no row of the four old tables', async () => {
    expect(await oldRows(db)).toEqual(oldRowsBefore);
  });

  it('keeps the old tables and their two triggers', async () => {
    expect(await present(OLD_TABLES)).toEqual(sorted([...OLD_TABLES]));
    const triggers = (await db.query(
      `SELECT t.tgname AS "name" FROM pg_trigger t
         JOIN pg_class c ON c.oid = t.tgrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = $1 AND t.tgname = ANY($2) ORDER BY 1`,
      [SCHEMA, OLD_TRIGGERS]
    )) as { name: string }[];
    expect(triggers.map((row) => row.name)).toEqual(OLD_TRIGGERS);
  });

  it('needs no trigger of its own', async () => {
    const triggers = (await db.query(
      `SELECT t.tgname AS "name" FROM pg_trigger t
         JOIN pg_class c ON c.oid = t.tgrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = $1 AND c.relname = ANY($2) AND NOT t.tgisinternal`,
      [SCHEMA, NEW_TABLES]
    )) as unknown[];
    expect(triggers).toEqual([]);
  });

  it('removes the two new tables on down, restores nothing, and runs up again', async () => {
    await db.undoLastMigration();
    expect(await present(NEW_TABLES)).toEqual([]);
    expect(await oldRows(db)).toEqual(oldRowsBefore);

    await db.runMigrations();
    expect(await present(NEW_TABLES)).toEqual(sorted(NEW_TABLES));
    // The same copies again, from the rows that were never removed.
    expect(await count('shop_sections')).toBe(6);
    expect(await count('shop_section_categories')).toBe(8);
    expect((await copiesOf(north)).map((row) => row.slug)).toEqual([
      'belleza',
      'lacteos',
    ]);
    expect(await oldRows(db)).toEqual(oldRowsBefore);
  });
});
