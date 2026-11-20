import {
  describeIntegration,
  requiredEnv,
} from '@portfolio/luna-shopper/test-fixtures/jest';
import { DataSource } from 'typeorm';
import { HARVESTER_MIGRATIONS } from './migrations';
import { ProbeGate1760400000000 } from './migrations/1760400000000-ProbeGate';

/**
 * The labels of the probe gate (plan 0247, sections 3 and 4).
 *
 * - **`up` adds `SKIPPED_PROBE_FAILED` to `harvest_schedule_outcome` and
 *   `PROBE_FAILED` and `SLOT_PROBE_FAILED` to `harvest_alert_kind`**, and an
 *   outcome and an alert of each are writable after it.
 * - **`down` removes them**: a skipped slot becomes `REFUSED` with its note,
 *   a slot alert becomes `SLOT_REFUSED`, a probe alert is deleted, and `up`
 *   brings the labels back.
 * - **`source_probes.scheduleId`** is added as a nullable uuid with no
 *   foreign key, dropped by `down` with its rows kept, and added again.
 *
 * It runs against a probe database of its own, as the `SourceProbes` spec
 * does, so `down` never touches the slot's own schema. Every read is raw SQL.
 *
 *   LUNA_INTEGRATION=1 HARVESTER_DB_URL=postgres://... \
 *     npx nx run luna-shopper-backend-harvester:test-integration
 */
const THROUGH = HARVESTER_MIGRATIONS.slice(
  0,
  HARVESTER_MIGRATIONS.indexOf(ProbeGate1760400000000) + 1
);
const BEFORE = THROUGH.slice(0, -1);

const PROBE_DATABASE = 'luna_harvester_0247_probe';
const CHAIN = '02470247-0000-4000-a000-000000000001';
const ADMIN = '02470247-0000-4000-a000-0000000000aa';

describeIntegration('ProbeGate1760400000000 (real Postgres)', () => {
  let admin: DataSource;
  let probe: DataSource;

  const labels = async (type: string): Promise<string[]> => {
    const rows: { label: string }[] = await probe.query(
      `SELECT e.enumlabel AS "label"
         FROM pg_enum AS e
         JOIN pg_type AS t ON t.oid = e.enumtypid
        WHERE t.typname = $1
        ORDER BY e.enumsortorder`,
      [type]
    );
    return rows.map((row) => row.label);
  };

  const insertSchedule = async (outcome: string): Promise<string> => {
    const [row]: { id: string }[] = await probe.query(
      `INSERT INTO "harvest_schedules"
         ("presetId", "supermarketId", "timeOfDay", "daysOfWeek", "timezone",
          "enabled", "nextRunAt", "lastOutcome", "lastOutcomeNote",
          "createdByUserId", "updatedByUserId")
       VALUES (gen_random_uuid(), $1, '03:00', '{1}', 'UTC', true, now(), $2,
               'probe p-1 BLOCKED: listing: HTTP 403', $3, $3)
       RETURNING "id"`,
      [CHAIN, outcome, ADMIN]
    );
    return row.id;
  };

  /** `source_probes.scheduleId` as the catalog describes it, or null. */
  const scheduleIdColumn = async (): Promise<{
    type: string;
    nullable: string;
  } | null> => {
    const rows: { type: string; nullable: string }[] = await probe.query(
      `SELECT data_type AS "type", is_nullable AS "nullable"
         FROM information_schema.columns
        WHERE table_name = 'source_probes' AND column_name = 'scheduleId'`
    );
    return rows[0] ?? null;
  };

  const insertProbe = async (scheduleId: string | null): Promise<string> => {
    const [row]: { id: string }[] = await probe.query(
      `INSERT INTO "source_probes"
         ("sourceId", "supermarketId", "adapterKey", "trigger", "status",
          "attempt", "startedAt", "finishedAt", "scheduleId")
       VALUES (gen_random_uuid(), $1, 'mercadona-api', 'SCHEDULED', 'PASSED',
               1, now(), now(), $2)
       RETURNING "id"`,
      [CHAIN, scheduleId]
    );
    return row.id;
  };

  const insertAlert = (kind: string, key: string) =>
    probe.query(
      `INSERT INTO "harvest_alerts" ("kind", "dedupeKey", "supermarketId")
       VALUES ($1, $2, $3)`,
      [kind, key, CHAIN]
    );

  beforeAll(async () => {
    const url = new URL(requiredEnv('HARVESTER_DB_URL'));
    admin = new DataSource({ type: 'postgres', url: url.toString() });
    await admin.initialize();
    await admin.query(`DROP DATABASE IF EXISTS "${PROBE_DATABASE}"`);
    await admin.query(`CREATE DATABASE "${PROBE_DATABASE}"`);
    url.pathname = `/${PROBE_DATABASE}`;
    probe = new DataSource({
      type: 'postgres',
      url: url.toString(),
      migrations: THROUGH,
      migrationsTableName: 'migrations',
      synchronize: false,
    });
    await probe.initialize();
    // One transaction for the whole list, as `migrate.ts` runs a deploy.
    await probe.runMigrations({ transaction: 'all' });
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
    expect(Math.max(...stamps)).toBeLessThan(1760400000000);
  });

  it('adds the outcome and the two alert kinds last, and each is writable', async () => {
    expect(await labels('harvest_schedule_outcome')).toEqual([
      'STARTED',
      'SKIPPED_LATE',
      'SKIPPED_FAILING',
      'REFUSED',
      'SKIPPED_BUSY',
      'SKIPPED_PROBE_FAILED',
    ]);
    expect(await labels('harvest_alert_kind')).toEqual([
      'RUN_FAILED',
      'RUN_BLOCKED',
      'RUN_STALE',
      'POSTAL_CODE_FAILED',
      'SLOT_REFUSED',
      'TEST',
      'PROBE_FAILED',
      'SLOT_PROBE_FAILED',
    ]);
    await insertSchedule('SKIPPED_PROBE_FAILED');
    await insertAlert('PROBE_FAILED', 'it-0247:probe');
    await insertAlert('SLOT_PROBE_FAILED', 'it-0247:slot');
    await probe.query(`DELETE FROM "harvest_alerts"`);
    await probe.query(`DELETE FROM "harvest_schedules"`);
  });

  it('adds source_probes.scheduleId as a nullable uuid with no foreign key', async () => {
    expect(await scheduleIdColumn()).toEqual({ type: 'uuid', nullable: 'YES' });
    const foreignKeys: { name: string }[] = await probe.query(
      `SELECT conname AS "name"
         FROM pg_constraint
        WHERE conrelid = '"source_probes"'::regclass AND contype = 'f'`
    );
    expect(foreignKeys).toEqual([]);
    const schedule = '02470247-0000-4000-a000-0000000000cc';
    const gate = await insertProbe(schedule);
    const daily = await insertProbe(null);
    const rows: { id: string; scheduleId: string | null }[] = await probe.query(
      `SELECT "id", "scheduleId" FROM "source_probes" WHERE "id" = ANY($1)`,
      [[gate, daily]]
    );
    expect(
      Object.fromEntries(rows.map((row) => [row.id, row.scheduleId]))
    ).toEqual({ [gate]: schedule, [daily]: null });
    await probe.query(`DELETE FROM "source_probes"`);
  });

  it('goes down to the old labels, moving each row it can and deleting probe alerts, and up again', async () => {
    const skipped = await insertSchedule('SKIPPED_PROBE_FAILED');
    const started = await insertSchedule('STARTED');
    await insertAlert('PROBE_FAILED', 'it-0247:probe');
    await insertAlert('SLOT_PROBE_FAILED', 'it-0247:slot');
    await insertAlert('RUN_FAILED', 'it-0247:run');
    const gateProbe = await insertProbe('02470247-0000-4000-a000-0000000000cc');

    const migration = new ProbeGate1760400000000();
    const runner = probe.createQueryRunner();
    try {
      await migration.down(runner);

      expect(await labels('harvest_schedule_outcome')).not.toContain(
        'SKIPPED_PROBE_FAILED'
      );
      expect(await labels('harvest_alert_kind')).toEqual([
        'RUN_FAILED',
        'RUN_BLOCKED',
        'RUN_STALE',
        'POSTAL_CODE_FAILED',
        'SLOT_REFUSED',
        'TEST',
      ]);
      const schedules: { id: string; lastOutcome: string; note: string }[] =
        await probe.query(
          `SELECT "id", "lastOutcome", "lastOutcomeNote" AS "note"
             FROM "harvest_schedules" ORDER BY "id"`
        );
      expect(
        Object.fromEntries(schedules.map((row) => [row.id, row.lastOutcome]))
      ).toEqual({ [skipped]: 'REFUSED', [started]: 'STARTED' });
      expect(schedules.every((row) => row.note.startsWith('probe p-1'))).toBe(
        true
      );
      const alerts: { dedupeKey: string; kind: string }[] = await probe.query(
        `SELECT "dedupeKey", "kind" FROM "harvest_alerts" ORDER BY "dedupeKey"`
      );
      expect(alerts).toEqual([
        { dedupeKey: 'it-0247:run', kind: 'RUN_FAILED' },
        { dedupeKey: 'it-0247:slot', kind: 'SLOT_REFUSED' },
      ]);
      // The column goes, and the probe row it was on stays.
      expect(await scheduleIdColumn()).toBeNull();
      const kept: { id: string }[] = await probe.query(
        `SELECT "id" FROM "source_probes" WHERE "id" = $1`,
        [gateProbe]
      );
      expect(kept).toEqual([{ id: gateProbe }]);

      await migration.up(runner);
    } finally {
      await runner.release();
    }
    expect(await scheduleIdColumn()).toEqual({ type: 'uuid', nullable: 'YES' });
    const back: { scheduleId: string | null }[] = await probe.query(
      `SELECT "scheduleId" FROM "source_probes" WHERE "id" = $1`,
      [gateProbe]
    );
    expect(back).toEqual([{ scheduleId: null }]);
    expect(await labels('harvest_schedule_outcome')).toContain(
      'SKIPPED_PROBE_FAILED'
    );
    expect(await labels('harvest_alert_kind')).toContain('SLOT_PROBE_FAILED');
    await insertSchedule('SKIPPED_PROBE_FAILED');
  }, 180_000);
});
