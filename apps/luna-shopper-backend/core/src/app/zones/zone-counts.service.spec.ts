import {
  MembershipStatus,
  RealtimeEvent,
  ZoneRole,
  type ZoneCountsUpdatedPayload,
} from '@portfolio/luna-shopper/contracts';
import { ValidationException } from '@portfolio/luna-shopper/platform';
import type { ZoneMembership } from '../entities';
import type { CoreEventsPublisher } from '../events/core-events.publisher';
import { MembershipService } from './membership.service';
import type { ZoneAuthzService } from './zone-authz.service';
import { ZoneCountsService } from './zone-counts.service';

/**
 * Keeping the summary live (plan 0017, section 9). The numbers themselves come
 * from Postgres, so what a unit test can hold honest is the shape of the
 * payload and the set of mutations that republish it.
 */

function makeCounts(raw: {
  members: number;
  pending: number;
  firstPending: string | null;
}) {
  const qb: Record<string, unknown> = {};
  for (const method of ['select', 'addSelect', 'where', 'setParameters']) {
    qb[method] = jest.fn(() => qb);
  }
  qb['getRawOne'] = jest.fn(async () => raw);
  const repo = { createQueryBuilder: jest.fn(() => qb) };
  const events = { emit: jest.fn() } as unknown as CoreEventsPublisher;
  return { svc: new ZoneCountsService(repo as never, events), events };
}

describe('ZoneCountsService', () => {
  it('publishes the whole block under one event', async () => {
    const { svc, events } = makeCounts({
      members: 3,
      pending: 2,
      firstPending: 'Ines',
    });

    await svc.emitZoneCounts('z1');

    const [event, zoneId, payload] = (events.emit as jest.Mock).mock.calls[0];
    expect(event).toBe(RealtimeEvent.ZoneCountsUpdated);
    expect(zoneId).toBe('z1');
    expect(payload as ZoneCountsUpdatedPayload).toEqual({
      zoneId: 'z1',
      counts: {
        memberCount: 3,
        pendingRequestCount: 2,
        firstPendingRequesterName: 'Ines',
      },
    });
  });

  it('omits the per caller listCount and the preview', async () => {
    const { svc, events } = makeCounts({
      members: 1,
      pending: 0,
      firstPending: null,
    });

    await svc.emitZoneCounts('z1');

    // A room broadcast has no single asker, and both of those depend on who is
    // asking. A client derives listCount from list.created / list.deleted.
    const payload = (events.emit as jest.Mock).mock
      .calls[0][2] as ZoneCountsUpdatedPayload;
    expect(payload.counts).not.toHaveProperty('listCount');
    expect(payload).not.toHaveProperty('lists');
  });

  it('publishes the governance fields filled: the split happens in realtime', async () => {
    const { svc, events } = makeCounts({
      members: 3,
      pending: 2,
      firstPending: 'Ines',
    });

    await svc.emitZoneCounts('z1');

    const payload = (events.emit as jest.Mock).mock
      .calls[0][2] as ZoneCountsUpdatedPayload;
    expect(payload.counts.firstPendingRequesterName).toBe('Ines');
  });

  it('reports zero and null for a zone with nobody waiting', async () => {
    const { svc, events } = makeCounts({
      members: 0,
      pending: 0,
      firstPending: null,
    });

    await svc.emitZoneCounts('z1');

    const payload = (events.emit as jest.Mock).mock
      .calls[0][2] as ZoneCountsUpdatedPayload;
    expect(payload.counts.pendingRequestCount).toBe(0);
    expect(payload.counts.firstPendingRequesterName).toBeNull();
  });
});

/** Every governance mutation republishes the counts (plan 0017, section 9). */
describe('MembershipService republishes the counts', () => {
  function build(target: Partial<ZoneMembership>) {
    const memberships = {
      findOne: jest.fn(async () => ({
        id: 'm1',
        zoneId: 'z1',
        userId: 'u1',
        username: 'Ines',
        role: ZoneRole.MEMBER,
        status: MembershipStatus.PENDING,
        createdAt: new Date(0),
        updatedAt: new Date(0),
        ...target,
      })),
      save: jest.fn(async (m) => m),
      delete: jest.fn(async () => undefined),
    };
    const authz = {
      requireRole: jest.fn(async () => ({ role: ZoneRole.OWNER })),
    } as unknown as ZoneAuthzService;
    const counts = { emitZoneCounts: jest.fn(async () => undefined) };
    const events = {
      emit: jest.fn(),
      emitTo: jest.fn(),
    } as unknown as CoreEventsPublisher;
    const svc = new MembershipService(
      memberships as never,
      authz,
      counts as never,
      events
    );
    return { svc, counts, memberships };
  }

  const action = { userId: 'owner', zoneId: 'z1', membershipId: 'm1' };

  it('on approve, because the next requester becomes the named one', async () => {
    const { svc, counts } = build({ status: MembershipStatus.PENDING });
    await svc.approve(action);
    expect(counts.emitZoneCounts).toHaveBeenCalledWith('z1');
  });

  it('on reject', async () => {
    const { svc, counts } = build({ status: MembershipStatus.PENDING });
    await svc.reject(action);
    expect(counts.emitZoneCounts).toHaveBeenCalledWith('z1');
  });

  it('on kick', async () => {
    const { svc, counts } = build({ status: MembershipStatus.APPROVED });
    await svc.kick(action);
    expect(counts.emitZoneCounts).toHaveBeenCalledWith('z1');
  });

  it('on ban', async () => {
    const { svc, counts } = build({ status: MembershipStatus.APPROVED });
    await svc.ban(action);
    expect(counts.emitZoneCounts).toHaveBeenCalledWith('z1');
  });

  it('but not when the mutation was refused', async () => {
    const { svc, counts } = build({ status: MembershipStatus.APPROVED });
    await expect(svc.approve(action)).rejects.toBeInstanceOf(
      ValidationException
    );
    expect(counts.emitZoneCounts).not.toHaveBeenCalled();
  });
});
