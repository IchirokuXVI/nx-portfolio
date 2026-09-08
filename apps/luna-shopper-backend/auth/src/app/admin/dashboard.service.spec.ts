import { JwtService } from '@nestjs/jwt';
import {
  ADMIN_TOKEN_AUDIENCE,
  type AdminDashboardRequest,
} from '@portfolio/luna-shopper/contracts';
import { generateKeyPairSync } from 'node:crypto';
import type { Repository } from 'typeorm';
import type { AuthAuditService } from '../audit/auth-audit.service';
import type { AdminLoginFailure, AdminUser, User } from '../entities';
import { AuthDashboardService } from './dashboard.service';
import { AuthPlatformAdminService } from './platform-admin.service';

/**
 * The gate on auth's dashboard block (plan 0088, section 1).
 *
 * This one matters more than its three siblings: the block reports how many
 * people are registered and how many operator logins have failed, so a handler
 * that skipped the check would be the one unauthenticated read of the user
 * directory in the API.
 *
 * Against a real keypair and the real verifier, like every other gate spec here,
 * because the property being asserted lives inside the signature check rather
 * than in a branch of ours. What the counts say is asserted against a real
 * database in `dashboard.integration.spec.ts`; this file asserts only that
 * nothing is counted until the token has been accepted.
 */
const adminKeys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const otherKeys = generateKeyPairSync('rsa', { modulusLength: 2048 });

const pem = (key: { export: (o: object) => string | Buffer }) =>
  key.export({ type: 'spki', format: 'pem' }).toString();

const jwt = new JwtService();

function signAdmin(privateKey = adminKeys.privateKey) {
  return jwt.sign(
    { sub: 'admin-1' },
    {
      privateKey,
      algorithm: 'RS256',
      audience: ADMIN_TOKEN_AUDIENCE,
      expiresIn: '15m',
    }
  );
}

/** A query builder that answers every chained call with itself, and no rows. */
function emptyQueryBuilder(): unknown {
  const builder: Record<string, unknown> = {
    getRawOne: async () => undefined,
    getRawMany: async () => [],
    getCount: async () => 0,
  };
  return new Proxy(builder, {
    get(target, property) {
      return property in target
        ? target[property as string]
        : () => new Proxy(target, this as ProxyHandler<typeof target>);
    },
  });
}

/** A repository that answers nothing, and records whether it was asked. */
function emptyRepository<T>() {
  return {
    createQueryBuilder: jest.fn(() => emptyQueryBuilder()),
    find: jest.fn(async () => []),
    count: jest.fn(async () => 0),
  } as unknown as Repository<T> & { createQueryBuilder: jest.Mock };
}

function build() {
  const gate = new AuthPlatformAdminService(jwt, {
    getOrThrow: () => ({ admin: { publicKey: pem(adminKeys.publicKey) } }),
  } as never);

  const users = emptyRepository<User>();
  const admins = emptyRepository<AdminUser>();
  const failures = emptyRepository<AdminLoginFailure>();
  const recent = jest.fn(async () => []);
  const audit = { recent } as unknown as AuthAuditService;

  return {
    svc: new AuthDashboardService(users, admins, failures, gate, audit),
    users,
    admins,
    recent,
  };
}

const WINDOW = { from: '2026-08-08', to: '2026-09-06' };

function request(adminToken?: string): AdminDashboardRequest {
  return { userId: 'admin-1', adminToken, window: WINDOW };
}

describe('AuthDashboardService', () => {
  it('refuses a request with no operator token, and counts nothing', async () => {
    const { svc, users, recent } = build();

    await expect(svc.dashboard(request())).rejects.toThrow(
      'Only an operator can read the directory'
    );
    expect(users.createQueryBuilder).not.toHaveBeenCalled();
    expect(recent).not.toHaveBeenCalled();
  });

  it('refuses a token signed with a key auth does not verify against', async () => {
    const { svc, users } = build();

    await expect(
      svc.dashboard(request(signAdmin(otherKeys.privateKey)))
    ).rejects.toThrow('That operator token was not accepted');
    expect(users.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('counts once the token has been accepted', async () => {
    const { svc, users, admins, recent } = build();

    const block = await svc.dashboard(request(signAdmin()));

    expect(users.createQueryBuilder).toHaveBeenCalled();
    expect(admins.createQueryBuilder).toHaveBeenCalled();
    expect(recent).toHaveBeenCalled();
    // No count is ever null, so a screen can tell a service that did not answer
    // from one that answered zero.
    expect(block.users).toEqual({
      total: 0,
      registered: 0,
      temporary: 0,
      verified: 0,
    });
    expect(block.signUps).toHaveLength(30);
  });
});
