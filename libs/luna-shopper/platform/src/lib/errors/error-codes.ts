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
  INTERNAL: 'internal',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

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
  [ERROR_CODES.CLIENT_TOO_OLD]: HttpStatus.UPGRADE_REQUIRED,
  [ERROR_CODES.INTERNAL]: HttpStatus.INTERNAL_SERVER_ERROR,
};
