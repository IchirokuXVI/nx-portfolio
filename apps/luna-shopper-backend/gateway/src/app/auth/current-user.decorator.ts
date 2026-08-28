import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { CurrentUser } from './jwt.strategy';

/**
 * Injects the authenticated caller (set by {@link JwtStrategy}) into a handler
 * parameter. On optionally authenticated routes it is `undefined` when the
 * request carried no token.
 */
export const AuthUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): CurrentUser | undefined => {
    const request = context.switchToHttp().getRequest();
    return request.user as CurrentUser | undefined;
  }
);
