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
  PricePolicy,
  PriceScope,
  Supermarket,
  SupermarketItem,
} from '../entities';
import { CatalogAuditService } from './catalog-audit.service';
import { EffectivePriceService } from './effective-price.service';
import { EffectivePriceSweep } from './effective-price.sweep';
import { ItemPriceService } from './item-price.service';
import { PlatformAdminService } from './platform-admin.service';
import { PricePolicyService } from './price-policy.service';
import { PriceScopeService } from './price-scope.service';

/**
 * Every price a source gave, against real Postgres (plan 0080, section 15):
 * insert on change, the `ADMIN` snapshot, inheritance from the NATIONAL scope,
 * a scope created after the national write, the sweep, and a delete.
 *
 * The resolution itself is proven by `effective-price.spec.ts` without a
 * database. What a fake cannot prove is here: that `DISTINCT ON` hands the
 * resolution the current row per kind, that the materialized row is written
 * inside the same transaction, and that `SKIP LOCKED` hands two sweeps
 * different rows.
 *
 *   bash k8s/e2e/luna-shopper-backend/luna-slot.sh --up
 *   LUNA_INTEGRATION=1 CATALOG_DB_URL=postgres://luna_catalog:luna_catalog@localhost:<port>/luna_catalog \
 *     npx nx run luna-shopper-backend-catalog:test-integration
 */
const SCHEMA = 'plan0080_item_prices_test';

const HARVESTER = '11111111-1111-4111-8111-111111111111';
const OPERATOR = '22222222-2222-4222-8222-222222222222';
const RUN = '33333333-3333-4333-8333-333333333333';

const DAY_MS = 24 * 60 * 60 * 1000;

describeIntegration('item prices (real Postgres)', () => {
  let dataSource: DataSource;
  let prices: ItemPriceService;
  let policies: PricePolicyService;
  let scopes: PriceScopeService;
  let sweep: EffectivePriceSweep;

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

    // Both actors are service actors here: what is under test is the price
    // model, not the gate, and a service actor needs no token.
    const admin = new PlatformAdminService(new JwtService({}), {
      getOrThrow: () => ({
        authJwtPublicKey: '',
        adminJwtPublicKey: '',
        serviceActorIds: [HARVESTER, OPERATOR],
      }),
    } as unknown as ConfigService);
    const audit = new CatalogAuditService(dataSource);
    const effective = new EffectivePriceService();
    prices = new ItemPriceService(
      dataSource.getRepository(ItemPrice),
      dataSource.getRepository(Item),
      dataSource.getRepository(PriceScope),
      admin,
      audit,
      effective
    );
    policies = new PricePolicyService(
      dataSource.getRepository(PricePolicy),
      admin,
      audit,
      effective
    );
    scopes = new PriceScopeService(
      dataSource.getRepository(PriceScope),
      dataSource.getRepository(Supermarket),
      admin,
      audit,
      effective
    );
    sweep = new EffectivePriceSweep(dataSource, effective);
  }, 120_000);

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
      await dataSource.destroy();
    }
  });

  let chainId: string;
  let nationalId: string;
  let warehouseId: string;
  let itemId: string;

  beforeEach(async () => {
    await dataSource
      .getRepository(ItemPrice)
      .createQueryBuilder()
      .delete()
      .execute();
    await dataSource
      .getRepository(SupermarketItem)
      .createQueryBuilder()
      .delete()
      .execute();
    const supermarkets = dataSource.getRepository(Supermarket);
    const chain = await supermarkets.save(
      supermarkets.create({ name: { en: 'Chain', es: 'Cadena' } })
    );
    chainId = chain.id;
    nationalId = (
      await scopes.create({
        userId: OPERATOR,
        supermarketId: chain.id,
        kind: PriceScopeKind.NATIONAL,
        externalKey: null,
      })
    ).id;
    warehouseId = (
      await scopes.create({
        userId: OPERATOR,
        supermarketId: chain.id,
        kind: PriceScopeKind.WAREHOUSE,
        externalKey: '4661',
      })
    ).id;
    const items = dataSource.getRepository(Item);
    itemId = (
      await items.save(
        items.create({
          name: { en: 'Milk', es: 'Leche' },
          category: ItemCategory.DAIRY,
          defaultUnit: UnitOfMeasure.LITER,
        })
      )
    ).id;
  });

  async function shown(scopeId: string) {
    return dataSource
      .getRepository(SupermarketItem)
      .findOneBy({ itemId, priceScopeId: scopeId });
  }

  function crawl(price: number, observedAt: Date, scopeId = warehouseId) {
    return prices.addBatch({
      userId: HARVESTER,
      priceScopeId: scopeId,
      sourceKind: PriceSourceKind.OFFICIAL_API,
      sourceRunId: RUN,
      entries: [
        {
          itemId,
          price,
          currency: 'EUR',
          observedAt: observedAt.toISOString(),
        },
      ],
    });
  }

  describe('insert on change (section 2.1)', () => {
    it('a repeated value moves lastObservedAt only, a changed value inserts', async () => {
      const day1 = new Date('2026-09-01T06:00:00.000Z');
      const day2 = new Date('2026-09-02T06:00:00.000Z');
      const day3 = new Date('2026-09-03T06:00:00.000Z');

      expect(await crawl(1.19, day1)).toEqual({ inserted: 1, confirmed: 0 });
      expect(await crawl(1.19, day2)).toEqual({ inserted: 0, confirmed: 1 });
      expect(await crawl(1.35, day3)).toEqual({ inserted: 1, confirmed: 0 });

      const rows = await dataSource
        .getRepository(ItemPrice)
        .find({ order: { observedAt: 'ASC' } });
      expect(rows).toHaveLength(2);
      expect(rows[0].observedAt).toEqual(day1);
      expect(rows[0].lastObservedAt).toEqual(day2);
      expect(rows[1].observedAt).toEqual(day3);
      // The old row was left exactly as it was: no write changes another row.
      expect(Number(rows[0].price)).toBe(1.19);

      const row = await shown(warehouseId);
      expect(Number(row?.price)).toBe(1.35);
      expect(row?.itemPriceId).toBe(rows[1].id);
      expect(row?.nextBoundaryAt).toEqual(
        new Date(day3.getTime() + 7 * DAY_MS)
      );
    });

    it('the seed rerun writes no row: an earlier date moves nothing', async () => {
      const receipt = new Date('2026-08-12T00:00:00.000Z');
      const first = await prices.addBatch({
        userId: OPERATOR,
        priceScopeId: warehouseId,
        sourceKind: PriceSourceKind.USER_RECEIPT,
        entries: [
          {
            itemId,
            price: 1.05,
            currency: 'EUR',
            observedAt: receipt.toISOString(),
          },
        ],
      });
      const again = await prices.addBatch({
        userId: OPERATOR,
        priceScopeId: warehouseId,
        sourceKind: PriceSourceKind.USER_RECEIPT,
        entries: [
          {
            itemId,
            price: 1.05,
            currency: 'EUR',
            observedAt: receipt.toISOString(),
          },
        ],
      });
      expect(first).toEqual({ inserted: 1, confirmed: 0 });
      expect(again).toEqual({ inserted: 0, confirmed: 0 });
      expect(await dataSource.getRepository(ItemPrice).count()).toBe(1);
      // No max age: an August receipt is shown unflagged in September.
      expect((await shown(warehouseId))?.stale).toBe(false);
    });

    it('refuses a user kind from a run', async () => {
      await expect(
        prices.addBatch({
          userId: HARVESTER,
          priceScopeId: warehouseId,
          sourceKind: PriceSourceKind.USER_RECEIPT,
          sourceRunId: RUN,
          entries: [{ itemId, price: 1 }],
        })
      ).rejects.toMatchObject({ code: 'validation_failed' });
    });
  });

  describe('the ADMIN snapshot (section 4.2)', () => {
    it('records what it overrode, and is displaced by a source saying something new', async () => {
      await crawl(1.19, new Date());
      const typed = await prices.add({
        userId: OPERATOR,
        itemId,
        priceScopeId: warehouseId,
        sourceKind: PriceSourceKind.ADMIN,
        price: 1.29,
        currency: 'EUR',
      });
      expect(typed.overrides).toEqual({
        OFFICIAL_API: { price: 1.19, unitPrice: null },
      });
      expect(typed.protectedUntil).not.toBeNull();
      expect(Number((await shown(warehouseId))?.price)).toBe(1.29);

      await crawl(1.35, new Date());
      expect(Number((await shown(warehouseId))?.price)).toBe(1.35);

      // Day 8: the chain says 1.19 again, which the owner already knew.
      await crawl(1.19, new Date());
      expect(Number((await shown(warehouseId))?.price)).toBe(1.29);
    });
  });

  describe('a national price reaches every scope of its chain (section 6)', () => {
    it('is the effective price at the warehouse, and a warehouse row of the same kind beats it there', async () => {
      await crawl(1.49, new Date(), nationalId);
      expect(Number((await shown(nationalId))?.price)).toBe(1.49);
      expect(Number((await shown(warehouseId))?.price)).toBe(1.49);

      await crawl(1.35, new Date(), warehouseId);
      expect(Number((await shown(warehouseId))?.price)).toBe(1.35);
      expect(Number((await shown(nationalId))?.price)).toBe(1.49);
    });

    it('a scope created after the national write inherits on creation', async () => {
      await crawl(1.49, new Date(), nationalId);
      const later = await scopes.create({
        userId: OPERATOR,
        supermarketId: chainId,
        kind: PriceScopeKind.WAREHOUSE,
        externalKey: 'mad3',
      });
      expect(Number((await shown(later.id))?.price)).toBe(1.49);
    });
  });

  describe('the sweep (section 7)', () => {
    it('marks a crawl stale once its max age has passed, and not before', async () => {
      const observed = new Date(Date.now() - 6 * DAY_MS);
      await crawl(1.19, observed);
      expect((await shown(warehouseId))?.stale).toBe(false);

      // Six days in: nothing is due.
      expect(await sweep.tick(new Date())).toBe(0);
      expect((await shown(warehouseId))?.stale).toBe(false);

      // Eight days in: the boundary has passed, the row is taken, flagged, and
      // carries no boundary any more.
      const eighthDay = new Date(observed.getTime() + 8 * DAY_MS);
      expect(await sweep.tick(eighthDay)).toBe(1);
      const row = await shown(warehouseId);
      expect(row?.stale).toBe(true);
      expect(Number(row?.price)).toBe(1.19);
      expect(row?.nextBoundaryAt).toBeNull();

      // Running it again changes nothing the second time.
      expect(await sweep.tick(eighthDay)).toBe(0);
    });

    it('two sweeps on one table take distinct rows', async () => {
      // Seen six days ago, so the write leaves a boundary one day ahead; the
      // sweeps then run two days later, when it has passed.
      const observed = new Date(Date.now() - 6 * DAY_MS);
      await crawl(1.19, observed);
      const now = new Date(observed.getTime() + 8 * DAY_MS);
      // One transaction holds the row locked while the other looks.
      const held = dataSource.createQueryRunner();
      await held.connect();
      await held.startTransaction();
      const taken = await held.query(
        `SELECT "id" FROM "supermarket_items" WHERE "nextBoundaryAt" <= $1 FOR UPDATE SKIP LOCKED`,
        [now]
      );
      expect(taken).toHaveLength(1);
      try {
        expect(await sweep.tick(now)).toBe(0);
      } finally {
        await held.rollbackTransaction();
        await held.release();
      }
      expect(await sweep.tick(now)).toBe(1);
    });
  });

  describe('delete and policy', () => {
    it('removing the effective row recomputes the materialized one', async () => {
      await crawl(1.19, new Date());
      const typed = await prices.add({
        userId: OPERATOR,
        itemId,
        priceScopeId: warehouseId,
        sourceKind: PriceSourceKind.ADMIN,
        price: 1.29,
      });
      expect(Number((await shown(warehouseId))?.price)).toBe(1.29);
      await prices.delete({ userId: OPERATOR, itemPriceId: typed.id });
      expect(Number((await shown(warehouseId))?.price)).toBe(1.19);
    });

    it('a policy change recomputes every row', async () => {
      await crawl(1.19, new Date());
      await prices.addBatch({
        userId: OPERATOR,
        priceScopeId: warehouseId,
        sourceKind: PriceSourceKind.USER_RECEIPT,
        entries: [{ itemId, price: 1.05 }],
      });
      expect(Number((await shown(warehouseId))?.price)).toBe(1.19);
      await policies.update({
        userId: OPERATOR,
        sourceKind: PriceSourceKind.USER_RECEIPT,
        priority: 5,
      });
      expect(Number((await shown(warehouseId))?.price)).toBe(1.05);
      await policies.update({
        userId: OPERATOR,
        sourceKind: PriceSourceKind.USER_RECEIPT,
        priority: 50,
      });
      expect(Number((await shown(warehouseId))?.price)).toBe(1.19);
    });
  });
});
