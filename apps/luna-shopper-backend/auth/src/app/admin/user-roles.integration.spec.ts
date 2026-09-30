import { JwtService } from '@nestjs/jwt';
import {
  UserKind,
  type AccessTokenClaims,
  type AdminCredential,
} from '@portfolio/luna-shopper/contracts';
import { ERROR_CODES } from '@portfolio/luna-shopper/platform';
import {
  describeIntegration,
  requiredEnv,
} from '@portfolio/luna-shopper/test-fixtures/jest';
import { generateKeyPairSync } from 'node:crypto';
import { DataSource, Repository } from 'typeorm';
import { AuthAuditService } from '../audit/auth-audit.service';
import { AUTH_MIGRATIONS } from '../db/migrations';
import {
  AdminUser,
  AUTH_ENTITIES,
  AuthAudit,
  Credential,
  OAuthIdentity,
  RefreshToken,
  User,
} from '../entities';
import { IdentityService } from '../identity/identity.service';
import { TokenGrantService } from '../tokens/token-grant.service';
import { TokenService } from '../tokens/token.service';
import { UsernameGenerator } from '../username/username-generator.service';
import { AdminDirectoryService } from './admin-directory.service';

/**
 * Roles on an account against real Postgres (plan 0175).
 *
 * What only a database can answer: that the migration adds `users.roles` with
 * an empty default and takes it away again, that the role filter's `ANY` reads
 * the array column, that the guest rule holds in the table as well as in the
 * service, that the audit row commits with the change, and that the token a
 * refresh signs afterwards carries the permissions the new roles grant.
 *
 * It works in a scratch schema of its own and drops it afterwards.
 *
 *   bash k8s/e2e/luna-shopper-backend/luna-slot.sh --ephemeral --up <n> --services auth
 *   LUNA_INTEGRATION=1 AUTH_DB_URL=postgres://luna_auth:luna_auth@localhost:<port>/luna_auth \
 *     npx nx run luna-shopper-backend-auth:test-integration --testFile=user-roles
 */
const SCHEMA = 'plan0175_user_roles_test';

/** An `admin_users.id`, as the gate would have verified it. */
const OPERATOR = '44444444-4444-4444-8444-444444444444';

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
});

const AUTH_CONFIG = {
  jwt: {
    privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    kid: 'test-kid',
    accessTokenTtl: '15m',
    refreshTokenTtl: '30d',
    participantTokenTtl: '15m',
  },
  smtp: { enabled: false },
  google: { enabled: false },
};

describeIntegration('roles on an account (real Postgres)', () => {
  let dataSource: DataSource;
  let users: Repository<User>;
  let trail: Repository<AuthAudit>;
  let refreshTokens: Repository<RefreshToken>;
  let tokens: TokenService;
  let identity: IdentityService;
  let directory: AdminDirectoryService;
  const jwt = new JwtService();

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
    trail = dataSource.getRepository(AuthAudit);
    refreshTokens = dataSource.getRepository(RefreshToken);

    const config = { getOrThrow: () => AUTH_CONFIG } as never;
    tokens = new TokenService(jwt, config, refreshTokens);
    identity = new IdentityService(
      dataSource,
      tokens,
      new TokenGrantService(),
      { hash: jest.fn(), verify: jest.fn() } as never,
      { sendVerificationEmail: jest.fn() } as never,
      {} as never,
      new UsernameGenerator(),
      new AuthAuditService(dataSource),
      config
    );
    directory = new AdminDirectoryService(
      users,
      dataSource.getRepository(Credential),
      dataSource.getRepository(OAuthIdentity),
      dataSource.getRepository(AdminUser),
      { requireAdmin: async () => OPERATOR } as never,
      identity
    );
  }, 120_000);

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
      await dataSource.destroy();
    }
  });

  let seq = 0;
  async function newUser(kind = UserKind.REGISTERED): Promise<User> {
    seq += 1;
    return users.save(
      users.create({
        kind,
        username: `Person ${seq}`,
        email: kind === UserKind.REGISTERED ? `p${seq}@example.com` : null,
        emailVerifiedAt: null,
        displayName: null,
      })
    );
  }

  const credential: AdminCredential = {
    userId: OPERATOR,
    adminToken: 'token',
  };

  function claimsOf(accessToken: string): AccessTokenClaims {
    return jwt.verify<AccessTokenClaims & object>(accessToken, {
      publicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      algorithms: ['RS256'],
    });
  }

  it('starts every account with no role, which grants nothing', async () => {
    const user = await newUser();

    expect(user.roles).toEqual([]);
    const pair = await tokens.issueTokens(user);
    expect(claimsOf(pair.accessToken).perms).toEqual([]);
  });

  it('sets the roles, answers them on the row, and records the operator', async () => {
    const user = await newUser();

    const view = await directory.setRoles({
      ...credential,
      targetUserId: user.id,
      roles: ['admin'],
    });

    expect(view.roles).toEqual(['admin']);
    expect((await users.findOneByOrFail({ id: user.id })).roles).toEqual([
      'admin',
    ]);
    const rows = await trail.find({ where: { entityId: user.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actorId: OPERATOR,
      entity: 'users',
      before: { roles: [] },
      after: { roles: ['admin'] },
    });
  });

  it('stores a set once per role, in a fixed order, and a repeat records nothing', async () => {
    const user = await newUser();

    const view = await directory.setRoles({
      ...credential,
      targetUserId: user.id,
      roles: ['premium', 'admin', 'premium'],
    });
    expect(view.roles).toEqual(['admin', 'premium']);

    await directory.setRoles({
      ...credential,
      targetUserId: user.id,
      roles: ['admin', 'premium'],
    });
    expect(await trail.count({ where: { entityId: user.id } })).toBe(1);
  });

  it('refuses a guest with its own code and leaves the row alone', async () => {
    const guest = await newUser(UserKind.TEMPORARY);

    await expect(
      directory.setRoles({
        ...credential,
        targetUserId: guest.id,
        roles: ['admin'],
      })
    ).rejects.toMatchObject({ code: ERROR_CODES.GUEST_HAS_NO_ROLES });

    expect((await users.findOneByOrFail({ id: guest.id })).roles).toEqual([]);
    expect(await trail.count({ where: { entityId: guest.id } })).toBe(0);
  });

  it('refuses a guest role in the table too, for a write that skips the service', async () => {
    const guest = await newUser(UserKind.TEMPORARY);

    await expect(
      dataSource.query(
        `UPDATE "users" SET "roles" = ARRAY['admin'] WHERE "id" = $1`,
        [guest.id]
      )
    ).rejects.toThrow(/ck_users_guest_has_no_roles/);
  });

  it('filters the user list by role', async () => {
    const holder = await newUser();
    const other = await newUser();
    await directory.setRoles({
      ...credential,
      targetUserId: holder.id,
      roles: ['premium'],
    });

    const page = await directory.list({ ...credential, role: 'premium' });
    const ids = page.items.map((row) => row.userId);

    expect(ids).toContain(holder.id);
    expect(ids).not.toContain(other.id);
    expect(page.items.every((row) => row.roles.includes('premium'))).toBe(true);
  });

  it('carries the new permissions from the next refresh, without signing anybody out', async () => {
    const user = await newUser();
    const before = await tokens.issueTokens(user);
    expect(claimsOf(before.accessToken).perms).toEqual([]);

    await directory.setRoles({
      ...credential,
      targetUserId: user.id,
      roles: ['admin'],
    });
    const after = await identity.refresh(before.refreshToken);

    expect(claimsOf(after.accessToken).perms).toEqual(['shopMap.record']);

    // Taking the role away reaches the next refresh the same way.
    await directory.setRoles({
      ...credential,
      targetUserId: user.id,
      roles: [],
    });
    const later = await identity.refresh(after.refreshToken);
    expect(claimsOf(later.accessToken).perms).toEqual([]);
  });

  it('runs the migration down and up again', async () => {
    const last = AUTH_MIGRATIONS[AUTH_MIGRATIONS.length - 1];
    expect(last.name).toBe('UserRoles1772600000000');

    await dataSource.undoLastMigration();
    const gone = await dataSource.query(
      `SELECT 1 FROM information_schema.columns
        WHERE table_schema = $1 AND table_name = 'users' AND column_name = 'roles'`,
      [SCHEMA]
    );
    expect(gone).toHaveLength(0);

    await dataSource.runMigrations();
    const back = await dataSource.query(
      `SELECT column_default FROM information_schema.columns
        WHERE table_schema = $1 AND table_name = 'users' AND column_name = 'roles'`,
      [SCHEMA]
    );
    expect(back).toHaveLength(1);
    // Every row that survived the round trip has the empty default again.
    const nonEmpty = await dataSource.query(
      `SELECT count(*)::int AS n FROM "users" WHERE "roles" <> '{}'`
    );
    expect(nonEmpty[0].n).toBe(0);
  });
});
