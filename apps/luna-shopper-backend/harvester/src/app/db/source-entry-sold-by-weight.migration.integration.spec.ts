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
import { SourceEntrySoldByWeight1758100000000 } from './migrations/1758100000000-SourceEntrySoldByWeight';

/**
 * The sold by weight column, and what it must not move (plan 0181).
 *
 * Three claims, and none can be made without a real database:
 *
 * - **Existing rows keep `sizeFormat`, `externalId` and their size**, byte for
 *   byte. The first is half of the alias key (plan 0081) and the second is the
 *   row's identity.
 * - **Nothing is backfilled.** Every row written before the plan says false,
 *   a row printed `kg` included: whether a product is sold by weight is a
 *   field of the source's payload, and a run is what reads it.
 * - **The column is never null**, so a reader has no third answer to handle.
 *
 * It runs against a probe database of its own, for the reason the
 * `OneSourceProduct` spec gives: the point is the state *before* the migration,
 * which cannot be reached on a database that already has it.
 *
 * **Every read and write here is SQL, and none goes through an entity.** The
 * probe stops at this migration, and an entity describes the newest schema, so
 * a repository would select a column the next plan adds and this spec would
 * fail the day that plan lands.
 *
 *   LUNA_INTEGRATION=1 HARVESTER_DB_URL=postgres://... \
 *     npx nx run luna-shopper-backend-harvester:test-integration
 */

/**
 * The list up to and including the one under test, and everything before it.
 * A prefix rather than a filter, so a migration added after this one never
 * runs against the old schema here.
 */
const THROUGH = HARVESTER_MIGRATIONS.slice(
  0,
  HARVESTER_MIGRATIONS.indexOf(SourceEntrySoldByWeight1758100000000) + 1
);
const BEFORE = THROUGH.slice(0, -1);

const PROBE_DATABASE = 'luna_harvester_0181_probe';

const CHAIN = '01810181-0000-4000-a000-00000000000a';

interface WeighedRow {
  externalId: string;
  name: string;
  unitSize: string | null;
  sizeUnit: string | null;
  sizeFormat: string | null;
  soldByWeight: boolean | null;
}

/**
 * The shapes the audit found on slot 1, as the sources wrote them before the
 * plan: an approximate piece with its estimated weight, a fixed pack, a bare
 * `kg` and a leaflet tile.
 */
const SEED: [string, string, number | null, string | null, string | null][] = [
  ['50946', 'Queso semicurado mezcla Hacendado', 1.54, 'KILOGRAM', 'kg'],
  ['84692', 'Croissant de mantequilla', 0.05, 'KILOGRAM', 'kg'],
  ['eljamon-102', 'bacon original', null, null, 'kg'],
  ['leaflet-hash-kilo', 'Solomillo de Cerdo Blanco', null, null, 'Kilo'],
  ['no-size', 'Bolsa reutilizable', null, null, null],
];

describeIntegration(
  'SourceEntrySoldByWeight1758100000000 (real Postgres)',
  () => {
    let admin: DataSource;
    let probe: DataSource;
    let before: WeighedRow[];

    const read = (dataSource: DataSource): Promise<WeighedRow[]> =>
      dataSource.query(
        `SELECT "externalId", "name", "unitSize", "sizeUnit", "sizeFormat",
                (to_jsonb(e) ->> 'soldByWeight')::boolean AS "soldByWeight"
           FROM "source_catalog_entries" e
          WHERE "supermarketId" = $1
          ORDER BY "externalId"`,
        [CHAIN]
      );

    beforeAll(async () => {
      const url = new URL(requiredEnv('HARVESTER_DB_URL'));
      admin = new DataSource({ type: 'postgres', url: url.toString() });
      await admin.initialize();
      // `DROP` first, so a killed run leaves nothing that makes the next one
      // fail on a database that already exists.
      await admin.query(`DROP DATABASE IF EXISTS "${PROBE_DATABASE}"`);
      await admin.query(`CREATE DATABASE "${PROBE_DATABASE}"`);

      url.pathname = `/${PROBE_DATABASE}`;
      const probeUrl = url.toString();

      probe = new DataSource({
        type: 'postgres',
        url: probeUrl,
        migrations: BEFORE,
        migrationsTableName: 'migrations',
        synchronize: false,
      });
      await probe.initialize();
      await probe.runMigrations({ transaction: 'each' });
      for (const [externalId, name, unitSize, sizeUnit, sizeFormat] of SEED) {
        await probe.query(
          `INSERT INTO "source_catalog_entries"
                  ("supermarketId", "externalId", "sourceKind", "name",
                   "unitSize", "sizeUnit", "sizeFormat", "status")
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            CHAIN,
            externalId,
            PriceSourceKind.OFFICIAL_API,
            name,
            unitSize,
            sizeUnit,
            sizeFormat,
            SourceEntryStatus.UNRESOLVED,
          ]
        );
      }
      before = await read(probe);

      // The migration itself, as its own data source, so the migrations table
      // carries exactly the state a real deployment's does when this one runs.
      await probe.destroy();
      probe = new DataSource({
        type: 'postgres',
        url: probeUrl,
        migrations: THROUGH,
        migrationsTableName: 'migrations',
        synchronize: false,
      });
      await probe.initialize();
      await probe.runMigrations({ transaction: 'each' });
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
      expect(Math.max(...stamps)).toBeLessThan(1758100000000);
    });

    it('keeps the key and the size of every existing row', async () => {
      const after = await read(probe);

      expect(before).toHaveLength(SEED.length);
      expect(
        after.map(({ externalId, name, unitSize, sizeUnit, sizeFormat }) => [
          externalId,
          name,
          unitSize,
          sizeUnit,
          sizeFormat,
        ])
      ).toEqual(
        before.map(({ externalId, name, unitSize, sizeUnit, sizeFormat }) => [
          externalId,
          name,
          unitSize,
          sizeUnit,
          sizeFormat,
        ])
      );
    }, 180_000);

    it('backfills nothing: every existing row says false, a row printed kg included', async () => {
      const after = await read(probe);

      // Before the migration the column does not exist, so the key is absent.
      expect(before.every((row) => row.soldByWeight === null)).toBe(true);
      expect(after.every((row) => row.soldByWeight === false)).toBe(true);
    }, 180_000);

    it('holds what a run writes, and refuses a null', async () => {
      await probe.query(
        `UPDATE "source_catalog_entries"
            SET "soldByWeight" = true, "unitSize" = NULL, "sizeUnit" = NULL
          WHERE "supermarketId" = $1 AND "externalId" = '50946'`,
        [CHAIN]
      );
      const stored = (await read(probe)).find(
        (row) => row.externalId === '50946'
      );
      expect(stored).toMatchObject({
        soldByWeight: true,
        unitSize: null,
        sizeUnit: null,
        // The key is what it was.
        sizeFormat: 'kg',
      });

      await expect(
        probe.query(
          `UPDATE "source_catalog_entries" SET "soldByWeight" = NULL
            WHERE "supermarketId" = $1 AND "externalId" = 'no-size'`,
          [CHAIN]
        )
      ).rejects.toThrow(/null value in column "soldByWeight"/);
    }, 180_000);

    it('defaults a row inserted with no answer to false', async () => {
      await probe.query(
        `INSERT INTO "source_catalog_entries"
                ("supermarketId", "externalId", "sourceKind", "name", "status")
         VALUES ($1, 'inserted-after', $2, 'Sal fina', $3)`,
        [CHAIN, PriceSourceKind.OFFICIAL_API, SourceEntryStatus.UNRESOLVED]
      );
      const stored = (await read(probe)).find(
        (row) => row.externalId === 'inserted-after'
      );
      expect(stored?.soldByWeight).toBe(false);
    }, 180_000);

    it('comes back down to the schema it started from, and up again', async () => {
      await probe.undoLastMigration({ transaction: 'each' });

      const columns = async (): Promise<string[]> =>
        (
          (await probe.query(
            `SELECT column_name FROM information_schema.columns
              WHERE table_name = 'source_catalog_entries'`
          )) as { column_name: string }[]
        ).map((column) => column.column_name);
      expect(await columns()).not.toContain('soldByWeight');
      expect(
        (await read(probe))
          .filter((row) => row.externalId !== 'inserted-after')
          .map(({ externalId, sizeFormat }) => [externalId, sizeFormat])
      ).toEqual(
        before.map(({ externalId, sizeFormat }) => [externalId, sizeFormat])
      );

      await probe.runMigrations({ transaction: 'each' });
      expect(await columns()).toContain('soldByWeight');
      expect(
        (await read(probe)).every((row) => row.soldByWeight === false)
      ).toBe(true);
    }, 180_000);
  }
);
