/**
 * Why one operation of a bulk request was refused (backend plan 0100), in this
 * app's own words (rule D4).
 *
 * The two all or nothing routes the back office sends many operations through,
 * product group assignments and harvest entry decisions, mark each refused
 * operation with a code and the server's own sentence. The codes are the app's
 * own union, and a code this build does not know reads as `UNKNOWN` rather than
 * reaching a template as a raw string.
 */
export type BulkOperationErrorCode =
  | 'NOT_FOUND'
  | 'NOT_PENDING'
  | 'EXPECT_MISMATCH'
  | 'DUPLICATE_SUBJECT'
  | 'UNKNOWN_REFERENCE'
  | 'MALFORMED_OPERATION'
  | 'ALREADY_TAKEN'
  | 'UNKNOWN';

export interface BulkOperationError {
  readonly code: BulkOperationErrorCode;
  /** The server's sentence, shown as it came: it names the row and the value. */
  readonly detail: string;
}

const KNOWN: readonly BulkOperationErrorCode[] = [
  'NOT_FOUND',
  'NOT_PENDING',
  'EXPECT_MISMATCH',
  'DUPLICATE_SUBJECT',
  'UNKNOWN_REFERENCE',
  'MALFORMED_OPERATION',
  'ALREADY_TAKEN',
];

/** One operation's `error`, read from `unknown`. `null` when there is none. */
export function toBulkOperationError(raw: unknown): BulkOperationError | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const record = raw as Record<string, unknown>;
  const code = record['code'];
  const detail = record['detail'];

  return {
    code:
      typeof code === 'string' && (KNOWN as readonly string[]).includes(code)
        ? (code as BulkOperationErrorCode)
        : 'UNKNOWN',
    detail: typeof detail === 'string' ? detail : '',
  };
}
