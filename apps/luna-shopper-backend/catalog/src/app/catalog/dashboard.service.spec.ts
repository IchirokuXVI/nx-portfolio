import { JwtService } from '@nestjs/jwt';
import {
  ADMIN_TOKEN_AUDIENCE,
  PriceSourceKind,
  type AdminDashboardRequest,
} from '@portfolio/luna-shopper/contracts';
import { generateKeyPairSync } from 'node:crypto';
import type { Repository } from 'typeorm';
import type {
  Item,
  ItemPrice,
  ProductGroup,
  Supermarket,
  SupermarketItem,
  SupermarketLocation,
} from '../entities';
import type { CatalogAuditService } from './catalog-audit.service';
import { CatalogDashboardService } from './dashboard.service';
import { PlatformAdminService } from './platform-admin.service';

/**
 * The gate on catalog's dashboard block (plan 0088, section 1).
 *
 * Catalog's gate is the one with two ways through, because the harvester writes
 * prices as a machine. The dashboard is asked for by a person, and this file
 * asserts that a request with neither a signature nor a configured service id is
 * refused before a row is counted. What the counts say is asserted against a
 * real database in `dashboard.integration.spec.ts`.
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
  const gate = new PlatformAdminService(jwt, {
    getOrThrow: () => ({
      adminJwtPublicKey: pem(adminKeys.publicKey),
      serviceActorIds: [],
    }),
  } as never);

  const supermarkets = emptyRepository<Supermarket>();
  const locations = emptyRepository<SupermarketLocation>();
  const items = emptyRepository<Item>();
  const groups = emptyRepository<ProductGroup>();
  const supermarketItems = emptyRepository<SupermarketItem>();
  const prices = emptyRepository<ItemPrice>();
  const recent = jest.fn(async () => []);
  const audit = { recent } as unknown as CatalogAuditService;

  return {
    svc: new CatalogDashboardService(
      supermarkets,
      locations,
      items,
      groups,
      supermarketItems,
      prices,
      gate,
      audit
    ),
    supermarkets,
    prices,
    recent,
  };
}

const WINDOW = { from: '2026-08-08', to: '2026-09-06' };

function request(adminToken?: string): AdminDashboardRequest {
  return { userId: 'admin-1', adminToken, window: WINDOW };
}

describe('CatalogDashboardService', () => {
  it('refuses a request with no operator token, and counts nothing', async () => {
    const { svc, supermarkets, recent } = build();

    await expect(svc.dashboard(request())).rejects.toThrow(
      'Only the app owner can manage the catalog'
    );
    expect(supermarkets.count).not.toHaveBeenCalled();
    expect(recent).not.toHaveBeenCalled();
  });

  it('refuses a token signed with a key catalog does not verify against', async () => {
    const { svc, supermarkets } = build();

    await expect(
      svc.dashboard(request(signAdmin(otherKeys.privateKey)))
    ).rejects.toThrow('That operator token was not accepted');
    expect(supermarkets.count).not.toHaveBeenCalled();
  });

  it('counts once the token has been accepted', async () => {
    const { svc, supermarkets, prices, recent } = build();

    const block = await svc.dashboard(request(signAdmin()));

    expect(supermarkets.count).toHaveBeenCalled();
    expect(prices.createQueryBuilder).toHaveBeenCalled();
    expect(recent).toHaveBeenCalled();
    expect(block.supermarketItems).toEqual({
      total: 0,
      priced: 0,
      stale: 0,
      unavailable: 0,
    });
  });

  /**
   * Every kind, in enum order, even the ones that have never written a price.
   * Admin plan 0015 assigns chart colours by position, so a series that appeared
   * only when it had data would take a different colour each month.
   */
  it('answers a full window for every source kind, in enum order', async () => {
    const { svc } = build();

    const block = await svc.dashboard(request(signAdmin()));

    expect(block.pricesWritten.map((series) => series.sourceKind)).toEqual(
      Object.values(PriceSourceKind)
    );
    for (const series of block.pricesWritten) {
      expect(series.points).toHaveLength(30);
      expect(series.points[0].day).toBe(WINDOW.from);
      expect(series.points[29].day).toBe(WINDOW.to);
    }
  });
});
