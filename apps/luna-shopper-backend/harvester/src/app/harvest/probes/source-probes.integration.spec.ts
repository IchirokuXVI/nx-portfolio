import type { ConfigService } from '@nestjs/config';
import {
  SourceProbeStatus,
  type SourceProbeResult,
} from '@portfolio/luna-shopper/contracts';
import { ConflictException } from '@portfolio/luna-shopper/platform';
import {
  describeIntegration,
  requiredEnv,
} from '@portfolio/luna-shopper/test-fixtures/jest';
import { DataSource } from 'typeorm';
import {
  HARVESTER_ENTITIES,
  HarvestRun,
  SourceProbe,
  type SupermarketSource,
} from '../../entities';
import { HarvestRunStore } from '../harvest-run.store';
import type { PlatformAdminService } from '../platform-admin.service';
import type { SupermarketSourceService } from '../supermarket-source.service';
import type { SourceProbeDispatcher } from './source-probe.runner';
import { SourceProbeService } from './source-probe.service';
import { SourceProbeStore } from './source-probe.store';
import { SourceProbeWorker } from './source-probe.worker';

/**
 * Probes against real Postgres (plan 0219, Tests).
 *
 * What a fake store cannot say:
 *
 * - the migration creates the type, the table and both indexes;
 * - **two harvester processes on one database claim the same due source and
 *   one probe row is written.** Each process is its own connection pool with
 *   its own store, service and worker, and both tick at the same moment;
 * - a second manual start while one is `RUNNING` answers a conflict;
 * - retention keeps the newest probe of a source older than 90 days.
 *
 * The dispatcher is a fake, so nothing here fetches a storefront.
 *
 *   bash k8s/e2e/luna-shopper-backend/luna-slot.sh --ephemeral --up 4 --services harvester
 *   LUNA_INTEGRATION=1 HARVESTER_DB_URL=postgres://... \
 *     npx nx run luna-shopper-backend-harvester:test-integration --testFile=source-probes.integration.spec.ts
 */
describeIntegration('source probes (real Postgres)', () => {
  const SOURCE = '02190219-0000-4000-8000-555555555551';
  const CHAIN = '02190219-0000-4000-8000-111111111111';
  const ADMIN = '02190219-0000-4000-8000-aaaaaaaaaaaa';
  const NOW = new Date('2026-10-20T10:00:00.000Z');

  interface Process {
    dataSource: DataSource;
    store: SourceProbeStore;
    service: SourceProbeService;
    worker: SourceProbeWorker;
  }
  let one: Process;
  let two: Process;
  /** What the fake dispatcher answers. Never resolves while it is null. */
  let answer: SourceProbeResult | null;
  const hung: Array<(result: SourceProbeResult) => void> = [];

  const passed: SourceProbeResult = { steps: [], requests: 5 };

  async function boot(): Promise<Process> {
    const dataSource = new DataSource({
      type: 'postgres',
      url: requiredEnv('HARVESTER_DB_URL'),
      entities: HARVESTER_ENTITIES,
      synchronize: false,
    });
    await dataSource.initialize();
    const config = {
      getOrThrow: () => ({ harvestEnabled: true, schedulerEnabled: true }),
    } as unknown as ConfigService;
    const store = new SourceProbeStore(dataSource.getRepository(SourceProbe));
    const sources = {
      load: async () =>
        (
          await dataSource.query(
            `SELECT * FROM "supermarket_sources" WHERE "id" = $1`,
            [SOURCE]
          )
        )[0] as SupermarketSource,
    } as unknown as SupermarketSourceService;
    const dispatcher = {
      probe: () =>
        answer
          ? Promise.resolve(answer)
          : new Promise<SourceProbeResult>((resolve) => hung.push(resolve)),
    } as unknown as SourceProbeDispatcher;
    const service = new SourceProbeService(
      store,
      sources,
      new HarvestRunStore(dataSource.getRepository(HarvestRun)),
      dispatcher,
      { requireAdmin: async () => ADMIN } as unknown as PlatformAdminService,
      config,
      () => NOW
    );
    const worker = new SourceProbeWorker(store, service, config, () => NOW);
    return { dataSource, store, service, worker };
  }

  async function clean(): Promise<void> {
    // The probes of this spec's source, and any the workers claimed for
    // another source of this database at this spec's instant.
    await one.dataSource.query(
      `DELETE FROM "source_probes" WHERE "sourceId" = $1 OR "startedAt" = $2`,
      [SOURCE, NOW]
    );
    await one.dataSource.query(
      `DELETE FROM "supermarket_sources" WHERE "id" = $1`,
      [SOURCE]
    );
  }

  async function seedSource(enabled = true): Promise<void> {
    await one.dataSource.query(
      `INSERT INTO "supermarket_sources"
         ("id", "supermarketId", "adapterKey", "enabled", "config")
       VALUES ($1, $2, 'mercadona-api', $3, '{}'::jsonb)`,
      [SOURCE, CHAIN, enabled]
    );
  }

  const probesOf = (): Promise<
    Array<{ id: string; status: string; trigger: string; startedAt: Date }>
  > =>
    one.dataSource.query(
      `SELECT "id", "status", "trigger", "startedAt"
         FROM "source_probes" WHERE "sourceId" = $1
        ORDER BY "startedAt" DESC, "id" DESC`,
      [SOURCE]
    );

  beforeAll(async () => {
    one = await boot();
    two = await boot();
    await clean();
  });

  afterEach(async () => {
    answer = passed;
    for (const release of hung.splice(0)) {
      release(passed);
    }
    await new Promise((resolve) => setImmediate(resolve));
    await clean();
  });

  afterAll(async () => {
    await clean();
    await one?.dataSource.destroy();
    await two?.dataSource.destroy();
  });

  describe('the migration', () => {
    it('creates the type, the table and both indexes', async () => {
      const [type]: { labels: string[] }[] = await one.dataSource.query(
        `SELECT array_agg(e.enumlabel ORDER BY e.enumsortorder)::text[] AS "labels"
           FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
          WHERE t.typname = 'source_probe_status'`
      );
      expect(type.labels).toEqual([
        'RUNNING',
        'PASSED',
        'SHAPE_CHANGED',
        'BLOCKED',
        'UNREACHABLE',
        'ERROR',
        'ABORTED',
      ]);
      const indexes: { name: string; definition: string }[] =
        await one.dataSource.query(
          `SELECT indexname AS "name", indexdef AS "definition" FROM pg_indexes
            WHERE tablename = 'source_probes' ORDER BY indexname`
        );
      expect(indexes.map((index) => index.name)).toEqual([
        'ix_source_probes_source_started',
        'pk_source_probes',
        'uq_source_probe_running',
      ]);
      expect(
        indexes.find((index) => index.name === 'uq_source_probe_running')
          ?.definition
      ).toMatch(
        /UNIQUE INDEX .* WHERE \(status = 'RUNNING'::source_probe_status\)/
      );
      expect(
        indexes.find(
          (index) => index.name === 'ix_source_probes_source_started'
        )?.definition
      ).toContain('"startedAt" DESC');
    });
  });

  it('writes one probe when two workers claim the same due source', async () => {
    await seedSource();
    answer = passed;

    await Promise.all([one.worker.tick(), two.worker.tick()]);

    const probes = await probesOf();
    expect(probes).toHaveLength(1);
    expect(probes[0]).toEqual(
      expect.objectContaining({ status: 'PASSED', trigger: 'SCHEDULED' })
    );

    // Due again only 24 hours later: a second round claims nothing.
    await Promise.all([one.worker.tick(), two.worker.tick()]);
    expect(await probesOf()).toHaveLength(1);
  });

  it('claims the retry of an UNREACHABLE probe as the next attempt, and reads the interval from config', async () => {
    await seedSource();
    await one.dataSource.query(
      `INSERT INTO "source_probes"
         ("sourceId", "supermarketId", "adapterKey", "trigger", "status", "attempt", "startedAt")
       VALUES ($1, $2, 'mercadona-api', 'SCHEDULED', 'UNREACHABLE', 1, $3)`,
      [SOURCE, CHAIN, new Date(NOW.getTime() - 31 * 60_000)]
    );
    answer = passed;

    await one.worker.tick();

    const [newest]: { attempt: number; status: string }[] =
      await one.dataSource.query(
        `SELECT "attempt", "status" FROM "source_probes"
          WHERE "sourceId" = $1 ORDER BY "startedAt" DESC LIMIT 1`,
        [SOURCE]
      );
    expect(newest).toEqual({ attempt: 2, status: 'PASSED' });

    // An interval of 0: never by itself, however old the newest probe.
    await one.dataSource.query(
      `DELETE FROM "source_probes" WHERE "sourceId" = $1`,
      [SOURCE]
    );
    await one.dataSource.query(
      `UPDATE "supermarket_sources" SET "config" = '{"probeIntervalHours": 0}'::jsonb WHERE "id" = $1`,
      [SOURCE]
    );
    await one.worker.tick();
    expect(await probesOf()).toEqual([]);
  });

  it('claims no source whose row is off', async () => {
    await seedSource(false);
    await one.worker.tick();
    expect(await probesOf()).toEqual([]);
  });

  it('answers a conflict to a second manual start while one is RUNNING', async () => {
    await seedSource();
    answer = null;

    const first = await one.service.start({
      userId: ADMIN,
      adminToken: 'token',
      supermarketId: CHAIN,
    });
    expect(first.status).toBe(SourceProbeStatus.RUNNING);

    await expect(
      two.service.start({
        userId: ADMIN,
        adminToken: 'token',
        supermarketId: CHAIN,
      })
    ).rejects.toThrow(ConflictException);
    // The index refuses it even when the read before it saw nothing.
    await expect(
      two.store.insertRunning({
        source: {
          id: SOURCE,
          supermarketId: CHAIN,
          adapterKey: 'mercadona-api',
        },
        trigger: 'MANUAL' as never,
        startedAt: NOW,
        requestedByUserId: ADMIN,
      })
    ).resolves.toBeNull();
    expect(await probesOf()).toHaveLength(1);
  });

  it('keeps the newest probe of a source older than 90 days, and the newest not ABORTED', async () => {
    await seedSource();
    const day = 86_400_000;
    const at = (daysAgo: number) => new Date(NOW.getTime() - daysAgo * day);
    for (const [daysAgo, status] of [
      [120, 'PASSED'],
      [110, 'BLOCKED'],
      [100, 'ABORTED'],
    ] as const) {
      await one.dataSource.query(
        `INSERT INTO "source_probes"
           ("sourceId", "supermarketId", "adapterKey", "trigger", "status", "startedAt")
         VALUES ($1, $2, 'mercadona-api', 'SCHEDULED', $3, $4)`,
        [SOURCE, CHAIN, status, at(daysAgo)]
      );
    }

    await one.store.prune(at(90));

    expect((await probesOf()).map((probe) => probe.status)).toEqual([
      'ABORTED',
      'BLOCKED',
    ]);
  });

  it('reads the newest probe that is not ABORTED for each source in one query', async () => {
    await seedSource();
    for (const [minutes, status] of [
      [30, 'SHAPE_CHANGED'],
      [10, 'ABORTED'],
    ] as const) {
      await one.dataSource.query(
        `INSERT INTO "source_probes"
           ("sourceId", "supermarketId", "adapterKey", "trigger", "status", "startedAt", "changed")
         VALUES ($1, $2, 'mercadona-api', 'SCHEDULED', $3, $4, true)`,
        [SOURCE, CHAIN, status, new Date(NOW.getTime() - minutes * 60_000)]
      );
    }

    const latest = await one.store.latestBySources([SOURCE]);

    expect(latest.get(SOURCE)).toEqual(
      expect.objectContaining({ status: 'SHAPE_CHANGED', changed: true })
    );
  });
});
