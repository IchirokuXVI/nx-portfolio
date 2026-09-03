import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { CurrentAdmin } from './admin-jwt.strategy';

/**
 * Injects the authenticated operator into a handler parameter.
 *
 * Deliberately a different decorator from `AuthUser`, returning a different
 * shape, so no handler can accept either principal by accident: an admin route
 * that asked for `AuthUser` would read `request.user` and find an object with no
 * `userId`, which is a bug that compiles. `CurrentAdmin` carries `adminId` and no
 * `userId` precisely so that mistake does not type check.
 */
export const ActingAdmin = createParamDecorator(
  (_data: unknown, context: ExecutionContext): CurrentAdmin => {
    const request = context.switchToHttp().getRequest();
    return request.user as CurrentAdmin;
  }
);
