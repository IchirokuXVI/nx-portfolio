import {
  describeIntegration,
  requiredEnv,
} from '@portfolio/luna-shopper/test-fixtures/jest';
import { DataSource } from 'typeorm';
import { CORE_ENTITIES } from '../entities';
import { CORE_MIGRATIONS } from './migrations';
import { SettlementSnapshotAndReplacement1756003800000 } from './migrations/1756003800000-SettlementSnapshotAndReplacement';

/**
 * What a buy records, and the row a correction replaces (plan 0202, sections 1
 * and 3).
 *
 * Against a probe database of its own, as the migration spec of plan 0203 is
 * and for the same reason: the claims are about `line_settlements` without the
 * two columns and with them, which cannot both be true of the database the
 * other suites share.
 *
 *   bash k8s/e2e/luna-shopper-backend/luna-slot.sh --ephemeral --up 4 --services core
 *   LUNA_INTEGRATION=1 CORE_DB_URL=postgres://luna_core:luna_core@localhost:43311/luna_core \
 *     npx nx run luna-shopper-backend-core:test-integration --testFile=settlement-snapshot-and-replacement.migration.integration.spec.ts
 *
 * What it proves:
 *
 * - `up` runs over a table that already holds buys, and leaves both columns
 *   null on them. There is no backfill.
 * - A correction is storable: a reverted row, and a row beside it that names it
 *   and holds a snapshot.
 * - A row is replaced once. A second row naming the same one is refused.
 * - **No check of the table changed.** Each of the six still refuses what it
 *   refused before.
 * - `down` runs over a table that **holds** corrections, keeps every row, and
 *   `up` runs again after it.
 */

const THROUGH = CORE_MIGRATIONS.slice(
  0,
  CORE_MIGRATIONS.indexOf(SettlementSnapshotAndReplacement1756003800000) + 1
);
const BEFORE = THROUGH.slice(0, -1);

const PROBE_DATABASE = 'luna_core_0202_probe';

const ZONE = '02020202-0000-4000-a000-00000000000a';
const LIST = '02020202-0000-4000-a000-00000000000b';
const LINE = '02020202-0000-4000-a000-00000000000c';
const OWNER = '02020202-0000-4000-a000-00000000000d';
const PARTICIPANT = '02020202-0000-4000-a000-00000000000e';
const BASKET = '02020202-0000-4000-a000-00000000000f';
const MILK = '02020202-0000-4000-a000-000000000010';
const OAT_MILK = '02020202-0000-4000-a000-000000000011';
const SCOPE = '02020202-0000-4000-a000-000000000012';
const SHOP = '02020202-0000-4000-a000-000000000013';
const CHAIN = '02020202-0000-4000-a000-000000000014';
const OLD_BUY = '02020202-0000-4000-a000-000000000015';

const SNAPSHOT = {
  name: { en: 'Oat milk', es: 'Bebida de avena' },
  brand: 'Hacendado',
  unitSize: 1,
  packCount: null,
  defaultUnit: 'LITER',
};

/** The columns one settlement row states. Everything else is null. */
interface Row {
  id?: string;
  itemId?: string | null;
  outcome?: string;
  quantity?: number;
  settledByUserId?: string | null;
  settledByParticipantId?: string | null;
  revertedAt?: string | null;
  revertedByParticipantId?: string | null;
  pricePaidCents?: number | null;
  pricePaidCurrency?: string | null;
  priceScopeId?: string | null;
  supermarketLocationId?: string | null;
  supermarketId?: string | null;
  itemSnapshot?: unknown;
  replacesSettlementId?: string | null;
}

describeIntegration('SettlementSnapshotAndReplacement (real Postgres)', () => {
  let admin: DataSource;
  let probe: DataSource;
  let probeUrl: string;

  async function open(migrations: typeof THROUGH): Promise<void> {
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

  /**
   * One basket buy of the line, with the columns of `row` over an ordinary
   * buy. The two new columns are named only when `row` states one, so the same
   * helper writes a row before the migration and after its `down`.
   */
  async function settlement(row: Row = {}): Promise<string> {
    const columns: Record<string, unknown> = {
      lineId: LINE,
      listId: LIST,
      itemId: MILK,
      outcome: 'BOUGHT',
      quantity: 1,
      settledByUserId: null,
      settledByParticipantId: PARTICIPANT,
      settledAt: '2026-10-13T10:00:00.000Z',
      basketId: BASKET,
      ...row,
    };
    if ('itemSnapshot' in columns) {
      columns['itemSnapshot'] = JSON.stringify(columns['itemSnapshot']);
    }
    const names = Object.keys(columns);
    const [inserted] = (await probe.query(
      `INSERT INTO "line_settlements" (${names
        .map((name) => `"${name}"`)
        .join(', ')})
       VALUES (${names.map((_, index) => `$${index + 1}`).join(', ')})
       RETURNING "id"`,
      names.map((name) => columns[name])
    )) as { id: string }[];
    return inserted.id;
  }

  async function columnsOf(): Promise<string[]> {
    const rows = (await probe.query(
      `SELECT column_name AS "name"
       FROM information_schema.columns
       WHERE table_name = 'line_settlements'
       ORDER BY column_name`
    )) as { name: string }[];
    return rows.map((row) => row.name);
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

    // The table as it was, with a buy in it.
    await open(BEFORE);
    await probe.runMigrations({ transaction: 'each' });
    await probe.query(
      `INSERT INTO "zones" ("id", "name", "joinCode", "status", "config")
       VALUES ($1, 'Home', 'P0202P0202P0202', 'ACTIVE', '{}'::jsonb)`,
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
    await settlement({ id: OLD_BUY });

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

  afterEach(async () => {
    await probe.query(`DELETE FROM "line_settlements" WHERE "id" <> $1`, [
      OLD_BUY,
    ]);
  });

  it('leaves a buy from before the plan null in both columns', async () => {
    const [row] = (await probe.query(
      `SELECT "itemSnapshot", "replacesSettlementId", "itemId", "quantity"
       FROM "line_settlements" WHERE "id" = $1`,
      [OLD_BUY]
    )) as Record<string, unknown>[];
    expect(row).toEqual({
      itemSnapshot: null,
      replacesSettlementId: null,
      itemId: MILK,
      quantity: 1,
    });
  });

  it('stores a correction: a reverted buy, and the row that stands in for it', async () => {
    const replaced = await settlement({
      revertedAt: '2026-10-13T10:05:00.000Z',
      revertedByParticipantId: PARTICIPANT,
      pricePaidCents: 95,
      pricePaidCurrency: 'EUR',
      priceScopeId: SCOPE,
      supermarketLocationId: SHOP,
      supermarketId: CHAIN,
    });
    const standing = await settlement({
      itemId: OAT_MILK,
      itemSnapshot: SNAPSHOT,
      replacesSettlementId: replaced,
      // The place of the buy it replaces, and no price for the new product.
      priceScopeId: SCOPE,
      supermarketLocationId: SHOP,
      supermarketId: CHAIN,
    });

    const [row] = (await probe.query(
      `SELECT "itemSnapshot", "replacesSettlementId"
       FROM "line_settlements" WHERE "id" = $1`,
      [standing]
    )) as { itemSnapshot: unknown; replacesSettlementId: string }[];
    // `jsonb` comes back as the document that went in.
    expect(row.itemSnapshot).toEqual(SNAPSHOT);
    expect(row.replacesSettlementId).toBe(replaced);
  });

  it('refuses a second row that stands in for the same buy', async () => {
    const replaced = await settlement({
      revertedAt: '2026-10-13T10:05:00.000Z',
      revertedByParticipantId: PARTICIPANT,
    });
    await settlement({ itemId: OAT_MILK, replacesSettlementId: replaced });

    await expect(
      settlement({ itemId: OAT_MILK, replacesSettlementId: replaced })
    ).rejects.toThrow(/ux_settlements_replaces/);
  });

  it('lets any number of rows stand in for nothing', async () => {
    // The index is partial, so the ordinary buy is not compared with another.
    await settlement();
    await expect(settlement()).resolves.toBeDefined();
  });

  it('changed no check of the table', async () => {
    const refused: [string, Row][] = [
      // A buy by an account and a participant at once.
      ['ck_line_settlements_actor', { settledByUserId: OWNER }],
      // A time of revert with nobody who reverted. This is the check a rewrite
      // has to satisfy on the row it replaces.
      [
        'ck_line_settlements_revert',
        { revertedAt: '2026-10-13T10:05:00.000Z' },
      ],
      ['ck_line_settlements_price', { pricePaidCents: 95, priceScopeId: SCOPE }],
      [
        'ck_line_settlements_price_amount',
        { pricePaidCents: -1, pricePaidCurrency: 'EUR', priceScopeId: SCOPE },
      ],
      [
        'ck_line_settlements_price_bought',
        {
          outcome: 'NOT_AVAILABLE',
          quantity: 0,
          pricePaidCents: 95,
          pricePaidCurrency: 'EUR',
          priceScopeId: SCOPE,
        },
      ],
      // A shop with no scope, and a chain with no shop. A buy with no shop
      // stores no chain, which this check has held since plan 0163.
      ['ck_line_settlements_location_scope', { supermarketLocationId: SHOP }],
      [
        'ck_line_settlements_location_scope',
        { priceScopeId: SCOPE, supermarketId: CHAIN },
      ],
    ];
    for (const [check, row] of refused) {
      await expect(settlement(row)).rejects.toThrow(new RegExp(check));
    }
    const checks = (await probe.query(
      `SELECT conname AS "name"
       FROM pg_constraint
       WHERE conrelid = '"line_settlements"'::regclass AND contype = 'c'
       ORDER BY conname`
    )) as { name: string }[];
    expect(checks.map((row) => row.name)).toEqual([
      'ck_line_settlements_actor',
      'ck_line_settlements_location_scope',
      'ck_line_settlements_price',
      'ck_line_settlements_price_amount',
      'ck_line_settlements_price_bought',
      'ck_line_settlements_revert',
    ]);
  });

  it('goes down over a table that holds corrections, and up again', async () => {
    const replaced = await settlement({
      revertedAt: '2026-10-13T10:05:00.000Z',
      revertedByParticipantId: PARTICIPANT,
    });
    const standing = await settlement({
      itemId: OAT_MILK,
      itemSnapshot: SNAPSHOT,
      replacesSettlementId: replaced,
    });

    await probe.undoLastMigration({ transaction: 'each' });

    expect(await columnsOf()).not.toContain('itemSnapshot');
    expect(await columnsOf()).not.toContain('replacesSettlementId');
    // Every row stays. The correction now reads as a buy taken back and
    // another buy made at the same moment, and no quantity moved.
    const kept = (await probe.query(
      `SELECT "id", "itemId", "quantity", ("revertedAt" IS NOT NULL) AS "reverted"
       FROM "line_settlements" WHERE "id" = ANY($1::uuid[]) ORDER BY "itemId"`,
      [[replaced, standing]]
    )) as Record<string, unknown>[];
    expect(kept).toEqual([
      { id: replaced, itemId: MILK, quantity: 1, reverted: true },
      { id: standing, itemId: OAT_MILK, quantity: 1, reverted: false },
    ]);
    // The table takes a buy in its old shape again.
    await expect(settlement()).resolves.toBeDefined();

    await open(THROUGH);
    await expect(
      probe.runMigrations({ transaction: 'each' })
    ).resolves.toHaveLength(1);

    expect(await columnsOf()).toEqual(
      expect.arrayContaining(['itemSnapshot', 'replacesSettlementId'])
    );
    await expect(
      settlement({ itemId: OAT_MILK, itemSnapshot: SNAPSHOT })
    ).resolves.toBeDefined();
  });
});
