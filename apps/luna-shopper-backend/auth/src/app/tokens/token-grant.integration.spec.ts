import { JwtService } from '@nestjs/jwt';
import {
  RecoverySignInOutcome,
  UserKind,
} from '@portfolio/luna-shopper/contracts';
import {
  describeIntegration,
  requiredEnv,
} from '@portfolio/luna-shopper/test-fixtures/jest';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { DataSource, type Repository } from 'typeorm';
import { AuthAuditService } from '../audit/auth-audit.service';
import { AUTH_MIGRATIONS } from '../db/migrations';
import {
  AUTH_ENTITIES,
  AuthAudit,
  Credential,
  PasswordReset,
  PasswordResetChannel,
  PasswordResetSpentAs,
  RefreshToken,
  User,
} from '../entities';
import { IdentityService } from '../identity/identity.service';
import { InMemoryTermsService } from '../identity/terms.testing';
import { UsernameGenerator } from '../username/username-generator.service';
import { TokenGrantService } from './token-grant.service';
import { TokenService } from './token.service';

/**
 * Reset grants against real Postgres (plan 0210, section 4).
 *
 * What only a database can answer: that the migration adds three columns and
 * reads every existing row as a self service grant, that the one conditional
 * `UPDATE` lets exactly one of two spends at the same instant pass, that its
 * `RETURNING` row maps back onto the entity, that spending ends the other live
 * grants of the account and issuing does not, that a sign in keeps the
 * sessions a reset would revoke, and that the audit row of an operator grant
 * commits without the hash.
 *
 * It works in a scratch schema of its own and drops it afterwards.
 *
 *   bash k8s/e2e/luna-shopper-backend/luna-slot.sh --ephemeral --up <n> --services auth
 *   LUNA_INTEGRATION=1 AUTH_DB_URL=postgres://luna_auth:luna_auth@localhost:<port>/luna_auth \
 *     npx nx run luna-shopper-backend-auth:test-integration --testFile=token-grant.integration
 */
const SCHEMA = 'plan0210_recovery_test';

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });

const HOUR = 60 * 60 * 1000;

describeIntegration('reset grants (real Postgres)', () => {
  let dataSource: DataSource;
  let users: Repository<User>;
  let credentials: Repository<Credential>;
  let resets: Repository<PasswordReset>;
  let trail: Repository<AuthAudit>;
  let tokens: TokenService;
  let identity: IdentityService;
  const grants = new TokenGrantService();
  const mailed: Array<{ to: string; raw: string }> = [];
  const notices: string[] = [];

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
    credentials = dataSource.getRepository(Credential);
    resets = dataSource.getRepository(PasswordReset);
    trail = dataSource.getRepository(AuthAudit);

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
        smtp: {
          enabled: true,
          verifyBaseUrl: 'https://x/auth/verify',
          resetBaseUrl: 'https://x/auth/reset-password',
        },
        google: { enabled: false },
        impersonation: { enabled: false },
      }),
    } as never;

    tokens = new TokenService(
      new JwtService(),
      config,
      dataSource.getRepository(RefreshToken)
    );
    identity = new IdentityService(
      dataSource,
      tokens,
      grants,
      {
        hash: async (raw: string) => `hashed:${raw}`,
        verify: async () => false,
      } as never,
      {
        sendPasswordResetEmail: async (to: string, raw: string) => {
          mailed.push({ to, raw });
        },
        sendRecoveryLinksNotice: async (to: string) => {
          notices.push(to);
        },
      } as never,
      { userEmailVerified: () => undefined } as never,
      new UsernameGenerator(),
      new AuthAuditService(dataSource),
      config,
      {} as never,
      new InMemoryTermsService(),
      { publishSoon: () => undefined } as never
    );
  }, 120_000);

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
      await dataSource.destroy();
    }
  });

  let serial = 0;

  /** A registered account with a password. */
  async function person(): Promise<User> {
    serial += 1;
    const user = await users.save(
      users.create({
        kind: UserKind.REGISTERED,
        username: `Person ${serial}`,
        email: `p${serial}@plan0210.test`,
      })
    );
    await credentials.save(
      credentials.create({ userId: user.id, passwordHash: 'hashed:old' })
    );
    return user;
  }

  /** A self service grant for the account, and its raw token. */
  async function grantFor(user: User): Promise<string> {
    return dataSource.transaction((manager) =>
      grants.issue(manager, PasswordReset, { userId: user.id }, HOUR)
    );
  }

  const rowOf = (raw: string) =>
    resets.findOneByOrFail({ tokenHash: grants.hash(raw) });

  describe('the migration', () => {
    it('adds three columns, and reads an existing row as a self service grant', async () => {
      const user = await person();
      const index = AUTH_MIGRATIONS.findIndex(
        (migration) => migration.name === 'RecoveryGrants1772800000000'
      );
      expect(index).toBeGreaterThanOrEqual(0);
      for (let step = AUTH_MIGRATIONS.length; step > index; step -= 1) {
        await dataSource.undoLastMigration();
      }

      // The shape before the plan: a spent row and a live one.
      const before = await dataSource.query(
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema = $1 AND table_name = 'password_resets'
            AND column_name IN ('channel', 'issuedByAdminId', 'spentAs')`,
        [SCHEMA]
      );
      expect(before).toHaveLength(0);
      await dataSource.query(
        `INSERT INTO "password_resets" ("userId", "tokenHash", "expiresAt", "consumedAt")
         VALUES ($1, 'old-spent', now() + interval '1 hour', now()),
                ($1, 'old-live', now() + interval '1 hour', NULL)`,
        [user.id]
      );

      await dataSource.runMigrations();

      const rows = (await dataSource.query(
        `SELECT "tokenHash", "channel", "issuedByAdminId", "spentAs"
           FROM "password_resets" WHERE "userId" = $1 ORDER BY "tokenHash"`,
        [user.id]
      )) as Array<Record<string, unknown>>;
      expect(rows).toEqual([
        {
          tokenHash: 'old-live',
          channel: 'SELF_SERVICE',
          issuedByAdminId: null,
          spentAs: null,
        },
        {
          tokenHash: 'old-spent',
          channel: 'SELF_SERVICE',
          issuedByAdminId: null,
          spentAs: null,
        },
      ]);
    });

    it('refuses an operator grant that names no operator, and a self service one that names one', async () => {
      const user = await person();

      await expect(
        dataSource.query(
          `INSERT INTO "password_resets" ("userId", "tokenHash", "expiresAt", "channel")
           VALUES ($1, $2, now(), 'OPERATOR_LINK')`,
          [user.id, randomUUID()]
        )
      ).rejects.toThrow(/ck_password_resets_operator/);
      await expect(
        dataSource.query(
          `INSERT INTO "password_resets" ("userId", "tokenHash", "expiresAt", "issuedByAdminId")
           VALUES ($1, $2, now(), $3)`,
          [user.id, randomUUID(), randomUUID()]
        )
      ).rejects.toThrow(/ck_password_resets_operator/);
    });
  });

  describe('the spend', () => {
    it('maps the RETURNING row back onto the entity', async () => {
      const user = await person();
      const raw = await grantFor(user);

      const spent = await dataSource.transaction((manager) =>
        grants.consume(manager, PasswordReset, raw, 'nope', {
          spentAs: PasswordResetSpentAs.SIGN_IN,
        })
      );

      expect(spent).toBeInstanceOf(PasswordReset);
      expect(spent.userId).toBe(user.id);
      expect(spent.tokenHash).toBe(grants.hash(raw));
      expect(spent.channel).toBe(PasswordResetChannel.SELF_SERVICE);
      expect(spent.issuedByAdminId).toBeNull();
      expect(spent.spentAs).toBe(PasswordResetSpentAs.SIGN_IN);
      expect(spent.consumedAt).toBeInstanceOf(Date);
      expect(spent.expiresAt).toBeInstanceOf(Date);
      expect(spent.createdAt).toBeInstanceOf(Date);
      // And the row says what the entity says.
      const stored = await rowOf(raw);
      expect(stored.consumedAt?.getTime()).toBe(spent.consumedAt?.getTime());
      expect(stored.spentAs).toBe(PasswordResetSpentAs.SIGN_IN);
    });

    it('refuses an expired grant on the clock of the database', async () => {
      const user = await person();
      const raw = await grantFor(user);
      await dataSource.query(
        `UPDATE "password_resets" SET "expiresAt" = now() - interval '1 second' WHERE "tokenHash" = $1`,
        [grants.hash(raw)]
      );

      await expect(
        dataSource.transaction((manager) =>
          grants.consume(manager, PasswordReset, raw)
        )
      ).rejects.toThrow('Invalid or expired token');
      expect((await rowOf(raw)).consumedAt).toBeNull();
    });
  });

  describe('a grant ends at most one time', () => {
    it('lets one of a reset and a sign in at the same instant win', async () => {
      const user = await person();
      const raw = await grantFor(user);

      const results = await Promise.allSettled([
        identity.resetPassword({ token: raw, password: 'new-password' }),
        identity.recoverySignIn({ token: raw }),
      ]);

      expect(
        results.filter((result) => result.status === 'fulfilled')
      ).toHaveLength(1);
      const row = await rowOf(raw);
      expect([
        PasswordResetSpentAs.RESET,
        PasswordResetSpentAs.SIGN_IN,
      ]).toContain(row.spentAs);
    });

    it('lets one of two sign ins at the same instant win', async () => {
      const user = await person();
      const raw = await grantFor(user);

      const results = await Promise.allSettled([
        identity.recoverySignIn({ token: raw }),
        identity.recoverySignIn({ token: raw }),
        identity.recoverySignIn({ token: raw }),
      ]);

      expect(
        results.filter((result) => result.status === 'fulfilled')
      ).toHaveLength(1);
    });
  });

  describe('ending the other grants of the account', () => {
    it('ends them on a spend and not on an issue', async () => {
      const user = await person();
      const other = await person();
      const first = await grantFor(user);
      const second = await grantFor(user);
      const theirs = await grantFor(other);

      // Issuing a third ends nothing (decision D5).
      const third = await grantFor(user);
      expect((await rowOf(second)).consumedAt).toBeNull();

      await identity.recoverySignIn({ token: first });

      for (const raw of [second, third]) {
        const row = await rowOf(raw);
        expect(row.spentAs).toBe(PasswordResetSpentAs.SUPERSEDED);
        expect(row.consumedAt).toBeInstanceOf(Date);
      }
      expect((await rowOf(theirs)).consumedAt).toBeNull();
      expect((await rowOf(first)).spentAs).toBe(PasswordResetSpentAs.SIGN_IN);
    });

    it('ends them when the owner visits a live link already signed in', async () => {
      const user = await person();
      const first = await grantFor(user);
      const second = await grantFor(user);

      await expect(
        identity.recoverySignIn({ token: second, callerUserId: user.id })
      ).resolves.toEqual({ outcome: RecoverySignInOutcome.ALREADY_SIGNED_IN });

      expect((await rowOf(second)).spentAs).toBe(
        PasswordResetSpentAs.ALREADY_SIGNED_IN
      );
      expect((await rowOf(first)).spentAs).toBe(
        PasswordResetSpentAs.SUPERSEDED
      );
    });
  });

  it('keeps every session through a sign in (decision D4)', async () => {
    const user = await person();
    const before = await tokens.issueTokens(user);
    const raw = await grantFor(user);

    await expect(
      identity.recoverySignIn({ token: raw })
    ).resolves.toMatchObject({ outcome: RecoverySignInOutcome.SIGNED_IN });

    // The pair from before still rotates.
    await expect(tokens.rotate(before.refreshToken)).resolves.toMatchObject({
      userId: user.id,
    });
  });

  describe('the operator routes', () => {
    const actor = randomUUID();

    it('records the mailed grant without its hash, in the transaction that made it', async () => {
      const user = await person();
      mailed.length = 0;

      await identity.sendPasswordResetAsOperator(user.id, actor);

      const grant = await resets.findOneByOrFail({ userId: user.id });
      expect(grant.channel).toBe(PasswordResetChannel.OPERATOR_EMAIL);
      expect(grant.issuedByAdminId).toBe(actor);
      const rows = await trail.findBy({ entityId: grant.id });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        actorId: actor,
        action: 'CREATE',
        entity: 'password_resets',
      });
      expect(rows[0].after).not.toHaveProperty('tokenHash');
      expect(rows[0].after).toMatchObject({
        channel: 'OPERATOR_EMAIL',
        issuedByAdminId: actor,
      });
      // The mail is dispatched, not awaited.
      await new Promise((resolve) => setImmediate(resolve));
      expect(mailed.map((entry) => entry.to)).toEqual([user.email]);
      expect(JSON.stringify(rows[0])).not.toContain(mailed[0].raw);
    });

    it('hands out links that live a day, and a sign in link that works one time', async () => {
      const user = await person();
      notices.length = 0;

      const links = await identity.createRecoveryLinksAsOperator(
        user.id,
        actor
      );
      const raw = new URL(links.signInUrl).searchParams.get('token') ?? '';

      const grant = await rowOf(raw);
      expect(grant.channel).toBe(PasswordResetChannel.OPERATOR_LINK);
      const life = grant.expiresAt.getTime() - grant.createdAt.getTime();
      expect(Math.abs(life - 24 * HOUR)).toBeLessThan(60 * 1000);
      const rows = await trail.findBy({ entityId: grant.id });
      expect(JSON.stringify(rows)).not.toContain(raw);
      await new Promise((resolve) => setImmediate(resolve));
      expect(notices).toEqual([user.email]);

      await expect(
        identity.recoverySignIn({ token: raw })
      ).resolves.toMatchObject({ outcome: RecoverySignInOutcome.SIGNED_IN });
      await expect(identity.recoverySignIn({ token: raw })).rejects.toThrow(
        'Invalid or expired password reset link'
      );
    });
  });
});
