import {
  TRIP_KIND_FALLBACK,
  TRIP_KINDS,
  TRIP_ROW_OUTCOME_FALLBACK,
  TRIP_ROW_OUTCOMES,
  type Trip,
  type TripPage,
  type TripRow,
} from '@portfolio/velista/models';
import {
  date,
  isRecord,
  mapArray,
  nullableNum,
  nullableStr,
  numOr,
  oneOf,
  str,
} from '../mapping/primitives';

/**
 * From `TripView` (backend `0122`, section 3). Rule D4: from `unknown`.
 *
 * The id and the date are required, because a trip without an id cannot open and one
 * without a date cannot be labelled or ordered. A missing count reads as zero.
 */
export function toTrip(raw: unknown): Trip | null {
  if (!isRecord(raw)) {
    return null;
  }

  const id = str(raw['id']);
  const startedAt = date(raw['startedAt']);
  if (id === null || id === '' || startedAt === null) {
    return null;
  }

  return {
    id,
    kind: oneOf(raw['kind'], TRIP_KINDS, TRIP_KIND_FALLBACK),
    name: nullableStr(raw['name']),
    live: raw['live'] === true,
    startedAt,
    lineCount: Math.max(0, numOr(raw['lineCount'], 0)),
    boughtLineCount: Math.max(0, numOr(raw['boughtLineCount'], 0)),
  };
}

/** From `TripPage`. A malformed trip is dropped, not the page. */
export function toTripPage(raw: unknown): TripPage {
  if (!isRecord(raw)) {
    return { live: [], items: [], nextCursor: null };
  }

  return {
    live: mapArray(raw['live'], toTrip),
    items: mapArray(raw['items'], toTrip),
    nextCursor: nullableStr(raw['nextCursor']),
  };
}

/**
 * From `TripRowView` (backend `0122`, section 4).
 *
 * The line id is required, because the row draws nothing of its own and is joined to a
 * line on it. The two nullable numbers stay null when absent: a session row asked for
 * nothing, which is not the same as asking for zero.
 */
export function toTripRow(raw: unknown): TripRow | null {
  if (!isRecord(raw)) {
    return null;
  }

  const lineId = str(raw['lineId']);
  if (lineId === null || lineId === '') {
    return null;
  }

  return {
    lineId,
    asked: nullableNum(raw['asked']),
    bought: Math.max(0, numOr(raw['bought'], 0)),
    left: nullableNum(raw['left']),
    outcome: oneOf(
      raw['outcome'],
      TRIP_ROW_OUTCOMES,
      TRIP_ROW_OUTCOME_FALLBACK
    ),
    settledByUserId: nullableStr(raw['settledByUserId']),
  };
}
