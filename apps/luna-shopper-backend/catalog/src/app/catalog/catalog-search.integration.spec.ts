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
  CATALOG_ENTITIES,
  Item,
  PriceScope,
  ProductGroup,
  Supermarket,
  SupermarketItem,
} from '../entities';
import { CatalogEventsPublisher } from '../events/catalog-events.publisher';
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
const OWNER = 'owner';
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
    groups = new ProductGroupService(
      dataSource.getRepository(ProductGroup),
      admin,
      events
    );
    items = new ItemService(
      dataSource.getRepository(Item),
      dataSource.getRepository(ProductGroup),
      dataSource.getRepository(SupermarketItem),
      groups,
      admin,
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
        kind: PriceScopeKind.WAREHOUSE,
        externalKey: 'a',
        label: null,
      })
    );
    const scopeB = await scopes.save(
      scopes.create({
        supermarketId: chain.id,
        kind: PriceScopeKind.WAREHOUSE,
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
      expect(pascual?.bestOffer?.priceSourceKind).toBe(
        PriceSourceKind.OFFICIAL_API
      );

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
      expect(milk.offer?.priceObservedAt).toBe('2026-08-30T10:00:00.000Z');
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
    it('re-indexes a group’s members when the group gains a synonym', async () => {
      // Nothing about the items changed, and both of them have to become
      // findable by a word that did not exist a moment ago. This is the second
      // trigger, and the reason the vectors are columns rather than generated.
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

      const after = await items.search({
        userId: SHOPPER,
        query: 'mantequilla',
      });
      expect(after.items.map((i) => i.id).sort()).toEqual(
        [ids.pascualMilk, ids.hacendadoMilk].sort()
      );

      // Put it back, so the ordering of the tests in this file does not matter.
      await groups.update({
        userId: OWNER,
        productGroupId: ids.milkGroup,
        synonyms: { en: ['milk'], es: ['leche', 'lácteo'] },
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
});
