import type { HarvestRunMode } from '../enums/harvest.enums';

/**
 * Whether a harvest run reads less than its chain's whole walk (owner decision
 * 114a), on a file of its own.
 *
 * The back office is a browser build, and the contracts barrel has broken
 * browser builds before. This file therefore makes no value import: it is
 * reachable as `@portfolio/luna-shopper/contracts/run-narrowing`, and the
 * barrel re-exports it through `harvest.messages.ts` for every other caller.
 */

/** The modes the rule names, checked against the enum at compile time only. */
const MODE = {
  CATALOG_DISCOVERY: 'CATALOG_DISCOVERY',
  STORE_DISCOVERY: 'STORE_DISCOVERY',
  FILE_IMPORT: 'FILE_IMPORT',
} as const satisfies Record<string, `${HarvestRunMode}`>;

/**
 * The fields of a run request that {@link isNarrowedRunRequest} reads, with
 * the mode as a plain string so the back office can pass its wire type.
 */
export interface NarrowableRunRequest {
  readonly mode: string;
  readonly detailBackfill?: boolean;
  readonly priceScopeIds?: readonly string[];
  readonly postalCode?: string;
  readonly postalCodes?: readonly string[];
}

/**
 * Whether a run request reads less than its chain's whole walk (owner
 * decision 114a), so that the count of an earlier run of the same chain and
 * mode says nothing about how big this run is. The back office then draws no
 * approximate total for the run.
 *
 * **This is the one authority for the rule**, and the back office calls it
 * rather than restating it. Narrowed means the run covers fewer products or
 * shops than a whole walk, which is what makes its `processed` smaller, and
 * not that it sends fewer requests. Each field below was read off the
 * harvester's spawn validation (`HarvestRunService.validate`) and the runner
 * that reads it.
 *
 * **An unknown request answers true**: null, undefined, or a mode this build
 * does not know. That is the direction that draws no estimate rather than a
 * wrong one. A run view whose `input` could not be read passes it here as it
 * is, or through {@link isNarrowedRun}.
 *
 * `CATALOG_DISCOVERY` is narrowed by:
 *
 * - `detailBackfill: true`. It is not a walk: it reads the product page of
 *   each stored row that has no EAN (`carrefour-detail.runner.ts`, whose
 *   total is those rows), never the listing.
 * - `priceScopeIds` with an id in it. The walk reads the listing of the
 *   scopes it names and nothing else (`mercadona-catalog.runner.ts` walks
 *   the union of the named warehouses, and `dia-catalog.runner.ts` plans the
 *   menu's leaves times the postal codes of the named scopes). A request
 *   cannot say the chain's whole by this list, because the list is required
 *   and holds the scopes somebody chose, so a request that names one is a
 *   selection.
 *
 * It is **not** narrowed by:
 *
 * - `details: NEW`. A known product skips its detail request and is still
 *   reported and counted from the listing: Mercadona plans every listed
 *   product and reports the known ones without a request, and El Jamón
 *   counts `walk.rows.size` whatever it skips. The total is the same.
 * - `writes`. It decides what the run writes of what it read, in the sink,
 *   and every runner reads the same listing for it.
 * - `scopeCopies`. A copy fetches nothing (plan 0118).
 * - `priceScopeId`. The one scope a Carrefour or El Jamón walk writes its
 *   prices to, and LIDL's fallback. No runner reads a smaller listing for it.
 *
 * `STORE_DISCOVERY` is narrowed by:
 *
 * - `postalCodes` with a code in it. Every runner of a chain that lists its
 *   own shops keeps only the shops in those codes (plan 0106, section 4).
 *   Empty is every shop.
 * - `postalCode` with a code in it. That is a centre, and only the
 *   OpenStreetMap runner reads it: a radius around one point, never a
 *   chain's whole shop list. The back office sends an empty one for a chain
 *   that lists its shops. A request that names one for such a chain anyway is
 *   answered narrowed, which only draws no estimate.
 *
 * It is **not** narrowed by `radiusMetres` (the spawn stores 3000 on every
 * store discovery, and only a centred run reads it), by `country`, or by
 * `brandKeys`, which the spawn stores and no runner reads.
 *
 * `FILE_IMPORT` is never narrowed by its request. What it reads is its
 * document, whole, and the document is not a request field.
 */
export function isNarrowedRunRequest(
  request: NarrowableRunRequest | null | undefined
): boolean {
  if (request === null || request === undefined) {
    return true;
  }
  switch (request.mode) {
    case MODE.CATALOG_DISCOVERY:
      return request.detailBackfill === true || namesAny(request.priceScopeIds);
    case MODE.STORE_DISCOVERY:
      return (
        namesAny(request.postalCodes) ||
        (request.postalCode ?? '').trim() !== ''
      );
    case MODE.FILE_IMPORT:
      return false;
    default:
      return true;
  }
}

/**
 * {@link isNarrowedRunRequest} for a run view, read off its `input`. A run
 * whose `input` is null or absent answers true, by that same rule.
 */
export function isNarrowedRun(run: {
  readonly input?: NarrowableRunRequest | null;
}): boolean {
  return isNarrowedRunRequest(run.input);
}

/**
 * Whether two runs walked under the same configuration (owner decision 130b),
 * read off their `configFingerprint`, so that the total of the earlier one may
 * serve as the reference of the other.
 *
 * True only when both fingerprints are strings and equal. A null, absent or
 * empty fingerprint on either side answers false: a file import, or a run
 * stored before the harvester recorded one for every walk (owner decision
 * 137b), says nothing about what it walked, and drawing no estimate is the
 * safe error. The order of the two arguments does not matter.
 *
 * This answers one of the questions an estimate asks. The request
 * ({@link isNarrowedRun}) and the adapter (`comparableWalkTotal`) are the
 * others.
 */
export function walkedUnderSameConfig(
  runFingerprint: string | null | undefined,
  referenceFingerprint: string | null | undefined
): boolean {
  return (
    typeof runFingerprint === 'string' &&
    runFingerprint !== '' &&
    runFingerprint === referenceFingerprint
  );
}

/** Whether a list holds a value that is not blank, as the spawn trims it. */
function namesAny(values: readonly string[] | undefined): boolean {
  return (values ?? []).some((value) => value.trim() !== '');
}
