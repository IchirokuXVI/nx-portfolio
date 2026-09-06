import { JwtService } from '@nestjs/jwt';
import {
  ADMIN_TOKEN_AUDIENCE,
  HarvestRunStatus,
  type AdminDashboardRequest,
} from '@portfolio/luna-shopper/contracts';
import { generateKeyPairSync } from 'node:crypto';
import type { Repository } from 'typeorm';
import type {
  DiscoveredPlace,
  HarvestRun,
  SourceCatalogEntry,
  SourceLocation,
  SupermarketSource,
} from '../entities';
import { HarvestDashboardService } from './dashboard.service';
import { PlatformAdminService } from './platform-admin.service';

/**
 * The gate on the harvester's dashboard block (plan 0088, section 1).
 *
 * The harvester gates every subject it exposes, and this is one more of them.
 * Against a real keypair and the real verifier, because the property being
 * asserted lives inside the signature check. What the counts say is asserted
 * against a real database in `dashboard.integration.spec.ts`.
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
    getOne: async () => null,
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
    findOne: jest.fn(async () => null),
    count: jest.fn(async () => 0),
  } as unknown as Repository<T> & {
    createQueryBuilder: jest.Mock;
    find: jest.Mock;
    count: jest.Mock;
  };
}

function build() {
  const gate = new PlatformAdminService(jwt, {
    getOrThrow: () => ({ adminJwtPublicKey: pem(adminKeys.publicKey) }),
  } as never);

  const runs = emptyRepository<HarvestRun>();
  const entries = emptyRepository<SourceCatalogEntry>();
  const places = emptyRepository<DiscoveredPlace>();
  const shops = emptyRepository<SourceLocation>();
  const sources = emptyRepository<SupermarketSource>();

  return {
    svc: new HarvestDashboardService(
      runs,
      entries,
      places,
      shops,
      sources,
      gate
    ),
    runs,
    sources,
  };
}

const WINDOW = { from: '2026-08-08', to: '2026-09-06' };

function request(adminToken?: string): AdminDashboardRequest {
  return { userId: 'admin-1', adminToken, window: WINDOW };
}

describe('HarvestDashboardService', () => {
  it('refuses a request with no operator token, and counts nothing', async () => {
    const { svc, runs, sources } = build();

    await expect(svc.dashboard(request())).rejects.toThrow(
      'Only the app owner can operate the harvester'
    );
    expect(runs.createQueryBuilder).not.toHaveBeenCalled();
    expect(sources.find).not.toHaveBeenCalled();
  });

  it('refuses a token signed with a key the harvester does not verify against', async () => {
    const { svc, runs } = build();

    await expect(
      svc.dashboard(request(signAdmin(otherKeys.privateKey)))
    ).rejects.toThrow('That operator token was not accepted');
    expect(runs.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('counts once the token has been accepted', async () => {
    const { svc, runs, sources } = build();

    const block = await svc.dashboard(request(signAdmin()));

    expect(runs.createQueryBuilder).toHaveBeenCalled();
    expect(sources.find).toHaveBeenCalled();
    // Nothing running is the ordinary state of a cluster: no storefront is
    // enabled in either, so null here is an answer rather than a gap.
    expect(block.running).toBeNull();
    expect(block.recent).toEqual([]);
    expect(block.sources).toEqual({ total: 0, enabled: 0 });
  });

  /**
   * Every status, in enum order, even at zero. The chart that draws this assigns
   * colours by position, so a bar that appeared only once something had failed
   * would recolour the whole chart the day it does.
   */
  it('reports every run status, in enum order', async () => {
    const { svc } = build();

    const block = await svc.dashboard(request(signAdmin()));

    expect(block.runs.byStatus).toEqual(
      Object.values(HarvestRunStatus).map((status) => ({ status, count: 0 }))
    );
  });
});
