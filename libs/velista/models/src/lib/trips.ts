/**
 * The shopping trips of a zone list (velista `0088`, backend `0122`).
 *
 * A trip is a basket that drew from the list, or a run of purchases settled by hand
 * with no basket behind them, which the page calls "Loose buys". The page reads the
 * heads a page at a time and the rows of one trip only when somebody opens it.
 */

/**
 * `BASKET` or `LOOSE`, upper case on the wire.
 *
 * Unknown falls back to `LOOSE`. A loose trip is labelled without a name, so a kind this
 * build has never heard of still draws a label that claims nothing about a basket.
 */
export const TRIP_KINDS = ['BASKET', 'LOOSE'] as const;
export type TripKind = (typeof TRIP_KINDS)[number];
export const TRIP_KIND_FALLBACK: TripKind = 'LOOSE';

/**
 * What one trip did to one line (backend `0122`, section 4).
 *
 * Unknown falls back to `NOT_BOUGHT`, the quiet one: it says the line was on the trip
 * and claims no purchase the server did not name.
 */
export const TRIP_ROW_OUTCOMES = [
  'BOUGHT',
  'PARTLY',
  'NOT_AVAILABLE',
  'NOT_BOUGHT',
] as const;
export type TripRowOutcome = (typeof TRIP_ROW_OUTCOMES)[number];
export const TRIP_ROW_OUTCOME_FALLBACK: TripRowOutcome = 'NOT_BOUGHT';

/** One trip's head: its label, its date and its counts. */
export interface Trip {
  /** The basket's id, or the id of a loose session's earliest settlement. */
  readonly id: string;
  readonly kind: TripKind;
  /** A basket's name. Null for a loose trip and for a basket shown as its date. */
  readonly name: string | null;
  readonly live: boolean;
  readonly startedAt: Date;
  /** The lines of this list the trip touched. */
  readonly lineCount: number;
  /** Of those, the ones it left nothing of. */
  readonly boughtLineCount: number;
}

/** The first page carries the live trips. A page read with a cursor has none. */
export interface TripPage {
  readonly live: readonly Trip[];
  readonly items: readonly Trip[];
  readonly nextCursor: string | null;
}

/**
 * What one trip did to one line. No name and no current quantity: the page joins the
 * line it holds on `lineId`, so the numbers here never follow the line.
 */
export interface TripRow {
  readonly lineId: string;
  /** What the basket asked for. Null on a loose row. */
  readonly asked: number | null;
  readonly bought: number;
  /** What the basket left. Null on a loose row. */
  readonly left: number | null;
  readonly outcome: TripRowOutcome;
  /** A loose row's latest buyer, or null. Always null on a basket row. */
  readonly settledByUserId: string | null;
}

/**
 * A trip's identity on the page.
 *
 * The kind is part of it, because a basket id and a settlement id are drawn from two
 * tables and nothing promises they never meet.
 */
export function tripKey(trip: Pick<Trip, 'kind' | 'id'>): string {
  return `${trip.kind}:${trip.id}`;
}

/**
 * The one indicator a trip row draws (velista `0088`, section 5).
 *
 * `claimed` replaces `notBought` on a live trip's row whose line a basket still holds.
 */
export type TripRowMark =
  | 'bought'
  | 'partly'
  | 'notAvailable'
  | 'notBought'
  | 'claimed';

/** One read only row of a trip, as `lib-trip-row` draws it. */
export interface TripRowVm {
  readonly lineId: string;
  /** The line's name, from the line the page holds. */
  readonly content: string;
  /** What the trip left. Null on a loose row, which draws zero. */
  readonly left: number | null;
  readonly bought: number;
  /** What the basket asked for. Null on a loose row. */
  readonly asked: number | null;
  readonly mark: TripRowMark;
  /** Who holds the line, for `claimed`. Null draws the nameless form. */
  readonly claimedBy: string | null;
  /** A loose row's buyer, or null to leave the name off. */
  readonly buyer: string | null;
  /** On a live trip, the line's quantity when it differs from `left`. */
  readonly nowAsks: number | null;
  /** A past trip's row, drawn quieter than a live one. */
  readonly quiet: boolean;
}

/** One trip's fold, as `lib-trip-group` draws it. */
export interface TripGroupVm {
  readonly key: string;
  readonly kind: TripKind;
  readonly live: boolean;
  /** A basket's name, or null to label the trip with its date alone. */
  readonly name: string | null;
  /** The trip's date, already formatted in the reader's locale. */
  readonly date: string;
  /** "3 of 5 bought" for a basket, "2 lines" for a loose trip. */
  readonly countKey: 'list.trips.bought' | 'list.trips.lines';
  readonly countArgs: Readonly<Record<string, number>>;
  /** The live trip's owner, or null for the nameless form. */
  readonly liveBy: string | null;
  readonly open: boolean;
  /** Null until the rows arrive. */
  readonly rows: readonly TripRowVm[] | null;
  /** How many skeleton rows hold the fold's height until then. */
  readonly skeletonCount: number;
}

/** The `:kind` segment of the rows route, which is lower case. */
export function tripPathKind(kind: TripKind): 'basket' | 'loose' {
  return kind === 'BASKET' ? 'basket' : 'loose';
}
