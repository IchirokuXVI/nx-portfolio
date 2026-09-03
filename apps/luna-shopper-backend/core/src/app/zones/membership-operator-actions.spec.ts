import {
  MembershipStatus,
  RealtimeEvent,
  ZoneRole,
} from '@portfolio/luna-shopper/contracts';
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
}

function makeService(target: ZoneMembership): Harness {
  const saved: ZoneMembership[] = [];
  const events: [RealtimeEvent, unknown, unknown][] = [];
  const recounted: string[] = [];

  const memberships = {
    findOne: jest.fn(async () => target),
    save: jest.fn(async (m: ZoneMembership) => {
      saved.push({ ...m });
      return m;
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

  return {
    service: new MembershipService(
      {} as never,
      memberships as never,
      authz as unknown as ZoneAuthzService,
      {} as SharedListGrantService,
      counts as unknown as ZoneCountsService,
      publisher as unknown as CoreEventsPublisher
    ),
    saved,
    events,
    authz,
    recounted,
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
      'm-target'
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
    await viaOperator.service.kickAsOperator('z1', 'm-target');

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
      'm-target'
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

    await expect(service.kickAsOperator('z1', 'm-target')).rejects.toThrow(
      'The owner cannot be removed'
    );
  });

  it('answers 404 for a membership that is not in the zone', async () => {
    const target = membership();
    const { service } = makeService(target);
    // The repository answers with nothing, as it does for an id in another zone.
    (
      service as unknown as { memberships: { findOne: jest.Mock } }
    ).memberships = { findOne: jest.fn(async () => null) };

    await expect(service.banAsOperator('z1', 'm-elsewhere')).rejects.toThrow(
      'Membership not found in this zone'
    );
  });
});
