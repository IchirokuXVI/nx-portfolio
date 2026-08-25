import {
  ForbiddenException,
  NotFoundException,
} from '@portfolio/luna-shopper/platform';
import type { Repository } from 'typeorm';
import {
  ItemCategory,
  UnitOfMeasure,
} from '@portfolio/luna-shopper/contracts';
import type { Item } from '../entities';
import { ItemService } from './item.service';
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

function makeQb(rows: Item[]) {
  const qb: Record<string, jest.Mock> = {};
  for (const m of ['take', 'andWhere', 'orderBy', 'addOrderBy']) {
    qb[m] = jest.fn(() => qb);
  }
  qb.getMany = jest.fn(async () => rows);
  return qb;
}

describe('ItemService', () => {
  it('create is gated to the platform admin', async () => {
    const admin = makeAdmin();
    const repo = {
      save: jest.fn(async (x) => ({ id: 'i1', ...x })),
      create: jest.fn((x) => x),
    } as unknown as Repository<Item>;
    const svc = new ItemService(repo, admin);

    await expect(
      svc.create({
        userId: 'intruder',
        name: { en: 'Milk', es: 'Leche' },
        category: ItemCategory.DAIRY,
        defaultUnit: UnitOfMeasure.LITER,
      })
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(repo.save).not.toHaveBeenCalled();

    await expect(
      svc.create({
        userId: ADMIN,
        name: { en: 'Milk', es: 'Leche' },
        category: ItemCategory.DAIRY,
        defaultUnit: UnitOfMeasure.LITER,
      })
    ).resolves.toMatchObject({ name: { en: 'Milk', es: 'Leche' } });
  });

  it('search is open (no admin check) and returns a page', async () => {
    const admin = makeAdmin();
    const rows = [
      {
        id: 'i1',
        name: { en: 'Milk', es: 'Leche' },
        brand: null,
        imageUrl: null,
        sku: null,
        category: ItemCategory.DAIRY,
        defaultUnit: UnitOfMeasure.LITER,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ] as unknown as Item[];
    const qb = makeQb(rows);
    const repo = {
      createQueryBuilder: jest.fn(() => qb),
    } as unknown as Repository<Item>;
    const svc = new ItemService(repo, admin);

    const page = await svc.search({ userId: 'any-reader', query: 'milk' });

    expect(admin.requireAdmin).not.toHaveBeenCalled();
    expect(page.items).toHaveLength(1);
    expect(page.items[0].name.en).toBe('Milk');
    // the free-text term was applied to the query
    expect(qb.andWhere).toHaveBeenCalled();
  });

  it('get throws NotFound for a missing item', async () => {
    const admin = makeAdmin();
    const repo = {
      findOne: jest.fn(async () => null),
    } as unknown as Repository<Item>;
    const svc = new ItemService(repo, admin);
    await expect(
      svc.get({ userId: 'reader', itemId: 'missing' })
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
