import {
  describeIntegration,
  requiredEnv,
} from '@portfolio/luna-shopper/test-fixtures/jest';
import { DataSource } from 'typeorm';
import { CORE_ENTITIES } from '../entities';
import { CORE_MIGRATIONS } from './migrations';
import { BasketKindStatusAndSources1756002200000 } from './migrations/1756002200000-BasketKindStatusAndSources';

/**
 * The kind, the rebuilt status and the sources table (plan 0133, section 8).
 *
 * The claim is about the state **before** the migration, which cannot be reached
 * on a database that already has it, so this runs against a probe database of its
 * own, exactly as the harvester's `SourceEntryBrandKey` spec does:
 *
 *   docker run -d --name tmp-pg-core -e POSTGRES_PASSWORD=pw \
 *     -e POSTGRES_DB=core -p 45991:5432 postgres:16-alpine
 *   LUNA_INTEGRATION=1 CORE_DB_URL=postgres://postgres:pw@localhost:45991/core \
 *     npx nx run luna-shopper-backend-core:test-integration
 *
 * What it proves:
 *
 * - The four old statuses map onto the three new ones, and `DRAFT` and `ACTIVE`
 *   land on the same one, because they were one state with two spellings.
 * - `pricingProfileId` comes out of the snapshot onto a column, including from a
 *   pre plan 0078 snapshot that has no such key at all.
 * - `basket_sources` is backfilled, and a source whose list is gone writes no
 *   row, which the foreign key would refuse anyway.
 * - Down and up again keeps all of it, which is what makes the migration safe to
 *   re-run on a cluster that rolled back.
 */

/**
 * The list up to and including the one under test, and the same list one short.
 *
 * Both are **prefixes** rather than the whole list with one entry taken out. A
 * migration that follows the one under test may lean on it, and taking only this
 * one out runs the rest against a database held deliberately one step back: plan
 * 0135's backfill reads the status literals this migration writes, so it met the
 * enum this spec has not rebuilt yet. Stopping at the one under test is also the
 * truer picture of a deployment, which has not applied anything after it either,
 * and it is what leaves this migration the last applied, so `undoLastMigration`
 * means this one.
 */
const THROUGH = CORE_MIGRATIONS.slice(
  0,
  CORE_MIGRATIONS.indexOf(BasketKindStatusAndSources1756002200000) + 1
);
const BEFORE = THROUGH.slice(0, -1);

const PROBE_DATABASE = 'luna_core_0133_probe';

const ZONE = '01330133-0000-4000-a000-00000000000a';
const LIST = '01330133-0000-4000-a000-00000000000b';
const GONE = '01330133-0000-4000-a000-00000000000c';
const OWNER = '01330133-0000-4000-a000-00000000000d';
const PROFILE = '01330133-0000-4000-a000-00000000000e';

interface BasketRow {
  id: string;
  kind: string;
  status: string;
  pricingProfileId: string | null;
}

describeIntegration(
  'BasketKindStatusAndSources1756002200000 (real Postgres)',
  () => {
    let admin: DataSource;
    let probe: DataSource;
    let probeUrl: string;

    /** The baskets, by the name their `idempotencyKey` carries. */
    async function baskets(): Promise<Map<string, BasketRow>> {
      const rows: (BasketRow & { idempotencyKey: string })[] =
        await probe.query(
          `SELECT "id", "kind"::text AS "kind", "status"::text AS "status",
                  "pricingProfileId", "idempotencyKey"
           FROM "generated_lists"`
        );
      return new Map(rows.map((row) => [row.idempotencyKey, row]));
    }

    /** The source rows of one basket, as (zone, list) pairs. */
    async function sourcesOf(
      basketId: string
    ): Promise<{ zoneId: string; listId: string | null }[]> {
      return probe.query(
        `SELECT "zoneId", "listId" FROM "basket_sources"
         WHERE "basketId" = $1 ORDER BY "listId" NULLS FIRST`,
        [basketId]
      );
    }

    /** One basket in the old shape, named by its idempotency key. */
    async function seedBasket(
      name: string,
      status: string,
      snapshot: unknown
    ): Promise<void> {
      await probe.query(
        `INSERT INTO "generated_lists"
           ("ownerUserId", "name", "status", "generatedAt", "sourceSnapshot",
            "idempotencyKey")
         VALUES ($1, $2, $3::"generated_list_status", now(), $4::jsonb, $5)`,
        [OWNER, name, status, JSON.stringify(snapshot), name]
      );
    }

    async function open(migrations: typeof CORE_MIGRATIONS): Promise<void> {
      if (probe?.isInitialized) {
        await probe.destroy();
      }
      probe = new DataSource({
        type: 'postgres',
        url: probeUrl,
        entities: CORE_ENTITIES,
        migrations,
        migrationsTableName: 'migrations',
        synchronize: false,
      });
      await probe.initialize();
    }

    beforeAll(async () => {
      const url = new URL(requiredEnv('CORE_DB_URL'));
      admin = new DataSource({ type: 'postgres', url: url.toString() });
      await admin.initialize();
      // `DROP` first, so a killed run leaves nothing the next one fails on.
      await admin.query(`DROP DATABASE IF EXISTS "${PROBE_DATABASE}"`);
      await admin.query(`CREATE DATABASE "${PROBE_DATABASE}"`);

      url.pathname = `/${PROBE_DATABASE}`;
      probeUrl = url.toString();

      await open(BEFORE);
      await probe.runMigrations({ transaction: 'each' });

      await probe.query(
        `INSERT INTO "zones" ("id", "name", "joinCode", "status", "config")
         VALUES ($1, 'Home', 'P0133P0133P0133', 'ACTIVE', '{}'::jsonb)`,
        [ZONE]
      );
      await probe.query(
        `INSERT INTO "shopping_lists" ("id", "zoneId", "name", "createdByUserId")
         VALUES ($1, $2, 'Weekly shop', $3)`,
        [LIST, ZONE, OWNER]
      );

      const sources = [
        { zoneId: ZONE, listId: LIST },
        // A source naming a list that no longer exists. The backfill's two
        // joins drop it, which the foreign keys would refuse anyway.
        { zoneId: ZONE, listId: GONE },
      ];
      await seedBasket('draft', 'DRAFT', {
        profileId: null,
        pricingProfileId: PROFILE,
        sources,
      });
      await seedBasket('active', 'ACTIVE', {
        profileId: PROFILE,
        pricingProfileId: PROFILE,
        sources: [{ zoneId: ZONE, listId: LIST }],
      });
      await seedBasket('completed', 'COMPLETED', {
        profileId: null,
        pricingProfileId: null,
        sources: [],
      });
      await seedBasket('archived', 'ARCHIVED', {
        profileId: null,
        pricingProfileId: null,
        sources: [{ zoneId: ZONE, listId: LIST }],
      });
      // A run composed before plan 0078 carries no pricing key at all.
      await seedBasket('pre0078', 'DRAFT', {
        profileId: PROFILE,
        sources: [{ zoneId: ZONE, listId: LIST }],
      });

      // The migration itself, as its own data source, so the migrations table
      // carries exactly the state a real deployment's does when this one runs.
      await open(THROUGH);
      await probe.runMigrations({ transaction: 'each' });
    }, 300_000);

    afterAll(async () => {
      if (probe?.isInitialized) {
        await probe.destroy();
      }
      if (admin?.isInitialized) {
        await admin.query(`DROP DATABASE IF EXISTS "${PROBE_DATABASE}"`);
        await admin.destroy();
      }
    });

    it('maps the four old statuses onto three, DRAFT and ACTIVE together', async () => {
      const rows = await baskets();

      expect(rows.get('draft')?.status).toBe('OPEN');
      expect(rows.get('active')?.status).toBe('OPEN');
      expect(rows.get('completed')?.status).toBe('FINISHED');
      expect(rows.get('archived')?.status).toBe('ARCHIVED');
    });

    it('calls every basket that exists a trip somebody composed', async () => {
      const rows = await baskets();

      expect([...rows.values()].map((row) => row.kind)).toEqual(
        Array.from(rows, () => 'GENERATED')
      );
    });

    it('drops the default on the kind, so an insert has to say', async () => {
      await expect(
        probe.query(
          `INSERT INTO "generated_lists"
             ("ownerUserId", "name", "status", "generatedAt")
           VALUES ($1, 'No kind', 'OPEN', now())`,
          [OWNER]
        )
      ).rejects.toThrow();
    });

    it('lifts the pricing profile onto its own column, absence and all', async () => {
      const rows = await baskets();

      expect(rows.get('draft')?.pricingProfileId).toBe(PROFILE);
      expect(rows.get('completed')?.pricingProfileId).toBeNull();
      // No such key in the stored `jsonb`, which reads as null rather than as a
      // failed cast.
      expect(rows.get('pre0078')?.pricingProfileId).toBeNull();
    });

    it('backfills a source row per surviving list, and none for a list that is gone', async () => {
      const rows = await baskets();

      expect(await sourcesOf(rows.get('draft')?.id ?? '')).toEqual([
        { zoneId: ZONE, listId: LIST },
      ]);
      expect(await sourcesOf(rows.get('completed')?.id ?? '')).toEqual([]);
    });

    it('drops the snapshot column', async () => {
      const columns: { column_name: string }[] = await probe.query(
        `SELECT "column_name" FROM information_schema.columns
         WHERE "table_name" = 'generated_lists'`
      );

      expect(columns.map((row) => row.column_name)).not.toContain(
        'sourceSnapshot'
      );
    });

    it('keeps all of it through a down and a second up', async () => {
      const before = await baskets();

      await probe.undoLastMigration({ transaction: 'each' });

      // The old shape is back, with the snapshot rebuilt from the table.
      const rolledBack: { status: string; sourceSnapshot: unknown }[] =
        await probe.query(
          `SELECT "status"::text AS "status", "sourceSnapshot"
           FROM "generated_lists" WHERE "idempotencyKey" = 'draft'`
        );
      expect(rolledBack[0].status).toBe('DRAFT');
      expect(rolledBack[0].sourceSnapshot).toEqual({
        profileId: null,
        pricingProfileId: PROFILE,
        sources: [{ zoneId: ZONE, listId: LIST }],
      });

      await probe.runMigrations({ transaction: 'each' });

      const after = await baskets();
      for (const [name, row] of before) {
        expect(after.get(name)?.status).toBe(row.status);
        expect(after.get(name)?.kind).toBe(row.kind);
        expect(after.get(name)?.pricingProfileId).toBe(row.pricingProfileId);
      }
      expect(await sourcesOf(after.get('draft')?.id ?? '')).toEqual([
        { zoneId: ZONE, listId: LIST },
      ]);
    }, 120_000);
  }
);
