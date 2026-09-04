import {
  MembershipStatus,
  ZoneStatus,
  type ZoneByCodeView,
} from '@portfolio/luna-shopper/contracts';
import { NotFoundException } from '@portfolio/luna-shopper/platform';
import type { Zone } from '../entities';
import { ZoneService } from './zone.service';

/**
 * Resolving a join code to the group behind it (plan 0024, section 1).
 *
 * What a unit test can hold honest here is the shape of the answer and the
 * shape of the refusal, both of which are the point of the route: it is
 * unauthenticated and keyed on a low entropy secret, so it must say the least
 * it can and must not distinguish the ways a code can fail.
 */

function makeService(zone: Zone | null, approvedMembers = 0) {
  const zones = { findOne: jest.fn(async () => zone) };
  const memberships = { count: jest.fn(async () => approvedMembers) };
  const svc = new ZoneService(
    {} as never,
    zones as never,
    memberships as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never
  );
  return { svc, zones, memberships };
}

const ACTIVE_ZONE = { id: 'z1', name: 'Flat 3B' } as Zone;

describe('ZoneService.getByCode', () => {
  it('names the group and counts its members, and nothing else', async () => {
    const { svc } = makeService(ACTIVE_ZONE, 4);

    const view = await svc.getByCode({ joinCode: 'ABCD1234' });

    // Asserted as an equality on the whole object rather than field by field,
    // so a later addition to the view cannot leak into an unauthenticated
    // answer unnoticed (plan 0024, section 3).
    expect(view).toEqual<ZoneByCodeView>({ name: 'Flat 3B', memberCount: 4 });
    expect(Object.keys(view)).toEqual(['name', 'memberCount']);
  });

  it('looks up active zones only, and counts approved members only', async () => {
    const { svc, zones, memberships } = makeService(ACTIVE_ZONE, 4);

    await svc.getByCode({ joinCode: 'ABCD1234' });

    expect(zones.findOne).toHaveBeenCalledWith({
      where: { joinCode: 'ABCD1234', status: ZoneStatus.ACTIVE },
    });
    // Pending applicants are not members yet, the same rule ZoneCounts follows.
    expect(memberships.count).toHaveBeenCalledWith({
      where: { zoneId: 'z1', status: MembershipStatus.APPROVED },
    });
  });

  it('cannot tell a wrong code from one that used to work', async () => {
    // Both cases reach the service as "no active zone for this code", because
    // the query filters on ACTIVE. Distinguishing them would turn the route
    // into an oracle for which codes ever existed.
    const { svc } = makeService(null);

    const messages: string[] = [];
    for (const joinCode of ['NEVEREXISTED', 'WASARCHIVED']) {
      await expect(svc.getByCode({ joinCode })).rejects.toBeInstanceOf(
        NotFoundException
      );
      await svc.getByCode({ joinCode }).catch((error: Error) => {
        messages.push(error.message);
      });
    }
    expect(messages[0]).toBe(messages[1]);
  });

  it('does not count members it never found a zone for', async () => {
    const { svc, memberships } = makeService(null);

    await expect(svc.getByCode({ joinCode: 'NOPE' })).rejects.toBeInstanceOf(
      NotFoundException
    );
    expect(memberships.count).not.toHaveBeenCalled();
  });
});
