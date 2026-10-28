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
import { generateKeyPairSync } from 'node:crypto';
import { DataSource, IsNull, type Repository } from 'typeorm';
import { AuthAuditService } from '../audit/auth-audit.service';
import { AUTH_MIGRATIONS } from '../db/migrations';
import {
  AdminUser,
  AUTH_ENTITIES,
  AuthAudit,
  ImpersonationSession,
  RefreshToken,
  User,
} from '../entities';
import { IdentityService } from '../identity/identity.service';
import { TokenGrantService } from '../tokens/token-grant.service';
import { TokenService } from '../tokens/token.service';
import { UsernameGenerator } from '../username/username-generator.service';
import {
  IMPERSONATION_CODE_TTL_MS,
  IMPERSONATION_MAX_MS,
  ImpersonationService,
} from './impersonation.service';

/**
 * Support sessions against real Postgres (plan 0194, section 4).
 *
 * What only a database can answer: that the migration adds the table and the
 * column and takes them away again, that one conditional `UPDATE` lets exactly
 * one of two exchanges at the same instant pass, that a refresh is cut to the
 * deadline of its session row, that ending a session revokes its own refresh
 * rows and no row the person holds, and that the audit record commits with the
 * change and without the code hash.
 *
 * A test moves a deadline into the past with a raw `UPDATE`. No code path of
 * the service can do that, which is the point of `impersonation-deadline.spec`,
 * so the spec does it by hand to stand at a moment two hours away.
 *
 * It works in a scratch schema of its own and drops it afterwards.
 *
 *   bash k8s/e2e/luna-shopper-backend/luna-slot.sh --ephemeral --up <n> --services auth
 *   LUNA_INTEGRATION=1 AUTH_DB_URL=postgres://luna_auth:luna_auth@localhost:<port>/luna_auth \
 *     npx nx run luna-shopper-backend-auth:test-integration --testFile=impersonation.integration
 */
const SCHEMA = 'plan0194_impersonation_test';

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });

const authConfig = (enabled: boolean) => ({
  jwt: {
    privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    kid: 'test-kid',
    accessTokenTtl: '15m',
    refreshTokenTtl: '30d',
    participantTokenTtl: '15m',
  },
  smtp: { enabled: false },
  google: { enabled: false },
  impersonation: { enabled },
});

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

describeIntegration('support sessions (real Postgres)', () => {
  let dataSource: DataSource;
  let users: Repository<User>;
  let admins: Repository<AdminUser>;
  let sessions: Repository<ImpersonationSession>;
  let refreshTokens: Repository<RefreshToken>;
  let trail: Repository<AuthAudit>;
  let tokens: TokenService;
  let impersonation: ImpersonationService;
  let switchedOff: ImpersonationService;
  let identity: IdentityService;
  const jwt = new JwtService();
  const ended: Array<{ sessionId: string; userId: string }> = [];

  /** The operator the gate verified, for the next call. */
  let operatorId: string;
  const credential = () => ({ userId: operatorId, adminToken: 'verified' });

  const claimsOf = (pair: AuthTokens) =>
    jwt.decode<AccessTokenClaims>(pair.accessToken);

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
    sessions = dataSource.getRepository(ImpersonationSession);
    refreshTokens = dataSource.getRepository(RefreshToken);
    trail = dataSource.getRepository(AuthAudit);

    const config = (enabled: boolean) =>
      ({ getOrThrow: () => authConfig(enabled) }) as never;
    const gate = { requireAdmin: async () => operatorId } as never;
    const events = {
      impersonationEnded: (event: { sessionId: string; userId: string }) =>
        ended.push(event),
    } as never;
    const audit = new AuthAuditService(dataSource);

    tokens = new TokenService(jwt, config(true), refreshTokens);
    impersonation = new ImpersonationService(
      dataSource,
      tokens,
      gate,
      audit,
      events,
      config(true)
    );
    switchedOff = new ImpersonationService(
      dataSource,
      tokens,
      gate,
      audit,
      events,
      config(false)
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
      config(true),
      impersonation
    );
  }, 120_000);

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
      await dataSource.destroy();
    }
  });

  let serial = 0;

  async function person(kind = UserKind.REGISTERED): Promise<User> {
    serial += 1;
    return users.save(
      users.create({
        kind,
        username: `Person ${serial}`,
        email: kind === UserKind.REGISTERED ? `p${serial}@plan0194.test` : null,
      })
    );
  }

  async function operator(): Promise<AdminUser> {
    serial += 1;
    return admins.save(
      admins.create({
        username: `operator-${serial}-${Date.now()}`,
        passwordHash: 'not-a-hash',
        displayName: null,
        disabledAt: null,
        lastLoginAt: null,
      })
    );
  }

  /** A fresh operator, a fresh person and a started session for the pair. */
  async function started(kind = UserKind.REGISTERED) {
    const admin = await operator();
    operatorId = admin.id;
    const user = await person(kind);
    const start = await impersonation.start({
      ...credential(),
      targetUserId: user.id,
      reason: ImpersonationReason.BUG_REPORT,
    });
    return { admin, user, start };
  }

  /** Move a deadline by hand, which no code path of the service can do. */
  const setDeadline = (sessionId: string, at: Date) =>
    dataSource.query(
      `UPDATE "impersonation_sessions" SET "expiresAt" = $2 WHERE "id" = $1`,
      [sessionId, at]
    );

  beforeEach(() => {
    ended.length = 0;
  });

  describe('the migration', () => {
    it('adds the table, and a nullable column on refresh_tokens', async () => {
      const columns = (await dataSource.query(
        `SELECT table_name, column_name, is_nullable FROM information_schema.columns
          WHERE table_schema = $1
            AND (table_name = 'impersonation_sessions'
              OR (table_name = 'refresh_tokens' AND column_name = 'impersonationSessionId'))`,
        [SCHEMA]
      )) as Array<{
        table_name: string;
        column_name: string;
        is_nullable: string;
      }>;

      const session = columns
        .filter((column) => column.table_name === 'impersonation_sessions')
        .map((column) => column.column_name)
        .sort();
      expect(session).toEqual(
        [
          'adminId',
          'codeConsumedAt',
          'codeExpiresAt',
          'codeHash',
          'createdAt',
          'endedAt',
          'expiresAt',
          'id',
          'reason',
          'reasonNote',
          'updatedAt',
          'userId',
        ].sort()
      );
      expect(
        columns.find((column) => column.table_name === 'refresh_tokens')
      ).toMatchObject({ is_nullable: 'YES' });
    });

    it('comes down and goes up again, and keeps every refresh row', async () => {
      const user = await person();
      await tokens.issueTokens(user);
      const before = await refreshTokens.countBy({ userId: user.id });

      // Down through this migration, whatever is added after it later.
      const index = AUTH_MIGRATIONS.findIndex(
        (migration) => migration.name === 'ImpersonationSessions1772700000000'
      );
      expect(index).toBeGreaterThanOrEqual(0);
      for (let step = AUTH_MIGRATIONS.length; step > index; step -= 1) {
        await dataSource.undoLastMigration();
      }
      const gone = await dataSource.query(`SELECT to_regclass($1) AS "table"`, [
        `"${SCHEMA}"."impersonation_sessions"`,
      ]);
      expect(gone[0].table).toBeNull();

      await dataSource.runMigrations();
      expect(await refreshTokens.countBy({ userId: user.id })).toBe(before);
      const row = await refreshTokens.findOneByOrFail({ userId: user.id });
      expect(row.impersonationSessionId).toBeNull();
    });
  });

  describe('starting a session', () => {
    it('writes the row with a two hour deadline and a sixty second code', async () => {
      const at = Date.now();
      const { admin, user, start } = await started();

      const row = await sessions.findOneByOrFail({ id: start.sessionId });
      expect(row.adminId).toBe(admin.id);
      expect(row.userId).toBe(user.id);
      expect(row.reason).toBe(ImpersonationReason.BUG_REPORT);
      expect(row.reasonNote).toBeNull();
      expect(row.endedAt).toBeNull();
      expect(row.codeConsumedAt).toBeNull();

      const life = row.expiresAt.getTime() - at;
      expect(life).toBeGreaterThanOrEqual(IMPERSONATION_MAX_MS);
      expect(life).toBeLessThan(IMPERSONATION_MAX_MS + 30_000);
      const codeLife = row.codeExpiresAt.getTime() - at;
      expect(codeLife).toBeGreaterThanOrEqual(IMPERSONATION_CODE_TTL_MS);
      expect(codeLife).toBeLessThan(IMPERSONATION_CODE_TTL_MS + 30_000);

      expect(start.expiresAt).toBe(row.expiresAt.toISOString());
      expect(start.codeExpiresAt).toBe(row.codeExpiresAt.toISOString());
      // The lifetime itself, which the back office counts from the arrival.
      expect(start.codeTtlMs).toBe(IMPERSONATION_CODE_TTL_MS);
    });

    it('stores the hash of the code and never the code', async () => {
      const { start } = await started();

      const row = await sessions.findOneByOrFail({ id: start.sessionId });
      expect(row.codeHash).not.toBe(start.code);
      expect(row.codeHash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('records the start in the audit trail, with the operator and without the code hash', async () => {
      const { admin, start } = await started();

      const rows = await trail.findBy({ entityId: start.sessionId });
      expect(rows).toHaveLength(1);
      expect(rows[0].actorId).toBe(admin.id);
      expect(rows[0].entity).toBe('impersonation_sessions');
      expect(rows[0].action).toBe('CREATE');
      expect(rows[0].after).toMatchObject({
        reason: ImpersonationReason.BUG_REPORT,
      });
      expect(Object.keys(rows[0].after ?? {})).not.toContain('codeHash');
      expect(JSON.stringify(rows[0])).not.toContain(start.code);
    });

    it('keeps the note of the reason OTHER', async () => {
      const admin = await operator();
      operatorId = admin.id;
      const user = await person();

      const start = await impersonation.start({
        ...credential(),
        targetUserId: user.id,
        reason: ImpersonationReason.OTHER,
        note: '  reproducing a report  ',
      });

      const row = await sessions.findOneByOrFail({ id: start.sessionId });
      expect(row.reasonNote).toBe('reproducing a report');
    });

    it('takes a guest as the user', async () => {
      const { start } = await started(UserKind.TEMPORARY);

      const pair = await impersonation.exchange({ code: start.code });
      expect(pair.kind).toBe(UserKind.TEMPORARY);
    });

    it('answers not_found for a user that does not exist, and writes nothing', async () => {
      const admin = await operator();
      operatorId = admin.id;
      const before = await sessions.count();

      await expect(
        impersonation.start({
          ...credential(),
          targetUserId: '99999999-9999-4999-8999-999999999999',
          reason: ImpersonationReason.TESTING,
        })
      ).rejects.toMatchObject({ code: ERROR_CODES.NOT_FOUND });
      expect(await sessions.count()).toBe(before);
    });

    it('ends the earlier live session of the same operator and user, and announces it', async () => {
      const { user, start: first } = await started();
      const firstPair = await impersonation.exchange({ code: first.code });

      const second = await impersonation.start({
        ...credential(),
        targetUserId: user.id,
        reason: ImpersonationReason.SUPPORT_REQUEST,
      });

      const earlier = await sessions.findOneByOrFail({ id: first.sessionId });
      expect(earlier.endedAt).toBeInstanceOf(Date);
      expect(ended).toEqual([{ sessionId: first.sessionId, userId: user.id }]);
      await expect(
        identity.refresh(firstPair.refreshToken)
      ).rejects.toMatchObject({ code: ERROR_CODES.UNAUTHORIZED });
      // The new one is live.
      await expect(
        impersonation.check({ sessionId: second.sessionId })
      ).resolves.toEqual({ live: true });
    });

    it('leaves the session of another operator for the same user alone', async () => {
      const { user, start: first } = await started();
      const other = await operator();
      operatorId = other.id;

      await impersonation.start({
        ...credential(),
        targetUserId: user.id,
        reason: ImpersonationReason.TESTING,
      });

      const earlier = await sessions.findOneByOrFail({ id: first.sessionId });
      expect(earlier.endedAt).toBeNull();
    });

    it('revokes no refresh row that the person holds', async () => {
      const admin = await operator();
      operatorId = admin.id;
      const user = await person();
      const own = await tokens.issueTokens(user);

      const start = await impersonation.start({
        ...credential(),
        targetUserId: user.id,
        reason: ImpersonationReason.BUG_REPORT,
      });
      await impersonation.exchange({ code: start.code });
      await impersonation.end({
        userId: user.id,
        sessionId: start.sessionId,
      });

      // The person's own session renews as it always did.
      const renewed = await identity.refresh(own.refreshToken);
      expect(claimsOf(renewed).act).toBeUndefined();
    });
  });

  describe('the code', () => {
    it('trades for the pair of the session, cut to its deadline', async () => {
      const { admin, user, start } = await started();

      const pair = await impersonation.exchange({ code: start.code });

      const claims = claimsOf(pair);
      const deadline = Date.parse(start.expiresAt);
      expect(pair.userId).toBe(user.id);
      expect(claims.sub).toBe(user.id);
      expect(claims.act).toEqual({
        sub: admin.id,
        sid: start.sessionId,
        until: Math.floor(deadline / 1000),
      });
      expect(claims.exp as number).toBeLessThanOrEqual(
        claims.act?.until as number
      );

      const row = await refreshTokens.findOneByOrFail({
        impersonationSessionId: start.sessionId,
      });
      expect(row.expiresAt.getTime()).toBe(deadline);
      expect(row.userId).toBe(user.id);
    });

    it('lets exactly one of two exchanges at the same instant pass', async () => {
      // Many rounds, because a race that loses is a race that looks fine.
      for (let round = 0; round < 15; round += 1) {
        const { start } = await started();

        const results = await Promise.allSettled([
          impersonation.exchange({ code: start.code }),
          impersonation.exchange({ code: start.code }),
          impersonation.exchange({ code: start.code }),
        ]);

        const passed = results.filter((r) => r.status === 'fulfilled');
        const refused = results.filter((r) => r.status === 'rejected');
        expect(passed).toHaveLength(1);
        expect(refused).toHaveLength(2);
        for (const result of refused) {
          expect((result as PromiseRejectedResult).reason).toMatchObject({
            code: ERROR_CODES.IMPERSONATION_CODE_INVALID,
          });
        }
        expect(
          await refreshTokens.countBy({
            impersonationSessionId: start.sessionId,
          })
        ).toBe(1);
      }
    });

    it('gives one answer to a used, an old, an ended and an unknown code', async () => {
      const used = await started();
      await impersonation.exchange({ code: used.start.code });

      const old = await started();
      await dataSource.query(
        `UPDATE "impersonation_sessions" SET "codeExpiresAt" = now() - interval '1 second' WHERE "id" = $1`,
        [old.start.sessionId]
      );

      const over = await started();
      await impersonation.end({
        userId: over.user.id,
        sessionId: over.start.sessionId,
      });

      const answers = await Promise.all(
        [
          used.start.code,
          old.start.code,
          over.start.code,
          'a-code-nobody-issued',
        ].map((code) =>
          impersonation.exchange({ code }).then(
            () => 'passed',
            (error: { code?: string; message?: string }) =>
              `${error.code}|${error.message}`
          )
        )
      );

      expect(new Set(answers).size).toBe(1);
      expect(answers[0]).toContain(ERROR_CODES.IMPERSONATION_CODE_INVALID);
    });

    it('is refused when the operator was disabled after the start', async () => {
      const { admin, start } = await started();
      await admins.update({ id: admin.id }, { disabledAt: new Date() });

      await expect(
        impersonation.exchange({ code: start.code })
      ).rejects.toMatchObject({
        code: ERROR_CODES.IMPERSONATION_CODE_INVALID,
      });
      const row = await sessions.findOneByOrFail({ id: start.sessionId });
      expect(row.endedAt).toBeInstanceOf(Date);
    });
  });

  describe('a refresh of a session', () => {
    it('renews under the same session and the same deadline', async () => {
      const { start } = await started();
      const first = await impersonation.exchange({ code: start.code });

      const second = await identity.refresh(first.refreshToken);

      expect(claimsOf(second).act).toEqual(claimsOf(first).act);
      const rows = await refreshTokens.find({
        where: { impersonationSessionId: start.sessionId },
      });
      expect(rows).toHaveLength(2);
      for (const row of rows) {
        expect(row.expiresAt.getTime()).toBe(Date.parse(start.expiresAt));
      }
      // The presented row is spent, as in any rotation, once its successor is
      // used. Before that the reuse grace of plan 0229 can still answer it.
      await identity.refresh(second.refreshToken);
      await expect(identity.refresh(first.refreshToken)).rejects.toMatchObject({
        code: ERROR_CODES.UNAUTHORIZED,
      });
    });

    it('gives a token with one minute of life one minute before the deadline', async () => {
      const { start } = await started();
      const first = await impersonation.exchange({ code: start.code });
      const deadline = new Date(Date.now() + MINUTE);
      await setDeadline(start.sessionId, deadline);

      const second = await identity.refresh(first.refreshToken);

      const claims = claimsOf(second);
      expect(claims.exp).toBe(Math.floor(deadline.getTime() / 1000));
      expect(
        (claims.exp as number) - (claims.iat as number)
      ).toBeLessThanOrEqual(60);
      expect((claims.exp as number) - (claims.iat as number)).toBeGreaterThan(
        50
      );
    });

    it('is refused after the deadline', async () => {
      const { start } = await started();
      const first = await impersonation.exchange({ code: start.code });
      // The refresh row keeps its own future expiry here, so what refuses is
      // the session row and not the rotation.
      await setDeadline(start.sessionId, new Date(Date.now() - 1000));

      await expect(identity.refresh(first.refreshToken)).rejects.toMatchObject({
        code: ERROR_CODES.IMPERSONATION_ENDED,
      });
      await expect(
        impersonation.check({ sessionId: start.sessionId })
      ).resolves.toEqual({ live: false });
    });

    it('is refused for an ended session', async () => {
      const { user, start } = await started();
      const first = await impersonation.exchange({ code: start.code });

      await impersonation.end({ userId: user.id, sessionId: start.sessionId });

      // The end revoked the row, so the rotation itself refuses.
      await expect(identity.refresh(first.refreshToken)).rejects.toMatchObject({
        code: ERROR_CODES.UNAUTHORIZED,
      });
    });

    it('is refused while the operator is disabled, and that ends the session', async () => {
      const { admin, user, start } = await started();
      const first = await impersonation.exchange({ code: start.code });
      await admins.update({ id: admin.id }, { disabledAt: new Date() });

      await expect(identity.refresh(first.refreshToken)).rejects.toMatchObject({
        code: ERROR_CODES.IMPERSONATION_ENDED,
      });

      const row = await sessions.findOneByOrFail({ id: start.sessionId });
      expect(row.endedAt).toBeInstanceOf(Date);
      expect(ended).toEqual([{ sessionId: start.sessionId, userId: user.id }]);
      // Enabling the operator again does not bring the session back.
      await admins.update({ id: admin.id }, { disabledAt: null });
      await expect(
        impersonation.check({ sessionId: start.sessionId })
      ).resolves.toEqual({ live: false });
    });

    it('is refused when the operator is gone', async () => {
      const { admin, start } = await started();
      const first = await impersonation.exchange({ code: start.code });
      await admins.delete({ id: admin.id });

      await expect(identity.refresh(first.refreshToken)).rejects.toMatchObject({
        code: ERROR_CODES.IMPERSONATION_ENDED,
      });
    });
  });

  describe('an ordinary session, which does not change', () => {
    it('keeps its 30 day refresh row, with no session and no act', async () => {
      const user = await person();
      const at = Date.now();

      const pair = await tokens.issueTokens(user);
      const renewed = await identity.refresh(pair.refreshToken);

      expect(claimsOf(pair).act).toBeUndefined();
      expect(claimsOf(renewed).act).toBeUndefined();
      const rows = await refreshTokens.findBy({ userId: user.id });
      expect(rows).toHaveLength(2);
      for (const row of rows) {
        expect(row.impersonationSessionId).toBeNull();
        expect(row.expiresAt.getTime() - at).toBeGreaterThanOrEqual(30 * DAY);
      }
    });
  });

  describe('ending a session', () => {
    it('sets endedAt, revokes the rows of the session, and announces it', async () => {
      const { admin, user, start } = await started();
      await impersonation.exchange({ code: start.code });

      await expect(
        impersonation.end({ userId: user.id, sessionId: start.sessionId })
      ).resolves.toEqual({ ended: true });

      const row = await sessions.findOneByOrFail({ id: start.sessionId });
      expect(row.endedAt).toBeInstanceOf(Date);
      expect(
        await refreshTokens.countBy({
          impersonationSessionId: start.sessionId,
          revokedAt: IsNull(),
        })
      ).toBe(0);
      expect(ended).toEqual([{ sessionId: start.sessionId, userId: user.id }]);
      await expect(
        impersonation.check({ sessionId: start.sessionId })
      ).resolves.toEqual({ live: false });

      const records = await trail.find({
        where: { entityId: start.sessionId },
        order: { at: 'ASC' },
      });
      expect(records.map((record) => record.action)).toEqual([
        'CREATE',
        'UPDATE',
      ]);
      expect(records[1].actorId).toBe(admin.id);
      expect(Object.keys(records[1].after ?? {})).toEqual(['endedAt']);
    });

    it('changes nothing the second time', async () => {
      const { user, start } = await started();
      await impersonation.end({ userId: user.id, sessionId: start.sessionId });
      const first = await sessions.findOneByOrFail({ id: start.sessionId });
      ended.length = 0;

      await expect(
        impersonation.end({ userId: user.id, sessionId: start.sessionId })
      ).resolves.toEqual({ ended: false });

      const second = await sessions.findOneByOrFail({ id: start.sessionId });
      expect(second.endedAt).toEqual(first.endedAt);
      expect(ended).toEqual([]);
      expect(await trail.countBy({ entityId: start.sessionId })).toBe(2);
    });

    it('does not end the session of another user', async () => {
      const { start } = await started();
      const stranger = await person();

      await expect(
        impersonation.end({ userId: stranger.id, sessionId: start.sessionId })
      ).resolves.toEqual({ ended: false });
      await expect(
        impersonation.check({ sessionId: start.sessionId })
      ).resolves.toEqual({ live: true });
    });

    it('never moves the deadline', async () => {
      const { user, start } = await started();
      await impersonation.exchange({ code: start.code });
      await impersonation.end({ userId: user.id, sessionId: start.sessionId });

      const row = await sessions.findOneByOrFail({ id: start.sessionId });
      expect(row.expiresAt.toISOString()).toBe(start.expiresAt);
    });
  });

  describe('the account', () => {
    it('takes its support sessions and their refresh rows with it when it is deleted', async () => {
      const { user, start } = await started();
      await impersonation.exchange({ code: start.code });

      await users.delete({ id: user.id });

      expect(await sessions.countBy({ id: start.sessionId })).toBe(0);
      expect(
        await refreshTokens.countBy({ impersonationSessionId: start.sessionId })
      ).toBe(0);
    });
  });

  describe('the switch', () => {
    it('off: a start is refused, and nothing is written', async () => {
      const admin = await operator();
      operatorId = admin.id;
      const user = await person();
      const before = await sessions.count();

      await expect(
        switchedOff.start({
          ...credential(),
          targetUserId: user.id,
          reason: ImpersonationReason.TESTING,
        })
      ).rejects.toMatchObject({ code: ERROR_CODES.IMPERSONATION_DISABLED });
      expect(await sessions.count()).toBe(before);
    });

    it('off: a good code is refused and stays unused', async () => {
      const { start } = await started();

      await expect(
        switchedOff.exchange({ code: start.code })
      ).rejects.toMatchObject({
        code: ERROR_CODES.IMPERSONATION_CODE_INVALID,
      });
      const row = await sessions.findOneByOrFail({ id: start.sessionId });
      expect(row.codeConsumedAt).toBeNull();
    });

    it('off: a session that was live is not', async () => {
      const { start } = await started();

      await expect(
        switchedOff.check({ sessionId: start.sessionId })
      ).resolves.toEqual({ live: false });
    });
  });
});
