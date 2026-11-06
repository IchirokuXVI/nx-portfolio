import {
  HarvestAlertKind,
  HarvestAlertStatus,
  HarvestRunMode,
  HarvestRunStatus,
  HarvestRunTrigger,
  HarvestScheduleOutcome,
  PostalCodeDiscoveryStatus,
} from '@portfolio/luna-shopper/contracts';
import {
  describeIntegration,
  requiredEnv,
} from '@portfolio/luna-shopper/test-fixtures/jest';
import { DataSource } from 'typeorm';
import {
  HARVESTER_ENTITIES,
  HarvestAlert,
  HarvestRun,
  HarvestSchedule,
  PostalCodeDiscoveryRequest,
} from '../../entities';
import { HarvestRunStore } from '../harvest-run.store';
import { HarvestScheduleStore } from '../harvest-schedule.store';
import { PostalCodeDiscoveryStore } from '../postal-code-discovery.store';
import type { HarvestAlertDraft } from './harvest-alert.rules';
import { HarvestAlertStore } from './harvest-alert.store';

/**
 * The alert outbox against real Postgres (plan 0218, section 4 and the
 * Tests section).
 *
 * What a fake cannot say:
 *
 * - the migration creates the table, its two types, the unique key and the
 *   index the worker reads;
 * - **an alert is written in the transaction of its outcome**: the run's
 *   status, the slot's outcome and the postal code's last failure commit
 *   with their row, and an insert that fails rolls the status back;
 * - two inserts with one key leave one row;
 * - two processes on one database claim disjoint rows;
 * - the sweep deletes a final row of 91 days and keeps one of 89.
 *
 *   bash k8s/e2e/luna-shopper-backend/luna-slot.sh --ephemeral --up 6 --services harvester
 *   LUNA_INTEGRATION=1 HARVESTER_DB_URL=postgres://luna_harvester:luna_harvester@localhost:<port>/luna_harvester \
 *     npx nx run luna-shopper-backend-harvester:test-integration
 */
describeIntegration('harvest alerts (real Postgres)', () => {
  const PREFIX = 'it-0218:';
  const CHAIN = '02180218-0000-4000-8000-111111111111';
  const ADMIN = '02180218-0000-4000-8000-aaaaaaaaaaaa';

  let one: DataSource;
  let two: DataSource;
  let alertsOne: HarvestAlertStore;
  let alertsTwo: HarvestAlertStore;
  let runs: HarvestRunStore;

  const open = async (): Promise<DataSource> => {
    const dataSource = new DataSource({
      type: 'postgres',
      url: requiredEnv('HARVESTER_DB_URL'),
      entities: HARVESTER_ENTITIES,
      synchronize: false,
    });
    await dataSource.initialize();
    return dataSource;
  };

  const draft = (key: string, over: Partial<HarvestAlertDraft> = {}) =>
    ({
      kind: HarvestAlertKind.RUN_FAILED,
      dedupeKey: `${PREFIX}${key}`,
      supermarketId: CHAIN,
      runId: null,
      scheduleId: null,
      payload: { error: 'boom' },
      ...over,
    }) as HarvestAlertDraft;

  const alertsByKey = (key: string): Promise<HarvestAlert[]> =>
    one.query(`SELECT * FROM "harvest_alerts" WHERE "dedupeKey" = $1`, [
      `${PREFIX}${key}`,
    ]);

  async function clean(): Promise<void> {
    await one.query(
      `DELETE FROM "harvest_alerts" WHERE "dedupeKey" LIKE $1
          OR "supermarketId" = $2`,
      [`${PREFIX}%`, CHAIN]
    );
    await one.query(
      `DELETE FROM "harvest_runs" WHERE "correlationId" = 'plan-0218'`
    );
    await one.query(
      `DELETE FROM "harvest_schedules" WHERE "supermarketId" = $1`,
      [CHAIN]
    );
    await one.query(
      `DELETE FROM "postal_code_discovery_requests" WHERE "postalCode" = '02180'`
    );
  }

  async function runningRun(): Promise<HarvestRun> {
    const run = await runs.create({
      mode: HarvestRunMode.CATALOG_DISCOVERY,
      trigger: HarvestRunTrigger.MANUAL,
      supermarketId: CHAIN,
      sourceId: null,
      priceScopeId: null,
      requestedByUserId: ADMIN,
      correlationId: 'plan-0218',
      payload: {},
    });
    await runs.markRunning(run.id, 'START', 'Starting');
    return run;
  }

  beforeAll(async () => {
    one = await open();
    two = await open();
    alertsOne = new HarvestAlertStore(one.getRepository(HarvestAlert));
    alertsTwo = new HarvestAlertStore(two.getRepository(HarvestAlert));
    runs = new HarvestRunStore(one.getRepository(HarvestRun));
    await clean();
  }, 60_000);

  afterEach(async () => {
    await clean();
  });

  afterAll(async () => {
    if (one?.isInitialized) {
      await clean();
      await one.destroy();
    }
    if (two?.isInitialized) {
      await two.destroy();
    }
  });

  it('has the table, its two types, the unique key and the due index', async () => {
    const types: { typname: string }[] = await one.query(
      `SELECT typname FROM pg_type
        WHERE typname IN ('harvest_alert_kind', 'harvest_alert_status')
        ORDER BY typname`
    );
    expect(types.map((row) => row.typname)).toEqual([
      'harvest_alert_kind',
      'harvest_alert_status',
    ]);
    const kinds: { value: string }[] = await one.query(
      `SELECT unnest(enum_range(NULL::"harvest_alert_kind"))::text AS "value"`
    );
    expect(kinds.map((row) => row.value).sort()).toEqual(
      Object.values(HarvestAlertKind).sort()
    );
    const indexes: { indexname: string; indexdef: string }[] = await one.query(
      `SELECT indexname, indexdef FROM pg_indexes
        WHERE tablename = 'harvest_alerts' ORDER BY indexname`
    );
    const byName = new Map(indexes.map((row) => [row.indexname, row.indexdef]));
    expect(byName.get('uq_harvest_alerts_dedupe_key')).toMatch(
      /CREATE UNIQUE INDEX .* \("dedupeKey"\)/
    );
    expect(byName.get('ix_harvest_alerts_due')).toMatch(
      /\(status, "nextAttemptAt"\)/
    );
  });

  it('writes the status and the alert of a run in one transaction', async () => {
    const run = await runningRun();

    await runs.finish(
      run.id,
      HarvestRunStatus.FAILED,
      'over the ratio',
      undefined,
      draft('run-commits', { runId: run.id })
    );

    expect((await runs.load(run.id)).status).toBe(HarvestRunStatus.FAILED);
    const [row] = await alertsByKey('run-commits');
    expect(row).toMatchObject({
      kind: HarvestAlertKind.RUN_FAILED,
      status: HarvestAlertStatus.PENDING,
      runId: run.id,
      attempts: 0,
      payload: { error: 'boom' },
    });
  });

  it('rolls the status back when the alert insert fails', async () => {
    const run = await runningRun();

    await expect(
      runs.finish(
        run.id,
        HarvestRunStatus.FAILED,
        'over the ratio',
        undefined,
        draft('run-rolls-back', {
          runId: run.id,
          kind: 'NOT_A_KIND' as HarvestAlertKind,
        })
      )
    ).rejects.toThrow();

    expect((await runs.load(run.id)).status).toBe(HarvestRunStatus.RUNNING);
    expect(await alertsByKey('run-rolls-back')).toHaveLength(0);
  });

  it('writes one RUN_STALE alert for a reaped run, and none more when its process finishes it later', async () => {
    const run = await runningRun();
    await one.query(
      `UPDATE "harvest_runs" SET "heartbeatAt" = now() - interval '1 hour'
        WHERE "id" = $1`,
      [run.id]
    );

    await runs.reapStale(900);

    expect((await runs.load(run.id)).status).toBe(HarvestRunStatus.STALE);
    const staleRows = (): Promise<HarvestAlert[]> =>
      one.query(`SELECT * FROM "harvest_alerts" WHERE "dedupeKey" = $1`, [
        `run:${run.id}`,
      ]);
    const [row, ...more] = await staleRows();
    expect(more).toHaveLength(0);
    expect(row).toMatchObject({
      kind: HarvestAlertKind.RUN_STALE,
      runId: run.id,
    });
    expect(row.payload.staleAfterSeconds).toBe(900);

    await runs.finish(
      run.id,
      HarvestRunStatus.FAILED,
      'finished after the reaper',
      undefined,
      {
        kind: HarvestAlertKind.RUN_FAILED,
        dedupeKey: `run:${run.id}`,
        supermarketId: CHAIN,
        runId: run.id,
        scheduleId: null,
        payload: { error: 'late' },
      } as HarvestAlertDraft
    );

    const after = await staleRows();
    expect(after).toHaveLength(1);
    expect(after[0].kind).toBe(HarvestAlertKind.RUN_STALE);
  });

  it('leaves one row for two inserts with one key', async () => {
    const first = await alertsOne.queue(draft('twice'));
    const second = await alertsTwo.queue(draft('twice', { payload: { n: 2 } }));

    expect(first).not.toBeNull();
    expect(second).toBeNull();
    const rows = await alertsByKey('twice');
    expect(rows).toHaveLength(1);
    expect(rows[0].payload).toEqual({ error: 'boom' });
  });

  it('writes the outcome of a slot and its alert together', async () => {
    const schedules = new HarvestScheduleStore(
      one.getRepository(HarvestSchedule)
    );
    const [schedule]: { id: string }[] = await one.query(
      `INSERT INTO "harvest_schedules"
         ("presetId", "supermarketId", "timeOfDay", "daysOfWeek", "timezone",
          "enabled", "nextRunAt", "createdByUserId", "updatedByUserId")
       VALUES (gen_random_uuid(), $1, '03:00', '{1}', 'UTC', true, now(), $2, $2)
       RETURNING "id"`,
      [CHAIN, ADMIN]
    );

    await schedules.recordOutcome(
      schedule.id,
      {
        outcome: HarvestScheduleOutcome.REFUSED,
        note: 'That source is disabled.',
        at: new Date(),
        runId: null,
        attempts: null,
      },
      draft('slot', {
        kind: HarvestAlertKind.SLOT_REFUSED,
        scheduleId: schedule.id,
      })
    );

    const [row]: { lastOutcome: string }[] = await one.query(
      `SELECT "lastOutcome" FROM "harvest_schedules" WHERE "id" = $1`,
      [schedule.id]
    );
    expect(row.lastOutcome).toBe(HarvestScheduleOutcome.REFUSED);
    expect(await alertsByKey('slot')).toHaveLength(1);
    // The one count the executor reads for the failure that reaches three.
    expect(await runs.countEnabledSchedules(CHAIN)).toBe(1);
  });

  it('writes the FAILED row of a postal code and its alert together, and no alert for an earlier attempt', async () => {
    const queue = new PostalCodeDiscoveryStore(
      one.getRepository(PostalCodeDiscoveryRequest)
    );
    const [request]: PostalCodeDiscoveryRequest[] = await one.query(
      `INSERT INTO "postal_code_discovery_requests"
         ("country", "postalCode", "status", "requestedAt", "attempts")
       VALUES ('es', '02180', 'RUNNING', now(), 2)
       RETURNING *`
    );

    await queue.markAttemptFailed(
      request,
      'Overpass timed out',
      3,
      null,
      draft('code-early', { kind: HarvestAlertKind.POSTAL_CODE_FAILED })
    );
    expect(await alertsByKey('code-early')).toHaveLength(0);

    await queue.markAttemptFailed(
      { ...request, attempts: 3 },
      'Overpass timed out',
      3,
      null,
      draft('code-final', { kind: HarvestAlertKind.POSTAL_CODE_FAILED })
    );
    const [row]: { status: string }[] = await one.query(
      `SELECT "status" FROM "postal_code_discovery_requests" WHERE "id" = $1`,
      [request.id]
    );
    expect(row.status).toBe(PostalCodeDiscoveryStatus.FAILED);
    expect(await alertsByKey('code-final')).toHaveLength(1);
  });

  it('gives two processes disjoint rows when they claim at once', async () => {
    for (let n = 0; n < 12; n += 1) {
      await alertsOne.queue(draft(`claim-${n}`));
    }
    const now = new Date(Date.now() + 1000);

    const [a, b] = await Promise.all([
      alertsOne.claim(now, 50),
      alertsTwo.claim(now, 50),
    ]);

    const mine = (rows: HarvestAlert[]) =>
      rows.filter((row) => row.dedupeKey.startsWith(`${PREFIX}claim-`));
    const ids = [...mine(a), ...mine(b)].map((row) => row.id);
    expect(ids).toHaveLength(12);
    expect(new Set(ids).size).toBe(12);
  });

  it('puts back a row claimed more than 10 minutes ago, and keeps a younger one', async () => {
    const old = await alertsOne.queue(draft('stuck-old'));
    const young = await alertsOne.queue(draft('stuck-young'));
    await one.query(
      `UPDATE "harvest_alerts" SET "status" = 'SENDING', "claimedAt" = now() - $2::interval
        WHERE "id" = $1`,
      [old?.id, '11 minutes']
    );
    await one.query(
      `UPDATE "harvest_alerts" SET "status" = 'SENDING', "claimedAt" = now() - $2::interval
        WHERE "id" = $1`,
      [young?.id, '9 minutes']
    );

    await alertsOne.releaseStuck(new Date(Date.now() - 10 * 60_000));

    expect((await alertsByKey('stuck-old'))[0].status).toBe(
      HarvestAlertStatus.PENDING
    );
    expect((await alertsByKey('stuck-young'))[0].status).toBe(
      HarvestAlertStatus.SENDING
    );
  });

  it('marks a sent row, a failed send and a row that gave up', async () => {
    const sent = await alertsOne.queue(draft('sent'));
    const failed = await alertsOne.queue(draft('failed'));
    const gaveUp = await alertsOne.queue(draft('gave-up'));
    const at = new Date();
    const next = new Date(at.getTime() + 60_000);

    await alertsOne.markSent([sent?.id as string], at);
    await alertsOne.markFailed(failed?.id as string, 1, '421 busy', next);
    await alertsOne.markFailed(gaveUp?.id as string, 6, '421 busy', null);

    expect((await alertsByKey('sent'))[0]).toMatchObject({
      status: HarvestAlertStatus.SENT,
    });
    expect((await alertsByKey('failed'))[0]).toMatchObject({
      status: HarvestAlertStatus.PENDING,
      attempts: 1,
      lastError: '421 busy',
      nextAttemptAt: next,
    });
    expect((await alertsByKey('gave-up'))[0]).toMatchObject({
      status: HarvestAlertStatus.GAVE_UP,
      attempts: 6,
    });
  });

  it('deletes a final row of 91 days and keeps one of 89 and an old pending one', async () => {
    const old = await alertsOne.queue(draft('sweep-91'));
    const kept = await alertsOne.queue(draft('sweep-89'));
    const pending = await alertsOne.queue(draft('sweep-pending'));
    await one.query(
      `UPDATE "harvest_alerts" SET "status" = 'SENT', "createdAt" = now() - interval '91 days'
        WHERE "id" = $1`,
      [old?.id]
    );
    await one.query(
      `UPDATE "harvest_alerts" SET "status" = 'SENT', "createdAt" = now() - interval '89 days'
        WHERE "id" = $1`,
      [kept?.id]
    );
    await one.query(
      `UPDATE "harvest_alerts" SET "createdAt" = now() - interval '91 days'
        WHERE "id" = $1`,
      [pending?.id]
    );

    const deleted = await alertsOne.deleteFinishedBefore(
      new Date(Date.now() - 90 * 24 * 60 * 60_000)
    );

    expect(deleted).toBeGreaterThanOrEqual(1);
    expect(await alertsByKey('sweep-91')).toHaveLength(0);
    expect(await alertsByKey('sweep-89')).toHaveLength(1);
    expect(await alertsByKey('sweep-pending')).toHaveLength(1);
  });
});
