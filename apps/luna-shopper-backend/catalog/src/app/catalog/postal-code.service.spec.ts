import type { Repository } from 'typeorm';
import type { PostalCodePoint } from '../entities';
import { PostalCodeService } from './postal-code.service';

/**
 * Real Córdoba centroids from the shipped dataset, so a failure names a place.
 * 14010, 14012 and 14013 share one point in the GeoNames export (it estimates
 * them together), which is the tie case; 14014 is about 2.4 km north of them
 * and 14011 about 5.4 km west; 28001 is Madrid, 300 km away.
 */
const CORDOBA_CENTRE = { latitude: 37.8916, longitude: -4.7727 };
const FIXTURE: PostalCodePoint[] = [
  { country: 'es', postalCode: '14010', ...CORDOBA_CENTRE },
  { country: 'es', postalCode: '14012', ...CORDOBA_CENTRE },
  { country: 'es', postalCode: '14013', ...CORDOBA_CENTRE },
  { country: 'es', postalCode: '14014', latitude: 37.9133, longitude: -4.7685 },
  { country: 'es', postalCode: '14011', latitude: 37.9124, longitude: -4.828 },
  { country: 'es', postalCode: '28001', latitude: 40.4255, longitude: -3.6834 },
  // The same code in another country, to prove the country is part of the key.
  { country: 'pt', postalCode: '14013', ...CORDOBA_CENTRE },
];

/**
 * A repository answering from the array, applying the `Between` bounds the
 * service asks for. `Between` is a TypeORM value object, so the double reads
 * the two bounds back out of it: honouring the box is the whole job of this
 * fake, because the box is what the assertions about the index rely on.
 */
function build(rows: PostalCodePoint[] = FIXTURE) {
  const bounds = (value: unknown): [number, number] =>
    (value as { _value: [number, number] })._value;

  const find = jest.fn(
    async (options: {
      where: { country: string; latitude: unknown; longitude: unknown };
    }) => {
      const [minLat, maxLat] = bounds(options.where.latitude);
      const [minLon, maxLon] = bounds(options.where.longitude);
      return rows.filter(
        (r) =>
          r.country === options.where.country &&
          r.latitude >= minLat &&
          r.latitude <= maxLat &&
          r.longitude >= minLon &&
          r.longitude <= maxLon
      );
    }
  );
  const findOne = jest.fn(
    async (options: { where: { country: string; postalCode: string } }) =>
      rows.find(
        (r) =>
          r.country === options.where.country &&
          r.postalCode === options.where.postalCode
      ) ?? null
  );

  const repository = {
    find,
    findOne,
  } as unknown as Repository<PostalCodePoint>;
  return { service: new PostalCodeService(repository), find, findOne };
}

/**
 * The two reads (plan 0060, section 5), and the two cases section 9 names:
 * a point beyond `maxDistanceMetres` is null, and a radius catching nothing is
 * an empty array rather than the code that was asked about.
 */
describe('PostalCodeService', () => {
  describe('nearest', () => {
    it('answers the closest centroid and how far it is', async () => {
      const { service } = build();

      // 300 m north east of the shared Córdoba point.
      const view = await service.nearest({
        country: 'es',
        latitude: 37.8936,
        longitude: -4.77,
        maxDistanceMetres: 2_000,
      });

      expect(view.country).toBe('es');
      expect(view.nearest?.distanceMetres).toBeGreaterThan(250);
      expect(view.nearest?.distanceMetres).toBeLessThan(400);
      // Three codes share the point; the tie breaks on the code, stably.
      expect(view.nearest?.postalCode).toBe('14010');
    });

    it('is null beyond maxDistanceMetres rather than a confident wrong code', async () => {
      const { service } = build();

      // Halfway between Córdoba and Madrid: the nearest centroid is 150 km
      // away, and 5 km is the honest limit of what "in this code" can mean.
      const view = await service.nearest({
        country: 'es',
        latitude: 39.15,
        longitude: -4.23,
        maxDistanceMetres: 5_000,
      });

      expect(view).toEqual({ country: 'es', nearest: null });
    });

    it('drops a corner of the box the exact distance rejects', async () => {
      const { service, find } = build();

      // 14014 is 2.4 km from the Córdoba point, almost due north. From a spot
      // 2 km south west of 14014, the box for 2.2 km reaches it in each axis
      // separately but the diagonal is longer than the radius.
      const view = await service.nearest({
        country: 'es',
        latitude: 37.9133 - 0.0165,
        longitude: -4.7685 - 0.0205,
        maxDistanceMetres: 2_200,
      });

      // The box let it through (the fake honours the bounds), and the exact
      // distance is what said no; the Córdoba point is the closer answer.
      const boxed = await find.mock.results[0].value;
      expect(boxed.map((r: PostalCodePoint) => r.postalCode)).toContain(
        '14014'
      );
      expect(view.nearest?.postalCode).toBe('14010');
    });

    it('only looks inside the asked for country, whatever its case', async () => {
      const { service } = build();

      const view = await service.nearest({
        country: 'PT',
        latitude: 37.8916,
        longitude: -4.7727,
        maxDistanceMetres: 1_000,
      });

      expect(view).toEqual({
        country: 'pt',
        nearest: { postalCode: '14013', distanceMetres: 0 },
      });
    });
  });

  describe('nearby', () => {
    it('lists the codes whose centroid is within the radius, nearest first, never itself', async () => {
      const { service } = build();

      const view = await service.nearby({
        country: 'es',
        postalCode: '14013',
        radiusMetres: 3_000,
      });

      expect(view.known).toBe(true);
      expect(view.postalCodes.map((c) => c.postalCode)).toEqual([
        '14010',
        '14012',
        '14014',
      ]);
      expect(view.postalCodes[0].distanceMetres).toBe(0);
      expect(view.postalCodes[2].distanceMetres).toBeGreaterThan(2_000);
      expect(view.postalCodes[2].distanceMetres).toBeLessThan(3_000);
    });

    it('widens with the radius: 14011 arrives at six kilometres', async () => {
      const { service } = build();

      const view = await service.nearby({
        country: 'es',
        postalCode: '14013',
        radiusMetres: 6_000,
      });

      expect(view.postalCodes.map((c) => c.postalCode)).toEqual([
        '14010',
        '14012',
        '14014',
        '14011',
      ]);
    });

    it('is empty, not the code asked about, when nothing else is in range', async () => {
      const { service } = build();

      const view = await service.nearby({
        country: 'es',
        postalCode: '28001',
        radiusMetres: 2_000,
      });

      expect(view).toEqual({
        country: 'es',
        postalCode: '28001',
        known: true,
        postalCodes: [],
      });
    });

    it('says so when the code is not in the table, and does not scan for it', async () => {
      const { service, find } = build();

      const view = await service.nearby({
        country: 'es',
        postalCode: '99999',
        radiusMetres: 2_000,
      });

      expect(view).toEqual({
        country: 'es',
        postalCode: '99999',
        known: false,
        postalCodes: [],
      });
      expect(find).not.toHaveBeenCalled();
    });
  });
});
