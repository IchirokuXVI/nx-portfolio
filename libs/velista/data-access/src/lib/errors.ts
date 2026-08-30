import {
  ERROR_CODE_FALLBACK,
  ERROR_CODES,
  type ErrorCode,
  type ProblemDetails,
} from '@portfolio/velista/models';

/**
 * The only two failures that leave `data-access`.
 *
 * No component ever sees an `HttpErrorResponse`. A container switches on `code`,
 * never on a status number scattered through the app (plan 0004, section 4.4).
 */

/** A failure the server described. */
export class GatewayError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly correlationId: string;
  /** Untranslated developer text. Goes in the support blob, never on screen. */
  readonly detail?: string;
  /** The server's localized but generic message. A fallback for copy, not the copy. */
  readonly serverMessage?: string;
  /** Field keys for a `validation_failed`. Used for its keys, not its strings. */
  readonly fieldErrors?: Readonly<Record<string, readonly string[]>>;
  /**
   * The wait the server asked for on a `rate_limited`, in seconds, when it named one.
   *
   * Undefined means it did not, which is not the same as zero and must never be
   * rendered as a countdown from an invented number (plan 0009, rule C3).
   */
  readonly retryAfterSeconds?: number;

  constructor(init: {
    code: ErrorCode;
    status: number;
    correlationId: string;
    detail?: string;
    serverMessage?: string;
    fieldErrors?: Readonly<Record<string, readonly string[]>>;
    retryAfterSeconds?: number;
  }) {
    // The message is for a stack trace and a log, not for a user. Every user-facing
    // string is chosen by the page from `code`.
    super(`${init.code} (${init.status}) ref ${init.correlationId}`);
    this.name = 'GatewayError';
    this.code = init.code;
    this.status = init.status;
    this.correlationId = init.correlationId;
    this.detail = init.detail;
    this.serverMessage = init.serverMessage;
    this.fieldErrors = init.fieldErrors;
    this.retryAfterSeconds = init.retryAfterSeconds;
  }
}

/**
 * A request that produced no response at all.
 *
 * Distinct from a `GatewayError` with a 5xx, which means the server is there and
 * answering. This one is what trips the blocking connection screen, and it is the
 * case where the client minted correlation id is the **only** id that exists, because
 * there is no body to read one from (plan 0004, section 4.6).
 */
export class NetworkError extends Error {
  readonly correlationId: string;
  readonly operation: string;

  constructor(correlationId: string, operation: string) {
    super(`network failure during ${operation} ref ${correlationId}`);
    this.name = 'NetworkError';
    this.correlationId = correlationId;
    this.operation = operation;
  }
}

/**
 * Whether a failure carried an HTTP response at all.
 *
 * Angular reports a request that never reached a server as status 0, and that one
 * number is the whole difference between "the server said no" and "nothing was said".
 * Two places in this library turn on it, and they are two decisions rather than one
 * repeated: `ConnectionRecovery` treats any answer, a 503 included, as proof the
 * network works, and `TokenStore` treats any answer as proof the refresh token was
 * spent (plan 0035, section 2). They must never disagree, so there is one of these.
 */
export function hasResponse(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    typeof (error as { status: unknown }).status === 'number' &&
    (error as { status: number }).status !== 0
  );
}

/**
 * Maps whatever came back into a `GatewayError`.
 *
 * Rule D4 applies to the error path too, and an error body is the response **most**
 * likely to arrive malformed: a proxy, a gateway timeout page, or an unhandled
 * exception all produce a non-JSON body with an HTTP status. Nothing here reads a
 * property off an unvalidated object.
 */
export function toGatewayError(
  body: unknown,
  status: number,
  fallbackCorrelationId: string
): GatewayError {
  const problem = asProblemDetails(body);

  return new GatewayError({
    code: problem?.code ?? codeForStatus(status),
    status,
    correlationId: problem?.correlationId ?? fallbackCorrelationId,
    detail: problem?.detail,
    serverMessage: problem?.message,
    fieldErrors: problem?.errors,
    retryAfterSeconds: problem?.retryAfterSeconds,
  });
}

function asProblemDetails(body: unknown): Partial<ProblemDetails> | null {
  if (!isRecord(body)) {
    return null;
  }

  const code = body['code'];
  const correlationId = body['correlationId'];

  return {
    code: isErrorCode(code) ? code : undefined,
    correlationId:
      typeof correlationId === 'string' ? correlationId : undefined,
    detail: typeof body['detail'] === 'string' ? body['detail'] : undefined,
    message: typeof body['message'] === 'string' ? body['message'] : undefined,
    errors: asFieldErrors(body['errors']),
    retryAfterSeconds: asWaitSeconds(body['retryAfterSeconds']),
  };
}

/**
 * The server's own wait, or `undefined`.
 *
 * Rule D4 applies with unusual force here: this number is rendered as a clock the user
 * watches count down, so a string, a negative, or a `NaN` has to become "we were not
 * told" rather than something the countdown tries to display.
 */
function asWaitSeconds(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.ceil(value)
    : undefined;
}

function asFieldErrors(
  value: unknown
): Readonly<Record<string, readonly string[]>> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const entries = Object.entries(value).flatMap(([field, messages]) =>
    Array.isArray(messages)
      ? [
          [
            field,
            messages.filter((m): m is string => typeof m === 'string'),
          ] as const,
        ]
      : []
  );

  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

/**
 * When the body carried no usable code, derive one from the status, so a proxy's HTML
 * 502 still becomes something a page can switch on.
 */
function codeForStatus(status: number): ErrorCode {
  switch (status) {
    case 400:
      return 'validation_failed';
    case 401:
      return 'unauthorized';
    case 403:
      return 'forbidden';
    case 404:
      return 'not_found';
    case 409:
      return 'conflict';
    case 429:
      return 'rate_limited';
    case 501:
      // A proxy's own 501, or a body this build could not read on a route the
      // deployment does not have configured. Distinct from `internal` because
      // retrying will not help and the copy has to say a different thing.
      return 'not_configured';
    default:
      return ERROR_CODE_FALLBACK;
  }
}

function isErrorCode(value: unknown): value is ErrorCode {
  return (
    typeof value === 'string' &&
    (ERROR_CODES as readonly string[]).includes(value)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
