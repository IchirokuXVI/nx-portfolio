import {
  ListPermission,
  MembershipStatus,
  RealtimeEvent,
  ZoneRole,
} from '@portfolio/luna-shopper/contracts';
import type { DataSource, EntityManager } from 'typeorm';
import {
  ListAccess,
  ShoppingList,
  ZoneMembership,
  type ZoneMembership as Membership,
} from '../entities';
import type { CoreEventsPublisher } from '../events/core-events.publisher';
import { MembershipService } from '../zones/membership.service';
import { ZoneAuthzService } from '../zones/zone-authz.service';
import type { ZoneCountsService } from '../zones/zone-counts.service';
import { ListAccessService } from './list-access.service';
import { ListService } from './list.service';
import { SharedListGrantService } from './shared-list-grant.service';

/**
 * A list open to its group stays open to it (plan 0042, section 2).
 *
 * Sharing used to be an action `create` took once and then forgot, so the
 * ordinary way a household uses this product, one person sets it up, makes the
 * lists, and then invites everybody else, produced a member who could see
 * nothing at all. These are the three moments that grant, and the two that
 * deliberately do not: turning sharing off, and a staff membership.
 *
 * The store below is a small in memory Postgres rather than a mock, because
 * every assertion here is about which rows exist afterwards, and a mock deep
 * enough to fake a query builder is a mock that can be made to agree with
 * anything.
 */

const ZONE = 'z1';
const SHARED_A = 'l-shared-a';
const SHARED_B = 'l-shared-b';
const PRIVATE = 'l-private';
const CALLER = 'u-owner';

const SHARED_SET = [
  ListPermission.READ,
  ListPermission.WRITE,
  ListPermission.DECIDE,
];

interface World {
  lists: ShoppingList[];
  memberships: Membership[];
  access: ListAccess[];
}

function makeWorld(overrides: Partial<World> = {}): World {
  const list = (id: string, sharedWithZone: boolean): ShoppingList =>
    ({
      id,
      zoneId: ZONE,
      name: id,
      createdByUserId: CALLER,
      autoApproveLines: false,
      sharedWithZone,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    }) as ShoppingList;

  const member = (
    id: string,
    role: ZoneRole,
    status = MembershipStatus.APPROVED
  ): Membership =>
    ({ id, zoneId: ZONE, userId: `u-${id}`, role, status }) as Membership;

  return {
    lists: [list(SHARED_A, true), list(SHARED_B, true), list(PRIVATE, false)],
    memberships: [
      member('m-owner', ZoneRole.OWNER),
      member('m-admin', ZoneRole.ADMIN),
      member('m-1', ZoneRole.MEMBER),
      member('m-2', ZoneRole.MEMBER),
      member('m-pending', ZoneRole.MEMBER, MembershipStatus.PENDING),
    ],
    access: [],
    ...overrides,
  };
}

/**
 * An `EntityManager` over the world, supporting exactly the operations the grant
 * performs: find lists by zone and sharing, find one access row, save one, and
 * the membership query builder behind `grantableMembershipIds`.
 */
function managerFor(world: World): EntityManager {
  let nextId = 1;
  return {
    getRepository(entity: unknown) {
      if (entity === ShoppingList) {
        return {
          find: async ({ where }: { where: Partial<ShoppingList> }) =>
            world.lists.filter(
              (l) =>
                l.zoneId === where.zoneId &&
                l.sharedWithZone === where.sharedWithZone
            ),
          save: async (list: ShoppingList) => list,
        };
      }
      if (entity === ListAccess) {
        return {
          findOne: async ({
            where,
          }: {
            where: { listId: string; membershipId: string };
          }) =>
            world.access.find(
              (a) =>
                a.listId === where.listId &&
                a.membershipId === where.membershipId
            ) ?? null,
          create: (data: Partial<ListAccess>) => ({ ...data }) as ListAccess,
          save: async (row: ListAccess) => {
            if (!row.id) {
              row.id = `a-${nextId++}`;
              world.access.push(row);
            }
            return row;
          },
        };
      }
      if (entity === ZoneMembership) {
        return {
          findOne: async ({ where }: { where: { id: string } }) =>
            world.memberships.find((m) => m.id === where.id) ?? null,
          save: async (row: Membership) => row,
          createQueryBuilder: () => {
            const predicates: ((m: Membership) => boolean)[] = [];
            const qb = {
              select: () => qb,
              where: () => {
                predicates.push((m) => m.zoneId === ZONE);
                return qb;
              },
              andWhere: (clause: string, params: Record<string, unknown>) => {
                if (clause.includes('status')) {
                  predicates.push((m) => m.status === params['status']);
                } else if (clause.includes('role')) {
                  const staff = params['staff'] as ZoneRole[];
                  predicates.push((m) => !staff.includes(m.role));
                } else {
                  predicates.push((m) => m.id !== params['exceptMembershipId']);
                }
                return qb;
              },
              getRawMany: async () =>
                world.memberships
                  .filter((m) => predicates.every((p) => p(m)))
                  .map((m) => ({ id: m.id })),
            };
            return qb;
          },
        };
      }
      throw new Error('unexpected repository');
    },
  } as unknown as EntityManager;
}

function permissionsOn(world: World, listId: string, membershipId: string) {
  return world.access.find(
    (a) => a.listId === listId && a.membershipId === membershipId
  )?.permissions;
}

describe('a member approved into a zone (plan 0042, section 2.3)', () => {
  it('is granted the shared lists and nothing else', async () => {
    const world = makeWorld();
    const manager = managerFor(world);

    await new SharedListGrantService().grantZoneSharedLists(
      manager,
      ZONE,
      'm-1'
    );

    expect(world.access.map((a) => a.listId).sort()).toEqual(
      [SHARED_A, SHARED_B].sort()
    );
    expect(permissionsOn(world, SHARED_A, 'm-1')).toEqual(SHARED_SET);
    expect(permissionsOn(world, PRIVATE, 'm-1')).toBeUndefined();
  });

  it('grants nothing in a zone that shares nothing', async () => {
    const world = makeWorld();
    for (const list of world.lists) {
      list.sharedWithZone = false;
    }

    await new SharedListGrantService().grantZoneSharedLists(
      managerFor(world),
      ZONE,
      'm-1'
    );

    expect(world.access).toHaveLength(0);
  });
});

describe('MembershipService.approve (plan 0042, section 2.3)', () => {
  it('grants the zone shared lists in the same transaction as the status change', async () => {
    // The report this half of the plan exists for: one person sets the group up,
    // makes the lists, and then invites everybody else, and every one of those
    // invitations used to produce a member who could see nothing at all.
    const world = makeWorld();
    const pending = {
      ...world.memberships.find((m) => m.id === 'm-pending'),
      // The timestamps the database would have stamped: `toMembershipView` reads
      // them on the way out of `approve`.
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    };
    const manager = managerFor(world);
    let insideTransaction = false;
    let grantedInsideTransaction = false;

    // The real grant, watched: what matters is that it ran while the transaction
    // was open, because a grant written outside it could survive a rolled back
    // approval.
    const grant = new SharedListGrantService();
    const watched = {
      grantZoneSharedLists: (
        ...args: Parameters<SharedListGrantService['grantZoneSharedLists']>
      ) => {
        grantedInsideTransaction = insideTransaction;
        return grant.grantZoneSharedLists(...args);
      },
    } as unknown as SharedListGrantService;

    const dataSource = {
      transaction: async <T>(run: (m: EntityManager) => Promise<T>) => {
        insideTransaction = true;
        try {
          return await run(manager);
        } finally {
          insideTransaction = false;
        }
      },
    } as unknown as DataSource;

    const memberships = { findOne: async () => pending };

    const service = new MembershipService(
      dataSource,
      memberships as never,
      {
        requireRole: async () => ({ role: ZoneRole.OWNER }),
      } as unknown as ZoneAuthzService,
      watched,
      { emitZoneCounts: async () => undefined } as unknown as ZoneCountsService,
      {
        emit: () => undefined,
        emitTo: () => undefined,
      } as unknown as CoreEventsPublisher,
      // This is the member facing approval, which records nothing.
      {} as never
    );

    await service.approve({
      userId: CALLER,
      zoneId: ZONE,
      membershipId: 'm-pending',
    });

    // Two shared lists and one private one, so exactly two rows.
    expect(world.access.map((a) => a.listId).sort()).toEqual(
      [SHARED_A, SHARED_B].sort()
    );
    expect(world.access.every((a) => a.membershipId === 'm-pending')).toBe(
      true
    );
    expect(grantedInsideTransaction).toBe(true);
  });
});

describe('flipping sharing on (plan 0042, section 2.2)', () => {
  it('grants everybody currently approved, and no group staff', async () => {
    const world = makeWorld();

    await new SharedListGrantService().grantListToZone(
      managerFor(world),
      world.lists[0]
    );

    expect(world.access.map((a) => a.membershipId).sort()).toEqual([
      'm-1',
      'm-2',
    ]);
  });

  it('never narrows a row that already holds more', async () => {
    // A grant is a union, not a replacement. Somebody who holds MANAGE on the
    // list keeps it: the flip is not somebody deciding what one person may do,
    // which is what the share sheet is for.
    const world = makeWorld({
      access: [
        {
          id: 'a-existing',
          listId: SHARED_A,
          membershipId: 'm-1',
          permissions: [ListPermission.READ, ListPermission.MANAGE],
        } as ListAccess,
      ],
    });

    await new SharedListGrantService().grantListToZone(
      managerFor(world),
      world.lists[0]
    );

    expect(permissionsOn(world, SHARED_A, 'm-1')).toEqual([
      ListPermission.READ,
      ListPermission.WRITE,
      ListPermission.DECIDE,
      ListPermission.MANAGE,
    ]);
  });

  it('leaves a row that already says everything completely alone', async () => {
    const existing = {
      id: 'a-existing',
      listId: SHARED_A,
      membershipId: 'm-1',
      permissions: [...SHARED_SET],
    } as ListAccess;
    const world = makeWorld({ access: [existing] });

    const granted = await new SharedListGrantService().grantListToZone(
      managerFor(world),
      world.lists[0]
    );

    // Only m-2 was actually reached, so only m-2 is worth an event.
    expect(granted.map((g) => g.membershipId)).toEqual(['m-2']);
    expect(world.access.filter((a) => a.membershipId === 'm-1')).toEqual([
      existing,
    ]);
  });
});

/**
 * The whole of `update`'s half, through the service rather than the grant, so the
 * transition and the events are covered as well as the rows.
 */
function listServiceFor(world: World) {
  const manager = managerFor(world);
  const dataSource = {
    transaction: async <T>(run: (m: EntityManager) => Promise<T>) =>
      run(manager),
  } as unknown as DataSource;

  const memberships = {
    findOne: async ({ where }: { where: Record<string, unknown> }) =>
      world.memberships.find((m) =>
        Object.entries(where).every(
          ([key, value]) => m[key as keyof Membership] === value
        )
      ) ?? null,
  };
  const lists = {
    findOne: async ({ where }: { where: { id: string } }) =>
      world.lists.find((l) => l.id === where.id) ?? null,
    createQueryBuilder: () => {
      const qb = {
        select: () => qb,
        where: () => qb,
        getRawOne: async () => null,
      };
      return qb;
    },
  };
  const accessRepo = {
    findOne: async ({
      where,
    }: {
      where: { listId: string; membershipId: string };
    }) =>
      world.access.find(
        (a) =>
          a.listId === where.listId && a.membershipId === where.membershipId
      ) ?? null,
  };

  const emitted: { event: RealtimeEvent; payload: unknown }[] = [];
  const authz = new ZoneAuthzService(memberships as never);
  const service = new ListService(
    dataSource,
    lists as never,
    accessRepo as never,
    authz,
    new ListAccessService(
      lists as never,
      accessRepo as never,
      {} as never,
      authz
    ),
    new SharedListGrantService(),
    { emitZoneCounts: async () => undefined } as unknown as ZoneCountsService,
    {
      emit: (event: RealtimeEvent, _zoneId: string, payload: unknown) =>
        emitted.push({ event, payload }),
      emitTo: (event: RealtimeEvent, _audience: unknown, payload: unknown) =>
        emitted.push({ event, payload }),
    } as unknown as CoreEventsPublisher,
    // These are the member facing edits, which record nothing.
    {} as never
  );
  return { service, emitted };
}

describe('ListService.update and the sharing switch', () => {
  const owner = { userId: 'u-m-owner', listId: PRIVATE };

  it('grants everybody when it goes false to true', async () => {
    const world = makeWorld();
    const { service } = listServiceFor(world);

    await service.update({ ...owner, sharedWithZone: true });

    expect(world.lists[2].sharedWithZone).toBe(true);
    expect(
      world.access
        .filter((a) => a.listId === PRIVATE)
        .map((a) => a.membershipId)
        .sort()
    ).toEqual(['m-1', 'm-2']);
  });

  it('tells each person their own access changed', async () => {
    // Unlike the approval grant, nothing else tells them: they are already
    // members looking at a zone they have no reason to refetch, which is exactly
    // the case plan 0036 section 8 names.
    const world = makeWorld();
    const { service, emitted } = listServiceFor(world);

    await service.update({ ...owner, sharedWithZone: true });

    const mine = emitted.filter(
      (e) => e.event === RealtimeEvent.ListMyAccessChanged
    );
    expect(mine).toHaveLength(2);
    expect(mine[0].payload).toMatchObject({
      listId: PRIVATE,
      zoneId: ZONE,
      permissions: SHARED_SET,
    });
  });

  it('revokes nobody when it goes true to false', async () => {
    // The row most likely to be argued with (plan 0042, section 2.2). The switch
    // is about who arrives next; somebody who turns it off to stop new members
    // getting in must not thereby remove eight people from a list they have been
    // using all week.
    const world = makeWorld({
      access: [
        {
          id: 'a-1',
          listId: SHARED_A,
          membershipId: 'm-1',
          permissions: [...SHARED_SET],
        } as ListAccess,
        {
          id: 'a-2',
          listId: SHARED_A,
          membershipId: 'm-2',
          permissions: [...SHARED_SET],
        } as ListAccess,
      ],
    });
    const before = world.access.length;
    const { service, emitted } = listServiceFor(world);

    await service.update({
      userId: 'u-m-owner',
      listId: SHARED_A,
      sharedWithZone: false,
    });

    expect(world.lists[0].sharedWithZone).toBe(false);
    expect(world.access).toHaveLength(before);
    expect(
      emitted.filter((e) => e.event === RealtimeEvent.ListMyAccessChanged)
    ).toHaveLength(0);
  });

  it('re-grants nobody when it was already true', async () => {
    const world = makeWorld({
      access: [
        {
          id: 'a-1',
          listId: SHARED_A,
          membershipId: 'm-1',
          permissions: [...SHARED_SET],
        } as ListAccess,
      ],
    });
    const { service, emitted } = listServiceFor(world);

    await service.update({
      userId: 'u-m-owner',
      listId: SHARED_A,
      sharedWithZone: true,
    });

    expect(world.access.map((a) => a.membershipId)).toEqual(['m-1']);
    expect(
      emitted.filter((e) => e.event === RealtimeEvent.ListMyAccessChanged)
    ).toHaveLength(0);
  });
});
