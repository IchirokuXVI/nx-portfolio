import { JwtService } from '@nestjs/jwt';
import {
  CategoryInUseException,
  CategoryNotFoundException,
  NotFoundException,
  SectionNotFoundException,
  SectionOfAnotherShopException,
  SectionSlugTakenException,
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
  CATALOG_ENTITIES,
  Category,
  ShopSection,
  Supermarket,
  SupermarketLocation,
} from '../entities';
import { CatalogAuditService } from './catalog-audit.service';
import { CategoryService } from './category.service';
import { PlatformAdminService } from './platform-admin.service';
import { ITEMS_AT_LOCATION_SQL, SectionService } from './section.service';

/**
 * The sections of a shop through the service, against real Postgres (plan
 * 0167, as plan 0200 left it).
 *
 * What this file proves:
 *
 * - the read is one statement, on the example plan 0167 states (a frozen pizza
 *   on `pizzas-and-doughs`, under the root `frozen-foods-and-ice-cream`, and
 *   on `frozen-pizzas`, under `prepared-meals-and-pizzas`)
 * - a shop with no rows in `shop_sections` has no sections, whatever its chain
 *   and the four old tables hold: nothing is inherited, no answer carries a
 *   `source`, and no product is `PINNED`
 * - the order of a shop is written in one statement that the deferrable
 *   constraint accepts, and it refuses a section of another shop
 * - a walk orders and creates the sections of the shop it walked, and deletes
 *   none
 *
 * It ends with the `EXPLAIN` of the read for 100 products at one shop.
 *
 * It works in a scratch schema of its own, seeded with the whole taxonomy, and
 * drops it afterwards.
 *
 *   LUNA_INTEGRATION=1 CATALOG_DB_URL=postgres://luna_catalog:luna_catalog@localhost:<port>/luna_catalog \
 *     npx nx run luna-shopper-backend-catalog:test-integration --testFile=section.integration.spec.ts
 */
const SCHEMA = 'plan0200_section_test';
const OWNER = 'ac700000-0000-4000-a000-000000000200';
const UNKNOWN_ITEM = 'ac700000-0000-4000-a000-00000000dead';

describeIntegration('the sections of a shop (real Postgres)', () => {
  let dataSource: DataSource;
  let sections: SectionService;
  let categories: CategoryService;

  let chainId: string;
  let otherChainId: string;
  /** A shop of the chain with four sections. */
  let configured: string;
  /** A shop of the same chain with no sections of its own. */
  let bare: string;
  /** Another shop of the same chain, with one section of its own. */
  let sibling: string;
  /** A shop of the other chain. */
  let foreignShop: string;

  /** The sections of the configured shop, by what they are in the fixture. */
  let pizzas: string;
  let frozen: string;
  let bakery: string;
  let promo: string;
  /** The one section of the sibling shop. It holds the slug `pizzas` too. */
  let siblingSection: string;

  /** The products. */
  let pizza: string;
  let iceCream: string;
  let milk: string;

  const leaf = (slug: string) => categoryId(slug);
  const as = { userId: OWNER };

  /** What a promise was rejected with, so a spec can read its class and details. */
  async function refusal(promise: Promise<unknown>): Promise<unknown> {
    try {
      await promise;
    } catch (error) {
      return error;
    }
    throw new Error('expected a refusal');
  }

  /** The Postgres error a statement fails with, or null when it succeeds. */
  async function sqlRefusal(
    sql: string,
    params: unknown[]
  ): Promise<{ code?: string; constraint?: string } | null> {
    try {
      await dataSource.query(sql, params);
      return null;
    } catch (error) {
      const driver = (
        error as { driverError?: { code?: string; constraint?: string } }
      ).driverError;
      return { code: driver?.code, constraint: driver?.constraint };
    }
  }

  async function product(name: string, slugs: string[]): Promise<string> {
    const [{ id }] = (await dataSource.query(
      `INSERT INTO "items" ("name", "defaultUnit")
       VALUES ($1::jsonb, 'UNIT') RETURNING "id"`,
      [JSON.stringify({ es: name })]
    )) as { id: string }[];
    await dataSource.query(
      `INSERT INTO "item_categories" ("itemId", "categoryId", "position")
       SELECT $1, v."categoryId", v."position" - 1
         FROM unnest($2::uuid[]) WITH ORDINALITY AS v("categoryId", "position")`,
      [id, slugs.map(leaf)]
    );
    return id;
  }

  async function chain(name: string): Promise<string> {
    const repo = dataSource.getRepository(Supermarket);
    return (
      await repo.save(
        repo.create({ name: { en: name, es: name }, externalBrandKey: null })
      )
    ).id;
  }

  async function shop(supermarketId: string, key: string): Promise<string> {
    const repo = dataSource.getRepository(SupermarketLocation);
    return (
      await repo.save(
        repo.create({
          supermarketId,
          label: { en: key, es: key },
          address: `Calle ${key}`,
          city: 'Córdoba',
          country: 'es',
          latitude: null,
          longitude: null,
          postalCode: null,
          postalCodeSource: null,
          externalRef: null,
          externalProvider: null,
        })
      )
    ).id;
  }

  async function section(
    supermarketLocationId: string,
    slug: string,
    categoryIds: string[],
    name: Record<string, string> = { es: slug, en: slug }
  ): Promise<string> {
    return (
      await sections.create({
        ...as,
        supermarketLocationId,
        slug,
        name,
        categoryIds,
      })
    ).id;
  }

  /** The ids of a shop's sections with their places, straight from the table. */
  async function stored(
    supermarketLocationId: string
  ): Promise<{ id: string; position: number }[]> {
    return (await dataSource.query(
      `SELECT "id"::text AS "id", "position" FROM "shop_sections"
        WHERE "supermarketLocationId" = $1 ORDER BY "position"`,
      [supermarketLocationId]
    )) as { id: string; position: number }[];
  }

  const orderOf = async (supermarketLocationId: string) =>
    (await sections.forLocation({ supermarketLocationId })).sections.map(
      (row) => row.id
    );

  const rule = (supermarketLocationId: string, itemIds: string[]) =>
    sections.itemsAtLocation({ supermarketLocationId, itemIds });

  const walk = (supermarketLocationId: string, names: string[]) =>
    dataSource.transaction((manager) =>
      sections.followWalk(manager, supermarketLocationId, names, 'es')
    );

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
    await dataSource.transaction((m) => seedTaxonomy(m));

    const admin = new PlatformAdminService(new JwtService(), {
      getOrThrow: () => ({ adminJwtPublicKey: '', serviceActorIds: [OWNER] }),
    } as never);
    const audit = new CatalogAuditService(dataSource);
    sections = new SectionService(
      dataSource.getRepository(ShopSection),
      admin,
      audit
    );
    categories = new CategoryService(
      dataSource.getRepository(Category),
      admin,
      audit
    );

    chainId = await chain('Section Mart');
    otherChainId = await chain('Other Mart');
    configured = await shop(chainId, 'configured');
    bare = await shop(chainId, 'bare');
    sibling = await shop(chainId, 'sibling');
    foreignShop = await shop(otherChainId, 'foreign');

    // Created in this order, so each goes after the one before it.
    pizzas = await section(configured, 'pizzas', [leaf('frozen-pizzas')]);
    frozen = await section(configured, 'frozen', [
      leaf('frozen-foods-and-ice-cream'),
    ]);
    bakery = await section(configured, 'bakery', [leaf('bakery')]);
    // Covers nothing, as a section that a map walk created does.
    promo = await section(configured, 'promo', []);
    // The same slug in another shop of the same chain, covering other things.
    siblingSection = await section(sibling, 'pizzas', [leaf('milk')]);

    // The configured shop is walked Frozen, then Pizzas, then Bakery. Promo is
    // not named, so it stays, after them.
    await sections.setForLocation({
      ...as,
      supermarketLocationId: configured,
      sectionIds: [frozen, pizzas, bakery],
    });

    pizza = await product('Pizza congelada', [
      'pizzas-and-doughs',
      'frozen-pizzas',
    ]);
    iceCream = await product('Helado', ['ice-creams-and-ice']);
    milk = await product('Leche', ['milk']);
  }, 180_000);

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
      await dataSource.destroy();
    }
  });

  describe('which sections a product is in', () => {
    it('covers a product through a leaf and through a root, in the shop order', async () => {
      const answer = await rule(configured, [pizza]);
      // Frozen covers the root of `pizzas-and-doughs`, Pizzas covers the
      // leaf `frozen-pizzas`, and the shop walks Frozen first.
      expect(answer).toEqual({
        items: [
          { itemId: pizza, step: 'COVERED', sectionIds: [frozen, pizzas] },
        ],
      });
      expect(answer).not.toHaveProperty('source');
    });

    it('covers a product through a root alone', async () => {
      const answer = await rule(configured, [iceCream]);
      expect(answer.items).toEqual([
        { itemId: iceCream, step: 'COVERED', sectionIds: [frozen] },
      ]);
    });

    it('answers nothing for a product no section covers, and for an unknown id', async () => {
      const answer = await rule(configured, [milk, UNKNOWN_ITEM, 'not-a-uuid']);
      expect(answer.items).toEqual([
        { itemId: milk, step: 'NONE', sectionIds: [] },
        { itemId: UNKNOWN_ITEM, step: 'NONE', sectionIds: [] },
        { itemId: 'not-a-uuid', step: 'NONE', sectionIds: [] },
      ]);
    });

    it('gives a shop with no sections of its own none, whatever its chain holds', async () => {
      const answer = await rule(bare, [pizza, iceCream, milk]);
      expect(answer).toEqual({
        items: [
          { itemId: pizza, step: 'NONE', sectionIds: [] },
          { itemId: iceCream, step: 'NONE', sectionIds: [] },
          { itemId: milk, step: 'NONE', sectionIds: [] },
        ],
      });
    });

    it('reads the sections of the shop asked about, and of no other shop of the chain', async () => {
      // The sibling's one section covers `milk`. The four sections of the
      // configured shop say nothing there.
      const answer = await rule(sibling, [pizza, milk]);
      expect(answer.items).toEqual([
        { itemId: pizza, step: 'NONE', sectionIds: [] },
        { itemId: milk, step: 'COVERED', sectionIds: [siblingSection] },
      ]);
    });

    it('answers one entry per distinct id, in the order first asked', async () => {
      const answer = await rule(configured, [milk, pizza, milk, iceCream]);
      expect(answer.items.map((entry) => entry.itemId)).toEqual([
        milk,
        pizza,
        iceCream,
      ]);
    });

    it('answers no entry for a read with no products', async () => {
      expect(await rule(configured, [])).toEqual({ items: [] });
    });

    it('refuses an unknown shop with the ordinary not found', async () => {
      expect(
        await refusal(rule('ac700000-0000-4000-a000-00000000beef', [pizza]))
      ).toBeInstanceOf(NotFoundException);
    });
  });

  describe('the four old tables are read by nothing', () => {
    let oldSection: string;

    beforeAll(async () => {
      // What plan 0167 left in a database: a section of the chain that covers
      // `milk`, selected by the bare shop, with the milk pinned to it.
      const [{ id }] = (await dataSource.query(
        `INSERT INTO "supermarket_sections" ("supermarketId", "slug", "name", "position")
         VALUES ($1, 'old-dairy', '{"es":"Lácteos de la cadena"}'::jsonb, 0)
         RETURNING "id"::text AS "id"`,
        [chainId]
      )) as { id: string }[];
      oldSection = id;
      await dataSource.query(
        `INSERT INTO "section_categories" ("sectionId", "categoryId") VALUES ($1, $2)`,
        [oldSection, leaf('milk')]
      );
      await dataSource.query(
        `INSERT INTO "location_sections" ("supermarketLocationId", "sectionId", "position")
         VALUES ($1, $2, 0)`,
        [bare, oldSection]
      );
      await dataSource.query(
        `INSERT INTO "supermarket_item_sections" ("supermarketId", "itemId", "sectionId")
         VALUES ($1, $2, $3)`,
        [chainId, milk, oldSection]
      );
    });

    afterAll(async () => {
      await dataSource.query(
        `DELETE FROM "supermarket_sections" WHERE "id" = $1`,
        [oldSection]
      );
    });

    it('a selection and a section of the chain give the shop no section', async () => {
      const view = await sections.forLocation({ supermarketLocationId: bare });
      expect(view).toEqual({ sections: [] });
      const names = await sections.namesForLocations({
        supermarketLocationIds: [bare],
      });
      expect(names.locations[bare]).toEqual([]);
    });

    it('a pin places no product, in the shop that selected the section or in another', async () => {
      for (const shopId of [bare, configured]) {
        const answer = await rule(shopId, [milk]);
        expect(answer.items).toEqual([
          { itemId: milk, step: 'NONE', sectionIds: [] },
        ]);
      }
    });

    it('an old section is not a section any more', async () => {
      expect(
        await refusal(sections.get({ ...as, sectionId: oldSection }))
      ).toBeInstanceOf(SectionNotFoundException);
      expect(
        await refusal(
          sections.setForLocation({
            ...as,
            supermarketLocationId: bare,
            sectionIds: [oldSection],
          })
        )
      ).toBeInstanceOf(SectionNotFoundException);
    });
  });

  describe('the sections of one shop', () => {
    it('reads them in the shop order with the categories each covers', async () => {
      const view = await sections.forLocation({
        supermarketLocationId: configured,
      });
      expect(view).not.toHaveProperty('source');
      expect(view.sections.map((row) => row.id)).toEqual([
        frozen,
        pizzas,
        bakery,
        promo,
      ]);
      expect(view.sections.map((row) => row.position)).toEqual([0, 1, 2, 3]);
      expect(view.sections[0]).toEqual({
        id: frozen,
        supermarketLocationId: configured,
        slug: 'frozen',
        name: { es: 'frozen', en: 'frozen' },
        position: 0,
        categoryIds: [leaf('frozen-foods-and-ice-cream')],
      });
    });

    it('reads none for a shop that has none', async () => {
      expect(
        await sections.forLocation({ supermarketLocationId: bare })
      ).toEqual({ sections: [] });
      expect(
        await sections.forLocation({ supermarketLocationId: foreignShop })
      ).toEqual({ sections: [] });
    });

    it('refuses a section of another shop of the same chain, naming it', async () => {
      const refused = await refusal(
        sections.setForLocation({
          ...as,
          supermarketLocationId: configured,
          sectionIds: [frozen, siblingSection],
        })
      );
      expect(refused).toBeInstanceOf(SectionOfAnotherShopException);
      expect(refused).toMatchObject({
        code: 'section_of_another_shop',
        details: { sectionIds: [siblingSection] },
      });
      // Nothing moved.
      expect(await orderOf(configured)).toEqual([
        frozen,
        pizzas,
        bakery,
        promo,
      ]);
    });

    it('refuses an unknown section, naming it', async () => {
      const missing = 'ac700000-0000-4000-a000-00000000f00d';
      const refused = await refusal(
        sections.setForLocation({
          ...as,
          supermarketLocationId: configured,
          sectionIds: [missing],
        })
      );
      expect(refused).toBeInstanceOf(SectionNotFoundException);
      expect(refused).toMatchObject({ details: { unknown: [missing] } });
    });

    it('puts the named sections first and keeps the others after them, in the order they had', async () => {
      const moved = await sections.setForLocation({
        ...as,
        supermarketLocationId: configured,
        sectionIds: [promo],
      });
      expect(moved.sections.map((row) => row.id)).toEqual([
        promo,
        frozen,
        pizzas,
        bakery,
      ]);
      expect(moved.sections.map((row) => row.position)).toEqual([0, 1, 2, 3]);

      const back = await sections.setForLocation({
        ...as,
        supermarketLocationId: configured,
        sectionIds: [frozen, pizzas, bakery],
      });
      expect(back.sections.map((row) => row.id)).toEqual([
        frozen,
        pizzas,
        bakery,
        promo,
      ]);
    });

    it('changes nothing on an empty list: the write deletes no section', async () => {
      const same = await sections.setForLocation({
        ...as,
        supermarketLocationId: configured,
        sectionIds: [],
      });
      expect(same.sections.map((row) => row.id)).toEqual([
        frozen,
        pizzas,
        bakery,
        promo,
      ]);
    });
  });

  describe('the order is unique per shop, and one statement reorders it', () => {
    it('declares the constraint deferrable and checked at the end of each statement', async () => {
      const [constraint] = (await dataSource.query(
        `SELECT c.condeferrable AS "deferrable", c.condeferred AS "deferred"
           FROM pg_constraint c
           JOIN pg_namespace n ON n.oid = c.connamespace
          WHERE n.nspname = $1 AND c.conname = 'uq_shop_sections_position'`,
        [SCHEMA]
      )) as { deferrable: boolean; deferred: boolean }[];
      expect(constraint).toEqual({ deferrable: true, deferred: false });
    });

    it('swaps two sections through the service, each keeping its id and its categories', async () => {
      const swapped = await sections.setForLocation({
        ...as,
        supermarketLocationId: configured,
        sectionIds: [pizzas, frozen],
      });
      expect(swapped.sections.map((row) => [row.id, row.position])).toEqual([
        [pizzas, 0],
        [frozen, 1],
        [bakery, 2],
        [promo, 3],
      ]);
      expect(swapped.sections[0].categoryIds).toEqual([leaf('frozen-pizzas')]);
      expect(swapped.sections[1].categoryIds).toEqual([
        leaf('frozen-foods-and-ice-cream'),
      ]);
      await sections.setForLocation({
        ...as,
        supermarketLocationId: configured,
        sectionIds: [frozen, pizzas],
      });
      expect(await orderOf(configured)).toEqual([
        frozen,
        pizzas,
        bakery,
        promo,
      ]);
    });

    it('refuses a second section at a place that is taken', async () => {
      expect(
        await sqlRefusal(
          `UPDATE "shop_sections" SET "position" = 0 WHERE "id" = $1`,
          [pizzas]
        )
      ).toEqual({ code: '23505', constraint: 'uq_shop_sections_position' });
      expect(
        await sqlRefusal(
          `INSERT INTO "shop_sections" ("supermarketLocationId", "slug", "name", "position")
           VALUES ($1, 'twice', '{"es":"Dos"}'::jsonb, 1)`,
          [configured]
        )
      ).toEqual({ code: '23505', constraint: 'uq_shop_sections_position' });
      // Nothing moved.
      expect((await stored(configured)).map((row) => row.id)).toEqual([
        frozen,
        pizzas,
        bakery,
        promo,
      ]);
    });

    it('lets the same place be held in two shops', async () => {
      const [first] = await stored(configured);
      const [other] = await stored(sibling);
      expect([first.position, other.position]).toEqual([0, 0]);
    });

    it('refuses a place below zero', async () => {
      expect(
        await sqlRefusal(
          `UPDATE "shop_sections" SET "position" = -1 WHERE "id" = $1`,
          [promo]
        )
      ).toEqual({ code: '23514', constraint: 'ck_shop_sections_position' });
    });
  });

  describe('names for several shops (plan 0170)', () => {
    it('agrees with the per shop read for every shop of one chain', async () => {
      const shops = [configured, bare, sibling];
      const names = await sections.namesForLocations({
        supermarketLocationIds: shops,
      });
      for (const shopId of shops) {
        const one = await sections.forLocation({
          supermarketLocationId: shopId,
        });
        expect(names.locations[shopId]).toEqual(
          one.sections.map((row) => ({ id: row.id, name: row.name }))
        );
      }
      expect(names.locations[configured].map((row) => row.id)).toEqual([
        frozen,
        pizzas,
        bakery,
        promo,
      ]);
      expect(names.locations[bare]).toEqual([]);
      expect(names.locations[sibling].map((row) => row.id)).toEqual([
        siblingSection,
      ]);
      expect(names.locations[configured][0].name).toEqual({
        es: 'frozen',
        en: 'frozen',
      });
    });

    it('maps a shop with no sections to an empty list, and leaves out what names no shop', async () => {
      const names = await sections.namesForLocations({
        supermarketLocationIds: [foreignShop, sibling, UNKNOWN_ITEM, 'nope'],
      });
      expect(names.locations).toEqual({
        [foreignShop]: [],
        [sibling]: [{ id: siblingSection, name: expect.any(Object) }],
      });
    });

    it('refuses more shops than one read may name', async () => {
      const ids = Array.from(
        { length: 201 },
        (_, i) => `ac700000-0000-4000-a000-${String(i).padStart(12, '0')}`
      );
      await expect(
        sections.namesForLocations({ supermarketLocationIds: ids })
      ).rejects.toThrow(/at most 200/);
    });
  });

  describe('one section', () => {
    it('creates a section after the last one of its shop', async () => {
      const temp = await shop(chainId, 'appends');
      const made = [
        await sections.create({
          ...as,
          supermarketLocationId: temp,
          slug: 'first',
          name: { es: 'Primera' },
          categoryIds: [],
        }),
        await sections.create({
          ...as,
          supermarketLocationId: temp,
          slug: 'second',
          name: { es: 'Segunda' },
          categoryIds: [leaf('milk')],
        }),
      ];
      expect(made.map((row) => row.position)).toEqual([0, 1]);
      expect(made[1]).toEqual({
        id: made[1].id,
        supermarketLocationId: temp,
        slug: 'second',
        name: { es: 'Segunda' },
        position: 1,
        categoryIds: [leaf('milk')],
      });
      expect(made[1]).not.toHaveProperty('supermarketId');
      expect(made[1]).not.toHaveProperty('locationCount');
      await dataSource.query(
        `DELETE FROM "supermarket_locations" WHERE "id" = $1`,
        [temp]
      );
    });

    it('moves a section to a place, and the ones between move by one', async () => {
      const first = await sections.update({
        ...as,
        sectionId: promo,
        position: 0,
      });
      expect(first.position).toBe(0);
      expect(await stored(configured)).toEqual([
        { id: promo, position: 0 },
        { id: frozen, position: 1 },
        { id: pizzas, position: 2 },
        { id: bakery, position: 3 },
      ]);

      const middle = await sections.update({
        ...as,
        sectionId: promo,
        position: 2,
      });
      expect(middle.position).toBe(2);
      expect(await orderOf(configured)).toEqual([
        frozen,
        pizzas,
        promo,
        bakery,
      ]);

      // A place past the last one is the last one.
      const last = await sections.update({
        ...as,
        sectionId: promo,
        position: 99,
      });
      expect(last.position).toBe(3);
      expect(await stored(configured)).toEqual([
        { id: frozen, position: 0 },
        { id: pizzas, position: 1 },
        { id: bakery, position: 2 },
        { id: promo, position: 3 },
      ]);
    });

    it('closes the gap when a section is deleted', async () => {
      const temp = await shop(chainId, 'gap');
      const a = await section(temp, 'a', []);
      const b = await section(temp, 'b', [leaf('milk')]);
      const c = await section(temp, 'c', []);
      await sections.delete({ ...as, sectionId: b });
      expect(await stored(temp)).toEqual([
        { id: a, position: 0 },
        { id: c, position: 1 },
      ]);
      // Its categories went with it.
      const [{ left }] = (await dataSource.query(
        `SELECT count(*)::int AS "left" FROM "shop_section_categories" WHERE "sectionId" = $1`,
        [b]
      )) as { left: number }[];
      expect(left).toBe(0);
      expect(
        await refusal(sections.get({ ...as, sectionId: b }))
      ).toBeInstanceOf(SectionNotFoundException);
      // The next one goes after the last, not into a place that is taken.
      const d = await section(temp, 'd', []);
      expect(await stored(temp)).toEqual([
        { id: a, position: 0 },
        { id: c, position: 1 },
        { id: d, position: 2 },
      ]);
      await dataSource.query(
        `DELETE FROM "supermarket_locations" WHERE "id" = $1`,
        [temp]
      );
    });

    it('refuses a slug the shop already holds, naming the holder', async () => {
      const refused = await refusal(section(configured, 'pizzas', []));
      expect(refused).toBeInstanceOf(SectionSlugTakenException);
      expect(refused).toMatchObject({ details: { sectionId: pizzas } });
    });

    it('lets two shops of one chain hold the same slug', async () => {
      const [mine, theirs] = await Promise.all([
        sections.get({ ...as, sectionId: pizzas }),
        sections.get({ ...as, sectionId: siblingSection }),
      ]);
      expect([mine.slug, theirs.slug]).toEqual(['pizzas', 'pizzas']);
      expect(mine.supermarketLocationId).toBe(configured);
      expect(theirs.supermarketLocationId).toBe(sibling);
      expect(theirs.categoryIds).toEqual([leaf('milk')]);
    });

    it('refuses an unknown category', async () => {
      const missing = 'ac700000-0000-4000-a000-00000000cafe';
      const refused = await refusal(section(configured, 'nowhere', [missing]));
      expect(refused).toBeInstanceOf(CategoryNotFoundException);
      expect(refused).toMatchObject({ details: { unknown: [missing] } });
    });

    it('refuses an unknown shop with the ordinary not found, and a chain is not a shop', async () => {
      expect(
        await refusal(
          section('ac700000-0000-4000-a000-00000000aaaa', 'nowhere', [])
        )
      ).toBeInstanceOf(NotFoundException);
      expect(await refusal(section(chainId, 'nowhere', []))).toBeInstanceOf(
        NotFoundException
      );
    });

    it('replaces the categories on update, roots before their leaves', async () => {
      const updated = await sections.update({
        ...as,
        sectionId: bakery,
        categoryIds: [leaf('freshly-baked-bread'), leaf('bakery')],
      });
      expect(updated.categoryIds).toEqual([
        leaf('bakery'),
        leaf('freshly-baked-bread'),
      ]);
      expect(updated.slug).toBe('bakery');
      const back = await sections.update({
        ...as,
        sectionId: bakery,
        categoryIds: [leaf('bakery')],
      });
      expect(back.categoryIds).toEqual([leaf('bakery')]);
    });

    it('deletes the sections of a shop with the shop', async () => {
      const temp = await shop(chainId, 'closes');
      const held = await section(temp, 'held', [leaf('milk')]);
      await dataSource.query(
        `DELETE FROM "supermarket_locations" WHERE "id" = $1`,
        [temp]
      );
      const [{ rows, covered }] = (await dataSource.query(
        `SELECT
           (SELECT count(*) FROM "shop_sections" WHERE "id" = $1)::int AS "rows",
           (SELECT count(*) FROM "shop_section_categories" WHERE "sectionId" = $1)::int AS "covered"`,
        [held]
      )) as { rows: number; covered: number }[];
      expect({ rows, covered }).toEqual({ rows: 0, covered: 0 });
    });
  });

  describe('a category that a section covers', () => {
    it('is held against deletion while a section of a shop covers it (R4)', async () => {
      const root = await categories.create({
        ...as,
        slug: 'plan-0200-aisle-test',
        name: { en: 'Aisle test' },
      });
      const holder = await section(configured, 'holds-a-root', [root.id]);
      expect(
        await refusal(categories.delete({ ...as, categoryId: root.id }))
      ).toBeInstanceOf(CategoryInUseException);
      await sections.update({ ...as, sectionId: holder, categoryIds: [] });
      await categories.delete({ ...as, categoryId: root.id });
      await sections.delete({ ...as, sectionId: holder });
    });

    it('names the rule when the foreign key is what refuses the delete', async () => {
      const root = await categories.create({
        ...as,
        slug: 'plan-0200-key-test',
        name: { en: 'Key test' },
      });
      const holder = await section(configured, 'holds-by-key', [root.id]);
      // Past the service's own check, straight at the key of the new table.
      expect(
        await sqlRefusal(`DELETE FROM "categories" WHERE "id" = $1`, [root.id])
      ).toEqual({
        code: '23503',
        constraint: 'fk_shop_section_categories_category',
      });
      await sections.delete({ ...as, sectionId: holder });
      await categories.delete({ ...as, categoryId: root.id });
    });

    it('is not held by a dead row of the old section_categories table', async () => {
      const root = await categories.create({
        ...as,
        slug: 'plan-0200-stale-test',
        name: { en: 'Stale test' },
      });
      const [{ id: oldSection }] = (await dataSource.query(
        `INSERT INTO "supermarket_sections" ("supermarketId", "slug", "name", "position")
         VALUES ($1, 'old-stale', '{"es":"Vieja"}'::jsonb, 7)
         RETURNING "id"::text AS "id"`,
        [chainId]
      )) as { id: string }[];
      await dataSource.query(
        `INSERT INTO "section_categories" ("sectionId", "categoryId")
         VALUES ($1, $2), ($1, $3)`,
        [oldSection, root.id, leaf('milk')]
      );
      // The old key still refuses a bare delete: it is the service that
      // clears the dead rows of this one category.
      expect(
        await sqlRefusal(`DELETE FROM "categories" WHERE "id" = $1`, [root.id])
      ).toEqual({
        code: '23503',
        constraint: 'fk_section_categories_category',
      });

      await categories.delete({ ...as, categoryId: root.id });

      const left = (await dataSource.query(
        `SELECT "categoryId"::text AS "categoryId" FROM "section_categories" WHERE "sectionId" = $1`,
        [oldSection]
      )) as { categoryId: string }[];
      // The row of the deleted category went, and no other row of the table.
      expect(left).toEqual([{ categoryId: leaf('milk') }]);
      await dataSource.query(
        `DELETE FROM "supermarket_sections" WHERE "id" = $1`,
        [oldSection]
      );
    });
  });

  describe('a walk writes the sections of the shop it walked', () => {
    let walked: string;
    let dairy: string;
    let bread: string;
    let cleaning: string;

    beforeAll(async () => {
      walked = await shop(chainId, 'walked');
      dairy = await section(walked, 'lacteos', [leaf('milk')], {
        es: 'Lácteos',
      });
      bread = await section(walked, 'panaderia', [leaf('bakery')], {
        es: 'Panadería',
        en: 'Bakery',
      });
      cleaning = await section(walked, 'limpieza', [], { es: 'Limpieza' });
    });

    it('orders the named sections as walked, creates the missing ones, and keeps the rest after them', async () => {
      const resolved = await walk(walked, [
        'Panadería',
        ' Pescadería ',
        'panadería',
      ]);
      const view = await sections.forLocation({
        supermarketLocationId: walked,
      });
      const fish = view.sections.find((row) => row.slug === 'pescaderia');
      expect(fish).toMatchObject({
        supermarketLocationId: walked,
        name: { es: 'Pescadería' },
        categoryIds: [],
      });
      // Named first, in walk order, a section named twice at its first
      // place. Then the two the walk did not name, in the order they had.
      expect(view.sections.map((row) => [row.id, row.position])).toEqual([
        [bread, 0],
        [fish?.id, 1],
        [dairy, 2],
        [cleaning, 3],
      ]);
      expect(resolved).toEqual([
        { name: 'Panadería', sectionId: bread },
        { name: 'Pescadería', sectionId: fish?.id },
        { name: 'panadería', sectionId: bread },
      ]);
    });

    it('keeps the categories of a section the walk does not name', async () => {
      const view = await sections.forLocation({
        supermarketLocationId: walked,
      });
      expect(
        view.sections.find((row) => row.id === dairy)?.categoryIds
      ).toEqual([leaf('milk')]);
      expect(
        view.sections.find((row) => row.id === bread)?.categoryIds
      ).toEqual([leaf('bakery')]);
    });

    it('matches a name in any locale, and creates nothing on a second save', async () => {
      const before = await stored(walked);
      const resolved = await walk(walked, ['bakery', 'Pescadería']);
      expect(resolved.map((entry) => entry.sectionId)).toEqual([
        bread,
        before[1].id,
      ]);
      expect(await stored(walked)).toEqual(before);
    });

    it('deletes no section when the walk names fewer, or none', async () => {
      const before = await stored(walked);
      await walk(walked, ['Limpieza']);
      const after = await stored(walked);
      expect(after.map((row) => row.id)).toEqual([
        cleaning,
        ...before.map((row) => row.id).filter((id) => id !== cleaning),
      ]);
      expect(after.map((row) => row.position)).toEqual([0, 1, 2, 3]);

      expect(await walk(walked, [])).toEqual([]);
      expect(await stored(walked)).toEqual(after);
    });

    it('creates a section for the walked shop alone: another shop of the chain names its own', async () => {
      const second = await shop(chainId, 'walked-too');
      const resolved = await walk(second, ['Pescadería', 'Lácteos']);
      const mine = await sections.forLocation({
        supermarketLocationId: second,
      });
      expect(mine.sections.map((row) => row.slug)).toEqual([
        'pescaderia',
        'lacteos',
      ]);
      expect(mine.sections.every((row) => row.categoryIds.length === 0)).toBe(
        true
      );
      // New rows of its own, and not the ones of the first shop.
      const theirs = await orderOf(walked);
      for (const entry of resolved) {
        expect(theirs).not.toContain(entry.sectionId);
      }
      expect(theirs).toHaveLength(4);
      await dataSource.query(
        `DELETE FROM "supermarket_locations" WHERE "id" = $1`,
        [second]
      );
    });

    it('resolves the names of a walk against the sections of that shop only', async () => {
      const here = await sections.resolveWalkNames(walked, [
        'Lácteos',
        'Charcutería',
      ]);
      expect(here).toEqual([{ name: 'Lácteos', sectionId: dairy }]);
      // The bare shop is of the same chain, and holds no section of that name.
      expect(await sections.resolveWalkNames(bare, ['Lácteos'])).toEqual([]);
    });

    it('refuses an unknown shop with the ordinary not found', async () => {
      expect(
        await refusal(walk('ac700000-0000-4000-a000-00000000beef', ['Pan']))
      ).toBeInstanceOf(NotFoundException);
    });
  });

  describe('the plan of the read', () => {
    it('reads 100 products at one shop in one statement on the indexes', async () => {
      const ids: string[] = [];
      const slugs = [
        'milk',
        'freshly-baked-bread',
        'ice-creams-and-ice',
        'frozen-pizzas',
        'pizzas-and-doughs',
      ];
      for (let i = 0; i < 100; i++) {
        ids.push(await product(`Producto ${i}`, [slugs[i % slugs.length]]));
      }
      await dataSource.query('ANALYZE');

      const answer = await rule(configured, ids);
      expect(answer.items).toHaveLength(100);
      // Milk is covered by no section of this shop; the other four are.
      expect(
        answer.items.filter((entry) => entry.step === 'COVERED')
      ).toHaveLength(80);
      expect(
        answer.items.filter((entry) => entry.step === 'NONE')
      ).toHaveLength(20);
      expect(
        answer.items.some((entry) => (entry.step as string) === 'PINNED')
      ).toBe(false);

      const plan = (await dataSource.query(
        `EXPLAIN (ANALYZE, BUFFERS, COSTS OFF) ${ITEMS_AT_LOCATION_SQL}`,
        [configured, ids]
      )) as { 'QUERY PLAN': string }[];
      const text = plan.map((row) => row['QUERY PLAN']).join('\n');
      console.log(`EXPLAIN of section.itemsAtLocation, 100 products:\n${text}`);
      // One statement, and the products' categories are read by their key
      // rather than by scanning every product in the catalog.
      expect(text).toMatch(/item_categories/);
      // It reads the sections of the shop, and none of the four old tables.
      expect(text).toMatch(/shop_sections/);
      expect(text).not.toMatch(
        /supermarket_sections|location_sections|supermarket_item_sections/
      );
    });
  });
});
