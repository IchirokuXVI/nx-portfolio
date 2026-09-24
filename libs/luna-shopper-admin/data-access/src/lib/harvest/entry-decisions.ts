import type { Wire } from '@portfolio/luna-shopper-admin/models';
import {
  toBulkOperationError,
  type BulkOperationError,
} from '../bulk-operation-error';

/**
 * A decisions file's operations, as the route takes them (backend plan 0100).
 *
 * The generated shape is this app's parameter, as for every other harvest
 * write (admin plan 0004, section 2). The answer is not: it is read from
 * `unknown` into {@link EntryDecisionsAnswer} below.
 */
export type ApplyEntryDecisionsInput = Wire.ApplySourceEntryDecisionsDto;

/** One operation of a decisions file. */
export type EntryDecisionOperation = Wire.SourceEntryDecisionDto;

/**
 * Which of the route's steps refused a file, in this app's own words.
 *
 * `UNKNOWN` is a step this build does not know, drawn as such rather than as a
 * raw string.
 */
export type EntryDecisionsStep =
  | 'VALIDATE'
  | 'CREATE_ITEMS'
  | 'BIND'
  | 'UNKNOWN';

/** What the route did with one operation. */
export interface EntryDecisionOutcome {
  readonly op: 'accept' | 'createItem';
  readonly entryId: string;
  readonly ref: string | null;
  readonly applied: boolean;
  readonly itemId: string | null;
  readonly pricesWritten: number;
  /** Why this operation failed, when it is the one the refusal names. */
  readonly error: BulkOperationError | null;
}

/** A price the route could not write for a bound row, and why. */
export interface EntryDecisionPriceSkip {
  readonly entryId: string;
  readonly itemId: string;
  readonly reason: string;
}

/**
 * What applying a decisions file answered (backend plans 0100 and 0158).
 *
 * All or nothing: `applied` is the verdict for the whole file. A refused file
 * answers 201 with `applied: false`, and the operation that caused it carries
 * its reason while `failedStep` says where the route stopped.
 */
export interface EntryDecisionsAnswer {
  readonly runId: string | null;
  readonly applied: boolean;
  readonly failedStep: EntryDecisionsStep | null;
  readonly error: string | null;
  readonly results: readonly EntryDecisionOutcome[];
  readonly priceSkips: readonly EntryDecisionPriceSkip[];
  readonly orphanedItemIds: readonly string[];
}

/** An answer of the decisions route, read from `unknown` (rule D4). */
export function toEntryDecisionsAnswer(raw: unknown): EntryDecisionsAnswer {
  const record = asRecord(raw);
  const step = record['failedStep'];

  return {
    runId: stringOrNull(record['runId']),
    applied: record['applied'] === true,
    failedStep:
      step === null || step === undefined
        ? null
        : step === 'VALIDATE' || step === 'CREATE_ITEMS' || step === 'BIND'
          ? step
          : 'UNKNOWN',
    error: stringOrNull(record['error']),
    results: arrayOf(record['results']).map((entry) => {
      const line = asRecord(entry);
      return {
        op: line['op'] === 'createItem' ? 'createItem' : 'accept',
        entryId: typeof line['entryId'] === 'string' ? line['entryId'] : '',
        ref: stringOrNull(line['ref']),
        applied: line['applied'] === true,
        itemId: stringOrNull(line['itemId']),
        pricesWritten:
          typeof line['pricesWritten'] === 'number' ? line['pricesWritten'] : 0,
        error: toBulkOperationError(line['error']),
      };
    }),
    priceSkips: arrayOf(record['priceSkips']).map((entry) => {
      const skip = asRecord(entry);
      return {
        entryId: typeof skip['entryId'] === 'string' ? skip['entryId'] : '',
        itemId: typeof skip['itemId'] === 'string' ? skip['itemId'] : '',
        reason: typeof skip['reason'] === 'string' ? skip['reason'] : '',
      };
    }),
    orphanedItemIds: arrayOf(record['orphanedItemIds']).filter(
      (id): id is string => typeof id === 'string'
    ),
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

function arrayOf(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}
