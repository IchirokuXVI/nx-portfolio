import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A probe gates a scheduled run (plan 0247, sections 3 and 4).
 *
 * Additive: two Postgres enum types gain labels, `source_probes` gains a
 * nullable column, and no row changes.
 *
 * - `harvest_schedule_outcome` gains `SKIPPED_PROBE_FAILED`, the slot whose
 *   probe did not pass.
 * - `harvest_alert_kind` gains `PROBE_FAILED` and `SLOT_PROBE_FAILED`.
 * - `source_probes.scheduleId` names the schedule whose slot ran a probe as
 *   its gate, and is null for a daily or a manual probe (the owner,
 *   2026-11-06). A gate probe and a daily probe both carry trigger
 *   `SCHEDULED`, and a new trigger value would also become a legal run
 *   trigger, because the column reuses `harvest_run_trigger`. The column has
 *   **no foreign key**: deleting a schedule must not delete the probes it
 *   ran, which stay the history of the chain.
 *
 * **Each type is rebuilt** by rename, create and convert, as `SharedEan` and
 * `OneSourceProduct` do, rather than with `ALTER TYPE ... ADD VALUE`.
 * `harvester/src/migrate.ts` runs every pending migration in one
 * transaction, and Postgres refuses to use a label that `ADD VALUE` added
 * before that transaction commits. Nothing here uses the new labels, but a
 * later migration of the same deploy could, and the rebuild leaves no such
 * trap. Neither column has a default, an index or a check that names a label,
 * so the conversion through text is all a rebuild needs.
 */
export class ProbeGate1760400000000 implements MigrationInterface {
  name = 'ProbeGate1760400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await rebuildType(queryRunner, OUTCOME, [
      ...OUTCOME_LABELS,
      'SKIPPED_PROBE_FAILED',
    ]);
    await rebuildType(queryRunner, ALERT_KIND, [
      ...ALERT_KIND_LABELS,
      'PROBE_FAILED',
      'SLOT_PROBE_FAILED',
    ]);
    await queryRunner.query(
      `ALTER TABLE "source_probes" ADD COLUMN "scheduleId" uuid NULL`
    );
  }

  /**
   * Back to the types before this plan.
   *
   * A slot the gate skipped started nothing, which is what `REFUSED` says of
   * a slot, so such a row becomes `REFUSED` and keeps its note. A
   * `SLOT_PROBE_FAILED` alert becomes `SLOT_REFUSED`, whose mail prints the
   * note. A `PROBE_FAILED` alert has no kind before this plan that could
   * describe it, and a mail of another kind would print a wrong message, so
   * those outbox rows are deleted. They report a probe, not a harvest, and
   * the probe rows themselves stay, without the schedule a gate probe named.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "source_probes" DROP COLUMN "scheduleId"`
    );
    await queryRunner.query(
      `UPDATE "harvest_schedules"
          SET "lastOutcome" = 'REFUSED'
        WHERE "lastOutcome" = 'SKIPPED_PROBE_FAILED'`
    );
    await queryRunner.query(
      `UPDATE "harvest_alerts"
          SET "kind" = 'SLOT_REFUSED'
        WHERE "kind" = 'SLOT_PROBE_FAILED'`
    );
    await queryRunner.query(
      `DELETE FROM "harvest_alerts" WHERE "kind" = 'PROBE_FAILED'`
    );
    await rebuildType(queryRunner, OUTCOME, OUTCOME_LABELS);
    await rebuildType(queryRunner, ALERT_KIND, ALERT_KIND_LABELS);
  }
}

interface EnumColumn {
  type: string;
  table: string;
  column: string;
}

const OUTCOME: EnumColumn = {
  type: 'harvest_schedule_outcome',
  table: 'harvest_schedules',
  column: 'lastOutcome',
};

const ALERT_KIND: EnumColumn = {
  type: 'harvest_alert_kind',
  table: 'harvest_alerts',
  column: 'kind',
};

/** The labels of `harvest_schedule_outcome` before this plan, in their order. */
const OUTCOME_LABELS = [
  'STARTED',
  'SKIPPED_LATE',
  'SKIPPED_FAILING',
  'REFUSED',
  'SKIPPED_BUSY',
] as const;

/** The labels of `harvest_alert_kind` before this plan, in their order. */
const ALERT_KIND_LABELS = [
  'RUN_FAILED',
  'RUN_BLOCKED',
  'RUN_STALE',
  'POSTAL_CODE_FAILED',
  'SLOT_REFUSED',
  'TEST',
] as const;

/**
 * Replace the type of one column with a type holding exactly `labels`. The
 * column converts through text, so every label it holds must be in the list.
 */
async function rebuildType(
  queryRunner: QueryRunner,
  target: EnumColumn,
  labels: readonly string[]
): Promise<void> {
  await queryRunner.query(
    `ALTER TYPE "${target.type}" RENAME TO "${target.type}_old"`
  );
  await queryRunner.query(
    `CREATE TYPE "${target.type}" AS ENUM (${labels
      .map((label) => `'${label}'`)
      .join(', ')})`
  );
  await queryRunner.query(`
    ALTER TABLE "${target.table}"
      ALTER COLUMN "${target.column}" TYPE "${target.type}"
      USING "${target.column}"::text::"${target.type}"
  `);
  await queryRunner.query(`DROP TYPE "${target.type}_old"`);
}
