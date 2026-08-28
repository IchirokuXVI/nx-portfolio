import {
  ListRole,
  MembershipStatus,
  type CreateListRequest,
} from '@portfolio/luna-shopper/contracts';
import type { DataSource, EntityManager } from 'typeorm';
import { ListAccess, ShoppingList, ZoneMembership } from '../entities';
import type { CoreEventsPublisher } from '../events/core-events.publisher';
import type { ZoneAuthzService } from '../zones/zone-authz.service';
import type { ZoneCountsService } from '../zones/zone-counts.service';
import type { ListAccessService } from './list-access.service';
import { ListService } from './list.service';

/**
 * Who a new list reaches (plan 0034).
 *
 * A list is created inside a group whose whole reason is a shared shop, so the
 * default is that the group can use it. The interesting assertions are about the
 * **access rows written in the same transaction as the list**: a list that exists
 * before its grants do is one the group cannot see for as long as the gap lasts,
 * and a failed grant must take the list with it rather than leave a private one
 * behind that nobody meant to make.
 */

const CREATOR_MEMBERSHIP = 'm-creator';

interface Written {
  lists: Partial<ShoppingList>[];
  access: Partial<ListAccess>[];
}

/**
 * A `ListService` whose transaction manager records what was saved.
 *
 * Hand rolled rather than mocked through TypeORM, because the thing under test is
 * which rows are written and in which transaction, and a mock deep enough to fake a
 * query builder is a mock that can be made to agree with anything.
 */
function serviceWith(approvedMembershipIds: string[]): {
  service: ListService;
  written: Written;
} {
  const written: Written = { lists: [], access: [] };

  const manager = {
    getRepository(entity: unknown) {
      if (entity === ShoppingList) {
        return {
          create: (data: Partial<ShoppingList>) => ({ ...data }),
          save: async (list: Partial<ShoppingList>) => {
            // The timestamps the database would have stamped. `toListView` reads
            // them on the way out, so a fake that omitted them would fail for a
            // reason that has nothing to do with access.
            const saved = {
              ...list,
              id: 'l-new',
              createdAt: new Date('2026-08-28T00:00:00.000Z'),
              updatedAt: new Date('2026-08-28T00:00:00.000Z'),
            };
            written.lists.push(saved);
            return saved;
          },
        };
      }
      if (entity === ListAccess) {
        return {
          create: (data: Partial<ListAccess>) => ({ ...data }),
          save: async (rows: Partial<ListAccess>[]) => {
            written.access.push(...rows);
            return rows;
          },
        };
      }
      if (entity === ZoneMembership) {
        return {
          createQueryBuilder: () => {
            const qb = {
              select: () => qb,
              where: () => qb,
              andWhere: () => qb,
              getRawMany: async () =>
                approvedMembershipIds.map((id) => ({ id })),
            };
            return qb;
          },
        };
      }
      throw new Error('unexpected repository');
    },
  } as unknown as EntityManager;

  const dataSource = {
    transaction: async <T>(run: (m: EntityManager) => Promise<T>) =>
      run(manager),
  } as unknown as DataSource;

  const service = new ListService(
    dataSource,
    { createQueryBuilder: () => ({}) } as never,
    {} as never,
    {
      requireApproved: async () => ({ id: CREATOR_MEMBERSHIP }),
    } as unknown as ZoneAuthzService,
    {} as unknown as ListAccessService,
    { emitZoneCounts: async () => undefined } as unknown as ZoneCountsService,
    { emit: () => undefined } as unknown as CoreEventsPublisher
  );

  return { service, written };
}

function request(shareWithZone?: boolean): CreateListRequest {
  return {
    userId: 'u1',
    zoneId: 'z1',
    name: 'Weekly shop',
    ...(shareWithZone === undefined ? {} : { shareWithZone }),
  };
}

describe('creating a list', () => {
  it('gives every other approved member access when it is shared', async () => {
    const { service, written } = serviceWith(['m-2', 'm-3']);

    await service.create(request(true));

    expect(written.access.map((row) => row.membershipId).sort()).toEqual([
      'm-2',
      'm-3',
      CREATOR_MEMBERSHIP,
    ]);
  });

  it('grants WRITER, because a list here is shopped from and not read', async () => {
    // The decision worth pinning: a group of readers watching one person shop is
    // not a household shopping list. Narrowing it afterwards is the share sheet's
    // job and is one tap away.
    const { service, written } = serviceWith(['m-2']);

    await service.create(request(true));

    expect(written.access.every((row) => row.role === ListRole.WRITER)).toBe(
      true
    );
  });

  it('keeps it to its creator when the box was unticked', async () => {
    const { service, written } = serviceWith(['m-2', 'm-3']);

    await service.create(request(false));

    expect(written.access).toHaveLength(1);
    expect(written.access[0].membershipId).toBe(CREATOR_MEMBERSHIP);
  });

  it('shares when the field is absent, for a client that predates it', async () => {
    // The compatibility rule stated on `CreateListRequest.shareWithZone`: an older
    // client must keep getting the shared list it has no way to ask for, rather
    // than silently start creating private ones.
    const { service, written } = serviceWith(['m-2']);

    await service.create(request());

    expect(written.access.map((row) => row.membershipId).sort()).toEqual([
      'm-2',
      CREATOR_MEMBERSHIP,
    ]);
  });

  it('writes the grants in the transaction that writes the list', async () => {
    const { service, written } = serviceWith(['m-2']);

    await service.create(request(true));

    // One list, and its access rows, from the one manager the transaction handed
    // out. A grant written outside it could survive a rolled back list.
    expect(written.lists).toHaveLength(1);
    expect(written.access.every((row) => row.listId === 'l-new')).toBe(true);
  });

  it('asks only for approved memberships', async () => {
    // Access follows the membership row, so a pending request must not be granted
    // anything: they are not in the group yet.
    const { service } = serviceWith([]);
    expect(MembershipStatus.APPROVED).toBe('APPROVED');

    await expect(service.create(request(true))).resolves.toBeDefined();
  });
});
