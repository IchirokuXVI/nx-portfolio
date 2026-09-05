/**
 * The three enumerations one source catalog entry carries (admin plan 0014,
 * section 4).
 *
 * **This app's own**, as rule D4 asks, rather than re-exports of the generated
 * `Wire.Enums*`. What that buys here is not decoration: a value the backend adds
 * later reaches this app as an unknown string rather than as a compile error,
 * and each mapper below decides what an unknown one reads as.
 */

/**
 * Where a row and its price came from (admin plan 0014, section 4).
 *
 * **This app's own enum**, as rule D4 asks, rather than a re-export of
 * `Wire.EnumsPriceSourceKind`. Two reasons, and only the second is the usual
 * one. The wire enum carries six values and three of them cannot appear here:
 * `ADMIN` is a price a person typed and the two `USER_` kinds are a shopper's
 * report, and none of the three is ever what observed a source catalog entry.
 * The upload screen offers exactly these three and the backend refuses the rest
 * (backend plan 0086, section 9), so the narrower type is the honest one. And a
 * value the backend adds later reaches this app as an unknown string rather than
 * as a compile error, which is what {@link toOfficialSourceKind} is for.
 */
export type OfficialSourceKind =
  | 'OFFICIAL_API'
  | 'OFFICIAL_WEB'
  | 'OFFICIAL_LEAFLET';

/**
 * The three, in the order the pickers offer them.
 *
 * API first, because a re-imported walk is the file the export produces and the
 * one an operator uploads most often once a machine that may crawl exists.
 */
export const OFFICIAL_SOURCE_KINDS: readonly OfficialSourceKind[] = [
  'OFFICIAL_API',
  'OFFICIAL_WEB',
  'OFFICIAL_LEAFLET',
];

/**
 * A source kind off the wire, or `null` when it is not one of the three.
 *
 * `null` rather than a fallback value, which is the least dangerous reading
 * here. The kind is what tells a Mercadona product from a Mercadona leaflet tile
 * of the same product, and a row whose kind this app does not recognise is drawn
 * with no badge rather than with a badge claiming the wrong one.
 */
export function toOfficialSourceKind(
  value: unknown
): OfficialSourceKind | null {
  return typeof value === 'string' &&
    (OFFICIAL_SOURCE_KINDS as readonly string[]).includes(value)
    ? (value as OfficialSourceKind)
    : null;
}

/**
 * What a row is waiting for, or what somebody decided about it (backend plan
 * 0086, section 3.1).
 *
 * `CANDIDATE` and `UNRESOLVED` are the queue, and the difference between them is
 * whether there is anything to agree with: a fuzzy rung proposed a product for
 * the first and nothing answered for the second. The other two are decisions,
 * asked for by name to find a rejection somebody wants back or a binding
 * somebody wants undone.
 */
export type SourceEntryStatus =
  | 'ACTIVE'
  | 'CANDIDATE'
  | 'UNRESOLVED'
  | 'REJECTED';

/** The four, in the order the filter offers them: the queue first. */
export const SOURCE_ENTRY_STATUSES: readonly SourceEntryStatus[] = [
  'CANDIDATE',
  'UNRESOLVED',
  'ACTIVE',
  'REJECTED',
];

/**
 * A status off the wire, defaulting to the safest reading.
 *
 * `UNRESOLVED` for anything unrecognised, because that is the status that asks a
 * person. Reading an unknown status as `ACTIVE` would hide a row nobody has
 * decided, and reading it as `REJECTED` would claim a decision nobody made.
 */
export function toSourceEntryStatus(value: unknown): SourceEntryStatus {
  return typeof value === 'string' &&
    (SOURCE_ENTRY_STATUSES as readonly string[]).includes(value)
    ? (value as SourceEntryStatus)
    : 'UNRESOLVED';
}

/**
 * How a row came to point at a product.
 *
 * `EXTERNAL_ID` is gone (backend plan 0086, section 3.1): nothing ever wrote it,
 * because an existing row is touched and touching is not a match.
 */
export type SourceEntryMatch =
  | 'EAN'
  | 'NAME_BRAND_SIZE'
  | 'NAME_SIZE'
  | 'MANUAL';

const SOURCE_ENTRY_MATCHES: readonly SourceEntryMatch[] = [
  'EAN',
  'NAME_BRAND_SIZE',
  'NAME_SIZE',
  'MANUAL',
];

/**
 * How a row was matched, or `null` when nothing answered.
 *
 * `null` is a real state rather than a fallback: an `UNRESOLVED` row has no
 * match, and the column is null on the wire for exactly that.
 */
export function toSourceEntryMatch(value: unknown): SourceEntryMatch | null {
  return typeof value === 'string' &&
    (SOURCE_ENTRY_MATCHES as readonly string[]).includes(value)
    ? (value as SourceEntryMatch)
    : null;
}
