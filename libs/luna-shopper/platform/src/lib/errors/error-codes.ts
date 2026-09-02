import { HttpStatus } from '@nestjs/common';

/**
 * Stable, transport neutral error codes (plan 0004, sections 2 and 10).
 *
 * A code is the contract between services and the client: broker errors carry the
 * code and the gateway maps it to an HTTP status rather than leaking a raw stack,
 * and the client shows a message the {@link ERROR_CATALOG} already translated. The
 * string values are the wire format and must stay stable; add new codes rather
 * than renaming existing ones.
 */
export const ERROR_CODES = {
  VALIDATION_FAILED: 'validation_failed',
  UNAUTHORIZED: 'unauthorized',
  FORBIDDEN: 'forbidden',
  NOT_FOUND: 'not_found',
  CONFLICT: 'conflict',
  RATE_LIMITED: 'rate_limited',
  /**
   * The deployment does not have this feature configured (plan 0026).
   *
   * A statement about the server, not about the caller: Google sign in with no
   * OAuth credentials, or registration with no SMTP host. Distinct from the
   * others because the caller did nothing wrong and retrying will not help.
   */
  NOT_CONFIGURED: 'not_configured',
  /**
   * The caller's build predates the oldest one this deployment serves (velista
   * plan 0034, D9).
   *
   * Like {@link NOT_CONFIGURED} this is not the caller's fault, but unlike it the
   * caller can fix it, and in the normal case already has: the client reacts by
   * asking its service worker for a new version and reloading into it. Distinct
   * from every other code because it says nothing about *this* request, which may
   * have been perfectly well formed. It says the client that sent it is retired.
   */
  CLIENT_TOO_OLD: 'client_too_old',
  /**
   * A catalog read that returns items or prices arrived with no scope selector,
   * and the caller's shopping profile holds neither a postal code nor a chain
   * (plan 0049, section 3).
   *
   * Its own code and not a `validation_failed`, because the frontend renders it
   * as an **onboarding step** rather than as a failure: it sends the user to the
   * profile page to say where they shop. The two answers it deliberately is not:
   * everything, which nobody asked for, and an empty page, which reads as "there
   * is nothing" and is a different and false statement.
   */
  CATALOG_SCOPE_REQUIRED: 'catalog_scope_required',
  /**
   * The basket line moved under the caller between reading it and acting on it
   * (plan 0056, section 3.2).
   *
   * Named for **what happened** rather than for the field that carried it,
   * because the client's recovery is a refetch and not a correction: nobody can
   * fix `from`, they can only look again at a number somebody else has changed.
   *
   * Its own code rather than {@link CONFLICT} because the two ask the reader for
   * different things. A conflict on this surface is a state that refuses the act
   * outright ("this line is already finished"); this is an act that would still
   * be valid, and might mean the **opposite** of what was intended, which is the
   * inversion section 3.2 exists to make impossible.
   */
  OUTSTANDING_MOVED: 'outstanding_moved',
  /**
   * The basket is `COMPLETED` or `ARCHIVED`, so it takes no more writes (plan
   * 0055, section 3.3, and plan 0056, section 5).
   *
   * Distinct from {@link CONFLICT} for the reason plan 0054 section 4 gave when
   * it split "this line is already finished" off `validation_failed`: a client
   * that cannot tell a state it can explain from a bug it cannot will show the
   * wrong sentence for both. The line and the basket being finished are two
   * different sentences.
   */
  BASKET_FINISHED: 'basket_finished',
  INTERNAL: 'internal',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

/**
 * 426 Upgrade Required, named here because Nest does not name it.
 *
 * `HttpStatus` stops at 424 Failed Dependency and resumes at 428 Precondition
 * Required, so the enum has no member for 426 to import. Reaching for one is
 * worse than a missing constant: it fails the type check, and wherever the type
 * check is skipped it reads as `undefined` at runtime, which would leave a
 * refused client with whatever status the response layer makes of nothing.
 *
 * The cast keeps the map below typed as statuses rather than widening it to
 * `number`, which is the property that stops an unrelated integer landing there.
 */
const UPGRADE_REQUIRED = 426 as HttpStatus;

/**
 * The single source of truth mapping each code to its HTTP status. The gateway
 * uses it to translate a broker error into a response status; the exception
 * filter uses it for locally thrown domain exceptions.
 */
export const ERROR_STATUS: Record<ErrorCode, HttpStatus> = {
  [ERROR_CODES.VALIDATION_FAILED]: HttpStatus.BAD_REQUEST,
  [ERROR_CODES.UNAUTHORIZED]: HttpStatus.UNAUTHORIZED,
  [ERROR_CODES.FORBIDDEN]: HttpStatus.FORBIDDEN,
  [ERROR_CODES.NOT_FOUND]: HttpStatus.NOT_FOUND,
  [ERROR_CODES.CONFLICT]: HttpStatus.CONFLICT,
  [ERROR_CODES.RATE_LIMITED]: HttpStatus.TOO_MANY_REQUESTS,
  // 501 rather than 503 or 404. 503 says "try again later", which is wrong for a
  // deployment that will never have Google. 404 says the route does not exist,
  // which contradicts keeping it in the published document. 501 is exactly "this
  // server does not implement that", which is the truth.
  [ERROR_CODES.NOT_CONFIGURED]: HttpStatus.NOT_IMPLEMENTED,
  // 426 rather than 400 or 403. The request may have been valid and the caller may
  // be perfectly authorised; what is wrong is the software that sent it, and
  // "Upgrade Required" is the one status that says exactly that.
  [ERROR_CODES.CLIENT_TOO_OLD]: UPGRADE_REQUIRED,
  // 400, sharing a status with validation and staying distinguishable by code,
  // which is the whole reason the code exists: the client branches on it to open
  // the profile page rather than to show a field error.
  [ERROR_CODES.CATALOG_SCOPE_REQUIRED]: HttpStatus.BAD_REQUEST,
  // 409 beside `conflict`, and told apart from it by code. Both are a well
  // formed request the current state refuses; this one adds that the state moved
  // *since the caller read it*, which is why the client refetches rather than
  // rephrasing anything.
  [ERROR_CODES.OUTSTANDING_MOVED]: HttpStatus.CONFLICT,
  // 409 under the same rule: the basket is finished, which is a state and not a
  // fault in the request.
  [ERROR_CODES.BASKET_FINISHED]: HttpStatus.CONFLICT,
  [ERROR_CODES.INTERNAL]: HttpStatus.INTERNAL_SERVER_ERROR,
};
