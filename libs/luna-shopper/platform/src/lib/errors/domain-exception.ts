import { ERROR_CODES, type ErrorCode } from './error-codes';

/**
 * The domain exception hierarchy (plan 0004, section 2).
 *
 * A service throws one of these to signal a *deliberately handled* domain outcome
 * (not found, permission denied, a conflict). They carry a stable {@link ErrorCode}
 * and optional structured details, and the exception filter turns them into the
 * house error envelope with the right HTTP status and a localized message. Because
 * the code, not the class, crosses the broker, auth/core can raise these and the
 * gateway reproduces them for the client without sharing a stack.
 *
 * Anything that is *not* one of these is treated as unexpected: logged at `error`
 * with full reproduction context and returned as a generic 500 (section 1).
 */
export abstract class DomainException extends Error {
  abstract readonly code: ErrorCode;

  /**
   * Optional machine details. For a validation error this is the per field map;
   * for others it can carry the offending id or key. Never contains secrets.
   */
  readonly details?: Record<string, unknown>;

  /**
   * Message arguments for the error catalog (for example the resource name), so
   * the localized message can be parameterized without embedding user text here.
   */
  readonly messageArgs?: Record<string, string | number>;

  constructor(
    message: string,
    options?: {
      details?: Record<string, unknown>;
      messageArgs?: Record<string, string | number>;
      cause?: unknown;
    }
  ) {
    super(message);
    this.name = new.target.name;
    this.details = options?.details;
    this.messageArgs = options?.messageArgs;
    if (options?.cause !== undefined) {
      // `Error`'s `cause` option needs the ES2022 lib; assign it directly so the
      // chain is preserved regardless of the compile target.
      (this as { cause?: unknown }).cause = options.cause;
    }
  }
}

/** The request body failed DTO validation, or a domain invariant on input. */
export class ValidationException extends DomainException {
  readonly code = ERROR_CODES.VALIDATION_FAILED;
}

/** No credentials, or the token could not be verified. */
export class UnauthorizedException extends DomainException {
  readonly code = ERROR_CODES.UNAUTHORIZED;
}

/** Authenticated, but not allowed to perform this action (or on this zone). */
export class ForbiddenException extends DomainException {
  readonly code = ERROR_CODES.FORBIDDEN;
}

/** The addressed resource does not exist (or is not visible to the caller). */
export class NotFoundException extends DomainException {
  readonly code = ERROR_CODES.NOT_FOUND;
}

/** The request conflicts with current state (duplicate, version clash). */
export class ConflictException extends DomainException {
  readonly code = ERROR_CODES.CONFLICT;
}

/**
 * The feature exists in the code but is not configured on this deployment (plan
 * 0026): Google sign in with no OAuth credentials, registration with no SMTP
 * host.
 *
 * Renders as 501, and the distinction from every other code here is that it is a
 * statement about the server. Nothing the caller changes will make the request
 * succeed, and nothing is broken — the operator chose not to configure it.
 */
export class NotConfiguredException extends DomainException {
  readonly code = ERROR_CODES.NOT_CONFIGURED;
}

/**
 * The caller's build is older than the oldest this deployment serves (velista plan
 * 0034, D9).
 *
 * Renders as 426. Thrown only by `MinClientVersionGuard`, and only when the caller
 * identified itself with a version that parses *and* sorts below the configured
 * floor: an unrecognisable version, or no version at all, is never refused.
 */
export class ClientTooOldException extends DomainException {
  readonly code = ERROR_CODES.CLIENT_TOO_OLD;
}

/**
 * A catalog read that returns items or prices was sent with no scope selector,
 * by a caller whose shopping profile is empty (plan 0049, section 3).
 *
 * Renders as 400 beside `validation_failed` and is kept apart from it by code,
 * because the client's reaction is different in kind: not "fix this field" but
 * "tell us where you shop", which is a screen (velista 0046) rather than a
 * message. Thrown by the gateway, which is where the profile and the request meet.
 */
export class CatalogScopeRequiredException extends DomainException {
  readonly code = ERROR_CODES.CATALOG_SCOPE_REQUIRED;
}

/**
 * The basket is over, and the write asked to change it (plan 0055, section 3.3).
 *
 * A `COMPLETED` or `ARCHIVED` basket takes no new lines. Kept apart from
 * `conflict` and from `validation_failed` by its own code for the reason plan
 * 0054 section 4 gives: a client that cannot tell a state it can explain from a
 * bug it cannot will show the wrong sentence for both, and "this basket is
 * finished" is a sentence the shopper can act on.
 */
export class GeneratedListFinishedException extends DomainException {
  readonly code = ERROR_CODES.GENERATED_LIST_FINISHED;
}

/**
 * Too many attempts. Carries the wait so the client can count it down (plan 0021,
 * section 2.2). The seconds travel in {@link DomainException.details} under
 * {@link RETRY_AFTER_SECONDS_DETAIL}, and the exception filter lifts them onto the
 * envelope; the class exists so the throttler guard has something to throw that
 * the filter already knows how to render.
 */
export class RateLimitedException extends DomainException {
  readonly code = ERROR_CODES.RATE_LIMITED;
}

/** The `details` key a {@link RateLimitedException} carries its wait under. */
export const RETRY_AFTER_SECONDS_DETAIL = 'retryAfterSeconds';

/**
 * Reads a whole second wait out of a domain exception's details bag. Returns
 * undefined for every exception that does not carry one, which is all of them
 * except {@link RateLimitedException}.
 */
export function retryAfterSecondsOf(
  exception: DomainException
): number | undefined {
  const value = exception.details?.[RETRY_AFTER_SECONDS_DETAIL];
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
}

/** Type guard: is this a deliberately handled domain outcome? */
export function isDomainException(error: unknown): error is DomainException {
  return error instanceof DomainException;
}
