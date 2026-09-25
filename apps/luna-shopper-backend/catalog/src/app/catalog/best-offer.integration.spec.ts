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
  SupermarketLocation,
  SupermarketLocationPriceScope,
} from '../entities';
import { CatalogEventsPublisher } from '../events/catalog-events.publisher';
import { CatalogAuditService } from './catalog-audit.service';
import { ItemService } from './item.service';
import { LocationScopeService } from './location-scopes';
import { PlatformAdminService } from './platform-admin.service';
import { ProductGroupService } from './product-group.service';
import { ScopeResolverService } from './scope-resolver.service';

/**
 * The best offer is one with a price (plan 0157), against real Postgres.
 *
 * The rows are the plan 0150 beers as the shopper's area held them: Heineken
 * at 0,69 € in Mercadona's leaflet with no unit price, and at El Jamón with no
 * till price and a unit price of 2 per litre. Every claim here is about an
 * `ORDER BY`, which only a real database can check.
 *
 * It works in a scratch schema of its own and drops it afterwards.
 *
 *   LUNA_INTEGRATION=1 CATALOG_DB_URL=postgres://luna_catalog:luna_catalog@localhost:<port>/luna_catalog \
 *     npx nx run luna-shopper-backend-catalog:test-integration --testFile=best-offer
 */
const SCHEMA = 'plan0157_best_offer_test';
const OWNER = 'ac700000-0000-4000-a000-000000000157';
const SHOPPER = 'shopper';
const OBSERVED = new Date('2026-09-20T10:00:00.000Z');

describeIntegration(
  'the best offer is one with a price (real Postgres)',
  () => {
    let dataSource: DataSource;
    let items: ItemService;
    let resolver: ScopeResolverService;

    const ids = {
      beerGroup: '',
      heineken: '',
      molen: '',
      pilsen: '',
      mercadonaScope: '',
      elJamonScope: '',
      emptyStoreScope: '',
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
      resolver = new ScopeResolverService(
        dataSource.getRepository(SupermarketLocation),
        dataSource.getRepository(PriceScope),
        dataSource.getRepository(Supermarket),
        new LocationScopeService()
      );

      const beer = await groups.create({
        userId: OWNER,
        name: { en: 'Beer', es: 'Cerveza' },
        slug: 'beer',
        referenceUnit: UnitOfMeasure.LITER,
        synonyms: { en: [], es: [] },
      });
      ids.beerGroup = beer.id;

      // Three products with one name, so text relevance ties and the price keys
      // are what decide between them.
      const beerNamed = (brand: string) =>
        items.create({
          userId: OWNER,
          name: { en: 'Cerveza', es: 'Cerveza' },
          brand,
          category: ItemCategory.BEVERAGES,
          defaultUnit: UnitOfMeasure.LITER,
          productGroupId: beer.id,
        });
      ids.heineken = (await beerNamed('Heineken')).id;
      ids.molen = (await beerNamed('Molen')).id;
      ids.pilsen = (await beerNamed('Cruzcampo')).id;

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
      const mercadona = await chain('Mercadona');
      const elJamon = await chain('El Jamón');
      const dia = await chain('Dia');

      const scopes = dataSource.getRepository(PriceScope);
      const scope = (supermarketId: string, externalKey: string) =>
        scopes.save(
          scopes.create({
            supermarketId,
            kind: PriceScopeKind.STORE,
            externalKey,
            label: null,
          })
        );
      ids.mercadonaScope = (await scope(mercadona.id, 'mercadona-4661')).id;
      ids.elJamonScope = (await scope(elJamon.id, 'el-jamon-1')).id;
      ids.emptyStoreScope = (await scope(dia.id, 'dia-imported')).id;

      const prices = dataSource.getRepository(SupermarketItem);
      const row = (
        itemId: string,
        priceScopeId: string,
        values: Pick<
          SupermarketItem,
          'price' | 'unitPrice' | 'unitPriceLabel' | 'priceSourceKind'
        >
      ) =>
        prices.create({
          itemId,
          priceScopeId,
          currency: 'EUR',
          priceObservedAt: OBSERVED,
          available: true,
          ...values,
        });
      await prices.save([
        // Heineken, as plan 0150 found it.
        row(ids.heineken, ids.mercadonaScope, {
          price: 0.69,
          unitPrice: null,
          unitPriceLabel: null,
          priceSourceKind: PriceSourceKind.OFFICIAL_LEAFLET,
        }),
        row(ids.heineken, ids.elJamonScope, {
          price: null,
          unitPrice: 2,
          unitPriceLabel: 'el litro le sale a',
          priceSourceKind: PriceSourceKind.OFFICIAL_LEAFLET,
        }),
        // A beer El Jamón prints a unit price for and nothing else: the lowest
        // unit price of the three, and not an offer.
        row(ids.molen, ids.elJamonScope, {
          price: null,
          unitPrice: 1,
          unitPriceLabel: 'el litro le sale a',
          priceSourceKind: PriceSourceKind.OFFICIAL_LEAFLET,
        }),
        // The one row here with both numbers.
        row(ids.pilsen, ids.mercadonaScope, {
          price: 0.55,
          unitPrice: 1.67,
          unitPriceLabel: 'L',
          priceSourceKind: PriceSourceKind.OFFICIAL_API,
        }),
      ]);

      // Two shops in one postal code: a Mercadona on the priced scope, and an
      // imported Dia whose own STORE scope heads its stack and holds nothing.
      const locations = dataSource.getRepository(SupermarketLocation);
      const shop = (supermarketId: string) =>
        locations.save(
          locations.create({
            supermarketId,
            label: null,
            address: null,
            city: null,
            country: 'ES',
            latitude: null,
            longitude: null,
            postalCode: '28157',
            postalCodeSource: null,
            externalRef: null,
            externalProvider: null,
          })
        );
      const mercadonaShop = await shop(mercadona.id);
      const diaShop = await shop(dia.id);
      await dataSource.getRepository(SupermarketLocationPriceScope).save([
        {
          supermarketLocationId: mercadonaShop.id,
          priceScopeId: ids.mercadonaScope,
        },
        {
          supermarketLocationId: diaShop.id,
          priceScopeId: ids.emptyStoreScope,
        },
      ]);
    }, 120_000);

    afterAll(async () => {
      if (dataSource?.isInitialized) {
        await dataSource.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
        await dataSource.destroy();
      }
    });

    const bothScopes = () => [ids.mercadonaScope, ids.elJamonScope];

    describe('search, items', () => {
      it('names the priced row as the best offer over a priceless one with a unit price', async () => {
        const page = await items.search({
          userId: SHOPPER,
          query: 'cerveza',
          priceScopeIds: bothScopes(),
        });

        const heineken = page.items.find((item) => item.id === ids.heineken);
        expect(heineken?.bestOffer).toMatchObject({
          priceScopeId: ids.mercadonaScope,
          price: 0.69,
          unitPrice: null,
        });
      });

      it('still quotes a priceless row when it is the only one there is', async () => {
        const page = await items.search({
          userId: SHOPPER,
          query: 'cerveza',
          priceScopeIds: bothScopes(),
        });

        const molen = page.items.find((item) => item.id === ids.molen);
        expect(molen?.bestOffer).toMatchObject({
          priceScopeId: ids.elJamonScope,
          price: null,
          unitPrice: 1,
          unitPriceLabel: 'el litro le sale a',
          unitBasis: 'LITER',
        });
      });

      it('ranks by the unit price of priced rows only, in the cheapest key', async () => {
        // By every unit price, Molen (1) and Heineken (2) would come before the
        // Cruzcampo (1.67 at 0,55 €). Neither has a priced row with a unit price,
        // so the Cruzcampo, the one beer with both, comes first.
        const page = await items.search({
          userId: SHOPPER,
          query: 'cerveza',
          priceScopeIds: bothScopes(),
        });

        expect(page.items.map((item) => item.id)).toHaveLength(3);
        expect(page.items[0].id).toBe(ids.pilsen);
        expect(page.items[0].bestOffer).toMatchObject({
          price: 0.55,
          unitPrice: 1.67,
          unitPriceLabel: 'L',
          unitBasis: 'LITER',
        });
      });
    });

    describe('search, groups', () => {
      it('picks a priced member over a priceless one with a lower unit price', async () => {
        const page = await items.searchOffers({
          userId: SHOPPER,
          query: 'cerveza',
          priceScopeIds: bothScopes(),
        });

        const group = page.items.find((row) => row.group.id === ids.beerGroup);
        expect(group?.cheapestItem?.id).toBe(ids.pilsen);
        expect(group?.offer).toMatchObject({
          itemId: ids.pilsen,
          price: 0.55,
          unitPrice: 1.67,
          unitBasis: 'LITER',
        });
      });
    });

    describe('search and basket', () => {
      it('name the same best offer for the plan 0150 Heineken', async () => {
        const searched = await items.search({
          userId: SHOPPER,
          query: 'cerveza',
          priceScopeIds: bothScopes(),
        });
        // What `basket-catalog.service.ts` asks for.
        const basket = await items.getMany({
          ids: [ids.heineken],
          priceScopeIds: bothScopes(),
          offers: 'all',
        });
        const lookup = await items.getMany({
          ids: [ids.heineken],
          priceScopeIds: bothScopes(),
        });

        const fromSearch = searched.items.find(
          (item) => item.id === ids.heineken
        )?.bestOffer;
        expect(fromSearch).toBeDefined();
        expect(basket.items[0].bestOffer).toEqual(fromSearch);
        expect(lookup.items[0].bestOffer).toEqual(fromSearch);
        // Every offer is still listed, the priceless one last.
        expect(basket.items[0].offers?.map((offer) => offer.price)).toEqual([
          0.69,
          null,
        ]);
      });
    });

    describe('the scope answer', () => {
      it('says which quoted scopes hold a price', async () => {
        const resolved = await resolver.resolve({
          userId: SHOPPER,
          postalCodes: ['28157'],
        });

        const byId = new Map(
          resolved.scopes.map((scope) => [scope.priceScopeId, scope])
        );
        expect(byId.get(ids.mercadonaScope)).toMatchObject({
          quoted: true,
          priced: true,
        });
        expect(byId.get(ids.emptyStoreScope)).toMatchObject({
          quoted: true,
          priced: false,
        });
      });
    });
  }
);
