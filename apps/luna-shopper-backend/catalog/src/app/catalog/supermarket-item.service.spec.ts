import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@portfolio/luna-shopper/platform';
import { QueryFailedError, type Repository } from 'typeorm';
import type { Item, SupermarketItem, SupermarketLocation } from '../entities';
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

describe('SupermarketItemService', () => {
  const item = { id: 'item-1' } as Item;
  const location = { id: 'loc-1' } as SupermarketLocation;

  function build(overrides: Partial<Repository<SupermarketItem>> = {}) {
    const admin = makeAdmin();
    const supermarketItems = {
      findOne: jest.fn(async () => null),
      create: jest.fn((x) => x),
      save: jest.fn(async (x) => ({ id: 'si1', available: true, ...x })),
      ...overrides,
    } as unknown as Repository<SupermarketItem>;
    const items = {
      findOne: jest.fn(async () => item),
    } as unknown as Repository<Item>;
    const locations = {
      findOne: jest.fn(async () => location),
    } as unknown as Repository<SupermarketLocation>;
    const svc = new SupermarketItemService(
      supermarketItems,
      items,
      locations,
      admin
    );
    return { svc, admin, supermarketItems, items, locations };
  }

  it('upsert is gated to the platform admin', async () => {
    const { svc } = build();
    await expect(
      svc.upsert({
        userId: 'intruder',
        itemId: 'item-1',
        supermarketLocationId: 'loc-1',
        price: 1,
      })
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('upsert requires the item and location to exist', async () => {
    const { svc, items } = build();
    (items.findOne as jest.Mock).mockResolvedValueOnce(null);
    await expect(
      svc.upsert({
        userId: ADMIN,
        itemId: 'missing',
        supermarketLocationId: 'loc-1',
      })
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('upsert creates a new per-location row', async () => {
    const { svc } = build();
    const view = await svc.upsert({
      userId: ADMIN,
      itemId: 'item-1',
      supermarketLocationId: 'loc-1',
      price: 2.5,
      currency: 'EUR',
      positionInStore: 'Aisle 3',
    });
    expect(view).toMatchObject({
      itemId: 'item-1',
      supermarketLocationId: 'loc-1',
      price: 2.5,
      currency: 'EUR',
      positionInStore: 'Aisle 3',
    });
  });

  it('a duplicate (item, location) surfaces as a Conflict', async () => {
    const { svc } = build({
      save: jest.fn(async () => {
        throw uniqueViolation();
      }),
    });
    await expect(
      svc.upsert({
        userId: ADMIN,
        itemId: 'item-1',
        supermarketLocationId: 'loc-1',
      })
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('get throws NotFound when there is no entry for the pair', async () => {
    const { svc } = build();
    await expect(
      svc.get({
        userId: 'reader',
        itemId: 'item-1',
        supermarketLocationId: 'loc-1',
      })
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
