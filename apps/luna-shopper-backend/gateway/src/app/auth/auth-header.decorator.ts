import { createParamDecorator, type ExecutionContext } from '@nestjs/common';

/**
 * Injects the caller's raw `Authorization` header.
 *
 * It exists for the assistant (plan 0039, rule A1), which is the only thing in
 * this gateway that needs the credential itself rather than the identity behind
 * it: the assistant acts on the caller's behalf against this same API, carrying
 * this header verbatim, so that it can do exactly what that user could do by
 * tapping and nothing more.
 *
 * A param decorator rather than `@Headers('authorization')`, and the difference
 * is the published contract. Nest's Swagger plugin documents a `@Headers()`
 * parameter as a **required header parameter** on the operation, which duplicates
 * the `access-token` bearer scheme the route already declares and makes a
 * generated client ask its caller for a header it is already sending. This reads
 * the same value and publishes nothing.
 */
export const AuthHeader = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string => {
    const request = context.switchToHttp().getRequest<{
      headers?: Record<string, string | string[] | undefined>;
    }>();
    const raw = request.headers?.['authorization'];
    return Array.isArray(raw) ? (raw[0] ?? '') : (raw ?? '');
  }
);
