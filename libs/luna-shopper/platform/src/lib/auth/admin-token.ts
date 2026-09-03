import { JwtService } from '@nestjs/jwt';
import {
  ADMIN_TOKEN_AUDIENCE,
  type AdminTokenClaims,
} from '@portfolio/luna-shopper/contracts';

/**
 * Offline verification of an operator token, for the services behind the gateway
 * (plan 0072, section 2).
 *
 * It lives here rather than in either service because catalog and harvester both
 * have to reach the same verdict about the same token, and they are separate
 * classes with separate reach and separate error strings (section 1). Two copies
 * of the check itself is how one of them ends up accepting a token the other
 * refuses; two copies of the *policy* around it is the plan's design.
 *
 * The gateway verifies the same token before it forwards it, and this is not
 * redundant. Verifying again downstream is the property the plan keeps
 * deliberately: a gateway route that forgets its guard, or a new admin route
 * added without one, still cannot write the catalog, because the service behind
 * it proves the signature for itself rather than trusting a flag in the payload
 * (section 3).
 *
 * Three things are checked and each rules out a real token:
 *
 * - the RS256 signature against `ADMIN_JWT_PUBLIC_KEY`, which a velista access
 *   token fails outright because it is signed with auth's key,
 * - expiry, which is what makes a leaked token a short problem rather than a
 *   permanent one, and
 * - `aud: platform-admin`, which is redundant only for as long as the two
 *   keypairs stay separate. It is the check that keeps a future key
 *   consolidation from silently merging the two principals, which is the same
 *   reason `AdminJwtStrategy` states it in the gateway.
 */
export async function verifyAdminToken(
  jwt: JwtService,
  token: string,
  publicKey: string
): Promise<AdminTokenClaims> {
  const claims = await jwt.verifyAsync<AdminTokenClaims>(token, {
    publicKey,
    algorithms: ['RS256'],
    audience: ADMIN_TOKEN_AUDIENCE,
  });

  // `verifyAsync` proves the signature, the expiry and the audience; it does not
  // promise the token names anybody. A token with no `sub` would otherwise reach
  // plan 0075's audit rows as an admin with no id, so it is refused here where
  // the refusal still has a reason attached.
  if (!claims?.sub) {
    throw new Error('the token names no admin');
  }

  return claims;
}
