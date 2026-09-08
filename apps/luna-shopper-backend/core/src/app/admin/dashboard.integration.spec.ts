import {
  ADMIN_DASHBOARD_WINDOW_DAYS,
  GeneratedListStatus,
  MembershipStatus,
  ZoneRole,
  ZoneStatus,
  type AdminDashboardRequest,
  type AdminDashboardWindow,
  type DailyCount,
} from '@portfolio/luna-shopper/contracts';
import {
  describeIntegration,
  requiredEnv,
} from '@portfolio/luna-shopper/test-fixtures/jest';
import { DataSource, Repository } from 'typeorm';
import { CoreAuditService } from '../audit/core-audit.service';
import { CORE_MIGRATIONS } from '../db/migrations';
import {
  CORE_ENTITIES,
  CoreAudit,
  GeneratedList,
  ShoppingList,
  Zone,
  ZoneMembership,
} from '../entities';
import { CoreDashboardService } from './dashboard.service';
import { CorePlatformAdminService } from './platform-admin.service';

/**
 * Core's dashboard block against real Postgres (plan 0088, section 7).
 *
 * **The counts are SQL and nothing else.** Every number is a
 * `count(*) FILTER (WHERE ...)` and the two series are a `GROUP BY` over a
 * `date_trunc`, so a fake repository would only assert that the spec's own
 * arithmetic agrees with itself. What is worth proving is that the filters name
 * columns Postgres has, that the grouping buckets a timestamp on the day the
 * window means, and that a table holding two rows still answers a full window.
 *
 * The window is a fixed pair of days rather than one derived from today, so a
 * zone seeded on the first day of the window stays on the first day of the
 * window whenever the suite runs.
 *
 * It works in a scratch schema of its own and drops it afterwards, so it never
 * touches the developer's own core data.
 *
 *   bash k8s/e2e/luna-shopper-backend/luna-slot.sh --up
 *   LUNA_INTEGRATION=1 CORE_DB_URL=postgres://luna_core:luna_core@localhost:<port>/luna_core \
 *     npx nx run luna-shopper-backend-core:test-integration
 */
const SCHEMA = 'plan0088_core_dashboard_test';

/** An `admin_users.id` from auth's database, which core never resolves. */
const OPERATOR = '33333333-3333-4333-8333-333333333333';
/** A `users.id`. Core references people by opaque id and stores no auth data. */
const MEMBER = '44444444-4444-4444-8444-444444444444';

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
const MIDDLE_DAY = shiftDay(WINDOW.to, -12);

const REQUEST: AdminDashboardRequest = {
  userId: OPERATOR,
  adminToken: 'stub',
  window: WINDOW,
};

describeIntegration('core’s dashboard block (real Postgres)', () => {
  let dataSource: DataSource;
  let dashboard: CoreDashboardService;
  let audit: CoreAuditService;
  let zones: Repository<Zone>;
  let memberships: Repository<ZoneMembership>;
  let lists: Repository<ShoppingList>;
  let baskets: Repository<GeneratedList>;
  let trail: Repository<CoreAudit>;

  beforeAll(async () => {
    const url = requiredEnv('CORE_DB_URL');

    const bootstrap = new DataSource({ type: 'postgres', url });
    await bootstrap.initialize();
    await bootstrap.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
    await bootstrap.query(`CREATE SCHEMA "${SCHEMA}"`);
    await bootstrap.destroy();

    dataSource = new DataSource({
      type: 'postgres',
      url,
      schema: SCHEMA,
      entities: CORE_ENTITIES,
      migrations: CORE_MIGRATIONS,
      synchronize: false,
      // The migrations are raw SQL naming unqualified tables, so the scratch
      // schema has to be on the connection's search_path. `public` follows it
      // for the extensions they use.
      extra: { options: `-c search_path=${SCHEMA},public` },
    });
    await dataSource.initialize();
    await dataSource.runMigrations();

    zones = dataSource.getRepository(Zone);
    memberships = dataSource.getRepository(ZoneMembership);
    lists = dataSource.getRepository(ShoppingList);
    baskets = dataSource.getRepository(GeneratedList);
    trail = dataSource.getRepository(CoreAudit);

    audit = new CoreAuditService(dataSource);
    // The gate has its own specs and needs a keypair. Here it stands for a
    // request that already carried a live operator token, so the block under
    // test is the counting rather than the signature check.
    const gate = {
      requireAdmin: jest.fn(async () => OPERATOR),
    } as unknown as CorePlatformAdminService;

    dashboard = new CoreDashboardService(
      zones,
      memberships,
      lists,
      baskets,
      gate,
      audit
    );
  }, 120_000);

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
      await dataSource.destroy();
    }
  });

  beforeEach(async () => {
    // Children before parents: a zone is referenced by both of the tables above
    // it, and neither cascade is worth relying on for a fixture reset.
    for (const repository of [memberships, lists, baskets, trail, zones]) {
      await repository.createQueryBuilder().delete().execute();
    }
  });

  let seq = 0;

  async function newZone(status = ZoneStatus.ACTIVE): Promise<Zone> {
    seq += 1;
    return zones.save(
      zones.create({
        name: `Flat ${seq}`,
        joinCode: `CODE${String(seq).padStart(3, '0')}`,
        status,
        ownerUserId: MEMBER,
        config: {},
        markedForDeletionAt:
          status === ZoneStatus.MARKED_FOR_DELETION ? at(MIDDLE_DAY) : null,
      })
    );
  }

  async function newList(zone: Zone): Promise<ShoppingList> {
    seq += 1;
    return lists.save(
      lists.create({
        zoneId: zone.id,
        name: `Weekly shop ${seq}`,
        createdByUserId: MEMBER,
      })
    );
  }

  async function newBasket(
    status: GeneratedListStatus
  ): Promise<GeneratedList> {
    return baskets.save(
      baskets.create({
        ownerUserId: MEMBER,
        name: null,
        status,
        generatedAt: at(MIDDLE_DAY),
        sourceSnapshot: {
          profileId: null,
          pricingProfileId: null,
          sources: [],
        },
        defaultTargetListId: null,
        idempotencyKey: null,
      })
    );
  }

  /**
   * Every day the series names, and the count on each, with the days that hold
   * nothing left out of the comparison object rather than out of the series.
   */
  function expectSeries(
    points: DailyCount[],
    counts: Record<string, number>
  ): void {
    expect(points).toHaveLength(ADMIN_DASHBOARD_WINDOW_DAYS);
    expect(points[0].day).toBe(WINDOW.from);
    expect(points[points.length - 1].day).toBe(WINDOW.to);
    expect(
      Object.fromEntries(
        points
          .filter((point) => point.count > 0)
          .map((point) => [point.day, point.count])
      )
    ).toEqual(counts);
  }

  it('refuses to count anything the gate did not let through', async () => {
    const refused = new Error('that operator token was not accepted');
    const closed = new CoreDashboardService(
      zones,
      memberships,
      lists,
      baskets,
      {
        requireAdmin: jest.fn(async () => {
          throw refused;
        }),
      } as unknown as CorePlatformAdminService,
      audit
    );

    // An operator has no membership in the household they are looking at, so
    // the token is the only thing standing between them and it.
    await expect(closed.dashboard(REQUEST)).rejects.toBe(refused);
  });

  it('splits the zones by status and counts the join requests waiting', async () => {
    const flat = await newZone();
    await newZone();
    await newZone(ZoneStatus.MARKED_FOR_DELETION);
    for (const status of [
      MembershipStatus.PENDING,
      MembershipStatus.PENDING,
      MembershipStatus.APPROVED,
    ]) {
      seq += 1;
      await memberships.save(
        memberships.create({
          zoneId: flat.id,
          userId: `5555555${seq}-5555-4555-8555-555555555555`,
          username: `Ana ${seq}`,
          role: ZoneRole.MEMBER,
          status,
          approvedByUserId: null,
        })
      );
    }

    const block = await dashboard.dashboard(REQUEST);

    expect(block.zones).toEqual({ total: 3, active: 2, markedForDeletion: 1 });
    // Work waiting rather than a total, which is why it is reported on its own:
    // the screen links it to the memberships list filtered to pending.
    expect(block.memberships).toEqual({ pending: 2 });
  });

  it('counts the baskets by the two statuses one is ever in', async () => {
    await newBasket(GeneratedListStatus.DRAFT);
    await newBasket(GeneratedListStatus.DRAFT);
    await newBasket(GeneratedListStatus.COMPLETED);
    // The row that makes `total` worth sending rather than deriving from the
    // two: `ACTIVE` is never written, so the live basket is `DRAFT`, and the two
    // reported statuses fall short of the total exactly when this row exists.
    await newBasket(GeneratedListStatus.ARCHIVED);

    const block = await dashboard.dashboard(REQUEST);

    expect(block.baskets).toEqual({ total: 4, draft: 2, completed: 1 });
  });

  it('fills both windows from tables holding two rows each', async () => {
    const first = await newZone();
    await zones.update(first.id, { createdAt: at(WINDOW.from) });
    const second = await newZone();
    await zones.update(second.id, { createdAt: at(WINDOW.to) });

    const early = await newList(first);
    await lists.update(early.id, { createdAt: at(MIDDLE_DAY) });
    const late = await newList(first);
    await lists.update(late.id, { createdAt: at(WINDOW.to) });

    const block = await dashboard.dashboard(REQUEST);

    expectSeries(block.zonesCreated, { [WINDOW.from]: 1, [WINDOW.to]: 1 });
    expectSeries(block.listsCreated, { [MIDDLE_DAY]: 1, [WINDOW.to]: 1 });
    expect(block.lists).toEqual({ total: 2 });
  });

  it('adds two rows on one day together and drops one before the window', async () => {
    const zone = await newZone();
    await zones.update(zone.id, { createdAt: at(shiftDay(WINDOW.from, -1)) });
    const inside = await newZone();
    await zones.update(inside.id, { createdAt: at(MIDDLE_DAY) });
    const alongside = await newZone();
    await zones.update(alongside.id, { createdAt: at(MIDDLE_DAY) });

    const block = await dashboard.dashboard(REQUEST);

    // The chart is drawn over the axis the gateway named, and the count of
    // every zone that exists is `zones.total` beside it.
    expectSeries(block.zonesCreated, { [MIDDLE_DAY]: 2 });
    expect(block.zones.total).toBe(3);
  });

  it('answers the newest rows of its own trail as the activity feed', async () => {
    const zone = await audit.write(OPERATOR, (tx) =>
      tx.create(
        Zone,
        zones.create({
          name: 'Shared house',
          joinCode: 'AUDIT1',
          status: ZoneStatus.ACTIVE,
          ownerUserId: MEMBER,
          config: {},
          markedForDeletionAt: null,
        })
      )
    );

    const block = await dashboard.dashboard(REQUEST);

    expect(block.activity).toHaveLength(1);
    expect(block.activity[0]).toMatchObject({
      actorId: OPERATOR,
      actorKind: 'ADMIN',
      entity: 'zones',
      entityId: zone.id,
      action: 'CREATE',
    });
    // The changed fields stay in the table. A feed of twenty of them is a
    // screen nobody asked for.
    expect(block.activity[0]).not.toHaveProperty('after');
  });
});
