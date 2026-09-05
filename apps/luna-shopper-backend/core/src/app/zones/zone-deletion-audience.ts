import { MembershipStatus } from '@portfolio/luna-shopper/contracts';
import type { Repository } from 'typeorm';
import type { ZoneMembership } from '../entities';
import type { EventAudience } from '../events/core-events.publisher';

/**
 * Who hears that a zone was deleted (plan 0030, section 5).
 *
 * `zone.deleted` is addressed to the zone room, and the zone room is every
 * **approved** member: `checkZone` refuses a PENDING membership, so a person
 * whose join request is still open holds no room in which the deletion is
 * announced. Their home page keeps drawing the request over a group that no
 * longer exists, until a reload finds the cascade took the membership row with
 * the zone. That is the same gap plan 0030 closed for approval, and it closes
 * the same way: the event is also addressed to the people whose standing it
 * ends and who cannot be in the room.
 *
 * Read **before** the delete. The membership rows cascade with the zone, so
 * asking afterwards answers nobody.
 *
 * Only the applicants are named. An approved member is in the zone room, and
 * the realtime consumer fans out before it sweeps (plan 0031), so the room
 * carries the news to them and naming them again would send each of them the
 * same event twice.
 */
export async function zoneDeletionAudience(
  memberships: Pick<Repository<ZoneMembership>, 'find'>,
  zoneId: string
): Promise<EventAudience> {
  const pending = await memberships.find({
    where: { zoneId, status: MembershipStatus.PENDING },
    select: { userId: true },
  });
  const userIds = pending.map((row) => row.userId);
  return userIds.length > 0 ? { zoneId, userIds } : { zoneId };
}
