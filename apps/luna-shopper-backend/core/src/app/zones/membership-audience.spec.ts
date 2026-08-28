import {
  MembershipStatus,
  RealtimeEvent,
  ZoneRole,
} from '@portfolio/luna-shopper/contracts';
import type { ZoneMembership } from '../entities';
import { MembershipService } from './membership.service';

/**
 * Every event about a membership is addressed to the member too (plan 0030,
 * section 4.1).
 *
 * Approval is the case that forced this: `checkZone` refuses a PENDING member
 * the zone room, so the person being approved is the one participant who is not
 * in the room where their own approval is announced. Kick and ban gain the same
 * guarantee against a race they win today only by timing, since the realtime
 * service invalidates its access cache before it fans out, which can remove a
 * socket from the room in the same tick as the event explaining why.
 */

const ZONE = 'z1';

function build(target: Partial<ZoneMembership> = {}) {
  const membership = {
    id: 'm1',
    zoneId: ZONE,
    userId: 'u1',
    username: 'Ines',
    role: ZoneRole.MEMBER,
    status: MembershipStatus.PENDING,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...target,
  };
  const memberships = {
    findOne: jest.fn(async () => membership),
    save: jest.fn(async (row: ZoneMembership) => row),
    delete: jest.fn(async () => undefined),
  };
  const authz = {
    requireRole: jest.fn(async () => ({ role: ZoneRole.OWNER })),
  };
  const counts = { emitZoneCounts: jest.fn(async () => undefined) };
  const events = { emit: jest.fn(), emitTo: jest.fn() };
  const svc = new MembershipService(
    memberships as never,
    authz as never,
    counts as never,
    events as never
  );
  return { svc, events };
}

const action = { userId: 'owner', zoneId: ZONE, membershipId: 'm1' };

describe('who hears a membership event', () => {
  it('approval reaches the zone and the member approved', async () => {
    const { svc, events } = build({ status: MembershipStatus.PENDING });

    await svc.approve(action);

    expect(events.emitTo).toHaveBeenCalledWith(
      RealtimeEvent.MemberApproved,
      { zoneId: ZONE, userIds: ['u1'] },
      expect.objectContaining({ id: 'm1', status: MembershipStatus.APPROVED })
    );
  });

  it.each([
    ['kick', RealtimeEvent.MemberKicked],
    ['ban', RealtimeEvent.MemberBanned],
  ] as const)('%s reaches the member removed', async (method, event) => {
    const { svc, events } = build({ status: MembershipStatus.APPROVED });

    await svc[method](action);

    expect(events.emitTo).toHaveBeenCalledWith(
      event,
      { zoneId: ZONE, userIds: ['u1'] },
      expect.objectContaining({ id: 'm1' })
    );
  });

  it('rejection reaches the member rejected, with the payload unchanged', async () => {
    const { svc, events } = build({ status: MembershipStatus.PENDING });

    await svc.reject(action);

    // The membership row is gone, so this event carries the two ids it always
    // has rather than a view; only the audience is new.
    expect(events.emitTo).toHaveBeenCalledWith(
      RealtimeEvent.MemberRejected,
      { zoneId: ZONE, userIds: ['u1'] },
      { id: 'm1', userId: 'u1' }
    );
  });

  it('sends nothing to a user room when the mutation was refused', async () => {
    const { svc, events } = build({ status: MembershipStatus.APPROVED });

    await expect(svc.approve(action)).rejects.toBeDefined();

    expect(events.emitTo).not.toHaveBeenCalled();
  });
});
