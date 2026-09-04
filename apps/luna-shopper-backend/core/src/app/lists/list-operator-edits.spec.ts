import {
  ListPermission,
  MembershipStatus,
  RealtimeEvent,
  ZoneRole,
} from '@portfolio/luna-shopper/contracts';
import { fakeAudit, type RecordedChange } from '../audit/core-audit.testing';
import {
  ListAccess,
  ShoppingList,
  ZoneMembership,
  type ZoneMembership as Membership,
} from '../entities';
import type { CoreEventsPublisher } from '../events/core-events.publisher';
import { ZoneAuthzService } from '../zones/zone-authz.service';
import type { ZoneCountsService } from '../zones/zone-counts.service';
import { ListAccessService } from './list-access.service';
import { ListService } from './list.service';
import { SharedListGrantService } from './shared-list-grant.service';

/**
 * An operator's edit of a list is the write its own admin makes (plan 0077,
 * section 5.1).
 *
 * The store below is a small in memory Postgres rather than a mock, because
 * `sharedWithZone` is asserted on the rows in `list_access` afterwards, and a
 * mock deep enough to fake the grant is a mock that can be made to agree with
 * anything. It is the same shape `shared-list-grant.spec.ts` uses, for the same
 * reason.
 */

const ZONE = 'z1';
const LIST = 'l-1';
const OWNER = 'u-owner';

/** The verified admin id the gate hands every operator write (plan 0077, 2). */
const ACTOR = 'admin-1';

const SHARED_SET = [
  ListPermission.READ,
  ListPermission.WRITE,
  ListPermission.DECIDE,
];

const AT = new Date('2026-09-01T10:00:00.000Z');

interface World {
  lists: ShoppingList[];
  memberships: Membership[];
  access: ListAccess[];
  deleted: string[];
}

function makeWorld(sharedWithZone: boolean): World {
  const member = (id: string, role: ZoneRole): Membership =>
    ({
      id,
      zoneId: ZONE,
      userId: `u-${id}`,
      role,
      status: MembershipStatus.APPROVED,
    }) as Membership;

  return {
    lists: [
      {
        id: LIST,
        zoneId: ZONE,
        name: 'Weekly shop',
        createdByUserId: OWNER,
        autoApproveLines: false,
        sharedWithZone,
        createdAt: AT,
        updatedAt: AT,
      } as ShoppingList,
    ],
    memberships: [
      { ...member('m-owner', ZoneRole.OWNER), userId: OWNER } as Membership,
      member('m-1', ZoneRole.MEMBER),
      member('m-2', ZoneRole.MEMBER),
    ],
    access: [],
    deleted: [],
  };
}

interface Harness {
  service: ListService;
  world: World;
  events: [RealtimeEvent, unknown][];
  recorded: RecordedChange[];
}

function makeService(world: World): Harness {
  let nextAccessId = 1;
  const events: [RealtimeEvent, unknown][] = [];

  const lists = {
    findOne: async ({ where }: { where: { id: string } }) =>
      world.lists.find((l) => l.id === where.id) ?? null,
    find: async ({ where }: { where: Partial<ShoppingList> }) =>
      world.lists.filter(
        (l) =>
          l.zoneId === where.zoneId && l.sharedWithZone === where.sharedWithZone
      ),
    save: async (list: ShoppingList) => list,
    delete: async ({ id }: { id: string }) => {
      world.deleted.push(id);
      return { affected: 1 };
    },
    // `countsFor` runs one aggregate and the view carries whatever it says.
    createQueryBuilder: () => {
      const qb = {
        select: () => qb,
        where: () => qb,
        getRawOne: async () => null,
      };
      return qb;
    },
  };
  const access = {
    findOne: async ({
      where,
    }: {
      where: { listId: string; membershipId: string };
    }) =>
      world.access.find(
        (a) =>
          a.listId === where.listId && a.membershipId === where.membershipId
      ) ?? null,
    create: (data: Partial<ListAccess>) => ({ ...data }) as ListAccess,
    save: async (row: ListAccess) => {
      if (!row.id) {
        row.id = `a-${nextAccessId++}`;
        world.access.push(row);
      }
      return row;
    },
  };
  const memberships = {
    findOne: async ({ where }: { where: Record<string, unknown> }) =>
      world.memberships.find((m) =>
        Object.entries(where).every(
          ([key, value]) => m[key as keyof Membership] === value
        )
      ) ?? null,
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

  const authz = new ZoneAuthzService(memberships as never);
  const listAccess = new ListAccessService(
    lists as never,
    access as never,
    {} as never,
    authz
  );
  const publisher = {
    emit: jest.fn((event: RealtimeEvent, _zoneId: string, payload: unknown) => {
      events.push([event, payload]);
    }),
    emitTo: jest.fn(
      (event: RealtimeEvent, _audience: unknown, payload: unknown) => {
        events.push([event, payload]);
      }
    ),
  };
  // Bound to the same three repositories the member facing transaction writes
  // through, so the operator path saves what a list admin's save saves.
  const audit = fakeAudit([
    [ShoppingList, { name: 'shopping_lists', repository: lists as never }],
    [ListAccess, { name: 'list_access', repository: access as never }],
    [
      ZoneMembership,
      { name: 'zone_memberships', repository: memberships as never },
    ],
  ]);
  const manager = { getRepository: (entity: unknown) => bind(entity) };
  function bind(entity: unknown) {
    if (entity === ShoppingList) {
      return lists;
    }
    if (entity === ListAccess) {
      return access;
    }
    return memberships;
  }
  const dataSource = {
    transaction: async <T>(run: (m: unknown) => Promise<T>) => run(manager),
  };

  return {
    service: new ListService(
      dataSource as never,
      lists as never,
      access as never,
      authz,
      listAccess,
      new SharedListGrantService(),
      {
        emitZoneCounts: jest.fn(async () => undefined),
      } as unknown as ZoneCountsService,
      publisher as unknown as CoreEventsPublisher,
      audit.service
    ),
    world,
    events,
    recorded: audit.recorded,
  };
}

describe('an operator edit of a list and its admin’s are one write', () => {
  it('writes the same fields and emits the same event', async () => {
    const viaAdmin = makeService(makeWorld(false));
    const viaOperator = makeService(makeWorld(false));

    const fromAdmin = await viaAdmin.service.update({
      userId: OWNER,
      listId: LIST,
      name: 'Big shop',
      autoApproveLines: true,
    });
    const fromOperator = await viaOperator.service.updateAsOperator(
      LIST,
      { name: 'Big shop', autoApproveLines: true },
      ACTOR
    );

    expect(fromOperator).toEqual(fromAdmin);
    expect(viaOperator.world.lists[0]).toMatchObject({
      name: 'Big shop',
      autoApproveLines: true,
    });
    expect(viaOperator.events).toEqual(viaAdmin.events);
    expect(viaOperator.events[0][0]).toBe(RealtimeEvent.ListUpdated);
  });

  it('grants the zone when sharing goes off to on', async () => {
    const { service, world, events } = makeService(makeWorld(false));

    await service.updateAsOperator(LIST, { sharedWithZone: true }, ACTOR);

    // Every currently approved non staff member, exactly as creation does. The
    // owner is staff and holds all four by derivation, so no row is written.
    expect(world.access.map((a) => a.membershipId).sort()).toEqual([
      'm-1',
      'm-2',
    ]);
    expect(world.access[0].permissions).toEqual(SHARED_SET);
    // One event per person the flip actually reached, since nothing else tells
    // them: they are members looking at a zone they have no reason to refetch.
    expect(
      events.filter(([name]) => name === RealtimeEvent.ListMyAccessChanged)
    ).toHaveLength(2);
  });

  it('revokes nobody when sharing goes on to off', async () => {
    const world = makeWorld(true);
    world.access.push({
      id: 'a-existing',
      listId: LIST,
      membershipId: 'm-1',
      permissions: [...SHARED_SET],
    } as ListAccess);
    const { service } = makeService(world);

    await service.updateAsOperator(LIST, { sharedWithZone: false }, ACTOR);

    // Deliberate and asymmetric (plan 0042, section 2.2). Somebody who turns it
    // off to keep new members out and thereby silently removes everybody from a
    // list they have been using all week has been handed a control that does
    // something other than what it says.
    expect(world.lists[0].sharedWithZone).toBe(false);
    expect(world.access).toHaveLength(1);
    expect(world.access[0].permissions).toEqual(SHARED_SET);
  });

  it('records the fields that moved, against the operator', async () => {
    const { service, recorded } = makeService(makeWorld(false));

    await service.updateAsOperator(LIST, { name: 'Big shop' }, ACTOR);

    expect(recorded).toEqual([
      {
        actorId: ACTOR,
        action: 'UPDATE',
        entity: 'shopping_lists',
        entityId: LIST,
        before: { name: 'Weekly shop' },
        after: { name: 'Big shop' },
      },
    ]);
  });

  it('records nothing for a write that changes nothing', async () => {
    const { service, recorded } = makeService(makeWorld(false));

    await service.updateAsOperator(LIST, { name: 'Weekly shop' }, ACTOR);

    expect(recorded).toEqual([]);
  });

  it('records nothing on the list admin’s own path', async () => {
    const { service, recorded } = makeService(makeWorld(false));

    await service.update({ userId: OWNER, listId: LIST, name: 'Big shop' });

    expect(recorded).toEqual([]);
  });

  it('answers 404 for a list that is not there', async () => {
    const { service } = makeService(makeWorld(false));

    await expect(
      service.updateAsOperator('l-missing', { name: 'x' }, ACTOR)
    ).rejects.toThrow('List not found');
  });
});

describe('an operator delete of a list and its admin’s are one write', () => {
  it('removes the row and announces it to the zone', async () => {
    const viaAdmin = makeService(makeWorld(false));
    const viaOperator = makeService(makeWorld(false));

    const fromAdmin = await viaAdmin.service.delete({
      userId: OWNER,
      listId: LIST,
    });
    const fromOperator = await viaOperator.service.deleteAsOperator(
      LIST,
      ACTOR
    );

    expect(fromOperator).toEqual(fromAdmin);
    expect(viaOperator.world.deleted).toEqual([LIST]);
    expect(viaOperator.events).toEqual(viaAdmin.events);
    expect(viaOperator.events[0][0]).toBe(RealtimeEvent.ListDeleted);
  });

  it('records what the list said, rather than only its id', async () => {
    const { service, recorded } = makeService(makeWorld(false));

    await service.deleteAsOperator(LIST, ACTOR);

    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({
      actorId: ACTOR,
      action: 'DELETE',
      entity: 'shopping_lists',
      entityId: LIST,
      after: null,
    });
    expect(recorded[0].before).toMatchObject({ name: 'Weekly shop' });
  });
});
