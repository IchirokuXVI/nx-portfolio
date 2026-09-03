import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PostalCodeSource } from '@portfolio/luna-shopper/contracts';
import type { Repository } from 'typeorm';
import type {
  PostalCodePoint,
  Supermarket,
  SupermarketLocation,
} from '../entities';
import { PlatformAdminService } from './platform-admin.service';
import { PostalCodeService } from './postal-code.service';
import { PriceScopeService } from './price-scope.service';
import { SupermarketLocationService } from './supermarket-location.service';

const OWNER = 'owner-1';
const CHAIN = 'chain-mercadona';
const SCOPE = 'scope-1';

/** The bound, so a test can sit a store just inside or just outside it. */
const MAX_METRES = 5_000;

/**
 * Real Córdoba centroids from the shipped dataset, so a failure names a place.
 * 14010, 14012 and 14013 share one point in the GeoNames export, which is the
 * tie case; 14014 is about 2.4 km north. 28001 is Madrid, 300 km away, and is
 * what a store with no centroid anywhere near it falls back to not having.
 */
const CORDOBA = { latitude: 37.8916, longitude: -4.7727 };
const CENTROIDS: PostalCodePoint[] = [
  { country: 'es', postalCode: '14010', ...CORDOBA },
  { country: 'es', postalCode: '14012', ...CORDOBA },
  { country: 'es', postalCode: '14013', ...CORDOBA },
  { country: 'es', postalCode: '14014', latitude: 37.9133, longitude: -4.7685 },
  { country: 'es', postalCode: '28001', latitude: 40.4255, longitude: -3.6834 },
];

/**
 * The service over doubles: a location repository that just hands back what it
 * was given, a real {@link PostalCodeService} over the fixture above, and a
 * points repository honouring the bounding box the service asks for. The real
 * lookup is used rather than a stub because what these tests are about is the
 * decision to call it, and on which rows.
 */
function build(points: PostalCodePoint[] = CENTROIDS) {
  const bounds = (value: unknown): [number, number] =>
    (value as { _value: [number, number] })._value;

  const pointsRepository = {
    find: jest.fn(
      async (options: {
        where: { country: string; latitude: unknown; longitude: unknown };
      }) => {
        const [minLat, maxLat] = bounds(options.where.latitude);
        const [minLon, maxLon] = bounds(options.where.longitude);
        return points.filter(
          (p) =>
            p.country === options.where.country &&
            p.latitude >= minLat &&
            p.latitude <= maxLat &&
            p.longitude >= minLon &&
            p.longitude <= maxLon
        );
      }
    ),
    findOne: jest.fn(async () => null),
  } as unknown as Repository<PostalCodePoint>;

  const stored: SupermarketLocation[] = [];
  const locations = {
    create: jest.fn((row: Partial<SupermarketLocation>) => ({ ...row })),
    save: jest.fn(async (row: SupermarketLocation) => {
      stored.push(row);
      return row;
    }),
    findOne: jest.fn(
      async (options: { where: { id: string } }) =>
        stored.find((row) => row.id === options.where.id) ?? null
    ),
  } as unknown as Repository<SupermarketLocation>;

  const supermarkets = {
    findOne: jest.fn(async () => ({ id: CHAIN })),
  } as unknown as Repository<Supermarket>;

  const scopes = {
    ensureStoreScope: jest.fn(async () => ({ id: SCOPE })),
    requireScopeOf: jest.fn(async () => ({ id: SCOPE })),
  } as unknown as PriceScopeService;

  const config = {
    getOrThrow: () => ({
      // The owner writes as a configured SERVICE here (plan 0072). This file is
      // about location and postal code behaviour rather than about which door
      // the caller came through, and the service path needs no keypair.
      adminJwtPublicKey: '',
      serviceActorIds: [OWNER],
      postalCodeDeriveMaxMetres: MAX_METRES,
    }),
  } as unknown as ConfigService;

  const service = new SupermarketLocationService(
    locations,
    supermarkets,
    scopes,
    new PlatformAdminService(new JwtService(), config),
    new PostalCodeService(pointsRepository),
    config
  );
  return { service, locations, stored };
}

/** Everything a create needs beyond the field under test. */
const CREATE = { userId: OWNER, supermarketId: CHAIN };

/**
 * Filling a missing postal code from the nearest centroid (plan 0061).
 *
 * Every case here is one of section 9's exit criteria, and section 4's rules in
 * the order they are easy to get wrong: a source postcode is never overridden, a
 * guess beyond the bound is not made, and the country is what keys the lookup.
 */
describe('SupermarketLocationService postal codes', () => {
  describe('create', () => {
    it('takes the nearest centroid when the source gave no postcode', async () => {
      const { service } = build();

      // 300 m north east of the shared Córdoba point.
      const view = await service.create({
        ...CREATE,
        country: 'es',
        latitude: 37.8936,
        longitude: -4.77,
      });

      expect(view.postalCode).toBe('14010');
      expect(view.postalCodeSource).toBe(PostalCodeSource.DERIVED);
    });

    it('keeps the source postcode even when a different centroid is nearer', async () => {
      const { service } = build();

      // Sitting on 14010's centroid and claiming 14014, which is 2.4 km away.
      // The tag is somebody's observation of a sign on a building and the
      // centroid is an approximation of a boundary, so the tag wins.
      const view = await service.create({
        ...CREATE,
        country: 'es',
        postalCode: '14014',
        postalCodeSource: PostalCodeSource.SOURCE,
        ...CORDOBA,
      });

      expect(view.postalCode).toBe('14014');
      expect(view.postalCodeSource).toBe(PostalCodeSource.SOURCE);
    });

    it('leaves both null when the nearest centroid is beyond the bound', async () => {
      const { service } = build();

      // Roughly halfway between Córdoba and Madrid, where this fixture holds
      // nothing. The shipped dataset does cover that ground, so the point of
      // the case is the bound and not the geography: past it the answer is no
      // answer, because a wrong postcode is worse than none.
      const view = await service.create({
        ...CREATE,
        country: 'es',
        latitude: 39.0,
        longitude: -4.2,
      });

      expect(view.postalCode).toBeNull();
      expect(view.postalCodeSource).toBeNull();
    });

    it('declines when there is no country to key the lookup on', async () => {
      const { service } = build();

      const view = await service.create({
        ...CREATE,
        country: null,
        latitude: 37.8936,
        longitude: -4.77,
      });

      expect(view.postalCode).toBeNull();
      expect(view.postalCodeSource).toBeNull();
    });

    it('declines when the country is spelled as a name rather than alpha-2', async () => {
      const { service } = build();

      const view = await service.create({
        ...CREATE,
        country: 'Spain',
        latitude: 37.8936,
        longitude: -4.77,
      });

      expect(view.postalCode).toBeNull();
      expect(view.postalCodeSource).toBeNull();
    });

    it('declines when the location has no coordinates', async () => {
      const { service } = build();

      const view = await service.create({ ...CREATE, country: 'es' });

      expect(view.postalCode).toBeNull();
      expect(view.postalCodeSource).toBeNull();
    });

    it('calls a postcode with no stated provenance a person typing one', async () => {
      const { service } = build();

      const view = await service.create({
        ...CREATE,
        country: 'es',
        postalCode: '14001',
      });

      expect(view.postalCodeSource).toBe(PostalCodeSource.MANUAL);
    });

    it('accepts a country whose case does not match the table', async () => {
      const { service } = build();

      const view = await service.create({
        ...CREATE,
        country: 'ES',
        latitude: 37.8936,
        longitude: -4.77,
      });

      expect(view.postalCode).toBe('14010');
    });
  });

  describe('update', () => {
    /** A store already carrying a derived code, ready to be updated. */
    async function withDerivedLocation() {
      const built = build();
      const created = await built.service.create({
        ...CREATE,
        country: 'es',
        latitude: 37.8936,
        longitude: -4.77,
      });
      return { ...built, id: created.id };
    }

    it('treats a postcode set by hand as a statement and stops deriving', async () => {
      const { service, id } = await withDerivedLocation();

      const view = await service.update({
        userId: OWNER,
        supermarketLocationId: id,
        postalCode: '14014',
      });

      expect(view.postalCode).toBe('14014');
      expect(view.postalCodeSource).toBe(PostalCodeSource.MANUAL);
    });

    it('derives again when an update clears the postcode', async () => {
      const { service, id } = await withDerivedLocation();
      await service.update({
        userId: OWNER,
        supermarketLocationId: id,
        postalCode: '14014',
      });

      const view = await service.update({
        userId: OWNER,
        supermarketLocationId: id,
        postalCode: null,
      });

      expect(view.postalCode).toBe('14010');
      expect(view.postalCodeSource).toBe(PostalCodeSource.DERIVED);
    });

    it('leaves a postcode alone when the update is about something else', async () => {
      const { service, id } = await withDerivedLocation();
      await service.update({
        userId: OWNER,
        supermarketLocationId: id,
        postalCode: '14014',
      });

      const view = await service.update({
        userId: OWNER,
        supermarketLocationId: id,
        city: 'Córdoba',
      });

      expect(view.postalCode).toBe('14014');
      expect(view.postalCodeSource).toBe(PostalCodeSource.MANUAL);
    });

    it('fills a code once an update supplies the country that was missing', async () => {
      const { service } = build();
      const created = await service.create({
        ...CREATE,
        latitude: 37.8936,
        longitude: -4.77,
      });
      expect(created.postalCode).toBeNull();

      const view = await service.update({
        userId: OWNER,
        supermarketLocationId: created.id,
        country: 'es',
      });

      expect(view.postalCode).toBe('14010');
      expect(view.postalCodeSource).toBe(PostalCodeSource.DERIVED);
    });
  });

  /**
   * Section 4's last rule: deriving a postcode says where the location *is*, not
   * what it prices against. Re resolving scopes from a derived code is a larger
   * change belonging to whoever picks up chain specific scope resolution.
   */
  it('does not touch the price scope when it derives a postcode', async () => {
    const { service } = build();

    const view = await service.create({
      ...CREATE,
      country: 'es',
      latitude: 37.8936,
      longitude: -4.77,
    });

    expect(view.postalCodeSource).toBe(PostalCodeSource.DERIVED);
    expect(view.priceScopeId).toBe(SCOPE);
  });
});
