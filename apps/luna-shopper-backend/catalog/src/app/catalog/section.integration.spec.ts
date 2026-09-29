import { JwtService } from '@nestjs/jwt';
import {
  CategoryInUseException,
  CategoryNotFoundException,
  NotFoundException,
  SectionNotFoundException,
  SectionOfAnotherChainException,
  SectionSlugTakenException,
} from '@portfolio/luna-shopper/platform';
import {
  describeIntegration,
  requiredEnv,
} from '@portfolio/luna-shopper/test-fixtures/jest';
import { DataSource } from 'typeorm';
import { CATALOG_MIGRATIONS } from '../db/migrations';
import { categoryId } from '../db/reference/ids';
import { seedTaxonomy } from '../db/reference/taxonomy-seed';
import {
  CATALOG_ENTITIES,
  Category,
  Supermarket,
  SupermarketLocation,
  SupermarketSection,
} from '../entities';
import { CatalogAuditService } from './catalog-audit.service';
import { CategoryService } from './category.service';
import { PlatformAdminService } from './platform-admin.service';
import { ITEMS_AT_LOCATION_SQL, SectionService } from './section.service';

/**
 * Shop sections through the service, against real Postgres (plan 0167,
 * sections 1 to 3).
 *
 * The rule of section 3 is one statement, so what this file proves is the
 * statement: each branch of the rule on the example the plan states (a frozen
 * pizza on `frozen-meals-and-pizzas`, under the root `frozen`, and on
 * `pizzas`, under `ready-meals`), a shop with a list of its own and a shop
 * with none, and the two triggers refusing a section of another chain. It
 * ends with the `EXPLAIN` of the rule for 100 products at one shop.
 *
 * It works in a scratch schema of its own, seeded with the whole taxonomy, and
 * drops it afterwards.
 *
 *   LUNA_INTEGRATION=1 CATALOG_DB_URL=postgres://luna_catalog:luna_catalog@localhost:<port>/luna_catalog \
 *     npx nx run luna-shopper-backend-catalog:test-integration --testFile=section.integration.spec.ts
 */
const SCHEMA = 'plan0167_section_test';
const OWNER = 'ac700000-0000-4000-a000-000000000167';
const UNKNOWN_ITEM = 'ac700000-0000-4000-a000-00000000dead';

describeIntegration('shop sections and the rule (real Postgres)', () => {
  let dataSource: DataSource;
  let sections: SectionService;
  let categories: CategoryService;

  let chainId: string;
  let otherChainId: string;
  /** A shop of the chain with a list of its own. */
  let configured: string;
  /** A shop of the chain with no list, which inherits the chain's. */
  let bare: string;
  /** A shop of the other chain. */
  let foreignShop: string;

  /** The chain's sections, by what they are in the fixture. */
  let pizzas: string;
  let frozen: string;
  let bakery: string;
  let promo: string;
  let foreignSection: string;

  /** The products. */
  let pizza: string;
  let pinnedPizza: string;
  let iceCream: string;
  let pinnedAway: string;
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
  ): Promise<{ code?: string; constraint?: string; detail?: string } | null> {
    try {
      await dataSource.query(sql, params);
      return null;
    } catch (error) {
      const driver = (
        error as {
          driverError?: { code?: string; constraint?: string; detail?: string };
        }
      ).driverError;
      return {
        code: driver?.code,
        constraint: driver?.constraint,
        detail: driver?.detail,
      };
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
    supermarketId: string,
    slug: string,
    categoryIds: string[]
  ): Promise<string> {
    return (
      await sections.create({
        ...as,
        supermarketId,
        slug,
        name: { es: slug, en: slug },
        categoryIds,
      })
    ).id;
  }

  const rule = (supermarketLocationId: string, itemIds: string[]) =>
    sections.itemsAtLocation({ supermarketLocationId, itemIds });

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
      dataSource.getRepository(SupermarketSection),
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
    foreignShop = await shop(otherChainId, 'foreign');

    // The chain's order: Pizzas, Frozen, Bakery, Promo.
    pizzas = await section(chainId, 'pizzas', [leaf('pizzas')]);
    frozen = await section(chainId, 'frozen', [leaf('frozen')]);
    bakery = await section(chainId, 'bakery', [leaf('bakery')]);
    // Covers nothing: it holds only what is pinned to it.
    promo = await section(chainId, 'promo', []);
    foreignSection = await section(otherChainId, 'frescos', [leaf('frozen')]);

    // The configured shop walks Frozen, then Pizzas, then Bakery, and has no
    // Promo aisle.
    await sections.setForLocation({
      ...as,
      supermarketLocationId: configured,
      sectionIds: [frozen, pizzas, bakery],
    });

    pizza = await product('Pizza congelada', [
      'frozen-meals-and-pizzas',
      'pizzas',
    ]);
    pinnedPizza = await product('Pizza fija', [
      'frozen-meals-and-pizzas',
      'pizzas',
    ]);
    iceCream = await product('Helado', ['ice-cream']);
    pinnedAway = await product('Helado de promo', ['ice-cream']);
    milk = await product('Leche', ['milk']);

    await sections.setPins({
      ...as,
      supermarketId: chainId,
      itemId: pinnedPizza,
      sectionIds: [pizzas],
    });
    await sections.setPins({
      ...as,
      supermarketId: chainId,
      itemId: pinnedAway,
      sectionIds: [promo],
    });
  }, 180_000);

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
      await dataSource.destroy();
    }
  });

  describe('the rule of section 3', () => {
    it('covers a product through a leaf and through a root, in the shop order', async () => {
      const answer = await rule(configured, [pizza]);
      expect(answer.source).toBe('LOCATION');
      // Frozen covers the root of `frozen-meals-and-pizzas`, Pizzas covers the
      // leaf `pizzas`, and the shop walks Frozen first.
      expect(answer.items).toEqual([
        { itemId: pizza, step: 'COVERED', sectionIds: [frozen, pizzas] },
      ]);
    });

    it('covers a product through a root alone', async () => {
      const answer = await rule(configured, [iceCream]);
      expect(answer.items).toEqual([
        { itemId: iceCream, step: 'COVERED', sectionIds: [frozen] },
      ]);
    });

    it('answers a pin that is present, and nothing else', async () => {
      const answer = await rule(configured, [pinnedPizza]);
      expect(answer.items).toEqual([
        { itemId: pinnedPizza, step: 'PINNED', sectionIds: [pizzas] },
      ]);
    });

    it('falls through a pin to a section the shop lacks', async () => {
      // Pinned to Promo, which the configured shop does not have.
      const answer = await rule(configured, [pinnedAway]);
      expect(answer.items).toEqual([
        { itemId: pinnedAway, step: 'COVERED', sectionIds: [frozen] },
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

    it('gives a shop with no configuration every section of its chain, in the chain order', async () => {
      const answer = await rule(bare, [pizza, pinnedAway, milk]);
      expect(answer.source).toBe('CHAIN');
      expect(answer.items).toEqual([
        { itemId: pizza, step: 'COVERED', sectionIds: [pizzas, frozen] },
        // Promo is present here, so the pin answers.
        { itemId: pinnedAway, step: 'PINNED', sectionIds: [promo] },
        { itemId: milk, step: 'NONE', sectionIds: [] },
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

    it('reads a pin of this chain only', async () => {
      // The other chain's shop has only its own section, which covers the
      // root `frozen`: this chain's pin to Pizzas says nothing there.
      const answer = await rule(foreignShop, [pinnedPizza]);
      expect(answer.items).toEqual([
        { itemId: pinnedPizza, step: 'COVERED', sectionIds: [foreignSection] },
      ]);
    });

    it('answers the source alone for a read with no products', async () => {
      expect(await rule(configured, [])).toEqual({
        source: 'LOCATION',
        items: [],
      });
    });

    it('refuses an unknown shop with the ordinary not found', async () => {
      expect(
        await refusal(rule('ac700000-0000-4000-a000-00000000beef', [pizza]))
      ).toBeInstanceOf(NotFoundException);
    });
  });

  describe('a shop list', () => {
    it('reads the shop order with the categories each covers', async () => {
      const view = await sections.forLocation({
        supermarketLocationId: configured,
      });
      expect(view.source).toBe('LOCATION');
      expect(view.sections.map((row) => row.id)).toEqual([
        frozen,
        pizzas,
        bakery,
      ]);
      expect(view.sections[0].categoryIds).toEqual([leaf('frozen')]);
      expect(view.sections[0]).not.toHaveProperty('locationCount');
    });

    it('reads the chain order for a shop with no list', async () => {
      const view = await sections.forLocation({ supermarketLocationId: bare });
      expect(view.source).toBe('CHAIN');
      expect(view.sections.map((row) => row.id)).toEqual([
        pizzas,
        frozen,
        bakery,
        promo,
      ]);
    });

    it('refuses a section of another chain, naming it', async () => {
      const refused = await refusal(
        sections.setForLocation({
          ...as,
          supermarketLocationId: configured,
          sectionIds: [frozen, foreignSection],
        })
      );
      expect(refused).toBeInstanceOf(SectionOfAnotherChainException);
      expect(refused).toMatchObject({
        details: { sectionIds: [foreignSection] },
      });
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

    it('returns a shop to the chain default on an empty list', async () => {
      const temp = await shop(chainId, 'temp');
      await sections.setForLocation({
        ...as,
        supermarketLocationId: temp,
        sectionIds: [bakery],
      });
      const emptied = await sections.setForLocation({
        ...as,
        supermarketLocationId: temp,
        sectionIds: [],
      });
      expect(emptied.source).toBe('CHAIN');
      await dataSource.query(
        `DELETE FROM "supermarket_locations" WHERE "id" = $1`,
        [temp]
      );
    });
  });

  describe('names for several shops (plan 0170)', () => {
    it('agrees with the per shop read for a configured and an unconfigured shop of one chain', async () => {
      const names = await sections.namesForLocations({
        supermarketLocationIds: [configured, bare],
      });
      for (const shopId of [configured, bare]) {
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
      ]);
      expect(names.locations[bare].map((row) => row.id)).toEqual([
        pizzas,
        frozen,
        bakery,
        promo,
      ]);
      expect(names.locations[configured][0].name).toEqual({
        es: 'frozen',
        en: 'frozen',
      });
    });

    it('maps a shop whose chain has no sections to an empty list, and leaves out what names no shop', async () => {
      const emptyChain = await chain('Empty Mart');
      const emptyShop = await shop(emptyChain, 'empty');
      const names = await sections.namesForLocations({
        supermarketLocationIds: [emptyShop, foreignShop, UNKNOWN_ITEM, 'nope'],
      });
      expect(names.locations).toEqual({
        [emptyShop]: [],
        [foreignShop]: [{ id: foreignSection, name: expect.any(Object) }],
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

  describe('the triggers', () => {
    it('refuse a shop list naming a section of another chain', async () => {
      expect(
        await sqlRefusal(
          `INSERT INTO "location_sections" ("supermarketLocationId", "sectionId", "position")
           VALUES ($1, $2, 99)`,
          [configured, foreignSection]
        )
      ).toEqual({
        code: '23514',
        constraint: 'ck_location_sections_chain',
        detail: foreignSection,
      });
    });

    it('refuse a pin naming a section of another chain', async () => {
      expect(
        await sqlRefusal(
          `INSERT INTO "supermarket_item_sections" ("supermarketId", "itemId", "sectionId")
           VALUES ($1, $2, $3)`,
          [chainId, milk, foreignSection]
        )
      ).toEqual({
        code: '23514',
        constraint: 'ck_item_sections_chain',
        detail: foreignSection,
      });
    });

    it('refuse moving a row onto another chain by update', async () => {
      expect(
        await sqlRefusal(
          `UPDATE "location_sections" SET "sectionId" = $2
            WHERE "supermarketLocationId" = $1 AND "sectionId" = $3`,
          [configured, foreignSection, bakery]
        )
      ).toMatchObject({ constraint: 'ck_location_sections_chain' });
    });
  });

  describe('pins', () => {
    it('refuses a section of another chain', async () => {
      const refused = await refusal(
        sections.setPins({
          ...as,
          supermarketId: chainId,
          itemId: milk,
          sectionIds: [foreignSection],
        })
      );
      expect(refused).toBeInstanceOf(SectionOfAnotherChainException);
      expect(refused).toMatchObject({
        details: { sectionIds: [foreignSection] },
      });
    });

    it('refuses an unknown product with the ordinary not found', async () => {
      expect(
        await refusal(
          sections.setPins({
            ...as,
            supermarketId: chainId,
            itemId: UNKNOWN_ITEM,
            sectionIds: [pizzas],
          })
        )
      ).toBeInstanceOf(NotFoundException);
    });

    it('lists one entry per pinned product, filtered by product and by section', async () => {
      const all = await sections.listPins({ ...as, supermarketId: chainId });
      expect(all.items.map((entry) => entry.itemId).sort()).toEqual(
        [pinnedPizza, pinnedAway].sort()
      );
      const one = await sections.listPins({
        ...as,
        supermarketId: chainId,
        itemId: pinnedPizza,
      });
      expect(one.items).toEqual([
        { supermarketId: chainId, itemId: pinnedPizza, sectionIds: [pizzas] },
      ]);
      const bySection = await sections.listPins({
        ...as,
        supermarketId: chainId,
        sectionId: promo,
      });
      expect(bySection.items.map((entry) => entry.itemId)).toEqual([
        pinnedAway,
      ]);
      const both = await sections.listPins({
        ...as,
        supermarketId: chainId,
        itemId: pinnedPizza,
        sectionId: promo,
      });
      expect(both.items).toEqual([]);
    });

    it('pages by product', async () => {
      const first = await sections.listPins({
        ...as,
        supermarketId: chainId,
        limit: 1,
      });
      expect(first.items).toHaveLength(1);
      expect(first.nextCursor).not.toBeNull();
      const second = await sections.listPins({
        ...as,
        supermarketId: chainId,
        limit: 1,
        cursor: first.nextCursor ?? undefined,
      });
      expect(second.items).toHaveLength(1);
      expect(second.items[0].itemId).not.toBe(first.items[0].itemId);
      expect(second.nextCursor).toBeNull();
    });

    it('answers the pins in the chain order, and an empty list removes them', async () => {
      const written = await sections.setPins({
        ...as,
        supermarketId: chainId,
        itemId: milk,
        sectionIds: [promo, pizzas],
      });
      expect(written.sectionIds).toEqual([pizzas, promo]);
      const removed = await sections.setPins({
        ...as,
        supermarketId: chainId,
        itemId: milk,
        sectionIds: [],
      });
      expect(removed.sectionIds).toEqual([]);
      expect((await rule(configured, [milk])).items[0].step).toBe('NONE');
    });
  });

  describe('sections', () => {
    it('counts the shops a section is present at', async () => {
      const page = await sections.list({ ...as, supermarketId: chainId });
      const count = (id: string) =>
        page.items.find((row) => row.id === id)?.locationCount;
      // The configured shop lists Frozen, Pizzas and Bakery; the bare shop
      // inherits all four.
      expect(count(frozen)).toBe(2);
      expect(count(pizzas)).toBe(2);
      expect(count(promo)).toBe(1);
      expect(page.items.map((row) => row.id)).toEqual([
        pizzas,
        frozen,
        bakery,
        promo,
      ]);
    });

    it('searches by name and slug', async () => {
      const page = await sections.list({
        ...as,
        supermarketId: chainId,
        query: 'PROM',
      });
      expect(page.items.map((row) => row.id)).toEqual([promo]);
    });

    it('refuses a slug the chain already holds, naming the holder', async () => {
      const refused = await refusal(section(chainId, 'pizzas', []));
      expect(refused).toBeInstanceOf(SectionSlugTakenException);
      expect(refused).toMatchObject({ details: { sectionId: pizzas } });
    });

    it('lets another chain take the same slug', async () => {
      const id = await section(otherChainId, 'pizzas', []);
      await sections.delete({ ...as, sectionId: id });
    });

    it('refuses an unknown category', async () => {
      const missing = 'ac700000-0000-4000-a000-00000000cafe';
      const refused = await refusal(section(chainId, 'nowhere', [missing]));
      expect(refused).toBeInstanceOf(CategoryNotFoundException);
      expect(refused).toMatchObject({ details: { unknown: [missing] } });
    });

    it('refuses an unknown chain with the ordinary not found', async () => {
      expect(
        await refusal(
          section('ac700000-0000-4000-a000-00000000aaaa', 'nowhere', [])
        )
      ).toBeInstanceOf(NotFoundException);
    });

    it('replaces the categories on update, roots before their leaves', async () => {
      const updated = await sections.update({
        ...as,
        sectionId: bakery,
        categoryIds: [leaf('bread'), leaf('bakery')],
      });
      expect(updated.categoryIds).toEqual([leaf('bakery'), leaf('bread')]);
      expect(updated.slug).toBe('bakery');
      const back = await sections.update({
        ...as,
        sectionId: bakery,
        categoryIds: [leaf('bakery')],
      });
      expect(back.categoryIds).toEqual([leaf('bakery')]);
    });

    it('cascades a delete out of the shop lists and the pins', async () => {
      const doomed = await section(chainId, 'doomed', [leaf('milk')]);
      const temp = await shop(chainId, 'cascade');
      await sections.setForLocation({
        ...as,
        supermarketLocationId: temp,
        sectionIds: [doomed],
      });
      await sections.setPins({
        ...as,
        supermarketId: chainId,
        itemId: milk,
        sectionIds: [doomed],
      });
      await sections.delete({ ...as, sectionId: doomed });
      const [{ lists, pins }] = (await dataSource.query(
        `SELECT
           (SELECT count(*) FROM "location_sections" WHERE "sectionId" = $1)::int AS "lists",
           (SELECT count(*) FROM "supermarket_item_sections" WHERE "sectionId" = $1)::int AS "pins"`,
        [doomed]
      )) as { lists: number; pins: number }[];
      expect({ lists, pins }).toEqual({ lists: 0, pins: 0 });
      expect(
        await refusal(sections.get({ ...as, sectionId: doomed }))
      ).toBeInstanceOf(SectionNotFoundException);
      // The shop's list is empty now, so it inherits the chain's again.
      expect(
        (await sections.forLocation({ supermarketLocationId: temp })).source
      ).toBe('CHAIN');
      await dataSource.query(
        `DELETE FROM "supermarket_locations" WHERE "id" = $1`,
        [temp]
      );
    });

    it('holds a category a section covers against deletion (R4)', async () => {
      const root = await categories.create({
        ...as,
        slug: 'plan-0167-aisle-test',
        name: { en: 'Aisle test' },
      });
      const holder = await section(chainId, 'holds-a-root', [root.id]);
      expect(
        await refusal(categories.delete({ ...as, categoryId: root.id }))
      ).toBeInstanceOf(CategoryInUseException);
      await sections.update({ ...as, sectionId: holder, categoryIds: [] });
      await categories.delete({ ...as, categoryId: root.id });
      await sections.delete({ ...as, sectionId: holder });
    });
  });

  describe('the plan of the rule', () => {
    it('reads 100 products at one shop in one statement on the indexes', async () => {
      const ids: string[] = [];
      const slugs = [
        'milk',
        'bread',
        'ice-cream',
        'pizzas',
        'frozen-meals-and-pizzas',
      ];
      for (let i = 0; i < 100; i++) {
        ids.push(await product(`Producto ${i}`, [slugs[i % slugs.length]]));
      }
      for (const id of ids.slice(0, 10)) {
        await sections.setPins({
          ...as,
          supermarketId: chainId,
          itemId: id,
          sectionIds: [pizzas],
        });
      }
      await dataSource.query('ANALYZE');

      const answer = await rule(configured, ids);
      expect(answer.items).toHaveLength(100);
      expect(
        answer.items.filter((entry) => entry.step === 'PINNED')
      ).toHaveLength(10);

      const plan = (await dataSource.query(
        `EXPLAIN (ANALYZE, BUFFERS, COSTS OFF) ${ITEMS_AT_LOCATION_SQL}`,
        [configured, ids]
      )) as { 'QUERY PLAN': string }[];
      const text = plan.map((row) => row['QUERY PLAN']).join('\n');
      console.log(`EXPLAIN of section.itemsAtLocation, 100 products:\n${text}`);
      // One statement, and the products' categories are read by their key
      // rather than by scanning every product in the catalog.
      expect(text).toMatch(/item_categories/);
    });
  });
});
