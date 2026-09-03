import type { Wire } from '@portfolio/luna-shopper-admin/models';

type Place = Wire.HarvestDiscoveredPlaceView;

/**
 * How close two places have to be to be worth showing together.
 *
 * Fifty metres is the harvester's own threshold: a place matching the same brand
 * within fifty metres is treated as already known and is never offered, so
 * anything that reached this queue is either further away than that or has a
 * different brand key. Showing a wider radius here than the matcher used is
 * deliberate, because the interesting case is the one that just missed.
 */
const NEAR_METRES = 250;

/** One metre of latitude, near enough, anywhere. */
const METRES_PER_DEGREE = 111_320;

/**
 * The lines the queue draws for one place.
 *
 * A fixed order, so the same fact is in the same position on every item.
 * Somebody working through a queue reads by position after the first few, and a
 * layout that reflows when a field is missing costs them that.
 */
export function placeLines(
  place: Place
): readonly { key: string; value: string }[] {
  return [
    { key: 'brand', value: place.brandName ?? '' },
    { key: 'brandKey', value: place.brandKey ?? '' },
    { key: 'street', value: place.street ?? '' },
    { key: 'city', value: place.city ?? '' },
    { key: 'postalCode', value: place.postalCode ?? '' },
    { key: 'country', value: place.country ?? '' },
    { key: 'openingHours', value: place.openingHours ?? '' },
    { key: 'website', value: place.website ?? '' },
    { key: 'provider', value: place.provider },
    { key: 'externalRef', value: place.externalRef },
    { key: 'coordinates', value: coordinates(place) },
  ];
}

/**
 * The places in the queue that this one might be the same shop as.
 *
 * Same brand key, and close. Both halves matter: distance alone would pair a
 * bakery with the supermarket next door, and brand alone would pair two branches
 * of the same chain in different cities, which is not a duplicate and is exactly
 * what the catalog is supposed to hold two of.
 *
 * A place with no brand key is compared to other places with no brand key. That
 * is the honest reading: an absent `brand:wikidata` is not a value two places
 * share, but it is the state that makes a duplicate hardest to spot
 * automatically, so those are the ones most worth putting side by side.
 */
export function nearby(
  place: Place,
  others: readonly Place[]
): readonly Place[] {
  return others.filter(
    (other) =>
      other.brandKey === place.brandKey &&
      metresBetween(place, other) <= NEAR_METRES
  );
}

/**
 * Distance in metres, on a flat approximation.
 *
 * Good to a fraction of a percent over a few hundred metres, which is the only
 * range this is asked about, and it needs no trigonometry beyond one cosine. The
 * longitude degree shrinks with latitude, and ignoring that would make two
 * places in Madrid look a third further apart than they are.
 */
export function metresBetween(a: Place, b: Place): number {
  const latitudeMetres = (a.latitude - b.latitude) * METRES_PER_DEGREE;
  const longitudeMetres =
    (a.longitude - b.longitude) *
    METRES_PER_DEGREE *
    Math.cos((a.latitude * Math.PI) / 180);

  return Math.hypot(latitudeMetres, longitudeMetres);
}

function coordinates(place: Place): string {
  return `${place.latitude.toFixed(5)}, ${place.longitude.toFixed(5)}`;
}
