import type * as Wire from '../wire/wire-types';
import type { HarvestRun } from './harvest-run';

/**
 * What a file import dropped, and why (admin plan 0010, section 5).
 *
 * A `FILE_IMPORT` run's counters say how much was skipped and how much was
 * queued. They do not say which product or which rule, and that is the question
 * the operator actually has: the owner's condition for dropping loyalty offers
 * at all was that he could see afterwards what had been dropped.
 *
 * The producer's own warnings ride in the same list with code `EXTRACTOR`
 * (backend plan 0086, section 6.1), so what the producer lost and what the
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
  /**
   * What the leaflet printed, where the warning carries it. `''` for a blank
   * name and for `LISTING_UNREAD` and `LISTING_SHORT`, whose sentence always
   * names the part.
   */
  readonly name: string;
  /** The harvester's own sentence, shown as it came. */
  readonly message: string;
}

/**
 * Whether this run read a document rather than fetched anything.
 *
 * The one thing that decides whether the warnings table is drawn at all. A
 * discovery run's `warnings` is empty, so drawing an empty table for it would be
 * harmless and would still be an empty table on every catalog run anybody opens.
 */
export function isFileImportRun(run: HarvestRun | null): boolean {
  return run !== null && run.mode === 'FILE_IMPORT';
}

/**
 * The run's warnings as rows.
 *
 * A `null` page or offer becomes `''` rather than the word "null", because the
 * cell is drawn when it has something in it and left out when it does not, the
 * same rule the run's own facts follow.
 *
 * The name is decided by code, never by reading the sentence (admin plan
 * 0071, D7). The two walk warnings in `CODES_WHOSE_SENTENCE_NAMES_THE_PART`
 * always state their subject in the sentence ("Section 07 Mascotas failed"),
 * and a runner may or may not also set `name`, so their name is `''` either
 * way and the row reads the same on every run. Every other warning keeps its
 * name, also when its sentence quotes it: an import's list then has the bold
 * product name on every row that has one, and can be scanned by product. A
 * blank name is `''`, so no empty `<strong>` is drawn.
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
    name: CODES_WHOSE_SENTENCE_NAMES_THE_PART.has(warning.code)
      ? ''
      : (warning.name ?? '').trim(),
    message: warning.message,
  }));
}

/**
 * The walk warnings whose sentence always names the part it is about.
 *
 * Typed against the wire union, so a code the gateway renames fails the build
 * here. The admin libraries read the codes from the wire types and have no
 * runtime enum to import.
 */
const CODES_WHOSE_SENTENCE_NAMES_THE_PART: ReadonlySet<Wire.EnumsHarvestWarningCode> =
  new Set<Wire.EnumsHarvestWarningCode>(['LISTING_UNREAD', 'LISTING_SHORT']);

/**
 * How many products this run put in front of a person.
 *
 * `notFound` is the counter the import writes a queue entry against, so it is
 * the count the queue link carries. Naming it here rather than reading
 * `notFound` at the call site is the whole of the difference: on a crawl that
 * counter means a product the storefront no longer stocks, and the two are not
 * the same number with two names.
 */
export function queuedByRun(run: HarvestRun | null): number {
  return run === null || !isFileImportRun(run) ? 0 : run.notFound;
}
