import {
  describeIntegration,
  requiredEnv,
} from '@portfolio/luna-shopper/test-fixtures/jest';
import { DataSource } from 'typeorm';
import { CATALOG_MIGRATIONS } from './migrations';
import { LANDING_LEAVES, ROOTS } from './migrations/1758100000000-CategoryTree';
import {
  DIA_CATEGORY_TREE,
  DIA_ROOT_TO_FIRST_ROOT,
  DiaCategoryTree1758500000000,
  LEAF_REMAP,
  ROOT_REMAP,
} from './migrations/1758500000000-DiaCategoryTree';
import { categoryId } from './reference/ids';

/**
 * The migration that swaps the first category tree for DIA's, against real
 * Postgres (plan 0173, sections 4 and 10).
 *
 * Three databases, each a scratch schema of its own migrated through a
 * **prefix** of the list and dropped afterwards:
 *
 * - one that ran the first tree's migration and then gained a few of the seed's
 *   leaves, products and shop sections, which is a developer's slot. It goes
 *   up, down and up again.
 * - a fresh one, where products still carry the old enum column and both
 *   migrations run in the same deploy, which is what a cluster does.
 * - one holding all eighty four leaves of the first tree, with a product and a
 *   section on every row, so every line of appendix C is exercised.
 *
 *   LUNA_INTEGRATION=1 CATALOG_DB_URL=postgres://luna_catalog:luna_catalog@localhost:<port>/luna_catalog \
 *     npx nx run luna-shopper-backend-catalog:test-integration --testFile=dia-category-tree-migration.integration.spec.ts
 */
const SCHEMA = 'plan0173_migration_test';

const indexOf = (name: string) =>
  CATALOG_MIGRATIONS.findIndex((m) => m.name === name);
const THROUGH = CATALOG_MIGRATIONS.slice(
  0,
  indexOf('DiaCategoryTree1758500000000') + 1
);
const BEFORE = THROUGH.slice(0, -1);
/** Everything before the first tree's own migration: the enum column. */
const BEFORE_FIRST_TREE = CATALOG_MIGRATIONS.slice(
  0,
  indexOf('CategoryTree1758100000000')
);

/**
 * The first tree as the reference seed wrote it, root by root. It left
 * `db/reference/categories.ts` with this plan, so it is stated here, where it
 * is history. The keys are `ROOT_REMAP`'s and the leaves are `LEAF_REMAP`'s.
 */
const FIRST_TREE: Record<string, string[]> = {
  'fruit-and-vegetables': [
    'fruit',
    'vegetables',
    'salads-and-herbs',
    'nuts-and-dried-fruit',
    'other-produce',
  ],
  meat: [
    'poultry',
    'pork',
    'beef-and-lamb',
    'minced-and-burgers',
    'other-meat',
  ],
  'cold-cuts-and-cheese': [
    'cured-ham-and-sausages',
    'sliced-cold-cuts',
    'cheese',
    'pates-and-spreads',
    'other-cold-cuts',
  ],
  'fish-and-seafood': [
    'fresh-fish',
    'shellfish',
    'smoked-and-salted-fish',
    'other-seafood',
  ],
  'dairy-and-eggs': [
    'milk',
    'plant-drinks',
    'yogurts-and-desserts',
    'butter-and-cream',
    'eggs',
    'other-dairy',
  ],
  bakery: [
    'bread',
    'pastries-and-cakes',
    'toasts-and-crispbread',
    'other-bakery',
  ],
  'breakfast-and-sweets': [
    'cereals',
    'biscuits',
    'jam-honey-and-spreads',
    'chocolate-and-sweets',
    'coffee-tea-and-cocoa',
    'other-breakfast',
  ],
  pantry: [
    'pasta-rice-and-legumes',
    'canned-food',
    'oil-and-vinegar',
    'sauces-and-condiments',
    'flour-sugar-and-baking',
    'spices-and-salt',
    'soups-and-stock',
    'other-pantry',
  ],
  frozen: [
    'frozen-vegetables',
    'frozen-fish-and-seafood',
    'frozen-meals-and-pizzas',
    'ice-cream',
    'other-frozen',
  ],
  'ready-meals': [
    'pizzas',
    'prepared-dishes',
    'salads-and-sandwiches',
    'fresh-pasta-and-dough',
    'other-ready-meals',
  ],
  snacks: ['crisps', 'salty-snacks', 'olives-and-pickles', 'other-snacks'],
  drinks: [
    'water',
    'soft-drinks',
    'juices',
    'beer',
    'wine-and-cava',
    'spirits',
    'other-drinks',
  ],
  baby: ['baby-food', 'nappies-and-wipes', 'other-baby'],
  pets: ['dogs', 'cats', 'other-pets'],
  household: [
    'cleaning',
    'laundry',
    'dishwashing',
    'paper-and-wipes',
    'bags-foil-and-wrap',
    'other-household',
  ],
  'personal-care': [
    'hair',
    'skin-and-body',
    'oral-care',
    'shaving-and-deodorant',
    'feminine-care',
    'pharmacy',
    'other-personal-care',
  ],
  other: ['uncategorised'],
};
const FIRST_ROOTS = Object.keys(FIRST_TREE);
const FIRST_LEAVES = Object.values(FIRST_TREE).flat();
const FIRST_ROOT_OF = new Map(
  Object.entries(FIRST_TREE).flatMap(([root, leaves]) =>
    leaves.map((leaf) => [leaf, root] as const)
  )
);

interface TreeRow {
  id: string;
  parentId: string | null;
  slug: string;
  name: { en: string; es: string };
  position: number;
}

const bySlug = (a: TreeRow, b: TreeRow) => a.slug.localeCompare(b.slug);

/** Appendix A as the rows the table should hold. */
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

/** The twenty nine rows the first tree's migration inserted. */
const FIRST_MIGRATION_ROWS: TreeRow[] = [
  ...ROOTS.map((root, position) => ({
    id: categoryId(root.slug),
    parentId: null,
    slug: root.slug,
    name: root.name,
    position,
  })),
  ...LANDING_LEAVES.map((leaf) => ({
    id: categoryId(leaf.slug),
    parentId: categoryId(leaf.root),
    slug: leaf.slug,
    name: leaf.name,
    position: leaf.position,
  })),
].sort(bySlug);

/** A list with its repeats dropped, the first of each kept. */
const distinct = (slugs: string[]) => [...new Set(slugs)];

/** Where `down` puts a product that sat on a leaf of this DIA root. */
function landingLeafOfDiaRoot(diaRoot: string): string {
  const firstRoot = DIA_ROOT_TO_FIRST_ROOT[diaRoot];
  return (
    LANDING_LEAVES.find((leaf) => leaf.root === firstRoot)?.slug ??
    'uncategorised'
  );
}
const DIA_ROOT_OF = new Map(
  DIA_CATEGORY_TREE.flatMap((root) =>
    root.children.map((leaf) => [leaf.slug, root.slug] as const)
  )
);

describeIntegration('the DIA category tree migration (real Postgres)', () => {
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

  /** A scratch schema migrated through `prefix`, then handed to `seed`. */
  async function migrated(
    schema: string,
    prefix: typeof CATALOG_MIGRATIONS,
    seed: (db: DataSource) => Promise<void>
  ): Promise<DataSource> {
    const bootstrap = new DataSource({ type: 'postgres', url: url() });
    await bootstrap.initialize();
    await bootstrap.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await bootstrap.query(`CREATE SCHEMA "${schema}"`);
    await bootstrap.destroy();

    const before = await connect(schema, prefix);
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

  // --- Seeding, in the first tree's own words -------------------------------

  /** A first tree leaf the way the reference seed added it. */
  async function addFirstLeaf(db: DataSource, slug: string): Promise<void> {
    const root = FIRST_ROOT_OF.get(slug) as string;
    await db.query(
      `INSERT INTO "categories" ("id", "parentId", "slug", "name", "position")
       VALUES ($1, $2, $3, $4::jsonb, $5)
       ON CONFLICT ("id") DO NOTHING`,
      [
        categoryId(slug),
        categoryId(root),
        slug,
        JSON.stringify({ en: slug, es: slug }),
        FIRST_TREE[root].indexOf(slug),
      ]
    );
  }

  async function addProduct(
    db: DataSource,
    name: string,
    slugs: string[]
  ): Promise<void> {
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
  }

  async function addChain(db: DataSource): Promise<string> {
    const [{ id }] = await db.query(
      `INSERT INTO "supermarkets" ("name")
       VALUES ('{"es":"Cadena"}'::jsonb) RETURNING "id"`
    );
    return id;
  }

  async function addSection(
    db: DataSource,
    chain: string,
    slug: string,
    slugs: string[]
  ): Promise<void> {
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
  }

  // --- Reading back ----------------------------------------------------------

  async function tree(db: DataSource): Promise<TreeRow[]> {
    const rows: TreeRow[] = await db.query(
      `SELECT "id", "parentId", "slug", "name", "position" FROM "categories"`
    );
    return rows.sort(bySlug);
  }

  /** Every product's categories by slug, in position order, with the positions. */
  async function products(
    db: DataSource
  ): Promise<Map<string, { slugs: string[]; positions: number[] }>> {
    const rows: { es: string; slug: string; position: number }[] =
      await db.query(
        `SELECT i."name" ->> 'es' AS "es", c."slug", ic."position"
           FROM "items" i
           JOIN "item_categories" ic ON ic."itemId" = i."id"
           JOIN "categories" c ON c."id" = ic."categoryId"
          ORDER BY i."id", ic."position"`
      );
    const out = new Map<string, { slugs: string[]; positions: number[] }>();
    for (const row of rows) {
      const entry = out.get(row.es) ?? { slugs: [], positions: [] };
      entry.slugs.push(row.slug);
      entry.positions.push(row.position);
      out.set(row.es, entry);
    }
    return out;
  }

  /** Every section's categories by slug, sorted. */
  async function sections(db: DataSource): Promise<Map<string, string[]>> {
    const rows: { section: string; slug: string }[] = await db.query(
      `SELECT s."slug" AS "section", c."slug"
         FROM "supermarket_sections" s
         JOIN "section_categories" sc ON sc."sectionId" = s."id"
         JOIN "categories" c ON c."id" = sc."categoryId"`
    );
    const out = new Map<string, string[]>();
    for (const row of rows) {
      out.set(row.section, [...(out.get(row.section) ?? []), row.slug]);
    }
    // Sorted here and not by the database, whose collation is its own.
    for (const slugs of out.values()) slugs.sort();
    return out;
  }

  async function expectDensePositions(db: DataSource): Promise<void> {
    for (const [name, entry] of await products(db)) {
      expect(`${name}: ${entry.positions}`).toBe(
        `${name}: ${entry.slugs.map((_, index) => index)}`
      );
    }
  }

  async function count(db: DataSource, table: string): Promise<number> {
    const [{ n }] = await db.query(
      `SELECT count(*)::int AS "n" FROM "${table}"`
    );
    return n;
  }

  it('is the last step of the prefix it is tested through', () => {
    expect(THROUGH[THROUGH.length - 1]).toBe(DiaCategoryTree1758500000000);
    expect(BEFORE).not.toContain(DiaCategoryTree1758500000000);
    expect(BEFORE_FIRST_TREE.map((m) => m.name)).not.toContain(
      'CategoryTree1758100000000'
    );
  });

  it('states the first tree the way appendix C does', () => {
    expect(FIRST_ROOTS).toEqual(Object.keys(ROOT_REMAP));
    expect(FIRST_ROOTS).toEqual(ROOTS.map((root) => root.slug));
    expect(FIRST_LEAVES).toEqual(Object.keys(LEAF_REMAP));
    expect(FIRST_LEAVES).toHaveLength(84);
  });

  describe('a database that ran the first tree and holds products and sections', () => {
    let db: DataSource;

    const PRODUCTS: Record<string, string[]> = {
      'On a split leaf': ['cheese'],
      'On a catch all': ['other-dairy'],
      'On vegetables': ['vegetables'],
      'On two children of frozen': ['frozen-vegetables', 'ice-cream'],
      'On rows both trees name': ['pork', 'milk'],
      'On two leaves with one target': ['other-dairy', 'milk', 'vegetables'],
      'On a repeat in the middle': [
        'cheese',
        'other-meat',
        'pork',
        'other-pantry',
      ],
    };
    const SECTIONS: Record<string, string[]> = {
      'on-a-root': ['meat'],
      'on-a-leaf': ['cheese'],
      'on-vegetables': ['vegetables'],
      'on-a-root-and-its-leaves': [
        'fruit-and-vegetables',
        'vegetables',
        'other-produce',
        'fish-and-seafood',
      ],
      'on-frozen': ['frozen', 'other-frozen'],
    };

    beforeAll(async () => {
      db = await migrated(`${SCHEMA}_slot`, BEFORE, async (before) => {
        for (const slug of distinct(Object.values(PRODUCTS).flat())) {
          await addFirstLeaf(before, slug);
        }
        for (const [name, slugs] of Object.entries(PRODUCTS)) {
          await addProduct(before, name, slugs);
        }
        const chain = await addChain(before);
        for (const [slug, slugs] of Object.entries(SECTIONS)) {
          await addSection(before, chain, slug, slugs);
        }
        // A row added by hand in the back office, holding nothing.
        await before.query(
          `INSERT INTO "categories" ("parentId", "slug", "name", "position")
           VALUES ($1, 'added-by-hand', '{"en":"By hand"}'::jsonb, 9)`,
          [categoryId('pantry')]
        );
      });
      await db.runMigrations();
    }, 300_000);

    it('holds exactly the tree of appendix A', async () => {
      const rows = await tree(db);
      expect(rows).toHaveLength(275);
      expect(rows.filter((row) => row.parentId === null)).toHaveLength(29);
      expect(rows.filter((row) => row.parentId !== null)).toHaveLength(246);
      expect(rows).toEqual(DIA_ROWS);
    });

    it('leaves no row only the first tree named, nor the one added by hand', async () => {
      const named = new Set(DIA_ROWS.map((row) => row.slug));
      const gone = [...FIRST_ROOTS, ...FIRST_LEAVES, 'added-by-hand'].filter(
        (slug) => !named.has(slug)
      );
      const left: { slug: string }[] = await db.query(
        `SELECT "slug" FROM "categories" WHERE "slug" = ANY($1)`,
        [gone]
      );
      expect(left).toEqual([]);
    });

    it('makes a root of vegetables under the id it had as a leaf', async () => {
      const [row] = await db.query(
        `SELECT "id", "parentId", "name" FROM "categories" WHERE "slug" = 'vegetables'`
      );
      expect(row).toEqual({
        id: categoryId('vegetables'),
        parentId: null,
        name: { en: 'Vegetables', es: 'Verduras' },
      });
    });

    it('puts every product where appendix C says', async () => {
      const after = await products(db);
      const slugs = Object.fromEntries(
        [...after].map(([name, entry]) => [name, entry.slugs])
      );
      expect(slugs).toEqual({
        'On a split leaf': ['semi-cured'],
        'On a catch all': ['uncategorised'],
        'On vegetables': ['uncategorised'],
        'On two children of frozen': [
          'frozen-and-steamed-vegetables',
          'ice-creams-and-ice',
        ],
        'On rows both trees name': ['pork', 'milk'],
        // The second `uncategorised` is dropped, the first keeps its place.
        'On two leaves with one target': ['uncategorised', 'milk'],
        'On a repeat in the middle': ['semi-cured', 'uncategorised', 'pork'],
      });
      // The same answer, read out of the map.
      for (const [name, before] of Object.entries(PRODUCTS)) {
        expect(slugs[name]).toEqual(
          distinct(before.map((slug) => LEAF_REMAP[slug]))
        );
      }
    });

    it('numbers every product from 0 with no gap', async () => {
      await expectDensePositions(db);
    });

    it('moves every section, a root to a root and a leaf to a leaf, once each', async () => {
      expect(Object.fromEntries(await sections(db))).toEqual({
        'on-a-root': ['meats'],
        'on-a-leaf': ['semi-cured'],
        // Appendix C sends the leaf `vegetables` to `uncategorised`, and a
        // section follows it there.
        'on-vegetables': ['uncategorised'],
        // The root went to the root `vegetables`, and the two leaves to one row.
        'on-a-root-and-its-leaves': [
          'fish-and-seafood',
          'uncategorised',
          'vegetables',
        ],
        'on-frozen': ['frozen-foods-and-ice-cream', 'uncategorised'],
      });
    });

    it('leaves its scratch tables behind nowhere', async () => {
      const left: { relname: string }[] = await db.query(
        `SELECT relname FROM pg_class WHERE relname LIKE 'dia_tree_%'`
      );
      expect(left).toEqual([]);
    });

    it('down restores the shape of the first migration, and up runs again', async () => {
      await db.undoLastMigration();

      expect(await tree(db)).toEqual(FIRST_MIGRATION_ROWS);
      const back = await products(db);
      expect(
        Object.fromEntries(
          [...back].map(([name, entry]) => [name, entry.slugs])
        )
      ).toEqual({
        // `cold-cuts-and-cheese` never had a landing leaf.
        'On a split leaf': ['uncategorised'],
        'On a catch all': ['uncategorised'],
        'On vegetables': ['uncategorised'],
        'On two children of frozen': ['other-produce', 'other-frozen'],
        'On rows both trees name': ['other-meat', 'other-dairy'],
        'On two leaves with one target': ['uncategorised', 'other-dairy'],
        'On a repeat in the middle': ['uncategorised', 'other-meat'],
      });
      await expectDensePositions(db);
      expect(Object.fromEntries(await sections(db))).toEqual({
        'on-a-root': ['meat'],
        'on-a-leaf': ['uncategorised'],
        'on-vegetables': ['uncategorised'],
        'on-a-root-and-its-leaves': [
          'fish-and-seafood',
          'fruit-and-vegetables',
          'uncategorised',
        ],
        'on-frozen': ['frozen', 'uncategorised'],
      });

      await db.runMigrations();
      expect(await tree(db)).toEqual(DIA_ROWS);
      for (const [name, entry] of await products(db)) {
        // Every landing leaf but `uncategorised` is a catch all, so the second
        // pass ends with every product there.
        expect(`${name}: ${entry.slugs}`).toBe(`${name}: uncategorised`);
      }
      expect(await count(db, 'items')).toBe(Object.keys(PRODUCTS).length);
    }, 120_000);
  });

  describe('a fresh database, both migrations in one deploy', () => {
    let db: DataSource;

    beforeAll(async () => {
      db = await migrated(
        `${SCHEMA}_fresh`,
        BEFORE_FIRST_TREE,
        async (before) => {
          for (const leaf of LANDING_LEAVES) {
            await before.query(
              `INSERT INTO "items" ("name", "category", "defaultUnit")
               VALUES ($1::jsonb, $2, 'UNIT')`,
              [JSON.stringify({ es: leaf.from }), leaf.from]
            );
          }
        }
      );
      await db.runMigrations();
    }, 300_000);

    it('holds exactly the tree of appendix A', async () => {
      expect(await tree(db)).toEqual(DIA_ROWS);
    });

    it('moves each old enum value on to the target of its landing leaf', async () => {
      const after = await products(db);
      expect(after.size).toBe(LANDING_LEAVES.length);
      for (const leaf of LANDING_LEAVES) {
        const entry = after.get(leaf.from);
        expect(`${leaf.from} -> ${entry?.slugs}@${entry?.positions}`).toBe(
          `${leaf.from} -> ${LEAF_REMAP[leaf.slug]}@0`
        );
      }
      // Every landing leaf is a catch all, so in a cluster that is one answer.
      expect(
        distinct(LANDING_LEAVES.map((leaf) => LEAF_REMAP[leaf.slug]))
      ).toEqual(['uncategorised']);
    });
  });

  describe('a database the reference seed gave all eighty four leaves', () => {
    let db: DataSource;

    beforeAll(async () => {
      db = await migrated(`${SCHEMA}_seeded`, BEFORE, async (before) => {
        for (const slug of FIRST_LEAVES) await addFirstLeaf(before, slug);
        for (const slug of FIRST_LEAVES) {
          await addProduct(before, `On ${slug}`, [slug]);
        }
        await addProduct(before, 'On every leaf', FIRST_LEAVES);
        const chain = await addChain(before);
        for (const slug of [...FIRST_ROOTS, ...FIRST_LEAVES]) {
          // A leaf and a root never share a slug but `vegetables` will, so the
          // section's own slug says which level it covered.
          const level = FIRST_TREE[slug] ? 'root' : 'leaf';
          await addSection(before, chain, `${level}-${slug}`, [slug]);
        }
        await addSection(before, chain, 'everything', [
          ...FIRST_ROOTS,
          ...FIRST_LEAVES,
        ]);
      });
      expect(await count(db, 'categories')).toBe(101);
      await db.runMigrations();
    }, 300_000);

    it('holds exactly the tree of appendix A', async () => {
      expect(await tree(db)).toEqual(DIA_ROWS);
    });

    it('puts the product of every first tree leaf on its appendix C target', async () => {
      const after = await products(db);
      for (const slug of FIRST_LEAVES) {
        const entry = after.get(`On ${slug}`);
        expect(`${slug} -> ${entry?.slugs}@${entry?.positions}`).toBe(
          `${slug} -> ${LEAF_REMAP[slug]}@0`
        );
      }
    });

    it('keeps the first of each target, in order, for a product on every leaf', async () => {
      const entry = (await products(db)).get('On every leaf');
      const expected = distinct(FIRST_LEAVES.map((slug) => LEAF_REMAP[slug]));
      // Nineteen leaves go to `uncategorised`, and no two others share a target.
      expect(expected).toHaveLength(84 - 19 + 1);
      expect(entry?.slugs).toEqual(expected);
      expect(entry?.positions).toEqual(expected.map((_, index) => index));
    });

    it('moves the section of every first tree row', async () => {
      const after = await sections(db);
      for (const slug of FIRST_ROOTS) {
        expect(`${slug} -> ${after.get(`root-${slug}`)}`).toBe(
          `${slug} -> ${ROOT_REMAP[slug]}`
        );
      }
      for (const slug of FIRST_LEAVES) {
        expect(`${slug} -> ${after.get(`leaf-${slug}`)}`).toBe(
          `${slug} -> ${LEAF_REMAP[slug]}`
        );
      }
      expect(after.get('everything')).toEqual(
        distinct([
          ...FIRST_ROOTS.map((slug) => ROOT_REMAP[slug]),
          ...FIRST_LEAVES.map((slug) => LEAF_REMAP[slug]),
        ]).sort()
      );
    });

    it('down lands every product on the landing leaf of its root', async () => {
      await db.undoLastMigration();
      expect(await tree(db)).toEqual(FIRST_MIGRATION_ROWS);
      const back = await products(db);
      for (const slug of FIRST_LEAVES) {
        const diaRoot = DIA_ROOT_OF.get(LEAF_REMAP[slug]) as string;
        const entry = back.get(`On ${slug}`);
        expect(`${slug} -> ${entry?.slugs}@${entry?.positions}`).toBe(
          `${slug} -> ${landingLeafOfDiaRoot(diaRoot)}@0`
        );
      }
      await expectDensePositions(db);
      const after = await sections(db);
      for (const slug of FIRST_ROOTS) {
        expect(`${slug} -> ${after.get(`root-${slug}`)}`).toBe(
          `${slug} -> ${DIA_ROOT_TO_FIRST_ROOT[ROOT_REMAP[slug]]}`
        );
      }
    }, 120_000);
  });

  describe('a row added by hand that still holds a product', () => {
    it('fails the migration whole and changes nothing', async () => {
      const db = await migrated(`${SCHEMA}_refused`, BEFORE, async (before) => {
        const [{ id }] = await before.query(
          `INSERT INTO "categories" ("parentId", "slug", "name", "position")
           VALUES ($1, 'added-by-hand', '{"en":"By hand"}'::jsonb, 9)
           RETURNING "id"`,
          [categoryId('pantry')]
        );
        const [{ id: item }] = await before.query(
          `INSERT INTO "items" ("name", "defaultUnit")
           VALUES ('{"es":"A mano"}'::jsonb, 'UNIT') RETURNING "id"`
        );
        await before.query(
          `INSERT INTO "item_categories" ("itemId", "categoryId", "position")
           VALUES ($1, $2, 0)`,
          [item, id]
        );
      });
      const failure = await db.runMigrations().then(
        () => null,
        (error: { driverError?: { code?: string; constraint?: string } }) => ({
          code: error.driverError?.code,
          constraint: error.driverError?.constraint,
        })
      );
      expect(failure).toEqual({
        code: '23503',
        constraint: 'fk_item_categories_category',
      });
      expect(await tree(db)).toHaveLength(30);
    }, 300_000);
  });
});
