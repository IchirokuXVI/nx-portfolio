import {
  PlaceMatchRung,
  type PlaceLocationCandidate,
  type SupermarketLocationView,
} from '@portfolio/luna-shopper/contracts';
import { distanceMetres } from '@portfolio/luna-shopper/osm-places';
import { normalizeName } from './matching';

/**
 * How near a shop of the same chain has to be to count as the same shop (plan
 * 0038, section 5.5).
 */
export const SAME_SHOP_METRES = 50;

/**
 * The tags a store discovery runner wrote the declared scope key under, before
 * the key had a column of its own (plan 0152, section 1). Each runner writes at
 * most one of them.
 */
const SCOPE_KEY_TAGS = ['mercadona:warehouse', 'lidl:offerRegion'] as const;

/** What a place carries that {@link declaredScopeKey} reads. */
export interface ScopeKeySubject {
  scopeKey: string | null;
  tags: Record<string, string> | null;
}

/**
 * The price scope key the run declared for a place.
 *
 * The column first. A row written before the column existed has none, so its
 * key is read from the tag the runner also wrote, which is where it lived.
 */
export function declaredScopeKey(place: ScopeKeySubject): string | null {
  if (place.scopeKey) {
    return place.scopeKey;
  }
  for (const tag of SCOPE_KEY_TAGS) {
    const value = place.tags?.[tag]?.trim();
    if (value) {
      return value;
    }
  }
  return null;
}

/** What a place carries that {@link matchLocations} compares. */
export interface PlaceMatchSubject {
  provider: string;
  externalRef: string;
  latitude: number;
  longitude: number;
  street: string | null;
  postalCode: string | null;
}

/**
 * The shops of a chain that a place may be (plan 0152, section 2).
 *
 * Three rungs, tried in order, and the first that finds anything answers:
 *
 * 1. The shop carries the place's own `externalRef`. A shop that names another
 *    provider does not count, because two providers may use the same string.
 * 2. A shop within {@link SAME_SHOP_METRES}. An OSM element changes id when
 *    somebody maps the building, and a seeded shop has no ref at all.
 * 3. A shop with no coordinates, at the same postal code and the same address
 *    after {@link normalizeName}. That is how a seeded shop looks.
 *
 * Pure, so the caller lists the chain's shops once and asks for each place.
 * Nothing here decides: a candidate is shown to a person, never linked.
 */
export function matchLocations(
  place: PlaceMatchSubject,
  locations: readonly SupermarketLocationView[]
): PlaceLocationCandidate[] {
  const byRef = locations.filter(
    (location) =>
      location.externalRef === place.externalRef &&
      (location.externalProvider === null ||
        location.externalProvider === place.provider)
  );
  if (byRef.length > 0) {
    return byRef.map((l) => candidate(l, PlaceMatchRung.EXTERNAL_REF));
  }

  const point = { lat: place.latitude, lon: place.longitude };
  const nearby = locations.filter(
    (location) =>
      location.latitude !== null &&
      location.longitude !== null &&
      distanceMetres(point, {
        lat: location.latitude,
        lon: location.longitude,
      }) <= SAME_SHOP_METRES
  );
  if (nearby.length > 0) {
    return nearby.map((l) => candidate(l, PlaceMatchRung.NEARBY));
  }

  const street = normalizeName(place.street ?? '');
  const postalCode = place.postalCode?.trim();
  if (!street || !postalCode) {
    return [];
  }
  return locations
    .filter(
      (location) =>
        (location.latitude === null || location.longitude === null) &&
        location.postalCode?.trim() === postalCode &&
        normalizeName(location.address ?? '') === street
    )
    .map((l) => candidate(l, PlaceMatchRung.ADDRESS));
}

function candidate(
  location: SupermarketLocationView,
  rung: PlaceMatchRung
): PlaceLocationCandidate {
  return {
    supermarketLocationId: location.id,
    label: location.label,
    address: location.address,
    postalCode: location.postalCode,
    rung,
  };
}
