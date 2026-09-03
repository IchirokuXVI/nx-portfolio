import { applyDecorators, HttpStatus } from '@nestjs/common';
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
   * The route moves a number the caller read first, so the state can have moved
   * under them (plan 0057, section 5, and plan 0056, section 3.2). A 409 beside
   * `conflict`, told apart by code because the client's reaction is particular:
   * refetch and redraw the control at the number as it now stands.
   */
  staleQuantity?: boolean;
  /**
   * The global throttler guard covers every route, so 429 is documented by
   * default; pass `false` for the handful that carry `@SkipThrottle()`.
   */
  throttled?: boolean;
  /**
   * The route depends on a feature the deployment may not have configured, so it
   * can answer 501 (plan 0026). The routes stay in the document in every
   * environment; this is what says the document is honest about them.
   */
  notConfigured?: boolean;
  /**
   * The route writes to a basket that may be over, so it can answer 409 with a
   * code the client tells apart from a plain conflict (plan 0055, section 3.3).
   *
   * Documented separately from `conflict` for the same reason `staleQuantity`
   * is: they share a status and are told apart by `code`, and this is the one a
   * client turns into "this basket is finished" rather than into a retry.
   */
  finishedBasket?: boolean;
}

const problemName = hoistProblemDetails();

/**
 * One documented status, always the house envelope (plan 0004, section 2), and
 * **every code that can produce it**.
 *
 * Several codes per status rather than one, because Swagger keeps the last
 * `@ApiResponse` applied to a status and silently drops the rest: a route that
 * can answer `conflict`, `outstanding_moved` and `basket_finished` would
 * otherwise document one of the three and hide the two a client actually
 * branches on (plan 0056, section 7). Each is named with its own message, so the
 * document says what the code means as well as that it exists.
 */
function problem(status: HttpStatus, codes: readonly ErrorCode[]) {
  return ApiResponse({
    status,
    description: codes
      .map((code) => `\`${code}\` — ${resolveErrorMessage(code)}`)
      .join('\n\n'),
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
  if (options.staleQuantity) {
    codes.push(ERROR_CODES.STALE_QUANTITY);
  }
  if (options.notConfigured) {
    codes.push(ERROR_CODES.NOT_CONFIGURED);
  }
  if (options.finishedBasket) {
    codes.push(ERROR_CODES.GENERATED_LIST_FINISHED);
  }
  if (options.throttled !== false) {
    codes.push(ERROR_CODES.RATE_LIMITED);
  }
  codes.push(ERROR_CODES.INTERNAL);

  // Grouped by status before anything is applied, so a status with several codes
  // is documented once with all of them (see `problem`). This is what lets
  // `finishedBasket` and `staleQuantity` sit beside `conflict`: they share a
  // status, and before the grouping the later of two declarations replaced the
  // earlier rather than adding to it, so a route had to choose which of its own
  // 409s to publish and hide the rest.
  const byStatus = new Map<HttpStatus, ErrorCode[]>();
  for (const code of codes) {
    const status = ERROR_STATUS[code];
    const listed = byStatus.get(status);
    if (listed) {
      listed.push(code);
    } else {
      byStatus.set(status, [code]);
    }
  }

  return applyDecorators(
    ...[...byStatus].map(([status, group]) => problem(status, group))
  );
}
