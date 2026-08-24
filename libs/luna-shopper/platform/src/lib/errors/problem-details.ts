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
}

/** The `Content-Type` RFC 7807 defines for these responses. */
export const PROBLEM_JSON_CONTENT_TYPE = 'application/problem+json';
