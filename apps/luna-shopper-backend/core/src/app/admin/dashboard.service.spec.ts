import { JwtService } from '@nestjs/jwt';
import {
  ADMIN_TOKEN_AUDIENCE,
  type AdminDashboardRequest,
} from '@portfolio/luna-shopper/contracts';
import { generateKeyPairSync } from 'node:crypto';
import type { Repository } from 'typeorm';
import type { CoreAuditService } from '../audit/core-audit.service';
import type {
  GeneratedList,
  ShoppingList,
  Zone,
  ZoneMembership,
} from '../entities';
import { CoreDashboardService } from './dashboard.service';
import { CorePlatformAdminService } from './platform-admin.service';

/**
 * The gate on core's dashboard block (plan 0088, section 1).
 *
 * Against a real keypair and the real verifier, because the property being
 * asserted lives inside the signature check rather than in a branch of ours.
 * What the counts say is asserted against a real database in
 * `dashboard.integration.spec.ts`; this file asserts only that nothing is
 * counted until the token has been accepted.
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
  } as unknown as Repository<T> & {
    createQueryBuilder: jest.Mock;
    count: jest.Mock;
  };
}

function build() {
  const gate = new CorePlatformAdminService(jwt, {
    getOrThrow: () => ({ adminJwtPublicKey: pem(adminKeys.publicKey) }),
  } as never);

  const zones = emptyRepository<Zone>();
  const memberships = emptyRepository<ZoneMembership>();
  const lists = emptyRepository<ShoppingList>();
  const baskets = emptyRepository<GeneratedList>();
  const recent = jest.fn(async () => []);
  const audit = { recent } as unknown as CoreAuditService;

  return {
    svc: new CoreDashboardService(
      zones,
      memberships,
      lists,
      baskets,
      gate,
      audit
    ),
    zones,
    memberships,
    recent,
  };
}

const WINDOW = { from: '2026-08-08', to: '2026-09-06' };

function request(adminToken?: string): AdminDashboardRequest {
  return { userId: 'admin-1', adminToken, window: WINDOW };
}

describe('CoreDashboardService', () => {
  it('refuses a request with no operator token, and counts nothing', async () => {
    const { svc, zones, recent } = build();

    await expect(svc.dashboard(request())).rejects.toThrow(
      'Only an operator can read this'
    );
    expect(zones.createQueryBuilder).not.toHaveBeenCalled();
    expect(recent).not.toHaveBeenCalled();
  });

  it('refuses a token signed with a key core does not verify against', async () => {
    const { svc, zones } = build();

    await expect(
      svc.dashboard(request(signAdmin(otherKeys.privateKey)))
    ).rejects.toThrow('That operator token was not accepted');
    expect(zones.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('counts once the token has been accepted', async () => {
    const { svc, zones, memberships, recent } = build();

    const block = await svc.dashboard(request(signAdmin()));

    expect(zones.createQueryBuilder).toHaveBeenCalled();
    expect(memberships.count).toHaveBeenCalled();
    expect(recent).toHaveBeenCalled();
    // No count is ever null, so a screen can tell a service that did not answer
    // from one that answered zero.
    expect(block.zones).toEqual({ total: 0, active: 0, markedForDeletion: 0 });
    expect(block.baskets).toEqual({ total: 0, draft: 0, completed: 0 });
    expect(block.zonesCreated).toHaveLength(30);
    expect(block.listsCreated).toHaveLength(30);
  });
});
