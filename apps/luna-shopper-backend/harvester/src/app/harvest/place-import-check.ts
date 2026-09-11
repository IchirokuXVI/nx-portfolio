import { PostalCodeSource } from '@portfolio/luna-shopper/contracts';

/**
 * What the check reads. A subset of `DiscoveredPlace`, so the row itself and a
 * place a runner has only just reported both fit without a conversion.
 */
export interface PlaceImportSubject {
  externalRef: string;
  latitude: number | null;
  longitude: number | null;
  postalCode: string | null;
  postalCodeSource: PostalCodeSource | null;
  country: string | null;
  brandKey: string | null;
  brandName: string | null;
}

/**
 * A field a trusted import needs and did not get.
 *
 * The names are the subject's own fields, except `chain`, which is one answer
 * to two columns: a place resolves to a chain through its brand key or through
 * an exact brand name, and naming both would say a place needs both.
 *
 * **`name` is not one of them and used to be.** See {@link placeImportBlockers}
 * for why. A report written before that changed can still carry the string, so
 * anything reading an old `harvest_runs.report` reads it as data rather than as
 * a member of this union.
 */
export type PlaceImportBlocker =
  | 'externalRef'
  | 'latitude'
  | 'longitude'
  | 'postalCode'
  | 'country'
  | 'chain';

/**
 * What stops this place being imported without a person looking (plan 0107,
 * section 3.2).
 *
 * **Pure, and deliberately so.** It reads a reported place and nothing else, no
 * database and no catalog, which is what makes the whole table of cases a unit
 * test. Everything it checks is a completeness question the source can answer
 * on its own; whether the chain it names is a chain we hold is a catalog
 * question and belongs to the import.
 *
 * **An empty answer is the only thing that imports.** A place with one blocker
 * is not an error and is not rejected: it becomes an ordinary `NEW` row in the
 * review queue, which is the existing screen doing the existing job. The
 * trusted path is a fast lane, not a replacement for the queue (D4).
 *
 * The postal code is the one field that is not merely present or absent. It has
 * to be the **source's own**: a derived code is the nearest centroid to a pair
 * of coordinates, and putting a shop in somebody else's list with nobody
 * looking is exactly the case the queue exists for (plan 0097, section 3).
 *
 * **A name is not required, and requiring one was a mistake.** Mercadona's
 * store finder publishes none at all (plan 0106, section 1), so every one of
 * its 1,675 shops failed this check and waited in a queue for a person to press
 * import on a row nothing was wrong with. The name was never what identifies a
 * shop of a chain either: the address is, it travels on `street` and `city`,
 * and velista already draws it under the chain's name for any shop whose label
 * is null, which most shops of a chain have. A place still needs its position,
 * its own postal code, a country, a chain and an `externalRef`, and those are
 * the fields that decide whether a shop is filed in the right place.
 */
export function placeImportBlockers(
  place: PlaceImportSubject
): PlaceImportBlocker[] {
  const blockers: PlaceImportBlocker[] = [];
  if (!place.externalRef.trim()) {
    // The identity a re-run recognizes. Without it a second run writes the shop
    // again rather than seeing it is already ours.
    blockers.push('externalRef');
  }
  if (!Number.isFinite(place.latitude)) {
    blockers.push('latitude');
  }
  if (!Number.isFinite(place.longitude)) {
    blockers.push('longitude');
  }
  if (
    !place.postalCode?.trim() ||
    place.postalCodeSource !== PostalCodeSource.SOURCE
  ) {
    blockers.push('postalCode');
  }
  if (!place.country?.trim()) {
    // What keys the centroid lookup catalog does on import. A search with no
    // country would put Spain and Bolivia in one result.
    blockers.push('country');
  }
  if (!place.brandKey?.trim() && !place.brandName?.trim()) {
    // Per plan 0038 section 11: the key first, an exact brand name second. The
    // shop's **own** name is not a third rung here, however much the admin path
    // allows it: importing twelve shops that each fell back to their own name
    // writes twelve chains.
    blockers.push('chain');
  }
  return blockers;
}
