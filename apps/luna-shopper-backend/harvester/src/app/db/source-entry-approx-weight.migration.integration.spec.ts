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
import { SourceEntryApproxWeight1760244000000 } from './migrations/1760244000000-SourceEntryApproxWeight';

/**
 * The weight column of a source row, and its check (plan 0244, section 5.5).
 *
 * - **Existing rows keep their size and their key**, and every one of them
 *   holds a null weight: nothing is backfilled.
 * - **The check refuses a weight beside a size, and a weight of zero.** The
 *   ingest keeps the rule, and only a real database proves the column does.
 * - **`down` leaves the schema it started from, and `up` again works.**
 *
 * A probe database of its own, for the reason the `SourceEntrySoldByWeight`
 * spec gives, and every read and write is SQL for the same reason.
 *
 *   LUNA_INTEGRATION=1 HARVESTER_DB_URL=postgres://... \
 *     npx nx run luna-shopper-backend-harvester:test-integration
 */

const THROUGH = HARVESTER_MIGRATIONS.slice(
  0,
  HARVESTER_MIGRATIONS.indexOf(SourceEntryApproxWeight1760244000000) + 1
);
const BEFORE = THROUGH.slice(0, -1);

const PROBE_DATABASE = 'luna_harvester_0244_probe';

const CHAIN = '02440244-0000-4000-a000-00000000000a';

interface WeighedRow {
  externalId: string;
  unitSize: string | null;
  sizeFormat: string | null;
  approxWeight: string | null;
}

/** A piece sold by the kilo, a fixed pack and a row with no size at all. */
const SEED: [string, string, number | null, string | null][] = [
  ['50946', 'Queso semicurado mezcla Hacendado', null, 'kg'],
  ['60226', 'Ensaladilla rusa mediana', 0.58, 'kg'],
  ['no-size', 'Bolsa reutilizable', null, null],
];

describeIntegration(
  'SourceEntryApproxWeight1760244000000 (real Postgres)',
  () => {
    let admin: DataSource;
    let probe: DataSource;
    let before: WeighedRow[];

    const read = (dataSource: DataSource): Promise<WeighedRow[]> =>
      dataSource.query(
        `SELECT "externalId", "unitSize", "sizeFormat",
                to_jsonb(e) ->> 'approxWeight' AS "approxWeight"
           FROM "source_catalog_entries" e
          WHERE "supermarketId" = $1
          ORDER BY "externalId"`,
        [CHAIN]
      );

    const columns = async (): Promise<string[]> =>
      (
        (await probe.query(
          `SELECT column_name FROM information_schema.columns
            WHERE table_name = 'source_catalog_entries'`
        )) as { column_name: string }[]
      ).map((column) => column.column_name);

    beforeAll(async () => {
      const url = new URL(requiredEnv('HARVESTER_DB_URL'));
      admin = new DataSource({ type: 'postgres', url: url.toString() });
      await admin.initialize();
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
      for (const [externalId, name, unitSize, sizeFormat] of SEED) {
        await probe.query(
          `INSERT INTO "source_catalog_entries"
                  ("supermarketId", "externalId", "sourceKind", "name",
                   "unitSize", "sizeFormat", "status")
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            CHAIN,
            externalId,
            PriceSourceKind.OFFICIAL_API,
            name,
            unitSize,
            sizeFormat,
            SourceEntryStatus.UNRESOLVED,
          ]
        );
      }
      before = await read(probe);

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
      expect(Math.max(...stamps)).toBeLessThan(1760244000000);
    });

    it('keeps every existing row, and backfills no weight', async () => {
      const after = await read(probe);

      expect(before).toHaveLength(SEED.length);
      expect(
        after.map(({ externalId, unitSize, sizeFormat }) => [
          externalId,
          unitSize,
          sizeFormat,
        ])
      ).toEqual(
        before.map(({ externalId, unitSize, sizeFormat }) => [
          externalId,
          unitSize,
          sizeFormat,
        ])
      );
      expect(after.every((row) => row.approxWeight === null)).toBe(true);
    }, 180_000);

    it('holds a weight on a row with no size', async () => {
      await probe.query(
        `UPDATE "source_catalog_entries" SET "approxWeight" = 1540
          WHERE "supermarketId" = $1 AND "externalId" = '50946'`,
        [CHAIN]
      );
      const stored = (await read(probe)).find(
        (row) => row.externalId === '50946'
      );
      expect(Number(stored?.approxWeight)).toBe(1540);
    }, 180_000);

    it('refuses a weight beside a size, and a weight of zero', async () => {
      await expect(
        probe.query(
          `UPDATE "source_catalog_entries" SET "approxWeight" = 580
            WHERE "supermarketId" = $1 AND "externalId" = '60226'`,
          [CHAIN]
        )
      ).rejects.toThrow(/chk_source_catalog_entries_approx_weight/);
      await expect(
        probe.query(
          `UPDATE "source_catalog_entries" SET "approxWeight" = 0
            WHERE "supermarketId" = $1 AND "externalId" = 'no-size'`,
          [CHAIN]
        )
      ).rejects.toThrow(/chk_source_catalog_entries_approx_weight/);
      // The piece of 7.2: its size cleared and its weight written in one go.
      await probe.query(
        `UPDATE "source_catalog_entries"
            SET "unitSize" = NULL, "sizeUnit" = NULL, "approxWeight" = 580
          WHERE "supermarketId" = $1 AND "externalId" = '60226'`,
        [CHAIN]
      );
      const stored = (await read(probe)).find(
        (row) => row.externalId === '60226'
      );
      expect(stored?.unitSize).toBeNull();
      expect(Number(stored?.approxWeight)).toBe(580);
    }, 180_000);

    it('comes back down to the schema it started from, and up again', async () => {
      await probe.undoLastMigration({ transaction: 'each' });

      expect(await columns()).not.toContain('approxWeight');
      const constraints = (await probe.query(
        `SELECT conname FROM pg_constraint
          WHERE conname = 'chk_source_catalog_entries_approx_weight'`
      )) as unknown[];
      expect(constraints).toEqual([]);
      expect((await read(probe)).map((row) => row.externalId)).toEqual(
        before.map((row) => row.externalId)
      );

      await probe.runMigrations({ transaction: 'each' });
      expect(await columns()).toContain('approxWeight');
      expect(
        (await read(probe)).every((row) => row.approxWeight === null)
      ).toBe(true);
    }, 180_000);
  }
);
