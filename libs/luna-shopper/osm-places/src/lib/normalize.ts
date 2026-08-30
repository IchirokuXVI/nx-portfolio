import type { DiscoveredPlace, LatLon } from './types';

/**
 * Overpass elements in, plain records out. Pure: no network and no clock.
 *
 * Two rules carry the whole design (plan 0038, section 2.7):
 *
 * - **A `way` has no position of its own**, only member nodes, so Overpass is
 *   asked for `out center` and the centre is read from there. Dropping ways would
 *   lose every store somebody mapped as a building outline, which is the better
 *   mapped half.
 * - **The tag bag is kept exactly as fetched.** Catalog holds the fields it has a
 *   use for; the provider's raw payload is harvest working data, and reshaping it
 *   here is how provenance is lost.
 */

type Json = unknown;

function isRecord(value: Json): value is Record<string, Json> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Tag values are strings in OSM. Anything else is dropped rather than coerced. */
function readTags(element: Json): Record<string, string> {
  if (!isRecord(element) || !isRecord(element['tags'])) {
    return {};
  }
  const tags: Record<string, string> = {};
  for (const [key, value] of Object.entries(element['tags'])) {
    if (typeof value === 'string') {
      tags[key] = value;
    }
  }
  return tags;
}

function readNumber(value: Json): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** A node carries lat/lon directly; a way or relation carries `center`. */
function readPosition(element: Json): LatLon | null {
  if (!isRecord(element)) {
    return null;
  }
  const lat = readNumber(element['lat']);
  const lon = readNumber(element['lon']);
  if (lat !== null && lon !== null) {
    return { lat, lon };
  }
  const centre = element['center'];
  if (isRecord(centre)) {
    const centreLat = readNumber(centre['lat']);
    const centreLon = readNumber(centre['lon']);
    if (centreLat !== null && centreLon !== null) {
      return { lat: centreLat, lon: centreLon };
    }
  }
  return null;
}

function nonEmpty(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
}

/** `addr:street` plus `addr:housenumber`, in the order Spanish addresses use. */
function readStreet(tags: Record<string, string>): string | null {
  const street = nonEmpty(tags['addr:street']);
  const number = nonEmpty(tags['addr:housenumber']);
  if (street && number) {
    return `${street} ${number}`;
  }
  return street ?? number;
}

/**
 * One Overpass response, normalized. Elements with no resolvable position are
 * dropped: a place the owner cannot be shown on a map is not importable, and
 * position was 100% covered across the 353 element sample.
 */
export function normalizeOverpassResponse(payload: Json): DiscoveredPlace[] {
  if (!isRecord(payload) || !Array.isArray(payload['elements'])) {
    return [];
  }
  const places: DiscoveredPlace[] = [];
  for (const element of payload['elements']) {
    const place = normalizeElement(element);
    if (place) {
      places.push(place);
    }
  }
  return places;
}

export function normalizeElement(element: Json): DiscoveredPlace | null {
  if (!isRecord(element)) {
    return null;
  }
  const position = readPosition(element);
  const type = typeof element['type'] === 'string' ? element['type'] : null;
  const id = readNumber(element['id']);
  if (!position || !type || id === null) {
    return null;
  }
  const tags = readTags(element);
  return {
    provider: 'OSM',
    externalRef: `${type}/${id}`,
    brandKey: nonEmpty(tags['brand:wikidata']),
    brandName: nonEmpty(tags['brand']),
    name: nonEmpty(tags['name']),
    latitude: position.lat,
    longitude: position.lon,
    street: readStreet(tags),
    city: nonEmpty(tags['addr:city']),
    postalCode: nonEmpty(tags['addr:postcode']),
    website: nonEmpty(tags['website']),
    openingHours: nonEmpty(tags['opening_hours']),
    tags,
  };
}

/**
 * Nominatim's answer for a postal code, reduced to a **centre point**.
 *
 * The bounding box it also returns is discarded on purpose (section 2.8): for
 * 14013 that box spans most of Córdoba, and querying it returns 12 Mercadonas
 * none of which is actually in 14013. "The stores I can shop at" is a radius
 * around a point, and the postcode's job is to pick the price scope instead.
 */
export function normalizeGeocode(payload: Json): LatLon | null {
  const first = Array.isArray(payload) ? payload[0] : payload;
  if (!isRecord(first)) {
    return null;
  }
  const lat = readNumber(first['lat']);
  const lon = readNumber(first['lon']);
  return lat !== null && lon !== null ? { lat, lon } : null;
}

/**
 * Group discovered places by chain (plan 0038, section 6.1 step 4).
 *
 * Grouping is on `brandKey` and never on the name, for the reason in the type
 * doc. Places with no brand tag at all group under `null`: 35 of the 75 elements
 * in the wider search were independent shops, and they are precisely backlog
 * 0001's "no implementation is a real state".
 */
export function groupByBrand(
  places: DiscoveredPlace[]
): Map<string | null, DiscoveredPlace[]> {
  const groups = new Map<string | null, DiscoveredPlace[]>();
  for (const place of places) {
    const key = place.brandKey;
    const existing = groups.get(key);
    if (existing) {
      existing.push(place);
    } else {
      groups.set(key, [place]);
    }
  }
  return groups;
}

/**
 * Great circle distance in metres. Used for the "same brand within 50 metres"
 * fallback when re-discovery finds no `externalRef` match, which happens when
 * somebody upgrades a shop from a node to a mapped building way and its id and
 * type both change (section 5.5).
 */
export function distanceMetres(a: LatLon, b: LatLon): number {
  const EARTH_RADIUS_M = 6_371_000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}
