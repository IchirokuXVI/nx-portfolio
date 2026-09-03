import {
  MembershipStatus,
  ZoneStatus,
} from '@portfolio/luna-shopper/contracts';
import type { ZoneReaperService } from '../account/zone-reaper.service';
import { Zone } from '../entities';
import type { MembershipService } from '../zones/membership.service';
import type { ZoneService } from '../zones/zone.service';
import { AdminZoneService } from './admin-zone.service';
import type { CorePlatformAdminService } from './platform-admin.service';

/**
 * The zone listing's filter, and the delegation of the named actions (plan 0074,
 * sections 1 to 3, and two of section 7's cases).
 *
 * The filter is asserted on the SQL rather than against a database, because what
 * matters about it is a claim about **which rows it can reach**: a member counts
 * and not only an owner, which is a shape of predicate rather than a value. An
 * integration test over one seeded row would pass for the owner only version.
 */
const NOW = new Date('2026-09-01T10:00:00.000Z');

const CREDENTIAL = { userId: 'a1', adminToken: 'operator-token' };

const openGate = {
  requireAdmin: jest.fn(async () => 'a1'),
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

/** Records every `andWhere` so the predicate can be read back. */
function makeQueryBuilder(rows: unknown[]) {
  const clauses: { sql: string; params?: Record<string, unknown> }[] = [];
  const qb = {
    clauses,
    orderBy: () => qb,
    addOrderBy: () => qb,
    take: () => qb,
    limit: () => qb,
    select: () => qb,
    addSelect: () => qb,
    innerJoin: () => qb,
    groupBy: () => qb,
    addGroupBy: () => qb,
    where: () => qb,
    andWhere: (sql: string, params?: Record<string, unknown>) => {
      clauses.push({ sql, params });
      return qb;
    },
    getMany: async () => rows,
    getRawMany: async () => [],
  };
  return qb;
}

function makeService(over: {
  zones?: unknown[];
  zoneService?: Partial<ZoneService>;
  membershipService?: Partial<MembershipService>;
  reaper?: Partial<ZoneReaperService>;
  zoneRepoOver?: Record<string, unknown>;
}) {
  const qb = makeQueryBuilder(over.zones ?? []);
  const zones = {
    createQueryBuilder: () => qb,
    findOne: async () => zoneRow(),
    ...over.zoneRepoOver,
  };
  const memberships = {
    createQueryBuilder: () => makeQueryBuilder([]),
    find: async () => [],
  };
  const lists = { createQueryBuilder: () => makeQueryBuilder([]) };

  const service = new AdminZoneService(
    zones as never,
    memberships as never,
    lists as never,
    openGate,
    (over.zoneService ?? {}) as ZoneService,
    (over.membershipService ?? {}) as MembershipService,
    (over.reaper ?? {}) as ZoneReaperService
  );
  return { service, qb };
}

describe('AdminZoneService.list', () => {
  it('reaches a zone the user is a member of, not only one they own', async () => {
    const { service, qb } = makeService({ zones: [zoneRow()] });

    await service.list({ ...CREDENTIAL, targetUserId: 'u-member' });

    const filter = qb.clauses.find((c) => c.params?.uid === 'u-member');
    expect(filter).toBeDefined();
    // Both branches, joined by OR. A predicate on `zones."ownerUserId"` alone
    // would silently answer a narrower question than the screen asks.
    expect(filter?.sql).toContain('z."ownerUserId" = :uid');
    expect(filter?.sql).toContain('zone_memberships');
    expect(filter?.sql).toContain('m."userId" = :uid');
  });

  it('does not filter on membership status, so a banned member still finds their zone', async () => {
    const { service, qb } = makeService({ zones: [] });

    await service.list({ ...CREDENTIAL, targetUserId: 'u-banned' });

    // "Why can this person not see their zone" is a question this screen exists
    // to answer, and a status predicate would hide exactly the answer.
    const filter = qb.clauses.find((c) => c.params?.uid === 'u-banned');
    expect(filter?.sql).not.toContain('m.status');
  });

  it('filters on nothing at all when no user is named', async () => {
    const { service, qb } = makeService({ zones: [] });

    await service.list(CREDENTIAL);

    expect(qb.clauses).toEqual([]);
  });

  it('counts approved members and every list in the zone', async () => {
    const { service } = makeService({ zones: [zoneRow({ id: 'z1' })] });

    const page = await service.list(CREDENTIAL);

    // No counts came back from the grouped queries, so the row reports zero
    // rather than undefined: a zone with no members is a real state.
    expect(page.items[0]).toMatchObject({ memberCount: 0, listCount: 0 });
  });

  it('never carries the join code on a listing row', async () => {
    // The one field on a zone that grants access to it belongs to the detail
    // read, which is a deliberate click, not to a screen left open (section 4).
    const { service } = makeService({
      zones: [zoneRow({ joinCode: 'SECRET' })],
    });

    const page = await service.list(CREDENTIAL);

    expect(JSON.stringify(page)).not.toContain('SECRET');
  });
});

describe('AdminZoneService named actions delegate rather than write', () => {
  it('kicks through MembershipService, the same write a zone admin makes', async () => {
    const kickAsOperator = jest.fn(async () => ({ id: 'm1' }));
    const { service } = makeService({
      membershipService: { kickAsOperator } as never,
    });

    await service.kick({ ...CREDENTIAL, zoneId: 'z1', membershipId: 'm1' });

    expect(kickAsOperator).toHaveBeenCalledWith('z1', 'm1');
  });

  it('bans through MembershipService', async () => {
    const banAsOperator = jest.fn(async () => ({ id: 'm1' }));
    const { service } = makeService({
      membershipService: { banAsOperator } as never,
    });

    await service.ban({ ...CREDENTIAL, zoneId: 'z1', membershipId: 'm1' });

    expect(banAsOperator).toHaveBeenCalledWith('z1', 'm1');
  });

  it('regenerates the join code through ZoneService', async () => {
    const regenerateJoinCodeAsOperator = jest.fn(async () => ({ id: 'z1' }));
    const { service } = makeService({
      zoneService: { regenerateJoinCodeAsOperator } as never,
    });

    await service.regenerateJoinCode({ ...CREDENTIAL, zoneId: 'z1' });

    expect(regenerateJoinCodeAsOperator).toHaveBeenCalledWith('z1');
  });

  it('transfers ownership through ZoneService', async () => {
    const transferOwnershipAsOperator = jest.fn(async () => ({ id: 'z1' }));
    const { service } = makeService({
      zoneService: { transferOwnershipAsOperator } as never,
    });

    await service.transferOwnership({
      ...CREDENTIAL,
      zoneId: 'z1',
      membershipId: 'm1',
    });

    expect(transferOwnershipAsOperator).toHaveBeenCalledWith('z1', 'm1');
  });

  it('deletes through the reaper, which is where deleting a zone is defined', async () => {
    const deleteZone = jest.fn(async () => ({ id: 'z1' }));
    const { service } = makeService({ reaper: { deleteZone } as never });

    await service.remove({ ...CREDENTIAL, zoneId: 'z1' });

    expect(deleteZone).toHaveBeenCalledWith('z1');
  });

  it('answers 404 for a zone that does not exist rather than acting on nothing', async () => {
    // The user facing routes get this free from `requireApproved`, which the
    // operator paths skip by design, so it has to be asked for explicitly.
    const deleteZone = jest.fn();
    const { service } = makeService({
      reaper: { deleteZone } as never,
      zoneRepoOver: { findOne: async () => null },
    });

    await expect(
      service.remove({ ...CREDENTIAL, zoneId: 'gone' })
    ).rejects.toThrow('Zone not found');
    expect(deleteZone).not.toHaveBeenCalled();
  });
});

describe('AdminZoneService.get', () => {
  it('carries the join code and the membership, and no list content', async () => {
    const memberships = {
      createQueryBuilder: () => makeQueryBuilder([]),
      find: async () => [
        {
          id: 'm1',
          zoneId: 'z1',
          userId: 'u1',
          username: 'Vela',
          role: 'OWNER',
          status: MembershipStatus.APPROVED,
          createdAt: NOW,
          updatedAt: NOW,
        },
      ],
    };
    const listsQb = makeQueryBuilder([]);
    listsQb.getRawMany = async () =>
      [{ id: 'l1', name: 'Weekly shop', lineCount: '7' }] as never;

    const service = new AdminZoneService(
      {
        createQueryBuilder: () => makeQueryBuilder([]),
        findOne: async () => zoneRow(),
      } as never,
      memberships as never,
      { createQueryBuilder: () => listsQb } as never,
      openGate,
      {} as never,
      {} as never,
      {} as never
    );

    const view = await service.get({ ...CREDENTIAL, zoneId: 'z1' });

    expect(view.joinCode).toBe('ABC123');
    expect(view.members).toHaveLength(1);
    // The list's name and its size, never its lines: reading what a household
    // wrote down is a deliberate click on the list itself (section 4).
    expect(view.lists).toEqual([
      { id: 'l1', name: 'Weekly shop', lineCount: 7 },
    ]);
    expect(JSON.stringify(view)).not.toContain('lines');
  });
});
