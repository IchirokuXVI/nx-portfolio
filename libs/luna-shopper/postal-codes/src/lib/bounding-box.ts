import type { BoundingBox } from './types';

/**
 * Metres in one degree of latitude, and in one degree of longitude at the
 * equator. A constant rather than a function of latitude because the error it
 * carries (the Earth is not a sphere, a degree of latitude is 110.6 km at the
 * equator and 111.7 km at the poles) is well under a percent, and the box only
 * has to be a superset of the circle: the exact distance decides afterwards.
 */
export const METRES_PER_DEGREE = 111_320;

/**
 * Below this cosine the box is widened to the whole globe rather than divided
 * by something near zero. It is reached inside half a degree of a pole, where
 * nobody this system serves buys groceries.
 */
const MIN_COSINE = 0.01;

/**
 * The rectangle around a point that contains every point within
 * `radiusMetres` of it (plan 0060, section 5).
 *
 * ```
 * latDelta = radiusMetres / 111_320
 * lonDelta = radiusMetres / (111_320 * cos(latitude))
 * ```
 *
 * A superset on purpose: the corners of the box are further than the radius,
 * so a caller filters on this with the index and then measures the survivors
 * exactly. It is never the answer on its own.
 *
 * Latitude is clamped to the poles. Longitude is not wrapped at the antimeridian
 * because no country this dataset ships straddles it; a box that crosses it
 * would come back as `minLongitude > 180`, which matches nothing rather than
 * matching the wrong side of the world.
 */
export function boundingBox(
  latitude: number,
  longitude: number,
  radiusMetres: number
): BoundingBox {
  if (!Number.isFinite(radiusMetres) || radiusMetres < 0) {
    throw new RangeError(
      `radiusMetres must be a non negative number, got ${radiusMetres}`
    );
  }
  const latDelta = radiusMetres / METRES_PER_DEGREE;
  const cosine = Math.max(Math.cos((latitude * Math.PI) / 180), MIN_COSINE);
  const lonDelta = radiusMetres / (METRES_PER_DEGREE * cosine);
  return {
    minLatitude: Math.max(-90, latitude - latDelta),
    maxLatitude: Math.min(90, latitude + latDelta),
    minLongitude: longitude - lonDelta,
    maxLongitude: longitude + lonDelta,
  };
}

/** Whether a point sits inside the box, edges included. */
export function containsPoint(
  box: BoundingBox,
  latitude: number,
  longitude: number
): boolean {
  return (
    latitude >= box.minLatitude &&
    latitude <= box.maxLatitude &&
    longitude >= box.minLongitude &&
    longitude <= box.maxLongitude
  );
}
