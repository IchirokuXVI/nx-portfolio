import { PriceSourceKind } from '@portfolio/luna-shopper/contracts';
import {
  ForbiddenException,
  NotFoundException,
} from '@portfolio/luna-shopper/platform';
import type { Repository } from 'typeorm';
// `SupermarketItem` is a value here: the audit double keys on the entity class.
import {
  SupermarketItem,
  type Item,
  type PriceScope,
  type SupermarketLocation,
} from '../entities';
import { fakeAudit } from './catalog-audit.testing';
import type { PlatformAdminService } from './platform-admin.service';
import { SupermarketItemService } from './supermarket-item.service';

const ADMIN = 'owner-1';

function makeAdmin(): jest.Mocked<PlatformAdminService> {
  return {
    requireAdmin: jest.fn(async (credential: { userId: string }) => {
      if (credential.userId !== ADMIN) {
        throw new ForbiddenException('nope');
      }
      return { kind: 'admin', actorId: credential.userId };
    }),
  } as unknown as jest.Mocked<PlatformAdminService>;
}

/** A stored row as the repository would hand it back, numerics included. */
function storedRow(overrides: Partial<SupermarketItem> = {}): SupermarketItem {
  return {
    id: 'si1',
    itemId: 'item-1',
    priceScopeId: 'scope-1',
    price: 1.75,
    currency: 'EUR',
    unitPrice: null,
    unitPriceLabel: null,
    priceObservedAt: new Date('2026-08-30T10:00:00.000Z'),
    priceSourceKind: PriceSourceKind.OFFICIAL_API,
    available: true,
    itemPriceId: 'p1',
    stale: false,
    validUntil: null,
    nextBoundaryAt: null,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: new Date('2026-08-01T00:00:00.000Z'),
    ...overrides,
  } as SupermarketItem;
}

/**
 * The materialized row's service (plan 0080, section 7). It reads, and the one
 * thing it writes is availability, because that is a fact about stock and not
 * about price.
 */
describe('SupermarketItemService', () => {
  const item = { id: 'item-1' } as Item;
  const scope = { id: 'scope-1' } as PriceScope;
  const location = {
    id: 'loc-1',
    priceScopeId: 'scope-1',
  } as SupermarketLocation;

  function build(overrides: Partial<Repository<SupermarketItem>> = {}) {
    const admin = makeAdmin();
    const saved: SupermarketItem[] = [];
    const supermarketItems = {
      findOne: jest.fn(async () => null),
      find: jest.fn(async () => []),
      create: jest.fn((x) => x),
      save: jest.fn(async (rows: SupermarketItem | SupermarketItem[]) => {
        saved.push(...(Array.isArray(rows) ? rows : [rows]));
        return rows;
      }),
      ...overrides,
    } as unknown as Repository<SupermarketItem>;
    const items = {
      findOne: jest.fn(async () => item),
    } as unknown as Repository<Item>;
    const scopes = {
      findOne: jest.fn(async () => scope),
    } as unknown as Repository<PriceScope>;
    const locations = {
      findOne: jest.fn(async () => location),
    } as unknown as Repository<SupermarketLocation>;
    const audit = fakeAudit([
      [
        SupermarketItem,
        { name: 'supermarket_items', repository: supermarketItems },
      ],
    ]);
    const svc = new SupermarketItemService(
      supermarketItems,
      items,
      scopes,
      locations,
      admin,
      audit.service
    );
    return {
      svc,
      admin,
      supermarketItems,
      items,
      scopes,
      locations,
      audit,
      saved,
    };
  }

  describe('setAvailability (plan 0080, section 9)', () => {
    it('is gated to the platform admin', async () => {
      const { svc } = build();
      await expect(
        svc.setAvailability({
          userId: 'intruder',
          priceScopeId: 'scope-1',
          entries: [{ itemId: 'item-1', available: false }],
        })
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('requires the scope to exist', async () => {
      const { svc, scopes } = build();
      (scopes.findOne as jest.Mock).mockResolvedValueOnce(null);
      await expect(
        svc.setAvailability({
          userId: ADMIN,
          priceScopeId: 'missing',
          entries: [{ itemId: 'item-1', available: false }],
        })
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('creates a row with no price and no source for an item the scope has not priced', async () => {
      // A 404 from a detail call says "not stocked here" and states no price.
      const { svc, saved, audit } = build();
      const result = await svc.setAvailability({
        userId: ADMIN,
        priceScopeId: 'scope-1',
        entries: [{ itemId: 'item-1', available: false }],
      });
      expect(result).toEqual({ updated: 1 });
      expect(saved).toHaveLength(1);
      expect(saved[0]).toMatchObject({
        itemId: 'item-1',
        priceScopeId: 'scope-1',
        available: false,
        priceSourceKind: null,
      });
      expect(saved[0].price).toBeUndefined();
      expect(audit.recorded.map((r) => r.action)).toEqual(['CREATE']);
    });

    it('flips an existing row and records only the flag', async () => {
      const existing = storedRow({ available: true });
      const { svc, saved, audit } = build({
        find: jest.fn(async () => [existing]),
      } as unknown as Partial<Repository<SupermarketItem>>);
      await svc.setAvailability({
        userId: ADMIN,
        priceScopeId: 'scope-1',
        entries: [{ itemId: 'item-1', available: false }],
      });
      expect(saved).toHaveLength(1);
      expect(saved[0].available).toBe(false);
      // The price columns are untouched: availability is not a price write.
      expect(saved[0].price).toBe(1.75);
      expect(audit.recorded).toHaveLength(1);
      expect(audit.recorded[0]).toMatchObject({
        action: 'UPDATE',
        before: { available: true },
        after: { available: false },
      });
    });

    it('writes nothing for a row that already says so', async () => {
      const { svc, saved, audit } = build({
        find: jest.fn(async () => [storedRow({ available: false })]),
      } as unknown as Partial<Repository<SupermarketItem>>);
      const result = await svc.setAvailability({
        userId: ADMIN,
        priceScopeId: 'scope-1',
        entries: [{ itemId: 'item-1', available: false }],
      });
      expect(result).toEqual({ updated: 0 });
      expect(saved).toEqual([]);
      expect(audit.recorded).toEqual([]);
    });
  });

  describe('reads', () => {
    it('get throws NotFound when the scope has no row for that item', async () => {
      const { svc } = build();
      await expect(
        svc.get({ userId: 'reader', itemId: 'item-1', priceScopeId: 'scope-1' })
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('get answers the materialized row with its provenance and its flag', async () => {
      const { svc } = build({
        findOne: jest.fn(async () =>
          storedRow({
            stale: true,
            validUntil: new Date('2026-09-07T00:00:00.000Z'),
          })
        ),
      } as unknown as Partial<Repository<SupermarketItem>>);
      const view = await svc.get({
        userId: 'reader',
        itemId: 'item-1',
        priceScopeId: 'scope-1',
      });
      expect(view).toMatchObject({
        price: 1.75,
        observedAt: '2026-08-30T10:00:00.000Z',
        sourceKind: PriceSourceKind.OFFICIAL_API,
        stale: true,
        validUntil: '2026-09-07T00:00:00.000Z',
        itemPriceId: 'p1',
      });
    });

    it('listByLocation resolves the store to its scope and pages that', async () => {
      // The subject survived the re-keying because a shopper asks about a shop,
      // not about a warehouse code.
      const qb = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getMany: jest.fn(async () => []),
      };
      const { svc } = build({
        createQueryBuilder: jest.fn(() => qb),
      } as unknown as Partial<Repository<SupermarketItem>>);

      await svc.listByLocation({
        userId: 'reader',
        supermarketLocationId: 'loc-1',
      });
      expect(qb.where).toHaveBeenCalledWith('si."priceScopeId" = :value', {
        value: 'scope-1',
      });
    });
  });
});

/**
 * The back office's effective price list (plan 0073, section 4; plan 0080,
 * section 10). It is the one read in this service behind the gate, and the
 * properties worth pinning are why: it starts from nothing, so with no filter
 * it is the whole price table, and `sourceKind` and `stale` are what make
 * "what have I overridden" and "what is shown on sufferance" answerable.
 */
describe('SupermarketItemService.adminList', () => {
  function build() {
    const qb = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getMany: jest.fn(async () => []),
    };
    const admin = makeAdmin();
    const supermarketItems = {
      createQueryBuilder: jest.fn(() => qb),
    } as unknown as Repository<SupermarketItem>;
    const svc = new SupermarketItemService(
      supermarketItems,
      {} as Repository<Item>,
      {} as Repository<PriceScope>,
      {} as Repository<SupermarketLocation>,
      admin,
      // A read: it opens no transaction, so an unbound double is the honest
      // double. A write reaching it here would throw rather than pass quietly.
      fakeAudit([]).service
    );
    return { svc, qb, admin };
  }

  it('is gated, unlike the three lists beside it', async () => {
    const { svc } = build();
    await expect(svc.adminList({ userId: 'intruder' })).rejects.toBeInstanceOf(
      ForbiddenException
    );
  });

  it('with no filter it pages the whole table, newest first', async () => {
    const { svc, qb } = build();
    await svc.adminList({ userId: ADMIN });
    expect(qb.andWhere).not.toHaveBeenCalled();
    expect(qb.orderBy).toHaveBeenCalledWith('si.createdAt', 'DESC');
  });

  it('answers "what have I overridden"', async () => {
    const { svc, qb } = build();
    await svc.adminList({ userId: ADMIN, sourceKind: PriceSourceKind.ADMIN });
    expect(qb.andWhere).toHaveBeenCalledWith('si."priceSourceKind" = :kind', {
      kind: PriceSourceKind.ADMIN,
    });
  });

  it('answers "what is shown on sufferance"', async () => {
    const { svc, qb } = build();
    await svc.adminList({ userId: ADMIN, stale: true });
    expect(qb.andWhere).toHaveBeenCalledWith('si."stale" = :stale', {
      stale: true,
    });
  });

  /**
   * `available: false` is a filter and not an absent one. Reading it as "no
   * filter" is the obvious bug, and it would hide exactly the rows an operator
   * opened the screen to find.
   */
  it('treats available=false as a filter rather than as absent', async () => {
    const { svc, qb } = build();
    await svc.adminList({ userId: ADMIN, available: false });
    expect(qb.andWhere).toHaveBeenCalledWith('si."available" = :available', {
      available: false,
    });
  });
});
