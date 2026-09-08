import type { Wire } from '@portfolio/luna-shopper-admin/models';
import { formatSince } from './format-instant';

/**
 * One postal code, as the list draws it (admin plan 0021, section 2).
 *
 * **Not the wire view**, and this is the one screen in the app where that is
 * unavoidable rather than a preference. The generic list reads a column off a
 * property, and two of this screen's columns are neither: "found" and "accepted"
 * live inside `locatedInIt`, and "waiting" comes from a different service
 * altogether. A field descriptor cannot name a path and cannot name something
 * the row does not carry.
 *
 * So the gateway flattens, and the flattening is where the two decisions that
 * matter are made once instead of in every column:
 *
 * - **Found and accepted are the "located in it" pair.** Backend plan 0097
 *   section 2 produces two of each, and a table column cannot explain which one
 *   it is showing. The list shows the number a person actually means, which is
 *   the places a user in that code would be offered; the detail page has room
 *   for both and says which is which.
 * - **Waiting is `null` when core did not answer**, never zero. A blank cell and
 *   a zero are different claims, and the screen says which it is showing in a
 *   sentence above the rows.
 */
export type PostalCodeRow = {
  /** The queue row's own id, which is what the requeue call is addressed by. */
  id: string;
  country: string;
  postalCode: string;
  /** What Nominatim calls it, kept by the first run. Null until one has run. */
  placeName: string | null;
  status: Wire.EnumsPostalCodeDiscoveryStatus;
  requestedAt: string;
  lastAttemptedAt: string | null;
  discoveredAt: string | null;
  nextAttemptAt: string | null;
  attempts: number;
  runId: string | null;
  error: string | null;
  /**
   * When a run last completed for it, in words, relative to now.
   *
   * Formatted here rather than by a `date` field, for the reason velista formats
   * dates in its selectors: the locale is known where the row is built and not
   * where a module level descriptor is declared.
   *
   * **Empty when nothing has ever looked**, rather than "never" or a dash. The
   * status column beside it already says `PARKED` or `QUEUED`, and a second way
   * of saying the same thing is a second thing to read.
   */
  lastLooked: string;
  /** `locatedInIt.total`: the places that sit in this code, whoever found them. */
  found: number;
  /** `locatedInIt.imported`: the ones an operator promoted into the catalog. */
  accepted: number;
  /** Profiles waiting on it, main and near together. Null when core did not answer. */
  waiting: number | null;
};

/**
 * One wire view and its demand, as a row.
 *
 * `usage` is `undefined` where core did not answer for this code, which is not
 * the same as a code core answered zero for.
 */
export function toPostalCodeRow(
  view: Wire.HarvestPostalCodeDiscoveryRequestView,
  usage: Wire.AdminCorePostalCodeUsageView | undefined,
  now: number,
  locale?: string
): PostalCodeRow {
  return {
    id: view.id,
    country: view.country,
    postalCode: view.postalCode,
    placeName: view.placeName,
    status: view.status,
    requestedAt: view.requestedAt,
    lastAttemptedAt: view.lastAttemptedAt,
    discoveredAt: view.discoveredAt,
    nextAttemptAt: view.nextAttemptAt,
    attempts: view.attempts,
    runId: view.runId,
    error: view.error,
    lastLooked: formatSince(view.discoveredAt, now, locale),
    found: view.locatedInIt.total,
    accepted: view.locatedInIt.imported,
    waiting:
      usage === undefined ? null : usage.mainProfiles + usage.nearbyProfiles,
  };
}
