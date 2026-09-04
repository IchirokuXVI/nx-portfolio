import {
  LineApprovalStatus,
  MembershipStatus,
  ZoneRole,
  ZoneStatus,
} from '@portfolio/luna-shopper/contracts';
import { ValidationException } from '@portfolio/luna-shopper/platform';
import type { ZoneReaperService } from '../account/zone-reaper.service';
import { ListLine, ShoppingList, Zone, ZoneMembership } from '../entities';
import type { LineService } from '../lists/line.service';
import type { ListService } from '../lists/list.service';
import type { MembershipService } from '../zones/membership.service';
import type { ZoneService } from '../zones/zone.service';
import { AdminListService } from './admin-list.service';
import { AdminZoneService } from './admin-zone.service';
import type { CorePlatformAdminService } from './platform-admin.service';

/**
 * The back office's writes delegate, and they carry the actor (plan 0077).
 *
 * Two claims, and they are the two the admin layer is responsible for. **Every
 * write reaches the service that owns the invariant**, asserted by handing this
 * layer nothing but doubles and reading which method was called with what: a
 * service that wrote a row itself would call none of them and pass none of these.
 * And **the actor is the one the gate verified**, never a value from the request,
 * so a trail cannot name somebody who did not authenticate.
 *
 * What each delegated method then does is that service's own specs' business.
 * Asserting it twice would fix this file to the internals of another and turn a
 * refactor there into a failure here.
 */

const NOW = new Date('2026-09-01T10:00:00.000Z');

/** The gate resolves the operator token to this admin id, and nothing else does. */
const ACTOR = 'a1';
const CREDENTIAL = { userId: ACTOR, adminToken: 'operator-token' };

const openGate = {
  requireAdmin: jest.fn(async () => ACTOR),
} as unknown as CorePlatformAdminService;

function zoneRow(over: Partial<Zone> = {}): Zone {
  return {
    id: 'z1',
    name: 'Flat',
    config: {},
    joinCode: 'ABC123',
    status: ZoneStatus.ACTIVE,
    ownerUserId: 'u-owner',
    markedForDeletionAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  } as Zone;
}

function membershipRow(over: Partial<ZoneMembership> = {}): ZoneMembership {
  return {
    id: 'm1',
    zoneId: 'z1',
    userId: 'u1',
    username: 'ana',
    role: ZoneRole.MEMBER,
    status: MembershipStatus.APPROVED,
    approvedByUserId: 'u-owner',
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  } as ZoneMembership;
}

function lineRow(over: Partial<ListLine> = {}): ListLine {
  return {
    id: 'n1',
    listId: 'l1',
    content: 'Milk',
    quantity: 2,
    position: 1,
    approvalStatus: LineApprovalStatus.APPROVED,
    createdByUserId: 'u1',
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  } as ListLine;
}

function makeQueryBuilder(rows: unknown[]) {
  const qb = {
    orderBy: () => qb,
    addOrderBy: () => qb,
    take: () => qb,
    select: () => qb,
    addSelect: () => qb,
    innerJoin: () => qb,
    groupBy: () => qb,
    where: () => qb,
    andWhere: () => qb,
    getMany: async () => rows,
    getRawMany: async () => [],
  };
  return qb;
}

function makeZoneService(over: {
  zoneService?: Partial<ZoneService>;
  membershipService?: Partial<MembershipService>;
  zone?: Zone | null;
  membership?: ZoneMembership | null;
  memberships?: ZoneMembership[];
}) {
  const zones = {
    createQueryBuilder: () => makeQueryBuilder([]),
    findOne: async () => (over.zone === undefined ? zoneRow() : over.zone),
  };
  const memberships = {
    createQueryBuilder: () => makeQueryBuilder(over.memberships ?? []),
    find: async () => [],
    findOne: async () =>
      over.membership === undefined ? membershipRow() : over.membership,
  };
  const lists = { createQueryBuilder: () => makeQueryBuilder([]) };

  return new AdminZoneService(
    zones as never,
    memberships as never,
    lists as never,
    openGate,
    (over.zoneService ?? {}) as ZoneService,
    (over.membershipService ?? {}) as MembershipService,
    {} as ZoneReaperService
  );
}

function makeListService(over: {
  listService?: Partial<ListService>;
  lineService?: Partial<LineService>;
  list?: ShoppingList | null;
  line?: ListLine | null;
  lines?: ListLine[];
}) {
  const lists = {
    createQueryBuilder: () => makeQueryBuilder([]),
    findOne: async () =>
      over.list === undefined ? ({ id: 'l1' } as ShoppingList) : over.list,
  };
  const lines = {
    createQueryBuilder: () => makeQueryBuilder(over.lines ?? []),
    find: async () => over.lines ?? [],
    findOne: async () => (over.line === undefined ? lineRow() : over.line),
  };
  const empty = { createQueryBuilder: () => makeQueryBuilder([]) };

  return new AdminListService(
    lists as never,
    lines as never,
    empty as never,
    empty as never,
    empty as never,
    openGate,
    (over.listService ?? {}) as ListService,
    (over.lineService ?? {}) as LineService
  );
}

describe('AdminZoneService writes through the service that owns the invariant', () => {
  it('changes a zone name and config through ZoneService.update, with the actor', async () => {
    const updateAsOperator = jest.fn(async () => ({ id: 'z1' }));
    const service = makeZoneService({
      zoneService: { updateAsOperator } as never,
    });

    await service.update({ ...CREDENTIAL, zoneId: 'z1', name: 'Home' });

    expect(updateAsOperator).toHaveBeenCalledWith(
      'z1',
      { name: 'Home', config: undefined },
      ACTOR
    );
  });

  it('marks a zone for deletion as one call, because the two columns are one decision', async () => {
    const setDeletionMarkAsOperator = jest.fn(async () => ({ id: 'z1' }));
    const service = makeZoneService({
      zoneService: { setDeletionMarkAsOperator } as never,
    });

    await service.setDeletionMark({
      ...CREDENTIAL,
      zoneId: 'z1',
      marked: true,
    });

    expect(setDeletionMarkAsOperator).toHaveBeenCalledWith('z1', true, ACTOR);
  });

  it('restores a marked zone through the same call, the other way', async () => {
    const setDeletionMarkAsOperator = jest.fn(async () => ({ id: 'z1' }));
    const service = makeZoneService({
      zoneService: { setDeletionMarkAsOperator } as never,
    });

    await service.setDeletionMark({
      ...CREDENTIAL,
      zoneId: 'z1',
      marked: false,
    });

    expect(setDeletionMarkAsOperator).toHaveBeenCalledWith('z1', false, ACTOR);
  });

  it('changes a role through ZoneService, which keeps setRole’s refusals', async () => {
    const setRoleAsOperator = jest.fn(async () => ({ id: 'm1' }));
    const service = makeZoneService({
      zoneService: { setRoleAsOperator } as never,
    });

    await service.updateMembership({
      ...CREDENTIAL,
      zoneId: 'z1',
      membershipId: 'm1',
      role: ZoneRole.ADMIN,
    });

    expect(setRoleAsOperator).toHaveBeenCalledWith(
      'z1',
      'm1',
      ZoneRole.ADMIN,
      ACTOR
    );
  });

  it('renames a membership through MembershipService, which emits', async () => {
    const setUsernameAsOperator = jest.fn(async () => ({ id: 'm1' }));
    const service = makeZoneService({
      membershipService: { setUsernameAsOperator } as never,
    });

    await service.updateMembership({
      ...CREDENTIAL,
      zoneId: 'z1',
      membershipId: 'm1',
      username: 'bea',
    });

    expect(setUsernameAsOperator).toHaveBeenCalledWith(
      'z1',
      'm1',
      'bea',
      ACTOR
    );
  });

  it('refuses a membership edit that names no field, rather than writing nothing quietly', async () => {
    const service = makeZoneService({});

    await expect(
      service.updateMembership({
        ...CREDENTIAL,
        zoneId: 'z1',
        membershipId: 'm1',
      })
    ).rejects.toBeInstanceOf(ValidationException);
  });

  it('approves through MembershipService, which is more than the enum', async () => {
    const approveAsOperator = jest.fn(async () => ({ id: 'm1' }));
    const service = makeZoneService({
      membershipService: { approveAsOperator } as never,
    });

    await service.approve({
      ...CREDENTIAL,
      zoneId: 'z1',
      membershipId: 'm1',
    });

    expect(approveAsOperator).toHaveBeenCalledWith('z1', 'm1', ACTOR);
  });

  it('rejects through MembershipService, which removes the pending row', async () => {
    const rejectAsOperator = jest.fn(async () => ({ id: 'm1' }));
    const service = makeZoneService({
      membershipService: { rejectAsOperator } as never,
    });

    await service.reject({ ...CREDENTIAL, zoneId: 'z1', membershipId: 'm1' });

    expect(rejectAsOperator).toHaveBeenCalledWith('z1', 'm1', ACTOR);
  });

  it('answers 404 for a membership in another zone rather than acting on it', async () => {
    const setRoleAsOperator = jest.fn();
    const service = makeZoneService({
      membership: null,
      zoneService: { setRoleAsOperator } as never,
    });

    await expect(
      service.updateMembership({
        ...CREDENTIAL,
        zoneId: 'z1',
        membershipId: 'm-elsewhere',
        role: ZoneRole.ADMIN,
      })
    ).rejects.toThrow(/Membership not found/);
    expect(setRoleAsOperator).not.toHaveBeenCalled();
  });

  it('pages a zone’s memberships oldest first, the order the detail read uses', async () => {
    const service = makeZoneService({
      memberships: [membershipRow({ id: 'm1' }), membershipRow({ id: 'm2' })],
    });

    const page = await service.listMemberships({ ...CREDENTIAL, zoneId: 'z1' });

    expect(page.items.map((m) => m.membershipId)).toEqual(['m1', 'm2']);
  });
});

describe('AdminListService writes through the service that owns the invariant', () => {
  it('changes a list through ListService, carrying all three fields', async () => {
    const updateAsOperator = jest.fn(async () => ({ id: 'l1' }));
    const service = makeListService({
      listService: { updateAsOperator } as never,
    });

    await service.update({
      ...CREDENTIAL,
      listId: 'l1',
      name: 'Weekly',
      sharedWithZone: false,
    });

    // `sharedWithZone: false` is passed through as false rather than dropped: it
    // is a real edit, and it revokes nobody, which is the member facing behaviour
    // this must not soften.
    expect(updateAsOperator).toHaveBeenCalledWith(
      'l1',
      { name: 'Weekly', autoApproveLines: undefined, sharedWithZone: false },
      ACTOR
    );
  });

  it('deletes a list through ListService', async () => {
    const deleteAsOperator = jest.fn(async () => ({ id: 'l1' }));
    const service = makeListService({
      listService: { deleteAsOperator } as never,
    });

    await service.remove({ ...CREDENTIAL, listId: 'l1' });

    expect(deleteAsOperator).toHaveBeenCalledWith('l1', ACTOR);
  });

  it('edits a line through LineService, which resolves the operator as MANAGE', async () => {
    const updateAsOperator = jest.fn(async () => ({ id: 'n1' }));
    const service = makeListService({
      lineService: { updateAsOperator } as never,
    });

    await service.updateLine({
      ...CREDENTIAL,
      listId: 'l1',
      lineId: 'n1',
      content: 'Oat milk',
    });

    expect(updateAsOperator).toHaveBeenCalledWith(
      'l1',
      'n1',
      { content: 'Oat milk', quantity: undefined, itemIds: undefined },
      ACTOR
    );
  });

  it('sets a line’s approval through LineService', async () => {
    const setApprovalAsOperator = jest.fn(async () => ({ id: 'n1' }));
    const service = makeListService({
      lineService: { setApprovalAsOperator } as never,
    });

    await service.setLineApproval({
      ...CREDENTIAL,
      listId: 'l1',
      lineId: 'n1',
      status: LineApprovalStatus.APPROVED,
    });

    expect(setApprovalAsOperator).toHaveBeenCalledWith(
      'l1',
      'n1',
      LineApprovalStatus.APPROVED,
      ACTOR
    );
  });

  it('deletes a line through LineService', async () => {
    const deleteAsOperator = jest.fn(async () => ({ id: 'n1' }));
    const service = makeListService({
      lineService: { deleteAsOperator } as never,
    });

    await service.deleteLine({ ...CREDENTIAL, listId: 'l1', lineId: 'n1' });

    expect(deleteAsOperator).toHaveBeenCalledWith('l1', 'n1', ACTOR);
  });

  it('answers 404 for a line on another list rather than editing it', async () => {
    const updateAsOperator = jest.fn();
    const service = makeListService({
      line: null,
      lineService: { updateAsOperator } as never,
    });

    await expect(
      service.updateLine({
        ...CREDENTIAL,
        listId: 'l1',
        lineId: 'n-elsewhere',
        content: 'x',
      })
    ).rejects.toThrow(/Line not found/);
    expect(updateAsOperator).not.toHaveBeenCalled();
  });

  it('answers 404 for a list that does not exist rather than acting on nothing', async () => {
    const updateAsOperator = jest.fn();
    const service = makeListService({
      list: null,
      listService: { updateAsOperator } as never,
    });

    await expect(
      service.update({ ...CREDENTIAL, listId: 'l-missing', name: 'x' })
    ).rejects.toThrow(/List not found/);
    expect(updateAsOperator).not.toHaveBeenCalled();
  });

  it('pages a list’s lines in the household’s own order', async () => {
    const service = makeListService({
      lines: [
        lineRow({ id: 'n1', position: 1 }),
        lineRow({ id: 'n2', position: 2 }),
      ],
    });

    const page = await service.listLines({ ...CREDENTIAL, listId: 'l1' });

    expect(page.items.map((n) => n.id)).toEqual(['n1', 'n2']);
  });
});
