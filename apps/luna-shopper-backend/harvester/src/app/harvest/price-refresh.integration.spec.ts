import type { ConfigService } from '@nestjs/config';
import {
  PriceRefreshStatus,
  PriceScopeKind,
  PriceSourceKind,
  SourceEntryStatus,
} from '@portfolio/luna-shopper/contracts';
import {
  RateLimitedException,
  RedisService,
} from '@portfolio/luna-shopper/platform';
import {
  describeIntegration,
  requiredEnv,
} from '@portfolio/luna-shopper/test-fixtures/jest';
import type { Logger } from 'nestjs-pino';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DataSource } from 'typeorm';
import {
  HARVESTER_ENTITIES,
  HarvestRun,
  PriceRefresh,
  SourceCatalogEntry,
  SourceEntryPrice,
  type SupermarketSource,
} from '../entities';
import type { CatalogClient } from './catalog-client.service';
import { PriceRefreshCooldown, REFRESH_KEYS } from './price-refresh.cooldown';
import type { RefreshFetcher } from './price-refresh.fetchers';
import { PriceRefreshResolver } from './price-refresh.resolver';
import { PriceRefreshService } from './price-refresh.service';
import { PriceRefreshStore } from './price-refresh.store';
import { SourceIngest } from './source-ingest';
import type { SupermarketSourceService } from './supermarket-source.service';

/**
 * A shopper's refresh against real Postgres and real Redis (plan 0216, section
 * 13).
 *
 * What a fake cannot say:
 *
 * - the migration creates `price_refreshes`, its enum and its three indexes;
 * - **two requests for one product at one instant start one fetch**, because
 *   the real `SET NX PX` lets one through and refuses the other with the
 *   chain's remaining time;
 * - a refresh during a `RUNNING` run of the chain starts, and the run's row is
 *   untouched: a refresh takes no lock a run takes;
 * - the ingest write lands on `source_entry_prices` with no run.
 *
 * The fetch is a stub and catalog is a fake; nothing reaches a chain.
 *
 *   bash k8s/e2e/luna-shopper-backend/luna-slot.sh --ephemeral --up 7
 *   LUNA_INTEGRATION=1 HARVESTER_DB_URL=... REDIS_URL=... \
 *     npx nx run luna-shopper-backend-harvester:test-integration --testFile=price-refresh.integration.spec.ts
 */

/**
 * Redis, from the environment or from the shared backend `.env`. The slot
 * script writes `REDIS_URL` there and not into the harvester's own `.env`,
 * which is the only file Nx loads for this target.
 */
function redisUrl(): string {
  const exported = process.env['REDIS_URL'];
  if (exported) {
    return exported;
  }
  const file = join(__dirname, '../../../../.env.luna-shopper-backend');
  const line = existsSync(file)
    ? /^REDIS_URL=(.+)$/m.exec(readFileSync(file, 'utf8'))
    : null;
  if (!line) {
    throw new Error(
      'REDIS_URL is not set and apps/luna-shopper-backend/.env.luna-shopper-backend ' +
        'does not state it. Run the slot script, or export the variable.'
    );
  }
  return line[1].trim();
}

describeIntegration('price refresh (real Postgres and Redis)', () => {
  /** Ids nothing else in this database uses, so cleanup is exact. */
  const CHAIN = '02160216-0000-4000-8000-111111111111';
  const SOURCE = '02160216-0000-4000-8000-555555555555';
  const ITEM = '02160216-0000-4000-8000-222222222222';
  const WAREHOUSE = '02160216-0000-4000-8000-333333333333';
  const SHOPPER = '02160216-0000-4000-8000-aaaaaaaaaaa1';
  const OTHER = '02160216-0000-4000-8000-aaaaaaaaaaa2';
  const LONG_AGO = new Date('2026-01-01T00:00:00.000Z');

  let dataSource: DataSource;
  let redis: RedisService;
  let fetches = 0;
  let sent: unknown[][] = [];

  const silent = {
    log: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  } as unknown as Logger;

  const fetcher: RefreshFetcher = async () => {
    fetches += 1;
    return {
      found: true,
      observation: {
        externalId: '4241',
        detailFetched: false,
        observedAt: new Date(),
        prices: [
          {
            scopeKey: '4661',
            price: 8.75,
            currency: 'EUR',
            unitPrice: 8.75,
            unitPriceLabel: 'kg',
            validFrom: null,
            validUntil: null,
          },
        ],
      },
    };
  };

  function service(): PriceRefreshService {
    const settings = {
      harvestEnabled: true,
      refreshEnabled: true,
      refreshChainSeconds: 30,
      refreshProductMinutes: 30,
      refreshBlockedMinutes: 30,
      userAgent: 'test',
    };
    const config = {
      getOrThrow: () => settings,
    } as unknown as ConfigService;
    const catalog = {
      listAllPriceScopes: async () => [
        { id: WAREHOUSE, kind: PriceScopeKind.LOCAL_AREA, externalKey: '4661' },
      ],
      addPrices: async (...args: unknown[]) => {
        sent.push(args);
        return { inserted: 1, confirmed: 0 };
      },
    } as unknown as CatalogClient;
    const prices = dataSource.getRepository(SourceEntryPrice);
    const entries = dataSource.getRepository(SourceCatalogEntry);
    const sources = {
      findBySupermarket: async () =>
        ({
          id: SOURCE,
          supermarketId: CHAIN,
          adapterKey: 'mercadona-api',
          enabled: true,
          config: {},
        }) as unknown as SupermarketSource,
    } as unknown as SupermarketSourceService;
    return new PriceRefreshService(
      new PriceRefreshStore(dataSource.getRepository(PriceRefresh)),
      new PriceRefreshResolver(prices, entries, catalog),
      new PriceRefreshCooldown(redis, config),
      sources,
      new SourceIngest(entries, prices, catalog),
      prices,
      dataSource.getRepository(HarvestRun),
      config,
      { 'mercadona-api': fetcher },
      () => new Date()
    );
  }

  async function clean(): Promise<void> {
    await dataSource.query(
      `DELETE FROM "price_refreshes" WHERE "supermarketId" = $1`,
      [CHAIN]
    );
    await dataSource.query(
      `DELETE FROM "harvest_runs" WHERE "supermarketId" = $1`,
      [CHAIN]
    );
    // The price rows go with their entries.
    await dataSource.query(
      `DELETE FROM "source_catalog_entries" WHERE "supermarketId" = $1`,
      [CHAIN]
    );
    for (const key of [
      REFRESH_KEYS.chain(CHAIN),
      REFRESH_KEYS.blocked(CHAIN),
      ...(await redis.client.keys('harvest:refresh:product:*')),
      ...(await redis.client.keys('harvest:refresh:viewer:*')),
    ]) {
      await redis.client.del(key);
    }
  }

  async function seed(): Promise<SourceCatalogEntry> {
    const entries = dataSource.getRepository(SourceCatalogEntry);
    const entry = await entries.save(
      entries.create({
        supermarketId: CHAIN,
        externalId: '4241',
        sourceKind: PriceSourceKind.OFFICIAL_API,
        name: 'Queso curado',
        itemId: ITEM,
        status: SourceEntryStatus.ACTIVE,
      })
    );
    const prices = dataSource.getRepository(SourceEntryPrice);
    await prices.save(
      prices.create({
        entryId: entry.id,
        priceScopeId: WAREHOUSE,
        sourceKind: PriceSourceKind.OFFICIAL_API,
        price: 8.5,
        currency: 'EUR',
        observedAt: LONG_AGO,
        runId: null,
        copiedFromScopeId: null,
      })
    );
    return entry;
  }

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: requiredEnv('HARVESTER_DB_URL'),
      entities: HARVESTER_ENTITIES,
      synchronize: false,
    });
    await dataSource.initialize();
    redis = new RedisService(redisUrl(), silent);
    await redis.whenReady();
  });

  afterAll(async () => {
    await clean();
    await redis.onApplicationShutdown();
    await dataSource.destroy();
  });

  beforeEach(async () => {
    fetches = 0;
    sent = [];
    await clean();
  });

  it('creates the table, the enum and the three indexes', async () => {
    const values = await dataSource.query(
      `SELECT unnest(enum_range(NULL::"price_refresh_status"))::text AS value`
    );
    expect(values.map((row: { value: string }) => row.value)).toEqual([
      'PENDING',
      'DONE',
      'NOT_STOCKED',
      'FAILED',
      'BLOCKED',
    ]);
    const indexes = await dataSource.query(
      `SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'price_refreshes'`
    );
    const names = indexes.map((row: { indexname: string }) => row.indexname);
    expect(names.sort()).toEqual([
      'ix_price_refreshes_pending',
      'ix_price_refreshes_requested_by',
      'ix_price_refreshes_supermarket',
      'pk_price_refreshes',
    ]);
    const pending = indexes.find(
      (row: { indexname: string }) =>
        row.indexname === 'ix_price_refreshes_pending'
    );
    expect(pending.indexdef).toContain(`WHERE (status = 'PENDING'`);
  });

  it('starts one fetch for two requests at one instant, and writes the price with no run', async () => {
    const entry = await seed();
    const refreshes = service();
    const answers = await Promise.allSettled([
      refreshes.request({
        userId: SHOPPER,
        itemId: ITEM,
        priceScopeId: WAREHOUSE,
      }),
      refreshes.request({
        userId: OTHER,
        itemId: ITEM,
        priceScopeId: WAREHOUSE,
      }),
    ]);
    await refreshes.settled();

    // Both pass the product read at once, and the chain claim lets one
    // through. The other is refused with the chain's time left, or, when it
    // reads after the first row is written, joins that row.
    const refused = answers.filter((answer) => answer.status === 'rejected');
    for (const answer of refused) {
      const reason = (answer as PromiseRejectedResult).reason;
      expect(reason).toBeInstanceOf(RateLimitedException);
      expect(
        (reason as RateLimitedException).details?.['retryAfterSeconds']
      ).toBeGreaterThan(0);
    }
    const ids = new Set(
      answers
        .filter((answer) => answer.status === 'fulfilled')
        .map(
          (answer) =>
            (answer as PromiseFulfilledResult<{ id: string }>).value.id
        )
    );
    expect(ids.size).toBe(1);
    expect(fetches).toBe(1);

    const rows = await dataSource.getRepository(PriceRefresh).find({
      where: { supermarketId: CHAIN },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      status: PriceRefreshStatus.DONE,
      entryId: entry.id,
      fetchScopeId: WAREHOUSE,
      pricesWritten: 1,
    });

    const price = await dataSource
      .getRepository(SourceEntryPrice)
      .findOneOrFail({ where: { entryId: entry.id, priceScopeId: WAREHOUSE } });
    expect(Number(price.price)).toBe(8.75);
    expect(price.runId).toBeNull();
    expect(price.observedAt.getTime()).toBeGreaterThan(LONG_AGO.getTime());
    expect(sent).toHaveLength(1);
    expect(sent[0][2]).toBeNull();

    // The claims stand in Redis, with the section 5 windows.
    const chainMs = await redis.client.pttl(REFRESH_KEYS.chain(CHAIN));
    const productMs = await redis.client.pttl(
      REFRESH_KEYS.product(entry.id, WAREHOUSE)
    );
    expect(chainMs).toBeGreaterThan(25_000);
    expect(chainMs).toBeLessThanOrEqual(30_000);
    expect(productMs).toBeGreaterThan(29 * 60_000);

    // The price is fresh now, so the next request fetches nothing.
    const again = await refreshes.request({
      userId: SHOPPER,
      itemId: ITEM,
      priceScopeId: WAREHOUSE,
    });
    expect(again.status).toBe(PriceRefreshStatus.FRESH);
    expect(fetches).toBe(1);
  });

  it('starts during a RUNNING run of the chain, and leaves the run row untouched', async () => {
    await seed();
    const [run] = await dataSource.query(
      `INSERT INTO "harvest_runs" ("supermarketId", "mode", "trigger", "status", "startedAt", "correlationId")
       VALUES ($1, 'CATALOG_DISCOVERY', 'MANUAL', 'RUNNING', now(), 'plan-0216')
       RETURNING *`,
      [CHAIN]
    );
    const refreshes = service();
    const view = await refreshes.request({
      userId: SHOPPER,
      itemId: ITEM,
      priceScopeId: WAREHOUSE,
    });
    expect(view.status).toBe(PriceRefreshStatus.PENDING);
    await refreshes.settled();

    const [after] = await dataSource.query(
      `SELECT * FROM "harvest_runs" WHERE "id" = $1`,
      [run.id]
    );
    expect(after).toEqual(run);
    const runs = await dataSource.query(
      `SELECT count(*)::int AS n FROM "harvest_runs" WHERE "supermarketId" = $1`,
      [CHAIN]
    );
    expect(runs[0].n).toBe(1);
  });
});
