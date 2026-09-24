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
 * A suggestion carries what the card draws (plan 0161, sections 1 and 2),
 * against real Postgres.
 *
 * The member query is one raw statement with a lateral and a window function,
 * and every claim about it is about an `ORDER BY` or a `PARTITION BY`, which a
 * fake repository cannot check. The milk group holds seven products built to
 * land in a known order:
 *
 * | member   | rows at the requested scopes                  | rank |
 * | -------- | --------------------------------------------- | ---- |
 * | Asturiana| 1,00 € at Mercadona, 1,00 €/L                 | 1    |
 * | Pascual  | 0,80 € at Carrefour (1,20 €/L), 0,90 € at M.  | 2    |
 * | Leaflet  | no till price, 0,50 €/L                       | 3    |
 * | Alpha    | none                                          | 4    |
 * | Beta     | a row at a scope nobody asked for             | 5    |
 * | Delta    | a row that says it is not on the shelf        | cut  |
 * | Epsilon  | none                                          | cut  |
 *
 *   LUNA_INTEGRATION=1 CATALOG_DB_URL=postgres://luna_catalog:luna_catalog@localhost:<port>/luna_catalog \
 *     npx nx run luna-shopper-backend-catalog:test-integration --testFile=suggest-card
 */
const SCHEMA = 'plan0161_suggest_card_test';
const OWNER = 'ac700000-0000-4000-a000-000000000161';
const SHOPPER = 'shopper';
const OBSERVED = new Date('2026-09-20T10:00:00.000Z');

describeIntegration(
  'a suggestion carries what the card draws (real Postgres)',
  () => {
    let dataSource: DataSource;
    let items: ItemService;

    const ids = {
      milk: '',
      bread: '',
      asturiana: '',
      pascual: '',
      leaflet: '',
      alpha: '',
      beta: '',
      delta: '',
      epsilon: '',
      loaf: '',
      mercadona: '',
      carrefour: '',
      elsewhere: '',
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
        // `public` behind the scratch schema for `pg_trgm`, as in the search
        // integration spec, which explains why at length.
        extra: { options: `-c search_path=${SCHEMA},public` },
      });
      await dataSource.initialize();
      await dataSource.runMigrations();

      const admin = new PlatformAdminService(new JwtService(), {
        getOrThrow: () => ({ adminJwtPublicKey: '', serviceActorIds: [OWNER] }),
      } as never);
      const events = {
        itemGroupChanged: jest.fn(),
        productGroupDeleted: jest.fn(),
      } as unknown as CatalogEventsPublisher;
      const audit = new CatalogAuditService(dataSource);
      const groups = new ProductGroupService(
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

      const group = async (en: string, es: string, slug: string) =>
        (
          await groups.create({
            userId: OWNER,
            name: { en, es },
            slug,
            referenceUnit: UnitOfMeasure.LITER,
            synonyms: { en: [], es: [] },
          })
        ).id;
      ids.milk = await group('Milk', 'Leche', 'milk');
      ids.bread = await group('Bread', 'Pan', 'bread');

      const product = async (name: string, productGroupId: string) =>
        (
          await items.create({
            userId: OWNER,
            name: { en: name, es: name },
            category: ItemCategory.DAIRY,
            defaultUnit: UnitOfMeasure.LITER,
            productGroupId,
          })
        ).id;
      ids.asturiana = await product('Leche Asturiana', ids.milk);
      ids.pascual = await product('Leche Pascual', ids.milk);
      ids.leaflet = await product('Leche Leaflet', ids.milk);
      ids.alpha = await product('Leche Alpha', ids.milk);
      ids.beta = await product('Leche Beta', ids.milk);
      ids.delta = await product('Leche Delta', ids.milk);
      ids.epsilon = await product('Leche Epsilon', ids.milk);
      ids.loaf = await product('Pan de molde', ids.bread);

      const chains = dataSource.getRepository(Supermarket);
      const chain = (name: string) =>
        chains.save(
          chains.create({
            name: { en: name, es: name },
            logoUrl: null,
            websiteUrl: null,
            externalBrandKey: null,
          })
        );
      const scopes = dataSource.getRepository(PriceScope);
      const scope = async (name: string) =>
        (
          await scopes.save(
            scopes.create({
              supermarketId: (await chain(name)).id,
              kind: PriceScopeKind.STORE,
              externalKey: name.toLowerCase(),
              label: null,
            })
          )
        ).id;
      ids.mercadona = await scope('Mercadona');
      ids.carrefour = await scope('Carrefour');
      ids.elsewhere = await scope('Elsewhere');

      const prices = dataSource.getRepository(SupermarketItem);
      const row = (
        itemId: string,
        priceScopeId: string,
        price: number | null,
        unitPrice: number | null,
        available = true
      ) =>
        prices.create({
          itemId,
          priceScopeId,
          price,
          unitPrice,
          unitPriceLabel: unitPrice === null ? null : 'L',
          currency: 'EUR',
          priceObservedAt: OBSERVED,
          priceSourceKind: PriceSourceKind.OFFICIAL_WEB,
          available,
        });
      await prices.save([
        row(ids.asturiana, ids.mercadona, 1, 1),
        row(ids.pascual, ids.carrefour, 0.8, 1.2),
        row(ids.pascual, ids.mercadona, 0.9, 1.35),
        row(ids.leaflet, ids.mercadona, null, 0.5),
        row(ids.beta, ids.elsewhere, 0.1, 0.1),
        row(ids.delta, ids.mercadona, 0.1, 0.1, false),
        row(ids.loaf, ids.mercadona, 1.5, 3),
      ]);
    }, 120_000);

    afterAll(async () => {
      if (dataSource?.isInitialized) {
        await dataSource.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
        await dataSource.destroy();
      }
    });

    const requested = () => [ids.mercadona, ids.carrefour];
    const milkOf = async (
      extra: { offers?: 'all'; members?: number; priceScopeIds?: string[] } = {}
    ) => {
      const page = await items.searchOffers({
        userId: SHOPPER,
        query: 'leche',
        priceScopeIds: requested(),
        ...extra,
      });
      const milk = page.items.find((row) => row.group.id === ids.milk);
      if (!milk) {
        throw new Error('the milk group was not found');
      }
      return milk;
    };

    describe('the cheapest five of a group (section 2)', () => {
      it('ranks by the lateral keys, then the unpriced by name, five at most', async () => {
        const milk = await milkOf({ members: 5 });

        expect(milk.members?.map((m) => m.id)).toEqual([
          ids.asturiana,
          ids.pascual,
          ids.leaflet,
          ids.alpha,
          // Priced only at a scope nobody asked for, so unpriced here.
          ids.beta,
        ]);
      });

      it('makes the first member the cheapest item', async () => {
        const milk = await milkOf({ members: 5 });

        expect(milk.cheapestItem?.id).toBe(ids.asturiana);
        expect(milk.members?.[0]).toEqual(milk.cheapestItem);
      });

      it('gives each member its own best offer, and nothing more', async () => {
        const milk = await milkOf({ members: 5 });

        // Pascual's cheaper unit price is at Carrefour.
        expect(milk.members?.[1].bestOffer).toMatchObject({
          priceScopeId: ids.carrefour,
          price: 0.8,
          unitPrice: 1.2,
        });
        expect(milk.members?.[2].bestOffer).toMatchObject({
          priceScopeId: ids.mercadona,
          price: null,
          unitPrice: 0.5,
        });
        expect('bestOffer' in (milk.members?.[3] ?? {})).toBe(false);
        expect(milk.members?.some((m) => 'offers' in m)).toBe(false);
      });

      it('ranks each group on its own', async () => {
        const page = await items.searchOffers({
          userId: SHOPPER,
          query: 'pan',
          priceScopeIds: requested(),
          members: 5,
        });
        const bread = page.items.find((row) => row.group.id === ids.bread);

        expect(bread?.members?.map((m) => m.id)).toEqual([ids.loaf]);
      });

      it('clamps a larger count to five', async () => {
        const milk = await milkOf({ members: 50 });

        expect(milk.members).toHaveLength(5);
      });

      it('names five members by name when nothing is priced', async () => {
        const milk = await milkOf({ members: 5, priceScopeIds: [] });

        expect(milk.cheapestItem).toBeNull();
        expect(milk.members?.map((m) => m.id)).toEqual([
          ids.alpha,
          ids.asturiana,
          ids.beta,
          ids.delta,
          ids.epsilon,
        ]);
      });

      it('keeps `itemIds` whole, and adds no members unless asked', async () => {
        const asked = await milkOf({ members: 5 });
        const plain = await milkOf();

        expect(asked.itemIds).toHaveLength(7);
        expect(asked.itemIds).toEqual(plain.itemIds);
        expect('members' in plain).toBe(false);
        expect(asked.offer).toEqual(plain.offer);
        expect(asked.cheapestItem).toEqual(plain.cheapestItem);
      });
    });

    describe('every scope price on both searches (section 1)', () => {
      it('fills every offer on an item, and agrees with the cheapest-only read', async () => {
        const all = await items.search({
          userId: SHOPPER,
          query: 'pascual',
          priceScopeIds: requested(),
          offers: 'all',
        });
        const best = await items.search({
          userId: SHOPPER,
          query: 'pascual',
          priceScopeIds: requested(),
        });

        const pascual = all.items.find((i) => i.id === ids.pascual);
        expect(pascual?.offers?.map((o) => o.priceScopeId)).toEqual([
          ids.carrefour,
          ids.mercadona,
        ]);
        expect(pascual?.bestOffer).toEqual(pascual?.offers?.[0]);
        expect(pascual?.bestOffer).toEqual(
          best.items.find((i) => i.id === ids.pascual)?.bestOffer
        );
        expect(best.items.some((i) => 'offers' in i)).toBe(false);
      });

      it("fills the cheapest item's offers, led by the group's offer", async () => {
        const milk = await milkOf({ offers: 'all' });

        expect(milk.cheapestItem?.offers?.[0]).toEqual(milk.offer);
        expect(milk.cheapestItem?.bestOffer).toEqual(milk.offer);
      });
    });
  }
);
