import {
  PlaceLinkField,
  PostalCodeSource,
  type SupermarketLocationView,
  type UpdateSupermarketLocationRequest,
} from '@portfolio/luna-shopper/contracts';
import type { DiscoveredPlace } from '../entities';

/**
 * The postal code a place sends catalog, with where it came from (plan 0152,
 * section 4).
 *
 * A code the source stated keeps its provenance. A code the run derived from
 * the nearest centroid is not sent at all: catalog derives it again with the
 * same rule, and records it as derived. Sending it as `SOURCE` turned a guess
 * into a statement that nothing would ever revisit.
 *
 * **This is the only door a postal code of a place leaves by**, for an import
 * and for a link alike (plan 0193).
 */
export function postalCodeFields(
  place: Pick<DiscoveredPlace, 'postalCode' | 'postalCodeSource'>
): { postalCode?: string; postalCodeSource?: PostalCodeSource } {
  if (
    !place.postalCode ||
    place.postalCodeSource === PostalCodeSource.DERIVED
  ) {
    return {};
  }
  return {
    postalCode: place.postalCode,
    postalCodeSource: place.postalCodeSource ?? PostalCodeSource.SOURCE,
  };
}

/** The fields {@link missingFields} may write. */
export type LocationPatch = Omit<
  UpdateSupermarketLocationRequest,
  'userId' | 'supermarketLocationId'
>;

/** What a place carries that {@link missingFields} reads. */
export type PlaceLinkSubject = Pick<
  DiscoveredPlace,
  | 'provider'
  | 'externalRef'
  | 'latitude'
  | 'longitude'
  | 'street'
  | 'city'
  | 'country'
  | 'postalCode'
  | 'postalCodeSource'
  | 'footprintM2'
>;

/** Null, empty or only white space: the shop says nothing in that field. */
function blank(value: string | null | undefined): boolean {
  return !value?.trim();
}

/**
 * What a place can fill on a shop that lacks it (plan 0152, section 3, and
 * plan 0193). A field that already has a value is never in the patch, because
 * the shop is what somebody checked and the place is what a source said.
 *
 * **One exception, and it is not an edit** (plan 0193, target 2). A `DERIVED`
 * postal code on the shop is a guess that catalog made from the nearest
 * centroid, never something a person typed. It counts as empty against a code
 * that the source of the place stated. A `SOURCE` or `MANUAL` code stays.
 *
 * It never writes a label (plan 0193, decision C): a place of a chain's own
 * shop list is named after the banner, and a person types the label of a shop.
 *
 * Pure. `filled` names each thing the patch holds, so a caller can answer
 * what a link wrote, or what it would write, with no second rule.
 */
export function missingFields(
  place: PlaceLinkSubject,
  location: SupermarketLocationView
): { patch: LocationPatch; filled: PlaceLinkField[] } {
  const patch: LocationPatch = {};
  const filled: PlaceLinkField[] = [];
  if (location.latitude === null || location.longitude === null) {
    patch.latitude = place.latitude;
    patch.longitude = place.longitude;
    filled.push(PlaceLinkField.COORDINATES);
  }
  if (!location.externalRef) {
    patch.externalRef = place.externalRef;
    if (!location.externalProvider) {
      patch.externalProvider = place.provider;
    }
    filled.push(PlaceLinkField.EXTERNAL_REF);
  }
  if (
    !location.postalCode ||
    location.postalCodeSource === PostalCodeSource.DERIVED
  ) {
    const stated = postalCodeFields(place);
    if (stated.postalCode) {
      Object.assign(patch, stated);
      filled.push(PlaceLinkField.POSTAL_CODE);
    }
  }
  // Plan 0176: the outline's area, for a shop that has no size yet.
  if ((location.footprintM2 ?? null) === null && place.footprintM2) {
    patch.footprintM2 = place.footprintM2;
    filled.push(PlaceLinkField.FOOTPRINT);
  }
  if (blank(location.address) && !blank(place.street)) {
    patch.address = place.street;
    filled.push(PlaceLinkField.ADDRESS);
  }
  if (blank(location.city) && !blank(place.city)) {
    patch.city = place.city;
    filled.push(PlaceLinkField.CITY);
  }
  if (blank(location.country) && !blank(place.country)) {
    patch.country = place.country;
    filled.push(PlaceLinkField.COUNTRY);
  }
  return { patch, filled };
}
