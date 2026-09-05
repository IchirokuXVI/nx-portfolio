import {
  MembershipStatus,
  RealtimeEvent,
  ZoneRole,
} from '@portfolio/luna-shopper/contracts';
import { zoneDeletionAudience } from './zone-deletion-audience';
import { ZoneService } from './zone.service';

/**
 * Deleting a group tells the people still waiting to join it (plan 0030,
 * section 5).
 *
 * `zone.deleted` goes to the zone room, and the zone room is every approved
 * member: `checkZone` refuses a PENDING membership. So a person whose join
 * request was open when the owner deleted the group is in no room where the
 * deletion is announced, and their home page kept drawing the request over a
 * group that no longer existed until a reload found the row gone. The event is
 * addressed to them by name as well, exactly as their approval would have been.
 */

const ZONE = 'z1';

function build(applicants: string[]) {
  const zones = { delete: jest.fn(async () => ({ affected: 1 })) };
  const memberships = {
    find: jest.fn(async () => applicants.map((userId) => ({ userId }))),
  };
  const authz = {
    requireRole: jest.fn(async () => ({ role: ZoneRole.OWNER })),
  };
  const events = { emit: jest.fn(), emitTo: jest.fn() };
  const svc = new ZoneService(
    {} as never,
    zones as never,
    memberships as never,
    authz as never,
    {} as never,
    events as never,
    {} as never
  );
  return { svc, zones, memberships, events };
}

describe('who hears that a zone was deleted', () => {
  it('the zone room, and every applicant by name', async () => {
    const { svc, events } = build(['applicant-1', 'applicant-2']);

    await svc.delete({ userId: 'owner', zoneId: ZONE });

    expect(events.emitTo).toHaveBeenCalledWith(
      RealtimeEvent.ZoneDeleted,
      { zoneId: ZONE, userIds: ['applicant-1', 'applicant-2'] },
      { id: ZONE }
    );
    expect(events.emit).not.toHaveBeenCalled();
  });

  it('the zone room alone when nobody was waiting', async () => {
    const { svc, events } = build([]);

    await svc.delete({ userId: 'owner', zoneId: ZONE });

    // No empty `userIds`: the publisher drops an empty list anyway, and the
    // envelope should read the same as before for the common case.
    expect(events.emitTo).toHaveBeenCalledWith(
      RealtimeEvent.ZoneDeleted,
      { zoneId: ZONE },
      { id: ZONE }
    );
  });

  it('reads the applicants before the row goes, because they cascade with it', async () => {
    const { svc, zones, memberships } = build(['applicant-1']);

    await svc.delete({ userId: 'owner', zoneId: ZONE });

    expect(memberships.find).toHaveBeenCalledWith({
      where: { zoneId: ZONE, status: MembershipStatus.PENDING },
      select: { userId: true },
    });
    expect(memberships.find.mock.invocationCallOrder[0]).toBeLessThan(
      zones.delete.mock.invocationCallOrder[0]
    );
  });
});

describe('zoneDeletionAudience', () => {
  it('names only PENDING memberships, never the approved members', async () => {
    // The approved members are in the zone room, and the consumer fans out
    // before it sweeps, so naming them too would deliver the event twice.
    const find = jest.fn(async () => [{ userId: 'waiting' }]);

    await expect(zoneDeletionAudience({ find }, ZONE)).resolves.toEqual({
      zoneId: ZONE,
      userIds: ['waiting'],
    });
    expect(find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { zoneId: ZONE, status: MembershipStatus.PENDING },
      })
    );
  });
});
