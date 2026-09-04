import {
  MembershipStatus,
  RealtimeEvent,
  ZoneRole,
  ZoneStatus,
  type ZoneView,
} from '@portfolio/luna-shopper/contracts';
import { fakeAudit, type RecordedChange } from '../audit/core-audit.testing';
import { Zone, ZoneMembership } from '../entities';
import type { CoreEventsPublisher } from '../events/core-events.publisher';
import type { ZoneAuthzService } from './zone-authz.service';
import type { ZoneCountsService } from './zone-counts.service';
import { ZoneService } from './zone.service';

/**
 * An operator's edit of a zone is the write its own owner makes (plan 0077,
 * sections 4.1 to 4.3).
 *
 * The suite compares the two paths field for field rather than asserting what
 * each does on its own, because the property the plan rests on is that they are
 * one write: the day somebody gives the operator path its own body, this fails
 * rather than drifting quietly.
 *
 * The trail is asserted beside each write, since a change and its audit row are
 * one transaction. What a fake cannot show is the rollback, which
 * `core-audit.integration.spec.ts` proves against a real Postgres.
 */

const NOW = new Date('2026-09-01T10:00:00.000Z');

/** The verified admin id the gate hands every operator write (plan 0077, 2). */
const ACTOR = 'admin-1';

function makeZone(over: Partial<Zone> = {}): Zone {
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

function makeMembership(over: Partial<ZoneMembership> = {}): ZoneMembership {
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
  service: ZoneService;
  savedZones: Zone[];
  savedMemberships: ZoneMembership[];
  events: [RealtimeEvent, unknown][];
  recorded: RecordedChange[];
}

function makeService(
  zone: Zone,
  membership: ZoneMembership | null = null
): Harness {
  const savedZones: Zone[] = [];
  const savedMemberships: ZoneMembership[] = [];
  const events: [RealtimeEvent, unknown][] = [];

  const zones = {
    findOne: jest.fn(async () => zone),
    findOneOrFail: jest.fn(async () => zone),
    save: jest.fn(async (z: Zone) => {
      savedZones.push({ ...z });
      return z;
    }),
  };
  const memberships = {
    findOne: jest.fn(async () => membership),
    save: jest.fn(async (m: ZoneMembership) => {
      savedMemberships.push({ ...m });
      return m;
    }),
  };
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
  // Bound to the two repositories the member facing paths write through, so an
  // operator write saves the same rows and only adds the trail.
  const audit = fakeAudit([
    [Zone, { name: 'zones', repository: zones as never }],
    [
      ZoneMembership,
      { name: 'zone_memberships', repository: memberships as never },
    ],
  ]);

  return {
    service: new ZoneService(
      {} as never,
      zones as never,
      memberships as never,
      {
        requireRole: jest.fn(async () =>
          makeMembership({ id: 'm-owner', role: ZoneRole.OWNER })
        ),
      } as unknown as ZoneAuthzService,
      {} as ZoneCountsService,
      publisher as unknown as CoreEventsPublisher,
      audit.service
    ),
    savedZones,
    savedMemberships,
    events,
    recorded: audit.recorded,
  };
}

describe('an operator edit of a zone and its owner’s are one write', () => {
  it('writes the same two fields and emits the same event', async () => {
    const viaOwner = makeService(makeZone());
    const viaOperator = makeService(makeZone());

    const fromOwner = await viaOwner.service.update({
      userId: 'u-owner',
      zoneId: 'z1',
      name: 'The flat',
      config: { colour: 'teal' },
    });
    const fromOperator = await viaOperator.service.updateAsOperator(
      'z1',
      { name: 'The flat', config: { colour: 'teal' } },
      ACTOR
    );

    expect(fromOperator).toEqual(fromOwner);
    expect(viaOperator.savedZones).toEqual(viaOwner.savedZones);
    expect(viaOperator.events).toEqual(viaOwner.events);
    expect(viaOperator.events[0][0]).toBe(RealtimeEvent.ZoneUpdated);
  });

  it('leaves a field the edit did not name alone', async () => {
    const { service, savedZones } = makeService(makeZone());

    await service.updateAsOperator('z1', { name: 'The flat' }, ACTOR);

    expect(savedZones[0]).toMatchObject({
      name: 'The flat',
      config: {},
      joinCode: 'ABC123',
    });
  });

  it('records the fields that moved, against the operator', async () => {
    const { service, recorded } = makeService(makeZone());

    await service.updateAsOperator('z1', { name: 'The flat' }, ACTOR);

    expect(recorded).toEqual([
      {
        actorId: ACTOR,
        action: 'UPDATE',
        entity: 'zones',
        entityId: 'z1',
        before: { name: 'Flat' },
        after: { name: 'The flat' },
      },
    ]);
  });

  it('records nothing for a write that changes nothing', async () => {
    const { service, recorded } = makeService(makeZone());

    await service.updateAsOperator('z1', { name: 'Flat' }, ACTOR);

    expect(recorded).toEqual([]);
  });

  it('records nothing on the owner’s own path', async () => {
    const { service, recorded } = makeService(makeZone());

    await service.update({ userId: 'u-owner', zoneId: 'z1', name: 'Other' });

    expect(recorded).toEqual([]);
  });
});

describe('marking a zone for deletion writes the pair', () => {
  it('sets the status and stamps the marker together', async () => {
    const { service, savedZones, events } = makeService(makeZone());

    const view = await service.setDeletionMarkAsOperator('z1', true, ACTOR);

    // Either column alone produces a zone the reaper either never removes or
    // removes anyway, and neither state has a repair (plan 0077, section 4.2).
    expect(savedZones[0].status).toBe(ZoneStatus.MARKED_FOR_DELETION);
    expect(savedZones[0].markedForDeletionAt).toBeInstanceOf(Date);
    expect(view.status).toBe(ZoneStatus.MARKED_FOR_DELETION);
    expect(events[0][0]).toBe(RealtimeEvent.ZoneUpdated);
  });

  it('clears both when the zone is restored', async () => {
    const { service, savedZones } = makeService(
      makeZone({
        status: ZoneStatus.MARKED_FOR_DELETION,
        markedForDeletionAt: NOW,
      })
    );

    const view = await service.setDeletionMarkAsOperator('z1', false, ACTOR);

    expect(savedZones[0].status).toBe(ZoneStatus.ACTIVE);
    expect(savedZones[0].markedForDeletionAt).toBeNull();
    expect((view as ZoneView).status).toBe(ZoneStatus.ACTIVE);
  });

  it('records both columns in one row', async () => {
    const { service, recorded } = makeService(makeZone());

    await service.setDeletionMarkAsOperator('z1', true, ACTOR);

    expect(recorded).toHaveLength(1);
    expect(recorded[0].before).toEqual({
      status: ZoneStatus.ACTIVE,
      markedForDeletionAt: null,
    });
    expect(recorded[0].after).toMatchObject({
      status: ZoneStatus.MARKED_FOR_DELETION,
    });
  });

  it('answers 404 for a zone that is not there', async () => {
    const { service } = makeService(makeZone());
    (service as unknown as { zones: { findOne: jest.Mock } }).zones.findOne =
      jest.fn(async () => null);

    await expect(
      service.setDeletionMarkAsOperator('z1', true, ACTOR)
    ).rejects.toThrow('Zone not found');
  });
});

describe('an operator role change and the owner’s are one write', () => {
  it('writes the same role and emits the same event', async () => {
    const viaOwner = makeService(makeZone(), makeMembership());
    const viaOperator = makeService(makeZone(), makeMembership());

    const fromOwner = await viaOwner.service.setRole({
      userId: 'u-owner',
      zoneId: 'z1',
      membershipId: 'm-target',
      role: ZoneRole.ADMIN,
    });
    const fromOperator = await viaOperator.service.setRoleAsOperator(
      'z1',
      'm-target',
      ZoneRole.ADMIN,
      ACTOR
    );

    expect(fromOperator).toEqual(fromOwner);
    expect(viaOperator.savedMemberships).toEqual(viaOwner.savedMemberships);
    expect(viaOperator.savedMemberships[0].role).toBe(ZoneRole.ADMIN);
    expect(viaOperator.events).toEqual(viaOwner.events);
    expect(viaOperator.events[0][0]).toBe(RealtimeEvent.MemberRoleChanged);
  });

  it('refuses to assign the owner, which is a transfer', async () => {
    const { service, savedMemberships } = makeService(
      makeZone(),
      makeMembership()
    );

    await expect(
      service.setRoleAsOperator('z1', 'm-target', ZoneRole.OWNER, ACTOR)
    ).rejects.toThrow('Use transfer ownership to assign an owner');
    expect(savedMemberships).toEqual([]);
  });

  it('refuses to demote the current owner', async () => {
    const { service } = makeService(
      makeZone(),
      makeMembership({ role: ZoneRole.OWNER })
    );

    await expect(
      service.setRoleAsOperator('z1', 'm-target', ZoneRole.MEMBER, ACTOR)
    ).rejects.toThrow('Cannot change the owner');
  });

  it('records the role that moved', async () => {
    const { service, recorded } = makeService(makeZone(), makeMembership());

    await service.setRoleAsOperator('z1', 'm-target', ZoneRole.ADMIN, ACTOR);

    expect(recorded).toEqual([
      {
        actorId: ACTOR,
        action: 'UPDATE',
        entity: 'zone_memberships',
        entityId: 'm-target',
        before: { role: ZoneRole.MEMBER },
        after: { role: ZoneRole.ADMIN },
      },
    ]);
  });
});

describe('regenerating a join code as an operator', () => {
  it('writes a new code, announces it, and records the change', async () => {
    const { service, savedZones, events, recorded } = makeService(makeZone());

    const view = await service.regenerateJoinCodeAsOperator('z1', ACTOR);

    expect(savedZones[0].joinCode).not.toBe('ABC123');
    expect(view.joinCode).toBe(savedZones[0].joinCode);
    // A regenerated code invalidates every invitation already handed out, so an
    // implementation that forgot this event would leave every open client
    // showing a code that no longer works.
    expect(events[0][0]).toBe(RealtimeEvent.ZoneUpdated);
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({
      actorId: ACTOR,
      entity: 'zones',
      entityId: 'z1',
      before: { joinCode: 'ABC123' },
    });
  });
});
