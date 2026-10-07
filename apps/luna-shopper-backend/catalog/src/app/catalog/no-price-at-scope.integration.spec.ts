import { JwtService } from '@nestjs/jwt';
import {
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
import { categoryId } from '../db/taxonomy/ids';
import { seedTaxonomy } from '../db/taxonomy/taxonomy-seed';
import {
  Brand,
  CATALOG_ENTITIES,
  Category,
  Item,
  ItemPrice,
  PriceScope,
  ProductGroup,
  Supermarket,
  SupermarketItem,
  SupermarketLocation,
} from '../entities';
import type { CatalogEventsPublisher } from '../events/catalog-events.publisher';
import { CatalogAuditService } from './catalog-audit.service';
import { CategoryService } from './category.service';
import { EffectivePriceService } from './effective-price.service';
import { itemEanStoreOf } from './item-ean.store';
import { ItemPriceService } from './item-price.service';
import { ItemService } from './item.service';
import { LocationScopeService } from './location-scopes';
import { PlatformAdminService } from './platform-admin.service';
import { ProductGroupService } from './product-group.service';
import { SupermarketItemService } from './supermarket-item.service';

/**
 * The products a price scope has no price for (plan 0187), against real
 * Postgres.
 *
 * The rule is one clause in two statements and their two counts, and a fake
 * repository that returns rows proves none of the four. So this runs them.
 *
 * Every row of `supermarket_items` here is written by the service that owns
 * it: a price through `itemPrice.add`, which materializes the shown price, and
 * "not sold" through `supermarketItem.setAvailability`. Nothing writes the
 * table directly, here or in the read under test.
 *
 *   LUNA_INTEGRATION=1 CATALOG_DB_URL=postgres://luna_catalog:luna_catalog@localhost:<port>/luna_catalog \
 *     npx nx run luna-shopper-backend-catalog:test-integration --testFile=no-price-at-scope.integration.spec.ts
 */
const SCHEMA = 'plan0187_no_price_test';
const OWNER = 'ac700000-0000-4000-a000-000000000187';
const DAY_MS = 24 * 60 * 60 * 1000;

describeIntegration(
  'the products a scope has no price for (real Postgres)',
  () => {
    let dataSource: DataSource;
    let items: ItemService;
    let prices: ItemPriceService;
    let rows: SupermarketItemService;

    let scopeId: string;
    let otherScopeId: string;
    let groupId: string;

    /** The four products of the plan, at {@link scopeId}. */
    let priced: string;
    let notSold: string;
    let outOfDate: string;
    let noRow: string;

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
      prices = new ItemPriceService(
        dataSource.getRepository(ItemPrice),
        dataSource.getRepository(Item),
        dataSource.getRepository(PriceScope),
        admin,
        audit,
        new EffectivePriceService()
      );
      rows = new SupermarketItemService(
        dataSource.getRepository(SupermarketItem),
        dataSource.getRepository(Item),
        dataSource.getRepository(PriceScope),
        dataSource.getRepository(SupermarketLocation),
        admin,
        audit,
        new LocationScopeService()
      );

      const supermarkets = dataSource.getRepository(Supermarket);
      const chain = await supermarkets.save(
        supermarkets.create({ name: { en: 'Chain', es: 'Cadena' } })
      );
      const scopes = dataSource.getRepository(PriceScope);
      // Two regions and no national scope, so that no price is inherited and
      // each scope holds exactly the rows written at it.
      const scope = (externalKey: string) =>
        scopes.save(
          scopes.create({
            supermarketId: chain.id,
            kind: PriceScopeKind.REGION,
            externalKey,
          })
        );
      scopeId = (await scope('north')).id;
      otherScopeId = (await scope('south')).id;

      const groups = dataSource.getRepository(ProductGroup);
      groupId = (
        await groups.save(
          groups.create({
            name: { en: 'Milk', es: 'Leche' },
            slug: 'plan0187-milk',
            referenceUnit: UnitOfMeasure.LITER,
          })
        )
      ).id;

      priced = await product('Leche entera');
      notSold = await product('Leche desnatada');
      outOfDate = await product('Leche semidesnatada');
      noRow = await product('Leche fresca');

      await prices.add({
        userId: OWNER,
        itemId: priced,
        priceScopeId: scopeId,
        sourceKind: PriceSourceKind.ADMIN,
        price: 1.29,
        currency: 'EUR',
      });
      await rows.setAvailability({
        userId: OWNER,
        priceScopeId: scopeId,
        entries: [{ itemId: notSold, available: false }],
      });
      // A crawl a month old is past its seven days, so the only price this
      // scope has for the product is shown flagged, and is still a price.
      await prices.add({
        userId: OWNER,
        itemId: outOfDate,
        priceScopeId: scopeId,
        sourceKind: PriceSourceKind.OFFICIAL_API,
        price: 0.99,
        currency: 'EUR',
        observedAt: new Date(Date.now() - 30 * DAY_MS).toISOString(),
      });
    }, 180_000);

    afterAll(async () => {
      if (dataSource?.isInitialized) {
        await dataSource.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
        await dataSource.destroy();
      }
    });

    /** A product on one leaf, written the way the back office writes one. */
    const product = async (
      name: string,
      over: { productGroupId?: string; category?: string } = {}
    ): Promise<string> =>
      (
        await items.create({
          userId: OWNER,
          name: { es: name },
          categoryIds: [categoryId(over.category ?? 'beers')],
          defaultUnit: UnitOfMeasure.LITER,
          productGroupId: over.productGroupId,
        })
      ).id;

    const shown = (itemId: string, priceScopeId = scopeId) =>
      dataSource
        .getRepository(SupermarketItem)
        .findOneBy({ itemId, priceScopeId });

    const worklist = async (
      over: Partial<Parameters<ItemService['search']>[0]> = {}
    ) => {
      const page = await items.search({
        userId: OWNER,
        withoutPriceAtScopeId: scopeId,
        limit: 100,
        ...over,
      });
      return { ids: page.items.map((item) => item.id), page };
    };

    it('holds the four rows the plan names, as the services wrote them', async () => {
      expect(Number((await shown(priced))?.price)).toBe(1.29);
      expect((await shown(notSold))?.available).toBe(false);
      expect((await shown(notSold))?.price).toBeNull();
      const old = await shown(outOfDate);
      expect(Number(old?.price)).toBe(0.99);
      expect(old?.stale).toBe(true);
      expect(await shown(noRow)).toBeNull();
    });

    it('lists only the product with no row, and counts one', async () => {
      const { ids, page } = await worklist();

      expect(ids).toEqual([noRow]);
      expect(page.total).toBe(1);
      expect(page.nextCursor).toBeNull();
    });

    it('answers the same on the ranked branch', async () => {
      // Every one of the four is a "leche", so the word narrows nothing and
      // the clause is all that decides.
      const { ids, page } = await worklist({ query: 'leche' });

      expect(ids).toEqual([noRow]);
      expect(page.total).toBe(1);
    });

    it('asks each scope its own question', async () => {
      // The other scope holds no row at all, so all four lack a price there.
      const { ids, page } = await worklist({
        withoutPriceAtScopeId: otherScopeId,
      });

      expect(ids.sort()).toEqual([priced, notSold, outOfDate, noRow].sort());
      expect(page.total).toBe(4);
    });

    it('puts no total on a read that names no scope', async () => {
      const page = await items.search({ userId: OWNER, limit: 100 });

      expect(page.items.length).toBeGreaterThanOrEqual(4);
      expect('total' in page).toBe(false);
    });

    it('refuses a scope that does not exist with the price scope 404', async () => {
      await expect(
        worklist({
          withoutPriceAtScopeId: '00000000-0000-4000-a000-000000000000',
        })
      ).rejects.toMatchObject({
        code: 'not_found',
        message: 'Price scope not found',
      });
    });

    describe('beside the other filters, and across pages', () => {
      let soldUnpriced: string;
      let grouped: string;
      let elsewhere: string;

      beforeAll(async () => {
        // A row that says "sold" and states no price is not an answer.
        soldUnpriced = await product('Leche de avena');
        await rows.setAvailability({
          userId: OWNER,
          priceScopeId: scopeId,
          entries: [{ itemId: soldUnpriced, available: true }],
        });
        grouped = await product('Leche de cabra', { productGroupId: groupId });
        elsewhere = await product('Queso curado', { category: 'beer-packs' });
      });

      it('lists a product whose row says sold and states no price', async () => {
        expect((await shown(soldUnpriced))?.available).toBe(true);
        expect((await shown(soldUnpriced))?.price).toBeNull();

        const { ids, page } = await worklist();

        expect(ids.sort()).toEqual(
          [noRow, soldUnpriced, grouped, elsewhere].sort()
        );
        expect(page.total).toBe(4);
      });

      it('combines with the text, on the ranked branch', async () => {
        const { ids, page } = await worklist({ query: 'queso' });

        expect(ids).toEqual([elsewhere]);
        expect(page.total).toBe(1);
      });

      // Under four characters the trigram branch is not written, and that
      // branch was the only part of the count that named the text as typed.
      // The count then carried a parameter that no part of it mentioned, and
      // Postgres refused the statement.
      it('counts a text too short for the fuzzy branch, on the ranked branch', async () => {
        // Neither fragment is a Spanish stop word, which the stemmer would drop.
        const three = await worklist({ query: 'lec' });
        expect(three.ids.sort()).toEqual([noRow, soldUnpriced, grouped].sort());
        expect(three.page.total).toBe(3);

        const two = await worklist({ query: 'qu' });
        expect(two.ids).toEqual([elsewhere]);
        expect(two.page.total).toBe(1);

        // A barcode shorter than four characters does not exist, so this is the
        // one shape left: digits that are words and not a barcode.
        const digits = await worklist({ query: '12' });
        expect(digits.ids).toEqual([]);
        expect(digits.page.total).toBe(0);
      });

      it('combines with the text under an order by name, on the listing branch', async () => {
        const { ids, page } = await worklist({ query: 'leche', order: 'name' });

        expect(ids.sort()).toEqual([noRow, soldUnpriced, grouped].sort());
        expect(page.total).toBe(3);
      });

      it('combines with the category', async () => {
        const { ids, page } = await worklist({
          categoryId: categoryId('beer-packs'),
        });

        expect(ids).toEqual([elsewhere]);
        expect(page.total).toBe(1);
      });

      it('combines with the group, and with no group', async () => {
        const inGroup = await worklist({ productGroupId: groupId });
        expect(inGroup.ids).toEqual([grouped]);
        expect(inGroup.page.total).toBe(1);

        const ungrouped = await worklist({ withoutProductGroup: true });
        expect(ungrouped.ids.sort()).toEqual(
          [noRow, soldUnpriced, elsewhere].sort()
        );
        expect(ungrouped.page.total).toBe(3);
      });

      it('pages by cursor without a repeat or a gap, and counts the whole on every page', async () => {
        for (const order of ['name', 'created', 'updated'] as const) {
          const seen: string[] = [];
          let cursor: string | undefined;
          do {
            const { ids, page } = await worklist({ order, limit: 3, cursor });
            // The count is of the request, not of what the cursor has left.
            expect(page.total).toBe(4);
            seen.push(...ids);
            cursor = page.nextCursor ?? undefined;
          } while (cursor !== undefined);

          expect(seen).toHaveLength(4);
          expect(seen.sort()).toEqual(
            [noRow, soldUnpriced, grouped, elsewhere].sort()
          );
        }
      });

      it('pages the ranked branch the same way', async () => {
        const first = await worklist({ query: 'leche', limit: 2 });
        expect(first.page.total).toBe(3);
        expect(first.page.nextCursor).not.toBeNull();

        const second = await worklist({
          query: 'leche',
          limit: 2,
          cursor: first.page.nextCursor ?? undefined,
        });
        expect(second.page.total).toBe(3);
        expect([...first.ids, ...second.ids].sort()).toEqual(
          [noRow, soldUnpriced, grouped].sort()
        );
      });

      it('drops a product from the list the moment it is priced', async () => {
        await prices.add({
          userId: OWNER,
          itemId: soldUnpriced,
          priceScopeId: scopeId,
          sourceKind: PriceSourceKind.ADMIN,
          price: 2.1,
          currency: 'EUR',
        });

        const { ids, page } = await worklist();

        expect(ids).not.toContain(soldUnpriced);
        expect(page.total).toBe(3);
      });
    });
  }
);
