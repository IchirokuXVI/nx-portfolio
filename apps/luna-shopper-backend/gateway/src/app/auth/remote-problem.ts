import { UnauthorizedException } from '@nestjs/common';
import { ERROR_CODES, type ErrorCode } from '@portfolio/luna-shopper/platform';

/** Every code a service can hand back, narrowed to the stable set. */
const KNOWN_ERROR_CODES = new Set<string>(Object.values(ERROR_CODES));

/**
 * The stable error code behind a rejected NATS call.
 *
 * A rejected call carries the house problem envelope a service already produced,
 * either bare or nested under `error` (plan 0004, section 2); anything else is
 * genuinely unexpected and is reported as such. Only codes from `ERROR_CODES`
 * are ever emitted, so what comes back is a value the caller can branch on
 * rather than whatever a stack trace happened to say.
 */
export function errorCodeOf(error: unknown): ErrorCode {
  for (const candidate of [error, (error as { error?: unknown })?.error]) {
    const code = (candidate as { code?: unknown })?.code;
    if (typeof code === 'string' && KNOWN_ERROR_CODES.has(code)) {
      return code as ErrorCode;
    }
  }
  return ERROR_CODES.INTERNAL;
}

/**
 * What to throw when auth cannot find the account a call is about, **and the
 * only thing that named that account was the caller's own token**.
 *
 * A signature that verifies and an `exp` in the future say the token was issued
 * by us and has not lapsed. They say nothing about whether the user it names
 * still exists, and the two come apart whenever an account is deleted inside the
 * access token's lifetime, or a database is reset under a client still holding a
 * pair from before it.
 *
 * Left alone, that reaches the client as a 404 `not_found`, which is a statement
 * about a **resource** and is unactionable here: the client cannot tell it from
 * "no zone has that join code", so it keeps a dead credential in storage and
 * every later attempt fails in exactly the same way, forever. A token naming
 * nobody is an invalid token, so the honest answer is 401 `unauthorized`, which
 * is the one code the client already reads as "these credentials are spent": it
 * refreshes, the refresh fails too, and the pair is deleted from the browser.
 *
 * Only ever applied to a call keyed on the `userId` the token carried. A 404
 * about a zone, a list or a membership is about that resource and passes through
 * untouched.
 */
export function asRejectedCredentials(error: unknown): unknown {
  return errorCodeOf(error) === ERROR_CODES.NOT_FOUND
    ? new UnauthorizedException('The account this token names no longer exists')
    : error;
}
