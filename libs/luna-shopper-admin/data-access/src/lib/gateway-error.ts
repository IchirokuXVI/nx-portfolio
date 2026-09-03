import type { SignInFailure } from '@portfolio/luna-shopper-admin/models';

/**
 * A failure the gateway described, as the one error type that leaves this
 * library.
 *
 * No component ever sees an `HttpErrorResponse`, and no component switches on a
 * status number. The screen switches on a {@link SignInFailure}, which this file
 * also produces; `code` and `status` exist for the two places inside
 * `data-access` that need them and for a log line that can be matched to a
 * server one by `correlationId`.
 *
 * Much smaller than velista's. There is no `fieldErrors` map because the only
 * form in this plan has two fields and one answer for both of them, and no
 * `NetworkError` class because this app draws no connection screen: a request
 * that produced no response is a failure with status 0, and every caller here
 * treats it the same way it treats a 500.
 */
export class GatewayError extends Error {
  /** The server's stable code, or `''` when the body carried none. */
  readonly code: string;
  /** The HTTP status, or `0` when the request produced no response at all. */
  readonly status: number;
  /** For matching this to a server log. `''` when the body carried none. */
  readonly correlationId: string;
  /** The server's own wait, in whole seconds, only when it named one. */
  readonly retryAfterSeconds?: number;

  constructor(init: {
    code: string;
    status: number;
    correlationId: string;
    retryAfterSeconds?: number;
  }) {
    // For a stack trace and a log, never for a screen. Every operator facing
    // string is chosen by the page from the failure reason.
    super(
      `${init.code || 'unknown'} (${init.status}) ref ${init.correlationId}`
    );
    this.name = 'GatewayError';
    this.code = init.code;
    this.status = init.status;
    this.correlationId = init.correlationId;
    this.retryAfterSeconds = init.retryAfterSeconds;
  }
}

/**
 * Whatever Angular threw, as a {@link GatewayError}.
 *
 * Rule D4 applies with most force on the error path, because an error body is
 * the response *most* likely to arrive malformed: a proxy timeout page, an
 * unhandled exception, or a CORS failure all produce something that is not the
 * house envelope. Nothing here reads a property off an unvalidated object.
 */
export function toGatewayError(error: unknown): GatewayError {
  const response = error as { status?: unknown; error?: unknown } | null;
  const status = typeof response?.status === 'number' ? response.status : 0;
  const body = asRecord(response?.error);

  return new GatewayError({
    code: typeof body?.['code'] === 'string' ? body['code'] : '',
    status,
    correlationId:
      typeof body?.['correlationId'] === 'string' ? body['correlationId'] : '',
    retryAfterSeconds: asWaitSeconds(body?.['retryAfterSeconds']),
  });
}

/**
 * A failed sign in, as the reason the screen says something about (plan 0002,
 * section 2).
 *
 * The branch order is code first, status second. The code is the contract; the
 * status is the fallback for a body that never reached this app intact, which is
 * the case where a proxy answered instead of the gateway.
 *
 * There is deliberately **no branch for a disabled account**. Plan 0071 answers
 * a disabled admin with the same 401 as a wrong password, so that it cannot be
 * told apart from a typo by whoever is guessing usernames, and a client branch
 * for it would be dead code that suggested otherwise.
 */
export function toSignInFailure(error: unknown): SignInFailure {
  const gateway = error instanceof GatewayError ? error : toGatewayError(error);
  const { retryAfterSeconds } = gateway;

  switch (gateway.code) {
    case 'unauthorized':
      return { reason: 'invalid-credentials' };
    case 'account_locked':
      return { reason: 'locked-out', retryAfterSeconds };
    case 'rate_limited':
      return { reason: 'throttled', retryAfterSeconds };
    case 'not_configured':
      return { reason: 'not-available' };
  }

  switch (gateway.status) {
    case 401:
      return { reason: 'invalid-credentials' };
    case 423:
      return { reason: 'locked-out', retryAfterSeconds };
    case 429:
      return { reason: 'throttled', retryAfterSeconds };
    case 501:
      return { reason: 'not-available' };
    default:
      // A 500, a 502, a request that never arrived, or a body nothing could
      // read. Named rather than absent, so the mapping is total and an
      // unanticipated failure still reaches the screen as a sentence.
      return { reason: 'unknown' };
  }
}

/**
 * The server's wait, or `undefined`.
 *
 * Rendered as a number an operator is asked to wait, so a string, a negative or
 * a `NaN` has to become "we were not told" rather than something the screen
 * tries to say out loud.
 */
function asWaitSeconds(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.ceil(value)
    : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
