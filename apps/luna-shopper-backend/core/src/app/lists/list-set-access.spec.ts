import {
  ListPermission,
  MembershipStatus,
  RealtimeEvent,
  ZoneRole,
  type ListMyAccessChangedEvent,
} from '@portfolio/luna-shopper/contracts';
import type { DataSource, EntityManager } from 'typeorm';
import {
  ListAccess,
  ShoppingList,
  ZoneMembership,
  type ZoneMembership as Membership,
} from '../entities';
import type {
  CoreEventsPublisher,
  EventAudience,
} from '../events/core-events.publisher';
import { ZoneAuthzService } from '../zones/zone-authz.service';
import type { ZoneCountsService } from '../zones/zone-counts.service';
import { ListAccessService } from './list-access.service';
import { ListService } from './list.service';
import { SharedListGrantService } from './shared-list-grant.service';

/**
 * Who may grant what, and what the people affected are told (plan 0036, sections
 * 5 and 8; acceptance items 7, 8 and 9).
 *
 * The five rules are ordered, and the order is the part worth testing: rule 3 is
 * checked before rule 5 applies, so clearing a row that holds `MANAGE` is a
 * `MANAGE` change and not a free pass through the empty set. Section 5.1 calls
 * that out as the obvious hole in the other order.
 *
 * Doubles in the style of `list-create-sharing.spec.ts`: the transaction manager
 * records what was written, so the assertions are about rows rather than about
 * which methods were called on a mock.
 */

const LIST_ID = 'l1';
const ZONE_ID = 'z1';
const CALLER = 'u-caller';

interface Written {
  saved: Partial<ListAccess>[];
  deleted: string[];
}

interface Emitted {
  event: RealtimeEvent;
  audience: EventAudience | { zoneId: string; listId?: string };
  payload: unknown;
}

/** One membership in the zone, as the double's `ZoneMembership` repository sees it. */
interface Member {
  id: string;
  userId: string;
  role: ZoneRole;
  zoneId?: string;
}

function build(options: {
  /** The caller's own zone role. Staff hold all four and may set MANAGE. */
  callerRole: ZoneRole;
  /** The caller's stored row, or null when they rely on the staff grant. */
  callerPermissions?: ListPermission[] | null;
  /** Everybody the entries can name. */
  members: Member[];
  /** Existing rows, keyed by membership id. */
  existing?: Record<string, ListPermission[]>;
}) {
  const written: Written = { saved: [], deleted: [] };
  const emitted: Emitted[] = [];

  const list = {
    id: LIST_ID,
    zoneId: ZONE_ID,
    name: 'Groceries',
    createdByUserId: 'the-creator',
    autoApproveLines: false,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  } as ShoppingList;

  const callerMembership = {
    id: 'm-caller',
    zoneId: ZONE_ID,
    userId: CALLER,
    role: options.callerRole,
    status: MembershipStatus.APPROVED,
  } as Membership;

  const memberships = {
    findOne: async ({ where }: { where: Record<string, unknown> }) => {
      if (where['userId'] === CALLER) {
        return callerMembership;
      }
      const found = options.members.find((m) => m.id === where['id']);
      return found
        ? ({
            ...found,
            zoneId: found.zoneId ?? ZONE_ID,
            status: MembershipStatus.APPROVED,
          } as Membership)
        : null;
    },
  };

  const rows = new Map<string, ListAccess>();
  for (const [membershipId, permissions] of Object.entries(
    options.existing ?? {}
  )) {
    rows.set(membershipId, {
      id: `a-${membershipId}`,
      listId: LIST_ID,
      membershipId,
      permissions,
    } as ListAccess);
  }
  if (options.callerPermissions) {
    rows.set('m-caller', {
      id: 'a-caller',
      listId: LIST_ID,
      membershipId: 'm-caller',
      permissions: options.callerPermissions,
    } as ListAccess);
  }

  const accessRepo = {
    findOne: async ({ where }: { where: { membershipId: string } }) =>
      rows.get(where.membershipId) ?? null,
    create: (data: Partial<ListAccess>) => ({ ...data }),
    save: async (row: Partial<ListAccess>) => {
      written.saved.push({ ...row });
      return row;
    },
    delete: async ({ id }: { id: string }) => {
      written.deleted.push(id);
      return { affected: 1 };
    },
    find: async () => [...rows.values()],
    /**
     * The read `getAccess` performs, which is a join rather than a `find` since
     * plan 0042: the rows whose membership is **currently** not group staff.
     *
     * The double resolves the role through the same membership store the service
     * would join to, so a row for a member promoted to admin disappears here for
     * the same reason it disappears in Postgres.
     */
    createQueryBuilder: () => {
      const roleOf = (membershipId: string): ZoneRole =>
        membershipId === 'm-caller'
          ? options.callerRole
          : (options.members.find((m) => m.id === membershipId)?.role ??
            ZoneRole.MEMBER);
      const qb = {
        innerJoin: () => qb,
        where: () => qb,
        andWhere: () => qb,
        orderBy: () => qb,
        addOrderBy: () => qb,
        getMany: async () =>
          [...rows.values()].filter((row) => {
            const role = roleOf(row.membershipId);
            return role !== ZoneRole.OWNER && role !== ZoneRole.ADMIN;
          }),
      };
      return qb;
    },
  };

  const manager = {
    getRepository(entity: unknown) {
      if (entity === ListAccess) return accessRepo;
      if (entity === ZoneMembership) return memberships;
      throw new Error('unexpected repository');
    },
  } as unknown as EntityManager;

  const dataSource = {
    transaction: async <T>(run: (m: EntityManager) => Promise<T>) =>
      run(manager),
  } as unknown as DataSource;

  const authz = new ZoneAuthzService(memberships as never);
  const listAccess = new ListAccessService(
    { findOne: async () => list } as never,
    accessRepo as never,
    {} as never,
    authz
  );

  const events = {
    emit: (
      event: RealtimeEvent,
      zoneId: string,
      payload: unknown,
      listId?: string
    ) => emitted.push({ event, audience: { zoneId, listId }, payload }),
    emitTo: (event: RealtimeEvent, audience: EventAudience, payload: unknown) =>
      emitted.push({ event, audience, payload }),
  } as unknown as CoreEventsPublisher;

  const service = new ListService(
    dataSource,
    { findOne: async () => list } as never,
    accessRepo as never,
    authz,
    listAccess,
    new SharedListGrantService(),
    { emitZoneCounts: async () => undefined } as unknown as ZoneCountsService,
    events,
    // No operator write here, so nothing reaches the trail.
    {} as never
  );

  return { service, written, emitted };
}

const MEMBER: Member = { id: 'm-2', userId: 'u-2', role: ZoneRole.MEMBER };
const OTHER: Member = { id: 'm-3', userId: 'u-3', role: ZoneRole.MEMBER };
const GROUP_ADMIN: Member = { id: 'm-4', userId: 'u-4', role: ZoneRole.ADMIN };

describe('rule 1: the caller holds MANAGE', () => {
  it('refuses a caller who holds write and decide but not manage', async () => {
    const { service } = build({
      callerRole: ZoneRole.MEMBER,
      callerPermissions: [
        ListPermission.READ,
        ListPermission.WRITE,
        ListPermission.DECIDE,
      ],
      members: [MEMBER],
    });

    await expect(
      service.setAccess({
        userId: CALLER,
        listId: LIST_ID,
        entries: [{ membershipId: 'm-2', permissions: [ListPermission.READ] }],
      })
    ).rejects.toThrow();
  });

  it('admits a list admin who is not group staff', async () => {
    const { service, written } = build({
      callerRole: ZoneRole.MEMBER,
      callerPermissions: [ListPermission.READ, ListPermission.MANAGE],
      members: [MEMBER],
    });

    await service.setAccess({
      userId: CALLER,
      listId: LIST_ID,
      entries: [{ membershipId: 'm-2', permissions: [ListPermission.WRITE] }],
    });

    expect(written.saved).toHaveLength(1);
  });
});

describe('rule 2: an entry naming group staff is rejected (acceptance 7)', () => {
  it('refuses a list admin trying to revoke a group admin', async () => {
    const { service } = build({
      callerRole: ZoneRole.MEMBER,
      callerPermissions: [ListPermission.READ, ListPermission.MANAGE],
      members: [GROUP_ADMIN],
    });

    await expect(
      service.setAccess({
        userId: CALLER,
        listId: LIST_ID,
        entries: [{ membershipId: 'm-4', permissions: [] }],
      })
    ).rejects.toThrow(/group admin/i);
  });

  it('refuses a group admin naming another one, because the row is meaningless either way', async () => {
    // The asymmetry the requirement draws between a list admin and a group admin
    // is about **other** rows, not about staff rows (plan 0036, section 2.4).
    const { service } = build({
      callerRole: ZoneRole.OWNER,
      members: [GROUP_ADMIN],
    });

    await expect(
      service.setAccess({
        userId: CALLER,
        listId: LIST_ID,
        entries: [{ membershipId: 'm-4', permissions: [ListPermission.WRITE] }],
      })
    ).rejects.toThrow(/group admin/i);
  });

  it('refuses an entry naming somebody in another group entirely', async () => {
    const { service } = build({
      callerRole: ZoneRole.OWNER,
      members: [{ ...OTHER, zoneId: 'another-zone' }],
    });

    await expect(
      service.setAccess({
        userId: CALLER,
        listId: LIST_ID,
        entries: [{ membershipId: 'm-3', permissions: [ListPermission.READ] }],
      })
    ).rejects.toThrow();
  });
});

describe('rule 3: only group staff may move the MANAGE bit (acceptance 8)', () => {
  it('refuses a list admin granting MANAGE to a fourth member', async () => {
    const { service } = build({
      callerRole: ZoneRole.MEMBER,
      callerPermissions: [ListPermission.READ, ListPermission.MANAGE],
      members: [OTHER],
    });

    await expect(
      service.setAccess({
        userId: CALLER,
        listId: LIST_ID,
        entries: [
          { membershipId: 'm-3', permissions: [ListPermission.MANAGE] },
        ],
      })
    ).rejects.toThrow(/group admin/i);
  });

  it('refuses a list admin removing MANAGE from the creator', async () => {
    // Symmetric on purpose: revoking it is the same power as granting it.
    const { service } = build({
      callerRole: ZoneRole.MEMBER,
      callerPermissions: [ListPermission.READ, ListPermission.MANAGE],
      members: [MEMBER],
      existing: {
        'm-2': [ListPermission.READ, ListPermission.MANAGE],
      },
    });

    await expect(
      service.setAccess({
        userId: CALLER,
        listId: LIST_ID,
        entries: [{ membershipId: 'm-2', permissions: [ListPermission.WRITE] }],
      })
    ).rejects.toThrow(/group admin/i);
  });

  it('lets that same list admin grant read and write in the same sheet', async () => {
    const { service, written } = build({
      callerRole: ZoneRole.MEMBER,
      callerPermissions: [ListPermission.READ, ListPermission.MANAGE],
      members: [OTHER],
    });

    await service.setAccess({
      userId: CALLER,
      listId: LIST_ID,
      entries: [
        {
          membershipId: 'm-3',
          permissions: [ListPermission.READ, ListPermission.WRITE],
        },
      ],
    });

    expect(written.saved[0].permissions).toEqual([
      ListPermission.READ,
      ListPermission.WRITE,
    ]);
  });

  it('lets a group admin grant the MANAGE that was refused', async () => {
    const { service, written } = build({
      callerRole: ZoneRole.ADMIN,
      members: [OTHER],
    });

    await service.setAccess({
      userId: CALLER,
      listId: LIST_ID,
      entries: [{ membershipId: 'm-3', permissions: [ListPermission.MANAGE] }],
    });

    // MANAGE arrives alone and is stored with the rest, per rule 4: a list admin
    // has all the other permissions (section 2.2).
    expect(written.saved[0].permissions).toEqual([
      ListPermission.READ,
      ListPermission.WRITE,
      ListPermission.DECIDE,
      ListPermission.MANAGE,
    ]);
  });

  it('lets a list admin rewrite a row that keeps its MANAGE untouched', async () => {
    // The bit did not move, so rule 3 has nothing to say about it.
    const { service, written } = build({
      callerRole: ZoneRole.MEMBER,
      callerPermissions: [ListPermission.READ, ListPermission.MANAGE],
      members: [MEMBER],
      existing: { 'm-2': [ListPermission.READ, ListPermission.MANAGE] },
    });

    await service.setAccess({
      userId: CALLER,
      listId: LIST_ID,
      entries: [
        {
          membershipId: 'm-2',
          permissions: [ListPermission.WRITE, ListPermission.MANAGE],
        },
      ],
    });

    expect(written.saved[0].permissions).toEqual([
      ListPermission.READ,
      ListPermission.WRITE,
      ListPermission.DECIDE,
      ListPermission.MANAGE,
    ]);
  });
});

describe('rule 4: the two implications are stored, not implied at every read', () => {
  it('gives a MANAGE grant the WRITE and DECIDE that go with it', async () => {
    // Section 2.2. Without this a group admin could grant `{READ, MANAGE}` in one
    // tap and create somebody who may delete any line on the list and decide who
    // else may use it, yet may not add one.
    const { service, written } = build({
      callerRole: ZoneRole.OWNER,
      members: [MEMBER],
    });

    await service.setAccess({
      userId: CALLER,
      listId: LIST_ID,
      entries: [{ membershipId: 'm-2', permissions: [ListPermission.MANAGE] }],
    });

    expect(written.saved[0].permissions).toEqual([
      ListPermission.READ,
      ListPermission.WRITE,
      ListPermission.DECIDE,
      ListPermission.MANAGE,
    ]);
  });

  it('leaves a set without MANAGE alone but for READ', async () => {
    const { service, written } = build({
      callerRole: ZoneRole.OWNER,
      members: [MEMBER],
    });

    await service.setAccess({
      userId: CALLER,
      listId: LIST_ID,
      entries: [{ membershipId: 'm-2', permissions: [ListPermission.DECIDE] }],
    });

    expect(written.saved[0].permissions).toEqual([
      ListPermission.READ,
      ListPermission.DECIDE,
    ]);
  });

  it('stores READ beside a set that only asked for WRITE', async () => {
    const { service, written } = build({
      callerRole: ZoneRole.OWNER,
      members: [MEMBER],
    });

    await service.setAccess({
      userId: CALLER,
      listId: LIST_ID,
      entries: [{ membershipId: 'm-2', permissions: [ListPermission.WRITE] }],
    });

    expect(written.saved[0].permissions).toContain(ListPermission.READ);
  });

  it('does not widen an empty set, because that is a request to delete the row', async () => {
    const { service, written } = build({
      callerRole: ZoneRole.OWNER,
      members: [MEMBER],
      existing: { 'm-2': [ListPermission.READ, ListPermission.WRITE] },
    });

    await service.setAccess({
      userId: CALLER,
      listId: LIST_ID,
      entries: [{ membershipId: 'm-2', permissions: [] }],
    });

    expect(written.saved).toHaveLength(0);
    expect(written.deleted).toEqual(['a-m-2']);
  });

  it('drops duplicates and stores one fixed order', async () => {
    const { service, written } = build({
      callerRole: ZoneRole.OWNER,
      members: [MEMBER],
    });

    await service.setAccess({
      userId: CALLER,
      listId: LIST_ID,
      entries: [
        {
          membershipId: 'm-2',
          permissions: [
            ListPermission.DECIDE,
            ListPermission.READ,
            ListPermission.DECIDE,
          ],
        },
      ],
    });

    expect(written.saved[0].permissions).toEqual([
      ListPermission.READ,
      ListPermission.DECIDE,
    ]);
  });
});

describe('rule 5, and its interaction with rule 3 (section 5.1)', () => {
  it('refuses a non-staff list admin clearing a row that holds MANAGE', async () => {
    // The hole the rule order exists to close: an empty set is a MANAGE change
    // like any other, and checking rule 5 first would let it through.
    const { service, written } = build({
      callerRole: ZoneRole.MEMBER,
      callerPermissions: [ListPermission.READ, ListPermission.MANAGE],
      members: [MEMBER],
      existing: { 'm-2': [ListPermission.READ, ListPermission.MANAGE] },
    });

    await expect(
      service.setAccess({
        userId: CALLER,
        listId: LIST_ID,
        entries: [{ membershipId: 'm-2', permissions: [] }],
      })
    ).rejects.toThrow(/group admin/i);
    expect(written.deleted).toEqual([]);
  });

  it('lets a group admin revoke the creator entirely (acceptance 7)', async () => {
    const { service, written } = build({
      callerRole: ZoneRole.OWNER,
      members: [MEMBER],
      existing: {
        'm-2': [
          ListPermission.READ,
          ListPermission.WRITE,
          ListPermission.DECIDE,
          ListPermission.MANAGE,
        ],
      },
    });

    await service.setAccess({
      userId: CALLER,
      listId: LIST_ID,
      entries: [{ membershipId: 'm-2', permissions: [] }],
    });

    expect(written.deleted).toEqual(['a-m-2']);
  });

  it('is a no-op rather than an error when there was no row to clear', async () => {
    const { service, written } = build({
      callerRole: ZoneRole.OWNER,
      members: [MEMBER],
    });

    await service.setAccess({
      userId: CALLER,
      listId: LIST_ID,
      entries: [{ membershipId: 'm-2', permissions: [] }],
    });

    expect(written.deleted).toEqual([]);
    expect(written.saved).toEqual([]);
  });
});

describe('what goes out afterwards (plan 0036, section 8)', () => {
  it('still tells the list room the access table changed', async () => {
    const { service, emitted } = build({
      callerRole: ZoneRole.OWNER,
      members: [MEMBER],
    });

    await service.setAccess({
      userId: CALLER,
      listId: LIST_ID,
      entries: [{ membershipId: 'm-2', permissions: [ListPermission.READ] }],
    });

    const room = emitted.find(
      (e) => e.event === RealtimeEvent.ListAccessChanged
    );
    expect(room?.payload).toEqual({ listId: LIST_ID });
  });

  it('tells each affected person their own new effective set', async () => {
    // One event per person, not one for all of them, because the payload is that
    // person's own set and no two need be the same.
    const { service, emitted } = build({
      callerRole: ZoneRole.OWNER,
      members: [MEMBER, OTHER],
    });

    await service.setAccess({
      userId: CALLER,
      listId: LIST_ID,
      entries: [
        { membershipId: 'm-2', permissions: [ListPermission.WRITE] },
        { membershipId: 'm-3', permissions: [ListPermission.DECIDE] },
      ],
    });

    const mine = emitted.filter(
      (e) => e.event === RealtimeEvent.ListMyAccessChanged
    );
    expect(mine).toHaveLength(2);
    expect(mine.map((e) => (e.audience as EventAudience).userIds)).toEqual([
      ['u-2'],
      ['u-3'],
    ]);
    expect(
      mine.map((e) => (e.payload as ListMyAccessChangedEvent).permissions)
    ).toEqual([
      [ListPermission.READ, ListPermission.WRITE],
      [ListPermission.READ, ListPermission.DECIDE],
    ]);
  });

  it('addresses the event to the person, so somebody just granted access hears it', async () => {
    // The room event names nobody and by construction cannot reach them: they
    // were never in the room.
    const { service, emitted } = build({
      callerRole: ZoneRole.OWNER,
      members: [MEMBER],
    });

    await service.setAccess({
      userId: CALLER,
      listId: LIST_ID,
      entries: [{ membershipId: 'm-2', permissions: [ListPermission.READ] }],
    });

    const mine = emitted.find(
      (e) => e.event === RealtimeEvent.ListMyAccessChanged
    );
    const audience = mine?.audience as EventAudience;
    expect(audience.userIds).toEqual(['u-2']);
    expect(audience.zoneId).toBe(ZONE_ID);
    expect(audience.listId).toBe(LIST_ID);
  });

  it('carries an empty array for somebody who just lost the list', async () => {
    const { service, emitted } = build({
      callerRole: ZoneRole.OWNER,
      members: [MEMBER],
      existing: { 'm-2': [ListPermission.READ, ListPermission.WRITE] },
    });

    await service.setAccess({
      userId: CALLER,
      listId: LIST_ID,
      entries: [{ membershipId: 'm-2', permissions: [] }],
    });

    const mine = emitted.find(
      (e) => e.event === RealtimeEvent.ListMyAccessChanged
    );
    expect((mine?.payload as ListMyAccessChangedEvent).permissions).toEqual([]);
  });
});

describe('reading the access table back (acceptance 9)', () => {
  it('returns the stored rows to a MANAGE holder', async () => {
    const { service } = build({
      callerRole: ZoneRole.MEMBER,
      callerPermissions: [ListPermission.READ, ListPermission.MANAGE],
      members: [MEMBER],
      existing: { 'm-2': [ListPermission.READ, ListPermission.WRITE] },
    });

    const view = await service.getAccess({ userId: CALLER, listId: LIST_ID });

    expect(view.listId).toBe(LIST_ID);
    expect(view.entries).toContainEqual({
      membershipId: 'm-2',
      permissions: [ListPermission.READ, ListPermission.WRITE],
    });
  });

  it('refuses a WRITE holder', async () => {
    const { service } = build({
      callerRole: ZoneRole.MEMBER,
      callerPermissions: [ListPermission.READ, ListPermission.WRITE],
      members: [MEMBER],
    });

    await expect(
      service.getAccess({ userId: CALLER, listId: LIST_ID })
    ).rejects.toThrow();
  });

  it('never puts group staff in an entry, because there is no row to return', async () => {
    const { service } = build({
      callerRole: ZoneRole.ADMIN,
      members: [MEMBER, GROUP_ADMIN],
      existing: { 'm-2': [ListPermission.READ] },
    });

    const view = await service.getAccess({ userId: CALLER, listId: LIST_ID });

    expect(view.entries.map((e) => e.membershipId)).toEqual(['m-2']);
  });

  it('hides a staff row that IS in the table (plan 0042, section 1.2)', async () => {
    // The defect. Creation wrote the creator's row whoever they were, and the
    // owner is who creates the first list in a new group, so a staff row was in
    // the table of essentially every list. The read handed it to the share sheet
    // and the write refused it, which is why nobody could save the sheet.
    const { service } = build({
      callerRole: ZoneRole.OWNER,
      members: [MEMBER, GROUP_ADMIN],
      existing: {
        'm-2': [ListPermission.READ],
        'm-4': [
          ListPermission.READ,
          ListPermission.WRITE,
          ListPermission.DECIDE,
        ],
      },
    });

    const view = await service.getAccess({ userId: CALLER, listId: LIST_ID });

    expect(view.entries.map((e) => e.membershipId)).toEqual(['m-2']);
  });

  it('drops a member promoted to admin, and returns them unchanged when demoted', async () => {
    // Current role, not anything recorded on the row (plan 0042, section 1.2). A
    // promoted member's row is inert, because the derived grant is wider than
    // anything it says; demoted, the same row is meaningful again and comes back
    // holding exactly what they held before, which is free and is the best
    // available answer.
    const stored = { 'm-2': [ListPermission.READ, ListPermission.WRITE] };

    const promoted = build({
      callerRole: ZoneRole.OWNER,
      members: [{ ...MEMBER, role: ZoneRole.ADMIN }],
      existing: stored,
    });
    await expect(
      promoted.service.getAccess({ userId: CALLER, listId: LIST_ID })
    ).resolves.toMatchObject({ entries: [] });

    const demoted = build({
      callerRole: ZoneRole.OWNER,
      members: [MEMBER],
      existing: stored,
    });
    await expect(
      demoted.service.getAccess({ userId: CALLER, listId: LIST_ID })
    ).resolves.toMatchObject({
      entries: [
        {
          membershipId: 'm-2',
          permissions: [ListPermission.READ, ListPermission.WRITE],
        },
      ],
    });
  });

  it('still refuses an entry naming staff, which rule 2 was not relaxed for', async () => {
    // The assertion that plan 0042 chose (a) and (b) rather than (c). Filtering
    // the read is not permission to write one: a staff row is meaningless, so
    // naming one stays an error even for a caller who is staff themselves.
    const { service, written } = build({
      callerRole: ZoneRole.OWNER,
      members: [GROUP_ADMIN],
    });

    await expect(
      service.setAccess({
        userId: CALLER,
        listId: LIST_ID,
        entries: [{ membershipId: 'm-4', permissions: [ListPermission.READ] }],
      })
    ).rejects.toThrow();
    expect(written.saved).toHaveLength(0);
  });
});
