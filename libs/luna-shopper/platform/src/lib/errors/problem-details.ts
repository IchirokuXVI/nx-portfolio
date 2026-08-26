import type { ErrorCode } from './error-codes';

/**
 * The house error envelope (plan 0004, section 2), aligned with RFC 7807
 * problem+json. Returned for every error the client can see.
 *
 * - `type`/`title`/`status`/`detail` are the RFC 7807 members.
 * - `code` is the stable machine code ({@link ErrorCode}) the client can branch on.
 * - `message` is already translated to the request locale (section 12), so the
 *   frontend never has to know backend error codes to show something readable.
 * - `correlationId` is always present, so a user reported error maps to exactly
 *   one log entry.
 * - `errors` carries per field validation detail when the code is
 *   `validation_failed`.
 * - `retryAfterSeconds` carries the wait when the code is `rate_limited`
 *   (plan 0021, section 2). It rides in the body rather than in `Retry-After`
 *   because that header is not CORS safelisted, so a browser client physically
 *   cannot read it; the envelope is the one place a client has to look.
 */
export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  code: ErrorCode;
  detail?: string;
  message: string;
  correlationId: string;
  errors?: Record<string, string[]>;
  /** Whole seconds to wait before retrying. Present only for `rate_limited`. */
  retryAfterSeconds?: number;
}

/** The `Content-Type` RFC 7807 defines for these responses. */
export const PROBLEM_JSON_CONTENT_TYPE = 'application/problem+json';
