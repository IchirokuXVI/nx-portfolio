import {
  PriceSourceKind,
  SourceEntryStatus,
} from '@portfolio/luna-shopper/contracts';
import {
  describeIntegration,
  requiredEnv,
} from '@portfolio/luna-shopper/test-fixtures/jest';
import { DataSource } from 'typeorm';
import { HARVESTER_MIGRATIONS } from './migrations';
import { SourceEntryCategoryPathsReplacedBy1760760000000 } from './migrations/1760760000000-SourceEntryCategoryPathsReplacedBy';

/**
 * The column that names the run which last replaced a row's category paths
 * whole (164a).
 *
 * Three claims that need a real database:
 *
 * - **It adds one nullable `uuid` column and nothing else**: the columns of
 *   the table before and after differ by exactly that one, and no index is
 *   added.
 * - **It deletes and rewrites no row.** The row count is the same, and every
 *   row reads exactly what it held before, with the new column null.
 * - **`down` drops the column, and `up` adds it again.**
 *
 * It runs against a probe database of its own, for the reason the
 * `OneSourceProduct` spec gives: the point is the state before the migration.
 * Every read and write here is SQL, so a later plan's column cannot break it.
 *
 *   LUNA_INTEGRATION=1 HARVESTER_DB_URL=postgres://... \
 *     npx nx run luna-shopper-backend-harvester:test-integration
 */
const THROUGH = HARVESTER_MIGRATIONS.slice(
  0,
  HARVESTER_MIGRATIONS.indexOf(
    SourceEntryCategoryPathsReplacedBy1760760000000
  ) + 1
);
const BEFORE = THROUGH.slice(0, -1);

const PROBE_DATABASE = 'luna_harvester_164a_probe';

const DIA = '0164a164-0000-4000-a000-00000000000d';
const RUN = '0164a164-0000-4000-a000-0000000000a1';

/** `[externalId, categoryPaths]`, as the runs wrote them before the column. */
const SEED: [string, string[][]][] = [
  ['659', [['Agua y refrescos', 'Cola']]],
  ['38406', [['Agua y refrescos', 'Cola'], ['Navidad']]],
  ['281517', []],
];

describeIntegration(
  'SourceEntryCategoryPathsReplacedBy1760760000000 (real Postgres)',
  () => {
    let admin: DataSource;
    let probe: DataSource;
    let probeUrl: string;
    let rowsBefore: Record<string, unknown>[] = [];
    let columnsBefore: string[] = [];
    let indexesBefore: string[] = [];

    const rows = (): Promise<Record<string, unknown>[]> =>
      probe.query(
        `SELECT to_jsonb(e) AS "row" FROM "source_catalog_entries" e
          ORDER BY "externalId"`
      );
    const columns = async (): Promise<string[]> =>
      (
        (await probe.query(
          `SELECT column_name FROM information_schema.columns
            WHERE table_name = 'source_catalog_entries'`
        )) as { column_name: string }[]
      )
        .map((each) => each.column_name)
        .sort();
    const indexes = async (): Promise<string[]> =>
      (
        (await probe.query(
          `SELECT indexname FROM pg_indexes
            WHERE tablename = 'source_catalog_entries'`
        )) as { indexname: string }[]
      )
        .map((each) => each.indexname)
        .sort();

    const open = async (migrations: typeof THROUGH) => {
      probe = new DataSource({
        type: 'postgres',
        url: probeUrl,
        migrations,
        migrationsTableName: 'migrations',
        synchronize: false,
      });
      await probe.initialize();
      await probe.runMigrations({ transaction: 'each' });
    };

    beforeAll(async () => {
      const url = new URL(requiredEnv('HARVESTER_DB_URL'));
      admin = new DataSource({ type: 'postgres', url: url.toString() });
      await admin.initialize();
      // `DROP` first, so a killed run leaves nothing behind for the next one.
      await admin.query(`DROP DATABASE IF EXISTS "${PROBE_DATABASE}"`);
      await admin.query(`CREATE DATABASE "${PROBE_DATABASE}"`);
      url.pathname = `/${PROBE_DATABASE}`;
      probeUrl = url.toString();

      await open(BEFORE);
      for (const [externalId, categoryPaths] of SEED) {
        await probe.query(
          `INSERT INTO "source_catalog_entries"
                    ("supermarketId", "externalId", "sourceKind", "name",
                     "status", "categoryPaths", "lastRunId")
             VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
          [
            DIA,
            externalId,
            PriceSourceKind.OFFICIAL_API,
            `Producto ${externalId}`,
            SourceEntryStatus.UNRESOLVED,
            JSON.stringify(categoryPaths),
            RUN,
          ]
        );
      }
      rowsBefore = await rows();
      columnsBefore = await columns();
      indexesBefore = await indexes();
      await probe.destroy();
      // The migration itself, as its own data source, so the migrations table
      // carries the state a real deployment's does when this one runs.
      await open(THROUGH);
    }, 180_000);

    afterAll(async () => {
      if (probe?.isInitialized) {
        await probe.destroy();
      }
      if (admin?.isInitialized) {
        await admin.query(`DROP DATABASE IF EXISTS "${PROBE_DATABASE}"`);
        await admin.destroy();
      }
    });

    it('is newer than every migration before it', () => {
      const stamps = BEFORE.map((migration) =>
        Number(/(\d{13})$/.exec(migration.name)?.[1])
      );
      expect(stamps.length).toBeGreaterThan(0);
      expect(Math.max(...stamps)).toBeLessThan(1760760000000);
    });

    it('adds one nullable uuid column and no index', async () => {
      expect(await columns()).toEqual(
        [...columnsBefore, 'categoryPathsReplacedByRunId'].sort()
      );
      expect(await indexes()).toEqual(indexesBefore);
      const [column]: {
        data_type: string;
        is_nullable: string;
        column_default: string | null;
      }[] = await probe.query(
        `SELECT data_type, is_nullable, column_default
           FROM information_schema.columns
          WHERE table_name = 'source_catalog_entries'
            AND column_name = 'categoryPathsReplacedByRunId'`
      );
      expect(column).toEqual({
        data_type: 'uuid',
        is_nullable: 'YES',
        column_default: null,
      });
    });

    it('keeps every row exactly as it was, with the column null', async () => {
      expect(rowsBefore).toHaveLength(SEED.length);
      const after = await rows();
      expect(after).toEqual(
        rowsBefore.map((each) => ({
          row: {
            ...(each['row'] as Record<string, unknown>),
            categoryPathsReplacedByRunId: null,
          },
        }))
      );
    }, 180_000);

    it('goes down to the rows as they were, and up again', async () => {
      const migration = new SourceEntryCategoryPathsReplacedBy1760760000000();
      const runner = probe.createQueryRunner();
      try {
        await migration.down(runner);
        expect(await columns()).toEqual(columnsBefore);
        expect(await rows()).toEqual(rowsBefore);

        await migration.up(runner);
      } finally {
        await runner.release();
      }
      expect(await columns()).toContain('categoryPathsReplacedByRunId');
    }, 180_000);
  }
);
