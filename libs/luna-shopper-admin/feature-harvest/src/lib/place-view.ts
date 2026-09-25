import type { GatewayError } from '@portfolio/luna-shopper-admin/data-access';
import {
  localizedTextValue,
  type Wire,
} from '@portfolio/luna-shopper-admin/models';

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
export function metresBetween(
  a: Pick<Place, 'latitude' | 'longitude'>,
  b: Pick<Place, 'latitude' | 'longitude'>
): number {
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

/**
 * Which rule found a catalog shop a place may be (backend plan 0152, section
 * 2), in the order the harvester tries them.
 *
 * `UNKNOWN` is this app's own member, for a rung a later backend adds: the
 * candidate is still drawn and still linkable, and only the sentence saying why
 * it was offered is the generic one.
 */
export type PlaceMatchRung = 'EXTERNAL_REF' | 'NEARBY' | 'ADDRESS' | 'UNKNOWN';

const RUNGS: readonly PlaceMatchRung[] = ['EXTERNAL_REF', 'NEARBY', 'ADDRESS'];

/**
 * One shop the catalog already holds that a place may be.
 *
 * This app's own shape. The candidates arrive in the details of a 409, an
 * error body that the document describes as an open object, so there is no
 * generated type to borrow and rule D4 applies with most force.
 */
export interface PlaceCandidate {
  readonly supermarketLocationId: string;
  /** The shop's label, or its address, or its id: never blank. */
  readonly title: string;
  readonly address: string;
  readonly postalCode: string;
  readonly rung: PlaceMatchRung;
}

/**
 * The candidates a `place_matches_location` refusal named, read from its
 * `details`.
 *
 * Takes `unknown` and drops anything without a shop id, because a candidate
 * that cannot be linked is not an answer the panel can offer. Never throws.
 */
export function placeCandidates(
  details: Readonly<Record<string, unknown>>,
  locales: readonly string[]
): readonly PlaceCandidate[] {
  const listed = details['candidates'];
  if (!Array.isArray(listed)) {
    return [];
  }

  const candidates: PlaceCandidate[] = [];
  for (const entry of listed as unknown[]) {
    if (typeof entry !== 'object' || entry === null) {
      continue;
    }
    const row = entry as Record<string, unknown>;
    const id = row['supermarketLocationId'];
    if (typeof id !== 'string' || id === '') {
      continue;
    }
    const address = textOf(row['address']);
    const rung = row['rung'];
    candidates.push({
      supermarketLocationId: id,
      title: localizedTextValue(row['label'], locales) || address || id,
      address,
      postalCode: textOf(row['postalCode']),
      rung: RUNGS.find((known) => known === rung) ?? 'UNKNOWN',
    });
  }
  return candidates;
}

/** A catalog shop near the place, for the duplicates panel. */
export interface NearbyShop {
  readonly id: string;
  readonly title: string;
  readonly address: string;
  readonly postalCode: string;
  /** Rounded metres, or null for a shop the catalog holds no position for. */
  readonly metres: number | null;
}

/**
 * The catalog shops of the place's chain that might be the same shop
 * (admin plan 0034, section 1).
 *
 * Within {@link NEAR_METRES} when the shop has a position, and at the same
 * postal code when it has none. The second half is the case that matters:
 * seeded shops carry no coordinates, and those are the duplicates backend plan
 * 0150 found. Nearest first, the unplaced ones last.
 */
export function nearbyShops(
  place: Place,
  rows: readonly unknown[],
  locales: readonly string[]
): readonly NearbyShop[] {
  const shops: NearbyShop[] = [];
  for (const entry of rows) {
    if (typeof entry !== 'object' || entry === null) {
      continue;
    }
    const row = entry as Record<string, unknown>;
    const id = row['id'];
    if (typeof id !== 'string' || id === '') {
      continue;
    }
    const latitude = row['latitude'];
    const longitude = row['longitude'];
    const placed =
      typeof latitude === 'number' &&
      Number.isFinite(latitude) &&
      typeof longitude === 'number' &&
      Number.isFinite(longitude);
    const postalCode = textOf(row['postalCode']);

    let metres: number | null = null;
    if (placed) {
      metres = Math.round(metresBetween(place, { latitude, longitude }));
      if (metres > NEAR_METRES) {
        continue;
      }
    } else if (postalCode === '' || postalCode !== (place.postalCode ?? '')) {
      continue;
    }

    const address = textOf(row['address']);
    shops.push({
      id,
      title: localizedTextValue(row['label'], locales) || address || id,
      address,
      postalCode,
      metres,
    });
  }

  return shops.sort(
    (a, b) =>
      (a.metres ?? Number.POSITIVE_INFINITY) -
      (b.metres ?? Number.POSITIVE_INFINITY)
  );
}

/**
 * Whether the place came from OpenStreetMap, which names things in no stated
 * language and so cannot name a chain by itself (backend plan 0153).
 *
 * Compared without case: the harvester writes `OSM`, and older rows and the
 * memory seed write `osm`.
 */
export function fromOpenStreetMap(place: Place): boolean {
  return place.provider.toLowerCase() === 'osm';
}

/**
 * The sentence for a refusal of a place decision, where the places queue has
 * one of its own, and `null` where the generic sentence is the right one.
 *
 * The three codes backend plan 0152 added. `place_matches_location` is here
 * for the bulk report: the single decision draws the candidates instead.
 */
export function placeRefusalKey(error: GatewayError | null): string | null {
  switch (error?.code) {
    case 'place_matches_location':
      return 'harvest.places.error.matchesLocation';
    case 'place_already_imported':
      return 'harvest.places.error.alreadyImported';
    case 'scope_not_found':
      return 'harvest.places.error.scopeNotFound';
    default:
      return null;
  }
}

function textOf(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
