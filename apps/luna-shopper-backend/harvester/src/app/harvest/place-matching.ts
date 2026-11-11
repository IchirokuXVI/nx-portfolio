import {
  PlaceMatchRung,
  PostalCodeSource,
  type PlaceLocationCandidate,
  type SupermarketLocationView,
} from '@portfolio/luna-shopper/contracts';
import { distanceMetres } from '@portfolio/luna-shopper/osm-places';
import { normalizeName } from './matching';
import { hasHouseNumber, streetKey } from './street-key';

/**
 * How near a shop of the same chain has to be to count as the same shop (plan
 * 0038, section 5.5).
 */
export const SAME_SHOP_METRES = 50;

/**
 * How near a shop of the same chain has to be to be worth a look (plan 0193).
 *
 * A hint and never a verdict. Two real shops of the first catalog sit 54.9 m
 * and 61.8 m from their place, just outside {@link SAME_SHOP_METRES}, and that
 * bound stays where it is: two shops of one chain 60 m apart exist, and a
 * wider strict rung would make every import beside one of them ask for
 * `force`.
 */
export const NEAR_SHOP_METRES = 250;

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
  /** `DERIVED` makes rung 3 compare the city, not the code (plan 0265, D1). */
  postalCodeSource: PostalCodeSource | null;
  city: string | null;
}

/**
 * How far a shop is from a place, in metres. Null for a shop with no
 * position, which is how a seeded shop looks.
 */
function metresFrom(
  place: Pick<PlaceMatchSubject, 'latitude' | 'longitude'>,
  location: SupermarketLocationView
): number | null {
  if (location.latitude === null || location.longitude === null) {
    return null;
  }
  return distanceMetres(
    { lat: place.latitude, lon: place.longitude },
    { lat: location.latitude, lon: location.longitude }
  );
}

/**
 * The shops that carry the place's own `externalRef`, which is rung 1.
 *
 * A shop that names another provider does not count, because two providers
 * may use the same string. A shop that names none does: a shop written before
 * the provider was recorded carries a bare ref.
 *
 * It is the one rung that needs no chain (plan 0193). A reference of the same
 * provider is an identity, so the caller may hand it the shops of every chain.
 */
export function locationsCarryingRef(
  place: Pick<PlaceMatchSubject, 'provider' | 'externalRef'>,
  locations: readonly SupermarketLocationView[]
): SupermarketLocationView[] {
  return locations.filter(
    (location) =>
      location.externalRef === place.externalRef &&
      (location.externalProvider === null ||
        location.externalProvider === place.provider)
  );
}

/** Rung 1 alone, as candidates. For a place that resolves to no chain. */
export function matchReference(
  place: PlaceMatchSubject,
  locations: readonly SupermarketLocationView[]
): PlaceLocationCandidate[] {
  return locationsCarryingRef(place, locations).map((location) =>
    toPlaceCandidate(place, location, PlaceMatchRung.EXTERNAL_REF)
  );
}

/**
 * The shops of a chain that a place may be (plan 0152, section 2).
 *
 * The three strict rungs, and every shop that any of them finds (plan 0265,
 * D2), in rung order and the nearest first within a rung. A shop that two
 * rungs find is listed once, under the first:
 *
 * 1. The shop carries the place's own `externalRef`. A shop that names another
 *    provider does not count, because two providers may use the same string.
 * 2. A shop within {@link SAME_SHOP_METRES}. An OSM element changes id when
 *    somebody maps the building, and a seeded shop has no ref at all.
 * 3. A shop with no coordinates on the same street, which is how a seeded shop
 *    looks ({@link matchAddress}).
 *
 * Pure, so the caller lists the chain's shops once and asks for each place.
 * Nothing here decides: a candidate is shown to a person, never linked.
 */
export function matchLocations(
  place: PlaceMatchSubject,
  locations: readonly SupermarketLocationView[]
): PlaceLocationCandidate[] {
  const byRef = matchReference(place, locations).sort(nearestFirst);
  const found = new Set(byRef.map((held) => held.supermarketLocationId));

  const nearby = locations
    .filter((location) => {
      const metres = metresFrom(place, location);
      return (
        !found.has(location.id) && metres !== null && metres <= SAME_SHOP_METRES
      );
    })
    .map((l) => toPlaceCandidate(place, l, PlaceMatchRung.NEARBY))
    .sort(nearestFirst);
  for (const held of nearby) {
    found.add(held.supermarketLocationId);
  }

  const byAddress = matchAddress(place, locations)
    .filter((location) => !found.has(location.id))
    .map((l) => toPlaceCandidate(place, l, PlaceMatchRung.ADDRESS));

  return [...byRef, ...nearby, ...byAddress];
}

/**
 * Rung 3: the shops with no coordinates on the place's street.
 *
 * The street is compared as a {@link streetKey}, so `Avda. de Cádiz, 68` is
 * `Avenida de Cádiz 68`. The shop must also be in the place's area:
 *
 * - **A place whose postal code is `DERIVED`** (plan 0265, D1) is compared on
 *   its city after {@link normalizeName}, and not on the code, because the
 *   nearest centroid can name another code of the same city. A blank city on
 *   either side never matches. Nor does a street with no house number or with
 *   `s/n`, because one city holds many shops on one avenue.
 * - **Any other place** needs the same trimmed postal code, as it always did.
 */
function matchAddress(
  place: PlaceMatchSubject,
  locations: readonly SupermarketLocationView[]
): SupermarketLocationView[] {
  const street = streetKey(place.street ?? '');
  const inArea = street ? areaTest(place, street) : null;
  if (!inArea) {
    return [];
  }
  return locations.filter(
    (location) =>
      (location.latitude === null || location.longitude === null) &&
      inArea(location) &&
      streetKey(location.address ?? '') === street
  );
}

/** How rung 3 tells a shop in the place's area, or null when none can be. */
function areaTest(
  place: PlaceMatchSubject,
  street: string
): ((location: SupermarketLocationView) => boolean) | null {
  if (place.postalCodeSource === PostalCodeSource.DERIVED) {
    const city = normalizeName(place.city ?? '');
    if (!city || !hasHouseNumber(street)) {
      return null;
    }
    return (location) => normalizeName(location.city ?? '') === city;
  }
  const postalCode = place.postalCode?.trim();
  if (!postalCode) {
    return null;
  }
  return (location) => location.postalCode?.trim() === postalCode;
}

/**
 * The shops of a chain that a person should look at before deciding a place
 * (plan 0193): what {@link matchLocations} answers, then the shops of the
 * chain farther than {@link SAME_SHOP_METRES} and within
 * {@link NEAR_SHOP_METRES}. Best first: the strict rungs in their order,
 * then the near shops, the nearest first.
 *
 * **The fourth rung is a hint and nothing else.** The places list shows it,
 * and a trusted import waits on it, because a person who looks costs nothing.
 * The 409 of a hand import does not read it, and no code path links on a
 * distance.
 *
 * Pure, like the function it extends.
 */
export function suggestLocations(
  place: PlaceMatchSubject,
  locations: readonly SupermarketLocationView[]
): PlaceLocationCandidate[] {
  const strict = matchLocations(place, locations);
  const found = new Set(strict.map((held) => held.supermarketLocationId));
  const near = locations
    .filter((location) => {
      const metres = metresFrom(place, location);
      return (
        !found.has(location.id) &&
        metres !== null &&
        metres > SAME_SHOP_METRES &&
        metres <= NEAR_SHOP_METRES
      );
    })
    .map((l) => toPlaceCandidate(place, l, PlaceMatchRung.SAME_CHAIN_NEAR));
  return [...strict, ...near.sort(nearestFirst)];
}

/** Nearest first, and a shop with no position after every shop that has one. */
function nearestFirst(
  a: PlaceLocationCandidate,
  b: PlaceLocationCandidate
): number {
  return (
    (a.metres ?? Number.POSITIVE_INFINITY) -
      (b.metres ?? Number.POSITIVE_INFINITY) || 0
  );
}

/** One shop, as the candidate a person reads. */
export function toPlaceCandidate(
  place: Pick<PlaceMatchSubject, 'latitude' | 'longitude'>,
  location: SupermarketLocationView,
  rung: PlaceMatchRung
): PlaceLocationCandidate {
  const metres = metresFrom(place, location);
  return {
    supermarketLocationId: location.id,
    supermarketId: location.supermarketId,
    label: location.label,
    address: location.address,
    city: location.city,
    postalCode: location.postalCode,
    rung,
    metres: metres === null ? null : Math.round(metres),
  };
}
