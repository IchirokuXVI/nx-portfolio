import type { ConfigService } from '@nestjs/config';
import {
  describeIntegration,
  requiredEnv,
} from '@portfolio/luna-shopper/test-fixtures/jest';
import { DataSource, type Repository } from 'typeorm';
import { HARVESTER_ENTITIES, SupermarketSource } from '../entities';
import type { HarvestRunStore } from './harvest-run.store';
import type { PlatformAdminService } from './platform-admin.service';
import { SupermarketSourceService } from './supermarket-source.service';

/**
 * A run's start and finish write only the run columns of the chain row,
 * against real Postgres.
 *
 * The run reads its `SupermarketSource` when it starts and holds it until it
 * ends. An owner who switches the chain off, or changes its rate, workers or
 * config from the back office meanwhile, must keep that change: a write of the
 * whole stale object at the end of the run put the old values back, and a chain
 * switched off during a run came back on.
 *
 * A mocked repository cannot prove this: TypeORM's `save` diffs against the
 * row it reads back, so only Postgres shows which columns the write touched.
 *
 *   LUNA_INTEGRATION=1 HARVESTER_DB_URL=postgres://luna_harvester:luna_harvester@localhost:<port>/luna_harvester \
 *     npx nx run luna-shopper-backend-harvester:test-integration \
 *       --testFile=supermarket-source.run-columns.integration.spec.ts
 */
describeIntegration(
  'a run writes only its own columns of the chain row (real Postgres)',
  () => {
    /** A chain nothing else in this database uses, so cleanup is exact. */
    const CHAIN = '04900490-0000-4000-8000-111111111111';

    let dataSource: DataSource;
    let sources: Repository<SupermarketSource>;
    let service: SupermarketSourceService;

    beforeAll(async () => {
      dataSource = new DataSource({
        type: 'postgres',
        url: requiredEnv('HARVESTER_DB_URL'),
        entities: HARVESTER_ENTITIES,
        synchronize: false,
      });
      await dataSource.initialize();
      sources = dataSource.getRepository(SupermarketSource);
      // The two run writes use the repository only.
      service = new SupermarketSourceService(
        sources,
        {} as PlatformAdminService,
        {} as ConfigService,
        {} as HarvestRunStore
      );
    });

    beforeEach(async () => {
      await clean();
      await sources.save(
        sources.create({
          supermarketId: CHAIN,
          adapterKey: 'mercadona-api',
          enabled: true,
          autoImportPlaces: false,
          config: { postalCode: '28001' },
          workers: 4,
          maxRequestsPerSecond: 4,
          consecutiveFailures: 0,
        })
      );
    });

    afterAll(async () => {
      if (dataSource?.isInitialized) {
        await clean();
        await dataSource.destroy();
      }
    });

    async function clean(): Promise<void> {
      await dataSource.query(
        `DELETE FROM "supermarket_sources" WHERE "supermarketId" = $1`,
        [CHAIN]
      );
    }

    /** The row as a run reads it when it starts. */
    async function readAsRun(): Promise<SupermarketSource> {
      const row = await service.findBySupermarket(CHAIN);
      if (!row) {
        throw new Error('the chain row is missing');
      }
      return row;
    }

    /** What the back office writes while the run is in flight. */
    async function ownerChangesTheRow(): Promise<void> {
      const fresh = await readAsRun();
      fresh.enabled = false;
      fresh.workers = 2;
      fresh.maxRequestsPerSecond = 1.5;
      fresh.config = { postalCode: '41001', probeIntervalHours: 0 };
      await sources.save(fresh);
    }

    async function stored(): Promise<SupermarketSource> {
      return sources.findOneOrFail({ where: { supermarketId: CHAIN } });
    }

    function expectOwnerValues(row: SupermarketSource): void {
      expect(row.enabled).toBe(false);
      expect(row.workers).toBe(2);
      expect(Number(row.maxRequestsPerSecond)).toBe(1.5);
      expect(row.config).toEqual({
        postalCode: '41001',
        probeIntervalHours: 0,
      });
    }

    it('keeps the owner change through a run that succeeds', async () => {
      const run = await readAsRun();
      await service.recordRunStarted(run);
      await ownerChangesTheRow();
      await dataSource.query(
        `UPDATE "supermarket_sources" SET "consecutiveFailures" = 2 WHERE "supermarketId" = $1`,
        [CHAIN]
      );
      await service.recordRunFinished(run, true);

      const row = await stored();
      expectOwnerValues(row);
      expect(row.lastRunAt).not.toBeNull();
      expect(row.lastSuccessAt).not.toBeNull();
      expect(row.consecutiveFailures).toBe(0);
      expect(run.consecutiveFailures).toBe(0);
    });

    it('keeps the owner change through a run that fails', async () => {
      const run = await readAsRun();
      await service.recordRunStarted(run);
      await ownerChangesTheRow();
      await service.recordRunFinished(run, false);

      const row = await stored();
      expectOwnerValues(row);
      expect(row.lastRunAt).not.toBeNull();
      expect(row.lastSuccessAt).toBeNull();
      expect(row.consecutiveFailures).toBe(1);
      expect(run.consecutiveFailures).toBe(1);
    });

    it('counts two failures from two stale objects as two', async () => {
      const first = await readAsRun();
      const second = await readAsRun();
      await service.recordRunStarted(first);
      await service.recordRunStarted(second);
      await ownerChangesTheRow();
      await service.recordRunFinished(first, false);
      await service.recordRunFinished(second, false);

      const row = await stored();
      expectOwnerValues(row);
      expect(row.consecutiveFailures).toBe(2);
    });
  }
);
