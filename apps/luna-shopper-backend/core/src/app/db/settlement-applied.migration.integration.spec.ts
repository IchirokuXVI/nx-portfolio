import {
  describeIntegration,
  requiredEnv,
} from '@portfolio/luna-shopper/test-fixtures/jest';
import { DataSource } from 'typeorm';
import { CORE_ENTITIES } from '../entities';
import { BASKET_TRIP_ROWS_SQL } from '../lists/trips/trips.sql';
import { CORE_MIGRATIONS } from './migrations';
import { SettlementApplied1756004200000 } from './migrations/1756004200000-SettlementApplied';

/**
 * A buy records how much of the ask it met (plan 0274, section 1, spec 7).
 *
 * Against a probe database of its own, as the other migration specs are: the
 * claims are about `line_settlements` without `applied` and with it, which
 * cannot both be true of the database the other suites share.
 *
 *   bash k8s/e2e/luna-shopper-backend/luna-slot.sh --ephemeral --up 4 --services core
 *   LUNA_INTEGRATION=1 CORE_DB_URL=postgres://luna_core:luna_core@localhost:43311/luna_core \
 *     npx nx run luna-shopper-backend-core:test-integration --testFile=settlement-applied.migration.integration.spec.ts
 *
 * What it proves:
 *
 * - `up` gives every existing row `applied = quantity`, a close 0.
 * - No ask, `left` or `bought` that the trips read gave before it changes,
 *   including a buy above the ask written before the plan, which the floor
 *   left no trace of.
 * - The column has no default afterwards, and the check holds.
 * - `down` drops the column and the check, and `up` runs again after it.
 */

const THROUGH = CORE_MIGRATIONS.slice(
  0,
  CORE_MIGRATIONS.indexOf(SettlementApplied1756004200000) + 1
);
const BEFORE = THROUGH.slice(0, -1);

const PROBE_DATABASE = 'luna_core_0274_probe';

const ZONE = '02740274-0000-4000-a000-00000000000a';
const LIST = '02740274-0000-4000-a000-00000000000b';
const MILK = '02740274-0000-4000-a000-00000000000c';
const BREAD = '02740274-0000-4000-a000-000000000010';
const OWNER = '02740274-0000-4000-a000-00000000000d';
const PARTICIPANT = '02740274-0000-4000-a000-00000000000e';
const BASKET = '02740274-0000-4000-a000-00000000000f';

/**
 * The trips read of one basket as it was written before plan 0274: `asked` is
 * `bought + left`. Stated here and not imported, because the code that ran it
 * is gone.
 */
const OLD_ASKED_SQL = `
  SELECT ll.id AS "lineId",
         (ll.quantity + COALESCE(SUM(s."quantity")
            FILTER (WHERE s."outcome" = 'BOUGHT' AND s."revertedAt" IS NULL), 0))::int
           AS "asked",
         COALESCE(SUM(s."quantity")
            FILTER (WHERE s."outcome" = 'BOUGHT' AND s."revertedAt" IS NULL), 0)::int
           AS "bought",
         ll.quantity AS "left"
  FROM "list_lines" ll
  LEFT JOIN "line_settlements" s
    ON s."lineId" = ll.id AND s."basketId" = $1::uuid AND s."unit" = ll."unit"
  WHERE ll."listId" = $2::uuid
  GROUP BY ll.id
  ORDER BY ll.id
`;

interface Numbers {
  lineId: string;
  asked: number;
  bought: number;
  left?: number;
}

describeIntegration('SettlementApplied (real Postgres)', () => {
  let admin: DataSource;
  let probe: DataSource;
  let probeUrl: string;
  let before: Numbers[];

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

  /** One basket settlement of a line, as a writer before plan 0274 wrote it. */
  async function settlement(
    lineId: string,
    outcome: 'BOUGHT' | 'NOT_AVAILABLE',
    quantity: number,
    revertedAt: string | null = null
  ): Promise<void> {
    await probe.query(
      `INSERT INTO "line_settlements"
         ("lineId", "listId", "outcome", "quantity", "settledByParticipantId",
          "settledAt", "basketId", "revertedAt", "revertedByParticipantId")
       VALUES ($1, $2, $3, $4, $5, now(), $6, $7, $8)`,
      [
        lineId,
        LIST,
        outcome,
        quantity,
        PARTICIPANT,
        BASKET,
        revertedAt,
        revertedAt ? PARTICIPANT : null,
      ]
    );
  }

  async function oldNumbers(): Promise<Numbers[]> {
    return (await probe.query(OLD_ASKED_SQL, [BASKET, LIST])) as Numbers[];
  }

  async function columnDefault(): Promise<string | null | undefined> {
    const [row] = (await probe.query(
      `SELECT column_default AS "value"
       FROM information_schema.columns
       WHERE table_name = 'line_settlements' AND column_name = 'applied'`
    )) as { value: string | null }[];
    return row?.value;
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
      `INSERT INTO "zones" ("id", "name", "joinCode", "status", "config", "ownerUserId")
       VALUES ($1, 'Home', 'P0274P0274P0274', 'ACTIVE', '{}'::jsonb, $2)`,
      [ZONE, OWNER]
    );
    await probe.query(
      `INSERT INTO "zone_memberships" ("zoneId", "userId", "username", "role", "status")
       VALUES ($1, $2, 'Ana', 'OWNER', 'APPROVED')`,
      [ZONE, OWNER]
    );
    await probe.query(
      `INSERT INTO "shopping_lists" ("id", "zoneId", "name", "createdByUserId")
       VALUES ($1, $2, 'Weekly shop', $3)`,
      [LIST, ZONE, OWNER]
    );
    await probe.query(
      `INSERT INTO "baskets" ("id", "ownerUserId", "kind", "name", "status", "generatedAt")
       VALUES ($1, $2, 'GENERATED', 'Saturday', 'OPEN', now() - interval '1 hour')`,
      [BASKET, OWNER]
    );
    await probe.query(
      `INSERT INTO "basket_sources" ("basketId", "zoneId", "listId")
       VALUES ($1, $2, $3)`,
      [BASKET, ZONE, LIST]
    );
    await probe.query(
      `INSERT INTO "basket_participants"
         ("id", "basketId", "kind", "userId", "username", "joinedAt", "lastSeenAt")
       VALUES ($1, $2, 'OWNER', $3, 'Ana', now(), now())`,
      [PARTICIPANT, BASKET, OWNER]
    );
    await probe.query(
      `INSERT INTO "list_lines"
         ("id", "listId", "content", "quantity", "position", "createdByUserId")
       VALUES ($1, $3, 'Milk', 0, 1, $4), ($2, $3, 'Bread', 1, 2, $4)`,
      [MILK, BREAD, LIST, OWNER]
    );
    // Milk: asked 3, bought 4 before the plan, so the floor left it at 0 and
    // the read said it asked 4. Plus a buy taken back and a close.
    await settlement(MILK, 'BOUGHT', 4);
    await settlement(MILK, 'BOUGHT', 2, new Date().toISOString());
    await settlement(MILK, 'NOT_AVAILABLE', 0);
    // Bread: asked 2, bought 1, left 1.
    await settlement(BREAD, 'BOUGHT', 1);
    before = await oldNumbers();

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

  it('gives every existing row applied = quantity, and a close 0', async () => {
    const rows = (await probe.query(
      `SELECT "outcome", "quantity", "applied" FROM "line_settlements"
       ORDER BY "quantity"`
    )) as { outcome: string; quantity: number; applied: number }[];
    expect(rows).toHaveLength(4);
    for (const row of rows) {
      expect(row.applied).toBe(row.quantity);
    }
    expect(rows.find((row) => row.outcome === 'NOT_AVAILABLE')?.applied).toBe(
      0
    );
  });

  it('changes no ask, left or bought that the trips read gave before it', async () => {
    const after = (await probe.query(BASKET_TRIP_ROWS_SQL, [
      LIST,
      BASKET,
      null,
      50,
    ])) as Numbers[];
    const pick = (rows: Numbers[], lineId: string) => {
      const row = rows.find((candidate) => candidate.lineId === lineId);
      return { asked: Number(row?.asked), bought: Number(row?.bought) };
    };
    expect(pick(after, MILK)).toEqual(pick(before, MILK));
    expect(pick(after, BREAD)).toEqual(pick(before, BREAD));
    // What the old read gave, so the comparison is not of two empties.
    expect(pick(before, MILK)).toEqual({ asked: 4, bought: 4 });
    expect(pick(before, BREAD)).toEqual({ asked: 2, bought: 1 });
  });

  it('leaves no default, so an insert that does not name applied is refused', async () => {
    expect(await columnDefault()).toBeNull();
    await expect(settlement(BREAD, 'BOUGHT', 1)).rejects.toThrow(/applied/);
  });

  it('refuses applied above quantity or below zero', async () => {
    for (const applied of [2, -1]) {
      await expect(
        probe.query(
          `INSERT INTO "line_settlements"
             ("lineId", "listId", "outcome", "quantity", "applied",
              "settledByParticipantId", "settledAt", "basketId")
           VALUES ($1, $2, 'BOUGHT', 1, $3, $4, now(), $5)`,
          [BREAD, LIST, applied, PARTICIPANT, BASKET]
        )
      ).rejects.toThrow(/ck_line_settlements_applied/);
    }
  });

  it('goes down and up again over a table that holds rows', async () => {
    await probe.undoLastMigration({ transaction: 'each' });
    const columns = (await probe.query(
      `SELECT column_name AS "name" FROM information_schema.columns
       WHERE table_name = 'line_settlements' AND column_name = 'applied'`
    )) as unknown[];
    expect(columns).toEqual([]);
    expect(await oldNumbers()).toEqual(before);

    await probe.runMigrations({ transaction: 'each' });
    expect(await columnDefault()).toBeNull();
    const [count] = (await probe.query(
      `SELECT COUNT(*)::int AS "n" FROM "line_settlements"
       WHERE "applied" = "quantity"`
    )) as { n: number }[];
    expect(count.n).toBe(4);
  });
});
