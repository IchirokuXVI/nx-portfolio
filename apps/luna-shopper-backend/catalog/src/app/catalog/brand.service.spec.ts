import {
  BrandInUseException,
  ForbiddenException,
  NotFoundException,
} from '@portfolio/luna-shopper/platform';
import type { Repository } from 'typeorm';
import { Brand, BrandHomonym, Item } from '../entities';
import { BrandService } from './brand.service';
import type {
  AuditedWrite,
  CatalogAuditService,
} from './catalog-audit.service';
import type {
  CatalogActor,
  PlatformAdminService,
} from './platform-admin.service';

/**
 * The decision a delete makes, with no database (the follow up of plan 0178).
 *
 * `brand-delete.integration.spec.ts` is where the rows are read back from real
 * Postgres. What is pinned here is the order of the decision, which a database
 * cannot show: the gate comes before any read, the counts come before any
 * write, and a refusal writes nothing at all.
 */
const ADMIN = '44444444-4444-4444-8444-444444444444';
const BRAND_ID = '22222222-2222-4222-8222-222222222222';
const CANONICAL_ID = '33333333-3333-4333-8333-333333333333';

const ACTOR = { id: ADMIN } as unknown as CatalogActor;

function brand(overrides: Partial<Brand> = {}): Brand {
  return {
    id: BRAND_ID,
    key: 'do',
    label: 'D.O.',
    privateLabelSupermarketId: null,
    canonicalBrandId: null,
    ...overrides,
  } as Brand;
}

interface World {
  /** The row the id resolves to, or null when there is none. */
  row: Brand | null;
  itemCount: number;
  linkCount: number;
  homonyms: BrandHomonym[];
  /** Whether the gate lets the caller through. */
  admin: boolean;
}

function setUp(world: Partial<World> = {}) {
  const state: World = {
    row: brand(),
    itemCount: 0,
    linkCount: 0,
    homonyms: [],
    admin: true,
    ...world,
  };
  /** Every write and every read for a decision, in the order it happened. */
  const calls: string[] = [];

  const manager = {
    createQueryBuilder: (target?: unknown) => {
      if (target === Brand) {
        // The row lock of `lockInIdOrder`.
        const lock = {
          setLock: () => lock,
          where: () => lock,
          getOne: async () => {
            calls.push('lock brand');
            return state.row ? { ...state.row } : null;
          },
        };
        return lock;
      }
      // The only other builder a delete opens: a spelling's products going
      // back to unbranded.
      const update = {
        update: () => update,
        set: () => update,
        where: () => update,
        execute: async () => {
          calls.push('update items');
          return { affected: 3 };
        },
      };
      return update;
    },
    count: async (target: unknown) => {
      calls.push(target === Item ? 'count items' : 'count links');
      return target === Item ? state.itemCount : state.linkCount;
    },
    find: async () => {
      calls.push('find homonyms');
      return state.homonyms;
    },
    findOne: async () => brand({ id: CANONICAL_ID, key: 'prima' }),
  };

  const tx = {
    manager,
    delete: jest.fn(async (target: unknown, row: { id: string }) => {
      calls.push(`delete ${target === Brand ? 'brand' : 'homonym'} ${row.id}`);
    }),
  };

  const brands = {
    findOne: async () => {
      calls.push('load brand');
      return state.row;
    },
  } as unknown as Repository<Brand>;
  const admin = {
    requireAdmin: jest.fn(async () => {
      calls.push('gate');
      if (!state.admin) {
        throw new ForbiddenException(
          'Only the app owner can manage the catalog'
        );
      }
      return ACTOR;
    }),
  };
  const audit = {
    write: jest.fn(
      (actor: CatalogActor, work: (tx: AuditedWrite) => Promise<unknown>) => {
        calls.push('open transaction');
        return work(tx as unknown as AuditedWrite);
      }
    ),
  };

  const service = new BrandService(
    brands,
    admin as unknown as PlatformAdminService,
    audit as unknown as CatalogAuditService
  );
  return { service, calls, tx, audit, admin };
}

const request = { userId: ADMIN, brandId: BRAND_ID };

function homonym(id: string, printedKey: string): BrandHomonym {
  return { id, printedKey, brandId: BRAND_ID } as BrandHomonym;
}

describe('BrandService.remove', () => {
  it('deletes a brand that nothing points at, its homonyms first, and moves no product', async () => {
    const { service, calls } = setUp({
      homonyms: [homonym('h-1', 'doca'), homonym('h-2', 'dop')],
    });

    const result = await service.remove(request);

    expect(result).toEqual({ id: BRAND_ID, movedItems: 0 });
    expect(calls).toEqual([
      'gate',
      'load brand',
      'open transaction',
      'lock brand',
      'count items',
      'count links',
      'find homonyms',
      'delete homonym h-1',
      'delete homonym h-2',
      `delete brand ${BRAND_ID}`,
    ]);
    expect(calls).not.toContain('update items');
  });

  it('writes as the actor the gate let through', async () => {
    const { service, audit } = setUp();

    await service.remove(request);

    expect(audit.write).toHaveBeenCalledWith(ACTOR, expect.any(Function));
  });

  it.each([
    ['a product holds it', { itemCount: 92 }, { itemCount: 92, linkCount: 0 }],
    [
      'a spelling is linked to it',
      { linkCount: 2 },
      { itemCount: 0, linkCount: 2 },
    ],
    [
      'both point at it',
      { itemCount: 5, linkCount: 1 },
      { itemCount: 5, linkCount: 1 },
    ],
  ])(
    'refuses with the counts when %s, and writes nothing',
    async (_case, world, details) => {
      const { service, calls, tx } = setUp({
        ...world,
        homonyms: [homonym('h-1', 'dop')],
      });

      const refusal = await service.remove(request).catch((error) => error);

      expect(refusal).toBeInstanceOf(BrandInUseException);
      expect(refusal.code).toBe('brand_in_use');
      expect(refusal.details).toEqual(details);
      // Published, because the counts are what the back office says next.
      expect(refusal.exposesDetails).toBe(true);
      expect(tx.delete).not.toHaveBeenCalled();
      expect(calls).not.toContain('find homonyms');
      expect(calls).not.toContain('update items');
    }
  );

  it('reads the counts under the row lock, never before it', async () => {
    const { service, calls } = setUp({ itemCount: 1 });

    await service.remove(request).catch(() => undefined);

    expect(calls.indexOf('lock brand')).toBeLessThan(
      calls.indexOf('count items')
    );
  });

  it('still puts a spelling’s products back, and counts nothing for it', async () => {
    const { service, calls } = setUp({
      row: brand({ canonicalBrandId: CANONICAL_ID }),
      // Counts that would refuse any other brand. A spelling is not asked.
      itemCount: 7,
      linkCount: 7,
    });

    const result = await service.remove(request);

    expect(result).toEqual({ id: BRAND_ID, movedItems: 3 });
    expect(calls).toEqual([
      'gate',
      'load brand',
      'open transaction',
      'lock brand',
      'update items',
      `delete brand ${BRAND_ID}`,
    ]);
  });

  it('answers not found for a brand that is not there, before any transaction', async () => {
    const { service, audit } = setUp({ row: null });

    await expect(service.remove(request)).rejects.toBeInstanceOf(
      NotFoundException
    );
    expect(audit.write).not.toHaveBeenCalled();
  });

  it('refuses somebody who is not an admin before it reads anything', async () => {
    const { service, calls } = setUp({ admin: false });

    await expect(service.remove(request)).rejects.toBeInstanceOf(
      ForbiddenException
    );
    expect(calls).toEqual(['gate']);
  });
});
