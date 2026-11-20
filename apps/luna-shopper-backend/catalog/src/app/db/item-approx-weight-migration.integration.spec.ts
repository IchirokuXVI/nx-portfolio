import {
  describeIntegration,
  requiredEnv,
} from '@portfolio/luna-shopper/test-fixtures/jest';
import { DataSource } from 'typeorm';
import { CATALOG_MIGRATIONS } from './migrations';
import { ItemApproxWeight1759300000000 } from './migrations/1759300000000-ItemApproxWeight';

/**
 * The weight of a piece, against real Postgres (plan 0244, section 3.1).
 *
 * Three claims about the database: `up` adds the two columns and the two
 * checks and leaves every existing product as it was, the checks refuse a
 * sized product with a weight and a weight with no writer in raw SQL, and
 * `down` takes all four away again, so `up` can run a second time.
 *
 * The schema is migrated through a **prefix** of the list, so each state is
 * the one a cluster passes through: everything before this migration, then
 * this migration.
 *
 * It works in a scratch schema of its own and drops it afterwards.
 *
 *   LUNA_INTEGRATION=1 CATALOG_DB_URL=postgres://luna_catalog:luna_catalog@localhost:<port>/luna_catalog \
 *     npx nx run luna-shopper-backend-catalog:test-integration --testFile=item-approx-weight-migration.integration.spec.ts
 */
const SCHEMA = 'plan0244_migration_test';

const UNDER_TEST = 'ItemApproxWeight1759300000000';
const THROUGH = CATALOG_MIGRATIONS.slice(
  0,
  CATALOG_MIGRATIONS.findIndex((m) => m.name === UNDER_TEST) + 1
);
const BEFORE = THROUGH.slice(0, -1);

describeIntegration(
  'the item approximate weight migration (real Postgres)',
  () => {
    const url = () => requiredEnv('CATALOG_DB_URL');

    function connect(
      migrations: typeof CATALOG_MIGRATIONS
    ): Promise<DataSource> {
      return new DataSource({
        type: 'postgres',
        url: url(),
        schema: SCHEMA,
        migrations,
        synchronize: false,
        extra: { options: `-c search_path=${SCHEMA},public` },
      }).initialize();
    }

    async function columns(dataSource: DataSource): Promise<string[]> {
      const rows: { column_name: string }[] = await dataSource.query(
        `SELECT column_name FROM information_schema.columns
        WHERE table_schema = $1 AND table_name = 'items'
          AND column_name IN ('approxWeight', 'approxWeightSetBy')
        ORDER BY column_name`,
        [SCHEMA]
      );
      return rows.map((row) => row.column_name);
    }

    async function checks(dataSource: DataSource): Promise<string[]> {
      const rows: { conname: string }[] = await dataSource.query(
        `SELECT c.conname FROM pg_constraint c
         JOIN pg_namespace n ON n.oid = c.connamespace
        WHERE n.nspname = $1 AND c.conname LIKE 'item_approx_weight_%'
        ORDER BY c.conname`,
        [SCHEMA]
      );
      return rows.map((row) => row.conname);
    }

    /** One product the way the catalog stores a sized pack, in raw SQL. */
    async function pack(dataSource: DataSource): Promise<string> {
      const [row]: { id: string }[] = await dataSource.query(
        `INSERT INTO "items" ("name", "unitSize", "defaultUnit")
       VALUES ('{"es":"Queso en cuña"}'::jsonb, 1560, 'GRAM')
       RETURNING "id"`
      );
      return row.id;
    }

    beforeAll(async () => {
      const bootstrap = new DataSource({ type: 'postgres', url: url() });
      await bootstrap.initialize();
      await bootstrap.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
      await bootstrap.query(`CREATE SCHEMA "${SCHEMA}"`);
      await bootstrap.destroy();
    });

    afterAll(async () => {
      const bootstrap = new DataSource({ type: 'postgres', url: url() });
      await bootstrap.initialize();
      await bootstrap.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
      await bootstrap.destroy();
    });

    it('is the last step of the prefix it is tested through', () => {
      expect(THROUGH[THROUGH.length - 1]).toBe(ItemApproxWeight1759300000000);
      expect(BEFORE).not.toContain(ItemApproxWeight1759300000000);
    });

    it('adds the columns and the checks, refuses a weight beside a size, and goes down again', async () => {
      let existing: string;
      const before = await connect(BEFORE);
      try {
        await before.runMigrations();
        expect(await columns(before)).toEqual([]);
        existing = await pack(before);
      } finally {
        await before.destroy();
      }

      const through = await connect(THROUGH);
      try {
        await through.runMigrations();
        expect(await columns(through)).toEqual([
          'approxWeight',
          'approxWeightSetBy',
        ]);
        expect(await checks(through)).toEqual([
          'item_approx_weight_beside_no_size',
          'item_approx_weight_has_a_writer',
        ]);
        // The migration writes no row: the product made before it holds none.
        const [kept]: {
          approxWeight: string | null;
          approxWeightSetBy: string | null;
        }[] = await through.query(
          `SELECT "approxWeight", "approxWeightSetBy" FROM "items" WHERE "id" = $1`,
          [existing]
        );
        expect(kept).toEqual({ approxWeight: null, approxWeightSetBy: null });

        // The rule in the database, whatever writes the row.
        await expect(
          through.query(
            `UPDATE "items" SET "approxWeight" = 1560, "approxWeightSetBy" = 'SOURCE'
            WHERE "id" = $1`,
            [existing]
          )
        ).rejects.toThrow(/item_approx_weight_beside_no_size/);
        await expect(
          through.query(
            `UPDATE "items" SET "unitSize" = NULL, "defaultUnit" = 'KILOGRAM',
                  "approxWeight" = 1560 WHERE "id" = $1`,
            [existing]
          )
        ).rejects.toThrow(/item_approx_weight_has_a_writer/);
        await through.query(
          `UPDATE "items" SET "unitSize" = NULL, "defaultUnit" = 'KILOGRAM',
                "approxWeight" = 1560, "approxWeightSetBy" = 'SOURCE'
          WHERE "id" = $1`,
          [existing]
        );

        await through.undoLastMigration();
        expect(await columns(through)).toEqual([]);
        expect(await checks(through)).toEqual([]);

        await through.runMigrations();
        expect(await columns(through)).toEqual([
          'approxWeight',
          'approxWeightSetBy',
        ]);
        expect(await checks(through)).toHaveLength(2);
      } finally {
        await through.destroy();
      }
    }, 180_000);
  }
);
