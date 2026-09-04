import {
  MembershipStatus,
  RealtimeEvent,
  ZoneRole,
} from '@portfolio/luna-shopper/contracts';
import { fakeAudit, type RecordedChange } from '../audit/core-audit.testing';
import { ZoneMembership } from '../entities';
import type { CoreEventsPublisher } from '../events/core-events.publisher';
import type { SharedListGrantService } from '../lists/shared-list-grant.service';
import { MembershipService } from './membership.service';
import type { ZoneAuthzService } from './zone-authz.service';
import type { ZoneCountsService } from './zone-counts.service';

/**
 * A named action produces the same end state as the equivalent user facing route
 * (plan 0074, section 7).
 *
 * This is the assertion that makes "a named action reuses the code that maintains
 * the invariant" a fact rather than an intention. `kickAsOperator` and `kick` run
 * the same `applyStatus`, so the row they leave behind and the events they emit
 * are compared **field for field** here: the day somebody gives the operator path
 * its own write, this fails rather than drifting quietly.
 *
 * The one deliberate difference is who is asked for permission, and it is
 * asserted too: the operator path never consults `ZoneAuthzService`, because an
 * operator has no membership in the zone and the whole point is that it works
 * anyway.
 */
const NOW = new Date('2026-09-01T10:00:00.000Z');

/** The verified admin id the gate hands every operator write (plan 0077, 2). */
const ACTOR = 'admin-1';

function membership(over: Partial<ZoneMembership> = {}): ZoneMembership {
  return {
    id: 'm-target',
    zoneId: 'z1',
    userId: 'u-target',
    username: 'Marta',
    role: ZoneRole.MEMBER,
    status: MembershipStatus.APPROVED,
    approvedByUserId: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  } as ZoneMembership;
}

interface Harness {
  service: MembershipService;
  saved: ZoneMembership[];
  events: [RealtimeEvent, unknown, unknown][];
  authz: { requireRole: jest.Mock };
  recounted: string[];
  recorded: RecordedChange[];
  deleted: unknown[];
}

function makeService(target: ZoneMembership): Harness {
  const saved: ZoneMembership[] = [];
  const events: [RealtimeEvent, unknown, unknown][] = [];
  const recounted: string[] = [];
  const deleted: unknown[] = [];

  const memberships = {
    findOne: jest.fn(async () => target),
    save: jest.fn(async (m: ZoneMembership) => {
      saved.push({ ...m });
      return m;
    }),
    delete: jest.fn(async (criteria: unknown) => {
      deleted.push(criteria);
      return { affected: 1 };
    }),
  };
  const authz = {
    requireRole: jest.fn(async () =>
      membership({ id: 'm-caller', role: ZoneRole.OWNER })
    ),
  };
  const counts = {
    emitZoneCounts: jest.fn(async (zoneId: string) => {
      recounted.push(zoneId);
    }),
  };
  const publisher = {
    emitTo: jest.fn(
      (event: RealtimeEvent, audience: unknown, payload: unknown) => {
        events.push([event, audience, payload]);
      }
    ),
  };

  // Bound to the repository the spec already asserts on, so an operator write
  // saves exactly the row a member facing one saves and the trail is the only
  // thing it adds.
  const audit = fakeAudit([
    [
      ZoneMembership,
      { name: 'zone_memberships', repository: memberships as never },
    ],
  ]);
  // Every approval, member facing or not, opens one transaction and grants the
  // zone's shared lists inside it (plan 0042, section 2.3).
  const dataSource = {
    transaction: async <T>(run: (m: unknown) => Promise<T>) =>
      run({ getRepository: () => memberships }),
  };
  const sharedGrant = { grantZoneSharedLists: jest.fn(async () => []) };

  return {
    service: new MembershipService(
      dataSource as never,
      memberships as never,
      authz as unknown as ZoneAuthzService,
      sharedGrant as unknown as SharedListGrantService,
      counts as unknown as ZoneCountsService,
      publisher as unknown as CoreEventsPublisher,
      audit.service
    ),
    saved,
    events,
    authz,
    recounted,
    recorded: audit.recorded,
    deleted,
  };
}

describe('an operator kick and a zone admin kick are one write', () => {
  it('leaves the same row and emits the same event', async () => {
    const viaAdmin = makeService(membership());
    const viaOperator = makeService(membership());

    const fromAdmin = await viaAdmin.service.kick({
      userId: 'u-owner',
      zoneId: 'z1',
      membershipId: 'm-target',
    });
    const fromOperator = await viaOperator.service.kickAsOperator(
      'z1',
      'm-target',
      ACTOR
    );

    expect(fromOperator).toEqual(fromAdmin);
    expect(viaOperator.saved).toEqual(viaAdmin.saved);
    expect(viaOperator.saved[0].status).toBe(MembershipStatus.KICKED);
    expect(viaOperator.events).toEqual(viaAdmin.events);
    expect(viaOperator.events[0][0]).toBe(RealtimeEvent.MemberKicked);
    // The zone's counts are recomputed either way, which is the half a row write
    // would silently skip.
    expect(viaOperator.recounted).toEqual(viaAdmin.recounted);
  });

  it('asks for no zone role on the operator path, and does on the other', async () => {
    const viaAdmin = makeService(membership());
    const viaOperator = makeService(membership());

    await viaAdmin.service.kick({
      userId: 'u-owner',
      zoneId: 'z1',
      membershipId: 'm-target',
    });
    await viaOperator.service.kickAsOperator('z1', 'm-target', ACTOR);

    expect(viaAdmin.authz.requireRole).toHaveBeenCalled();
    expect(viaOperator.authz.requireRole).not.toHaveBeenCalled();
  });
});

describe('an operator ban and a zone admin ban are one write', () => {
  it('leaves the same row and emits the same event', async () => {
    const viaAdmin = makeService(membership());
    const viaOperator = makeService(membership());

    const fromAdmin = await viaAdmin.service.ban({
      userId: 'u-owner',
      zoneId: 'z1',
      membershipId: 'm-target',
    });
    const fromOperator = await viaOperator.service.banAsOperator(
      'z1',
      'm-target',
      ACTOR
    );

    expect(fromOperator).toEqual(fromAdmin);
    expect(viaOperator.saved[0].status).toBe(MembershipStatus.BANNED);
    expect(viaOperator.events).toEqual(viaAdmin.events);
  });
});

describe('the rules that are about the zone, not about the caller', () => {
  it('refuses to remove the owner, on the operator path too', async () => {
    // A fact about the zone rather than about who asked: an operator removing
    // the owner would leave `ownerUserId` naming somebody with no membership.
    const { service } = makeService(membership({ role: ZoneRole.OWNER }));

    await expect(
      service.kickAsOperator('z1', 'm-target', ACTOR)
    ).rejects.toThrow('The owner cannot be removed');
  });

  it('answers 404 for a membership that is not in the zone', async () => {
    const target = membership();
    const { service } = makeService(target);
    // The repository answers with nothing, as it does for an id in another zone.
    (
      service as unknown as { memberships: { findOne: jest.Mock } }
    ).memberships = { findOne: jest.fn(async () => null) };

    await expect(
      service.banAsOperator('z1', 'm-elsewhere', ACTOR)
    ).rejects.toThrow('Membership not found in this zone');
  });
});

describe('an operator approval and an owner’s are one write', () => {
  const pending = () => membership({ status: MembershipStatus.PENDING });

  it('leaves the same status and emits the same event', async () => {
    const viaAdmin = makeService(pending());
    const viaOperator = makeService(pending());

    await viaAdmin.service.approve({
      userId: 'u-owner',
      zoneId: 'z1',
      membershipId: 'm-target',
    });
    await viaOperator.service.approveAsOperator('z1', 'm-target', ACTOR);

    expect(viaOperator.saved[0].status).toBe(MembershipStatus.APPROVED);
    expect(viaOperator.events[0][0]).toBe(RealtimeEvent.MemberApproved);
    expect(viaOperator.events).toEqual(viaAdmin.events);
    // The recount is what makes the next requester the named one on the zone
    // card, and no other event carries that name.
    expect(viaOperator.recounted).toEqual(viaAdmin.recounted);
  });

  it('writes a null approver, because an operator is not a member', async () => {
    const viaAdmin = makeService(pending());
    const viaOperator = makeService(pending());

    await viaAdmin.service.approve({
      userId: 'u-owner',
      zoneId: 'z1',
      membershipId: 'm-target',
    });
    await viaOperator.service.approveAsOperator('z1', 'm-target', ACTOR);

    expect(viaAdmin.saved[0].approvedByUserId).toBe('u-owner');
    // Every other reader treats the column as a `users.id`, so an admin's id
    // there would be a value that resolves to nothing.
    expect(viaOperator.saved[0].approvedByUserId).toBeNull();
  });

  it('grants the zone’s shared lists, in the same transaction', async () => {
    const { service } = makeService(pending());
    const granted = (
      service as unknown as {
        sharedGrant: { grantZoneSharedLists: jest.Mock };
      }
    ).sharedGrant.grantZoneSharedLists;

    await service.approveAsOperator('z1', 'm-target', ACTOR);

    // The half a status column write would silently skip, which leaves a member
    // approved into a household who can see nothing at all (plan 0042).
    expect(granted).toHaveBeenCalledWith(expect.anything(), 'z1', 'm-target');
  });

  it('refuses a membership that is not pending, as the owner’s path does', async () => {
    const { service } = makeService(membership());

    await expect(
      service.approveAsOperator('z1', 'm-target', ACTOR)
    ).rejects.toThrow('That member is not pending approval');
  });
});

describe('an operator rejection removes the row', () => {
  it('deletes it and announces it to the zone and the applicant', async () => {
    const { service, deleted, events, recounted } = makeService(
      membership({ status: MembershipStatus.PENDING })
    );

    await expect(
      service.rejectAsOperator('z1', 'm-target', ACTOR)
    ).resolves.toEqual({ id: 'm-target' });

    expect(deleted).toEqual([{ id: 'm-target' }]);
    expect(events[0][0]).toBe(RealtimeEvent.MemberRejected);
    expect(events[0][2]).toEqual({ id: 'm-target', userId: 'u-target' });
    expect(recounted).toEqual(['z1']);
  });
});

describe('an operator rename and a member’s own are one write', () => {
  it('leaves the same name and emits the same event', async () => {
    const viaMember = makeService(membership());
    const viaOperator = makeService(membership());
    // The member facing path resolves the caller as the membership itself.
    viaMember.authz.requireRole.mockClear();
    (
      viaMember.service as unknown as { authz: { requireMember: jest.Mock } }
    ).authz.requireMember = jest.fn(async () => membership());

    await viaMember.service.setUsername({
      userId: 'u-target',
      zoneId: 'z1',
      membershipId: 'm-target',
      username: 'Marta B',
    });
    await viaOperator.service.setUsernameAsOperator(
      'z1',
      'm-target',
      'Marta B',
      ACTOR
    );

    expect(viaOperator.saved[0].username).toBe('Marta B');
    expect(viaOperator.events).toEqual(viaMember.events);
    expect(viaOperator.events[0][0]).toBe(RealtimeEvent.MemberUsernameChanged);
  });

  it('refuses a banned membership, which is a fact about the row', async () => {
    // Those rows are the historical record admins recognise people by, and a
    // rewritten name is a way back in unrecognised.
    const { service } = makeService(
      membership({ status: MembershipStatus.BANNED })
    );

    await expect(
      service.setUsernameAsOperator('z1', 'm-target', 'Nobody', ACTOR)
    ).rejects.toThrow('That member is no longer in this zone');
  });
});

describe('the trail an operator write leaves (plan 0077, section 8)', () => {
  it('records one row naming the actor, the entity and what moved', async () => {
    const { service, recorded } = makeService(membership());

    await service.kickAsOperator('z1', 'm-target', ACTOR);

    expect(recorded).toEqual([
      {
        actorId: ACTOR,
        action: 'UPDATE',
        entity: 'zone_memberships',
        entityId: 'm-target',
        before: { status: MembershipStatus.APPROVED },
        after: { status: MembershipStatus.KICKED },
      },
    ]);
  });

  it('records what a rejection removed, rather than only its id', async () => {
    const { service, recorded } = makeService(
      membership({ status: MembershipStatus.PENDING })
    );

    await service.rejectAsOperator('z1', 'm-target', ACTOR);

    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({
      actorId: ACTOR,
      action: 'DELETE',
      entity: 'zone_memberships',
      entityId: 'm-target',
      after: null,
    });
    expect(recorded[0].before).toMatchObject({ username: 'Marta' });
  });

  it('records nothing for a write that changes nothing', async () => {
    // An operator who opens an edit form and saves it unchanged did not change
    // anything, and a trail that says otherwise is one somebody has to read past.
    const { service, recorded } = makeService(membership());

    await service.setUsernameAsOperator('z1', 'm-target', 'Marta', ACTOR);

    expect(recorded).toEqual([]);
  });

  it('records nothing on the member facing path', async () => {
    const { service, recorded } = makeService(membership());

    await service.kick({
      userId: 'u-owner',
      zoneId: 'z1',
      membershipId: 'm-target',
    });

    expect(recorded).toEqual([]);
  });
});
