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
 * Smaller than velista's. There is no `NetworkError` class because this app
 * draws no connection screen: a request that produced no response is a failure
 * with status 0, and every caller here treats it the same way it treats a 500.
 *
 * `fieldErrors` arrived with `0004`, which is the plan that brought a form with
 * more than two fields. `ProblemDetails.errors` is present only on a
 * `validation_failed`, and the generic form puts each entry back on the field
 * that caused it rather than dumping the lot in a banner (section 5). The
 * messages are the server's own, already translated into the request's locale,
 * so this app shows them rather than re-keying them.
 */
export class GatewayError extends Error {
  /** The server's stable code, or `''` when the body carried none. */
  readonly code: string;
  /** The HTTP status, or `0` when the request produced no response at all. */
  readonly status: number;
  /** For matching this to a server log. `''` when the body carried none. */
  readonly correlationId: string;
  /**
   * The server's own untranslated sentence about this one failure.
   *
   * `''` when the body carried none, which is most of the time. Almost nothing
   * reads it, and nothing should read it to decide what to *say*: `message` is
   * the translated half of the envelope and this is the developer facing half.
   *
   * It is here because one refusal carries a fact that exists nowhere else in
   * the envelope. A leaflet upload refused with a 409 names the run that
   * already took that document, or the run already in progress, and the id is
   * in this sentence and in no field (backend plan 0081, section 7). Reading a
   * uuid out of prose is a weak contract, and it is the contract on offer.
   */
  readonly detail: string;
  /** The server's own wait, in whole seconds, only when it named one. */
  readonly retryAfterSeconds?: number;
  /** Per field messages, by field name. Empty unless the server sent any. */
  readonly fieldErrors: Readonly<Record<string, readonly string[]>>;

  constructor(init: {
    code: string;
    status: number;
    correlationId: string;
    detail?: string;
    retryAfterSeconds?: number;
    fieldErrors?: Readonly<Record<string, readonly string[]>>;
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
    this.detail = init.detail ?? '';
    this.retryAfterSeconds = init.retryAfterSeconds;
    this.fieldErrors = init.fieldErrors ?? {};
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
  // Already one. Without this the second pass reads `status` off it and finds
  // no body at all, so a fully described failure comes out with an empty code
  // and no field errors: a form would show "something went wrong" for a refusal
  // the server explained field by field. The stores call this on whatever they
  // caught, and one of the things they catch is this class.
  if (error instanceof GatewayError) {
    return error;
  }

  const response = error as { status?: unknown; error?: unknown } | null;
  const status = typeof response?.status === 'number' ? response.status : 0;
  const body = asRecord(response?.error);

  return new GatewayError({
    code: typeof body?.['code'] === 'string' ? body['code'] : '',
    status,
    correlationId:
      typeof body?.['correlationId'] === 'string' ? body['correlationId'] : '',
    detail: typeof body?.['detail'] === 'string' ? body['detail'] : '',
    retryAfterSeconds: asWaitSeconds(body?.['retryAfterSeconds']),
    fieldErrors: asFieldErrors(body?.['errors']),
  });
}

/**
 * `ProblemDetails.errors`, as a map this app is willing to render.
 *
 * Every layer is checked. The envelope promises a map of arrays of strings, and
 * this is the response most likely to arrive as something else entirely: a
 * proxy's error page, an unhandled exception, or a CORS failure. A field whose
 * value is not an array of strings is dropped rather than coerced, because a
 * half read message under an input is worse than the general banner the form
 * falls back to.
 */
function asFieldErrors(value: unknown): Record<string, readonly string[]> {
  const record = asRecord(value);
  if (record === null) {
    return {};
  }

  const errors: Record<string, readonly string[]> = {};
  for (const [field, messages] of Object.entries(record)) {
    if (Array.isArray(messages)) {
      const strings = messages.filter(
        (message): message is string => typeof message === 'string'
      );
      if (strings.length > 0) {
        errors[field] = strings;
      }
    }
  }

  return errors;
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

/**
 * A row that is not there, shaped the way the gateway's own answer would be.
 *
 * Two implementations raise it without a server having said anything: the
 * in-memory table when it holds no such row, and the HTTP one when a resource
 * with no read route has walked its collection without finding it. Both are the
 * same fact to the screen above, so both are the same error.
 */
export function notFoundError(): GatewayError {
  return new GatewayError({
    code: 'not_found',
    status: 404,
    correlationId: '',
  });
}
