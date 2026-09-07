import { ConfigService } from '@nestjs/config';
import {
  DiscoveredPlaceStatus,
  HarvestRunMode,
  HarvestRunStatus,
  HarvestRunTrigger,
} from '@portfolio/luna-shopper/contracts';
import {
  describeIntegration,
  requiredEnv,
} from '@portfolio/luna-shopper/test-fixtures/jest';
import { DataSource } from 'typeorm';
import {
  DiscoveredPlace,
  HARVESTER_ENTITIES,
  PostalCodeDiscoveryRequest,
} from '../entities';
import type { CatalogClient } from './catalog-client.service';
import type { PlatformAdminService } from './platform-admin.service';
import { PostalCodeDiscoveryService } from './postal-code-discovery.service';
import { PostalCodeDiscoveryStore } from './postal-code-discovery.store';

/**
 * The two grouped count queries against real Postgres (plan 0097, section 2).
 *
 * They are here rather than only beside the unit spec because everything that
 * can go wrong with them is in the SQL: one reads a code out of a run's `input`
 * JSON and joins through `harvest_runs`, the other reads the place's own column,
 * and the whole point of having two is that **they disagree**. A fake repository
 * proves the folding and nothing about the queries.
 *
 *   bash k8s/e2e/luna-shopper-backend/luna-slot.sh --up
 *   LUNA_INTEGRATION=1 HARVESTER_DB_URL=postgres://luna_harvester:luna_harvester@localhost:<port>/luna_harvester \
 *     npx nx run luna-shopper-backend-harvester:test-integration
 */
describeIntegration('postal code place counts (real Postgres)', () => {
  /** A country nothing else in this database uses, so cleanup is exact. */
  const COUNTRY = 'zy';
  const ADMIN = 'owner-1';
  const RUN_ID = 'aa970000-0000-4000-a000-000000000001';

  let dataSource: DataSource;
  let service: PostalCodeDiscoveryService;

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: requiredEnv('HARVESTER_DB_URL'),
      entities: HARVESTER_ENTITIES,
      synchronize: false,
    });
    await dataSource.initialize();

    const admin = {
      requireAdmin: async () => ADMIN,
    } as unknown as PlatformAdminService;
    const catalog = {} as unknown as CatalogClient;
    const config = {
      getOrThrow: () => ({ harvestEnabled: true }),
    } as unknown as ConfigService;

    service = new PostalCodeDiscoveryService(
      new PostalCodeDiscoveryStore(
        dataSource.getRepository(PostalCodeDiscoveryRequest)
      ),
      dataSource.getRepository(DiscoveredPlace),
      catalog,
      admin,
      config
    );
  });

  beforeEach(async () => {
    await clean();

    // One run centred on 00001, which found three places: two that turned out
    // to be in 00001 and one in 00002 next door. That asymmetry is the whole
    // reason the row carries two sets of counts.
    await dataSource.query(
      `INSERT INTO "harvest_runs" ("id", "mode", "trigger", "status", "input")
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [
        RUN_ID,
        HarvestRunMode.STORE_DISCOVERY,
        HarvestRunTrigger.SYSTEM,
        HarvestRunStatus.COMPLETED,
        JSON.stringify({
          country: COUNTRY,
          postalCode: '00001',
          radiusMetres: 3000,
        }),
      ]
    );
    await place('n/1', '00001', DiscoveredPlaceStatus.NEW);
    await place('n/2', '00001', DiscoveredPlaceStatus.IMPORTED);
    await place('n/3', '00002', DiscoveredPlaceStatus.REJECTED);
    // A place in 00002 that no run of ours wrote, so it counts for where it is
    // and for nobody's work.
    await place('n/4', '00002', DiscoveredPlaceStatus.NEW, null);

    await dataSource.query(
      `INSERT INTO "postal_code_discovery_requests"
         ("country", "postalCode", "status") VALUES ($1, '00001', 'DONE'),
                                                    ($1, '00002', 'QUEUED')`,
      [COUNTRY]
    );
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await clean();
      await dataSource.destroy();
    }
  });

  async function clean() {
    await dataSource.query(
      `DELETE FROM "discovered_places" WHERE "country" = $1`,
      [COUNTRY]
    );
    await dataSource.query(`DELETE FROM "harvest_runs" WHERE "id" = $1`, [
      RUN_ID,
    ]);
    await dataSource.query(
      `DELETE FROM "postal_code_discovery_requests" WHERE "country" = $1`,
      [COUNTRY]
    );
  }

  async function place(
    externalRef: string,
    postalCode: string,
    status: DiscoveredPlaceStatus,
    runId: string | null = RUN_ID
  ) {
    await dataSource.query(
      `INSERT INTO "discovered_places"
         ("runId", "provider", "externalRef", "latitude", "longitude",
          "postalCode", "country", "status")
       VALUES ($1, 'OSM', $2, 0, 0, $3, $4, $5)`,
      [runId, externalRef, postalCode, COUNTRY, status]
    );
  }

  it('counts the work a code caused apart from the shops in it', async () => {
    const page = await service.list({ userId: ADMIN, country: COUNTRY });
    const rows = new Map(page.items.map((item) => [item.postalCode, item]));

    // 00001 caused all three places its run wrote, wherever they landed.
    expect(rows.get('00001')?.foundByItsRuns).toEqual({
      total: 3,
      imported: 1,
      rejected: 1,
      undecided: 1,
    });
    // Two of them are actually in it.
    expect(rows.get('00001')?.locatedInIt).toEqual({
      total: 2,
      imported: 1,
      rejected: 0,
      undecided: 1,
    });

    // 00002 has run no discovery of its own, and two shops sit in it.
    expect(rows.get('00002')?.foundByItsRuns.total).toBe(0);
    expect(rows.get('00002')?.locatedInIt).toEqual({
      total: 2,
      imported: 0,
      rejected: 1,
      undecided: 1,
    });
  });

  it('lists the places located in one code, whichever run found them', async () => {
    // Section 9's filter, which is what the detail screen's panel opens with.
    const places = await dataSource
      .getRepository(DiscoveredPlace)
      .find({ where: { country: COUNTRY, postalCode: '00002' } });

    expect(places.map((row) => row.externalRef).sort()).toEqual(['n/3', 'n/4']);
  });

  it('answers zeros for a queued code nothing has looked at yet', async () => {
    await dataSource.query(
      `DELETE FROM "discovered_places" WHERE "country" = $1`,
      [COUNTRY]
    );

    const page = await service.list({ userId: ADMIN, country: COUNTRY });

    for (const item of page.items) {
      expect(item.foundByItsRuns.total).toBe(0);
      expect(item.locatedInIt.total).toBe(0);
    }
  });
});
