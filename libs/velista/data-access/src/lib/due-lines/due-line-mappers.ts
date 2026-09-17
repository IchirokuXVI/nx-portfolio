import {
  DUE_LINE_REASONS,
  type DueLine,
  type DueLineReason,
} from '@portfolio/velista/models';
import { isRecord, mapArray, nullableNum, str } from '../mapping/primitives';

/**
 * From `LineSuggestionView` (backend `0123`, section 5). Rule D4: from `unknown`.
 *
 * ## What is required
 *
 * The line id, because a due line draws nothing of its own and is joined to a line on
 * it. The reason's own numbers, because the row's one sentence is made of them: a
 * `PERIOD` row with no period and a `STAPLE` row with no counts cannot say why they are
 * due, and a suggestion without a reason is one nobody asked for.
 *
 * ## An unknown reason
 *
 * Falls back on the numbers the row carries: a period makes it `PERIOD`, and both trip
 * counts make it `STAPLE`. A newer server that adds a third reason still sends one of
 * the two shapes this build can explain, and a row that carries neither is refused.
 *
 * `quantity` below 1 reads as 1, the server's own floor, because an add of nothing
 * is not an add.
 */
export function toDueLine(raw: unknown): DueLine | null {
  if (!isRecord(raw)) {
    return null;
  }

  const lineId = str(raw['lineId']);
  if (lineId === null || lineId === '') {
    return null;
  }

  const periodDays = positive(raw['periodDays']);
  const tripsWith = positive(raw['tripsWith']);
  const tripsSeen = positive(raw['tripsSeen']);
  const hasPeriod = periodDays !== null;
  const hasTrips =
    tripsWith !== null && tripsSeen !== null && tripsWith <= tripsSeen;

  const reason = reasonOf(raw['reason'], hasPeriod, hasTrips);
  if (reason === null) {
    return null;
  }

  return {
    lineId,
    reason,
    periodDays: reason === 'PERIOD' ? periodDays : null,
    daysSinceBought: Math.max(
      0,
      Math.round(nullableNum(raw['daysSinceBought']) ?? 0)
    ),
    tripsWith: reason === 'STAPLE' ? tripsWith : null,
    tripsSeen: reason === 'STAPLE' ? tripsSeen : null,
    quantity: Math.max(1, Math.round(nullableNum(raw['quantity']) ?? 1)),
  };
}

/** From `{ items }`. A malformed row is dropped, not the answer. */
export function toDueLines(raw: unknown): readonly DueLine[] {
  return isRecord(raw) ? mapArray(raw['items'], toDueLine) : [];
}

function reasonOf(
  value: unknown,
  hasPeriod: boolean,
  hasTrips: boolean
): DueLineReason | null {
  const known = (DUE_LINE_REASONS as readonly unknown[]).includes(value)
    ? (value as DueLineReason)
    : null;

  switch (known) {
    case 'PERIOD':
      return hasPeriod ? 'PERIOD' : null;
    case 'STAPLE':
      return hasTrips ? 'STAPLE' : null;
    default:
      return hasPeriod ? 'PERIOD' : hasTrips ? 'STAPLE' : null;
  }
}

/** A whole number of at least 1, or null. */
function positive(value: unknown): number | null {
  const number = nullableNum(value);
  return number === null || number < 1 ? null : Math.round(number);
}
