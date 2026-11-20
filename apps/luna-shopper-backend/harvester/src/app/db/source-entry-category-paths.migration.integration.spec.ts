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
import { SourceEntryCategoryPaths1760680000000 } from './migrations/1760680000000-SourceEntryCategoryPaths';

/**
 * The column of every category path (plan 0268, section 2).
 *
 * Three claims that need a real database:
 *
 * - **The column exists with the default `[]`**, on every row that existed
 *   and on a row inserted after it.
 * - **It deletes and rewrites no row.** The row count is the same before and
 *   after, and `categoryPath` of each row is what it was.
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
  HARVESTER_MIGRATIONS.indexOf(SourceEntryCategoryPaths1760680000000) + 1
);
const BEFORE = THROUGH.slice(0, -1);

const PROBE_DATABASE = 'luna_harvester_0268_probe';

const DIA = '02680268-0000-4000-a000-00000000000d';

/** `[externalId, categoryPath]`, as the runs wrote them before the plan. */
const SEED: [string, string[]][] = [
  ['659', ['Agua y refrescos', 'Cola']],
  ['38406', ['Agua y refrescos', 'Cola']],
  ['281517', []],
];

interface Row {
  externalId: string;
  categoryPath: string[];
  categoryPaths: unknown;
}

describeIntegration(
  'SourceEntryCategoryPaths1760680000000 (real Postgres)',
  () => {
    let admin: DataSource;
    let probe: DataSource;
    let probeUrl: string;
    let countBefore = 0;

    const count = async (): Promise<number> => {
      const [row]: { n: number }[] = await probe.query(
        `SELECT count(*)::int AS "n" FROM "source_catalog_entries"`
      );
      return row.n;
    };
    const read = (): Promise<Row[]> =>
      probe.query(
        `SELECT "externalId",
                "categoryPath",
                to_jsonb(e) -> 'categoryPaths' AS "categoryPaths"
           FROM "source_catalog_entries" e
          ORDER BY "externalId"`
      );
    const byId = async (): Promise<Map<string, Row>> =>
      new Map((await read()).map((row) => [row.externalId, row]));

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
      for (const [externalId, categoryPath] of SEED) {
        await probe.query(
          `INSERT INTO "source_catalog_entries"
                    ("supermarketId", "externalId", "sourceKind", "name",
                     "status", "categoryPath")
             VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
          [
            DIA,
            externalId,
            PriceSourceKind.OFFICIAL_API,
            `Producto ${externalId}`,
            SourceEntryStatus.UNRESOLVED,
            JSON.stringify(categoryPath),
          ]
        );
      }
      countBefore = await count();
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
      expect(Math.max(...stamps)).toBeLessThan(1760680000000);
    });

    it('keeps every row, and gives each one no path and its own path unchanged', async () => {
      expect(countBefore).toBe(SEED.length);
      expect(await count()).toBe(countBefore);

      const rows = await byId();
      for (const [externalId, categoryPath] of SEED) {
        expect(rows.get(externalId)).toEqual({
          externalId,
          categoryPath,
          categoryPaths: [],
        });
      }
    }, 180_000);

    it('defaults a new row to no path, and holds a list of paths verbatim', async () => {
      await probe.query(
        `INSERT INTO "source_catalog_entries"
                  ("supermarketId", "externalId", "sourceKind", "name", "status")
           VALUES ($1, 'new', $2, 'Nuevo', $3)`,
        [DIA, PriceSourceKind.OFFICIAL_API, SourceEntryStatus.UNRESOLVED]
      );
      expect((await byId()).get('new')?.categoryPaths).toEqual([]);

      const paths = [
        ['Agua y refrescos', 'Cola'],
        ['Navidad', 'Ibéricos y quesos'],
      ];
      await probe.query(
        `UPDATE "source_catalog_entries" SET "categoryPaths" = $1::jsonb
          WHERE "externalId" = '38406'`,
        [JSON.stringify(paths)]
      );
      expect((await byId()).get('38406')?.categoryPaths).toEqual(paths);

      await probe.query(
        `DELETE FROM "source_catalog_entries" WHERE "externalId" = 'new'`
      );
      await probe.query(
        `UPDATE "source_catalog_entries" SET "categoryPaths" = '[]'::jsonb
          WHERE "externalId" = '38406'`
      );
    }, 180_000);

    it('goes down to the rows as they were, and up again', async () => {
      const migration = new SourceEntryCategoryPaths1760680000000();
      const runner = probe.createQueryRunner();
      try {
        await migration.down(runner);
        const columns: { column_name: string }[] = await probe.query(
          `SELECT column_name FROM information_schema.columns
            WHERE table_name = 'source_catalog_entries'
              AND column_name = 'categoryPaths'`
        );
        expect(columns).toEqual([]);
        expect(await count()).toBe(countBefore);

        await migration.up(runner);
      } finally {
        await runner.release();
      }
      expect((await byId()).get('659')).toEqual({
        externalId: '659',
        categoryPath: ['Agua y refrescos', 'Cola'],
        categoryPaths: [],
      });
    }, 180_000);
  }
);
