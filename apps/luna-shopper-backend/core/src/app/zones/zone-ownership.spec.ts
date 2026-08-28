import {
  MembershipStatus,
  RealtimeEvent,
  ZoneRole,
  ZoneStatus,
  type MembershipView,
  type ZoneView,
} from '@portfolio/luna-shopper/contracts';
import type { EntityManager } from 'typeorm';
import { Zone, ZoneMembership } from '../entities';
import type { CoreEventsPublisher } from '../events/core-events.publisher';
import type { ZoneAuthzService } from './zone-authz.service';
import type { ZoneCountsService } from './zone-counts.service';
import { ZoneService } from './zone.service';

/**
 * An ownership transfer is two role changes (plan 0029). The transaction itself
 * was never wrong, so what a unit test holds honest is the announcement: which
 * events go out, in which order, carrying which roles, and that a transfer that
 * never commits announces nothing at all.
 */

const NOW = new Date('2026-08-28T09:00:00.000Z');

function makeMembership(over: Partial<ZoneMembership>): ZoneMembership {
  return {
    id: 'm-someone',
    zoneId: 'z1',
    userId: 'u-someone',
    username: 'Someone',
    role: ZoneRole.MEMBER,
    status: MembershipStatus.APPROVED,
    approvedByUserId: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  } as ZoneMembership;
}

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

interface Harness {
  svc: ZoneService;
  events: { emit: jest.Mock };
  zone: Zone;
}

/**
 * `commits: false` runs the callback and then fails, which is the only way to
 * tell an emit inside the transaction from one after it: both look identical on
 * the happy path.
 */
function makeService(opts: {
  caller: ZoneMembership;
  target?: ZoneMembership;
  zone: Zone;
  commits?: boolean;
}): Harness {
  const zoneRepo = {
    findOneOrFail: jest.fn(async () => opts.zone),
    save: jest.fn(async (z: Zone) => z),
  };
  const membershipRepo = {
    findOne: jest.fn(async () => opts.target ?? null),
    // TypeORM hands back what it was given, one entity or an array of them.
    save: jest.fn(async (m: ZoneMembership | ZoneMembership[]) => m),
  };
  const manager = {
    getRepository: (entity: unknown) =>
      entity === Zone ? zoneRepo : membershipRepo,
  } as unknown as EntityManager;

  const dataSource = {
    transaction: async <T>(cb: (m: EntityManager) => Promise<T>): Promise<T> => {
      const result = await cb(manager);
      if (opts.commits === false) {
        throw new Error('rolled back');
      }
      return result;
    },
  };

  const events = { emit: jest.fn() };
  const authz = {
    requireRole: jest.fn(async () => opts.caller),
  } as unknown as ZoneAuthzService;

  return {
    svc: new ZoneService(
      dataSource as never,
      zoneRepo as never,
      membershipRepo as never,
      authz,
      {} as ZoneCountsService,
      events as unknown as CoreEventsPublisher
    ),
    events,
    zone: opts.zone,
  };
}

/** The emitted events as `[name, payload]` pairs, in the order they went out. */
function emitted(events: { emit: jest.Mock }): [RealtimeEvent, unknown][] {
  return events.emit.mock.calls.map((call) => [call[0], call[2]]);
}

describe('ZoneService.transferOwnership', () => {
  const outgoing = makeMembership({
    id: 'm-owner',
    userId: 'u-owner',
    username: 'Vela',
    role: ZoneRole.OWNER,
  });
  const incoming = makeMembership({
    id: 'm-admin',
    userId: 'u-admin',
    username: 'Marta',
    role: ZoneRole.ADMIN,
  });

  it('announces both role changes before the ownership change', async () => {
    const { svc, events } = makeService({
      caller: outgoing,
      target: incoming,
      zone: makeZone(),
    });

    await svc.transferOwnership({
      zoneId: 'z1',
      userId: 'u-owner',
      membershipId: 'm-admin',
    });

    const names = emitted(events).map(([name]) => name);
    expect(names).toEqual([
      RealtimeEvent.MemberRoleChanged,
      RealtimeEvent.MemberRoleChanged,
      RealtimeEvent.ZoneOwnershipChanged,
    ]);
  });

  it('carries the outgoing owner as an admin and the target as the owner', async () => {
    const { svc, events } = makeService({
      caller: outgoing,
      target: incoming,
      zone: makeZone(),
    });

    await svc.transferOwnership({
      zoneId: 'z1',
      userId: 'u-owner',
      membershipId: 'm-admin',
    });

    const [first, second, third] = emitted(events);
    expect(first[1] as MembershipView).toMatchObject({
      id: 'm-owner',
      userId: 'u-owner',
      role: ZoneRole.ADMIN,
      status: MembershipStatus.APPROVED,
    });
    expect(second[1] as MembershipView).toMatchObject({
      id: 'm-admin',
      userId: 'u-admin',
      role: ZoneRole.OWNER,
      status: MembershipStatus.APPROVED,
    });
    expect((third[1] as ZoneView).ownerUserId).toBe('u-admin');
  });

  it('approves a target that was still pending', async () => {
    const pending = makeMembership({
      id: 'm-pending',
      userId: 'u-pending',
      role: ZoneRole.MEMBER,
      status: MembershipStatus.PENDING,
    });
    const { svc, events } = makeService({
      caller: outgoing,
      target: pending,
      zone: makeZone(),
    });

    await svc.transferOwnership({
      zoneId: 'z1',
      userId: 'u-owner',
      membershipId: 'm-pending',
    });

    expect(emitted(events)[1][1] as MembershipView).toMatchObject({
      role: ZoneRole.OWNER,
      status: MembershipStatus.APPROVED,
    });
  });

  it('announces nothing when the transaction rolls back', async () => {
    const { svc, events } = makeService({
      caller: outgoing,
      target: incoming,
      zone: makeZone(),
      commits: false,
    });

    await expect(
      svc.transferOwnership({
        zoneId: 'z1',
        userId: 'u-owner',
        membershipId: 'm-admin',
      })
    ).rejects.toThrow('rolled back');

    expect(events.emit).not.toHaveBeenCalled();
  });
});

describe('ZoneService.claimOwnership', () => {
  const claimant = makeMembership({
    id: 'm-admin',
    userId: 'u-admin',
    username: 'Marta',
    role: ZoneRole.ADMIN,
  });

  const ownerless = () =>
    makeZone({
      ownerUserId: null,
      status: ZoneStatus.MARKED_FOR_DELETION,
      markedForDeletionAt: NOW,
    });

  it('announces the claimant’s new role before the ownership change', async () => {
    const { svc, events } = makeService({
      caller: claimant,
      zone: ownerless(),
    });

    await svc.claimOwnership({ zoneId: 'z1', userId: 'u-admin' });

    const events_ = emitted(events);
    expect(events_.map(([name]) => name)).toEqual([
      RealtimeEvent.MemberRoleChanged,
      RealtimeEvent.ZoneOwnershipChanged,
    ]);
    expect(events_[0][1] as MembershipView).toMatchObject({
      id: 'm-admin',
      userId: 'u-admin',
      role: ZoneRole.OWNER,
      status: MembershipStatus.APPROVED,
    });
    expect(events_[1][1] as ZoneView).toMatchObject({
      ownerUserId: 'u-admin',
      status: ZoneStatus.ACTIVE,
    });
  });

  it('announces nothing when the zone already has an owner', async () => {
    const { svc, events } = makeService({ caller: claimant, zone: makeZone() });

    await expect(
      svc.claimOwnership({ zoneId: 'z1', userId: 'u-admin' })
    ).rejects.toThrow('already has an owner');

    expect(events.emit).not.toHaveBeenCalled();
  });

  it('announces nothing when the transaction rolls back', async () => {
    const { svc, events } = makeService({
      caller: claimant,
      zone: ownerless(),
      commits: false,
    });

    await expect(
      svc.claimOwnership({ zoneId: 'z1', userId: 'u-admin' })
    ).rejects.toThrow('rolled back');

    expect(events.emit).not.toHaveBeenCalled();
  });
});
