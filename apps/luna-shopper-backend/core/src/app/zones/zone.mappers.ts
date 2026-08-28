import {
  MembershipStatus,
  ZoneRole,
  type BroadcastZoneCounts,
  type MembershipView,
  type MyZoneView,
  type ZoneCounts,
  type ZoneListPreview,
  type ZoneView,
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
    createdAt: zone.createdAt.toISOString(),
    updatedAt: zone.updatedAt.toISOString(),
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
    createdAt: membership.createdAt.toISOString(),
    updatedAt: membership.updatedAt.toISOString(),
  };
}

/** The caller's own membership, as far as the summary gating cares. */
export type SummaryViewer = Pick<ZoneMembership, 'role' | 'status'>;

/**
 * Whether a caller may see who is waiting to join (plan 0017, section 6). An
 * applicant has not agreed to be visible to the zone's existing members, so only
 * the people who can act on the request see them. This is the one rule; the REST
 * mapper and the realtime staff room both read it from here.
 */
export function managesZone(viewer: SummaryViewer): boolean {
  return (
    viewer.status === MembershipStatus.APPROVED &&
    (viewer.role === ZoneRole.OWNER || viewer.role === ZoneRole.ADMIN)
  );
}

/** The two fields section 6 withholds, taken from the enum for one spelling. */
type GovernanceFields = Pick<
  BroadcastZoneCounts,
  'pendingRequestCount' | 'firstPendingRequesterName'
>;

/**
 * The governance gate (plan 0017, section 6), spread over any counts block.
 * `null` means "not your business" and `0` means "nobody is waiting"; the client
 * renders them differently, so they must never be collapsed into each other.
 */
export function governanceFields(
  counts: GovernanceFields,
  manages: boolean
): GovernanceFields {
  return manages
    ? {
        pendingRequestCount: counts.pendingRequestCount,
        firstPendingRequesterName: counts.firstPendingRequesterName,
      }
    : { pendingRequestCount: null, firstPendingRequesterName: null };
}

/**
 * Maps a zone plus the caller's membership to the annotated "my zone" view.
 *
 * `ownerUsername` passes through ungated (plan 0024, section 2.4): it is a
 * public, freely chosen handle rather than the person's real name, and naming
 * the approver is the whole point of the waiting card. The governance fields
 * beside it stay gated, which is the combination the pending screen needs.
 */
export function toMyZoneView(
  zone: Zone,
  membership: SummaryViewer,
  counts: ZoneCounts,
  lists: ZoneListPreview[],
  ownerUsername: string | null
): MyZoneView {
  return {
    ...toZoneView(zone),
    myRole: membership.role,
    myStatus: membership.status,
    counts: { ...counts, ...governanceFields(counts, managesZone(membership)) },
    lists,
    ownerUsername,
  };
}
