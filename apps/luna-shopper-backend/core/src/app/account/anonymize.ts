import { ANONYMIZED_USERNAME_PREFIX } from '@portfolio/luna-shopper/platform';

// Re-exported so core keeps one import site for the marker while the platform
// owns the constant: the shared username validator has to reject a user supplied
// name that starts with it, and the platform cannot import core.
export { ANONYMIZED_USERNAME_PREFIX };

/**
 * A neutral placeholder for a departed member's username (plan 0011, section 2).
 * The username is the only arguably personal field core holds, so it is scrubbed
 * when a user is deleted.
 *
 * The membership id slice stays now that per zone usernames are no longer unique
 * (plan 0018, section 2). It never needed to be unique for the database's sake
 * any more, but it still distinguishes two departed members of the same zone in
 * the UI, which was always the more useful half of the reason. It is an opaque,
 * non-personal fragment.
 */
export function anonymizedUsername(membershipId: string): string {
  return `${ANONYMIZED_USERNAME_PREFIX} ${membershipId.slice(0, 8)}`;
}
