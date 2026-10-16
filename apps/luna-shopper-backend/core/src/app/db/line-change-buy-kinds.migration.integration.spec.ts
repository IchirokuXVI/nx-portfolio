import {
  describeIntegration,
  requiredEnv,
} from '@portfolio/luna-shopper/test-fixtures/jest';
import { DataSource } from 'typeorm';
import { CORE_ENTITIES } from '../entities';
import { CORE_MIGRATIONS } from './migrations';
import { LineChangeBuyKinds1756003700000 } from './migrations/1756003700000-LineChangeBuyKinds';

/**
 * A buy and a taken back buy are kinds of change (plan 0203, section 1).
 *
 * Against a probe database of its own, as plan 0163's migration spec is and for
 * the same reason: the claims are about a table with the old check and with the
 * new one, which cannot both be true of the database the other suites share.
 *
 *   bash k8s/e2e/luna-shopper-backend/luna-slot.sh --ephemeral --up 4 --services core
 *   LUNA_INTEGRATION=1 CORE_DB_URL=postgres://luna_core:luna_core@localhost:43311/luna_core \
 *     npx nx run luna-shopper-backend-core:test-integration --testFile=line-change-buy-kinds.migration.integration.spec.ts
 *
 * What it proves:
 *
 * - `up` allows the two new kinds, keeps the six old ones and still refuses a
 *   kind that is not one of the eight.
 * - `down` runs on a table that **holds** rows of the new kinds. It deletes
 *   them, keeps every other row and puts the old check back.
 * - `up` runs again after that `down`.
 */

const THROUGH = CORE_MIGRATIONS.slice(
  0,
  CORE_MIGRATIONS.indexOf(LineChangeBuyKinds1756003700000) + 1
);

const PROBE_DATABASE = 'luna_core_0203_probe';

const ZONE = '02030203-0000-4000-a000-00000000000a';
const LIST = '02030203-0000-4000-a000-00000000000b';
const LINE = '02030203-0000-4000-a000-00000000000c';
const OWNER = '02030203-0000-4000-a000-00000000000d';

describeIntegration('LineChangeBuyKinds (real Postgres)', () => {
  let admin: DataSource;
  let probe: DataSource;
  let probeUrl: string;

  async function open(): Promise<void> {
    if (probe?.isInitialized) {
      await probe.destroy();
    }
    probe = new DataSource({
      type: 'postgres',
      url: probeUrl,
      entities: CORE_ENTITIES,
      migrations: THROUGH,
      migrationsTableName: 'migrations',
      synchronize: false,
    });
    await probe.initialize();
  }

  /** One change row of `kind`, with a quantity pair. */
  function change(kind: string): Promise<unknown> {
    return probe.query(
      `INSERT INTO "list_line_changes"
         ("zoneId", "listId", "lineId", "kind",
          "quantityBefore", "quantityAfter", "actorUserId")
       VALUES ($1, $2, $3, $4, 2, 1, $5)`,
      [ZONE, LIST, LINE, kind, OWNER]
    );
  }

  async function kinds(): Promise<string[]> {
    const rows = (await probe.query(
      `SELECT "kind" FROM "list_line_changes" ORDER BY "kind"`
    )) as { kind: string }[];
    return rows.map((row) => row.kind);
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

    await open();
    await probe.runMigrations({ transaction: 'each' });

    await probe.query(
      `INSERT INTO "zones" ("id", "name", "joinCode", "status", "config")
       VALUES ($1, 'Home', 'P0203P0203P0203', 'ACTIVE', '{}'::jsonb)`,
      [ZONE]
    );
    await probe.query(
      `INSERT INTO "shopping_lists" ("id", "zoneId", "name", "createdByUserId")
       VALUES ($1, $2, 'Weekly shop', $3)`,
      [LIST, ZONE, OWNER]
    );
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
    await probe.query(`DELETE FROM "list_line_changes"`);
  });

  it('allows the two new kinds beside the six old ones', async () => {
    for (const kind of [
      'ADDED',
      'QUANTITY_CHANGED',
      'RENAMED',
      'DELETED',
      'APPROVAL_CHANGED',
      'BOUGHT',
      'BUY_REVERTED',
    ]) {
      await expect(change(kind)).resolves.toBeDefined();
    }
    // `MERGED` needs its survivor, by the check of plan 0138 that stays.
    await expect(
      probe.query(
        `INSERT INTO "list_line_changes"
           ("zoneId", "listId", "lineId", "kind", "mergedIntoLineId")
         VALUES ($1, $2, $3, 'MERGED', $3)`,
        [ZONE, LIST, LINE]
      )
    ).resolves.toBeDefined();
  });

  it('still refuses a kind that is not one of the eight', async () => {
    await expect(change('SKIPPED')).rejects.toThrow(
      /ck_list_line_changes_kind/
    );
  });

  it('goes down over rows of the new kinds, and up again', async () => {
    await change('QUANTITY_CHANGED');
    await change('BOUGHT');
    await change('BUY_REVERTED');

    await probe.undoLastMigration({ transaction: 'each' });

    // The rows the old check refuses are gone, and every other row stays.
    expect(await kinds()).toEqual(['QUANTITY_CHANGED']);
    await expect(change('BOUGHT')).rejects.toThrow(/ck_list_line_changes_kind/);
    await expect(change('BUY_REVERTED')).rejects.toThrow(
      /ck_list_line_changes_kind/
    );
    await expect(change('DELETED')).resolves.toBeDefined();

    await open();
    await expect(
      probe.runMigrations({ transaction: 'each' })
    ).resolves.toHaveLength(1);

    await expect(change('BOUGHT')).resolves.toBeDefined();
    expect(await kinds()).toEqual(['BOUGHT', 'DELETED', 'QUANTITY_CHANGED']);
  });
});
