import { JwtService } from '@nestjs/jwt';
import {
  ItemCategory,
  PriceScopeKind,
  PriceSourceKind,
  UnitOfMeasure,
} from '@portfolio/luna-shopper/contracts';
import {
  describeIntegration,
  requiredEnv,
} from '@portfolio/luna-shopper/test-fixtures/jest';
import { DataSource } from 'typeorm';
import { CATALOG_MIGRATIONS } from '../db/migrations';
import {
  Brand,
  CATALOG_ENTITIES,
  Item,
  PriceScope,
  ProductGroup,
  Supermarket,
  SupermarketItem,
} from '../entities';
import { CatalogEventsPublisher } from '../events/catalog-events.publisher';
import { CatalogAuditService } from './catalog-audit.service';
import { ItemService } from './item.service';
import { PlatformAdminService } from './platform-admin.service';
import { ProductGroupService } from './product-group.service';

/**
 * The search plan 0048 is mostly about, against real Postgres.
 *
 * **A mocked repository cannot check any of this.** Every claim the plan makes
 * about search is a claim about what `to_tsquery`, `ts_rank`, `similarity` and a
 * trigger do: that "leche" reaches a carton labelled only "Pascual
 * Semidesnatada", that "pasqual" still finds Pascual, that renaming a group
 * refreshes its members. A fake repository would let all of that pass while the
 * SQL was wrong.
 *
 * It works in a scratch schema of its own and drops it afterwards, so it never
 * touches the developer's own catalog data.
 *
 *   bash k8s/e2e/luna-shopper-backend/luna-slot.sh --up
 *   LUNA_INTEGRATION=1 CATALOG_DB_URL=postgres://luna_catalog:luna_catalog@localhost:<port>/luna_catalog \
 *     npx nx run luna-shopper-backend-catalog:test-integration
 */
const SCHEMA = 'plan0048_search_test';
// A uuid, because plan 0075 records it in `catalog_audit.actorId`, which is a
// uuid column. Every real actor id already is one: an admin's is `admin_users.id`
// and the harvester's configured `SERVICE_ACTOR_IDS` entry is a uuid too.
const OWNER = 'ac700000-0000-4000-a000-000000000001';
const SHOPPER = 'shopper';

/** A real EAN-13, on the Pascual carton the seed below creates. */
const PASCUAL_EAN = '8480000181077';

describeIntegration('catalog search (real Postgres)', () => {
  let dataSource: DataSource;
  let items: ItemService;
  let groups: ProductGroupService;

  /** Ids the assertions name, filled by the seed below. */
  const ids = {
    milkGroup: '',
    pascualMilk: '',
    hacendadoMilk: '',
    bread: '',
    scopeA: '',
    scopeB: '',
    // Plan 0146: two chains, and four products arranged so that every way a
    // chain can relate to a product is represented exactly once.
    chainA: '',
    chainB: '',
    scopeC: '',
    kumquatGroup: '',
    jam: '',
    juice: '',
    sorbet: '',
    tea: '',
  };

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
      // The migrations are raw SQL naming unqualified tables, so `schema` alone
      // does not put them here: the search_path has to be set on the connection
      // itself. See the price scope migration spec for that argument in full.
      //
      // **`public` is on the path here and is not on the migration spec's**, and
      // the difference is deliberate rather than an inconsistency. This file runs
      // the real services, whose SQL calls `similarity()`, and an extension lives
      // in exactly one schema per database: `pg_trgm` is in `public` on any
      // database the stack has already migrated, so a path without it makes every
      // fuzzy comparison an unresolvable function rather than a wrong answer. The
      // scratch schema is still **first**, so every table this test creates and
      // drops resolves to its own copy; what `public` adds is the extension's
      // functions, and the migrations that run above create their tables in the
      // first schema on the path whatever else is behind it.
      extra: { options: `-c search_path=${SCHEMA},public` },
    });
    await dataSource.initialize();
    await dataSource.runMigrations();

    const admin = new PlatformAdminService(new JwtService(), {
      // The owner writes as a configured SERVICE here (plan 0072): these specs
      // are about catalog's behaviour, not about which door the caller used, and
      // the service path needs no keypair to set up.
      getOrThrow: () => ({ adminJwtPublicKey: '', serviceActorIds: [OWNER] }),
    } as never);
    // Plan 0070: a write that moves a product's group, or deletes one,
    // announces it. Fire and forget and nothing here consumes it, but both
    // services call it, so the double has to exist.
    const events = {
      itemGroupChanged: jest.fn(),
      productGroupDeleted: jest.fn(),
    } as unknown as CatalogEventsPublisher;
    // Plan 0075: the real one, because there is a real DataSource here to open a
    // real transaction on. Nothing in this file reads the trail it writes.
    const audit = new CatalogAuditService(dataSource);
    groups = new ProductGroupService(
      dataSource.getRepository(ProductGroup),
      admin,
      audit,
      events
    );
    items = new ItemService(
      dataSource.getRepository(Item),
      dataSource.getRepository(ProductGroup),
      dataSource.getRepository(SupermarketItem),
      dataSource.getRepository(Brand),
      groups,
      admin,
      audit,
      events
    );

    await seed();
  }, 120_000);

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
      await dataSource.destroy();
    }
  });

  /**
   * Two milks of different brands in one group, one loaf in another, and two
   * price scopes so "cheapest at the scopes you asked about" has something to be
   * wrong about.
   */
  async function seed(): Promise<void> {
    const milkGroup = await groups.create({
      userId: OWNER,
      name: { en: 'Milk', es: 'Leche' },
      slug: 'milk',
      referenceUnit: UnitOfMeasure.LITER,
      synonyms: { en: ['milk'], es: ['leche', 'lácteo'] },
    });
    ids.milkGroup = milkGroup.id;

    const breadGroup = await groups.create({
      userId: OWNER,
      name: { en: 'Bread', es: 'Pan' },
      slug: 'bread',
      referenceUnit: UnitOfMeasure.UNIT,
      synonyms: { en: ['loaf'], es: ['barra'] },
    });

    // Neither milk has "milk" or "leche" in its own name. That is the point: they
    // are findable by the group's words or not at all.
    const pascual = await items.create({
      userId: OWNER,
      name: { en: 'Semi Skimmed 1L', es: 'Semidesnatada 1L' },
      brand: 'Pascual',
      // The only carton with a barcode, so "finds the one carrying it" is a
      // claim about the code and not about there being a single milk.
      ean: PASCUAL_EAN,
      category: ItemCategory.DAIRY,
      defaultUnit: UnitOfMeasure.LITER,
      productGroupId: milkGroup.id,
    });
    ids.pascualMilk = pascual.id;

    const hacendado = await items.create({
      userId: OWNER,
      name: { en: 'Whole 1L', es: 'Entera 1L' },
      brand: 'Hacendado',
      category: ItemCategory.DAIRY,
      defaultUnit: UnitOfMeasure.LITER,
      productGroupId: milkGroup.id,
    });
    ids.hacendadoMilk = hacendado.id;

    const bread = await items.create({
      userId: OWNER,
      name: { en: 'Sliced Bread', es: 'Pan de molde' },
      brand: 'Bimbo',
      category: ItemCategory.BAKERY,
      defaultUnit: UnitOfMeasure.UNIT,
      productGroupId: breadGroup.id,
    });
    ids.bread = bread.id;

    const supermarkets = dataSource.getRepository(Supermarket);
    const chain = await supermarkets.save(
      supermarkets.create({
        name: { en: 'Testcadona', es: 'Testcadona' },
        logoUrl: null,
        websiteUrl: null,
        externalBrandKey: null,
      })
    );
    const scopes = dataSource.getRepository(PriceScope);
    const scopeA = await scopes.save(
      scopes.create({
        supermarketId: chain.id,
        kind: PriceScopeKind.REGION,
        externalKey: 'a',
        label: null,
      })
    );
    const scopeB = await scopes.save(
      scopes.create({
        supermarketId: chain.id,
        kind: PriceScopeKind.REGION,
        externalKey: 'b',
        label: null,
      })
    );
    ids.scopeA = scopeA.id;
    ids.scopeB = scopeB.id;

    const prices = dataSource.getRepository(SupermarketItem);
    await prices.save([
      // Pascual is dearer in scope A and Hacendado is cheaper, so "cheapest"
      // cannot be right by accident of insertion order.
      prices.create({
        itemId: pascual.id,
        priceScopeId: scopeA.id,
        price: 1.35,
        currency: 'EUR',
        unitPrice: 1.35,
        unitPriceLabel: 'L',
        priceObservedAt: new Date('2026-08-30T10:00:00.000Z'),
        priceSourceKind: PriceSourceKind.OFFICIAL_API,
        available: true,
      }),
      prices.create({
        itemId: hacendado.id,
        priceScopeId: scopeA.id,
        price: 0.89,
        currency: 'EUR',
        unitPrice: 0.89,
        unitPriceLabel: 'L',
        priceObservedAt: new Date('2026-08-30T10:00:00.000Z'),
        priceSourceKind: PriceSourceKind.OFFICIAL_API,
        available: true,
      }),
      // Bread is priced only in scope B, so a search scoped to A has to report a
      // group with no price rather than dropping it.
      prices.create({
        itemId: bread.id,
        priceScopeId: scopeB.id,
        price: 1.6,
        currency: 'EUR',
        unitPrice: 1.6,
        unitPriceLabel: 'ud',
        priceObservedAt: new Date('2026-08-30T10:00:00.000Z'),
        priceSourceKind: PriceSourceKind.ADMIN,
        available: true,
      }),
    ]);

    await seedTwoChains(chain.id, scopeA.id);
  }

  /**
   * A second chain, and the four ways a product can relate to one (plan 0146).
   *
   * |        | Testcadona (A)     | Testdeza (B)      |
   * | ------ | ------------------ | ----------------- |
   * | jam    | available, priced  | no row at all     |
   * | juice  | no row at all      | available, priced |
   * | sorbet | row, not available | available, priced |
   * | tea    | available, no price| available, priced |
   *
   * So A sells the jam and the tea, B sells the juice, the sorbet and the tea,
   * and every claim the plan makes about the filter is a row in that table.
   *
   * They share a group named for the fruit, which is what lets one word reach
   * all four: the trigger copies a group's words into its members' documents, so
   * the ranked branch and the listing branch can be asked the same question.
   */
  async function seedTwoChains(chainA: string, scopeA: string): Promise<void> {
    ids.chainA = chainA;

    const supermarkets = dataSource.getRepository(Supermarket);
    const chainB = await supermarkets.save(
      supermarkets.create({
        name: { en: 'Testdeza', es: 'Testdeza' },
        logoUrl: null,
        websiteUrl: null,
        externalBrandKey: null,
      })
    );
    ids.chainB = chainB.id;

    const scopes = dataSource.getRepository(PriceScope);
    const scopeC = await scopes.save(
      scopes.create({
        supermarketId: chainB.id,
        kind: PriceScopeKind.REGION,
        externalKey: 'c',
        label: null,
      })
    );
    ids.scopeC = scopeC.id;

    const group = await groups.create({
      userId: OWNER,
      name: { en: 'Kumquat', es: 'Kumquat' },
      slug: 'kumquat',
      referenceUnit: UnitOfMeasure.UNIT,
    });
    ids.kumquatGroup = group.id;

    const make = async (en: string, es: string) =>
      (
        await items.create({
          userId: OWNER,
          name: { en, es },
          category: ItemCategory.OTHER,
          defaultUnit: UnitOfMeasure.UNIT,
          productGroupId: group.id,
        })
      ).id;

    ids.jam = await make('Kumquat Jam', 'Mermelada de kumquat');
    ids.juice = await make('Kumquat Juice', 'Zumo de kumquat');
    ids.sorbet = await make('Kumquat Sorbet', 'Sorbete de kumquat');
    ids.tea = await make('Kumquat Tea', 'Te de kumquat');

    const prices = dataSource.getRepository(SupermarketItem);
    const row = (
      itemId: string,
      priceScopeId: string,
      price: number | null,
      available: boolean
    ) =>
      prices.create({
        itemId,
        priceScopeId,
        price,
        currency: price === null ? null : 'EUR',
        unitPrice: price,
        unitPriceLabel: price === null ? null : 'ud',
        priceObservedAt:
          price === null ? null : new Date('2026-09-01T10:00:00.000Z'),
        priceSourceKind: price === null ? null : PriceSourceKind.OFFICIAL_API,
        available,
      });

    await prices.save([
      row(ids.jam, scopeA, 3.2, true),
      // The row that must not list the sorbet under A. It is the whole reason
      // `available` is part of the filter's meaning rather than a refinement.
      row(ids.sorbet, scopeA, 2.5, false),
      // Sold by A and priced by nobody: listed, with every price field null.
      row(ids.tea, scopeA, null, true),
      row(ids.juice, scopeC, 1.9, true),
      row(ids.sorbet, scopeC, 2.5, true),
      row(ids.tea, scopeC, 2.1, true),
    ]);
  }

  describe('item.search (plan 0048, sections 2 and 3)', () => {
    it('finds a product by its group, in either language', async () => {
      // Neither carton says "leche" anywhere on itself. The trigger put the
      // group's Spanish synonyms into their `search_es` document, which is the
      // entire mechanism this plan buys.
      const es = await items.search({ userId: SHOPPER, query: 'leche' });
      expect(es.items.map((i) => i.id).sort()).toEqual(
        [ids.pascualMilk, ids.hacendadoMilk].sort()
      );

      const en = await items.search({ userId: SHOPPER, query: 'milk' });
      expect(en.items.map((i) => i.id).sort()).toEqual(
        [ids.pascualMilk, ids.hacendadoMilk].sort()
      );
    });

    it('puts a brand’s own products first when the brand is searched', async () => {
      const page = await items.search({ userId: SHOPPER, query: 'Pascual' });
      expect(page.items[0]?.id).toBe(ids.pascualMilk);
    });

    it('still finds the brand through a typo (trigram distance)', async () => {
      // Plain full text search cannot do this: `pasqual` is a different lexeme
      // and matches nothing. This is what `pg_trgm` is beside it for.
      const page = await items.search({ userId: SHOPPER, query: 'pasqual' });
      expect(page.items.map((i) => i.id)).toContain(ids.pascualMilk);
    });

    it('matches a prefix, because the composer asks after three characters', async () => {
      const page = await items.search({ userId: SHOPPER, query: 'lech' });
      expect(page.items.map((i) => i.id)).toContain(ids.pascualMilk);
    });

    it('quotes a price only for the scopes it was given', async () => {
      const scoped = await items.search({
        userId: SHOPPER,
        query: 'leche',
        priceScopeIds: [ids.scopeA],
      });
      const pascual = scoped.items.find((i) => i.id === ids.pascualMilk);
      expect(pascual?.bestOffer?.unitPrice).toBe(1.35);
      expect(pascual?.bestOffer?.sourceKind).toBe(PriceSourceKind.OFFICIAL_API);

      // With no scopes the suggestions still work and no price is quoted. That
      // is the whole of section 3.1: no default is resolved here, and an
      // unscoped search degrades rather than failing.
      const unscoped = await items.search({ userId: SHOPPER, query: 'leche' });
      expect(unscoped.items).toHaveLength(2);
      for (const item of unscoped.items) {
        expect(item.bestOffer ?? null).toBeNull();
      }
    });

    it('finds the product a whole barcode names', async () => {
      // Nothing in any document holds these digits: the trigger builds the
      // vectors from the name, the brand and the group's words. Before the `ean`
      // test was added to the filter this answered with an empty page.
      const page = await items.search({ userId: SHOPPER, query: PASCUAL_EAN });
      expect(page.items.map((i) => i.id)).toEqual([ids.pascualMilk]);
    });

    it('finds it through the separators a printed code carries', async () => {
      const page = await items.search({
        userId: SHOPPER,
        query: '8 480000 181077',
      });
      expect(page.items.map((i) => i.id)).toEqual([ids.pascualMilk]);
    });

    it('puts the scanned product above everything the digits also read as', async () => {
      // A product actually named for the code, so the barcode row has to beat a
      // genuine text hit rather than merely be present. The name is the only
      // place these digits can be matched as words.
      const impostor = await items.create({
        userId: OWNER,
        name: { en: PASCUAL_EAN, es: PASCUAL_EAN },
        category: ItemCategory.OTHER,
        defaultUnit: UnitOfMeasure.UNIT,
      });

      try {
        const page = await items.search({
          userId: SHOPPER,
          query: PASCUAL_EAN,
        });

        // The impostor carries no barcode, and `NULL = '848…'` is NULL, which a
        // descending sort puts first unless it is told otherwise. This asserts
        // the `NULLS LAST` that stops every unbarcoded product outranking the
        // one that was actually scanned.
        expect(page.items[0]?.id).toBe(ids.pascualMilk);
        expect(page.items.map((i) => i.id)).toContain(impostor.id);
      } finally {
        // In a `finally` so a failure above cannot leave a product named for a
        // barcode behind for the tests that follow.
        await items.delete({ userId: OWNER, itemId: impostor.id });
      }
    });

    it('does not read a part of a code, or a quantity, as a barcode', async () => {
      // Six digits is no barcode length, so this runs as text, and the carton
      // carrying the code is not findable by part of it: nothing puts an `ean`
      // into a search document.
      const partial = await items.search({ userId: SHOPPER, query: '848000' });
      expect(partial.items.map((i) => i.id)).not.toContain(ids.pascualMilk);
    });

    it('still lists everything when no query is given (the admin surface)', async () => {
      const page = await items.search({ userId: SHOPPER });
      expect(page.items.length).toBeGreaterThanOrEqual(3);
    });

    it('filters to one group’s members', async () => {
      const page = await items.search({
        userId: SHOPPER,
        productGroupId: ids.milkGroup,
      });
      expect(page.items.map((i) => i.id).sort()).toEqual(
        [ids.pascualMilk, ids.hacendadoMilk].sort()
      );
    });
  });

  /**
   * The chain filter (plan 0146), against the tables it is a claim about.
   *
   * Every case here is a `WHERE` clause being right or wrong, which is exactly
   * what a fake repository cannot tell you: `item-search.spec.ts` beside this
   * file proves both branches carry the same clause, and this proves the clause
   * selects what the plan says it selects.
   *
   * Each case is asked twice, once of each branch. A query with the default
   * order takes the ranked branch; the same query with `order: 'name'` takes the
   * listing branch, keyset paged, with the same text filter applied. The two
   * differ in their ordering and must not differ in their membership.
   */
  describe('item.search, filtered by chain (plan 0146)', () => {
    /** Both branches, asked the same question, answered as sorted id sets. */
    async function bothBranches(soldBy?: string[]): Promise<string[][]> {
      const ranked = await items.search({
        userId: SHOPPER,
        query: 'kumquat',
        soldBy,
      });
      const listed = await items.search({
        userId: SHOPPER,
        query: 'kumquat',
        order: 'name',
        soldBy,
      });
      return [
        ranked.items.map((i) => i.id).sort(),
        listed.items.map((i) => i.id).sort(),
      ];
    }

    it('lists every chain when the filter is absent or empty', async () => {
      const all = [ids.jam, ids.juice, ids.sorbet, ids.tea].sort();

      for (const soldBy of [undefined, []]) {
        const [ranked, listed] = await bothBranches(soldBy);
        // Empty is not an empty page. Somebody who cleared the chain chips is
        // asking for the catalog, the same way an empty scope set asks for it
        // unpriced (plan 0069, section 2).
        expect(ranked).toEqual(all);
        expect(listed).toEqual(all);
      }
    });

    it('drops a product the chain does not sell at all', async () => {
      const [ranked, listed] = await bothBranches([ids.chainA]);

      // The jam is A's alone and the juice is B's alone, so each filter has
      // something to include and something to leave out.
      expect(ranked).toContain(ids.jam);
      expect(ranked).not.toContain(ids.juice);
      expect(listed).toEqual(ranked);
    });

    it('drops a product whose only row at that chain says it is not stocked', async () => {
      const [rankedA, listedA] = await bothBranches([ids.chainA]);
      const [rankedB, listedB] = await bothBranches([ids.chainB]);

      // The sorbet has a row at A. It says the shop does not stock it, which is
      // exactly the row that must not put it in A's catalog, and B carries the
      // same product available, so its absence is about the flag and not about
      // the product.
      expect(rankedA).not.toContain(ids.sorbet);
      expect(listedA).not.toContain(ids.sorbet);
      expect(rankedB).toContain(ids.sorbet);
      expect(listedB).toEqual(rankedB);
    });

    it('keeps a product the chain sells at no price, with its price fields null', async () => {
      const page = await items.search({
        userId: SHOPPER,
        query: 'kumquat',
        soldBy: [ids.chainA],
        priceScopeIds: [ids.scopeA],
      });

      // The filter is about the assortment. Having no price says nothing about
      // whether the shop sells the thing, which is plan 0069's rule read at the
      // level of one product rather than one catalog.
      const tea = page.items.find((i) => i.id === ids.tea);
      expect(tea).toBeDefined();
      // The offer is the source row itself, which exists and is available, so
      // what is null is every price field on it and not the row. That is the
      // shape a shopper sees: the chain stocks it and nobody has read a price.
      expect(tea?.bestOffer?.priceScopeId).toBe(ids.scopeA);
      expect(tea?.bestOffer?.price ?? null).toBeNull();
      expect(tea?.bestOffer?.unitPrice ?? null).toBeNull();
      expect(tea?.bestOffer?.sourceKind ?? null).toBeNull();
    });

    it('lists what either chain sells when two are named', async () => {
      const [ranked, listed] = await bothBranches([ids.chainA, ids.chainB]);

      // A union and never an intersection: the tea is the only product both
      // chains carry, and all four come back.
      expect(ranked).toEqual([ids.jam, ids.juice, ids.sorbet, ids.tea].sort());
      expect(listed).toEqual(ranked);
    });

    it('answers an empty page for a chain nobody knows, rather than an error', async () => {
      const [ranked, listed] = await bothBranches([
        'cf000000-0000-4000-a000-0000000000ff',
      ]);
      expect(ranked).toEqual([]);
      expect(listed).toEqual([]);
    });

    it('prices a filtered page from the scopes the caller named, as before', async () => {
      // The two supermarket parameters are independent: the filter says which
      // products, the scopes say where the price comes from. Asked for what A
      // sells and priced at A, the jam quotes A's price.
      const priced = await items.search({
        userId: SHOPPER,
        query: 'kumquat',
        soldBy: [ids.chainA],
        priceScopeIds: [ids.scopeA],
      });
      expect(priced.items.find((i) => i.id === ids.jam)?.bestOffer?.price).toBe(
        3.2
      );

      // The same products, priced from a scope belonging to the other chain:
      // nothing is quoted, and nothing is dropped either.
      const elsewhere = await items.search({
        userId: SHOPPER,
        query: 'kumquat',
        soldBy: [ids.chainA],
        priceScopeIds: [ids.scopeC],
      });
      expect(elsewhere.items.map((i) => i.id).sort()).toEqual(
        [ids.jam, ids.tea].sort()
      );
      expect(
        elsewhere.items.find((i) => i.id === ids.jam)?.bestOffer ?? null
      ).toBeNull();
    });

    it('pages a filtered set without repeating or skipping a row', async () => {
      // Four rows and a limit of two, on both branches: the keyset cursor the
      // listing branch cuts and the offset the ranked branch counts both have to
      // stay right while a filter narrows the set underneath them.
      for (const order of ['relevance', 'name']) {
        const seen: string[] = [];
        let cursor: string | undefined = undefined;

        do {
          const page = await items.search({
            userId: SHOPPER,
            query: 'kumquat',
            order,
            soldBy: [ids.chainA, ids.chainB],
            limit: 2,
            cursor,
          });
          expect(page.items.length).toBeLessThanOrEqual(2);
          seen.push(...page.items.map((i) => i.id));
          cursor = page.nextCursor ?? undefined;
        } while (cursor);

        expect(seen.sort()).toEqual(
          [ids.jam, ids.juice, ids.sorbet, ids.tea].sort()
        );
      }
    });
  });

  describe('item.searchOffers (plan 0048, section 3)', () => {
    it('returns the group with its cheapest member and that member’s unit price', async () => {
      const page = await items.searchOffers({
        userId: SHOPPER,
        query: 'leche',
        priceScopeIds: [ids.scopeA],
      });

      expect(page.items).toHaveLength(1);
      const [milk] = page.items;
      expect(milk.group.id).toBe(ids.milkGroup);
      expect(milk.cheapestItem?.id).toBe(ids.hacendadoMilk);
      // Verbatim, from the SupermarketItem row, never recomputed (plan 0038).
      expect(milk.offer?.unitPrice).toBe(0.89);
      expect(milk.offer?.priceScopeId).toBe(ids.scopeA);
      expect(milk.offer?.observedAt).toBe('2026-08-30T10:00:00.000Z');
    });

    it('returns a group with null price fields when no scope has a price', async () => {
      // Bread is priced in scope B only. Asked about scope A it must still come
      // back: the composer is attaching identity, not quoting a price, and a
      // group must not vanish because the one harvested chain is switched off.
      const page = await items.searchOffers({
        userId: SHOPPER,
        query: 'pan',
        priceScopeIds: [ids.scopeA],
      });

      expect(page.items).toHaveLength(1);
      expect(page.items[0].group.slug).toBe('bread');
      expect(page.items[0].cheapestItem).toBeNull();
      expect(page.items[0].offer).toBeNull();
      // Unpriced and still choosable: the members are the point of the row.
      expect(page.items[0].itemIds.length).toBeGreaterThan(0);
    });

    it('carries every member of the group, which choosing it copies onto a line', async () => {
      const page = await items.searchOffers({
        userId: SHOPPER,
        query: 'leche',
        priceScopeIds: [ids.scopeA],
      });

      // The whole membership, not just the cheapest one the offer names: picking
      // a group in the composer copies its members onto the line (plan 0048,
      // section 1.1), and the household trims the set afterwards.
      expect([...page.items[0].itemIds].sort()).toEqual(
        [ids.pascualMilk, ids.hacendadoMilk].sort()
      );
    });

    it('carries the members with no scopes given, where nothing is priced', async () => {
      const page = await items.searchOffers({
        userId: SHOPPER,
        query: 'leche',
      });
      expect([...page.items[0].itemIds].sort()).toEqual(
        [ids.pascualMilk, ids.hacendadoMilk].sort()
      );
    });

    it('works with no scopes at all, quoting nothing', async () => {
      const page = await items.searchOffers({
        userId: SHOPPER,
        query: 'leche',
      });
      expect(page.items.map((g) => g.group.id)).toEqual([ids.milkGroup]);
      expect(page.items[0].offer).toBeNull();
    });

    it('finds a group by a synonym that is in neither of its names', async () => {
      const page = await items.searchOffers({
        userId: SHOPPER,
        query: 'lácteo',
      });
      expect(page.items.map((g) => g.group.id)).toEqual([ids.milkGroup]);
    });

    it('answers nothing for a barcode, which names a product and not a kind', async () => {
      // The group of the scanned carton is deliberately absent. "A group beats
      // an item for a bare word" is a rule about words, and somebody holding a
      // barcode has already chosen which milk they mean, so the suggest endpoint
      // draws that one product and no category above it.
      const page = await items.searchOffers({
        userId: SHOPPER,
        query: PASCUAL_EAN,
      });
      expect(page.items).toHaveLength(0);
    });
  });

  describe('the triggers keep the documents current', () => {
    it('gives a new synonym to the group and not to each of its members', async () => {
      // A synonym names a **kind** of thing, so it reaches the kind of thing.
      // It used to reach every member as well, which is how one typed word
      // became as many suggestions as the group had cartons, four times over
      // for a group with four synonyms. The suggest endpoint already draws the
      // group above the products, so nothing became unreachable when that
      // stopped: what went is the duplication underneath it.
      const before = await items.search({
        userId: SHOPPER,
        query: 'mantequilla',
      });
      expect(before.items).toHaveLength(0);

      await groups.update({
        userId: OWNER,
        productGroupId: ids.milkGroup,
        synonyms: { en: ['milk'], es: ['leche', 'lácteo', 'mantequilla'] },
      });

      const groupPage = await items.searchOffers({
        userId: SHOPPER,
        query: 'mantequilla',
      });
      expect(groupPage.items.map((g) => g.group.id)).toEqual([ids.milkGroup]);

      const itemPage = await items.search({
        userId: SHOPPER,
        query: 'mantequilla',
      });
      expect(itemPage.items).toHaveLength(0);

      // Put it back, so the ordering of the tests in this file does not matter.
      await groups.update({
        userId: OWNER,
        productGroupId: ids.milkGroup,
        synonyms: { en: ['milk'], es: ['leche', 'lácteo'] },
      });
    }, 30_000);

    it('re-indexes a group’s members when the group is renamed', async () => {
      // Nothing about the items changed, and both of them have to become
      // findable by a word that did not exist a moment ago. This is the second
      // trigger, and the reason the vectors are columns rather than generated.
      // The group's **name** is the part of it an item still carries.
      const before = await items.search({ userId: SHOPPER, query: 'lacteos' });
      expect(before.items).toHaveLength(0);

      await groups.update({
        userId: OWNER,
        productGroupId: ids.milkGroup,
        name: { en: 'Milk', es: 'Lacteos' },
      });

      const after = await items.search({ userId: SHOPPER, query: 'lacteos' });
      expect(after.items.map((i) => i.id).sort()).toEqual(
        [ids.pascualMilk, ids.hacendadoMilk].sort()
      );

      await groups.update({
        userId: OWNER,
        productGroupId: ids.milkGroup,
        name: { en: 'Milk', es: 'Leche' },
      });
    }, 30_000);

    it('drops the group’s words from an item that leaves the group', async () => {
      await items.update({
        userId: OWNER,
        itemId: ids.hacendadoMilk,
        productGroupId: null,
      });

      const page = await items.search({ userId: SHOPPER, query: 'leche' });
      expect(page.items.map((i) => i.id)).toEqual([ids.pascualMilk]);

      await items.update({
        userId: OWNER,
        itemId: ids.hacendadoMilk,
        productGroupId: ids.milkGroup,
      });
    }, 30_000);
  });

  describe('product groups are owner curated (plan 0048, section 1)', () => {
    it('refuses a write from anybody but the app owner', async () => {
      await expect(
        groups.create({
          userId: SHOPPER,
          name: { en: 'Eggs', es: 'Huevos' },
          slug: 'eggs',
          referenceUnit: UnitOfMeasure.UNIT,
        })
      ).rejects.toThrow();
    });

    it('refuses a second group with the same slug', async () => {
      await expect(
        groups.create({
          userId: OWNER,
          name: { en: 'Milk again', es: 'Leche otra vez' },
          slug: 'milk',
          referenceUnit: UnitOfMeasure.LITER,
        })
      ).rejects.toThrow();
    });

    it('keeps a deleted group’s members, unassigned', async () => {
      const doomed = await groups.create({
        userId: OWNER,
        name: { en: 'Doomed', es: 'Condenado' },
        slug: 'doomed',
        referenceUnit: UnitOfMeasure.UNIT,
      });
      const orphan = await items.create({
        userId: OWNER,
        name: { en: 'An orphan', es: 'Un huérfano' },
        category: ItemCategory.OTHER,
        defaultUnit: UnitOfMeasure.UNIT,
        productGroupId: doomed.id,
      });

      await groups.delete({ userId: OWNER, productGroupId: doomed.id });

      const after = await items.get({ userId: SHOPPER, itemId: orphan.id });
      expect(after.productGroupId).toBeNull();
    });
  });

  /**
   * What the search refuses to match, and in what order it puts what it does.
   *
   * Every claim here is a claim about the stemmer, so a fake repository would
   * pass all of them while the SQL matched half the shop. The Spanish
   * configuration reduces "salado", "salada" and "salted" to the single lexeme
   * `sal`, and the prefix a composer needs turns `lech:*` into "lechuga": on the
   * real assortment those two together answered "sal" with 247 products, of
   * which the first was salted caramel ice cream.
   */
  describe('a match has to be literal (the strictness pass)', () => {
    const strict = {
      lettuce: '',
      sausages: '',
      salt: '',
      salmon: '',
    };

    beforeAll(async () => {
      const created = await Promise.all([
        items.create({
          userId: OWNER,
          name: { en: 'Iceberg lettuce', es: 'Lechuga iceberg' },
          category: ItemCategory.OTHER,
          defaultUnit: UnitOfMeasure.UNIT,
        }),
        items.create({
          userId: OWNER,
          name: { en: 'Chicken sausages', es: 'Salchichas de pollo' },
          category: ItemCategory.MEAT,
          defaultUnit: UnitOfMeasure.UNIT,
        }),
        items.create({
          userId: OWNER,
          name: { en: 'Fine salt', es: 'Sal fina' },
          category: ItemCategory.OTHER,
          defaultUnit: UnitOfMeasure.GRAM,
        }),
        items.create({
          userId: OWNER,
          name: { en: 'Smoked salmon', es: 'Salmón ahumado' },
          category: ItemCategory.OTHER,
          defaultUnit: UnitOfMeasure.GRAM,
        }),
      ]);
      [strict.lettuce, strict.sausages, strict.salt, strict.salmon] =
        created.map((item) => item.id);
    });

    it('does not answer a whole word with what merely stems to it', async () => {
      // "leche" and "lechuga" are one lexeme apart in the index and a shop
      // apart on the shelf.
      const page = await items.search({ userId: SHOPPER, query: 'leche' });
      expect(page.items.map((i) => i.id)).not.toContain(strict.lettuce);
    });

    it('still answers the prefix that was actually typed', async () => {
      // The narrowing is literal and not a ban on prefixes: somebody four
      // characters into "lechuga" is asking for it, and the composer starts
      // asking at three.
      const page = await items.search({ userId: SHOPPER, query: 'lechu' });
      expect(page.items.map((i) => i.id)).toContain(strict.lettuce);
    });

    it('puts the product the word names above the ones that start with it', async () => {
      // Both are honest matches for three characters, and only one of them is
      // salt. This is the ordering the whole word key exists for.
      const page = await items.search({ userId: SHOPPER, query: 'sal' });
      const order = page.items.map((i) => i.id);

      expect(order).toContain(strict.salt);
      expect(order).toContain(strict.sausages);
      expect(order.indexOf(strict.salt)).toBeLessThan(
        order.indexOf(strict.sausages)
      );
    });

    it('matches a word typed without its accent', async () => {
      // The Spanish configuration strips accents while it stems, so this
      // already worked; the literal recheck goes through `catalog_norm` so that
      // it keeps working. Most Spanish is typed without them.
      const page = await items.search({ userId: SHOPPER, query: 'salmon' });
      expect(page.items.map((i) => i.id)).toContain(strict.salmon);
    });

    it('does not fuzzy match a query too short to mean anything', async () => {
      // `similarity('sal', 'sol')` is 0.5, which says nothing except that both
      // are three letters long. Below MIN_FUZZY_LENGTH the full text branch
      // answers alone, so this finds nothing rather than every short word on
      // the shelf.
      const page = await items.search({ userId: SHOPPER, query: 'sol' });
      expect(page.items.map((i) => i.id)).not.toContain(strict.salt);
    });

    it('still reaches a misspelling long enough to be one', async () => {
      const page = await items.search({ userId: SHOPPER, query: 'pasqual' });
      expect(page.items.map((i) => i.id)).toContain(ids.pascualMilk);
    });
  });

  /**
   * What a shopper typed on a phone and did not find (plan 0156). One case per
   * row of the plan's table, each with the product that used to come first
   * beside the one that was wanted.
   */
  describe('search finds what a shopper types (plan 0156)', () => {
    const typed = {
      bleach: '',
      pineapple: '',
      piadina: '',
      rusticBaguette: '',
      burgerBuns: '',
      evooGroup: '',
      seagrams: '',
      blackElephant: '',
      cruzcampo: '',
      steinburg: '',
      vinegar: '',
      coarseSalt: '',
    };

    beforeAll(async () => {
      const make = (es: string, brand?: string, productGroupId?: string) =>
        items
          .create({
            userId: OWNER,
            name: { en: es, es },
            brand,
            category: ItemCategory.OTHER,
            defaultUnit: UnitOfMeasure.UNIT,
            productGroupId,
          })
          .then((item) => item.id);

      const evoo = await groups.create({
        userId: OWNER,
        name: {
          en: 'Extra Virgin Olive Oil',
          es: 'Aceite de oliva virgen extra',
        },
        slug: 'extra-virgin-olive-oil',
        referenceUnit: UnitOfMeasure.LITER,
        synonyms: { en: ['evoo'], es: ['aove'] },
      });
      typed.evooGroup = evoo.id;

      typed.bleach = await make('Lejía normal', 'Bosque Verde');
      typed.pineapple = await make('Zumo de piña', 'Hacendado');
      typed.piadina = await make('Piadina', 'Hacendado');
      typed.rusticBaguette = await make('Barra de pan rústica');
      typed.burgerBuns = await make('Pan de burger Rústico', 'Hacendado');
      typed.seagrams = await make('Ginebra', "Seagram's");
      typed.blackElephant = await make('Ginebra', 'Black Elephant');
      typed.cruzcampo = await make('Cerveza Pilsen', 'Cruzcampo');
      typed.steinburg = await make('Cerveza clásica en lata', 'Steinburg');
      typed.vinegar = await make('Vinagre de manzana');
      typed.coarseSalt = await make('Sal gruesa');
      await make('Aceite de oliva virgen extra', 'Hacendado', evoo.id);
    });

    const idsFor = async (query: string) =>
      (await items.search({ userId: SHOPPER, query })).items.map((i) => i.id);

    it('finds "lejía" typed as "lejia"', async () => {
      // The stemmer made `lej` of one and `leji` of the other. Both sides now
      // go through `catalog_norm` before it, so both are `leji`.
      expect(await idsFor('lejia')).toContain(typed.bleach);
    });

    it('finds "piña" typed as "pina", above what only looks like it', async () => {
      // The stemmer keeps `ñ`, so `pin:*` never reached `piñ`. Piadina came in
      // through trigram and was the only answer.
      const order = await idsFor('pina');
      expect(order[0]).toBe(typed.pineapple);
    });

    it('accepts the other gender of a typed word ("pan rustico")', async () => {
      const order = await idsFor('pan rustico');
      expect(order).toContain(typed.burgerBuns);
      expect(order[0]).toBe(typed.rusticBaguette);
    });

    it('finds extra virgin olive oil by "aove", through its group', async () => {
      // A synonym reaches the group and never the members' documents, so the
      // answer is the group the suggest endpoint lists first.
      const page = await items.searchOffers({ userId: SHOPPER, query: 'aove' });
      expect(page.items[0]?.group.id).toBe(typed.evooGroup);
    });

    it('reads "seagrams" as the brand "Seagram\'s", and ranks it first', async () => {
      const order = await idsFor('ginebra seagrams');
      expect(order[0]).toBe(typed.seagrams);
    });

    it('ranks a typed brand above a product that only shares the category', async () => {
      // Both enter through trigram, since neither name holds every word. The
      // Steinburg name says "cerveza" and "lata" and won on `ts_rank`.
      const order = await idsFor('cerveza cruzcampo lata');
      expect(order).toContain(typed.steinburg);
      expect(order.indexOf(typed.cruzcampo)).toBeLessThan(
        order.indexOf(typed.steinburg)
      );
    });

    it('does not let a cut word reach what the stemmer conflates with it', async () => {
      // "vinos" is cut to "vin" only for a whole word with one of the four
      // endings. As a prefix, `vin` would take the stemmer's "vinagre".
      expect(await idsFor('vinos')).not.toContain(typed.vinegar);
      // Plan 0156, section 1: "salado" cut to "salad" does not reach "sal".
      expect(await idsFor('salado')).not.toContain(typed.coarseSalt);
    });
  });
});
