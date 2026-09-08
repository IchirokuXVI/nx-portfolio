import {
  ADMIN_DASHBOARD_RECENT_RUN_LIMIT,
  ADMIN_DASHBOARD_WINDOW_DAYS,
  DiscoveredPlaceStatus,
  HarvestRunMode,
  HarvestRunStatus,
  ItemSourceMatch,
  PriceSourceKind,
  SourceEntryStatus,
  SourceLocationStatus,
  type AdminDashboardRequest,
  type AdminDashboardWindow,
} from '@portfolio/luna-shopper/contracts';
import {
  describeIntegration,
  requiredEnv,
} from '@portfolio/luna-shopper/test-fixtures/jest';
import { DataSource, Repository } from 'typeorm';
import { HARVESTER_MIGRATIONS } from '../db/migrations';
import {
  DiscoveredPlace,
  HARVESTER_ENTITIES,
  HarvestRun,
  SourceCatalogEntry,
  SourceLocation,
  SupermarketSource,
} from '../entities';
import { HarvestDashboardService } from './dashboard.service';
import { PlatformAdminService } from './platform-admin.service';

/**
 * The harvester's dashboard block against real Postgres (plan 0088, section 7).
 *
 * **The counts are SQL and nothing else**, so a fake repository would only
 * assert that the spec's own arithmetic agrees with itself. What is worth
 * proving here is what the queries have to get right against a real schema: that
 * the filters name columns Postgres has, that the run in flight is the running
 * one rather than the newest, and that a chain whose queue is empty still
 * appears, because that is the row a `GROUP BY` cannot produce on its own.
 *
 * There is no daily series in this block. The window reaches only
 * `runs.inWindow`, which is why it is a fixed pair of days rather than one
 * derived from today: a run seeded before the window stays before it whenever
 * the suite runs.
 *
 * It works in a scratch schema of its own and drops it afterwards, so it never
 * touches the developer's own harvester data.
 *
 *   bash k8s/e2e/luna-shopper-backend/luna-slot.sh --up
 *   LUNA_INTEGRATION=1 HARVESTER_DB_URL=postgres://luna_harvester:luna_harvester@localhost:<port>/luna_harvester \
 *     npx nx run luna-shopper-backend-harvester:test-integration
 */
const SCHEMA = 'plan0088_harvest_dashboard_test';

/** The admin the stub gate lets through. */
const OPERATOR = '33333333-3333-4333-8333-333333333333';

/**
 * Two chains, in the order the block reports them.
 *
 * The queues come back in `supermarketId` order, so the two ids are chosen to
 * sort the way the assertions read.
 */
const CHAIN_A = '11111111-1111-4111-8111-111111111111';
const CHAIN_B = '22222222-2222-4222-8222-222222222222';

/** One day, as `YYYY-MM-DD` in UTC, shifted from another. */
function shiftDay(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00.000Z`) + days * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

/** An instant inside a day, well away from either boundary. */
function at(day: string): Date {
  return new Date(`${day}T06:00:00.000Z`);
}

const WINDOW: AdminDashboardWindow = {
  from: shiftDay('2026-06-30', -(ADMIN_DASHBOARD_WINDOW_DAYS - 1)),
  to: '2026-06-30',
};

const REQUEST: AdminDashboardRequest = {
  userId: OPERATOR,
  adminToken: 'stub',
  window: WINDOW,
};

describeIntegration('the harvester’s dashboard block (real Postgres)', () => {
  let dataSource: DataSource;
  let dashboard: HarvestDashboardService;
  let runs: Repository<HarvestRun>;
  let entries: Repository<SourceCatalogEntry>;
  let places: Repository<DiscoveredPlace>;
  let shops: Repository<SourceLocation>;
  let sources: Repository<SupermarketSource>;

  beforeAll(async () => {
    const url = requiredEnv('HARVESTER_DB_URL');

    const bootstrap = new DataSource({ type: 'postgres', url });
    await bootstrap.initialize();
    await bootstrap.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
    await bootstrap.query(`CREATE SCHEMA "${SCHEMA}"`);
    await bootstrap.destroy();

    dataSource = new DataSource({
      type: 'postgres',
      url,
      schema: SCHEMA,
      entities: HARVESTER_ENTITIES,
      migrations: HARVESTER_MIGRATIONS,
      synchronize: false,
      // The migrations are raw SQL naming unqualified tables, so the scratch
      // schema has to be on the connection's search_path. `public` follows it
      // for the extensions they use.
      extra: { options: `-c search_path=${SCHEMA},public` },
    });
    await dataSource.initialize();
    await dataSource.runMigrations();

    runs = dataSource.getRepository(HarvestRun);
    entries = dataSource.getRepository(SourceCatalogEntry);
    places = dataSource.getRepository(DiscoveredPlace);
    shops = dataSource.getRepository(SourceLocation);
    sources = dataSource.getRepository(SupermarketSource);

    // The gate has its own specs and needs a keypair. Here it stands for a
    // request that already carried a live operator token, so the block under
    // test is the counting rather than the signature check.
    const gate = {
      requireAdmin: jest.fn(async () => OPERATOR),
    } as unknown as PlatformAdminService;

    dashboard = new HarvestDashboardService(
      runs,
      entries,
      places,
      shops,
      sources,
      gate
    );
  }, 120_000);

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
      await dataSource.destroy();
    }
  });

  let seq = 0;

  beforeEach(async () => {
    for (const repository of [runs, entries, places, shops, sources]) {
      await repository.createQueryBuilder().delete().execute();
    }
    seq = 0;
    // Both chains exist for every test, because both queues are reported per
    // chain and the list of chains is what makes an empty queue visible.
    await sources.save([
      sources.create({
        supermarketId: CHAIN_A,
        adapterKey: 'mercadona-api',
        enabled: true,
      }),
      sources.create({
        supermarketId: CHAIN_B,
        adapterKey: 'deza-web',
        enabled: false,
      }),
    ]);
  });

  /**
   * One run, requested on a chosen day.
   *
   * A finished run carries a chain so the fixture stays close to a real one. An
   * unfinished run is the case the partial unique index governs, so each of the
   * two in flight statuses gets a chain of its own.
   */
  async function newRun(
    status: HarvestRunStatus,
    day: string,
    supermarketId: string | null = null
  ): Promise<HarvestRun> {
    return runs.save(
      runs.create({
        supermarketId,
        sourceId: null,
        priceScopeId: null,
        mode: HarvestRunMode.CATALOG_DISCOVERY,
        status,
        requestedAt: at(day),
      })
    );
  }

  async function newEntry(
    supermarketId: string,
    status: SourceEntryStatus
  ): Promise<SourceCatalogEntry> {
    seq += 1;
    return entries.save(
      entries.create({
        supermarketId,
        externalId: `sku-${seq}`,
        sourceKind: PriceSourceKind.OFFICIAL_API,
        name: `Product ${seq}`,
        status,
      })
    );
  }

  async function newShop(
    supermarketId: string,
    status: SourceLocationStatus
  ): Promise<SourceLocation> {
    seq += 1;
    return shops.save(
      shops.create({
        supermarketId,
        externalId: `T${seq}`,
        printedName: `Ronda ${seq}`,
        status,
        // Stated rather than left to the entity's declared default. Plan 0086's
        // migration retypes this column, and retyping drops the default the
        // decorator still names, so an insert that omits it is refused.
        matchedBy: ItemSourceMatch.NAME_SIZE,
      })
    );
  }

  async function newPlace(status: DiscoveredPlaceStatus) {
    seq += 1;
    return places.save(
      places.create({
        provider: 'OSM',
        externalRef: `node/${seq}`,
        latitude: 37.88,
        longitude: -4.78,
        status,
      })
    );
  }

  it('refuses to count anything the gate did not let through', async () => {
    const refused = new Error('that operator token was not accepted');
    const closed = new HarvestDashboardService(
      runs,
      entries,
      places,
      shops,
      sources,
      {
        requireAdmin: jest.fn(async () => {
          throw refused;
        }),
      } as unknown as PlatformAdminService
    );

    // Every subject on this service is gated, reads included: nothing the
    // harvester exposes is open to ordinary users.
    await expect(closed.dashboard(REQUEST)).rejects.toBe(refused);
  });

  it('names every run status in enum order, even the ones at zero', async () => {
    await newRun(HarvestRunStatus.COMPLETED, WINDOW.from, CHAIN_A);
    await newRun(HarvestRunStatus.COMPLETED, WINDOW.to, CHAIN_A);
    await newRun(HarvestRunStatus.FAILED, WINDOW.to, CHAIN_B);

    const block = await dashboard.dashboard(REQUEST);

    // The chart that draws this assigns colours by position, so a bar appearing
    // only once something has failed would recolour the whole chart that day.
    expect(block.runs.byStatus).toEqual([
      { status: HarvestRunStatus.PENDING, count: 0 },
      { status: HarvestRunStatus.RUNNING, count: 0 },
      { status: HarvestRunStatus.COMPLETED, count: 2 },
      { status: HarvestRunStatus.FAILED, count: 1 },
      { status: HarvestRunStatus.ABORTED, count: 0 },
      { status: HarvestRunStatus.STALE, count: 0 },
    ]);
    expect(Object.values(HarvestRunStatus)).toEqual(
      block.runs.byStatus.map((row) => row.status)
    );
  });

  it('counts runs requested inside the window and all of them by status', async () => {
    await newRun(HarvestRunStatus.COMPLETED, shiftDay(WINDOW.from, -1));
    await newRun(HarvestRunStatus.COMPLETED, shiftDay(WINDOW.from, -40));
    await newRun(HarvestRunStatus.COMPLETED, WINDOW.from);
    await newRun(HarvestRunStatus.ABORTED, WINDOW.to);

    const block = await dashboard.dashboard(REQUEST);

    expect(block.runs.inWindow).toBe(2);
    // `byStatus` is over all time, which is why the two disagree: how a chain's
    // runs have ended is not a question about the last thirty days.
    expect(
      block.runs.byStatus.find(
        (row) => row.status === HarvestRunStatus.COMPLETED
      )
    ).toEqual({ status: HarvestRunStatus.COMPLETED, count: 3 });
  });

  it('answers no run in flight when nothing is queued or working', async () => {
    await newRun(HarvestRunStatus.COMPLETED, WINDOW.to, CHAIN_A);

    const block = await dashboard.dashboard(REQUEST);

    // The ordinary state of a cluster: no storefront is enabled in either.
    expect(block.running).toBeNull();
  });

  it('picks the running run over a queued one requested later', async () => {
    const running = await newRun(
      HarvestRunStatus.RUNNING,
      WINDOW.from,
      CHAIN_A
    );
    await newRun(HarvestRunStatus.PENDING, WINDOW.to, CHAIN_B);

    const block = await dashboard.dashboard(REQUEST);

    // A running run outranks a queued one whatever the clock says, which is the
    // whole reason the two statuses are asked for in order rather than together.
    expect(block.running?.id).toBe(running.id);
    expect(block.running?.status).toBe(HarvestRunStatus.RUNNING);
    // The same view the run screen already draws, so nothing is mapped twice.
    expect(block.running?.requestedAt).toBe(at(WINDOW.from).toISOString());
  });

  it('falls back to the newest queued run when none is working', async () => {
    await newRun(HarvestRunStatus.PENDING, WINDOW.from, CHAIN_A);
    const newest = await newRun(HarvestRunStatus.PENDING, WINDOW.to, CHAIN_B);

    const block = await dashboard.dashboard(REQUEST);

    expect(block.running?.id).toBe(newest.id);
  });

  it('names the most recently requested runs, newest first and capped', async () => {
    const days = [0, 1, 2, 3, 4, 5, 6].map((back) =>
      shiftDay(WINDOW.to, -back)
    );
    for (const day of days) {
      await newRun(HarvestRunStatus.COMPLETED, day, CHAIN_A);
    }

    const block = await dashboard.dashboard(REQUEST);

    expect(block.recent).toHaveLength(ADMIN_DASHBOARD_RECENT_RUN_LIMIT);
    expect(block.recent.map((run) => run.requestedAt)).toEqual(
      days
        .slice(0, ADMIN_DASHBOARD_RECENT_RUN_LIMIT)
        .map((day) => at(day).toISOString())
    );
  });

  it('reports a queue per chain, including the chain whose queue is empty', async () => {
    await newEntry(CHAIN_A, SourceEntryStatus.CANDIDATE);
    await newEntry(CHAIN_A, SourceEntryStatus.CANDIDATE);
    await newEntry(CHAIN_A, SourceEntryStatus.UNRESOLVED);
    // Neither of these waits for anybody, so neither belongs in a queue count.
    await newEntry(CHAIN_A, SourceEntryStatus.ACTIVE);
    await newEntry(CHAIN_A, SourceEntryStatus.REJECTED);

    const block = await dashboard.dashboard(REQUEST);

    // The chain with nothing queued is the row a `GROUP BY` cannot produce, and
    // it is the one that matters: a queue emptying must not make its chain
    // vanish from the screen.
    expect(block.queues.entries).toEqual([
      { supermarketId: CHAIN_A, candidate: 2, unresolved: 1 },
      { supermarketId: CHAIN_B, candidate: 0, unresolved: 0 },
    ]);
  });

  it('reports the shop queue per chain and the places nobody has imported', async () => {
    await newShop(CHAIN_A, SourceLocationStatus.UNMAPPED);
    await newShop(CHAIN_A, SourceLocationStatus.UNMAPPED);
    await newShop(CHAIN_A, SourceLocationStatus.ACTIVE);
    await newShop(CHAIN_B, SourceLocationStatus.ACTIVE);
    await newPlace(DiscoveredPlaceStatus.NEW);
    await newPlace(DiscoveredPlaceStatus.NEW);
    await newPlace(DiscoveredPlaceStatus.IMPORTED);
    await newPlace(DiscoveredPlaceStatus.REJECTED);

    const block = await dashboard.dashboard(REQUEST);

    expect(block.queues.shops).toEqual([
      { supermarketId: CHAIN_A, unmapped: 2 },
      { supermarketId: CHAIN_B, unmapped: 0 },
    ]);
    // A run creates nothing in catalog, so every place it saw waits here until
    // somebody imports or rejects it.
    expect(block.queues.places).toBe(2);
  });

  it('counts the chains it knows and how many may be fetched', async () => {
    const block = await dashboard.dashboard(REQUEST);

    // Whether a chain may be fetched is a row rather than an environment
    // variable, and off is the default, so the two numbers differ routinely.
    expect(block.sources).toEqual({ total: 2, enabled: 1 });
  });
});
