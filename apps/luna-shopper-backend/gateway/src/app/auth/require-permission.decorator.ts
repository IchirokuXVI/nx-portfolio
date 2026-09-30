import {
  applyDecorators,
  Injectable,
  SetMetadata,
  UseGuards,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiBearerAuth } from '@nestjs/swagger';
import type { Permission } from '@portfolio/luna-shopper/contracts';
import {
  PERMISSION_REQUIRED_DETAIL,
  PermissionRequiredException,
  UnauthorizedException,
} from '@portfolio/luna-shopper/platform';
import { ApiProblemResponses } from '../docs';
import { JwtAuthGuard } from './jwt-auth.guard';
import type { CurrentUser } from './jwt.strategy';

/** The metadata key {@link RequirePermission} writes and {@link PermissionGuard} reads. */
export const REQUIRED_PERMISSION = 'luna:requiredPermission';

/**
 * Refuses a caller whose token does not carry `permission` (plan 0175).
 *
 * Reads {@link CurrentUser.permissions}, which `JwtStrategy` took from the
 * token's `perms` claim, and never a role: a role is only a name for a set of
 * permissions, and `PERMISSIONS_OF` in the contracts is the one place a role
 * name is read.
 *
 * **It fails closed.** A request with no authenticated user is a 401, so a route
 * that somehow reaches this guard without `JwtAuthGuard` before it refuses
 * everybody rather than letting everybody in. A handler with no required
 * permission passes, which is only reachable if the guard is applied by hand.
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Permission | undefined>(
      REQUIRED_PERMISSION,
      [context.getHandler(), context.getClass()]
    );
    if (!required) {
      return true;
    }
    const user = context
      .switchToHttp()
      .getRequest<{ user?: CurrentUser }>().user;
    if (!user) {
      throw new UnauthorizedException('Authentication required');
    }
    if (!user.permissions?.includes(required)) {
      throw new PermissionRequiredException(`Requires ${required}`, {
        details: { [PERMISSION_REQUIRED_DETAIL]: required },
      });
    }
    return true;
  }
}

/**
 * Only an account holding `permission` may call this route (plan 0175).
 *
 * ```ts
 * @Post(':id/walks')
 * @RequirePermission('shopMap.record')
 * createWalk(@AuthUser() user: CurrentUser) { ... }
 * ```
 *
 * Self sufficient on purpose: it applies `JwtAuthGuard` itself, so it works on a
 * controller whose other routes are public or optionally authenticated. On a
 * controller already behind `JwtAuthGuard` the token is verified twice, which is
 * a signature check and no request to auth.
 *
 * Without the permission the answer is 403 `permission_required`, with the
 * permission's name in `details.permission`. It is documented here as well; a
 * route that documents another 403 of its own (a zone membership) must pass
 * `permission: true` to its own `ApiProblemResponses`, because Swagger keeps one
 * response per status and the later declaration wins.
 *
 * A permission granted to an account reaches its token at the next refresh, at
 * most one access token lifetime (15 minutes) after an operator sets the role.
 */
export function RequirePermission(
  permission: Permission
): MethodDecorator & ClassDecorator {
  return applyDecorators(
    SetMetadata(REQUIRED_PERMISSION, permission),
    UseGuards(JwtAuthGuard, PermissionGuard),
    ApiBearerAuth('access-token'),
    ApiProblemResponses({ auth: true, permission: true })
  );
}
