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
   * The basket is `COMPLETED` or `ARCHIVED`, and the write asked to change it
   * (plan 0055, section 3.3).
   *
   * Its own code rather than a `validation_failed` for the reason plan 0054
   * section 4 gives: a client that cannot tell a state it can explain from a bug
   * it cannot will show the wrong sentence for both. Nothing about the request
   * was malformed, and no field of it is at fault; the trip is over.
   */
  GENERATED_LIST_FINISHED: 'generated_list_finished',
  /**
   * The number this write was moving is not where the caller believed it started
   * (plan 0057, section 5; plan 0056, section 3.2).
   *
   * Its own code and not a `conflict`, because the client's reaction is
   * particular: refetch and redraw the control at the number as it now stands,
   * rather than show a failure. Two phones in one shop dragging one line is the
   * ordinary case this exists for, and a gesture whose meaning depends on where
   * it started must be refused rather than reinterpreted.
   */
  STALE_QUANTITY: 'stale_quantity',
  /**
   * A contribution was set below what this basket has already bought against it
   * (plan 0057, section 5.2).
   *
   * The message names the floor, so the client can say the number rather than
   * only that it failed. Distinct from {@link STALE_QUANTITY} because nothing
   * moved underneath the caller: the number they sent is simply lower than a
   * purchase that has already happened, and two units of the flat's milk having
   * been bought means the flat cannot retroactively have wanted one.
   */
  BELOW_SETTLED: 'below_settled',
  /**
   * The account itself is refusing attempts, having failed too many times in a
   * row (plan 0071, section 7; `apps/luna-shopper-admin/plans/0002`, section 2).
   *
   * Its own code rather than a {@link RATE_LIMITED}, because the two are
   * different mechanisms that resolve differently and the operator has to be
   * able to tell them apart. Throttling limits a *source*: another address, or
   * the same one a minute later, gets through. A lockout protects an *account*:
   * changing network does nothing, and it clears when the window passes or when
   * somebody with the server clears it. Answering both with one code makes the
   * lockout invisible, and the lockout is the one an operator most needs to
   * understand.
   *
   * It confirms nothing. The count is kept by username whether or not that
   * username exists, so a caller only ever meets this for a name they have
   * already failed against themselves.
   */
  ACCOUNT_LOCKED: 'account_locked',
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
  // 409 rather than 400. The request was well formed and the caller is allowed
  // to make it; what refuses it is the state of the basket, which is what a
  // conflict is. It stays distinguishable from a plain `conflict` by its code,
  // which is what lets velista say "this basket is finished".
  [ERROR_CODES.GENERATED_LIST_FINISHED]: HttpStatus.CONFLICT,
  // Both are 409 for the same reason and stay apart from it, and from each
  // other, by code: the request was well formed, and what it conflicts with is
  // state that moved or state that has already happened.
  [ERROR_CODES.STALE_QUANTITY]: HttpStatus.CONFLICT,
  [ERROR_CODES.BELOW_SETTLED]: HttpStatus.CONFLICT,
  // 423 rather than 429. A 429 is a statement about how fast the caller is
  // going, and slowing down fixes it; this one is a statement about the state
  // the account is in, which no amount of waiting between requests changes. It
  // stays apart from `rate_limited` at the status level as well as the code
  // level so a proxy or a log reader sees the difference too.
  [ERROR_CODES.ACCOUNT_LOCKED]: HttpStatus.LOCKED,
  [ERROR_CODES.INTERNAL]: HttpStatus.INTERNAL_SERVER_ERROR,
};
