import { PriceSourceKind } from '@portfolio/luna-shopper/contracts';
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@portfolio/luna-shopper/platform';
import { QueryFailedError, type Repository } from 'typeorm';
import type {
  Item,
  PriceScope,
  SupermarketItem,
  SupermarketLocation,
} from '../entities';
import { SupermarketItemService } from './supermarket-item.service';
import type { PlatformAdminService } from './platform-admin.service';

const ADMIN = 'owner-1';

function makeAdmin(): jest.Mocked<PlatformAdminService> {
  return {
    isAdmin: jest.fn((id: string) => id === ADMIN),
    requireAdmin: jest.fn((id: string) => {
      if (id !== ADMIN) {
        throw new ForbiddenException('nope');
      }
    }),
  } as unknown as jest.Mocked<PlatformAdminService>;
}

function uniqueViolation(): QueryFailedError {
  const err = new QueryFailedError('insert', [], new Error('dup'));
  (err as unknown as { driverError: { code: string } }).driverError = {
    code: '23505',
  };
  return err;
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
    priceObservedAt: null,
    priceSourceKind: PriceSourceKind.ADMIN,
    available: true,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: new Date('2026-08-01T00:00:00.000Z'),
    ...overrides,
  } as SupermarketItem;
}

describe('SupermarketItemService', () => {
  const item = { id: 'item-1' } as Item;
  const scope = { id: 'scope-1' } as PriceScope;
  const location = {
    id: 'loc-1',
    priceScopeId: 'scope-1',
  } as SupermarketLocation;

  function build(overrides: Partial<Repository<SupermarketItem>> = {}) {
    const admin = makeAdmin();
    const supermarketItems = {
      findOne: jest.fn(async () => null),
      find: jest.fn(async () => []),
      create: jest.fn((x) => x),
      save: jest.fn(async (x) => ({ id: 'si1', available: true, ...x })),
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
    const svc = new SupermarketItemService(
      supermarketItems,
      items,
      scopes,
      locations,
      admin
    );
    return { svc, admin, supermarketItems, items, scopes, locations };
  }

  it('upsert is gated to the platform admin', async () => {
    const { svc } = build();
    await expect(
      svc.upsert({
        userId: 'intruder',
        itemId: 'item-1',
        priceScopeId: 'scope-1',
        price: 1,
      })
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('upsert requires the item and the scope to exist', async () => {
    const { svc, items } = build();
    (items.findOne as jest.Mock).mockResolvedValueOnce(null);
    await expect(
      svc.upsert({
        userId: ADMIN,
        itemId: 'missing',
        priceScopeId: 'scope-1',
      })
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('upsert creates a price for the scope, defaulting the source to ADMIN', async () => {
    const { svc } = build();
    const view = await svc.upsert({
      userId: ADMIN,
      itemId: 'item-1',
      priceScopeId: 'scope-1',
      price: 2.5,
      currency: 'EUR',
      unitPrice: 4.5,
      unitPriceLabel: '100 ml',
    });
    expect(view).toMatchObject({
      itemId: 'item-1',
      priceScopeId: 'scope-1',
      price: 2.5,
      currency: 'EUR',
      unitPrice: 4.5,
      // The source's own label, verbatim: it reads "100 ml" on a per litre
      // number, so it is text rather than a unit.
      unitPriceLabel: '100 ml',
      priceSourceKind: PriceSourceKind.ADMIN,
    });
    // A price with no age is not much of a price.
    expect(view.priceObservedAt).not.toBeNull();
  });

  it('a duplicate (item, scope) surfaces as a Conflict', async () => {
    const { svc } = build({
      save: jest.fn(async () => {
        throw uniqueViolation();
      }),
    });
    await expect(
      svc.upsert({
        userId: ADMIN,
        itemId: 'item-1',
        priceScopeId: 'scope-1',
      })
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('get throws NotFound when the scope has no price for that item', async () => {
    const { svc } = build();
    await expect(
      svc.get({
        userId: 'reader',
        itemId: 'item-1',
        priceScopeId: 'scope-1',
      })
    ).rejects.toBeInstanceOf(NotFoundException);
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

    await svc.listByLocation({ userId: 'reader', supermarketLocationId: 'loc-1' });
    expect(qb.where).toHaveBeenCalledWith('si."priceScopeId" = :value', {
      value: 'scope-1',
    });
  });
});

/**
 * Section 6.5. These are the tests that make "an import does not clobber a price
 * the owner typed in" a property rather than a comment.
 */
describe('SupermarketItemService overwrite rules (plan 0038, section 6.5)', () => {
  const scope = { id: 'scope-1' } as PriceScope;

  function build(existing: SupermarketItem[]) {
    const admin = makeAdmin();
    const saved: SupermarketItem[] = [];
    const supermarketItems = {
      findOne: jest.fn(async () => existing[0] ?? null),
      find: jest.fn(async () => existing),
      create: jest.fn((x) => x as SupermarketItem),
      save: jest.fn(async (rows: SupermarketItem | SupermarketItem[]) => {
        saved.push(...(Array.isArray(rows) ? rows : [rows]));
        return rows;
      }),
    } as unknown as Repository<SupermarketItem>;
    const svc = new SupermarketItemService(
      supermarketItems,
      { findOne: jest.fn(async () => ({ id: 'item-1' })) } as unknown as Repository<Item>,
      { findOne: jest.fn(async () => scope) } as unknown as Repository<PriceScope>,
      {
        findOne: jest.fn(async () => null),
      } as unknown as Repository<SupermarketLocation>,
      admin
    );
    return { svc, saved };
  }

  it('does not overwrite an ADMIN price, and reports the disagreement', async () => {
    const { svc, saved } = build([
      storedRow({ price: 1.75, priceSourceKind: PriceSourceKind.ADMIN }),
    ]);
    const result = await svc.upsertBatch({
      userId: ADMIN,
      priceScopeId: 'scope-1',
      priceSourceKind: PriceSourceKind.OFFICIAL_API,
      entries: [{ itemId: 'item-1', price: 1.8 }],
    });

    expect(saved).toHaveLength(0);
    expect(result).toMatchObject({ created: 0, updated: 0, unchanged: 0 });
    expect(result.skipped).toEqual([
      {
        itemId: 'item-1',
        storedPrice: 1.75,
        storedSourceKind: PriceSourceKind.ADMIN,
        fetchedPrice: 1.8,
      },
    ]);
  });

  it('overwrites a row that is already OFFICIAL_API', async () => {
    const { svc, saved } = build([
      storedRow({ price: 1.75, priceSourceKind: PriceSourceKind.OFFICIAL_API }),
    ]);
    const result = await svc.upsertBatch({
      userId: ADMIN,
      priceScopeId: 'scope-1',
      priceSourceKind: PriceSourceKind.OFFICIAL_API,
      entries: [{ itemId: 'item-1', price: 1.8 }],
    });

    expect(result).toMatchObject({ updated: 1, skipped: [] });
    expect(saved[0].price).toBe(1.8);
  });

  it('overwrites a row that has no price yet, whatever its source kind says', async () => {
    // An ADMIN row with a null price is not an owner's decision about the price,
    // it is a row that exists for another reason.
    const { svc, saved } = build([
      storedRow({ price: null, priceSourceKind: PriceSourceKind.ADMIN }),
    ]);
    const result = await svc.upsertBatch({
      userId: ADMIN,
      priceScopeId: 'scope-1',
      priceSourceKind: PriceSourceKind.OFFICIAL_API,
      entries: [{ itemId: 'item-1', price: 1.8 }],
    });
    expect(result).toMatchObject({ updated: 1, skipped: [] });
    expect(saved[0].price).toBe(1.8);
  });

  it('counts an unchanged price as unchanged, and still refreshes its age', async () => {
    const { svc, saved } = build([
      storedRow({
        price: 1.8,
        priceSourceKind: PriceSourceKind.OFFICIAL_API,
        priceObservedAt: new Date('2026-08-01T00:00:00.000Z'),
      }),
    ]);
    const result = await svc.upsertBatch({
      userId: ADMIN,
      priceScopeId: 'scope-1',
      priceSourceKind: PriceSourceKind.OFFICIAL_API,
      entries: [
        { itemId: 'item-1', price: 1.8, priceObservedAt: '2026-08-30T09:00:00.000Z' },
      ],
    });
    expect(result).toMatchObject({ created: 0, updated: 0, unchanged: 1 });
    expect(saved[0].priceObservedAt?.toISOString()).toBe(
      '2026-08-30T09:00:00.000Z'
    );
  });

  it('creates a row the scope did not have', async () => {
    const { svc, saved } = build([]);
    const result = await svc.upsertBatch({
      userId: ADMIN,
      priceScopeId: 'scope-1',
      priceSourceKind: PriceSourceKind.OFFICIAL_API,
      entries: [
        {
          itemId: 'item-1',
          price: 1.8,
          unitPrice: 4.5,
          unitPriceLabel: '100 ml',
          available: true,
        },
      ],
    });
    expect(result).toMatchObject({ created: 1, skipped: [] });
    expect(saved[0]).toMatchObject({
      itemId: 'item-1',
      priceScopeId: 'scope-1',
      price: 1.8,
      unitPrice: 4.5,
      unitPriceLabel: '100 ml',
      priceSourceKind: PriceSourceKind.OFFICIAL_API,
    });
  });

  it('lets the owner pin a price over one an import wrote', async () => {
    // The other direction of the rule: ADMIN always wins, which is what makes
    // `supermarketItem.upsert` the owner's override.
    const { svc, saved } = build([
      storedRow({ price: 1.8, priceSourceKind: PriceSourceKind.OFFICIAL_API }),
    ]);
    const view = await svc.upsert({
      userId: ADMIN,
      itemId: 'item-1',
      priceScopeId: 'scope-1',
      price: 1.65,
    });
    expect(view.priceSourceKind).toBe(PriceSourceKind.ADMIN);
    expect(saved[0].price).toBe(1.65);
  });

  it('refuses a single OFFICIAL_API write over an ADMIN price rather than silently dropping it', async () => {
    const { svc } = build([
      storedRow({ price: 1.75, priceSourceKind: PriceSourceKind.ADMIN }),
    ]);
    await expect(
      svc.upsert({
        userId: ADMIN,
        itemId: 'item-1',
        priceScopeId: 'scope-1',
        price: 1.8,
        priceSourceKind: PriceSourceKind.OFFICIAL_API,
      })
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
