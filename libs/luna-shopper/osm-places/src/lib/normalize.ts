import type { DiscoveredPlace, GeocodedPostalCode, LatLon } from './types';

/**
 * Overpass elements in, plain records out. Pure: no network and no clock.
 *
 * Two rules carry the whole design (plan 0038, section 2.7):
 *
 * - **A `way` has no position of its own**, only member nodes. Overpass is asked
 *   for `out geom` (backend plan 0176), which answers the outline and its
 *   bounds, and the centre is the middle of those bounds, which is exactly what
 *   `out center` used to answer. Dropping ways would lose every store somebody
 *   mapped as a building outline, which is the better mapped half.
 * - **The outline is read for its area and then thrown away.** Only the number
 *   reaches {@link DiscoveredPlace.footprintM2}; no geometry is kept.
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

function readPoint(value: Json): LatLon | null {
  if (!isRecord(value)) {
    return null;
  }
  const lat = readNumber(value['lat']);
  const lon = readNumber(value['lon']);
  return lat !== null && lon !== null ? { lat, lon } : null;
}

/** The points of a `geometry` array, skipping any that carry no position. */
function readPoints(value: Json): LatLon[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const points: LatLon[] = [];
  for (const entry of value) {
    const point = readPoint(entry);
    if (point) {
      points.push(point);
    }
  }
  return points;
}

/**
 * Where a place is.
 *
 * A node carries lat/lon directly. A way or a relation answered by `out geom`
 * carries `bounds`, and its centre is the middle of them, which is the value
 * `out center` answered before plan 0176, so a shop found again does not move.
 * A way with no bounds falls back to the mean of its outline's points, and a
 * `center` is still read so a response in the old shape stays readable.
 */
function readPosition(element: Record<string, Json>): LatLon | null {
  const own = readPoint(element);
  if (own) {
    return own;
  }
  const bounds = element['bounds'];
  if (isRecord(bounds)) {
    const minLat = readNumber(bounds['minlat']);
    const minLon = readNumber(bounds['minlon']);
    const maxLat = readNumber(bounds['maxlat']);
    const maxLon = readNumber(bounds['maxlon']);
    if (
      minLat !== null &&
      minLon !== null &&
      maxLat !== null &&
      maxLon !== null
    ) {
      return { lat: (minLat + maxLat) / 2, lon: (minLon + maxLon) / 2 };
    }
  }
  const centre = readPoint(element['center']);
  if (centre) {
    return centre;
  }
  const outline = openRing(readPoints(element['geometry']));
  if (outline.length > 0) {
    return {
      lat: outline.reduce((sum, p) => sum + p.lat, 0) / outline.length,
      lon: outline.reduce((sum, p) => sum + p.lon, 0) / outline.length,
    };
  }
  return null;
}

/** Mean radius of the Earth in metres (IUGG). */
const EARTH_RADIUS_M = 6_371_008.8;

function samePoint(a: LatLon, b: LatLon): boolean {
  return a.lat === b.lat && a.lon === b.lon;
}

function isClosed(ring: readonly LatLon[]): boolean {
  return ring.length >= 4 && samePoint(ring[0], ring[ring.length - 1]);
}

/** A closed ring without its repeated last point. */
function openRing(ring: readonly LatLon[]): LatLon[] {
  return ring.length > 1 && samePoint(ring[0], ring[ring.length - 1])
    ? ring.slice(0, -1)
    : [...ring];
}

/**
 * The area of one closed ring in square metres, unsigned.
 *
 * The shoelace formula over the ring projected onto a plane tangent at its own
 * mean latitude: metres east are longitude scaled by the cosine of that
 * latitude, metres north are latitude as it is. Over a building the error
 * against the spherical area is far below a square metre.
 */
function ringAreaM2(ring: readonly LatLon[]): number {
  const points = openRing(ring);
  if (points.length < 3) {
    return 0;
  }
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const lat0 = points.reduce((sum, p) => sum + p.lat, 0) / points.length;
  const lon0 = points.reduce((sum, p) => sum + p.lon, 0) / points.length;
  const east = EARTH_RADIUS_M * Math.cos(toRad(lat0));
  const xy = points.map((p) => ({
    x: toRad(p.lon - lon0) * east,
    y: toRad(p.lat - lat0) * EARTH_RADIUS_M,
  }));
  let twice = 0;
  for (let i = 0; i < xy.length; i += 1) {
    const a = xy[i];
    const b = xy[(i + 1) % xy.length];
    twice += a.x * b.y - b.x * a.y;
  }
  return Math.abs(twice) / 2;
}

/**
 * Join a multipolygon's member ways into closed rings.
 *
 * OpenStreetMap lets one ring be drawn as several ways that meet end to end,
 * in either direction, so a way is appended to the ring being built wherever
 * one of its ends meets one of the ring's. A chain that never closes is not a
 * ring, and one such chain makes the whole answer null: an outline with a gap
 * has no area to measure, and an inner ring with a gap cannot be subtracted.
 */
function assembleRings(ways: LatLon[][]): LatLon[][] | null {
  const rings: LatLon[][] = [];
  const pending = ways.filter((way) => way.length >= 2);
  while (pending.length > 0) {
    let ring = [...(pending.shift() as LatLon[])];
    let grew = true;
    while (!isClosed(ring) && grew) {
      grew = false;
      for (let i = 0; i < pending.length; i += 1) {
        const way = pending[i];
        const first = way[0];
        const last = way[way.length - 1];
        const end = ring[ring.length - 1];
        const start = ring[0];
        let joined: LatLon[] | null = null;
        if (samePoint(end, first)) {
          joined = [...ring, ...way.slice(1)];
        } else if (samePoint(end, last)) {
          joined = [...ring, ...[...way].reverse().slice(1)];
        } else if (samePoint(start, last)) {
          joined = [...way, ...ring.slice(1)];
        } else if (samePoint(start, first)) {
          joined = [...[...way].reverse(), ...ring.slice(1)];
        }
        if (joined) {
          ring = joined;
          pending.splice(i, 1);
          grew = true;
          break;
        }
      }
    }
    if (!isClosed(ring)) {
      return null;
    }
    rings.push(ring);
  }
  return rings;
}

/**
 * The area of a place's outline in whole square metres, or null (plan 0176).
 *
 * - A **node** has no outline and answers null. That includes a shop inside a
 *   larger building, which is mapped as a node within the mall: nothing guesses
 *   a size for it.
 * - A **way** answers the area of its ring when the ring closes, and null when
 *   it does not.
 * - A **relation** is measured only when it is a multipolygon: the sum of its
 *   outer rings minus the sum of its inner rings, and null when any ring does
 *   not close. A member with no role counts as outer, which is how older
 *   multipolygons were drawn. Every other relation type answers null, because
 *   its members are not rings of one outline: a `site` groups a building with
 *   its car park, and a `building` holds its `outline` beside its `part`s, so
 *   adding their members up would give a sum or a double count. A `boundary`
 *   is an administrative area and never a shop's outline, so it is not
 *   measured either.
 *
 * Zero or less is null too: a degenerate outline says nothing about a size.
 */
function readFootprint(element: Record<string, Json>): number | null {
  let area = 0;
  if (element['type'] === 'way') {
    const ring = readPoints(element['geometry']);
    if (!isClosed(ring)) {
      return null;
    }
    area = ringAreaM2(ring);
  } else if (element['type'] === 'relation') {
    if (readTags(element)['type'] !== 'multipolygon') {
      return null;
    }
    const members = Array.isArray(element['members']) ? element['members'] : [];
    const outer: LatLon[][] = [];
    const inner: LatLon[][] = [];
    for (const member of members) {
      if (!isRecord(member) || member['type'] !== 'way') {
        continue;
      }
      const points = readPoints(member['geometry']);
      (member['role'] === 'inner' ? inner : outer).push(points);
    }
    const outerRings = assembleRings(outer);
    const innerRings = assembleRings(inner);
    if (!outerRings || !innerRings || outerRings.length === 0) {
      return null;
    }
    const sum = (rings: LatLon[][]) =>
      rings.reduce((total, ring) => total + ringAreaM2(ring), 0);
    area = sum(outerRings) - sum(innerRings);
  } else {
    return null;
  }
  const rounded = Math.round(area);
  return rounded > 0 ? rounded : null;
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
    footprintM2: readFootprint(element),
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
export function normalizeGeocode(payload: Json): GeocodedPostalCode | null {
  const first = Array.isArray(payload) ? payload[0] : payload;
  if (!isRecord(first)) {
    return null;
  }
  const lat = readNumber(first['lat']);
  const lon = readNumber(first['lon']);
  if (lat === null || lon === null) {
    return null;
  }
  // `display_name` is kept rather than discarded like the bounding box, because
  // it answers a different question: the box is a wrong search area, and the
  // name is the only name this system will ever have for the code (plan 0097,
  // section 4).
  const raw = first['display_name'];
  const displayName = typeof raw === 'string' && raw.trim() ? raw.trim() : null;
  return { lat, lon, displayName };
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
