import type { ConfigService } from '@nestjs/config';
import type { ClientProxy } from '@nestjs/microservices';
import {
  DiscoveredPlaceStatus,
  PlaceLinkField,
  PlaceLinkSkipReason,
  PlaceMatchRung,
  PostalCodeSource,
  SUPERMARKET_LOCATION_PATTERNS,
  SUPERMARKET_PATTERNS,
  type SupermarketLocationView,
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

/**
 * A place links to the shop it is, against real Postgres (plan 0193).
 *
 * **What it proves that a unit test cannot.** Three rules of the plan are a
 * `where` clause, and a fake that answers rows proves none of them: the bulk
 * act reads `NEW` places only, the list read honours `country` and
 * `postalCode`, and a link leaves a row that a second call no longer finds.
 * It also proves that the actor on every catalog write is the harvester's
 * provisioned `HARVESTER_ACTOR_ID`, so the audit row of a link names the
 * harvester.
 *
 * Catalog itself is not running here and does not need to be: the boundary is
 * the NATS client, and the payload it is handed is exactly what catalog would
 * read.
 *
 *   bash k8s/e2e/luna-shopper-backend/luna-slot.sh --ephemeral --up <n> --services harvester
 *   LUNA_INTEGRATION=1 HARVESTER_DB_URL=postgres://luna_harvester:luna_harvester@localhost:<port>/luna_harvester \
 *     npx nx run luna-shopper-backend-harvester:test-integration --testFile=place-link
 */
describeIntegration('a place links to the shop it is (real Postgres)', () => {
  /** The uuid `provision-release.sh` generates per cluster, fixed here. */
  const ACTOR = 'ac700000-0000-4000-a000-000000000193';
  /** A provider nothing else in this database uses, so cleanup is exact. */
  const PROVIDER = 'TEST-0193';
  /** A postal code no real place holds, so a filtered page is these rows. */
  const POSTAL_CODE = '99193';
  const ELJAMON = '11111111-1111-4111-8111-111111111193';
  const DEZA = '11111111-1111-4111-8111-222222222193';
  const SHOP_REF = '22222222-2222-4222-8222-000000000001';
  const SHOP_REJECTED = '22222222-2222-4222-8222-000000000002';
  const SHOP_IMPORTED = '22222222-2222-4222-8222-000000000003';
  const SHOP_NEAR = '22222222-2222-4222-8222-000000000004';
  const SHOP_BARE_REF = '22222222-2222-4222-8222-000000000005';
  const SEEN = new Date('2026-10-01T00:00:00.000Z');
  const LAT = 37.88;
  const LON = -4.77;

  let dataSource: DataSource;
  let places: Repository<DiscoveredPlace>;
  let service: DiscoveredPlaceService;
  let shops: SupermarketLocationView[];
  /** Every subject and payload the client was handed, in order. */
  let sent: Array<{ subject: string; payload: Record<string, unknown> }>;

  const shop = (
    id: string,
    over: Partial<SupermarketLocationView> = {}
  ): SupermarketLocationView =>
    ({
      id,
      supermarketId: ELJAMON,
      priceScopeId: 'scope',
      priceScopeIds: ['scope'],
      label: null,
      address: 'Calle de la Feria 3',
      city: 'Córdoba',
      country: 'es',
      postalCode: '14002',
      postalCodeSource: PostalCodeSource.MANUAL,
      // Two kilometres north, so no shop is near a place unless a case says so.
      latitude: LAT + 0.018,
      longitude: LON,
      externalRef: null,
      externalProvider: null,
      footprintM2: null,
      sections: [],
      ...over,
    }) as SupermarketLocationView;

  const seed = (over: Partial<DiscoveredPlace>): Promise<DiscoveredPlace> =>
    places.save(
      places.create({
        provider: PROVIDER,
        runId: null,
        brandKey: null,
        brandName: 'El Jamón 0193',
        name: 'El Jamón 0193',
        latitude: LAT,
        longitude: LON,
        street: 'Avenida de Cádiz 68',
        city: 'Córdoba',
        postalCode: POSTAL_CODE,
        postalCodeSource: PostalCodeSource.SOURCE,
        country: 'es',
        website: null,
        openingHours: null,
        tags: {},
        scopeKey: null,
        status: DiscoveredPlaceStatus.NEW,
        supermarketLocationId: null,
        firstSeenAt: SEEN,
        lastSeenAt: SEEN,
        ...over,
      })
    );

  const stored = (externalRef: string): Promise<DiscoveredPlace> =>
    places.findOneByOrFail({ provider: PROVIDER, externalRef });

  const writes = () =>
    sent.filter(
      (call) =>
        call.subject === SUPERMARKET_LOCATION_PATTERNS.update ||
        call.subject === SUPERMARKET_LOCATION_PATTERNS.create
    );

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
    shops = [
      // Made from the place `ref/a`, which lost its mark. A guessed postal
      // code and no address, so the link has something to fill.
      shop(SHOP_REF, {
        externalRef: 'ref/a',
        externalProvider: PROVIDER,
        address: null,
        postalCode: '14013',
        postalCodeSource: PostalCodeSource.DERIVED,
      }),
      shop(SHOP_REJECTED, {
        externalRef: 'ref/rejected',
        externalProvider: PROVIDER,
      }),
      shop(SHOP_IMPORTED, {
        externalRef: 'ref/imported',
        externalProvider: PROVIDER,
      }),
      // 120 metres north of every place seeded here, in the same chain.
      shop(SHOP_NEAR, { latitude: LAT + 120 / 111_194.93 }),
      // In another chain, with the reference and no provider named.
      shop(SHOP_BARE_REF, {
        supermarketId: DEZA,
        externalRef: 'ref/bare',
        externalProvider: null,
      }),
    ];
    const chain = (id: string, name: string) => ({
      id,
      name: { es: name },
      externalBrandKey: null,
      logoUrl: null,
      websiteUrl: null,
      defaultPriceScopeId: null,
    });
    const client = {
      send: jest.fn((subject: string, record: { data?: unknown }) => {
        const payload = ((record as { data?: unknown }).data ??
          record) as Record<string, unknown>;
        sent.push({ subject, payload });
        if (subject === SUPERMARKET_PATTERNS.list) {
          return of({
            items: [chain(ELJAMON, 'El Jamón 0193'), chain(DEZA, 'Deza 0193')],
            nextCursor: null,
          });
        }
        if (subject === SUPERMARKET_LOCATION_PATTERNS.list) {
          return of({
            items: shops
              .filter((held) => held.supermarketId === payload['supermarketId'])
              .map((held) => ({ ...held })),
            nextCursor: null,
          });
        }
        const held = shops.find(
          (candidate) => candidate.id === payload['supermarketLocationId']
        );
        if (subject === SUPERMARKET_LOCATION_PATTERNS.update && held) {
          const { userId, supermarketLocationId, ...patch } = payload;
          void userId;
          void supermarketLocationId;
          Object.assign(held, patch);
        }
        return of({ ...held });
      }),
    } as unknown as ClientProxy;
    const config = {
      getOrThrow: () => ({ actorId: ACTOR }),
    } as unknown as ConfigService;
    service = new DiscoveredPlaceService(
      places,
      new CatalogClient(client, config),
      {
        requireAdmin: jest.fn(async () => 'admin-1'),
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

  /** The four rows every bulk case starts from. */
  async function lostMarks(): Promise<void> {
    await seed({ externalRef: 'ref/a' });
    await seed({
      externalRef: 'ref/rejected',
      status: DiscoveredPlaceStatus.REJECTED,
    });
    await seed({
      externalRef: 'ref/imported',
      status: DiscoveredPlaceStatus.IMPORTED,
      supermarketLocationId: SHOP_NEAR,
    });
    // 120 metres from a shop of its chain, and no shop carries its reference.
    await seed({ externalRef: 'ref/near' });
    await seed({ externalRef: 'ref/bare' });
  }

  const mine = <T extends { place: { provider: string } }>(rows: T[]): T[] =>
    rows.filter((row) => row.place.provider === PROVIDER);

  it('answers the dry run and leaves every row and every shop as it was', async () => {
    await lostMarks();

    const result = await service.linkByRef({ userId: 'admin-1' });

    expect(result.applied).toBe(false);
    expect(
      mine(result.linked).map((row) => [
        row.place.externalRef,
        row.shop.supermarketLocationId,
        row.filled,
      ])
    ).toEqual([
      ['ref/a', SHOP_REF, [PlaceLinkField.POSTAL_CODE, PlaceLinkField.ADDRESS]],
    ]);
    expect(
      mine(result.skipped).map((row) => [row.place.externalRef, row.reason])
    ).toEqual([['ref/bare', PlaceLinkSkipReason.PROVIDER_NOT_NAMED]]);
    expect(writes()).toEqual([]);
    expect((await stored('ref/a')).status).toBe(DiscoveredPlaceStatus.NEW);
    expect((await stored('ref/a')).supermarketLocationId).toBeNull();
  });

  it('links on apply as the harvester, and touches no decided row', async () => {
    await lostMarks();

    const result = await service.linkByRef({ userId: 'admin-1', apply: true });

    expect(result.applied).toBe(true);
    expect(mine(result.linked).map((row) => row.place.externalRef)).toEqual([
      'ref/a',
    ]);
    // The one write: the stated code over the guessed one, and the address.
    expect(writes()).toEqual([
      {
        subject: SUPERMARKET_LOCATION_PATTERNS.update,
        payload: {
          userId: ACTOR,
          supermarketLocationId: SHOP_REF,
          postalCode: POSTAL_CODE,
          postalCodeSource: PostalCodeSource.SOURCE,
          address: 'Avenida de Cádiz 68',
        },
      },
    ]);

    const linked = await stored('ref/a');
    expect(linked.status).toBe(DiscoveredPlaceStatus.IMPORTED);
    expect(linked.supermarketLocationId).toBe(SHOP_REF);

    // A decision is never reopened: both rows read exactly as they were.
    const rejected = await stored('ref/rejected');
    expect(rejected.status).toBe(DiscoveredPlaceStatus.REJECTED);
    expect(rejected.supermarketLocationId).toBeNull();
    const imported = await stored('ref/imported');
    expect(imported.supermarketLocationId).toBe(SHOP_NEAR);

    // No link on a distance, and none on a reference nobody's provider owns.
    expect((await stored('ref/near')).status).toBe(DiscoveredPlaceStatus.NEW);
    expect((await stored('ref/bare')).status).toBe(DiscoveredPlaceStatus.NEW);
  });

  it('finds nothing to link on a second apply', async () => {
    await lostMarks();
    await service.linkByRef({ userId: 'admin-1', apply: true });
    sent = [];

    const again = await service.linkByRef({ userId: 'admin-1', apply: true });

    expect(mine(again.linked)).toEqual([]);
    expect(writes()).toEqual([]);
  });

  it('writes a hand link as the harvester and answers what it filled', async () => {
    const place = await seed({ externalRef: 'ref/near' });

    const result = await service.link({
      userId: 'admin-1',
      placeId: place.id,
      supermarketLocationId: SHOP_NEAR,
    });

    expect(result.filled).toEqual([PlaceLinkField.EXTERNAL_REF]);
    expect(writes()).toEqual([
      {
        subject: SUPERMARKET_LOCATION_PATTERNS.update,
        payload: {
          userId: ACTOR,
          supermarketLocationId: SHOP_NEAR,
          externalRef: 'ref/near',
          externalProvider: PROVIDER,
        },
      },
    ]);
    const row = await stored('ref/near');
    expect(row.status).toBe(DiscoveredPlaceStatus.IMPORTED);
    expect(row.supermarketLocationId).toBe(SHOP_NEAR);
  });

  it('lists the places of one postal code, with candidates on the NEW ones only', async () => {
    await lostMarks();
    await seed({ externalRef: 'ref/elsewhere', postalCode: '99194' });
    await seed({ externalRef: 'ref/abroad', country: 'pt' });

    const page = await service.list({
      userId: 'admin-1',
      country: 'ES',
      postalCode: POSTAL_CODE,
      limit: 100,
    });

    const byRef = new Map(
      page.items.map((item) => [
        item.externalRef,
        item.candidates.map((held) => [
          held.supermarketLocationId,
          held.rung,
          held.metres,
        ]),
      ])
    );
    expect([...byRef.keys()].sort()).toEqual([
      'ref/a',
      'ref/bare',
      'ref/imported',
      'ref/near',
      'ref/rejected',
    ]);
    // Its own shop first, then the shop of the chain 120 metres away.
    expect(byRef.get('ref/a')).toEqual([
      [SHOP_REF, PlaceMatchRung.EXTERNAL_REF, 2002],
      [SHOP_NEAR, PlaceMatchRung.SAME_CHAIN_NEAR, 120],
    ]);
    expect(byRef.get('ref/near')).toEqual([
      [SHOP_NEAR, PlaceMatchRung.SAME_CHAIN_NEAR, 120],
    ]);
    // The place resolves to El Jamón, and the shop with its bare reference is
    // a Deza shop, so only the near shop of its own chain is offered.
    expect(byRef.get('ref/bare')).toEqual([
      [SHOP_NEAR, PlaceMatchRung.SAME_CHAIN_NEAR, 120],
    ]);
    expect(byRef.get('ref/rejected')).toEqual([]);
    expect(byRef.get('ref/imported')).toEqual([]);
  });

  it('asks catalog for no shop when a filtered page holds no NEW place', async () => {
    await seed({
      externalRef: 'ref/rejected',
      status: DiscoveredPlaceStatus.REJECTED,
    });

    const page = await service.list({
      userId: 'admin-1',
      country: 'es',
      postalCode: POSTAL_CODE,
    });

    expect(page.items.map((item) => item.externalRef)).toEqual([
      'ref/rejected',
    ]);
    expect(sent).toEqual([]);
  });
});
