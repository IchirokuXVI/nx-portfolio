import {
  describeIntegration,
  requiredEnv,
} from '@portfolio/luna-shopper/test-fixtures/jest';
import { DataSource } from 'typeorm';
import { CORE_ENTITIES } from '../entities';
import { CORE_MIGRATIONS } from './migrations';
import { BasketTripRows1756002400000 } from './migrations/1756002400000-BasketTripRows';

/**
 * The backfill of what every finished trip asked (plan 0135, section 6, test
 * 14).
 *
 * The claim is about the state **before** the migration, which cannot be reached
 * on a database that already has it, so this runs against a probe database of
 * its own, exactly as plan 0134's migration spec does:
 *
 *   docker run -d --name tmp-pg-core -e POSTGRES_PASSWORD=pw \
 *     -e POSTGRES_DB=core -p 45991:5432 postgres:16-alpine
 *   LUNA_INTEGRATION=1 CORE_DB_URL=postgres://postgres:pw@localhost:45991/core \
 *     npx nx run luna-shopper-backend-core:test-integration
 *
 * What it proves:
 *
 * - Every basket that is not `OPEN` has its rows afterwards, summed over the
 *   sibling basket lines of one zone line, and no `OPEN` basket has any.
 * - An origin whose line is gone writes no row, which the foreign key would
 *   refuse anyway.
 * - Down and up again reproduces the same rows, because the origins a finished
 *   basket holds still say what it asked. That stops being true at plan 0136.
 */

/**
 * The list up to and including the one under test, and the same list one short.
 *
 * Prefixes rather than the whole list with one entry taken out, for the reason
 * plan 0134's spec gives: the one under test has to be the last applied, or
 * `undoLastMigration` means a different migration.
 */
const THROUGH = CORE_MIGRATIONS.slice(
  0,
  CORE_MIGRATIONS.indexOf(BasketTripRows1756002400000) + 1
);
const BEFORE = THROUGH.slice(0, -1);

const PROBE_DATABASE = 'luna_core_0135_probe';

const ZONE = '01350135-0000-4000-a000-00000000000a';
const LIST = '01350135-0000-4000-a000-00000000000b';
const OWNER = '01350135-0000-4000-a000-00000000000c';
const MILK = '01350135-0000-4000-a000-00000000000d';
const BREAD = '01350135-0000-4000-a000-00000000000e';
const GONE_LINE = '01350135-0000-4000-a000-00000000000f';

/** A basket per status, named by the `idempotencyKey` it carries. */
const BASKETS = {
  finished: '01350135-0000-4000-a000-000000000010',
  archived: '01350135-0000-4000-a000-000000000011',
  open: '01350135-0000-4000-a000-000000000012',
};

describeIntegration('BasketTripRows1756002400000 (real Postgres)', () => {
  let admin: DataSource;
  let probe: DataSource;
  let probeUrl: string;
  let nextLine = 0;

  /** Every trip row, as `basketId → [lineId, asked][]`, in a stable order. */
  async function rows(): Promise<Map<string, [string, number][]>> {
    const found: { basketId: string; lineId: string; asked: number }[] =
      await probe.query(
        `SELECT "basketId", "lineId", "asked" FROM "basket_trip_rows"
         ORDER BY "basketId", "lineId"`
      );
    const byBasket = new Map<string, [string, number][]>();
    for (const row of found) {
      const list = byBasket.get(row.basketId) ?? [];
      list.push([row.lineId, Number(row.asked)]);
      byBasket.set(row.basketId, list);
    }
    return byBasket;
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

  /** One basket line, and what it asked of each zone line. */
  async function seedAsk(
    basketId: string,
    asks: readonly [string, number][]
  ): Promise<void> {
    nextLine += 1;
    const basketLineId = `01350135-0000-4000-b000-${String(nextLine).padStart(12, '0')}`;
    await probe.query(
      `INSERT INTO "generated_list_lines"
         ("id", "generatedListId", "content", "quantity", "settledQuantity",
          "origin", "position")
       VALUES ($1, $2, 'Basket line', 1, 0, 'DERIVED', $3)`,
      [basketLineId, basketId, nextLine]
    );
    for (const [lineId, quantity] of asks) {
      await probe.query(
        `INSERT INTO "generated_list_line_origins"
           ("generatedListLineId", "zoneId", "listId", "lineId", "quantity",
            "lineVersion")
         VALUES ($1, $2, $3, $4, $5, 1)`,
        [basketLineId, ZONE, LIST, lineId, quantity]
      );
    }
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
       VALUES ($1, 'Home', 'P0135P0135P0135', 'ACTIVE', '{}'::jsonb)`,
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
       VALUES ($1, $3, 'Milk', 0, 1, $4), ($2, $3, 'Bread', 0, 2, $4)`,
      [MILK, BREAD, LIST, OWNER]
    );

    for (const [key, id] of Object.entries(BASKETS)) {
      await probe.query(
        `INSERT INTO "generated_lists"
           ("id", "ownerUserId", "name", "kind", "status", "generatedAt",
            "idempotencyKey")
         VALUES ($1, $2, $3, 'GENERATED', $4, now(), $3)`,
        [id, OWNER, key, key.toUpperCase()]
      );
    }

    // Two sibling basket lines of one zone line, which the backfill sums into
    // one row (plan 0094), plus a second line and an origin taken back to zero.
    await seedAsk(BASKETS.finished, [
      [MILK, 2],
      [BREAD, 0],
    ]);
    await seedAsk(BASKETS.finished, [[MILK, 3]]);
    // An origin naming a line that is gone. The inner join drops it, which the
    // foreign key would refuse anyway.
    await seedAsk(BASKETS.archived, [
      [BREAD, 1],
      [GONE_LINE, 9],
    ]);
    await seedAsk(BASKETS.open, [[MILK, 7]]);

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

  it('sums the sibling basket lines of a finished basket, zero included', async () => {
    expect((await rows()).get(BASKETS.finished)).toEqual(
      [
        [MILK, 5],
        [BREAD, 0],
      ].sort((a, b) => String(a[0]).localeCompare(String(b[0])))
    );
  });

  it('backfills an archived basket and drops an origin whose line is gone', async () => {
    expect((await rows()).get(BASKETS.archived)).toEqual([[BREAD, 1]]);
  });

  it('writes nothing for a basket that is still open', async () => {
    expect((await rows()).has(BASKETS.open)).toBe(false);
  });

  it('copies the list off the line', async () => {
    const found: { listId: string }[] = await probe.query(
      `SELECT DISTINCT "listId" FROM "basket_trip_rows"`
    );
    expect(found.map((row) => row.listId)).toEqual([LIST]);
  });

  it('reproduces the same rows through a down and a second up', async () => {
    const before = await rows();

    await probe.undoLastMigration({ transaction: 'each' });

    const tables: { table_name: string }[] = await probe.query(
      `SELECT "table_name" FROM information_schema.tables
       WHERE "table_name" = 'basket_trip_rows'`
    );
    expect(tables).toEqual([]);

    await probe.runMigrations({ transaction: 'each' });

    // Lossless while the origins stand, because they still hold every number
    // the backfill reads. Plan 0136 deletes that table, and from then on this
    // down loses what every finished trip asked.
    expect(await rows()).toEqual(before);
  }, 120_000);
});
