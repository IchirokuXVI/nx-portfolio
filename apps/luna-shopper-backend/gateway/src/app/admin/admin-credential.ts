import type { AdminCredential } from '@portfolio/luna-shopper/contracts';
import type { CurrentAdmin } from './admin-jwt.strategy';

/**
 * What an admin route puts on the wire (plan 0073, section 1).
 *
 * Every gated subject in catalog and the harvester takes an {@link AdminCredential},
 * and since plan 0072 the field that decides anything is `adminToken`: the
 * receiving service verifies the signature against `ADMIN_JWT_PUBLIC_KEY` and
 * reads the actor out of the claims. `userId` rides along because the interface
 * has one and a service actor uses it, and it is deliberately the operator's own
 * id rather than a velista user's: nothing in this direction should be able to
 * name a person who is not the caller.
 *
 * A single helper rather than an object literal at each of the fifty odd call
 * sites, so the shape is stated once. A route that forgets the token does not
 * get a weaker check, it gets a 403, because `requireAdmin` falls through to the
 * service actor branch and an operator id is not in `SERVICE_ACTOR_IDS`.
 */
export function adminCredential(admin: CurrentAdmin): AdminCredential {
  return { userId: admin.adminId, adminToken: admin.token };
}
