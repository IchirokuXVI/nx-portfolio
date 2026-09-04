import { newCorrelationId } from '../correlation-id';
import { NetworkError } from '../errors';
import type { OptionalAuthResult } from './token-store';

/**
 * Refuse to run an optional-auth call for a session this app could not prove
 * (plan 0067, section 4).
 *
 * The two routes behind rule D3's gate, `POST /v1/zones` and `POST /v1/zones/join`,
 * mint a guest account when they see no identity. That is the right behaviour for a
 * visitor with no session, and it is data loss for one whose session is sitting in
 * storage unproven because auth is restarting: they get a second, empty account, their
 * groups stay on the first one, and for a temporary user there is no password with
 * which to go back and find it.
 *
 * So the call does not go out. The failure is a `NetworkError` rather than a new state
 * threaded through four result types, and that is the honest shape of it: nothing was
 * attempted, nothing changed, and the sentence the sheet already shows for one, "we
 * could not do that, try again", is the sentence this wants. A retry a moment later
 * refreshes again and either proceeds or fails the same way.
 *
 * Every caller of `authorizeOptionalAuthCall` must pass its result through here before
 * reading `state` for anything else. `optional-auth-refuses-unproven.spec.ts` checks
 * that none is added without one.
 */
export function refuseUnprovenSession(
  authorized: OptionalAuthResult,
  operation: string
): void {
  if (authorized.state === 'unavailable') {
    throw new NetworkError(newCorrelationId(), operation);
  }
}
