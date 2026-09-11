import type { ConfigService } from '@nestjs/config';
import type { ClientProxy } from '@nestjs/microservices';
import {
  DiscoveredPlaceStatus,
  PostalCodeSource,
  SUPERMARKET_LOCATION_PATTERNS,
  SUPERMARKET_PATTERNS,
} from '@portfolio/luna-shopper/contracts';
import {
  describeIntegration,
  requiredEnv,
} from '@portfolio/luna-shopper/test-fixtures/jest';
import { of } from 'rxjs';
import { DataSource, Repository } from 'typeorm';
import { DiscoveredPlace, HARVESTER_ENTITIES } from '../entities';
import { CatalogClient } from './catalog-client.service';
import { DiscoveredPlaceService } from './discovered-place.service';
import type { PlatformAdminService } from './platform-admin.service';
import type { ObservedPlace } from './run-report';

/**
 * A trusted source's shop reaching the catalog, against real Postgres (plan
 * 0107, section 3.3).
 *
 * **What it proves that a unit test cannot**: the actor on the catalog write is
 * the harvester's provisioned `HARVESTER_ACTOR_ID` rather than a person's, and
 * the row the import leaves behind survives a real round trip through the
 * schema, `discovered_place_postal_code_source` enum included.
 *
 * Catalog itself is not running here and does not need to be: the boundary is
 * the NATS client, and the payload it is handed is exactly what catalog would
 * read. Standing catalog up would test catalog.
 *
 *   bash k8s/e2e/luna-shopper-backend/luna-slot.sh --up
 *   LUNA_INTEGRATION=1 HARVESTER_DB_URL=postgres://luna_harvester:luna_harvester@localhost:<port>/luna_harvester \
 *     npx nx run luna-shopper-backend-harvester:test-integration
 */
describeIntegration('a trusted source imports a place (real Postgres)', () => {
  /** The uuid `provision-release.sh` generates per cluster, fixed here. */
  const ACTOR = 'ac700000-0000-4000-a000-000000000107';
  /** A provider nothing else in this database uses, so cleanup is exact. */
  const PROVIDER = 'TEST-0107';
  const CHAIN = '11111111-1111-4111-8111-111111111107';
  /** `supermarketLocationId` is a uuid column, so the fake answer is one too. */
  const LOCATION = '22222222-2222-4222-8222-222222222107';

  let dataSource: DataSource;
  let places: Repository<DiscoveredPlace>;
  let service: DiscoveredPlaceService;
  /** Every subject and payload the client was handed, in order. */
  let sent: Array<{ subject: string; payload: Record<string, unknown> }>;

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: requiredEnv('HARVESTER_DB_URL'),
      entities: HARVESTER_ENTITIES,
      synchronize: false,
    });
    await dataSource.initialize();
    places = dataSource.getRepository(DiscoveredPlace);
  });

  beforeEach(async () => {
    await dataSource.query(
      `DELETE FROM "discovered_places" WHERE "provider" = $1`,
      [PROVIDER]
    );
    sent = [];
    const client = {
      send: jest.fn((subject: string, record: { data?: unknown }) => {
        const payload = ((record as { data?: unknown }).data ??
          record) as Record<string, unknown>;
        sent.push({ subject, payload });
        if (subject === SUPERMARKET_PATTERNS.list) {
          return of({
            items: [
              {
                id: CHAIN,
                name: { es: 'LIDL', en: 'LIDL' },
                externalBrandKey: null,
                logoUrl: null,
                websiteUrl: null,
                defaultPriceScopeId: null,
              },
            ],
            nextCursor: null,
          });
        }
        return of({ id: LOCATION, supermarketId: CHAIN });
      }),
    } as unknown as ClientProxy;
    const config = {
      getOrThrow: () => ({ actorId: ACTOR }),
    } as unknown as ConfigService;
    service = new DiscoveredPlaceService(
      places,
      new CatalogClient(client, config),
      // Never reached: the caller is a run, and a run was gated at the spawn.
      {
        requireAdmin: jest.fn(async () => {
          throw new Error('a run must not ask for an admin');
        }),
      } as unknown as PlatformAdminService
    );
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.query(
        `DELETE FROM "discovered_places" WHERE "provider" = $1`,
        [PROVIDER]
      );
      await dataSource.destroy();
    }
  });

  const observed = (over: Partial<ObservedPlace> = {}): ObservedPlace => ({
    provider: PROVIDER,
    externalRef: 'shop-1',
    brandKey: null,
    brandName: 'LIDL',
    name: 'LIDL Córdoba Poniente',
    latitude: 37.8882,
    longitude: -4.8035,
    street: 'Avenida del Aeropuerto',
    city: 'Córdoba',
    postalCode: '14013',
    postalCodeSource: PostalCodeSource.SOURCE,
    country: 'es',
    website: null,
    openingHours: null,
    tags: {},
    scopeKey: null,
    ...over,
  });

  it('writes the location as the harvester and marks the row imported', async () => {
    const result = await service.observe([observed()], {
      runId: '33333333-3333-4333-8333-333333333107',
      deriveMaxMetres: 5000,
      autoImport: true,
    });

    expect(result.imported).toBe(1);

    const created = sent.find(
      (call) => call.subject === SUPERMARKET_LOCATION_PATTERNS.create
    );
    // The point of this spec: catalog sees the harvester, not a person, so its
    // audit says a run did this (plan 0107, section 3.3).
    expect(created?.payload).toMatchObject({
      userId: ACTOR,
      supermarketId: CHAIN,
      postalCode: '14013',
      country: 'es',
      externalRef: 'shop-1',
      externalProvider: PROVIDER,
    });

    const row = await places.findOneByOrFail({
      provider: PROVIDER,
      externalRef: 'shop-1',
    });
    expect(row.status).toBe(DiscoveredPlaceStatus.IMPORTED);
    expect(row.supermarketLocationId).toBe(LOCATION);
    expect(row.postalCodeSource).toBe(PostalCodeSource.SOURCE);
  });

  it('leaves an incomplete place NEW and writes no location', async () => {
    const result = await service.observe([observed({ country: null })], {
      runId: '33333333-3333-4333-8333-333333333107',
      deriveMaxMetres: 5000,
      autoImport: true,
    });

    expect(result.blocked).toEqual([
      { externalRef: 'shop-1', missing: ['country'] },
    ]);
    expect(
      sent.some((call) => call.subject === SUPERMARKET_LOCATION_PATTERNS.create)
    ).toBe(false);

    const row = await places.findOneByOrFail({
      provider: PROVIDER,
      externalRef: 'shop-1',
    });
    expect(row.status).toBe(DiscoveredPlaceStatus.NEW);
  });

  it('leaves a place a second run meets alone once it is ours', async () => {
    const options = {
      runId: '33333333-3333-4333-8333-333333333107',
      deriveMaxMetres: 5000,
      autoImport: true,
    };
    await service.observe([observed()], options);
    sent = [];

    const second = await service.observe([observed()], options);

    expect(second.imported).toBe(0);
    expect(
      sent.some((call) => call.subject === SUPERMARKET_LOCATION_PATTERNS.create)
    ).toBe(false);
    const row = await places.findOneByOrFail({
      provider: PROVIDER,
      externalRef: 'shop-1',
    });
    expect(row.supermarketLocationId).toBe(LOCATION);
  });
});
