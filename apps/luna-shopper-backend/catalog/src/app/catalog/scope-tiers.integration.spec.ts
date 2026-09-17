import { ConfigService } from '@nestjs/config';
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
  ItemPrice,
  PostalCodePoint,
  PriceScope,
  Supermarket,
  SupermarketItem,
  SupermarketLocation,
} from '../entities';
import { CatalogAuditService } from './catalog-audit.service';
import { EffectivePriceService } from './effective-price.service';
import { ItemPriceService } from './item-price.service';
import { LocationScopeService } from './location-scopes';
import { PlatformAdminService } from './platform-admin.service';
import { PostalCodeService } from './postal-code.service';
import { PriceScopeService } from './price-scope.service';
import { SupermarketLocationService } from './supermarket-location.service';

/**
 * The four tiers and a shop that always prices itself, against real Postgres
 * (plan 0116, sections 5, 7 and 9).
 *
 * A fake cannot prove either half: that a shop created on a warehouse reads the
 * warehouse's price through its own STORE scope needs the stack table and the
 * inheritance query, and the kind filter is a clause over the real enum.
 *
 *   bash k8s/e2e/luna-shopper-backend/luna-slot.sh --up
 *   LUNA_INTEGRATION=1 CATALOG_DB_URL=postgres://luna_catalog:luna_catalog@localhost:<port>/luna_catalog \
 *     npx nx run luna-shopper-backend-catalog:test-integration
 */
const SCHEMA = 'plan0116_scope_tiers_test';

const OPERATOR = '22222222-2222-4222-8222-222222222222';

describeIntegration('scope tiers and the store scope (real Postgres)', () => {
  let dataSource: DataSource;
  let scopes: PriceScopeService;
  let locations: SupermarketLocationService;
  let prices: ItemPriceService;

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

    // The operator is a service actor: what is under test is the stack and the
    // filter, not the gate.
    const config = {
      getOrThrow: () => ({
        authJwtPublicKey: '',
        adminJwtPublicKey: '',
        serviceActorIds: [OPERATOR],
        postalCodeDeriveMaxMetres: 5_000,
      }),
    } as unknown as ConfigService;
    const admin = new PlatformAdminService(new JwtService({}), config);
    const audit = new CatalogAuditService(dataSource);
    const effective = new EffectivePriceService();
    scopes = new PriceScopeService(
      dataSource.getRepository(PriceScope),
      dataSource.getRepository(Supermarket),
      admin,
      audit,
      effective
    );
    prices = new ItemPriceService(
      dataSource.getRepository(ItemPrice),
      dataSource.getRepository(Item),
      dataSource.getRepository(PriceScope),
      admin,
      audit,
      effective
    );
    locations = new SupermarketLocationService(
      dataSource.getRepository(SupermarketLocation),
      dataSource.getRepository(Supermarket),
      scopes,
      admin,
      audit,
      new PostalCodeService(dataSource.getRepository(PostalCodePoint), admin),
      effective,
      new LocationScopeService(),
      config
    );
  }, 120_000);

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
      await dataSource.destroy();
    }
  });

  async function chainWithWarehouse() {
    const supermarkets = dataSource.getRepository(Supermarket);
    const chain = await supermarkets.save(
      supermarkets.create({ name: { en: 'Chain', es: 'Cadena' } })
    );
    const warehouse = await scopes.create({
      userId: OPERATOR,
      supermarketId: chain.id,
      kind: PriceScopeKind.LOCAL_AREA,
      externalKey: '4661',
    });
    return { chainId: chain.id, warehouse };
  }

  it('gives a local area the default priority of 200', async () => {
    const { warehouse } = await chainWithWarehouse();

    expect(warehouse.kind).toBe(PriceScopeKind.LOCAL_AREA);
    expect(warehouse.priority).toBe(200);
  });

  it('prices a shop created on a warehouse through its own store scope', async () => {
    const { chainId, warehouse } = await chainWithWarehouse();

    const shop = await locations.create({
      userId: OPERATOR,
      supermarketId: chainId,
      priceScopeId: warehouse.id,
    });

    const store = await dataSource.getRepository(PriceScope).findOneByOrFail({
      supermarketId: chainId,
      kind: PriceScopeKind.STORE,
      externalKey: shop.id,
    });
    // Most specific first: the shop's own scope heads the stack.
    expect(shop.priceScopeIds).toEqual([store.id, warehouse.id]);

    const items = dataSource.getRepository(Item);
    const item = await items.save(
      items.create({
        name: { en: 'Milk', es: 'Leche' },
        category: ItemCategory.DAIRY,
        defaultUnit: UnitOfMeasure.LITER,
      })
    );
    await prices.addBatch({
      userId: OPERATOR,
      priceScopeId: warehouse.id,
      sourceKind: PriceSourceKind.OFFICIAL_API,
      sourceRunId: null,
      entries: [
        {
          itemId: item.id,
          price: 0.89,
          currency: 'EUR',
          observedAt: new Date().toISOString(),
        },
      ],
    });

    const shown = await dataSource
      .getRepository(SupermarketItem)
      .findOneBy({ itemId: item.id, priceScopeId: store.id });
    expect(Number(shown?.price)).toBe(0.89);
  });

  it('keeps the store scope when an update names only the warehouse', async () => {
    const { chainId, warehouse } = await chainWithWarehouse();
    const shop = await locations.create({
      userId: OPERATOR,
      supermarketId: chainId,
    });

    const updated = await locations.update({
      userId: OPERATOR,
      supermarketLocationId: shop.id,
      priceScopeIds: [warehouse.id],
    });

    expect(updated.priceScopeIds).toHaveLength(2);
    expect(updated.priceScopeIds).toContain(warehouse.id);
    expect(updated.priceScopeIds[0]).toBe(shop.priceScopeIds[0]);
  });

  it('filters the price scopes list by kind, and lists every kind without one', async () => {
    const { chainId, warehouse } = await chainWithWarehouse();
    const region = await scopes.create({
      userId: OPERATOR,
      supermarketId: chainId,
      kind: PriceScopeKind.REGION,
      externalKey: 'andalucia',
    });
    await locations.create({ userId: OPERATOR, supermarketId: chainId });

    const narrowed = await scopes.list({
      userId: OPERATOR,
      supermarketId: chainId,
      kinds: [PriceScopeKind.LOCAL_AREA, PriceScopeKind.REGION],
    });
    expect(narrowed.items.map((s) => s.id).sort()).toEqual(
      [warehouse.id, region.id].sort()
    );

    const all = await scopes.list({ userId: OPERATOR, supermarketId: chainId });
    expect(all.items.map((s) => s.kind).sort()).toEqual(
      [
        PriceScopeKind.LOCAL_AREA,
        PriceScopeKind.REGION,
        PriceScopeKind.STORE,
      ].sort()
    );
  });
});
