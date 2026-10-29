import {
  describeIntegration,
  requiredEnv,
} from '@portfolio/luna-shopper/test-fixtures/jest';
import { DataSource, type QueryRunner } from 'typeorm';
import { AUTH_MIGRATIONS } from '../db/migrations';
import { AUTH_ENTITIES } from '../entities';
import type { RetentionConfig } from './retention-config';
import {
  RetentionSweepService,
  type RetentionResult,
} from './retention-sweep.service';

/**
 * The retention sweep of auth against real Postgres (plan 0233, section 7).
 *
 * What only a database can answer: that each statement deletes exactly the
 * rows past the cutoff of its table and leaves a row one minute younger,
 * that a support session takes its refresh tokens with it by cascade, that a
 * sweep passes by a row another transaction holds instead of waiting for it
 * (the `SKIP LOCKED` that lets two replicas sweep at once), that two sweeps
 * started together both finish and delete each row once, and that the
 * migration's indexes are the ones the entities name.
 *
 * The held row is what proves the clause. Two sweeps started together may
 * still run their batches one after the other, so on their own they would
 * pass with a plain `FOR UPDATE` too.
 *
 * It works in a scratch schema of its own and drops it afterwards.
 *
 *   bash k8s/e2e/luna-shopper-backend/luna-slot.sh --ephemeral --up <n> --services auth
 *   LUNA_INTEGRATION=1 AUTH_DB_URL=postgres://luna_auth:luna_auth@localhost:<port>/luna_auth \
 *     npx nx run luna-shopper-backend-auth:test-integration --testFile=retention-sweep.integration
 */
const SCHEMA = 'plan0233_retention_test';

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;
const NOW = new Date();

const CONFIG: RetentionConfig = {
  auditMs: 180 * DAY,
  adminLoginFailuresMs: 90 * DAY,
  expiredGrantsMs: 14 * DAY,
  sweep: {
    enabled: true,
    intervalMs: 60 * MINUTE,
    batchSize: 1000,
    maxBatches: 50,
  },
};

/** The eight indexes of `1773300000000-RetentionIndexes`. */
const INDEXES = [
  'ix_refresh_tokens_replaced_by',
  'ix_refresh_tokens_expires_at',
  'ix_password_resets_expires_at',
  'ix_email_verifications_expires_at',
  'ix_oauth_states_expires_at',
  'ix_oauth_handoffs_expires_at',
  'ix_impersonation_sessions_expires_at',
  'ix_admin_login_failures_created',
];

/**
 * Fails when `work` has not settled within `ms`. A sweep that waited for a
 * locked row would hang here; `SKIP LOCKED` passes the row by.
 */
function within<T>(ms: number, work: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`the sweeps still waited after ${ms} ms`)),
      ms
    );
  });
  return Promise.race([work, late]).finally(() => clearTimeout(timer));
}

/** One minute past the cutoff of a period, and one minute short of it. */
function around(retainMs: number): { old: Date; young: Date } {
  const cutoff = NOW.getTime() - retainMs;
  return {
    old: new Date(cutoff - MINUTE),
    young: new Date(cutoff + MINUTE),
  };
}

describeIntegration('the auth retention sweep (real Postgres)', () => {
  let dataSource: DataSource;
  let userId: string;

  const logger = { log: jest.fn(), error: jest.fn() };

  function sweeper(config: RetentionConfig): RetentionSweepService {
    return new RetentionSweepService(
      dataSource,
      logger as never,
      { getOrThrow: () => ({ retention: config }) } as never
    );
  }

  async function one(sql: string, params: unknown[]): Promise<string> {
    const rows = (await dataSource.query(sql, params)) as Array<{ id: string }>;
    return rows[0].id;
  }

  async function ids(table: string): Promise<string[]> {
    const rows = (await dataSource.query(
      `SELECT "id" FROM "${table}"`
    )) as Array<{ id: string }>;
    return rows.map((r) => r.id).sort();
  }

  /** Locks the oldest row of `table` in `holder`'s open transaction. */
  async function holdOldest(
    holder: QueryRunner,
    table: string,
    column: string
  ): Promise<string> {
    const rows = (await holder.query(
      `SELECT "id" FROM "${table}" ORDER BY "${column}" LIMIT 1 FOR UPDATE`
    )) as Array<{ id: string }>;
    return rows[0].id;
  }

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
      extra: { options: `-c search_path=${SCHEMA},public` },
    });
    await dataSource.initialize();
    await dataSource.runMigrations();

    userId = await one(
      `INSERT INTO "users" ("kind", "username") VALUES ('TEMPORARY', 'retention-sweep') RETURNING "id"`,
      []
    );
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
      await dataSource.destroy();
    }
  });

  beforeEach(async () => {
    await dataSource.query(
      `TRUNCATE "auth_audit", "admin_login_failures", "refresh_tokens", "password_resets", "email_verifications", "oauth_states", "oauth_handoffs", "impersonation_sessions"`
    );
    logger.log.mockClear();
    logger.error.mockClear();
  });

  it('creates the indexes the entities name', async () => {
    const rows = (await dataSource.query(
      `SELECT "indexname" FROM pg_indexes WHERE "schemaname" = $1 AND "indexname" = ANY($2)`,
      [SCHEMA, INDEXES]
    )) as Array<{ indexname: string }>;
    expect(rows.map((r) => r.indexname).sort()).toEqual([...INDEXES].sort());

    // TypeORM would add or drop an index the entities and the schema
    // disagree on. None of these may be in what it would do.
    const pending = await dataSource.driver.createSchemaBuilder().log();
    const statements = pending.upQueries.map((q) => q.query).join('\n');
    for (const name of INDEXES) {
      expect(statements).not.toContain(name);
    }

    // Only a rotated row has a successor, so the successor's index is partial.
    const [successor] = (await dataSource.query(
      `SELECT "indexdef" FROM pg_indexes WHERE "schemaname" = $1 AND "indexname" = 'ix_refresh_tokens_replaced_by'`,
      [SCHEMA]
    )) as Array<{ indexdef: string }>;
    expect(successor.indexdef).toContain('WHERE ("replacedById" IS NOT NULL)');
  });

  it('deletes each row past its lifetime and keeps a row one minute younger', async () => {
    const audit = around(CONFIG.auditMs);
    const failures = around(CONFIG.adminLoginFailuresMs);
    const grants = around(CONFIG.expiredGrantsMs);

    await one(
      `INSERT INTO "auth_audit" ("actorId", "actorKind", "entity", "entityId", "action", "at")
       VALUES (gen_random_uuid(), 'ADMIN', 'users', $1, 'UPDATE', $2) RETURNING "id"`,
      [userId, audit.old]
    );
    const auditYoung = await one(
      `INSERT INTO "auth_audit" ("actorId", "actorKind", "entity", "entityId", "action", "at")
       VALUES (gen_random_uuid(), 'ADMIN', 'users', $1, 'UPDATE', $2) RETURNING "id"`,
      [userId, audit.young]
    );

    const session = (expiresAt: Date, endedAt: Date | null) =>
      one(
        `INSERT INTO "impersonation_sessions"
           ("adminId", "userId", "reason", "expiresAt", "endedAt", "codeHash", "codeExpiresAt")
         VALUES (gen_random_uuid(), $1, 'SUPPORT_REQUEST', $2, $3, gen_random_uuid()::text, $2)
         RETURNING "id"`,
        [userId, expiresAt, endedAt]
      );
    const sessionOld = await session(audit.old, audit.old);
    const sessionYoung = await session(audit.young, null);

    const failure = (at: Date) =>
      one(
        `INSERT INTO "admin_login_failures" ("username", "ip", "userAgent", "createdAt")
         VALUES ('root', '203.0.113.9', 'curl', $1) RETURNING "id"`,
        [at]
      );
    await failure(failures.old);
    const failureYoung = await failure(failures.young);

    const token = (expiresAt: Date, sessionId: string | null = null) =>
      one(
        `INSERT INTO "refresh_tokens" ("userId", "tokenHash", "expiresAt", "impersonationSessionId")
         VALUES ($1, gen_random_uuid()::text, $2, $3) RETURNING "id"`,
        [userId, expiresAt, sessionId]
      );
    await token(grants.old);
    const tokenYoung = await token(grants.young);
    // Still inside the grant lifetime, but its session is past the audit
    // lifetime: it goes by cascade.
    await token(grants.young, sessionOld);
    const tokenOfYoungSession = await token(grants.young, sessionYoung);

    const grant = (table: string, expiresAt: Date) =>
      one(
        `INSERT INTO "${table}" ("userId", "tokenHash", "expiresAt")
         VALUES ($1, gen_random_uuid()::text, $2) RETURNING "id"`,
        [userId, expiresAt]
      );
    await grant('password_resets', grants.old);
    const resetYoung = await grant('password_resets', grants.young);
    await grant('email_verifications', grants.old);
    const verificationYoung = await grant('email_verifications', grants.young);
    await grant('oauth_states', grants.old);
    const stateYoung = await grant('oauth_states', grants.young);

    // A Google sign in from scratch: no user, so no cascade would ever take it,
    // and a redeemed one keeps its row with `consumedAt` set.
    const handoff = (expiresAt: Date) =>
      one(
        `INSERT INTO "oauth_handoffs"
           ("userId", "providerUserId", "email", "displayName", "codeChallenge", "tokenHash", "expiresAt", "consumedAt")
         VALUES (NULL, gen_random_uuid()::text, 'person@example.org', 'Example Person',
                 gen_random_uuid()::text, gen_random_uuid()::text, $1, $1)
         RETURNING "id"`,
        [expiresAt]
      );
    await handoff(grants.old);
    const handoffYoung = await handoff(grants.young);

    const results = await sweeper(CONFIG).sweep(NOW);

    expect(results).toEqual([
      { table: 'auth_audit', deleted: 1, failed: false },
      { table: 'impersonation_sessions', deleted: 1, failed: false },
      { table: 'admin_login_failures', deleted: 1, failed: false },
      { table: 'refresh_tokens', deleted: 1, failed: false },
      { table: 'password_resets', deleted: 1, failed: false },
      { table: 'email_verifications', deleted: 1, failed: false },
      { table: 'oauth_states', deleted: 1, failed: false },
      { table: 'oauth_handoffs', deleted: 1, failed: false },
    ]);
    expect(await ids('auth_audit')).toEqual([auditYoung]);
    expect(await ids('impersonation_sessions')).toEqual([sessionYoung]);
    expect(await ids('admin_login_failures')).toEqual([failureYoung]);
    expect(await ids('refresh_tokens')).toEqual(
      [tokenYoung, tokenOfYoungSession].sort()
    );
    expect(await ids('password_resets')).toEqual([resetYoung]);
    expect(await ids('email_verifications')).toEqual([verificationYoung]);
    expect(await ids('oauth_states')).toEqual([stateYoung]);
    expect(await ids('oauth_handoffs')).toEqual([handoffYoung]);
    expect(logger.error).not.toHaveBeenCalled();

    // A second sweep at the same instant finds nothing.
    const again = await sweeper(CONFIG).sweep(NOW);
    expect(again.every((r) => r.deleted === 0 && !r.failed)).toBe(true);
  });

  it('passes a held row by, and lets two sweeps at once both finish and delete each row once', async () => {
    const { old } = around(CONFIG.expiredGrantsMs);
    const auditOld = around(CONFIG.auditMs).old;
    await dataSource.query(
      `INSERT INTO "refresh_tokens" ("userId", "tokenHash", "expiresAt")
       SELECT $1, 'bulk-' || n, $2::timestamptz - n * interval '1 second'
       FROM generate_series(1, 2500) AS n`,
      [userId, old]
    );
    await dataSource.query(
      `INSERT INTO "auth_audit" ("actorId", "actorKind", "entity", "entityId", "action", "at")
       SELECT gen_random_uuid(), 'ADMIN', 'users', $1, 'UPDATE', $2::timestamptz - n * interval '1 second'
       FROM generate_series(1, 2500) AS n`,
      [userId, auditOld]
    );
    const tables = [
      { table: 'refresh_tokens', column: 'expiresAt' },
      { table: 'auth_audit', column: 'at' },
    ];

    const small = { ...CONFIG, sweep: { ...CONFIG.sweep, batchSize: 500 } };

    // A third transaction holds the oldest row of each table, as the batch
    // of another replica would. Both sweeps must finish while it is held.
    const holder = dataSource.createQueryRunner();
    await holder.connect();
    await holder.startTransaction();
    try {
      const held: string[] = [];
      for (const { table, column } of tables) {
        held.push(await holdOldest(holder, table, column));
      }

      const [first, second]: RetentionResult[][] = await within(
        10_000,
        Promise.all([sweeper(small).sweep(NOW), sweeper(small).sweep(NOW)])
      );

      for (const [i, { table }] of tables.entries()) {
        const a = first.find((r) => r.table === table);
        const b = second.find((r) => r.table === table);
        expect(a?.failed).toBe(false);
        expect(b?.failed).toBe(false);
        expect((a?.deleted ?? 0) + (b?.deleted ?? 0)).toBe(2499);
        expect(await ids(table)).toEqual([held[i]]);
      }
      expect([...first, ...second].every((r) => !r.failed)).toBe(true);
    } finally {
      await holder.rollbackTransaction();
      await holder.release();
    }

    // Released, the held rows go on the next sweep.
    const after = await sweeper(small).sweep(NOW);
    for (const { table } of tables) {
      expect(after.find((r) => r.table === table)?.deleted).toBe(1);
      expect(await ids(table)).toEqual([]);
    }
    expect(logger.error).not.toHaveBeenCalled();
  }, 30_000);
});
