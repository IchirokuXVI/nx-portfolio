import {
  ADMIN_DASHBOARD_WINDOW_DAYS,
  UserKind,
  type AdminDashboardRequest,
  type AdminDashboardWindow,
  type DailyCount,
} from '@portfolio/luna-shopper/contracts';
import {
  describeIntegration,
  requiredEnv,
} from '@portfolio/luna-shopper/test-fixtures/jest';
import { DataSource, Repository } from 'typeorm';
import { AuthAuditService } from '../audit/auth-audit.service';
import { AUTH_MIGRATIONS } from '../db/migrations';
import {
  AUTH_ENTITIES,
  AdminLoginFailure,
  AdminUser,
  AuthAudit,
  User,
} from '../entities';
import { AuthDashboardService } from './dashboard.service';
import { AuthPlatformAdminService } from './platform-admin.service';

/**
 * Auth's dashboard block against real Postgres (plan 0088, section 7).
 *
 * **The counts are SQL and nothing else.** Every number in this block is a
 * `count(*) FILTER (WHERE ...)` and the sign ups are a `GROUP BY` over a
 * `date_trunc`, so a fake repository would be asserting that the spec's own
 * arithmetic agrees with itself. What is worth proving is that the filters name
 * columns Postgres has, that the grouping buckets a timestamp on the day the
 * window means, and that a table holding two rows still answers a full window.
 *
 * The window is a fixed pair of days rather than one derived from today, so a
 * row seeded on the first day of the window stays on the first day of the window
 * whenever the suite runs.
 *
 * It works in a scratch schema of its own and drops it afterwards, so it never
 * touches the developer's own auth data.
 *
 *   bash k8s/e2e/luna-shopper-backend/luna-slot.sh --up
 *   LUNA_INTEGRATION=1 AUTH_DB_URL=postgres://luna_auth:luna_auth@localhost:<port>/luna_auth \
 *     npx nx run luna-shopper-backend-auth:test-integration
 */
const SCHEMA = 'plan0088_auth_dashboard_test';

/** The admin the stub gate lets through, and the actor on the trail row. */
const OPERATOR = '33333333-3333-4333-8333-333333333333';

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

const HOUR_MS = 60 * 60 * 1000;

describeIntegration('auth’s dashboard block (real Postgres)', () => {
  let dataSource: DataSource;
  let dashboard: AuthDashboardService;
  let audit: AuthAuditService;
  let users: Repository<User>;
  let admins: Repository<AdminUser>;
  let failures: Repository<AdminLoginFailure>;
  let trail: Repository<AuthAudit>;

  beforeAll(async () => {
    const url = requiredEnv('AUTH_DB_URL');

    const bootstrap = new DataSource({ type: 'postgres', url });
    await bootstrap.initialize();
    await bootstrap.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
    await bootstrap.query(`CREATE SCHEMA "${SCHEMA}"`);
    await bootstrap.destroy();

    dataSource = new DataSource({
      type: 'postgres',
      url,
      schema: SCHEMA,
      entities: AUTH_ENTITIES,
      migrations: AUTH_MIGRATIONS,
      synchronize: false,
      // The migrations are raw SQL naming unqualified tables, so the scratch
      // schema has to be on the connection's search_path. `public` follows it
      // for the extensions they use.
      extra: { options: `-c search_path=${SCHEMA},public` },
    });
    await dataSource.initialize();
    await dataSource.runMigrations();

    users = dataSource.getRepository(User);
    admins = dataSource.getRepository(AdminUser);
    failures = dataSource.getRepository(AdminLoginFailure);
    trail = dataSource.getRepository(AuthAudit);

    audit = new AuthAuditService(dataSource);
    // The gate has its own specs and needs a keypair. Here it stands for a
    // request that already carried a live operator token, so the block under
    // test is the counting rather than the signature check.
    const gate = {
      requireAdmin: jest.fn(async () => OPERATOR),
    } as unknown as AuthPlatformAdminService;

    dashboard = new AuthDashboardService(
      users,
      admins,
      failures,
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
    for (const repository of [users, admins, failures, trail]) {
      await repository.createQueryBuilder().delete().execute();
    }
  });

  /** A distinct address per row: `uq_users_email` is unique where it is set. */
  let seq = 0;
  function nextEmail(): string {
    seq += 1;
    return `person${seq}@example.com`;
  }

  async function newUser(kind: UserKind, verified: boolean): Promise<User> {
    return users.save(
      users.create({
        kind,
        email: kind === UserKind.REGISTERED ? nextEmail() : null,
        emailVerifiedAt: verified ? new Date('2026-06-15T09:00:00.000Z') : null,
        displayName: null,
        username: `Sailor ${seq}`,
      })
    );
  }

  /** Put a row's creation on a chosen day. `createdAt` is written on insert. */
  async function createdOn(user: User, day: string): Promise<void> {
    await users.update(user.id, { createdAt: at(day) });
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
    const closed = new AuthDashboardService(
      users,
      admins,
      failures,
      {
        requireAdmin: jest.fn(async () => {
          throw refused;
        }),
      } as unknown as AuthPlatformAdminService,
      audit
    );

    // Auth's directory is the one thing on this dashboard that would be worth
    // reading without a token, so the check runs before the first query rather
    // than beside it.
    await expect(closed.dashboard(REQUEST)).rejects.toBe(refused);
  });

  it('splits the directory by kind and by confirmation', async () => {
    const confirmed = await newUser(UserKind.REGISTERED, true);
    await newUser(UserKind.REGISTERED, false);
    await newUser(UserKind.TEMPORARY, false);
    // A temporary user has no address to confirm, so `verified` counting the
    // column on its own would answer the same number by a different question.
    // This row proves the kind is part of the filter.
    await users.update(
      (await newUser(UserKind.TEMPORARY, false)).id,
      { emailVerifiedAt: at(MIDDLE_DAY) }
    );

    const block = await dashboard.dashboard(REQUEST);

    expect(block.users).toEqual({
      total: 4,
      registered: 2,
      temporary: 2,
      verified: 1,
    });
    expect(confirmed.emailVerifiedAt).not.toBeNull();
  });

  it('counts the operator accounts and how many are revoked', async () => {
    await admins.save(
      admins.create({
        username: 'owner',
        passwordHash: 'argon2',
        displayName: 'The owner',
        disabledAt: null,
        lastLoginAt: null,
      })
    );
    await admins.save(
      admins.create({
        username: 'former',
        passwordHash: 'argon2',
        displayName: null,
        // Revoked rather than deleted, because the id is the actor on every
        // audit row the account ever wrote.
        disabledAt: at(MIDDLE_DAY),
        lastLoginAt: null,
      })
    );

    const block = await dashboard.dashboard(REQUEST);

    expect(block.admins).toEqual({ total: 2, disabled: 1 });
  });

  it('fills the whole window from a table holding two sign ups', async () => {
    await createdOn(await newUser(UserKind.REGISTERED, false), WINDOW.from);
    await createdOn(await newUser(UserKind.REGISTERED, false), WINDOW.to);

    const block = await dashboard.dashboard(REQUEST);

    expectSeries(block.signUps, { [WINDOW.from]: 1, [WINDOW.to]: 1 });
  });

  it('adds two sign ups on one day together and leaves a guest out', async () => {
    await createdOn(await newUser(UserKind.REGISTERED, false), MIDDLE_DAY);
    await createdOn(await newUser(UserKind.REGISTERED, true), MIDDLE_DAY);
    // A temporary user is a guest a zone link created, and counting one as a
    // sign up would draw a chart of link clicks.
    await createdOn(await newUser(UserKind.TEMPORARY, false), WINDOW.from);

    const block = await dashboard.dashboard(REQUEST);

    expectSeries(block.signUps, { [MIDDLE_DAY]: 2 });
  });

  it('leaves a sign up older than the window out of the series', async () => {
    await createdOn(
      await newUser(UserKind.REGISTERED, false),
      shiftDay(WINDOW.from, -1)
    );
    await createdOn(await newUser(UserKind.REGISTERED, false), WINDOW.from);

    const block = await dashboard.dashboard(REQUEST);

    // The chart is drawn over the axis the gateway named, and the count of
    // everybody registered is `users.registered` beside it.
    expectSeries(block.signUps, { [WINDOW.from]: 1 });
    expect(block.users.registered).toBe(2);
  });

  it('counts failed operator logins over two spans and names the newest', async () => {
    const now = Date.now();
    const spans: [string, number][] = [
      ['owner', 2 * HOUR_MS],
      ['0wner', 3 * 24 * HOUR_MS],
      ['admin', 10 * 24 * HOUR_MS],
    ];
    for (const [username, ago] of spans) {
      const row = await failures.save(
        failures.create({
          username,
          ip: '203.0.113.7',
          userAgent: 'curl/8.4.0',
        })
      );
      await failures.update(row.id, { createdAt: new Date(now - ago) });
    }

    const block = await dashboard.dashboard(REQUEST);

    // Measured from now rather than from the window, because "was somebody
    // guessing at a password last night" is not a question about thirty days.
    expect(block.loginFailures.last24h).toBe(1);
    expect(block.loginFailures.last7d).toBe(2);
    expect(block.loginFailures.recent.map((row) => row.username)).toEqual([
      'owner',
      '0wner',
      'admin',
    ]);
    // Stored on the row and deliberately not sent: 512 characters that tell an
    // operator reading a tile nothing.
    expect(block.loginFailures.recent[0]).not.toHaveProperty('userAgent');
    expect(block.loginFailures.recent[0].ip).toBe('203.0.113.7');
  });

  it('answers the newest rows of its own trail as the activity feed', async () => {
    const user = await audit.write(OPERATOR, (tx) =>
      tx.create(
        User,
        users.create({
          kind: UserKind.REGISTERED,
          email: nextEmail(),
          emailVerifiedAt: null,
          displayName: null,
          username: 'Vela Rápida',
        })
      )
    );

    const block = await dashboard.dashboard(REQUEST);

    expect(block.activity).toHaveLength(1);
    expect(block.activity[0]).toMatchObject({
      actorId: OPERATOR,
      actorKind: 'ADMIN',
      entity: 'users',
      entityId: user.id,
      action: 'CREATE',
    });
    // The changed fields stay in the table. A feed of twenty of them is a
    // screen nobody asked for.
    expect(block.activity[0]).not.toHaveProperty('after');
  });
});
