import type * as Wire from '../wire/wire-types';
import type { HarvestRun } from './harvest-run';

/**
 * What a leaflet import dropped, and why (admin plan 0010, section 5).
 *
 * A `LEAFLET_IMPORT` run's counters say how much was skipped and how much was
 * queued. They do not say which offer or which rule, and that is the question
 * the operator actually has: the owner's condition for dropping loyalty offers
 * at all was that he could see afterwards what had been dropped.
 *
 * The extractor's own warnings ride in the same list with code `EXTRACTOR`
 * (backend plan 0081, section 7), so what the extractor lost and what the
 * import skipped are read in one place rather than in two.
 */
export interface RunWarningRow {
  /** Stable within one run, for the table's `track`. */
  readonly key: string;
  readonly code: Wire.EnumsHarvestWarningCode;
  /** The offer, or `''` for a warning about the document as a whole. */
  readonly offerId: string;
  /** The page, or `''` where the warning names none. */
  readonly page: string;
  /** What the leaflet printed, where the warning carries it. */
  readonly name: string;
  /** The harvester's own sentence, shown as it came. */
  readonly message: string;
}

/**
 * Whether this run read a document rather than fetched anything.
 *
 * The one thing that decides whether the warnings table and the queue link are
 * drawn at all. A discovery run's `warnings` is empty, so drawing an empty
 * table for it would be harmless and would still be an empty table on every
 * catalog run anybody opens.
 */
export function isLeafletRun(run: HarvestRun | null): boolean {
  return run !== null && run.mode === 'LEAFLET_IMPORT';
}

/**
 * The run's warnings as rows.
 *
 * A `null` page or offer becomes `''` rather than the word "null", because the
 * cell is drawn when it has something in it and left out when it does not, the
 * same rule the run's own facts follow.
 */
export function runWarningRows(
  run: HarvestRun | null
): readonly RunWarningRow[] {
  if (run === null) {
    return [];
  }

  return run.warnings.map((warning, index) => ({
    key: `${index}`,
    code: warning.code,
    offerId: warning.offerId ?? '',
    page: warning.page === null ? '' : String(warning.page),
    name: warning.name ?? '',
    message: warning.message,
  }));
}

/**
 * How many offers this run put in front of a person.
 *
 * `notFound` is the counter the import writes a queue entry against (backend
 * plan 0081, section 7), so it is the count the queue link carries. Naming it
 * here rather than reading `notFound` at the call site is the whole of the
 * difference: on a crawl that counter means a product the storefront no longer
 * stocks, and the two are not the same number with two names.
 */
export function queuedByRun(run: HarvestRun | null): number {
  return run === null || !isLeafletRun(run) ? 0 : run.notFound;
}
