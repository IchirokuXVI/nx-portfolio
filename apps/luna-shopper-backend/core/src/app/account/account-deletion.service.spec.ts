import {
  MembershipStatus,
  RealtimeEvent,
  ZoneStatus,
} from '@portfolio/luna-shopper/contracts';
import { createHash } from 'node:crypto';
import { fakeBasketAnnouncer } from '../baskets/basket-announcer.fake';
import { Zone, ZoneMembership } from '../entities';
import {
  AccountDeletionService,
  deletionKey,
} from './account-deletion.service';
import { ANONYMIZED_USERNAME_PREFIX } from './anonymize';

/**
 * The orchestration of a deletion (plan 0232, section 3): one transaction, the
 * key inside it, the events after it. What each statement does to the rows is
 * proven against real Postgres in `account-deletion.integration.spec.ts`,
 * because a fake manager would only agree with itself.
 *
 * Plan 0139 gave this service a basket announcer. The announcement is a nudge
 * the basket rooms hear, tested in `basket-announcer.spec.ts`.
 */
const announcer = fakeBasketAnnouncer();

function build(opts: {
  memberships: Partial<ZoneMembership>[];
  ownedZones?: Partial<Zone>[];
  touchedZones?: string[];
  firstSeen?: boolean;
}) {
  // Every read model carries timestamps (plan 0017, section 7), so the stand in
  // rows carry them too rather than the mappers having to tolerate their absence.
  const stamps = { createdAt: new Date(0), updatedAt: new Date(0) };
  const order: string[] = [];
  const membershipsRepo = {
    find: jest.fn(async () =>
      opts.memberships.map((m) => ({ ...stamps, ...m }))
    ),
    save: jest.fn(async (m) => m),
  };
  const zonesRepo = {
    find: jest.fn(async () =>
      (opts.ownedZones ?? []).map((z) => ({ ...stamps, ...z }))
    ),
    save: jest.fn(async (z) => z),
  };
  const manager = {
    query: jest.fn(async (sql: string) => {
      order.push('query');
      if (sql.includes('SELECT DISTINCT t."zoneId"')) {
        return (opts.touchedZones ?? []).map((zoneId) => ({ zoneId }));
      }
      return [];
    }),
    getRepository: jest.fn((target: unknown) =>
      target === ZoneMembership ? membershipsRepo : zonesRepo
    ),
  };
  const dataSource = {
    transaction: jest.fn(async (work: (m: unknown) => Promise<unknown>) => {
      order.push('begin');
      const result = await work(manager);
      order.push('commit');
      return result;
    }),
  };
  const events = {
    emit: jest.fn(() => order.push('emit')),
    emitTo: jest.fn(() => order.push('emit')),
    emitToUsers: jest.fn(),
  };
  const store = {
    firstSeenIn: jest.fn(async () => opts.firstSeen ?? true),
  };
  const zoneCounts = {
    emitZoneCounts: jest.fn(async (_zoneId: string) => undefined),
  };
  const baskets = {
    deleteForUserIn: jest.fn(async () => ['l1']),
  };
  const audit = { scrubUser: jest.fn(async () => 0) };
  const svc = new AccountDeletionService(
    dataSource as never,
    {} as never,
    events as never,
    zoneCounts as never,
    store as never,
    baskets as never,
    announcer,
    audit as never
  );
  return {
    svc,
    manager,
    membershipsRepo,
    zonesRepo,
    events,
    store,
    zoneCounts,
    baskets,
    audit,
    order,
  };
}

describe('AccountDeletionService.handleUserDeleted', () => {
  it('keys the deletion on the sha256 of the id, inside the transaction', async () => {
    const { svc, store, manager } = build({ memberships: [] });

    await expect(svc.handleUserDeleted('u1')).resolves.toBe(true);

    const hash = createHash('sha256').update('u1').digest('hex');
    expect(deletionKey('u1')).toBe(`user.deleted:${hash}`);
    expect(store.firstSeenIn).toHaveBeenCalledWith(
      manager,
      `user.deleted:${hash}`
    );
  });

  it('deletes the baskets on the transaction’s manager (plan 0050, section 7)', async () => {
    const { svc, baskets, manager } = build({ memberships: [] });

    await svc.handleUserDeleted('u-nomad');

    expect(baskets.deleteForUserIn).toHaveBeenCalledWith(manager, 'u-nomad');
  });

  it('is idempotent: a redelivery writes and announces nothing', async () => {
    const { svc, manager, events, baskets } = build({
      memberships: [{ id: 'm3', zoneId: 'z3', userId: 'u3', username: 'Cara' }],
      firstSeen: false,
    });

    await expect(svc.handleUserDeleted('u3')).resolves.toBe(false);

    expect(manager.query).not.toHaveBeenCalled();
    expect(baskets.deleteForUserIn).not.toHaveBeenCalled();
    expect(events.emitTo).not.toHaveBeenCalled();
  });

  it('retires each membership with a tombstone of its own zone', async () => {
    const { svc, membershipsRepo } = build({
      memberships: [
        { id: 'm4aaaaaa-1', zoneId: 'z4', userId: 'u4', username: 'D1' },
        { id: 'm5aaaaaa-1', zoneId: 'z5', userId: 'u4', username: 'D2' },
      ],
    });

    await svc.handleUserDeleted('u4');

    const saved = membershipsRepo.save.mock.calls.map((c) => c[0]);
    expect(saved).toHaveLength(2);
    for (const membership of saved) {
      expect(membership.status).toBe(MembershipStatus.KICKED);
      expect(membership.username).toContain(ANONYMIZED_USERNAME_PREFIX);
      expect(membership.userId).not.toBe('u4');
    }
    expect(saved[0].userId).not.toBe(saved[1].userId);
  });

  it('marks an owned zone for deletion, ownerless', async () => {
    const { svc, zonesRepo, events } = build({
      memberships: [
        { id: 'm1', zoneId: 'z1', userId: 'u1', username: 'Alice' },
      ],
      ownedZones: [{ id: 'z1', ownerUserId: 'u1', status: ZoneStatus.ACTIVE }],
    });

    await svc.handleUserDeleted('u1');

    const savedZone = zonesRepo.save.mock.calls[0][0];
    expect(savedZone.ownerUserId).toBeNull();
    expect(savedZone.status).toBe(ZoneStatus.MARKED_FOR_DELETION);
    expect(savedZone.markedForDeletionAt).toBeInstanceOf(Date);
    expect(events.emit.mock.calls.map((c: unknown[]) => c[0])).toContain(
      RealtimeEvent.ZoneMarkedForDeletion
    );
  });

  it('announces only after the commit, to the person’s own id', async () => {
    const { svc, events, order, zoneCounts } = build({
      memberships: [
        { id: 'm1', zoneId: 'z1', userId: 'u1', username: 'Alice' },
        { id: 'm2', zoneId: 'z2', userId: 'u1', username: 'Ali' },
      ],
    });

    await svc.handleUserDeleted('u1');

    expect(order.indexOf('emit')).toBeGreaterThan(order.indexOf('commit'));
    const kicked = events.emitTo.mock.calls.filter(
      (c: unknown[]) => c[0] === RealtimeEvent.MemberKicked
    );
    expect(kicked.map((c: unknown[]) => c[1])).toEqual([
      { zoneId: 'z1', userIds: ['u1'] },
      { zoneId: 'z2', userIds: ['u1'] },
    ]);
    expect(zoneCounts.emitZoneCounts.mock.calls.map((c) => c[0])).toEqual([
      'z1',
      'z2',
    ]);
    // The trips of the deleted baskets.
    expect(
      events.emitTo.mock.calls.some(
        (c: unknown[]) => c[0] === RealtimeEvent.ListTripsChanged
      )
    ).toBe(true);
  });

  it('scrubs the trail with the tombstone and the name of each zone', async () => {
    const { svc, audit, manager } = build({
      memberships: [
        { id: 'm1aaaaaa-1', zoneId: 'z1', userId: 'u1', username: 'Alice' },
      ],
      touchedZones: ['z1', 'z9'],
    });

    await svc.handleUserDeleted('u1');

    const [onManager, userId, tombstones, names, deletion] = audit.scrubUser
      .mock.calls[0] as unknown as [
      unknown,
      string,
      Map<string, string>,
      Map<string, string>,
      { membershipIds: string[] },
    ];
    expect(onManager).toBe(manager);
    expect(userId).toBe('u1');
    expect([...tombstones.keys()].sort()).toEqual(['z1', 'z9']);
    expect([...names.keys()]).toEqual(['z1']);
    expect(deletion.membershipIds).toEqual(['m1aaaaaa-1']);
  });

  it('announces nothing when the transaction throws', async () => {
    const { svc, events, audit } = build({
      memberships: [
        { id: 'm1', zoneId: 'z1', userId: 'u1', username: 'Alice' },
      ],
    });
    audit.scrubUser.mockRejectedValueOnce(new Error('boom'));

    await expect(svc.handleUserDeleted('u1')).rejects.toThrow('boom');
    expect(events.emitTo).not.toHaveBeenCalled();
  });
});

describe('AccountDeletionService.usersWithoutMemberships', () => {
  function withMembershipRows(rows: { userId: string }[]) {
    const qb = {
      select: jest.fn(() => qb),
      where: jest.fn(() => qb),
      getRawMany: jest.fn(async () => rows),
    };
    const membershipsRepo = { createQueryBuilder: jest.fn(() => qb) };
    return new AccountDeletionService(
      {} as never,
      membershipsRepo as never,
      { emit: jest.fn() } as never,
      { emitZoneCounts: jest.fn() } as never,
      { firstSeenIn: jest.fn() } as never,
      { deleteForUserIn: jest.fn() } as never,
      announcer,
      { scrubUser: jest.fn() } as never
    );
  }

  it('returns [] for empty input without querying', async () => {
    const svc = withMembershipRows([]);
    await expect(svc.usersWithoutMemberships([])).resolves.toEqual([]);
  });

  it('filters out ids that have a membership row', async () => {
    const svc = withMembershipRows([{ userId: 'b' }]);
    await expect(svc.usersWithoutMemberships(['a', 'b', 'c'])).resolves.toEqual(
      ['a', 'c']
    );
  });
});
