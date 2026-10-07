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
  /**
   * The route is behind `ParticipantGuard`, so a credential naming no live
   * participant of the basket is a 401 with its own code, which a client must not
   * read as a dead account.
   */
  participant?: boolean;
  /** The route resolves a zone membership, so it can be a 403 or a 404. */
  membership?: boolean;
  /**
   * The route carries `@RequirePermission`, so an account without the
   * permission is a 403 of its own code (plan 0175). The decorator already
   * documents this; a route that also documents another 403 of its own must
   * pass it again, because Swagger keeps one response per status.
   */
  permission?: boolean;
  /** The route sets an account's roles, which a guest cannot hold (plan 0175). */
  guestRoles?: boolean;
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
  /**
   * The route names a shop, and a basket started at a shop refuses any other
   * with a 409 of its own code (plan 0163).
   */
  shopLocked?: boolean;
  /**
   * The route renames a line, so a name the list already holds can answer 409
   * with one of the three merge codes (plan 0112, section 7), each told apart
   * from a plain conflict because the client asks, explains, or explains with a
   * number.
   */
  lineMerge?: boolean;
  /**
   * The route reads the catalog at one shop (plan 0170): `locationId` beside
   * another selector is a 400 of its own code, and an unknown shop a 404 of
   * its own code.
   */
  atLocation?: boolean;
  /**
   * The route appends an entry to a walk (plan 0168, section 2): a stale base
   * is a 409 of its own code, a fold that does not validate or is too large a
   * 422, and an entry id already stored on another walk a plain 409.
   */
  shopWalk?: boolean;
  /**
   * The route can give a product a barcode (plan 0185), so a barcode another
   * product holds answers 409 with a code of its own. It is told apart from a
   * plain conflict because the client names the product that holds it.
   */
  eanHeld?: boolean;
  /**
   * The route can give a shop an external reference (plan 0195), so a
   * reference another shop holds answers 409 with a code of its own. It is
   * told apart from a plain conflict because the client names the shop that
   * holds it.
   */
  locationRefTaken?: boolean;
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
  if (options.participant) {
    codes.push(ERROR_CODES.NOT_A_PARTICIPANT);
  }
  if (options.membership) {
    codes.push(ERROR_CODES.FORBIDDEN, ERROR_CODES.NOT_FOUND);
  }
  if (options.permission) {
    codes.push(ERROR_CODES.PERMISSION_REQUIRED);
  }
  if (options.guestRoles) {
    codes.push(ERROR_CODES.GUEST_HAS_NO_ROLES);
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
    codes.push(ERROR_CODES.BASKET_FINISHED);
  }
  if (options.shopLocked) {
    codes.push(ERROR_CODES.BASKET_SHOP_LOCKED);
  }
  if (options.lineMerge) {
    codes.push(
      ERROR_CODES.LINE_MERGE_REQUIRED,
      ERROR_CODES.LINE_MERGE_NEEDS_APPROVAL,
      ERROR_CODES.LINE_MERGE_TOO_MANY_PRODUCTS
    );
  }
  if (options.atLocation) {
    codes.push(
      ERROR_CODES.CATALOG_LOCATION_EXCLUSIVE,
      ERROR_CODES.SUPERMARKET_LOCATION_NOT_FOUND
    );
  }
  if (options.shopWalk) {
    codes.push(
      ERROR_CODES.WALK_CHANGED,
      ERROR_CODES.CONFLICT,
      ERROR_CODES.SHOP_MAP_INVALID,
      ERROR_CODES.SHOP_MAP_TOO_LARGE
    );
  }
  if (options.eanHeld) {
    codes.push(ERROR_CODES.ITEM_EAN_HELD);
  }
  if (options.locationRefTaken) {
    codes.push(ERROR_CODES.LOCATION_EXTERNAL_REF_TAKEN);
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
