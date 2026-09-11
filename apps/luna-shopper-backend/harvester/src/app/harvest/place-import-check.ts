import { PostalCodeSource } from '@portfolio/luna-shopper/contracts';

/**
 * What the check reads. A subset of `DiscoveredPlace`, so the row itself and a
 * place a runner has only just reported both fit without a conversion.
 */
export interface PlaceImportSubject {
  externalRef: string;
  name: string | null;
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
 */
export type PlaceImportBlocker =
  | 'externalRef'
  | 'name'
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
  if (!place.name?.trim()) {
    // The location's label, and there is no sensible default: a name built out
    // of the town would be one the chain never published.
    blockers.push('name');
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
