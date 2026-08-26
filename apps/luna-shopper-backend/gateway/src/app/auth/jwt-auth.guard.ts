import { ExecutionContext, Injectable, type CanActivate } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Requires a valid access token (plan 0005). Rejects with 401 (turned into the
 * house envelope) when the bearer token is missing, malformed or expired.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}

/**
 * Optional authentication for the create/join zone entry points (plan 0006,
 * section 3): a request with no token is allowed through so the gateway can mint
 * a temporary identity, but a request that presents one must present a good one
 * (plan 0020).
 *
 * The discriminator is the presence of the `Authorization` header, not the
 * quality of the token in it. A caller that sends a header is claiming an
 * identity, so an expired or malformed token is answered with the usual 401
 * rather than quietly minting a second guest account over the top of the one the
 * stale token belongs to, which no guest could ever sign back in to reach.
 */
@Injectable()
export class OptionalJwtAuthGuard
  extends AuthGuard('jwt')
  implements CanActivate
{
  override async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    // Presence, not truthiness: a header sent with an empty value still counts
    // as a claim to an identity, and rejecting it falls on the safe side.
    if (request?.headers?.authorization === undefined) {
      // A genuine anonymous caller: no user is attached and the handler mints one.
      return true;
    }
    // Inherited `handleRequest` throws `UnauthorizedException` when the token
    // does not hold up, which the global filter turns into the house envelope.
    return (await super.canActivate(context)) as boolean;
  }
}
