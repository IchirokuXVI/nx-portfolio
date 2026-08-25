export const ANONYMIZED_USERNAME_PREFIX = 'former member';

/**
 * A neutral, per-zone-unique placeholder for a departed member's username (plan
 * 0011, section 2). The username is the only arguably personal field core holds,
 * so it is scrubbed when a user is deleted. The membership id slice keeps the
 * placeholder unique under `uq_membership_zone_username` when several members of
 * the same zone are anonymized; it is an opaque, non-personal fragment.
 */
export function anonymizedUsername(membershipId: string): string {
  return `${ANONYMIZED_USERNAME_PREFIX} ${membershipId.slice(0, 8)}`;
}
