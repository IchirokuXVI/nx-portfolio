import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  ImpersonationReason,
  UserKind,
  type AccessTokenClaims,
  type AuthTokens,
} from '@portfolio/luna-shopper/contracts';
import { ERROR_CODES } from '@portfolio/luna-shopper/platform';
import {
  describeIntegration,
  requiredEnv,
} from '@portfolio/luna-shopper/test-fixtures/jest';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { DataSource, IsNull, type Repository } from 'typeorm';
import { AuthAuditService } from '../audit/auth-audit.service';
import { AUTH_MIGRATIONS } from '../db/migrations';
import { AdminUser, AUTH_ENTITIES, RefreshToken, User } from '../entities';
import { IdentityService } from '../identity/identity.service';
import { ImpersonationService } from '../impersonation/impersonation.service';
import { UsernameGenerator } from '../username/username-generator.service';
import { TokenGrantService } from './token-grant.service';
import { REFRESH_RETRY_FLOOR_MS, TokenService } from './token.service';

/**
 * The rotation of a refresh token against real Postgres (plan 0229, section
 * 4.1).
 *
 * What only a database can answer: that one conditional `UPDATE` lets exactly
 * one of ten presentations at the same instant pass, that a retry after a lost
 * answer obtains a pair inside the grace and that the grace is judged on the
 * clock of the database, that a reset stays final, and that a failure after
 * the spend rolls the spend back. A fake can only agree with itself about a
 * `WHERE` clause.
 *
 * The reason of each refusal is read from the warn line it writes, which is
 * the only place where the reasons differ.
 *
 * It works in a scratch schema of its own and drops it afterwards.
 *
 *   bash k8s/e2e/luna-shopper-backend/luna-slot.sh --ephemeral --up <n> --services auth
 *   LUNA_INTEGRATION=1 AUTH_DB_URL=postgres://luna_auth:luna_auth@localhost:<port>/luna_auth \
 *     npx nx run luna-shopper-backend-auth:test-integration --testFile=token-rotation.integration
 */
const SCHEMA = 'plan0229_rotation_test';

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });

const hashOf = (raw: string) => createHash('sha256').update(raw).digest('hex');

describeIntegration('refresh token rotation (real Postgres)', () => {
  let dataSource: DataSource;
  let users: Repository<User>;
  let admins: Repository<AdminUser>;
  let refreshTokens: Repository<RefreshToken>;
  let tokens: TokenService;
  let impersonation: ImpersonationService;
  let identity: IdentityService;
  const jwt = new JwtService();

  /** The operator the gate verified, for the next start. */
  let operatorId: string;

  /** The reason of each warn and info line of the rotation, in order. */
  const reasons: string[] = [];

  /**
   * Each announced end of a support session, with the `endedAt` that another
   * connection read at the moment of the emit. That read sees only committed
   * rows, so it proves that the emit came after the commit.
   */
  const ended: Array<{
    event: { sessionId: string; userId: string };
    committed: Promise<Array<{ endedAt: Date | null }>>;
  }> = [];

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

    users = dataSource.getRepository(User);
    admins = dataSource.getRepository(AdminUser);
    refreshTokens = dataSource.getRepository(RefreshToken);

    const config = {
      getOrThrow: () => ({
        jwt: {
          privateKey: privateKey
            .export({ type: 'pkcs8', format: 'pem' })
            .toString(),
          kid: 'test-kid',
          accessTokenTtl: '15m',
          refreshTokenTtl: '30d',
          participantTokenTtl: '15m',
        },
        smtp: { enabled: false },
        google: { enabled: false },
        impersonation: { enabled: true },
      }),
    } as never;
    const audit = new AuthAuditService(dataSource);

    tokens = new TokenService(jwt, config, refreshTokens);
    impersonation = new ImpersonationService(
      dataSource,
      tokens,
      { requireAdmin: async () => operatorId } as never,
      audit,
      {
        impersonationEnded: (event: { sessionId: string; userId: string }) =>
          ended.push({
            event,
            committed: dataSource.query(
              `SELECT "endedAt" FROM "impersonation_sessions" WHERE "id" = $1`,
              [event.sessionId]
            ),
          }),
      } as never,
      config
    );
    identity = new IdentityService(
      dataSource,
      tokens,
      new TokenGrantService(),
      { hash: jest.fn(), verify: jest.fn() } as never,
      { sendVerificationEmail: jest.fn() } as never,
      {} as never,
      new UsernameGenerator(),
      audit,
      config,
      impersonation
    );
  }, 120_000);

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
      await dataSource.destroy();
    }
  });

  beforeEach(() => {
    reasons.length = 0;
    ended.length = 0;
    const record = (message: unknown) => {
      const reason = (message as { reason?: unknown } | null)?.reason;
      if (typeof reason === 'string') {
        reasons.push(reason);
      }
    };
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(record);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(record);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  let serial = 0;

  /** A registered account and its first pair. */
  async function person(): Promise<{ user: User; pair: AuthTokens }> {
    serial += 1;
    const user = await users.save(
      users.create({
        kind: UserKind.REGISTERED,
        username: `Person ${serial}`,
        email: `p${serial}@plan0229.test`,
      })
    );
    return { user, pair: await tokens.issueTokens(user) };
  }

  const rowOf = (raw: string) =>
    refreshTokens.findOneByOrFail({ tokenHash: hashOf(raw) });

  const refused = { code: ERROR_CODES.UNAUTHORIZED };

  /**
   * The time a client takes to notice a lost answer and present the token
   * again. A presentation sooner than the floor is a copy of the request.
   */
  const afterLostAnswer = () =>
    new Promise((resolve) => setTimeout(resolve, REFRESH_RETRY_FLOOR_MS + 50));

  describe('the migration', () => {
    it('adds a nullable replacedById that points at another row and is cleared when that row goes, and a nullable replacedAt', async () => {
      const columns = (await dataSource.query(
        `SELECT column_name, data_type, is_nullable FROM information_schema.columns
          WHERE table_schema = $1 AND table_name = 'refresh_tokens'
            AND column_name IN ('replacedById', 'replacedAt')
          ORDER BY column_name`,
        [SCHEMA]
      )) as Array<{
        column_name: string;
        data_type: string;
        is_nullable: string;
      }>;
      expect(columns).toEqual([
        {
          column_name: 'replacedAt',
          data_type: 'timestamp with time zone',
          is_nullable: 'YES',
        },
        { column_name: 'replacedById', data_type: 'uuid', is_nullable: 'YES' },
      ]);

      const { pair } = await person();
      const first = await rowOf(pair.refreshToken);
      const second = await refreshTokens.save(
        refreshTokens.create({
          userId: first.userId,
          tokenHash: hashOf(`${pair.refreshToken}-other`),
          expiresAt: first.expiresAt,
        })
      );
      await refreshTokens.update({ id: first.id }, { replacedById: second.id });
      await refreshTokens.delete({ id: second.id });
      expect((await rowOf(pair.refreshToken)).replacedById).toBeNull();
    });

    it('comes down and goes up again, and keeps every refresh row', async () => {
      const { user } = await person();
      const before = await refreshTokens.countBy({ userId: user.id });
      // Down through this migration, whatever is added after it later.
      const index = AUTH_MIGRATIONS.findIndex(
        (migration) => migration.name === 'RefreshTokenSuccessor1773000000000'
      );
      expect(index).toBeGreaterThanOrEqual(0);
      for (let step = AUTH_MIGRATIONS.length; step > index; step -= 1) {
        await dataSource.undoLastMigration();
      }
      const gone = await dataSource.query(
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema = $1 AND table_name = 'refresh_tokens'
            AND column_name IN ('replacedById', 'replacedAt')`,
        [SCHEMA]
      );
      expect(gone).toHaveLength(0);

      await dataSource.runMigrations();
      expect(await refreshTokens.countBy({ userId: user.id })).toBe(before);
    });
  });

  it('1. lets one of ten presentations at the same instant pass', async () => {
    const { user, pair } = await person();
    // Every transaction starts on a connection that is already open, so the
    // ten really begin together.
    await Promise.all(
      Array.from({ length: 10 }, () => dataSource.query('SELECT 1'))
    );

    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () => identity.refresh(pair.refreshToken))
    );

    const passed = results.filter((result) => result.status === 'fulfilled');
    const failed = results.filter(
      (result): result is PromiseRejectedResult => result.status === 'rejected'
    );
    expect(passed).toHaveLength(1);
    expect(failed).toHaveLength(9);
    for (const result of failed) {
      expect(result.reason).toMatchObject(refused);
    }
    // Each of the nine began before the winner's rotation finished: copies of
    // one request, and not retries of a lost answer.
    expect(reasons).toEqual(Array.from({ length: 9 }, () => 'in_flight'));
    const live = await refreshTokens.findBy({
      userId: user.id,
      revokedAt: IsNull(),
    });
    expect(live).toHaveLength(1);
  });

  it('2. answers the retry after a lost answer with a fresh pair', async () => {
    const { pair: r1 } = await person();

    const r2 = await identity.refresh(r1.refreshToken);
    // The answer that carried r2 is lost, and the client presents r1 again.
    await afterLostAnswer();
    const r3 = await identity.refresh(r1.refreshToken);

    expect(reasons).toEqual(['reissued']);
    expect((await rowOf(r2.refreshToken)).revokedAt).toBeInstanceOf(Date);
    const third = await rowOf(r3.refreshToken);
    expect((await rowOf(r1.refreshToken)).replacedById).toBe(third.id);
    expect(third.revokedAt).toBeNull();

    reasons.length = 0;
    await expect(identity.refresh(r2.refreshToken)).rejects.toMatchObject(
      refused
    );
    expect(reasons).toEqual(['revoked']);
    await expect(identity.refresh(r3.refreshToken)).resolves.toMatchObject({
      userId: r1.userId,
    });
  });

  it('refuses a copy of the request that comes right after the rotation', async () => {
    const { pair: r1 } = await person();
    const r2 = await identity.refresh(r1.refreshToken);
    // The rotation finishes on the clock of the database now, so the copy
    // begins one statement after it and not after whatever the test runner
    // spent between the two awaits.
    await dataSource.query(
      `UPDATE "refresh_tokens" SET "replacedAt" = clock_timestamp() WHERE "tokenHash" = $1`,
      [hashOf(r1.refreshToken)]
    );

    await expect(identity.refresh(r1.refreshToken)).rejects.toMatchObject(
      refused
    );

    expect(reasons).toEqual(['in_flight']);
    expect((await rowOf(r2.refreshToken)).revokedAt).toBeNull();
  });

  it('records the successor of an ordinary rotation on the spent row', async () => {
    const { pair: r1 } = await person();

    const r2 = await identity.refresh(r1.refreshToken);

    const spent = await rowOf(r1.refreshToken);
    const successor = await rowOf(r2.refreshToken);
    expect(spent.revokedAt).toBeInstanceOf(Date);
    expect(spent.replacedById).toBe(successor.id);
    expect(spent.replacedAt).toBeInstanceOf(Date);
    expect(spent.replacedAt?.getTime()).toBeGreaterThanOrEqual(
      spent.revokedAt?.getTime() ?? Infinity
    );
    expect(successor.revokedAt).toBeNull();
    expect(successor.replacedById).toBeNull();
    expect(successor.replacedAt).toBeNull();
  });

  it('keeps the moment of the rotation when the spent row is written again', async () => {
    const { pair: r1 } = await person();
    await identity.refresh(r1.refreshToken);
    const before = await rowOf(r1.refreshToken);

    // An ordinary entity update moves updatedAt, and must not move the moment
    // that the in_flight rule reads.
    await refreshTokens.update(
      { id: before.id },
      { expiresAt: before.expiresAt }
    );

    const after = await rowOf(r1.refreshToken);
    expect(after.updatedAt.getTime()).toBeGreaterThanOrEqual(
      before.updatedAt.getTime()
    );
    expect(after.replacedAt).toEqual(before.replacedAt);
  });

  it('refuses a third presentation after the one reissue', async () => {
    const { pair: r1 } = await person();
    await identity.refresh(r1.refreshToken);
    await afterLostAnswer();
    const r3 = await identity.refresh(r1.refreshToken);
    reasons.length = 0;

    await afterLostAnswer();
    await expect(identity.refresh(r1.refreshToken)).rejects.toMatchObject(
      refused
    );

    expect(reasons).toEqual(['reissued_before']);
    // The pair the retry got is untouched.
    expect((await rowOf(r3.refreshToken)).revokedAt).toBeNull();
  });

  it('refuses a retry that waited on the lock of a reissue whose successor it took no snapshot of', async () => {
    const { user, pair: r1 } = await person();
    const r2 = await identity.refresh(r1.refreshToken);
    const spent = await rowOf(r1.refreshToken);

    // A reissue that holds the lock of the presented row and commits late:
    // the second successor is inserted and the pointer moved, and the moment
    // is set far enough back that in_flight does not decide.
    const holder = dataSource.createQueryRunner();
    await holder.connect();
    await holder.startTransaction();
    try {
      await holder.query(
        `SELECT 1 FROM "refresh_tokens" WHERE "id" = $1 FOR UPDATE`,
        [spent.id]
      );
      await holder.query(
        `UPDATE "refresh_tokens" SET "revokedAt" = now() WHERE "tokenHash" = $1`,
        [hashOf(r2.refreshToken)]
      );
      const [inserted] = (await holder.query(
        `INSERT INTO "refresh_tokens" ("userId", "tokenHash", "expiresAt")
         VALUES ($1, $2, now() + interval '1 day') RETURNING "id"`,
        [user.id, hashOf(`${r1.refreshToken}-reissued`)]
      )) as Array<{ id: string }>;
      await holder.query(
        `UPDATE "refresh_tokens"
            SET "replacedById" = $2, "replacedAt" = clock_timestamp() - interval '1 second'
          WHERE "id" = $1`,
        [spent.id, inserted.id]
      );

      // The retry takes the snapshot of its locking read now, before the
      // commit, and waits on the lock.
      const retry = identity.refresh(r1.refreshToken).then(
        () => 'passed',
        (error: unknown) => error
      );
      for (let waited = 0; ; waited += 10) {
        const [waiting] = (await dataSource.query(
          `SELECT count(*)::int AS "n" FROM pg_stat_activity
            WHERE wait_event_type = 'Lock' AND query LIKE '%FOR UPDATE%'
              AND query LIKE '%refresh_tokens%'`
        )) as Array<{ n: number }>;
        if (waiting.n > 0) {
          break;
        }
        if (waited > 5_000) {
          throw new Error('the retry never waited on the lock');
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      await holder.commitTransaction();

      expect(await retry).toMatchObject(refused);
    } finally {
      if (holder.isTransactionActive) {
        await holder.rollbackTransaction();
      }
      await holder.release();
    }

    expect(reasons).toEqual(['reissued_before']);
    expect(
      await refreshTokens.countBy({ userId: user.id, revokedAt: IsNull() })
    ).toBe(1);
  });

  it('3. refuses a token whose successor was spent', async () => {
    const { pair: r1 } = await person();
    const r2 = await identity.refresh(r1.refreshToken);
    const r3 = await identity.refresh(r2.refreshToken);
    reasons.length = 0;

    await afterLostAnswer();
    await expect(identity.refresh(r1.refreshToken)).rejects.toMatchObject(
      refused
    );

    expect(reasons).toEqual(['successor_spent']);
    expect((await rowOf(r3.refreshToken)).revokedAt).toBeNull();
  });

  describe('4. a reset stays final', () => {
    it('refuses a live row that the reset revoked', async () => {
      const { user, pair: r1 } = await person();

      await tokens.revokeAllForUser(user.id);

      await expect(identity.refresh(r1.refreshToken)).rejects.toMatchObject(
        refused
      );
      expect(reasons).toEqual(['revoked']);
    });

    it('refuses a rotated row inside the grace when the reset revoked its successor', async () => {
      const { user, pair: r1 } = await person();
      const r2 = await identity.refresh(r1.refreshToken);

      await tokens.revokeAllForUser(user.id);
      await afterLostAnswer();

      await expect(identity.refresh(r1.refreshToken)).rejects.toMatchObject(
        refused
      );
      await expect(identity.refresh(r2.refreshToken)).rejects.toMatchObject(
        refused
      );
      expect(reasons).toEqual(['successor_spent', 'revoked']);
      const live = await refreshTokens.findBy({
        userId: user.id,
        revokedAt: IsNull(),
      });
      expect(live).toHaveLength(0);
    });
  });

  it('5. refuses a rotated row outside the grace, on the clock of the database', async () => {
    const { pair: r1 } = await person();
    const r2 = await identity.refresh(r1.refreshToken);
    await dataSource.query(
      `UPDATE "refresh_tokens" SET "revokedAt" = now() - interval '3 minutes' WHERE "tokenHash" = $1`,
      [hashOf(r1.refreshToken)]
    );

    await expect(identity.refresh(r1.refreshToken)).rejects.toMatchObject(
      refused
    );

    expect(reasons).toEqual(['grace_over']);
    expect((await rowOf(r2.refreshToken)).revokedAt).toBeNull();
  });

  it('refuses an unknown token and an expired one', async () => {
    const { pair } = await person();
    await dataSource.query(
      `UPDATE "refresh_tokens" SET "expiresAt" = now() - interval '1 second' WHERE "tokenHash" = $1`,
      [hashOf(pair.refreshToken)]
    );

    await expect(identity.refresh('no-such-token')).rejects.toMatchObject(
      refused
    );
    await expect(identity.refresh(pair.refreshToken)).rejects.toMatchObject(
      refused
    );

    expect(reasons).toEqual(['unknown', 'expired']);
    expect((await rowOf(pair.refreshToken)).revokedAt).toBeNull();
  });

  it('6. leaves the presented row live when the issue fails after the spend', async () => {
    const { user, pair: r1 } = await person();
    jest
      .spyOn(tokens, 'issueTokensRecorded')
      .mockRejectedValueOnce(new Error('pool timeout'));

    await expect(identity.refresh(r1.refreshToken)).rejects.toThrow(
      'pool timeout'
    );

    const row = await rowOf(r1.refreshToken);
    expect(row.revokedAt).toBeNull();
    expect(row.replacedById).toBeNull();
    expect(await refreshTokens.countBy({ userId: user.id })).toBe(1);
    // And the retry works as an ordinary rotation.
    await expect(identity.refresh(r1.refreshToken)).resolves.toMatchObject({
      userId: user.id,
    });
    expect(reasons).toEqual([]);
  });

  it('6b. leaves the presented row live when the rotation fails after it recorded the successor', async () => {
    const { user, pair: r1 } = await person();
    const record = tokens.recordSuccessor.bind(tokens);
    jest
      .spyOn(tokens, 'recordSuccessor')
      .mockImplementationOnce(async (spentId, successorId, manager) => {
        // The successor row is inserted and the pointer is written, both on
        // the rotation's manager. Then the rotation fails.
        await record(spentId, successorId, manager);
        throw new Error('connection lost');
      });

    await expect(identity.refresh(r1.refreshToken)).rejects.toThrow(
      'connection lost'
    );

    const row = await rowOf(r1.refreshToken);
    expect(row.revokedAt).toBeNull();
    expect(row.replacedById).toBeNull();
    expect(row.replacedAt).toBeNull();
    // No successor row survived the rollback.
    expect(await refreshTokens.countBy({ userId: user.id })).toBe(1);
    await expect(identity.refresh(r1.refreshToken)).resolves.toMatchObject({
      userId: user.id,
    });
    expect(reasons).toEqual([]);
  });

  describe('7. a support row', () => {
    async function supportPair() {
      serial += 1;
      const admin = await admins.save(
        admins.create({
          username: `operator-${serial}-${Date.now()}`,
          passwordHash: 'not-a-hash',
          displayName: null,
          disabledAt: null,
          lastLoginAt: null,
        })
      );
      operatorId = admin.id;
      const { user } = await person();
      const start = await impersonation.start({
        userId: operatorId,
        adminToken: 'verified',
        targetUserId: user.id,
        reason: ImpersonationReason.BUG_REPORT,
      });
      const pair = await impersonation.exchange({ code: start.code });
      return { start, pair };
    }

    const claimsOf = (pair: AuthTokens) =>
      jwt.decode<AccessTokenClaims>(pair.accessToken);

    it('rotates under the same session and deadline, and the grace reissues under them too', async () => {
      const { start, pair: s1 } = await supportPair();
      const deadline = Date.parse(start.expiresAt);

      const s2 = await identity.refresh(s1.refreshToken);
      await afterLostAnswer();
      const s3 = await identity.refresh(s1.refreshToken);

      expect(reasons).toEqual(['reissued']);
      for (const pair of [s2, s3]) {
        expect(claimsOf(pair).act).toEqual(claimsOf(s1).act);
        const row = await rowOf(pair.refreshToken);
        expect(row.impersonationSessionId).toBe(start.sessionId);
        expect(row.expiresAt.getTime()).toBe(deadline);
      }
      expect((await rowOf(s2.refreshToken)).revokedAt).toBeInstanceOf(Date);
      const third = await rowOf(s3.refreshToken);
      expect(third.revokedAt).toBeNull();
      expect((await rowOf(s1.refreshToken)).replacedById).toBe(third.id);
    });

    it('commits the end of a session whose operator was disabled, and refuses', async () => {
      const { start, pair: s1 } = await supportPair();
      await admins.update({ id: operatorId }, { disabledAt: new Date() });

      await expect(identity.refresh(s1.refreshToken)).rejects.toMatchObject({
        code: ERROR_CODES.IMPERSONATION_ENDED,
      });

      const rows = await refreshTokens.findBy({
        impersonationSessionId: start.sessionId,
      });
      expect(rows).toHaveLength(1);
      expect(rows[0].revokedAt).toBeInstanceOf(Date);
      const [session] = (await dataSource.query(
        `SELECT "endedAt" FROM "impersonation_sessions" WHERE "id" = $1`,
        [start.sessionId]
      )) as Array<{ endedAt: Date | null }>;
      expect(session.endedAt).toBeInstanceOf(Date);

      // Announced one time, and after the commit: another connection already
      // read the end at the moment of the emit.
      expect(ended.map(({ event }) => event)).toEqual([
        { sessionId: start.sessionId, userId: rows[0].userId },
      ]);
      const [seen] = await ended[0].committed;
      expect(seen.endedAt).toBeInstanceOf(Date);
    });

    it('announces nothing when the rotation of a support row rolls back', async () => {
      const { pair: s1 } = await supportPair();
      await admins.update({ id: operatorId }, { disabledAt: new Date() });
      // The end is written, and then the transaction fails before it commits.
      jest
        .spyOn(tokens, 'revokeAllForSession')
        .mockRejectedValueOnce(new Error('connection lost'));

      await expect(identity.refresh(s1.refreshToken)).rejects.toThrow(
        'connection lost'
      );

      expect(ended).toEqual([]);
      expect((await rowOf(s1.refreshToken)).revokedAt).toBeNull();
    });
  });
});
