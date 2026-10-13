import {
  applyDecorators,
  Injectable,
  SetMetadata,
  UseGuards,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ImpersonationNotAllowedException } from '@portfolio/luna-shopper/platform';
import type { CurrentUser } from './jwt.strategy';

/** The metadata key {@link RefuseImpersonation} writes and its guard reads. */
export const REFUSES_IMPERSONATION = 'luna:refusesImpersonation';

/**
 * Refuses a support session on a route that only the person may use (plan
 * 0194).
 *
 * It reads {@link CurrentUser.impersonation}, which `JwtStrategy` set from the
 * `act` claim of the token. An ordinary token has none and passes untouched.
 *
 * **It must run after the JWT guard**, because that guard is what puts the user
 * on the request. A request that presents a token and has no user yet means the
 * order is wrong, and this guard then throws and does not pass: a route that
 * silently refused nobody is the failure this check exists to prevent. A
 * request with no token at all is anonymous, which only an optionally
 * authenticated route allows, and passes.
 */
@Injectable()
export class RefuseImpersonationGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const refuses = this.reflector.getAllAndOverride<boolean | undefined>(
      REFUSES_IMPERSONATION,
      [context.getHandler(), context.getClass()]
    );
    if (!refuses) {
      return true;
    }
    const request = context.switchToHttp().getRequest<{
      user?: CurrentUser;
      headers?: Record<string, unknown>;
    }>();
    if (!request.user) {
      if (request.headers?.['authorization'] !== undefined) {
        throw new Error(
          '@RefuseImpersonation() ran before the JWT guard. Place it above @UseGuards on the handler.'
        );
      }
      return true;
    }
    if (request.user.impersonation) {
      throw new ImpersonationNotAllowedException(
        'A support session cannot use this route'
      );
    }
    return true;
  }
}

/**
 * A support session cannot call this route (plan 0194). It answers 403
 * `impersonation_not_allowed`, so the session stays and the operator reads why.
 *
 * ```ts
 * @Delete()
 * @RefuseImpersonation()
 * remove(@AuthUser() user: CurrentUser) { ... }
 * ```
 *
 * **Place it above the `@UseGuards` of the handler.** Decorators apply from the
 * bottom up and Nest runs guards in the order they were added, so the lower
 * one runs first. On a controller that is guarded at the class, any place on
 * the handler works, because class guards run before handler guards.
 *
 * It does not document the 403 itself. Swagger keeps one response for each
 * status, so the route passes `impersonation: 'refused'` to its own
 * `ApiProblemResponses`, beside whatever other 403 it already documents.
 *
 * The list of routes that carry it is the owner's (plan 0194, target state 8).
 * Do not add one or remove one without asking.
 */
export function RefuseImpersonation(): MethodDecorator {
  return applyDecorators(
    SetMetadata(REFUSES_IMPERSONATION, true),
    UseGuards(RefuseImpersonationGuard)
  );
}
