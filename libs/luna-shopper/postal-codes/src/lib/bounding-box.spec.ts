import { distanceMetres } from '@portfolio/luna-shopper/osm-places';
import { SPAIN_POSTAL_CODE_CENTROIDS } from '../dataset';
import { boundingBox, containsPoint, METRES_PER_DEGREE } from './bounding-box';

/** A committed centroid by code, so a failure names the code rather than a row. */
function centroid(postalCode: string) {
  const found = SPAIN_POSTAL_CODE_CENTROIDS.find(
    (c) => c.postalCode === postalCode
  );
  if (!found) {
    throw new Error(`${postalCode} is not in the dataset`);
  }
  return found;
}

/**
 * The box (plan 0060, section 5). It has one job, to be a superset of the
 * circle the exact distance then measures, and every case here is about that:
 * a point inside the radius is inside the box, and a point well outside is not.
 */
describe('boundingBox', () => {
  it('spans the radius in both directions, wider in longitude away from the equator', () => {
    const box = boundingBox(40, -3, METRES_PER_DEGREE);

    expect(box.minLatitude).toBeCloseTo(39, 6);
    expect(box.maxLatitude).toBeCloseTo(41, 6);
    // One degree of longitude is shorter at 40° north, so a degree's worth of
    // metres is more than a degree of longitude.
    const lonDelta = 1 / Math.cos((40 * Math.PI) / 180);
    expect(box.minLongitude).toBeCloseTo(-3 - lonDelta, 6);
    expect(box.maxLongitude).toBeCloseTo(-3 + lonDelta, 6);
  });

  it('is a point for a zero radius and refuses a negative or non finite one', () => {
    const box = boundingBox(40, -3, 0);
    expect(box).toEqual({
      minLatitude: 40,
      maxLatitude: 40,
      minLongitude: -3,
      maxLongitude: -3,
    });
    expect(() => boundingBox(40, -3, -1)).toThrow(RangeError);
    expect(() => boundingBox(40, -3, Number.NaN)).toThrow(RangeError);
  });

  it('clamps latitude at the poles rather than leaving the globe', () => {
    const box = boundingBox(89.9, 0, 50_000);
    expect(box.maxLatitude).toBe(90);
    expect(Number.isFinite(box.minLongitude)).toBe(true);
  });

  it('contains every point within the radius: two Córdoba codes, hand checked', () => {
    // 14013 and 14014 are two adjacent codes in Córdoba whose centroids sit
    // about 2.4 km apart (plan 0060, section 9). The box for a radius just past
    // that distance contains the neighbour; for a radius well short of it, it
    // does not. Agreement in that direction is the property the query relies
    // on: the box may keep a point the distance then drops, never the reverse.
    const origin = centroid('14013');
    const neighbour = centroid('14014');
    const apart = distanceMetres(
      { lat: origin.latitude, lon: origin.longitude },
      { lat: neighbour.latitude, lon: neighbour.longitude }
    );
    expect(apart).toBeGreaterThan(2_000);
    expect(apart).toBeLessThan(3_000);

    const generous = boundingBox(origin.latitude, origin.longitude, apart + 1);
    expect(
      containsPoint(generous, neighbour.latitude, neighbour.longitude)
    ).toBe(true);

    const tight = boundingBox(origin.latitude, origin.longitude, 1_000);
    expect(containsPoint(tight, neighbour.latitude, neighbour.longitude)).toBe(
      false
    );
  });

  it('never drops a point the exact distance would keep, across the whole dataset around one code', () => {
    // The superset property, checked exhaustively rather than on one pair: for
    // every code within 10 km of Madrid's 28001 by the exact distance, the box
    // for 10 km contains it.
    const origin = centroid('28001');
    const radius = 10_000;
    const box = boundingBox(origin.latitude, origin.longitude, radius);
    const within = SPAIN_POSTAL_CODE_CENTROIDS.filter(
      (c) =>
        distanceMetres(
          { lat: origin.latitude, lon: origin.longitude },
          { lat: c.latitude, lon: c.longitude }
        ) <= radius
    );
    expect(within.length).toBeGreaterThan(50);
    for (const c of within) {
      expect(containsPoint(box, c.latitude, c.longitude)).toBe(true);
    }
  });
});
