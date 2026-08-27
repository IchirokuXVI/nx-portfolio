import { applyDecorators } from '@nestjs/common';
import { ApiResponse } from '@nestjs/swagger';
import {
  ERROR_CODES,
  ERROR_STATUS,
  PROBLEM_JSON_CONTENT_TYPE,
  resolveErrorMessage,
  type ErrorCode,
} from '@portfolio/luna-shopper/platform';
import { componentRef, hoistProblemDetails } from './openapi-schema';

export interface ProblemResponseOptions {
  /** The route is behind `JwtAuthGuard`, so a missing or bad token is a 401. */
  auth?: boolean;
  /** The route resolves a zone membership, so it can be a 403 or a 404. */
  membership?: boolean;
  /** The route takes a request body, so validation can reject it with a 400. */
  body?: boolean;
  /**
   * The route can answer 404 without ever answering 403, which `membership`
   * cannot express: a public lookup has no membership to be forbidden by.
   */
  notFound?: boolean;
  /** The route can collide with the current state (a 409). */
  conflict?: boolean;
  /**
   * The global throttler guard covers every route, so 429 is documented by
   * default; pass `false` for the handful that carry `@SkipThrottle()`.
   */
  throttled?: boolean;
}

const problemName = hoistProblemDetails();

/** One documented error status, always the house envelope (plan 0004, section 2). */
function problem(code: ErrorCode) {
  return ApiResponse({
    status: ERROR_STATUS[code],
    description: `\`${code}\` — ${resolveErrorMessage(code)}`,
    content: {
      [PROBLEM_JSON_CONTENT_TYPE]: { schema: componentRef(problemName) },
    },
  });
}

/**
 * Documents the errors a route can produce, derived from what guards it (plan
 * 0019, section 3).
 *
 * Every error in this system is the same RFC 7807 envelope, and the set of
 * statuses a route can return follows from its guards, so the statuses come from
 * `ERROR_STATUS` — the very map the exception filter uses to pick them — rather
 * than from a hand written `@ApiResponse({ status: 403 })` repeated across a
 * hundred handlers. Applied on a controller class it covers every one of its
 * routes; applied on a handler it adds to that set, because Swagger merges class
 * level responses into each operation.
 */
export function ApiProblemResponses(
  options: ProblemResponseOptions = {}
): MethodDecorator & ClassDecorator {
  const codes: ErrorCode[] = [];
  if (options.body) {
    codes.push(ERROR_CODES.VALIDATION_FAILED);
  }
  if (options.auth) {
    codes.push(ERROR_CODES.UNAUTHORIZED);
  }
  if (options.membership) {
    codes.push(ERROR_CODES.FORBIDDEN, ERROR_CODES.NOT_FOUND);
  }
  if (options.notFound && !options.membership) {
    codes.push(ERROR_CODES.NOT_FOUND);
  }
  if (options.conflict) {
    codes.push(ERROR_CODES.CONFLICT);
  }
  if (options.throttled !== false) {
    codes.push(ERROR_CODES.RATE_LIMITED);
  }
  codes.push(ERROR_CODES.INTERNAL);

  return applyDecorators(...codes.map(problem));
}
