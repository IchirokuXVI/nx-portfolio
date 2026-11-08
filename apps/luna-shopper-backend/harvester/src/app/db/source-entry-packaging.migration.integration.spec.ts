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
import { SourceEntryPackaging1760500000000 } from './migrations/1760500000000-SourceEntryPackaging';

/**
 * The container column (plan 0248, section 2).
 *
 * Three claims that need a real database:
 *
 * - **Every row that exists holds no container**, because no run stored one
 *   before the plan, and nothing else on the row moves.
 * - **The column holds the chain's text verbatim, up to forty characters.**
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
  HARVESTER_MIGRATIONS.indexOf(SourceEntryPackaging1760500000000) + 1
);
const BEFORE = THROUGH.slice(0, -1);

const PROBE_DATABASE = 'luna_harvester_0248_probe';

const MERCADONA = '02480248-0000-4000-a000-00000000000e';

/** `[externalId, sizeFormat, packCount]`, as the runs wrote them before the plan. */
const SEED: [string, string | null, number | null][] = [
  ['28113', 'l', null],
  ['27342', 'l', null],
  ['34215', 'ud', 20],
];

interface Row {
  externalId: string;
  packaging: string | null;
  sizeFormat: string | null;
  packCount: number | null;
}

describeIntegration('SourceEntryPackaging1760500000000 (real Postgres)', () => {
  let admin: DataSource;
  let probe: DataSource;
  let probeUrl: string;

  const read = (): Promise<Row[]> =>
    probe.query(
      `SELECT "externalId",
                to_jsonb(e) ->> 'packaging' AS "packaging",
                "sizeFormat",
                "packCount"
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
    for (const [externalId, sizeFormat, packCount] of SEED) {
      await probe.query(
        `INSERT INTO "source_catalog_entries"
                  ("supermarketId", "externalId", "sourceKind", "name",
                   "status", "sizeFormat", "packCount")
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          MERCADONA,
          externalId,
          PriceSourceKind.OFFICIAL_API,
          `Producto ${externalId}`,
          SourceEntryStatus.UNRESOLVED,
          sizeFormat,
          packCount,
        ]
      );
    }
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
    expect(Math.max(...stamps)).toBeLessThan(1760500000000);
  });

  it('gives every existing row no container and moves nothing else', async () => {
    const rows = await byId();

    for (const [externalId, sizeFormat, packCount] of SEED) {
      expect(rows.get(externalId)).toEqual({
        externalId,
        packaging: null,
        sizeFormat,
        packCount,
      });
    }
  }, 180_000);

  it('holds the text verbatim, up to forty characters', async () => {
    await probe.query(
      `UPDATE "source_catalog_entries" SET "packaging" = 'Pack-4'
          WHERE "externalId" = '28113'`
    );
    expect((await byId()).get('28113')?.packaging).toBe('Pack-4');

    const longest = 'B'.repeat(40);
    await probe.query(
      `UPDATE "source_catalog_entries" SET "packaging" = $1
          WHERE "externalId" = '27342'`,
      [longest]
    );
    await expect(
      probe.query(
        `UPDATE "source_catalog_entries" SET "packaging" = $1
            WHERE "externalId" = '27342'`,
        [`${longest}B`]
      )
    ).rejects.toThrow(/too long/);
    await probe.query(
      `UPDATE "source_catalog_entries" SET "packaging" = NULL
          WHERE "externalId" IN ('28113', '27342')`
    );
  }, 180_000);

  it('goes down to the rows as they were, and up again', async () => {
    const migration = new SourceEntryPackaging1760500000000();
    const runner = probe.createQueryRunner();
    try {
      await migration.down(runner);
      const columns: { column_name: string }[] = await probe.query(
        `SELECT column_name FROM information_schema.columns
          WHERE table_name = 'source_catalog_entries'
            AND column_name = 'packaging'`
      );
      expect(columns).toEqual([]);
      expect((await byId()).get('34215')?.packCount).toBe(20);

      await migration.up(runner);
    } finally {
      await runner.release();
    }
    expect((await byId()).get('28113')?.packaging).toBeNull();
  }, 180_000);
});
