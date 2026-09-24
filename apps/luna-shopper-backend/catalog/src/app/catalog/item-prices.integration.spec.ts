import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  ItemCategory,
  ItemPriceWrittenBy,
  PriceScopeKind,
  PriceShownBecause,
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
  AuditAction,
  AuditActorKind,
  CATALOG_ENTITIES,
  CatalogAudit,
  Item,
  ItemPrice,
  PricePolicy,
  PriceScope,
  Supermarket,
  SupermarketItem,
  SupermarketLocation,
  SupermarketLocationPriceScope,
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
const OTHER_RUN = '44444444-4444-4444-8444-444444444444';

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
        kind: PriceScopeKind.REGION,
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

  function crawl(
    price: number,
    observedAt: Date,
    scopeId = warehouseId,
    runId = RUN
  ) {
    return prices.addBatch({
      userId: HARVESTER,
      priceScopeId: scopeId,
      sourceKind: PriceSourceKind.OFFICIAL_API,
      sourceRunId: runId,
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
      // Relative to now, like the freshness tests below, and not calendar dates.
      // The boundary this asserts is the newest crawl plus the policy's seven
      // days, and `boundaryOf` keeps only a boundary still in the future, so
      // fixed dates make the test pass until that day arrives and fail every
      // run afterwards.
      const day3 = new Date(Date.now() - DAY_MS);
      const day2 = new Date(day3.getTime() - DAY_MS);
      const day1 = new Date(day2.getTime() - DAY_MS);

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
        kind: PriceScopeKind.REGION,
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

  /**
   * A reverted run leaves nothing behind (plan 0082).
   *
   * The half a fake cannot prove: that "written by this run" and "only
   * confirmed by this run" really are disjoint after the delete, that the
   * details row goes by cascade, and that the materialized row falls back to
   * whatever is left rather than keeping a number nothing supports any more.
   */
  describe('reverting a run (plan 0082)', () => {
    it('deletes only that run rows and recomputes what is left', async () => {
      const day1 = new Date('2026-09-01T06:00:00.000Z');
      await crawl(1.19, day1);
      const typed = await prices.add({
        userId: OPERATOR,
        itemId,
        priceScopeId: warehouseId,
        sourceKind: PriceSourceKind.ADMIN,
        price: 1.29,
        currency: 'EUR',
      });
      expect(Number((await shown(warehouseId))?.price)).toBe(1.29);

      const result = await prices.deleteByRun({
        userId: HARVESTER,
        sourceRunId: RUN,
      });

      expect(result.deleted).toBe(1);
      expect(result.reset).toBe(0);
      expect(result.recomputed).toBeGreaterThan(0);
      // The ADMIN row carries no run id and is never touched.
      const left = await dataSource.getRepository(ItemPrice).find();
      expect(left).toHaveLength(1);
      expect(left[0].id).toBe(typed.id);
      expect(Number((await shown(warehouseId))?.price)).toBe(1.29);
    });

    it('leaves another run rows alone', async () => {
      await crawl(1.19, new Date('2026-09-01T06:00:00.000Z'));
      // A second run, at the national scope so it is a row of its own rather
      // than a confirmation of the first.
      await crawl(
        2.49,
        new Date('2026-09-02T06:00:00.000Z'),
        nationalId,
        OTHER_RUN
      );

      await prices.deleteByRun({ userId: HARVESTER, sourceRunId: RUN });

      const left = await dataSource.getRepository(ItemPrice).find();
      expect(left).toHaveLength(1);
      expect(left[0].sourceRunId).toBe(OTHER_RUN);
      // The warehouse falls back to the chain national row (section 6).
      expect(Number((await shown(warehouseId))?.price)).toBe(2.49);
    });

    it('withdraws a confirmation rather than deleting the row it agreed with', async () => {
      const day1 = new Date('2026-09-01T06:00:00.000Z');
      const day2 = new Date('2026-09-02T06:00:00.000Z');
      await crawl(1.19, day1, warehouseId, OTHER_RUN);
      // The same number again, from the run about to be reverted: no row is
      // inserted, only `lastObservedAt` moves.
      expect(await crawl(1.19, day2)).toEqual({ inserted: 0, confirmed: 1 });

      const result = await prices.deleteByRun({
        userId: HARVESTER,
        sourceRunId: RUN,
      });

      expect(result).toMatchObject({ deleted: 0, reset: 1 });
      const rows = await dataSource.getRepository(ItemPrice).find();
      expect(rows).toHaveLength(1);
      // The row ages as if the run never happened. The previous
      // `lastObservedAt` was overwritten and cannot be restored, so it goes
      // back to `observedAt`, which errs toward stale on purpose.
      expect(rows[0].lastObservedAt).toEqual(day1);
      expect(rows[0].lastObservedRunId).toBe(OTHER_RUN);
    });

    it('answers zeros for a run with no rows, so a retry is always safe', async () => {
      await expect(
        prices.deleteByRun({ userId: HARVESTER, sourceRunId: OTHER_RUN })
      ).resolves.toEqual({ deleted: 0, reset: 0, recomputed: 0 });
    });

    it('takes the price with it, leaving no price at all where it was the only one', async () => {
      await crawl(1.19, new Date('2026-09-01T06:00:00.000Z'));
      expect(Number((await shown(warehouseId))?.price)).toBe(1.19);

      await prices.deleteByRun({ userId: HARVESTER, sourceRunId: RUN });

      const row = await shown(warehouseId);
      expect(row?.price ?? null).toBeNull();
      expect(row?.itemPriceId ?? null).toBeNull();
      // Availability is deliberately untouched: it carries no run id and has no
      // history, so a reverted refresh leaves it as it found it.
      expect(row?.available).toBe(true);
    });

    it('fans a national delete out to every scope of the chain (section 6)', async () => {
      await crawl(1.49, new Date('2026-09-01T06:00:00.000Z'), nationalId);
      expect(Number((await shown(warehouseId))?.price)).toBe(1.49);

      const result = await prices.deleteByRun({
        userId: HARVESTER,
        sourceRunId: RUN,
      });

      expect(result.deleted).toBe(1);
      // The national key and the warehouse that inherited from it.
      expect(result.recomputed).toBeGreaterThanOrEqual(2);
      expect((await shown(warehouseId))?.price ?? null).toBeNull();
      expect((await shown(nationalId))?.price ?? null).toBeNull();
    });

    it('writes an audit row for every delete, with the run id in what was there', async () => {
      await crawl(1.19, new Date('2026-09-01T06:00:00.000Z'));
      const written = await dataSource
        .getRepository(ItemPrice)
        .findOneByOrFail({ sourceRunId: RUN });

      await prices.deleteByRun({ userId: HARVESTER, sourceRunId: RUN });

      // By the row's own id: the trail is append only and outlives the rows
      // every other case here created.
      const trail = await dataSource.getRepository(CatalogAudit).find({
        where: {
          entity: 'item_prices',
          entityId: written.id,
          action: AuditAction.DELETE,
        },
      });
      expect(trail).toHaveLength(1);
      // The harvester is a service, not an admin: a run started by the owner
      // still writes as the machine that made the change.
      expect(trail[0].actorKind).toBe(AuditActorKind.SERVICE);
      // Nothing is added to the trail to carry the run id: `sourceRunId` is a
      // column of the row that was deleted, so it is in `before` already.
      expect(trail[0].before).toMatchObject({ sourceRunId: RUN, price: 1.19 });
    });
  });

  describe('a copy of another scope (plan 0118)', () => {
    let targetId: string;

    beforeEach(async () => {
      targetId = (
        await scopes.create({
          userId: OPERATOR,
          supermarketId: chainId,
          kind: PriceScopeKind.REGION,
          externalKey: '4804',
        })
      ).id;
    });

    function copy(price: number, observedAt: Date, from = warehouseId) {
      return prices.addBatch({
        userId: HARVESTER,
        priceScopeId: targetId,
        sourceKind: PriceSourceKind.OFFICIAL_API,
        sourceRunId: RUN,
        copiedFromScopeId: from,
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

    it('records the scope it was read at, and materializes it', async () => {
      await copy(1.19, new Date());

      const rows = await dataSource
        .getRepository(ItemPrice)
        .findBy({ priceScopeId: targetId });
      expect(rows).toHaveLength(1);
      expect(rows[0].copiedFromScopeId).toBe(warehouseId);
      const row = await shown(targetId);
      expect(Number(row?.price)).toBe(1.19);
      expect(row?.priceCopiedFromScopeId).toBe(warehouseId);
    });

    it('confirms a copy of the same value from the same scope', async () => {
      const earlier = new Date(Date.now() - DAY_MS);
      expect(await copy(1.19, earlier)).toEqual({ inserted: 1, confirmed: 0 });
      expect(await copy(1.19, new Date())).toEqual({
        inserted: 0,
        confirmed: 1,
      });
    });

    it('inserts a direct walk of the same value, which is a different statement', async () => {
      // Section 5.2: confirming here would leave the copy's provenance on a
      // price that was since read at the target itself.
      await copy(1.19, new Date(Date.now() - DAY_MS));
      expect(await crawl(1.19, new Date(), targetId)).toEqual({
        inserted: 1,
        confirmed: 0,
      });

      const row = await shown(targetId);
      expect(Number(row?.price)).toBe(1.19);
      expect(row?.priceCopiedFromScopeId).toBeNull();
    });

    it('refuses a batch copied from the scope it writes to', async () => {
      await expect(copy(1.19, new Date(), targetId)).rejects.toThrow(
        new RegExp(targetId)
      );
    });

    it('refuses a batch copied from a scope of another chain', async () => {
      const supermarkets = dataSource.getRepository(Supermarket);
      const other = await supermarkets.save(
        supermarkets.create({ name: { en: 'Other', es: 'Otra' } })
      );
      const foreign = await scopes.create({
        userId: OPERATOR,
        supermarketId: other.id,
        kind: PriceScopeKind.REGION,
        externalKey: '4661',
      });

      await expect(copy(1.19, new Date(), foreign.id)).rejects.toThrow(
        new RegExp(foreign.id)
      );
      expect(
        await dataSource
          .getRepository(ItemPrice)
          .countBy({ priceScopeId: targetId })
      ).toBe(0);
    });

    it('goes with the run when the run is reverted (section 8)', async () => {
      await crawl(1.19, new Date());
      await copy(1.19, new Date());

      await prices.deleteByRun({ userId: HARVESTER, sourceRunId: RUN });

      expect(
        await dataSource
          .getRepository(ItemPrice)
          .countBy({ priceScopeId: targetId })
      ).toBe(0);
      const row = await shown(targetId);
      expect(row?.price ?? null).toBeNull();
      expect(row?.priceCopiedFromScopeId ?? null).toBeNull();
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

  /**
   * Section 1 of plan 0117, end to end: a shop whose stack is its own scope, a
   * local area, a chain region and the chain's NATIONAL. The local area was
   * walked once long ago, the region yesterday.
   */
  describe('an expired price falls through to the next scope (plan 0117)', () => {
    async function shopStack() {
      const localArea = await scopes.create({
        userId: OPERATOR,
        supermarketId: chainId,
        kind: PriceScopeKind.LOCAL_AREA,
        externalKey: '4661',
      });
      const region = await scopes.create({
        userId: OPERATOR,
        supermarketId: chainId,
        kind: PriceScopeKind.REGION,
        externalKey: 'andalucia',
      });
      const shops = dataSource.getRepository(SupermarketLocation);
      const shop = await shops.save(shops.create({ supermarketId: chainId }));
      const store = await scopes.create({
        userId: OPERATOR,
        supermarketId: chainId,
        kind: PriceScopeKind.STORE,
        externalKey: shop.id,
      });
      const stack = dataSource.getRepository(SupermarketLocationPriceScope);
      await stack.save(
        [store, localArea, region].map((scope) =>
          stack.create({
            supermarketLocationId: shop.id,
            priceScopeId: scope.id,
          })
        )
      );
      return { store, localArea, region };
    }

    it('shows the region price at the shop once the local area price is past its max age, and the stale fallback after that', async () => {
      const { store, localArea, region } = await shopStack();
      const walked = new Date(Date.now() - 19 * DAY_MS);
      const yesterday = new Date(Date.now() - DAY_MS);

      await crawl(1.19, walked, localArea.id);
      await crawl(1.25, yesterday, region.id);
      // Recomputed on purpose as well, not only through the write's fan out,
      // so the assertion reads the resolution rather than the key discovery.
      await new EffectivePriceService().recompute(dataSource.manager, [
        { itemId, priceScopeId: store.id },
      ]);

      const atShop = await shown(store.id);
      expect(Number(atShop?.price)).toBe(1.25);
      expect(atShop?.stale).toBe(false);
      // The region's own expiry is the next instant the answer can change.
      expect(atShop?.nextBoundaryAt).toEqual(
        new Date(yesterday.getTime() + 7 * DAY_MS)
      );

      // Past the region's max age too: nothing is eligible, and the sweep
      // shows the newest enabled row, flagged.
      const later = new Date(yesterday.getTime() + 8 * DAY_MS);
      expect(await sweep.tick(later)).toBeGreaterThan(0);
      const stale = await shown(store.id);
      expect(Number(stale?.price)).toBe(1.25);
      expect(stale?.stale).toBe(true);
      expect(stale?.nextBoundaryAt).toBeNull();
    });

    it('takes an ADMIN snapshot from the narrowest eligible tier, by priority', async () => {
      const { store, localArea, region } = await shopStack();
      await crawl(1.19, new Date(Date.now() - 19 * DAY_MS), localArea.id);
      await crawl(1.25, new Date(), region.id);

      const typed = await prices.add({
        userId: OPERATOR,
        itemId,
        priceScopeId: store.id,
        sourceKind: PriceSourceKind.ADMIN,
        price: 1.29,
        currency: 'EUR',
      });
      expect(typed.overrides).toEqual({
        OFFICIAL_API: { price: 1.25, unitPrice: null },
      });
      // The expired local area row does not dispute the correction.
      expect(Number((await shown(store.id))?.price)).toBe(1.29);
    });

    it('does not let an older row at a scope stand in for a newer one that is not valid yet', async () => {
      const { store, region } = await shopStack();
      const leaflet = (
        scopeId: string,
        price: number,
        from: Date,
        until: Date
      ) =>
        prices.addBatch({
          userId: HARVESTER,
          priceScopeId: scopeId,
          sourceKind: PriceSourceKind.OFFICIAL_LEAFLET,
          sourceRunId: RUN,
          entries: [
            {
              itemId,
              price,
              currency: 'EUR',
              observedAt: new Date(from.getTime() - DAY_MS).toISOString(),
              validFrom: from.toISOString(),
              validUntil: until.toISOString(),
            },
          ],
        });
      const now = Date.now();
      await leaflet(
        region.id,
        1.09,
        new Date(now - 3 * DAY_MS),
        new Date(now + 4 * DAY_MS)
      );
      await leaflet(
        store.id,
        0.99,
        new Date(now - 5 * DAY_MS),
        new Date(now + 2 * DAY_MS)
      );
      const nextWeek = new Date(now + 3 * DAY_MS);
      await leaflet(store.id, 0.89, nextWeek, new Date(now + 10 * DAY_MS));

      const atShop = await shown(store.id);
      // Not 0.99: the store's current leaflet is next week's, so the store
      // has nothing valid to say and the region answers.
      expect(Number(atShop?.price)).toBe(1.09);
      // The region closes after the store's leaflet opens.
      expect(atShop?.nextBoundaryAt).toEqual(nextWeek);
    });
  });

  describe('what the back office reads instead of psql (plan 0160)', () => {
    it('lists the rows a run inserted and the rows it confirmed, and nothing else', async () => {
      const day2 = new Date(Date.now() - DAY_MS);
      const day1 = new Date(day2.getTime() - DAY_MS);
      // OTHER_RUN writes 1.19, RUN repeats it and writes a national 1.49.
      await crawl(1.19, day1, warehouseId, OTHER_RUN);
      await crawl(1.19, day2, warehouseId, RUN);
      await crawl(1.49, day2, nationalId, RUN);

      const page = await prices.list({ userId: OPERATOR, runId: RUN });

      expect(
        page.items
          .map((row) => [row.priceScopeId, row.price, row.writtenBy])
          .sort()
      ).toEqual(
        [
          [warehouseId, 1.19, ItemPriceWrittenBy.CONFIRMED],
          [nationalId, 1.49, ItemPriceWrittenBy.INSERTED],
        ].sort()
      );
      // The history read is unchanged and carries no writtenBy.
      const history = await prices.list({
        userId: OPERATOR,
        itemId,
        priceScopeId: warehouseId,
      });
      expect(history.items).toHaveLength(1);
      expect(history.items[0].writtenBy).toBeUndefined();
    });

    it('refuses a read that names neither a run nor a key, or a run with a scope', async () => {
      await expect(
        prices.list({ userId: OPERATOR, itemId })
      ).rejects.toMatchObject({ code: 'validation_failed' });
      await expect(
        prices.list({ userId: OPERATOR, runId: RUN, priceScopeId: warehouseId })
      ).rejects.toMatchObject({ code: 'validation_failed' });
    });

    it('answers every scope of the item with the row shown there and why', async () => {
      await crawl(1.49, new Date(), nationalId);
      await prices.add({
        userId: OPERATOR,
        itemId,
        priceScopeId: warehouseId,
        sourceKind: PriceSourceKind.ADMIN,
        price: 1.29,
        currency: 'EUR',
      });

      const page = await prices.byItem({ userId: OPERATOR, itemId });
      const byScope = new Map(page.items.map((row) => [row.priceScopeId, row]));

      const national = byScope.get(nationalId);
      expect(national?.shownBecause).toBe(PriceShownBecause.ONLY_ROW);
      expect(national?.rows).toHaveLength(1);
      expect(national?.protectedUntil).toBeNull();

      // The warehouse weighs its own ADMIN row and the national crawl it
      // falls through to. The snapshot recorded 1.49, so nothing disputes it.
      const warehouse = byScope.get(warehouseId);
      expect(warehouse?.shownBecause).toBe(PriceShownBecause.PROTECTED_ADMIN);
      expect(warehouse?.rows.map((row) => row.sourceKind).sort()).toEqual([
        PriceSourceKind.ADMIN,
        PriceSourceKind.OFFICIAL_API,
      ]);
      const admin = warehouse?.rows.find(
        (row) => row.sourceKind === PriceSourceKind.ADMIN
      );
      expect(warehouse?.shownItemPriceId).toBe(admin?.id);
      expect(warehouse?.protectedUntil).toBe(admin?.protectedUntil);
      expect(warehouse?.overrides).toEqual({
        OFFICIAL_API: { price: 1.49, unitPrice: null },
      });
      // The explanation agrees with what the recompute stored.
      expect((await shown(warehouseId))?.itemPriceId).toBe(admin?.id);
    });

    it('pages the scopes without a gap or a repeat', async () => {
      await crawl(1.49, new Date(), nationalId);
      await crawl(1.35, new Date(), warehouseId);

      const first = await prices.byItem({ userId: OPERATOR, itemId, limit: 1 });
      expect(first.items).toHaveLength(1);
      expect(first.nextCursor).not.toBeNull();
      const second = await prices.byItem({
        userId: OPERATOR,
        itemId,
        limit: 1,
        cursor: first.nextCursor ?? undefined,
      });
      expect(second.items).toHaveLength(1);
      expect(second.nextCursor).toBeNull();
      expect(
        [first.items[0].priceScopeId, second.items[0].priceScopeId].sort()
      ).toEqual([nationalId, warehouseId].sort());
    });

    it('takes an observedAt up to 30 days back, and protects from it', async () => {
      const typedAt = new Date(Date.now() - 29 * DAY_MS);
      const typed = await prices.add({
        userId: OPERATOR,
        itemId,
        priceScopeId: warehouseId,
        sourceKind: PriceSourceKind.ADMIN,
        price: 1.29,
        currency: 'EUR',
        observedAt: typedAt.toISOString(),
      });
      expect(typed.observedAt).toBe(typedAt.toISOString());
      // A past date protects for less time, never more: this one is over.
      expect(typed.protectedUntil).toBe(
        new Date(typedAt.getTime() + 7 * DAY_MS).toISOString()
      );
    });

    it('refuses an observedAt in the future or older than 30 days', async () => {
      const add = (observedAt: Date) =>
        prices.add({
          userId: OPERATOR,
          itemId,
          priceScopeId: warehouseId,
          sourceKind: PriceSourceKind.ADMIN,
          price: 1.29,
          observedAt: observedAt.toISOString(),
        });
      await expect(add(new Date(Date.now() + 60_000))).rejects.toMatchObject({
        code: 'validation_failed',
        details: { observedAt: 'must not be in the future' },
      });
      await expect(
        add(new Date(Date.now() - 31 * DAY_MS))
      ).rejects.toMatchObject({ code: 'validation_failed' });
      expect(await dataSource.getRepository(ItemPrice).count()).toBe(0);
    });
  });
});
