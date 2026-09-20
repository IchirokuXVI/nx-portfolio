import {
  describeIntegration,
  requiredEnv,
} from '@portfolio/luna-shopper/test-fixtures/jest';
import { DataSource } from 'typeorm';
import { CORE_ENTITIES } from '../entities';
import { CORE_MIGRATIONS } from './migrations';
import { BasketsBecomeViews1756002500000 } from './migrations/1756002500000-BasketsBecomeViews';

/**
 * A basket stops storing its rows (plan 0136, section 13, test 17).
 *
 * The claim is about the state **before** the migration, which cannot be reached
 * on a database that already has it, so this runs against a probe database of
 * its own, exactly as plan 0134's and plan 0135's migration specs do:
 *
 *   docker run -d --name tmp-pg-core -e POSTGRES_PASSWORD=pw \
 *     -e POSTGRES_DB=core -p 45991:5432 postgres:16-alpine
 *   LUNA_INTEGRATION=1 CORE_DB_URL=postgres://postgres:pw@localhost:45991/core \
 *     npx nx run luna-shopper-backend-core:test-integration
 *
 * What it proves:
 *
 * - The **two assertions refuse a deploy that would lose data**: a settlement
 *   naming a basket line and no basket means plan 0134's backfill did not run,
 *   and a finished trip with origins and no frozen rows means plan 0135's did
 *   not. Each raises rather than dropping the column or the table that was
 *   carrying the answer.
 * - The three tables, the enum, the column and the two constraints are gone, and
 *   `lineId` and `listId` are `NOT NULL` again.
 * - The waiting settlements are deleted, because there is nowhere left for a
 *   purchase with no list to wait.
 * - `down` restores the shape, and running `up` again afterwards works, which is
 *   what `migrations.spec.ts` needs of every migration.
 */

/**
 * The list up to and including the one under test, and the same list one short.
 *
 * Both are **prefixes** rather than the whole list with one entry taken out, for
 * the reason plan 0134's spec gives: stopping at the one under test is the truer
 * picture of a deployment, and it is what leaves this migration the last applied
 * so `undoLastMigration` means this one.
 */
const THROUGH = CORE_MIGRATIONS.slice(
  0,
  CORE_MIGRATIONS.indexOf(BasketsBecomeViews1756002500000) + 1
);
const BEFORE = THROUGH.slice(0, -1);

const PROBE_DATABASE = 'luna_core_0136_probe';

const ZONE = '01360136-0000-4000-a000-00000000000a';
const LIST = '01360136-0000-4000-a000-00000000000b';
const LINE = '01360136-0000-4000-a000-00000000000c';
const OWNER = '01360136-0000-4000-a000-00000000000d';
const PARTICIPANT = '01360136-0000-4000-a000-00000000000e';
const BASKET = '01360136-0000-4000-a000-00000000000f';
const BASKET_LINE = '01360136-0000-4000-a000-000000000010';
/** A basket line nothing ever sent to a list: typed text that reached nobody. */
const ORPHAN_LINE = '01360136-0000-4000-a000-000000000011';

/** The purchases, by the `itemId` each is seeded under. */
const LABELS = {
  throughABasket: '01360136-1111-4000-a000-000000000001',
  waiting: '01360136-1111-4000-a000-000000000002',
} as const;

describeIntegration('BasketsBecomeViews1756002500000 (real Postgres)', () => {
  let admin: DataSource;
  let probe: DataSource;
  let probeUrl: string;

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

  /** Whether a relation exists, by name, in the probe's public schema. */
  async function tableExists(name: string): Promise<boolean> {
    const rows = await probe.query(
      `SELECT to_regclass($1) IS NOT NULL AS "there"`,
      [`public.${name}`]
    );
    return rows[0].there === true;
  }

  async function columnExists(table: string, column: string): Promise<boolean> {
    const rows = await probe.query(
      `SELECT count(*)::int AS "n"
       FROM information_schema.columns
       WHERE table_name = $1 AND column_name = $2`,
      [table, column]
    );
    return rows[0].n > 0;
  }

  async function isNullable(table: string, column: string): Promise<boolean> {
    const rows = await probe.query(
      `SELECT "is_nullable" AS "nullable"
       FROM information_schema.columns
       WHERE table_name = $1 AND column_name = $2`,
      [table, column]
    );
    return rows[0]?.nullable === 'YES';
  }

  /** The world as it stood before this migration: a trip with two basket lines. */
  async function seedTheOldWorld(): Promise<void> {
    await probe.query(
      `INSERT INTO "zones" ("id", "name", "joinCode", "status", "config")
       VALUES ($1, 'Home', 'P0136P0136P0136', 'ACTIVE', '{}'::jsonb)`,
      [ZONE]
    );
    await probe.query(
      `INSERT INTO "shopping_lists" ("id", "zoneId", "name", "createdByUserId")
       VALUES ($1, $2, 'Weekly shop', $3)`,
      [LIST, ZONE, OWNER]
    );
    await probe.query(
      `INSERT INTO "list_lines"
         ("id", "listId", "content", "quantity", "position", "createdByUserId")
       VALUES ($1, $2, 'Milk', 2, 1, $3)`,
      [LINE, LIST, OWNER]
    );
    await probe.query(
      `INSERT INTO "generated_lists"
         ("id", "ownerUserId", "name", "kind", "status", "generatedAt")
       VALUES ($1, $2, 'Saturday', 'GENERATED', 'OPEN', now())`,
      [BASKET, OWNER]
    );
    await probe.query(
      `INSERT INTO "generated_list_lines"
         ("id", "generatedListId", "content", "quantity", "settledQuantity",
          "origin", "position")
       VALUES ($1, $2, 'Milk', 3, 1, 'DERIVED', 1),
              ($3, $2, 'Batteries', 4, 0, 'ADDED', 2)`,
      [BASKET_LINE, BASKET, ORPHAN_LINE]
    );
    // One origin, contributing less than the basket line asks for, which is the
    // "extra units" plan 0056 allowed and the migration logs as lost.
    await probe.query(
      `INSERT INTO "generated_list_line_origins"
         ("generatedListLineId", "zoneId", "listId", "lineId", "quantity",
          "lineVersion")
       VALUES ($1, $2, $3, $4, 2, 1)`,
      [BASKET_LINE, ZONE, LIST, LINE]
    );
  }

  /** A purchase made through the basket, correctly backfilled by plan 0134. */
  async function seedSettled(): Promise<void> {
    await probe.query(
      `INSERT INTO "line_settlements"
         ("lineId", "listId", "itemId", "outcome", "quantity",
          "settledByUserId", "settledByParticipantId", "settledAt",
          "generatedListLineId", "basketId")
       VALUES ($1, $2, $3, 'BOUGHT', 1, NULL, $4, now(), $5, $6)`,
      [LINE, LIST, LABELS.throughABasket, PARTICIPANT, BASKET_LINE, BASKET]
    );
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
    await seedTheOldWorld();
    await seedSettled();
  });

  afterAll(async () => {
    if (probe?.isInitialized) {
      await probe.destroy();
    }
    if (admin?.isInitialized) {
      await admin.query(`DROP DATABASE IF EXISTS "${PROBE_DATABASE}"`);
      await admin.destroy();
    }
  });

  describe('the two assertions, before anything is dropped', () => {
    it('refuses a deploy where plan 0134’s backfill has not run', async () => {
      // A purchase naming a basket line and no basket. Dropping the column with
      // that join still pending loses which basket bought what, so the
      // migration raises rather than proceeding.
      await probe.query(
        `INSERT INTO "line_settlements"
           ("lineId", "listId", "itemId", "outcome", "quantity",
            "settledByUserId", "settledByParticipantId", "settledAt",
            "generatedListLineId", "basketId")
         VALUES ($1, $2, $3, 'BOUGHT', 1, NULL, $4, now(), $5, NULL)`,
        [
          LINE,
          LIST,
          '01360136-1111-4000-a000-00000000000f',
          PARTICIPANT,
          BASKET_LINE,
        ]
      );

      await open(THROUGH);
      await expect(
        probe.runMigrations({ transaction: 'each' })
      ).rejects.toThrow(/plan 0134 is not complete/);

      // Nothing was dropped: the refusal is the first statement.
      expect(await tableExists('generated_list_lines')).toBe(true);
      await probe.query(
        `DELETE FROM "line_settlements" WHERE "basketId" IS NULL`
      );
    });

    it('refuses a deploy where plan 0135’s backfill has not run', async () => {
      // A finished trip with origins and no frozen rows: its ask is about to
      // stop being readable, and nothing else records it.
      await probe.query(
        `UPDATE "generated_lists" SET "status" = 'FINISHED' WHERE id = $1`,
        [BASKET]
      );

      await open(THROUGH);
      await expect(
        probe.runMigrations({ transaction: 'each' })
      ).rejects.toThrow(/plan 0135 is not complete/);

      expect(await tableExists('generated_list_line_origins')).toBe(true);
      await probe.query(
        `UPDATE "generated_lists" SET "status" = 'OPEN' WHERE id = $1`,
        [BASKET]
      );
    });
  });

  describe('up', () => {
    beforeAll(async () => {
      // A waiting settlement: a purchase made on a basket line before that line
      // reached any list. There is nowhere for one to wait any more.
      await probe.query(
        `INSERT INTO "line_settlements"
           ("lineId", "listId", "itemId", "outcome", "quantity",
            "settledByUserId", "settledByParticipantId", "settledAt",
            "generatedListLineId", "basketId")
         VALUES (NULL, NULL, $1, 'BOUGHT', 4, NULL, $2, now(), $3, $4)`,
        [LABELS.waiting, PARTICIPANT, ORPHAN_LINE, BASKET]
      );

      await open(THROUGH);
      await probe.runMigrations({ transaction: 'each' });
    });

    it('drops the three tables and the enum only they used', async () => {
      expect(await tableExists('generated_list_lines')).toBe(false);
      expect(await tableExists('generated_list_line_origins')).toBe(false);
      expect(await tableExists('generated_list_line_options')).toBe(false);
      const types = await probe.query(
        `SELECT count(*)::int AS "n" FROM pg_type WHERE typname = $1`,
        ['generated_line_origin']
      );
      expect(types[0].n).toBe(0);
    });

    it('drops the settlement’s basket line and makes the pair NOT NULL again', async () => {
      expect(
        await columnExists('line_settlements', 'generatedListLineId')
      ).toBe(false);
      // A purchase with no line was a waiting settlement, and there is nothing
      // left for one to wait for (section 9, step 5).
      expect(await isNullable('line_settlements', 'lineId')).toBe(false);
      expect(await isNullable('line_settlements', 'listId')).toBe(false);
    });

    it('deletes the waiting settlements and keeps the ones with a home', async () => {
      const rows = await probe.query(
        `SELECT "itemId", "basketId" FROM "line_settlements"`
      );
      const labels = rows.map((row: { itemId: string }) => row.itemId);
      // Not recoverable, and plan 0093's own `down` already deleted exactly
      // these rows for the same reason: inventing a list for them would put
      // somebody else's purchase in a household's history.
      expect(labels).not.toContain(LABELS.waiting);
      // The purchase that had a home keeps it, and keeps its basket.
      expect(labels).toContain(LABELS.throughABasket);
      expect(rows[0].basketId).toBe(BASKET);
    });

    it('drops the owner’s default target list', async () => {
      // It was read by the basket's own add, which is gone: a line is added to
      // a list by name now, and there is no second place for it to go.
      expect(await columnExists('generated_lists', 'defaultTargetListId')).toBe(
        false
      );
    });

    it('leaves the basket itself, its sources and its people standing', async () => {
      const rows = await probe.query(
        `SELECT "id", "kind", "status" FROM "generated_lists" WHERE id = $1`,
        [BASKET]
      );
      // What is left is a header, a rule saying which lists it covers, and the
      // people on it. The trip is not deleted; only its copies are.
      expect(rows).toHaveLength(1);
      expect(rows[0].kind).toBe('GENERATED');
      expect(await tableExists('basket_sources')).toBe(true);
      expect(await tableExists('basket_trip_rows')).toBe(true);
    });
  });

  describe('down', () => {
    it('restores the shape, empty, and up runs again afterwards', async () => {
      await probe.undoLastMigration({ transaction: 'each' });

      // The shape and **not the data** (section 9). Basket lines, origins,
      // options, picks, positions and waiting rows are not recoverable; an open
      // basket comes back with no lines.
      expect(await tableExists('generated_list_lines')).toBe(true);
      expect(await tableExists('generated_list_line_origins')).toBe(true);
      expect(await tableExists('generated_list_line_options')).toBe(true);
      expect(
        await columnExists('line_settlements', 'generatedListLineId')
      ).toBe(true);
      expect(await isNullable('line_settlements', 'lineId')).toBe(true);
      expect(await columnExists('generated_lists', 'defaultTargetListId')).toBe(
        true
      );

      const lines = await probe.query(
        `SELECT count(*)::int AS "n" FROM "generated_list_lines"`
      );
      expect(lines[0].n).toBe(0);

      // A `down` that cannot make the older code useful is written all the same,
      // because `migrations.spec.ts` runs every migration both ways.
      await probe.runMigrations({ transaction: 'each' });
      expect(await tableExists('generated_list_lines')).toBe(false);
    });
  });
});
