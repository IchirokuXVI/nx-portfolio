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
  [ERROR_CODES.INTERNAL]: HttpStatus.INTERNAL_SERVER_ERROR,
};
