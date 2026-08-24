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
 * section 3): a valid token attaches the caller, but a request with no token is
 * still allowed through so the gateway can mint a temporary identity. An invalid
 * or expired token still passes as anonymous rather than erroring, since these
 * routes are reachable without any token at all.
 */
@Injectable()
export class OptionalJwtAuthGuard
  extends AuthGuard('jwt')
  implements CanActivate
{
  override handleRequest<TUser>(_err: unknown, user: TUser): TUser {
    return (user || undefined) as TUser;
  }

  override async canActivate(context: ExecutionContext): Promise<boolean> {
    try {
      await super.canActivate(context);
    } catch {
      // Ignore: anonymous is allowed on these routes.
    }
    return true;
  }
}
