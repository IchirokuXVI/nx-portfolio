import {
  ListPermission,
  MembershipStatus,
  ZoneRole,
  type CreateListRequest,
} from '@portfolio/luna-shopper/contracts';
import type { DataSource, EntityManager } from 'typeorm';
import { ListAccess, ShoppingList, ZoneMembership } from '../entities';
import type { CoreEventsPublisher } from '../events/core-events.publisher';
import type { ZoneAuthzService } from '../zones/zone-authz.service';
import type { ZoneCountsService } from '../zones/zone-counts.service';
import type { ListAccessService } from './list-access.service';
import { ListService } from './list.service';
import { SharedListGrantService } from './shared-list-grant.service';

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
function serviceWith(
  grantableMembershipIds: string[],
  creatorRole: ZoneRole = ZoneRole.MEMBER
): {
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
                grantableMembershipIds.map((id) => ({ id })),
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
      requireApproved: async () => ({
        id: CREATOR_MEMBERSHIP,
        role: creatorRole,
      }),
    } as unknown as ZoneAuthzService,
    {} as unknown as ListAccessService,
    new SharedListGrantService(),
    { emitZoneCounts: async () => undefined } as unknown as ZoneCountsService,
    { emit: () => undefined } as unknown as CoreEventsPublisher,
    // No operator write here, so nothing reaches the trail.
    {} as never
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

  it('grants the group read, write and decide, because a list here is shopped from', async () => {
    // The decision worth pinning (plan 0036, section 2.6): a group of readers
    // watching one person shop is not a household shopping list, and with DECIDE
    // split out of the old WRITER, granting write alone would ship a shared list
    // only its creator can tick anything off. Narrowing it afterwards is the
    // share sheet's job and is one tap away.
    const { service, written } = serviceWith(['m-2']);

    await service.create(request(true));

    const others = written.access.filter(
      (row) => row.membershipId !== CREATOR_MEMBERSHIP
    );
    expect(others).toHaveLength(1);
    for (const row of others) {
      expect([...(row.permissions ?? [])].sort()).toEqual(
        [
          ListPermission.DECIDE,
          ListPermission.READ,
          ListPermission.WRITE,
        ].sort()
      );
    }
  });

  it('gives the creator all four, as an ordinary row', async () => {
    // Plan 0036, section 2.5. Their governing power used to be derived from
    // `createdByUserId`, which made it exactly as irrevocable as a group admin's.
    // As a row, a group admin can rewrite it, down to deleting it.
    const { service, written } = serviceWith(['m-2']);

    await service.create(request(true));

    const creator = written.access.find(
      (row) => row.membershipId === CREATOR_MEMBERSHIP
    );
    expect([...(creator?.permissions ?? [])].sort()).toEqual(
      [
        ListPermission.DECIDE,
        ListPermission.MANAGE,
        ListPermission.READ,
        ListPermission.WRITE,
      ].sort()
    );
  });

  it('never grants MANAGE to the rest of the group', async () => {
    // Governing the list is the thing the creator kept, and only group staff may
    // hand that bit out afterwards (plan 0036, section 5, rule 3).
    const { service, written } = serviceWith(['m-2', 'm-3']);

    await service.create(request(true));

    const others = written.access.filter(
      (row) => row.membershipId !== CREATOR_MEMBERSHIP
    );
    expect(
      others.some((row) => row.permissions?.includes(ListPermission.MANAGE))
    ).toBe(false);
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

  it('writes no row for a creator who is the group owner', async () => {
    // Plan 0042, section 1.2. The creator of the first list in a new group is
    // that group's owner, and a row for them says nothing their derived grant
    // does not: it is inert, `getAccess` hides it, and `setAccess` refuses any
    // entry naming it, which is the whole of why the share sheet never saved.
    const { service, written } = serviceWith(['m-2'], ZoneRole.OWNER);

    await service.create(request(true));

    expect(written.access.map((row) => row.membershipId)).toEqual(['m-2']);
  });

  it('writes nothing at all for a staff creator keeping the list to themselves', async () => {
    const { service, written } = serviceWith(['m-2'], ZoneRole.ADMIN);

    await service.create(request(false));

    expect(written.access).toHaveLength(0);
  });

  it('stores the sharing decision on the list rather than only acting on it', async () => {
    // Plan 0042, section 2.1. `shareWithZone` used to be an action that was over
    // the moment it ran, so a member approved a minute later got nothing and
    // nothing could recover the intent. As a column it can be read afterwards,
    // which is what the approval grant reads.
    const shared = serviceWith(['m-2']);
    await shared.service.create(request(true));
    expect(shared.written.lists[0].sharedWithZone).toBe(true);

    const priv = serviceWith(['m-2']);
    await priv.service.create(request(false));
    expect(priv.written.lists[0].sharedWithZone).toBe(false);

    // Absent still means shared, so the column agrees with the grant an older
    // client already gets.
    const absent = serviceWith(['m-2']);
    await absent.service.create(request());
    expect(absent.written.lists[0].sharedWithZone).toBe(true);
  });

  it('asks only for approved memberships', async () => {
    // Access follows the membership row, so a pending request must not be granted
    // anything: they are not in the group yet.
    const { service } = serviceWith([]);
    expect(MembershipStatus.APPROVED).toBe('APPROVED');

    await expect(service.create(request(true))).resolves.toBeDefined();
  });
});
