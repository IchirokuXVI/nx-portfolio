import {
  MembershipStatus,
  RealtimeEvent,
  ZoneStatus,
} from '@portfolio/luna-shopper/contracts';
import type { Zone, ZoneMembership } from '../entities';
import { AccountDeletionService } from './account-deletion.service';
import { ANONYMIZED_USERNAME_PREFIX } from './anonymize';

type MembershipRepo = {
  find: jest.Mock;
  save: jest.Mock;
  createQueryBuilder: jest.Mock;
};

function build(opts: {
  memberships: Partial<ZoneMembership>[];
  zones: Record<string, Partial<Zone>>;
  firstSeen?: boolean;
}) {
  // Every read model carries timestamps (plan 0017, section 7), so the stand in
  // rows carry them too rather than the mappers having to tolerate their absence.
  const stamps = { createdAt: new Date(0), updatedAt: new Date(0) };
  const zonesRepo = {
    findOne: jest.fn(async ({ where: { id } }: { where: { id: string } }) => ({
      ...stamps,
      ...opts.zones[id],
    })),
    save: jest.fn(async (z) => z),
  };
  const membershipsRepo: MembershipRepo = {
    find: jest.fn(async () =>
      opts.memberships.map((m) => ({ ...stamps, ...m }))
    ),
    save: jest.fn(async (m) => m),
    createQueryBuilder: jest.fn(),
  };
  const events = { emit: jest.fn(), emitTo: jest.fn(), emitToUsers: jest.fn() };
  const store = { firstSeen: jest.fn(async () => opts.firstSeen ?? true) };
  // Retiring a membership drops the zone's member count, so the saga tells the
  // zone's open screens (plan 0017, section 9).
  const zoneCounts = {
    emitZoneCounts: jest.fn(async (_zoneId: string) => undefined),
  };

  const svc = new AccountDeletionService(
    zonesRepo as never,
    membershipsRepo as never,
    events as never,
    zoneCounts as never,
    store as never
  );
  return { svc, zonesRepo, membershipsRepo, events, store, zoneCounts };
}

describe('AccountDeletionService.handleUserDeleted', () => {
  it('owner path: marks the owned zone for deletion and retires the membership', async () => {
    const { svc, zonesRepo, events } = build({
      memberships: [{ id: 'm1', zoneId: 'z1', userId: 'u1', username: 'Alice' }],
      zones: { z1: { id: 'z1', ownerUserId: 'u1', status: ZoneStatus.ACTIVE } },
    });

    await svc.handleUserDeleted('u1');

    // Zone marked for deletion, ownerless, with a timestamp.
    const savedZone = zonesRepo.save.mock.calls[0][0];
    expect(savedZone.ownerUserId).toBeNull();
    expect(savedZone.status).toBe(ZoneStatus.MARKED_FOR_DELETION);
    expect(savedZone.markedForDeletionAt).toBeInstanceOf(Date);

    expect(events.emit.mock.calls.map((c) => c[0])).toContain(
      RealtimeEvent.ZoneMarkedForDeletion
    );
    expect(events.emitTo.mock.calls.map((c) => c[0])).toContain(
      RealtimeEvent.MemberKicked
    );
  });

  it('non-owner path: leaves the zone untouched, still retires + anonymizes', async () => {
    const { svc, zonesRepo, membershipsRepo, events } = build({
      memberships: [{ id: 'm2', zoneId: 'z2', userId: 'u2', username: 'Bob' }],
      zones: { z2: { id: 'z2', ownerUserId: 'someone-else', status: ZoneStatus.ACTIVE } },
    });

    await svc.handleUserDeleted('u2');

    expect(zonesRepo.save).not.toHaveBeenCalled();
    const savedMembership = membershipsRepo.save.mock.calls[0][0];
    expect(savedMembership.status).toBe(MembershipStatus.KICKED);
    expect(savedMembership.username).toContain(ANONYMIZED_USERNAME_PREFIX);
    expect(events.emit).not.toHaveBeenCalled();
    expect(events.emitTo.mock.calls.map((c) => c[0])).toEqual([
      RealtimeEvent.MemberKicked,
    ]);
  });

  it('republishes the zone counts for every zone it touched (plan 0017)', async () => {
    const { svc, zoneCounts } = build({
      memberships: [
        { id: 'm1', zoneId: 'z1', userId: 'u1', username: 'Alice' },
        { id: 'm2', zoneId: 'z2', userId: 'u1', username: 'Ali' },
      ],
      zones: {
        z1: { id: 'z1', ownerUserId: 'u1', status: ZoneStatus.ACTIVE },
        z2: { id: 'z2', ownerUserId: 'other', status: ZoneStatus.ACTIVE },
      },
    });

    await svc.handleUserDeleted('u1');

    expect(zoneCounts.emitZoneCounts.mock.calls.map((c) => c[0])).toEqual([
      'z1',
      'z2',
    ]);
  });

  it('is idempotent: a redelivery (firstSeen=false) applies nothing', async () => {
    const { svc, membershipsRepo, zonesRepo } = build({
      memberships: [{ id: 'm3', zoneId: 'z3', userId: 'u3', username: 'Cara' }],
      zones: { z3: { id: 'z3', ownerUserId: 'u3', status: ZoneStatus.ACTIVE } },
      firstSeen: false,
    });

    await svc.handleUserDeleted('u3');

    expect(membershipsRepo.find).not.toHaveBeenCalled();
    expect(zonesRepo.save).not.toHaveBeenCalled();
  });

  it('iterates every membership the user held', async () => {
    const { svc, membershipsRepo } = build({
      memberships: [
        { id: 'm4', zoneId: 'z4', userId: 'u4', username: 'D1' },
        { id: 'm5', zoneId: 'z5', userId: 'u4', username: 'D2' },
      ],
      zones: {
        z4: { id: 'z4', ownerUserId: 'x', status: ZoneStatus.ACTIVE },
        z5: { id: 'z5', ownerUserId: 'y', status: ZoneStatus.ACTIVE },
      },
    });

    await svc.handleUserDeleted('u4');
    expect(membershipsRepo.save).toHaveBeenCalledTimes(2);
  });
});

describe('AccountDeletionService.usersWithoutMemberships', () => {
  function withMembershipRows(rows: { userId: string }[]) {
    const qb = {
      select: jest.fn(() => qb),
      where: jest.fn(() => qb),
      getRawMany: jest.fn(async () => rows),
    };
    const membershipsRepo = {
      find: jest.fn(),
      save: jest.fn(),
      createQueryBuilder: jest.fn(() => qb),
    };
    const svc = new AccountDeletionService(
      { findOne: jest.fn(), save: jest.fn() } as never,
      membershipsRepo as never,
      { emit: jest.fn() } as never,
      { emitZoneCounts: jest.fn() } as never,
      { firstSeen: jest.fn() } as never
    );
    return svc;
  }

  it('returns [] for empty input without querying', async () => {
    const svc = withMembershipRows([]);
    await expect(svc.usersWithoutMemberships([])).resolves.toEqual([]);
  });

  it('filters out ids that have a membership row', async () => {
    const svc = withMembershipRows([{ userId: 'b' }]);
    await expect(
      svc.usersWithoutMemberships(['a', 'b', 'c'])
    ).resolves.toEqual(['a', 'c']);
  });
});
