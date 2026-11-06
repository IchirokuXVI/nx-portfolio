import { ConfigService } from '@nestjs/config';
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
import {
  CATALOG_ENTITIES,
  CatalogAudit,
  Item,
  ItemPrice,
  PriceScope,
  Supermarket,
  SupermarketItem,
  SupermarketLocation,
} from '../entities';
import { CatalogAuditService } from './catalog-audit.service';
import { toItemOfferView, toSupermarketItemView } from './catalog.mappers';
import { LocationScopeService } from './location-scopes';
import { PlatformAdminService } from './platform-admin.service';
import { SupermarketItemService } from './supermarket-item.service';

/**
 * Gone, out of stock and kept sold, against real Postgres (plan 0220,
 * sections 6.1, 15.1, 15.2 and 15.6).
 *
 * The migration is run on a schema of its own, so the two new columns exist
 * exactly as a cluster gets them. What a fake cannot prove is the price that
 * keeps a product sold: the current row per kind, its policy, its window and
 * its age are one query over `item_prices` and `price_policies`.
 *
 *   bash k8s/e2e/luna-shopper-backend/luna-slot.sh --ephemeral --up <n>
 *   LUNA_INTEGRATION=1 CATALOG_DB_URL=postgres://luna_catalog:luna_catalog@localhost:<port>/luna_catalog \
 *     npx nx run luna-shopper-backend-catalog:test-integration --testFile=supermarket-item-delisting.integration.spec.ts
 */
const SCHEMA = 'plan0220_delisting_test';
const HARVESTER = '11111111-1111-4111-8111-111111111111';
const DAY = 24 * 60 * 60 * 1000;

describeIntegration(
  'gone and out of stock on the offer of a scope (real Postgres)',
  () => {
    let dataSource: DataSource;
    let service: SupermarketItemService;
    let scopeId: string;

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
        extra: { options: `-c search_path=${SCHEMA}` },
      });
      await dataSource.initialize();
      await dataSource.runMigrations();

      const admin = new PlatformAdminService(new JwtService({}), {
        getOrThrow: () => ({
          authJwtPublicKey: '',
          adminJwtPublicKey: '',
          serviceActorIds: [HARVESTER],
        }),
      } as unknown as ConfigService);
      service = new SupermarketItemService(
        dataSource.getRepository(SupermarketItem),
        dataSource.getRepository(Item),
        dataSource.getRepository(PriceScope),
        dataSource.getRepository(SupermarketLocation),
        admin,
        new CatalogAuditService(dataSource),
        new LocationScopeService()
      );

      const supermarkets = dataSource.getRepository(Supermarket);
      const chain = await supermarkets.save(
        supermarkets.create({ name: { en: 'Chain', es: 'Cadena' } })
      );
      const scopes = dataSource.getRepository(PriceScope);
      scopeId = (
        await scopes.save(
          scopes.create({
            supermarketId: chain.id,
            kind: PriceScopeKind.LOCAL_AREA,
            externalKey: '4661',
          })
        )
      ).id;
    }, 180_000);

    afterAll(async () => {
      if (dataSource?.isInitialized) {
        await dataSource.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
        await dataSource.destroy();
      }
    });

    /** A product with an offer at the scope that says sold. */
    async function product(): Promise<string> {
      const items = dataSource.getRepository(Item);
      const item = await items.save(
        items.create({
          name: { en: 'Product', es: 'Producto' },
          defaultUnit: UnitOfMeasure.UNIT,
        })
      );
      await service.setAvailability({
        userId: HARVESTER,
        priceScopeId: scopeId,
        entries: [{ itemId: item.id, available: true }],
      });
      return item.id;
    }

    /** A price row at the scope, as a source wrote it. */
    async function price(
      itemId: string,
      sourceKind: PriceSourceKind,
      over: Partial<ItemPrice> = {}
    ): Promise<void> {
      const prices = dataSource.getRepository(ItemPrice);
      const now = new Date();
      await prices.save(
        prices.create({
          itemId,
          priceScopeId: scopeId,
          sourceKind,
          price: 2.5,
          currency: 'EUR',
          observedAt: now,
          lastObservedAt: now,
          validFrom: null,
          validUntil: null,
          ...over,
        })
      );
    }

    const offer = (itemId: string) =>
      dataSource
        .getRepository(SupermarketItem)
        .findOneByOrFail({ itemId, priceScopeId: scopeId });

    const write = (
      itemId: string,
      entry: { available?: boolean; delisted?: boolean; outOfStock?: boolean },
      onlyIfMissing?: boolean
    ) =>
      service.setAvailability({
        userId: HARVESTER,
        priceScopeId: scopeId,
        entries: [{ itemId, ...entry }],
        ...(onlyIfMissing ? { onlyIfMissing } : {}),
      });

    const trailOf = async (itemId: string) => {
      const row = await offer(itemId);
      return dataSource
        .getRepository(CatalogAudit)
        .count({ where: { entityId: row.id } });
    };

    it('sets delistedAt once, keeps the first instant, clears it on false, and leaves it when absent', async () => {
      const itemId = await product();

      expect(await write(itemId, { available: false, delisted: true })).toEqual(
        {
          updated: 1,
          keptSold: 0,
        }
      );
      const first = (await offer(itemId)).delistedAt;
      expect(first).toBeInstanceOf(Date);
      expect((await offer(itemId)).available).toBe(false);

      const trail = await trailOf(itemId);
      // The same statement again changes nothing and writes no audit row.
      expect(await write(itemId, { available: false, delisted: true })).toEqual(
        {
          updated: 0,
          keptSold: 0,
        }
      );
      expect((await offer(itemId)).delistedAt?.getTime()).toBe(
        first?.getTime()
      );
      expect(await trailOf(itemId)).toBe(trail);

      // Absent leaves it.
      await write(itemId, { available: true });
      expect((await offer(itemId)).delistedAt?.getTime()).toBe(
        first?.getTime()
      );

      await write(itemId, { available: true, delisted: false });
      expect((await offer(itemId)).delistedAt).toBeNull();
    });

    it('sets outOfStockAt once and hides nothing, and the views carry it', async () => {
      const itemId = await product();

      await write(itemId, { available: true, outOfStock: true });
      const row = await offer(itemId);
      expect(row.available).toBe(true);
      expect(row.outOfStockAt).toBeInstanceOf(Date);
      expect(toSupermarketItemView(row, null)).toMatchObject({
        available: true,
        delistedAt: null,
        outOfStockAt: row.outOfStockAt?.toISOString(),
      });
      expect(toItemOfferView(row, null).outOfStockAt).toBe(
        row.outOfStockAt?.toISOString()
      );

      expect(
        await write(itemId, { available: true, outOfStock: true })
      ).toEqual({ updated: 0, keptSold: 0 });
      // Gone leaves the out of stock instant as it is.
      await write(itemId, { available: false, delisted: true });
      expect((await offer(itemId)).outOfStockAt?.getTime()).toBe(
        row.outOfStockAt?.getTime()
      );

      await write(itemId, {
        available: true,
        delisted: false,
        outOfStock: false,
      });
      expect(await offer(itemId)).toMatchObject({
        available: true,
        delistedAt: null,
        outOfStockAt: null,
      });
    });

    it('keeps a product a 404 turned off not sold through the next first miss', async () => {
      // A listed product whose detail answered 404 at this scope, then a whole
      // walk that missed it: the first miss sends `outOfStock` alone.
      const itemId = await product();
      await write(itemId, { available: false });
      await write(itemId, { outOfStock: true });

      const row = await offer(itemId);
      expect(row.available).toBe(false);
      expect(row.outOfStockAt).toBeInstanceOf(Date);
    });

    it('creates no row for a first miss at a scope that has none', async () => {
      const items = dataSource.getRepository(Item);
      const item = await items.save(
        items.create({
          name: { en: 'Unoffered', es: 'Sin oferta' },
          defaultUnit: UnitOfMeasure.UNIT,
        })
      );

      expect(await write(item.id, { outOfStock: true })).toEqual({
        updated: 0,
        keptSold: 0,
      });
      expect(
        await dataSource
          .getRepository(SupermarketItem)
          .countBy({ itemId: item.id, priceScopeId: scopeId })
      ).toBe(0);
    });

    it('ignores delisted and outOfStock under onlyIfMissing', async () => {
      const itemId = await product();

      await write(
        itemId,
        { available: false, delisted: true, outOfStock: true },
        true
      );

      expect(await offer(itemId)).toMatchObject({
        available: true,
        delistedAt: null,
        outOfStockAt: null,
      });
    });

    it('keeps a gone product sold for a current ADMIN price, and counts it', async () => {
      const itemId = await product();
      await price(itemId, PriceSourceKind.ADMIN);

      expect(await write(itemId, { available: false, delisted: true })).toEqual(
        {
          updated: 1,
          keptSold: 1,
        }
      );
      const row = await offer(itemId);
      expect(row.available).toBe(true);
      expect(row.delistedAt).toBeInstanceOf(Date);
    });

    it('counts nothing kept sold for a row that was already not sold', async () => {
      const itemId = await product();
      await write(itemId, { available: false });
      await price(itemId, PriceSourceKind.ADMIN);

      expect(await write(itemId, { available: false, delisted: true })).toEqual(
        { updated: 1, keptSold: 0 }
      );
      expect((await offer(itemId)).available).toBe(false);
    });

    it('keeps a gone product sold for a current leaflet price', async () => {
      const itemId = await product();
      await price(itemId, PriceSourceKind.OFFICIAL_LEAFLET, {
        validUntil: new Date(Date.now() + 3 * DAY),
      });

      expect(
        (await write(itemId, { available: false, delisted: true })).keptSold
      ).toBe(1);
      expect((await offer(itemId)).available).toBe(true);
    });

    it('does not keep a product sold for a leaflet price whose window ended', async () => {
      const itemId = await product();
      await price(itemId, PriceSourceKind.OFFICIAL_LEAFLET, {
        validUntil: new Date(Date.now() - DAY),
      });

      expect(
        (await write(itemId, { available: false, delisted: true })).keptSold
      ).toBe(0);
      expect((await offer(itemId)).available).toBe(false);
    });

    it('does not keep a product sold for a walk price', async () => {
      const itemId = await product();
      await price(itemId, PriceSourceKind.OFFICIAL_API);

      expect(
        (await write(itemId, { available: false, delisted: true })).keptSold
      ).toBe(0);
      expect((await offer(itemId)).available).toBe(false);
    });

    it('keeps nothing sold for a plain negative with no delisted', async () => {
      const itemId = await product();
      await price(itemId, PriceSourceKind.ADMIN);

      // A 404 indicator is not a delisting, and the person's price does not
      // overrule it here.
      expect(await write(itemId, { available: false })).toEqual({
        updated: 1,
        keptSold: 0,
      });
      expect((await offer(itemId)).available).toBe(false);
    });
  }
);
