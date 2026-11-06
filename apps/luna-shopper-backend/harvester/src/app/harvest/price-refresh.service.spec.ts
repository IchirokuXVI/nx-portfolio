import type { ConfigService } from '@nestjs/config';
import {
  HarvestRunStatus,
  HarvestRunStopReason,
  PriceRefreshRefusal,
  PriceRefreshStatus,
  PriceScopeKind,
  PriceSourceKind,
  SourceEntryStatus,
} from '@portfolio/luna-shopper/contracts';
import { MercadonaHttpError } from '@portfolio/luna-shopper/mercadona';
import {
  NotFoundException,
  PriceNotRefreshableException,
  RateLimitedException,
} from '@portfolio/luna-shopper/platform';
import type { Repository } from 'typeorm';
import type {
  HarvestRun,
  PriceRefresh,
  SourceCatalogEntry,
  SourceEntryPrice,
  SupermarketSource,
} from '../entities';
import type { CatalogClient } from './catalog-client.service';
import type { PriceRefreshCooldown } from './price-refresh.cooldown';
import type {
  RefreshFetcher,
  RefreshFetchRequest,
} from './price-refresh.fetchers';
import { PriceRefreshResolver } from './price-refresh.resolver';
import { PriceRefreshService } from './price-refresh.service';
import type { NewPriceRefresh, PriceRefreshStore } from './price-refresh.store';
import type { RefreshedPricesInput, SourceIngest } from './source-ingest';
import type { SupermarketSourceService } from './supermarket-source.service';

/**
 * The refresh of plan 0216, sections 3, 4 and 7, over fakes of every table and
 * of Redis. Real Postgres and real Redis are `price-refresh.integration.spec.ts`.
 */

const CHAIN = '02160216-1111-4111-8111-111111111111';
const SOURCE = '02160216-1111-4111-8111-555555555555';
const ITEM = '02160216-2222-4222-8222-222222222222';
const WAREHOUSE = '02160216-3333-4333-8333-333333333331';
const COPY = '02160216-3333-4333-8333-333333333332';
const OTHER_COPY = '02160216-3333-4333-8333-333333333333';
const SHOPPER = '02160216-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const OTHER = '02160216-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
const NOW = new Date('2026-11-06T12:00:00.000Z');
const LONG_AGO = new Date('2026-11-05T12:00:00.000Z');

interface World {
  entries: SourceCatalogEntry[];
  prices: SourceEntryPrice[];
  refreshes: PriceRefresh[];
  runs: HarvestRun[];
  source: SupermarketSource | null;
  settings: Record<string, unknown>;
  claims: number;
  claimRefusal: number | null;
  blocked: string[];
  viewers: Set<string>;
  writes: RefreshedPricesInput[];
  fetches: RefreshFetchRequest[];
  fetcher: RefreshFetcher;
  now: Date;
}

function world(): World {
  return {
    entries: [entry('entry-1')],
    prices: [priceRow('entry-1', WAREHOUSE, LONG_AGO)],
    refreshes: [],
    runs: [],
    source: {
      id: SOURCE,
      supermarketId: CHAIN,
      adapterKey: 'mercadona-api',
      enabled: true,
      config: {},
    } as unknown as SupermarketSource,
    settings: {
      harvestEnabled: true,
      refreshEnabled: true,
      refreshProductMinutes: 30,
      refreshBlockedMinutes: 30,
      userAgent: 'test',
    },
    claims: 0,
    claimRefusal: null,
    blocked: [],
    viewers: new Set(),
    writes: [],
    fetches: [],
    fetcher: async () => ({
      found: true,
      observation: {
        externalId: '4241',
        detailFetched: false,
        observedAt: NOW,
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
    }),
    now: NOW,
  };
}

function entry(
  id: string,
  over: Partial<SourceCatalogEntry> = {}
): SourceCatalogEntry {
  return {
    id,
    supermarketId: CHAIN,
    externalId: '4241',
    status: SourceEntryStatus.ACTIVE,
    itemId: ITEM,
    soldByWeight: false,
    extra: null,
    ...over,
  } as SourceCatalogEntry;
}

function priceRow(
  entryId: string,
  priceScopeId: string,
  observedAt: Date,
  over: Partial<SourceEntryPrice> = {}
): SourceEntryPrice {
  return {
    entryId,
    priceScopeId,
    sourceKind: PriceSourceKind.OFFICIAL_API,
    observedAt,
    copiedFromScopeId: null,
    ...over,
  } as SourceEntryPrice;
}

function build(w: World) {
  const prices = {
    createQueryBuilder: () => {
      const params: Record<string, unknown> = {};
      const chain = {
        innerJoin: () => chain,
        where: (_sql: string, p: Record<string, unknown>) => {
          Object.assign(params, p);
          return chain;
        },
        andWhere: (_sql: string, p: Record<string, unknown>) => {
          Object.assign(params, p);
          return chain;
        },
        getMany: async () =>
          w.prices.filter((row) => {
            const held = w.entries.find((each) => each.id === row.entryId);
            return (
              row.priceScopeId === params['priceScopeId'] &&
              held?.itemId === params['itemId'] &&
              held?.status === params['status']
            );
          }),
      };
      return chain;
    },
    find: async (query: {
      where: { entryId: string; priceScopeId?: string };
    }) =>
      w.prices
        .filter(
          (row) =>
            row.entryId === query.where.entryId &&
            (query.where.priceScopeId === undefined ||
              row.priceScopeId === query.where.priceScopeId)
        )
        .sort((a, b) => b.observedAt.getTime() - a.observedAt.getTime()),
  } as unknown as Repository<SourceEntryPrice>;
  const entries = {
    findOne: async (query: { where: { id: string } }) =>
      w.entries.find((row) => row.id === query.where.id) ?? null,
  } as unknown as Repository<SourceCatalogEntry>;
  const catalog = {
    listAllPriceScopes: async () => [
      { id: WAREHOUSE, kind: PriceScopeKind.LOCAL_AREA, externalKey: '4661' },
      { id: COPY, kind: PriceScopeKind.LOCAL_AREA, externalKey: null },
      { id: OTHER_COPY, kind: PriceScopeKind.NATIONAL, externalKey: 'ES' },
    ],
  } as unknown as CatalogClient;
  const resolver = new PriceRefreshResolver(prices, entries, catalog);

  let inserted = 0;
  const store = {
    findPending: async (entryId: string, fetchScopeId: string) =>
      w.refreshes.find(
        (row) =>
          row.entryId === entryId &&
          row.fetchScopeId === fetchScopeId &&
          row.status === PriceRefreshStatus.PENDING
      ) ?? null,
    findById: async (id: string) =>
      w.refreshes.find((row) => row.id === id) ?? null,
    insertPending: async (row: NewPriceRefresh) => {
      inserted += 1;
      const saved = {
        ...row,
        id: `refresh-${inserted}`,
        status: PriceRefreshStatus.PENDING,
        pricesWritten: 0,
        pricesConfirmed: 0,
        error: null,
        requestedAt: w.now,
        finishedAt: null,
      } as PriceRefresh;
      w.refreshes.push(saved);
      return saved;
    },
    finish: async (
      id: string,
      outcome: Partial<PriceRefresh>,
      finishedAt: Date
    ) => {
      const row = w.refreshes.find((each) => each.id === id);
      if (row && row.status === PriceRefreshStatus.PENDING) {
        Object.assign(row, {
          pricesWritten: 0,
          pricesConfirmed: 0,
          error: null,
          ...outcome,
          finishedAt,
        });
      }
    },
    reapInterrupted: async (before: Date, now: Date) => {
      let count = 0;
      for (const row of w.refreshes) {
        if (
          row.status === PriceRefreshStatus.PENDING &&
          row.requestedAt < before
        ) {
          Object.assign(row, {
            status: PriceRefreshStatus.FAILED,
            error: 'interrupted',
            finishedAt: now,
          });
          count += 1;
        }
      }
      return count;
    },
    deleteOlderThan: async (before: Date) => {
      const kept = w.refreshes.filter((row) => row.requestedAt >= before);
      const deleted = w.refreshes.length - kept.length;
      w.refreshes.splice(0, w.refreshes.length, ...kept);
      return deleted;
    },
  } as unknown as PriceRefreshStore;

  const cooldown = {
    claim: async () => {
      if (w.claimRefusal !== null) {
        throw new RateLimitedException('cooling', {
          details: { retryAfterSeconds: w.claimRefusal },
        });
      }
      w.claims += 1;
    },
    remaining: async () => w.claimRefusal ?? 0,
    block: async (supermarketId: string) => {
      w.blocked.push(supermarketId);
    },
    addViewer: async (refreshId: string, userId: string) => {
      w.viewers.add(`${refreshId}:${userId}`);
    },
    isViewer: async (refreshId: string, userId: string) =>
      w.viewers.has(`${refreshId}:${userId}`),
  } as unknown as PriceRefreshCooldown;

  const sources = {
    findBySupermarket: async () => w.source,
  } as unknown as SupermarketSourceService;
  const ingest = {
    writeRefreshedPrices: async (input: RefreshedPricesInput) => {
      w.writes.push(input);
      return { recorded: 1, inserted: 1, confirmed: 0, soldAnotherWay: false };
    },
  } as unknown as SourceIngest;
  const runs = {
    findOne: async () =>
      [...w.runs]
        .filter(
          (run) =>
            run.status !== HarvestRunStatus.PENDING &&
            run.status !== HarvestRunStatus.RUNNING
        )
        .sort(
          (a, b) =>
            (b.finishedAt?.getTime() ?? 0) - (a.finishedAt?.getTime() ?? 0)
        )[0] ?? null,
  } as unknown as Repository<HarvestRun>;
  const config = {
    getOrThrow: () => w.settings,
  } as unknown as ConfigService;
  const fetchers = {
    'mercadona-api': async (request: RefreshFetchRequest) => {
      w.fetches.push(request);
      return w.fetcher(request);
    },
  };

  const service = new PriceRefreshService(
    store,
    resolver,
    cooldown,
    sources,
    ingest,
    prices,
    runs,
    config,
    fetchers,
    () => w.now
  );
  return { service, resolver };
}

const ask = { userId: SHOPPER, itemId: ITEM, priceScopeId: WAREHOUSE };

async function reasonOf(promise: Promise<unknown>): Promise<unknown> {
  const error = await promise.catch((thrown: unknown) => thrown);
  expect(error).toBeInstanceOf(PriceNotRefreshableException);
  return (error as PriceNotRefreshableException).details?.['reason'];
}

describe('PriceRefreshResolver (plan 0216, section 3)', () => {
  const kind = async () => PriceSourceKind.OFFICIAL_API;

  it('resolves an ACTIVE row with a price at the scope to itself', async () => {
    const w = world();
    const resolved = await build(w).resolver.resolve(ITEM, WAREHOUSE, kind);
    expect(resolved).toMatchObject({
      refused: null,
      priceScopeId: WAREHOUSE,
      fetchScopeId: WAREHOUSE,
      observedAt: LONG_AGO,
    });
  });

  it('resolves a copy to its origin, and names the sibling copies', async () => {
    const w = world();
    w.prices.push(
      priceRow('entry-1', COPY, LONG_AGO, { copiedFromScopeId: WAREHOUSE }),
      priceRow('entry-1', OTHER_COPY, LONG_AGO, {
        copiedFromScopeId: WAREHOUSE,
      })
    );
    const { resolver } = build(w);
    const resolved = await resolver.resolve(ITEM, COPY, kind);
    expect(resolved.refused).toBeNull();
    if (resolved.refused !== null) return;
    expect(resolved.fetchScopeId).toBe(WAREHOUSE);
    const { copiesOfRows } = await import('./price-refresh.resolver');
    expect(copiesOfRows(resolved.rows)(WAREHOUSE)).toEqual([COPY, OTHER_COPY]);
  });

  it('answers NOT_HARVESTED with no row at the scope', async () => {
    const w = world();
    w.prices = [];
    expect(
      (await build(w).resolver.resolve(ITEM, WAREHOUSE, kind)).refused
    ).toBe(PriceRefreshRefusal.NOT_HARVESTED);
  });

  it('answers NOT_HARVESTED for a row that is not ACTIVE', async () => {
    const w = world();
    w.entries = [entry('entry-1', { status: SourceEntryStatus.CANDIDATE })];
    expect(
      (await build(w).resolver.resolve(ITEM, WAREHOUSE, kind)).refused
    ).toBe(PriceRefreshRefusal.NOT_HARVESTED);
  });

  it('answers AMBIGUOUS for two ACTIVE rows of the item at the scope', async () => {
    const w = world();
    w.entries.push(entry('entry-2', { externalId: '4242' }));
    w.prices.push(priceRow('entry-2', WAREHOUSE, LONG_AGO));
    expect(
      (await build(w).resolver.resolve(ITEM, WAREHOUSE, kind)).refused
    ).toBe(PriceRefreshRefusal.AMBIGUOUS);
  });
});

describe('PriceRefreshService (plan 0216, section 7)', () => {
  it('refuses with REFRESH_OFF first, whatever else is wrong', async () => {
    const w = world();
    w.settings['refreshEnabled'] = false;
    w.prices = [];
    expect(await reasonOf(build(w).service.request(ask))).toBe(
      PriceRefreshRefusal.REFRESH_OFF
    );
    w.settings['refreshEnabled'] = true;
    w.settings['harvestEnabled'] = false;
    expect(await reasonOf(build(w).service.request(ask))).toBe(
      PriceRefreshRefusal.REFRESH_OFF
    );
  });

  it('refuses each later step in its order', async () => {
    const w = world();
    w.prices = [];
    w.source = null;
    expect(await reasonOf(build(w).service.request(ask))).toBe(
      PriceRefreshRefusal.NOT_HARVESTED
    );

    const off = world();
    (off.source as SupermarketSource).enabled = false;
    (off.source as SupermarketSource).adapterKey = 'eljamon-web';
    expect(await reasonOf(build(off).service.request(ask))).toBe(
      PriceRefreshRefusal.SOURCE_OFF
    );

    const noFetch = world();
    (noFetch.source as SupermarketSource).adapterKey = 'eljamon-web';
    noFetch.runs.push({
      status: HarvestRunStatus.ABORTED,
      stopReason: HarvestRunStopReason.SOURCE_BLOCKED,
      finishedAt: new Date(NOW.getTime() - 60_000),
    } as HarvestRun);
    expect(await reasonOf(build(noFetch).service.request(ask))).toBe(
      PriceRefreshRefusal.NO_SINGLE_FETCH
    );
  });

  it('refuses CHAIN_REFUSING while the newest finished run stopped blocked, and only for the window', async () => {
    const w = world();
    w.runs.push({
      status: HarvestRunStatus.ABORTED,
      stopReason: HarvestRunStopReason.SOURCE_BLOCKED,
      finishedAt: new Date(NOW.getTime() - 29 * 60_000),
    } as HarvestRun);
    expect(await reasonOf(build(w).service.request(ask))).toBe(
      PriceRefreshRefusal.CHAIN_REFUSING
    );

    // A run in flight is not read, and does not hide the stopped one.
    w.runs.push({
      status: HarvestRunStatus.RUNNING,
      stopReason: null,
      finishedAt: null,
    } as HarvestRun);
    expect(await reasonOf(build(w).service.request(ask))).toBe(
      PriceRefreshRefusal.CHAIN_REFUSING
    );

    // Past the window, the chain is fetched again.
    w.now = new Date(NOW.getTime() + 2 * 60_000);
    await build(w).service.request(ask);
    expect(w.claims).toBe(1);
  });

  it('does not refuse when a newer finished run completed', async () => {
    const w = world();
    w.runs.push(
      {
        status: HarvestRunStatus.ABORTED,
        stopReason: HarvestRunStopReason.SOURCE_BLOCKED,
        finishedAt: new Date(NOW.getTime() - 20 * 60_000),
      } as HarvestRun,
      {
        status: HarvestRunStatus.COMPLETED,
        stopReason: null,
        finishedAt: new Date(NOW.getTime() - 5 * 60_000),
      } as HarvestRun
    );
    const view = await build(w).service.request(ask);
    expect(view.status).toBe(PriceRefreshStatus.PENDING);
  });

  it('answers FRESH within the product window, with no claim and no row', async () => {
    const w = world();
    w.prices = [
      priceRow('entry-1', WAREHOUSE, new Date(NOW.getTime() - 10 * 60_000)),
    ];
    const { service } = build(w);
    const view = await service.request(ask);
    expect(view).toEqual({
      id: null,
      itemId: ITEM,
      priceScopeId: WAREHOUSE,
      status: PriceRefreshStatus.FRESH,
      observedAt: new Date(NOW.getTime() - 10 * 60_000).toISOString(),
      requestedAt: null,
      finishedAt: null,
    });
    expect(w.claims).toBe(0);
    expect(w.refreshes).toEqual([]);
    expect(w.fetches).toEqual([]);

    const check = await service.check(ask);
    expect(check).toMatchObject({
      refreshable: false,
      reason: PriceRefreshRefusal.FRESH,
      retryAfterSeconds: 20 * 60,
    });
  });

  it('starts a refresh: claims, inserts PENDING, answers before the fetch, then writes DONE', async () => {
    const w = world();
    const { service } = build(w);
    const view = await service.request(ask);
    expect(view.status).toBe(PriceRefreshStatus.PENDING);
    expect(view.id).toBe('refresh-1');
    expect(w.claims).toBe(1);

    await service.settled();
    expect(w.fetches[0]).toMatchObject({ fetchKey: '4661' });
    expect(w.writes).toHaveLength(1);
    expect(w.writes[0].scopeIdFor('4661')).toBe(WAREHOUSE);
    expect(w.writes[0].sourceKind).toBe(PriceSourceKind.OFFICIAL_API);
    expect(w.refreshes[0]).toMatchObject({
      status: PriceRefreshStatus.DONE,
      pricesWritten: 1,
      finishedAt: NOW,
    });
    expect(w.runs).toEqual([]);
  });

  it('fetches a copy at its origin and rewrites the copies it has', async () => {
    const w = world();
    w.prices.push(
      priceRow('entry-1', COPY, LONG_AGO, { copiedFromScopeId: WAREHOUSE })
    );
    const { service } = build(w);
    await service.request({ ...ask, priceScopeId: COPY });
    await service.settled();
    expect(w.refreshes[0]).toMatchObject({
      priceScopeId: COPY,
      fetchScopeId: WAREHOUSE,
    });
    expect(w.fetches[0].fetchKey).toBe('4661');
    expect(w.writes[0].copiesOf(WAREHOUSE)).toEqual([COPY]);
  });

  it('joins a refresh in flight, whoever started it, and lets the joiner read it', async () => {
    const w = world();
    let release: () => void = () => undefined;
    w.fetcher = () =>
      new Promise((resolve) => {
        release = () => resolve({ found: false });
      });
    const { service } = build(w);
    const first = await service.request(ask);
    const joined = await service.request({ ...ask, userId: OTHER });
    expect(joined.id).toBe(first.id);
    expect(w.claims).toBe(1);
    expect(w.refreshes).toHaveLength(1);

    const check = await service.check({ ...ask, userId: OTHER });
    expect(check).toMatchObject({
      refreshable: true,
      pendingRefreshId: first.id,
    });
    expect(
      (await service.get({ userId: OTHER, refreshId: first.id as string }))
        .status
    ).toBe(PriceRefreshStatus.PENDING);

    release();
    await service.settled();
    expect(w.refreshes[0].status).toBe(PriceRefreshStatus.NOT_STOCKED);
  });

  it('answers 404 to a user who neither requested nor joined', async () => {
    const w = world();
    const { service } = build(w);
    const view = await service.request(ask);
    await service.settled();
    await expect(
      service.get({ userId: OTHER, refreshId: view.id as string })
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.get({ userId: SHOPPER, refreshId: 'no-such-refresh' })
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(
      (await service.get({ userId: SHOPPER, refreshId: view.id as string }))
        .status
    ).toBe(PriceRefreshStatus.DONE);
  });

  it('passes the claim refusal through as a 429 and writes no row', async () => {
    const w = world();
    w.claimRefusal = 18;
    const { service } = build(w);
    await expect(service.request(ask)).rejects.toBeInstanceOf(
      RateLimitedException
    );
    expect(w.refreshes).toEqual([]);
    expect((await service.check(ask)).retryAfterSeconds).toBe(18);
  });

  it('records NOT_STOCKED for a 404, and writes nothing', async () => {
    const w = world();
    w.fetcher = async () => ({ found: false });
    const { service } = build(w);
    await service.request(ask);
    await service.settled();
    expect(w.refreshes[0].status).toBe(PriceRefreshStatus.NOT_STOCKED);
    expect(w.writes).toEqual([]);
  });

  it('records BLOCKED for a 403 and sets the blocked key, and nothing else', async () => {
    const w = world();
    w.fetcher = async () => {
      throw new MercadonaHttpError(403, 'https://fixtures.test/products/4241/');
    };
    const { service } = build(w);
    await service.request(ask);
    await service.settled();
    expect(w.refreshes[0].status).toBe(PriceRefreshStatus.BLOCKED);
    expect(w.refreshes[0].error).toContain('403');
    expect(w.blocked).toEqual([CHAIN]);
    expect(w.writes).toEqual([]);
  });

  it('records FAILED on a timeout', async () => {
    jest.useFakeTimers({ now: NOW, doNotFake: ['nextTick', 'setImmediate'] });
    try {
      const w = world();
      w.fetcher = (request) =>
        new Promise((_, reject) => {
          request.signal.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError'))
          );
        });
      const { service } = build(w);
      await service.request(ask);
      await jest.advanceTimersByTimeAsync(20_000);
      await service.settled();
      expect(w.refreshes[0]).toMatchObject({
        status: PriceRefreshStatus.FAILED,
        error: 'The source did not answer within 20 s.',
      });
      expect(w.blocked).toEqual([]);
    } finally {
      jest.useRealTimers();
    }
  });

  it('records FAILED for a read sold another way than its row', async () => {
    const w = world();
    const { service } = build(w);
    const ingest = (service as unknown as { ingest: SourceIngest }).ingest;
    ingest.writeRefreshedPrices = async () => ({
      recorded: 0,
      inserted: 0,
      confirmed: 0,
      soldAnotherWay: true,
    });
    await service.request(ask);
    await service.settled();
    expect(w.refreshes[0].status).toBe(PriceRefreshStatus.FAILED);
  });

  it('writes a PENDING row older than two minutes FAILED as interrupted, and deletes rows past 90 days', async () => {
    const w = world();
    w.refreshes.push(
      {
        id: 'stuck',
        status: PriceRefreshStatus.PENDING,
        requestedAt: new Date(NOW.getTime() - 3 * 60_000),
      } as PriceRefresh,
      {
        id: 'recent',
        status: PriceRefreshStatus.PENDING,
        requestedAt: new Date(NOW.getTime() - 60_000),
      } as PriceRefresh,
      {
        id: 'old',
        status: PriceRefreshStatus.DONE,
        requestedAt: new Date(NOW.getTime() - 91 * 86_400_000),
      } as PriceRefresh
    );
    await build(w).service.tidy();
    expect(w.refreshes.map((row) => [row.id, row.status])).toEqual([
      ['stuck', PriceRefreshStatus.FAILED],
      ['recent', PriceRefreshStatus.PENDING],
    ]);
    expect(w.refreshes[0].error).toBe('interrupted');
  });

  it('answers the check for a refusal with its reason and no wait', async () => {
    const w = world();
    (w.source as SupermarketSource).enabled = false;
    expect(await build(w).service.check(ask)).toEqual({
      refreshable: false,
      reason: PriceRefreshRefusal.SOURCE_OFF,
      retryAfterSeconds: 0,
      pendingRefreshId: null,
      observedAt: LONG_AGO.toISOString(),
    });
  });
});
