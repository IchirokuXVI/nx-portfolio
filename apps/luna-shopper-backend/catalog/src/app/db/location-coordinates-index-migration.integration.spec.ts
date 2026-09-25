import {
  describeIntegration,
  requiredEnv,
} from '@portfolio/luna-shopper/test-fixtures/jest';
import { DataSource } from 'typeorm';
import { CATALOG_MIGRATIONS } from './migrations';
import { LocationCoordinatesIndex1758050000000 } from './migrations/1758050000000-LocationCoordinatesIndex';

/**
 * The index on where a shop is, against real Postgres (plan 0164, section 1).
 *
 * Three claims about the database: the migration creates a btree on
 * `(latitude, longitude)` in that order, `down` removes it, and running `up`
 * a second time changes nothing. The index being used by the nearby read is
 * `nearby-shops.integration.spec.ts`'s claim, next door.
 *
 * The schema is migrated through a **prefix** of the list, so each state is
 * the one a cluster passes through: everything before this migration, then
 * this migration.
 *
 * It works in a scratch schema of its own and drops it afterwards.
 *
 *   LUNA_INTEGRATION=1 CATALOG_DB_URL=postgres://luna_catalog:luna_catalog@localhost:<port>/luna_catalog \
 *     npx nx run luna-shopper-backend-catalog:test-integration --testFile=location-coordinates-index-migration.integration.spec.ts
 */
const SCHEMA = 'plan0164_migration_test';

const UNDER_TEST = 'LocationCoordinatesIndex1758050000000';
const THROUGH = CATALOG_MIGRATIONS.slice(
  0,
  CATALOG_MIGRATIONS.findIndex((m) => m.name === UNDER_TEST) + 1
);
const BEFORE = THROUGH.slice(0, -1);

describeIntegration(
  'the location coordinates index migration (real Postgres)',
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

    /** The index's definition, or null when there is none. */
    async function definition(dataSource: DataSource): Promise<string | null> {
      const rows: { indexdef: string }[] = await dataSource.query(
        `SELECT indexdef FROM pg_indexes
        WHERE schemaname = $1 AND indexname = 'ix_locations_geo'`,
        [SCHEMA]
      );
      return rows[0]?.indexdef ?? null;
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
      expect(THROUGH[THROUGH.length - 1]).toBe(
        LocationCoordinatesIndex1758050000000
      );
      expect(BEFORE).not.toContain(LocationCoordinatesIndex1758050000000);
    });

    it('adds the index, removes it on down, and adds it once on a second up', async () => {
      const before = await connect(BEFORE);
      try {
        await before.runMigrations();
        expect(await definition(before)).toBeNull();
      } finally {
        await before.destroy();
      }

      const through = await connect(THROUGH);
      try {
        await through.runMigrations();
        const created = await definition(through);
        expect(created).toMatch(/USING btree \(latitude, longitude\)/);
        expect(created).toMatch(/ON \S*supermarket_locations /);

        // Running up again is a no op, which is what IF NOT EXISTS promises.
        const runner = through.createQueryRunner();
        try {
          await new LocationCoordinatesIndex1758050000000().up(runner);
        } finally {
          await runner.release();
        }
        expect(await definition(through)).toBe(created);

        await through.undoLastMigration();
        expect(await definition(through)).toBeNull();

        await through.runMigrations();
        expect(await definition(through)).toBe(created);
      } finally {
        await through.destroy();
      }
    }, 180_000);
  }
);
