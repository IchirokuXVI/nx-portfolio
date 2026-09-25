import { NearbyShopNoPick } from '@portfolio/luna-shopper/contracts';
import { boundingBox } from '@portfolio/luna-shopper/postal-codes';
import {
  describeIntegration,
  requiredEnv,
} from '@portfolio/luna-shopper/test-fixtures/jest';
import { DataSource } from 'typeorm';
import { CATALOG_MIGRATIONS } from '../db/migrations';
import {
  CATALOG_ENTITIES,
  Supermarket,
  SupermarketLocation,
} from '../entities';
import { NEARBY_SHOP_THRESHOLDS } from './nearby-shop-pick';
import { NearbyShopsService } from './nearby-shops.service';

/**
 * The shops near a point, against real Postgres (plan 0164, section 1).
 *
 * The bounding box, the null coordinates and the index are all SQL, so a mocked
 * repository would agree with whatever the query said. What is proven here:
 * the candidates within 750 m come back nearest first, a shop past the radius
 * but inside the corner of the box does not, a shop with null coordinates
 * never does, and the statement is one the index on `(latitude, longitude)`
 * serves.
 *
 *   bash k8s/e2e/luna-shopper-backend/luna-slot.sh --ephemeral --up 5 --services core,catalog
 *   LUNA_INTEGRATION=1 CATALOG_DB_URL=postgres://luna_catalog:luna_catalog@localhost:<port>/luna_catalog \
 *     npx nx run luna-shopper-backend-catalog:test-integration --testFile=nearby-shops.integration.spec.ts
 *
 * It works in a scratch schema of its own, migrated from nothing, and drops it
 * afterwards.
 */
const SCHEMA = 'plan0164_nearby_test';

/** Plaza de las Tendillas, Córdoba. */
const CENTRE = { latitude: 37.8847, longitude: -4.7792 };

/** One degree of latitude in metres, on the sphere `distanceMetres` uses. */
const METRES_PER_DEGREE_LAT = (6_371_000 * Math.PI) / 180;

/** A point `metres` due north of the centre (south when negative). */
function north(metres: number): { latitude: number; longitude: number } {
  return {
    latitude: CENTRE.latitude + metres / METRES_PER_DEGREE_LAT,
    longitude: CENTRE.longitude,
  };
}

/** The request for a point, with nothing refused. */
function at(
  point: { latitude: number; longitude: number },
  profilePostalCodes: string[] = ['14001'],
  accuracyMetres = 20
) {
  return {
    ...point,
    accuracyMetres,
    profilePostalCodes,
    excludedSupermarketIds: [] as string[],
    excludedSupermarketLocationIds: [] as string[],
  };
}

describeIntegration('the shops near a point (real Postgres)', () => {
  let dataSource: DataSource;
  let service: NearbyShopsService;
  const ids: Record<string, string> = {};
  let chainId = '';
  let otherChainId = '';

  beforeAll(async () => {
    const url = requiredEnv('CATALOG_DB_URL');
    const bootstrap = new DataSource({ type: 'postgres', url });
    await bootstrap.initialize();
    await bootstrap.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
    await bootstrap.query(`CREATE SCHEMA "${SCHEMA}"`);
    await bootstrap.destroy();

    dataSource = new DataSource({
      type: 'postgres',
      url,
      schema: SCHEMA,
      entities: CATALOG_ENTITIES,
      migrations: CATALOG_MIGRATIONS,
      synchronize: false,
      extra: { options: `-c search_path=${SCHEMA},public` },
    });
    await dataSource.initialize();
    await dataSource.runMigrations();
    service = new NearbyShopsService(
      dataSource.getRepository(SupermarketLocation)
    );

    const supermarkets = dataSource.getRepository(Supermarket);
    chainId = (
      await supermarkets.save(
        supermarkets.create({
          name: { en: 'Nearby Mart', es: 'Nearby Mart' },
          externalBrandKey: null,
        })
      )
    ).id;
    otherChainId = (
      await supermarkets.save(
        supermarkets.create({
          name: { en: 'Other Mart', es: 'Other Mart' },
          externalBrandKey: null,
        })
      )
    ).id;

    const locations = dataSource.getRepository(SupermarketLocation);
    async function shop(
      key: string,
      point: { latitude: number; longitude: number } | null,
      postalCode: string | null,
      supermarketId = chainId
    ): Promise<void> {
      const saved = await locations.save(
        locations.create({
          supermarketId,
          label: { en: key, es: key },
          address: `Calle ${key}`,
          city: 'Córdoba',
          country: 'es',
          latitude: point?.latitude ?? null,
          longitude: point?.longitude ?? null,
          postalCode,
          postalCodeSource: null,
          externalRef: null,
          externalProvider: null,
        })
      );
      ids[key] = saved.id;
    }

    // Written out of distance order, so the order of the answer is the query's.
    await shop('far', north(700), '14002');
    await shop('near', north(100), '14001');
    await shop('middle', north(400), '14003', otherChainId);
    // Past the radius, in a straight line.
    await shop('beyond', north(800), '14001');
    // Inside the bounding box and past the radius: its corner, about 849 m.
    await shop(
      'corner',
      {
        latitude: CENTRE.latitude + 600 / METRES_PER_DEGREE_LAT,
        longitude:
          CENTRE.longitude +
          600 /
            (METRES_PER_DEGREE_LAT *
              Math.cos((CENTRE.latitude * Math.PI) / 180)),
      },
      '14001'
    );
    // No coordinates at all, in the profile's own postal code.
    await shop('unlocated', null, '14001');
  }, 120_000);

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
      await dataSource.destroy();
    }
  });

  it('answers the shops within 750 m, nearest first, and leaves out the unlocated one', async () => {
    const answer = await service.nearby(at(CENTRE, ['14001', '14003']));

    expect(answer.candidates.map((c) => c.id)).toEqual([
      ids['near'],
      ids['middle'],
      ids['far'],
    ]);
    expect(answer.candidates.map((c) => c.distanceMetres)).toEqual([
      100, 400, 700,
    ]);
    const returned = answer.candidates.map((c) => c.id);
    expect(returned).not.toContain(ids['unlocated']);
    expect(returned).not.toContain(ids['corner']);
    expect(returned).not.toContain(ids['beyond']);

    // The shop view of plan 0163, with the chain named.
    expect(answer.candidates[0]).toEqual({
      id: ids['near'],
      supermarketId: chainId,
      supermarketName: { en: 'Nearby Mart', es: 'Nearby Mart' },
      label: { en: 'near', es: 'near' },
      address: 'Calle near',
      city: 'Córdoba',
      postalCode: '14001',
      inProfile: true,
      distanceMetres: 100,
      excluded: false,
    });
    expect(answer.candidates.map((c) => c.inProfile)).toEqual([
      true,
      true,
      false,
    ]);
    // The nearest is under 250 m, and the next is under 500 m.
    expect(answer).toMatchObject({
      pick: null,
      noPick: NearbyShopNoPick.AMBIGUOUS,
    });
  });

  it('never carries the point back', async () => {
    const answer = await service.nearby(at(CENTRE));

    const text = JSON.stringify(answer);
    expect(text).not.toContain(String(CENTRE.latitude));
    expect(text).not.toContain(String(CENTRE.longitude));
  });

  it('marks a refused shop and a refused chain, and still lists both', async () => {
    const answer = await service.nearby({
      ...at(CENTRE),
      excludedSupermarketIds: [otherChainId],
      excludedSupermarketLocationIds: [ids['far']],
    });

    expect(answer.candidates.map((c) => [c.id, c.excluded])).toEqual([
      [ids['near'], false],
      [ids['middle'], true],
      [ids['far'], true],
    ]);
  });

  it('picks the clear nearest shop, and not one exactly 250 m away', async () => {
    // 220 m to `near` and 520 m to `middle`; `far` is 820 m away.
    const clear = await service.nearby(at(north(-120)));
    expect(clear.candidates.map((c) => c.distanceMetres)).toEqual([220, 520]);
    expect(clear.pick).toEqual({
      locationId: ids['near'],
      distanceMetres: 220,
    });
    expect(clear.noPick).toBeNull();

    // 250 m to `near` and 550 m to `middle`: the nearest is not under 250 m.
    const edge = await service.nearby(at(north(-150)));
    expect(edge.candidates.map((c) => c.distanceMetres)).toEqual([250, 550]);
    expect(edge).toMatchObject({
      pick: null,
      noPick: NearbyShopNoPick.AMBIGUOUS,
    });

    // The same clear nearest, outside the profile.
    const outside = await service.nearby(at(north(-120), ['28001']));
    expect(outside).toMatchObject({
      pick: null,
      noPick: NearbyShopNoPick.OUTSIDE_PROFILE,
    });

    // The same point, reported too loosely.
    const loose = await service.nearby(at(north(-120), ['14001'], 151));
    expect(loose.candidates).toHaveLength(2);
    expect(loose).toMatchObject({
      pick: null,
      noPick: NearbyShopNoPick.LOW_ACCURACY,
    });
  });

  it('answers NONE_NEARBY far from every shop', async () => {
    const answer = await service.nearby(
      at({ latitude: 40.4168, longitude: -3.7038 })
    );

    expect(answer).toEqual({
      candidates: [],
      pick: null,
      noPick: NearbyShopNoPick.NONE_NEARBY,
    });
  });

  it('names shops by id and leaves out an id that names none', async () => {
    const answer = await service.shopsById({
      supermarketLocationIds: [
        ids['near'],
        ids['middle'],
        '00000000-0000-4000-a000-000000000000',
      ],
      profilePostalCodes: ['14003'],
    });

    const byId = new Map(answer.shops.map((s) => [s.id, s]));
    expect(byId.size).toBe(2);
    expect(byId.get(ids['near'])?.inProfile).toBe(false);
    expect(byId.get(ids['middle'])).toMatchObject({
      supermarketId: otherChainId,
      supermarketName: { en: 'Other Mart', es: 'Other Mart' },
      inProfile: true,
    });
  });

  /**
   * How Postgres would run the box statement, with sequential scans switched
   * off: a handful of rows is always cheaper to scan, so asking what it would
   * do is the assertion that means anything. With `enable_seqscan` off it still
   * scans sequentially when no index can serve the statement, so seeing the
   * index named proves that it matches.
   */
  it('reads the box through ix_locations_geo', async () => {
    const box = boundingBox(
      CENTRE.latitude,
      CENTRE.longitude,
      NEARBY_SHOP_THRESHOLDS.captureRadiusMetres
    );
    const [sql, params] = service.inBox(box).getQueryAndParameters();
    const runner = dataSource.createQueryRunner();
    await runner.connect();
    try {
      await runner.query('SET enable_seqscan = off');
      const plan: Record<string, string>[] = await runner.query(
        `EXPLAIN ${sql}`,
        params
      );
      const text = plan.map((row) => Object.values(row)[0]).join('\n');
      expect(text).toContain('ix_locations_geo');
    } finally {
      await runner.query('SET enable_seqscan = on');
      await runner.release();
    }
  });
});
