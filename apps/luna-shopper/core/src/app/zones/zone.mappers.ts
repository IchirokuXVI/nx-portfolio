import type {
  MembershipView,
  MyZoneView,
  ZoneView,
} from '@portfolio/luna-shopper/contracts';
import type { Zone, ZoneMembership } from '../entities';

/** Maps a zone entity to the client view. */
export function toZoneView(zone: Zone): ZoneView {
  return {
    id: zone.id,
    name: zone.name,
    joinCode: zone.joinCode,
    status: zone.status,
    ownerUserId: zone.ownerUserId,
    config: zone.config,
  };
}

/** Maps a membership entity to the client view. */
export function toMembershipView(membership: ZoneMembership): MembershipView {
  return {
    id: membership.id,
    zoneId: membership.zoneId,
    userId: membership.userId,
    username: membership.username,
    role: membership.role,
    status: membership.status,
  };
}

/** Maps a zone plus the caller's membership to the annotated "my zone" view. */
export function toMyZoneView(
  zone: Zone,
  membership: Pick<ZoneMembership, 'role' | 'status'>
): MyZoneView {
  return {
    ...toZoneView(zone),
    myRole: membership.role,
    myStatus: membership.status,
  };
}
