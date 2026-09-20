import {
  describeIntegration,
  requiredEnv,
} from '@portfolio/luna-shopper/test-fixtures/jest';
import { DataSource } from 'typeorm';
import { CORE_ENTITIES } from '../entities';
import { CORE_MIGRATIONS } from './migrations';
import { SettlementBasket1756002300000 } from './migrations/1756002300000-SettlementBasket';

/**
 * The basket a purchase names, and its backfill (plan 0134, section 6, test 7).
 *
 * The claim is about the state **before** the migration, which cannot be reached
 * on a database that already has it, so this runs against a probe database of its
 * own, exactly as plan 0133's migration spec does:
 *
 *   docker run -d --name tmp-pg-core -e POSTGRES_PASSWORD=pw \
 *     -e POSTGRES_DB=core -p 45991:5432 postgres:16-alpine
 *   LUNA_INTEGRATION=1 CORE_DB_URL=postgres://postgres:pw@localhost:45991/core \
 *     npx nx run luna-shopper-backend-core:test-integration
 *
 * What it proves:
 *
 * - A purchase whose basket line still exists is backfilled with that line's
 *   basket, which is exactly the set today's reads call a basket purchase.
 * - A purchase whose basket line is already gone keeps a null `basketId`, and so
 *   does one made on the list page. Neither was in a basket's trip before this
 *   migration and neither enters one.
 * - Down and up again is lossless, because `generatedListLineId` still holds what
 *   the backfill reads.
 */

/** Everything before the one under test: the state the backfill starts in. */
const BEFORE = CORE_MIGRATIONS.filter(
  (migration) => migration !== SettlementBasket1756002300000
);

const PROBE_DATABASE = 'luna_core_0134_probe';

const ZONE = '01340134-0000-4000-a000-00000000000a';
const LIST = '01340134-0000-4000-a000-00000000000b';
const LINE = '01340134-0000-4000-a000-00000000000c';
const OWNER = '01340134-0000-4000-a000-00000000000d';
const PARTICIPANT = '01340134-0000-4000-a000-00000000000e';
const BASKET = '01340134-0000-4000-a000-00000000000f';
const BASKET_LINE = '01340134-0000-4000-a000-000000000010';
/** A basket line that was deleted before the migration ran. */
const GONE_LINE = '01340134-0000-4000-a000-000000000011';

/**
 * The three purchases, by the `itemId` each is seeded under.
 *
 * `itemId` is an opaque uuid in core, never a foreign key, so it labels a row
 * without pulling catalog into the fixture. It has to be a uuid all the same.
 */
const LABELS = {
  throughABasket: '01340134-1111-4000-a000-000000000001',
  basketLineGone: '01340134-1111-4000-a000-000000000002',
  onTheListPage: '01340134-1111-4000-a000-000000000003',
  outlivesItsBasket: '01340134-1111-4000-a000-000000000004',
} as const;

describeIntegration('SettlementBasket1756002300000 (real Postgres)', () => {
  let admin: DataSource;
  let probe: DataSource;
  let probeUrl: string;

  /** The settlements, by the `itemId` each was seeded under. */
  async function settlements(): Promise<Map<string, string | null>> {
    const rows: { itemId: string; basketId: string | null }[] =
      await probe.query(
        `SELECT "itemId", "basketId" FROM "line_settlements"
         ORDER BY "settledAt"`
      );
    return new Map(rows.map((row) => [row.itemId, row.basketId]));
  }

  /** One purchase, labelled by its `itemId` so the assertions can find it. */
  async function seedSettlement(
    label: string,
    basketLineId: string | null
  ): Promise<void> {
    await probe.query(
      `INSERT INTO "line_settlements"
         ("lineId", "listId", "itemId", "outcome", "quantity",
          "settledByUserId", "settledByParticipantId", "settledAt",
          "generatedListLineId")
       VALUES ($1, $2, $3, 'BOUGHT', 1, $4, $5, now(), $6)`,
      [
        LINE,
        LIST,
        label,
        basketLineId ? null : OWNER,
        basketLineId ? PARTICIPANT : null,
        basketLineId,
      ]
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
       VALUES ($1, 'Home', 'P0134P0134P0134', 'ACTIVE', '{}'::jsonb)`,
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
       VALUES ($1, $2, 'Saturday', 'GENERATED', 'FINISHED', now())`,
      [BASKET, OWNER]
    );
    await probe.query(
      `INSERT INTO "generated_list_lines"
         ("id", "generatedListId", "content", "quantity", "settledQuantity",
          "origin", "position")
       VALUES ($1, $2, 'Milk', 1, 1, 'DERIVED', 1),
              ($3, $2, 'Bread', 1, 1, 'DERIVED', 2)`,
      [BASKET_LINE, BASKET, GONE_LINE]
    );

    await seedSettlement(LABELS.throughABasket, BASKET_LINE);
    await seedSettlement(LABELS.basketLineGone, GONE_LINE);
    await seedSettlement(LABELS.onTheListPage, null);

    // The row whose basket line goes away **before** the migration, which is the
    // purchase today's reads already call a session purchase.
    await probe.query(`DELETE FROM "generated_list_lines" WHERE "id" = $1`, [
      GONE_LINE,
    ]);

    // The migration itself, as its own data source, so the migrations table
    // carries exactly the state a real deployment's does when this one runs.
    await open(CORE_MIGRATIONS);
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

  it('backfills the basket of a purchase whose basket line still exists', async () => {
    expect((await settlements()).get(LABELS.throughABasket)).toBe(BASKET);
  });

  it('leaves null a purchase whose basket line was already gone', async () => {
    // Its `generatedListLineId` names a row that is not there, so the join finds
    // nothing. It was a session purchase before this migration and it stays one.
    expect((await settlements()).get(LABELS.basketLineGone)).toBeNull();
  });

  it('leaves null a purchase made on the list page', async () => {
    expect((await settlements()).get(LABELS.onTheListPage)).toBeNull();
  });

  it('adds no foreign key, so a purchase outlives its basket', async () => {
    // A basket of its own, deleted and left deleted, so nothing this test does
    // reaches the rows the backfill assertions above and below stand on.
    const doomed = '01340134-0000-4000-a000-000000000012';
    await probe.query(
      `INSERT INTO "generated_lists"
         ("id", "ownerUserId", "name", "kind", "status", "generatedAt")
       VALUES ($1, $2, 'Deleted after', 'GENERATED', 'FINISHED', now())`,
      [doomed, OWNER]
    );
    await probe.query(
      `INSERT INTO "line_settlements"
         ("lineId", "listId", "itemId", "outcome", "quantity",
          "settledByParticipantId", "settledAt", "basketId")
       VALUES ($1, $2, $3, 'BOUGHT', 1, $4, now(), $5)`,
      [LINE, LIST, LABELS.outlivesItsBasket, PARTICIPANT, doomed]
    );

    await probe.query(`DELETE FROM "generated_lists" WHERE "id" = $1`, [
      doomed,
    ]);

    // The row stands, still naming the basket it was bought through, which is
    // how a read learns the basket was deleted (plan 0134, section 2).
    expect((await settlements()).get(LABELS.outlivesItsBasket)).toBe(doomed);

    await probe.query(`DELETE FROM "line_settlements" WHERE "itemId" = $1`, [
      LABELS.outlivesItsBasket,
    ]);
  });

  it('creates both indexes, each partial', async () => {
    const rows: { indexname: string; indexdef: string }[] = await probe.query(
      `SELECT "indexname", "indexdef" FROM pg_indexes
       WHERE "tablename" = 'line_settlements'`
    );
    const byName = new Map(rows.map((row) => [row.indexname, row.indexdef]));

    expect(byName.get('ix_settlements_basket_live')).toContain('WHERE');
    expect(byName.get('ix_settlements_user')).toContain('WHERE');
    // The basket line's index stays until plan 0136 drops its column.
    expect(byName.has('ix_settlements_basket_line_live')).toBe(true);
  });

  it('is lossless through a down and a second up', async () => {
    const before = await settlements();

    await probe.undoLastMigration({ transaction: 'each' });

    const columns: { column_name: string }[] = await probe.query(
      `SELECT "column_name" FROM information_schema.columns
       WHERE "table_name" = 'line_settlements'`
    );
    expect(columns.map((row) => row.column_name)).not.toContain('basketId');

    await probe.runMigrations({ transaction: 'each' });

    // The same answer, because `generatedListLineId` still holds what the
    // backfill reads. That stops being true at plan 0136.
    expect(await settlements()).toEqual(before);
  }, 120_000);
});
