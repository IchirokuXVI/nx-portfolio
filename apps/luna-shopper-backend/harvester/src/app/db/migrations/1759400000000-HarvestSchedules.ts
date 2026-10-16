import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A preset that starts by itself, and the run that remembers which schedule
 * started it (plan 0206, sections 2 and 9).
 *
 * Additive: a new type, a new table, and one nullable column on `harvest_runs`
 * that every existing run leaves null, because no schedule started one.
 *
 * **`supermarket_sources.consecutiveFailures` is not reset here.** Until this
 * plan an abort added one to it, so a chain can start at three or more and be
 * skipped as failing from its first slot. The schedule then says
 * `SOURCE_FAILING` before the slot arrives, and the first run a person starts
 * that completes sets the counter to 0. A data write in an additive migration
 * would hide that a counter was ever wrong.
 *
 * `presetId`, `lastRunId` and `scheduleId` have **no foreign key**, for the
 * reason `harvest_runs.presetId` has none.
 */
export class HarvestSchedules1759400000000 implements MigrationInterface {
  name = 'HarvestSchedules1759400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "harvest_schedule_outcome" AS ENUM (
        'STARTED', 'SKIPPED_LATE', 'SKIPPED_FAILING', 'REFUSED', 'SKIPPED_BUSY'
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "harvest_schedules" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        "presetId" uuid NOT NULL,
        "supermarketId" uuid NOT NULL,
        "timeOfDay" varchar(5) NOT NULL,
        "daysOfWeek" smallint[] NOT NULL,
        "timezone" varchar(64) NOT NULL DEFAULT 'Europe/Madrid',
        "enabled" boolean NOT NULL DEFAULT true,
        "nextRunAt" timestamptz,
        "lastSlotAt" timestamptz,
        "lastSlotAttempts" smallint NOT NULL DEFAULT 0,
        "lastRunId" uuid,
        "lastOutcome" "harvest_schedule_outcome",
        "lastOutcomeAt" timestamptz,
        "lastOutcomeNote" text,
        "createdByUserId" uuid NOT NULL,
        "updatedByUserId" uuid NOT NULL,
        CONSTRAINT "pk_harvest_schedules" PRIMARY KEY ("id"),
        CONSTRAINT "ck_harvest_schedules_time_of_day"
          CHECK ("timeOfDay" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
        CONSTRAINT "ck_harvest_schedules_days_of_week"
          CHECK (
            cardinality("daysOfWeek") BETWEEN 1 AND 7
            AND "daysOfWeek" <@ ARRAY[1, 2, 3, 4, 5, 6, 7]::smallint[]
          ),
        CONSTRAINT "ck_harvest_schedules_attempts"
          CHECK ("lastSlotAttempts" BETWEEN 0 AND 2),
        CONSTRAINT "ck_harvest_schedules_off_has_no_slot"
          CHECK ("enabled" OR "nextRunAt" IS NULL)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "ix_harvest_schedules_preset" ON "harvest_schedules" ("presetId")`
    );
    await queryRunner.query(
      `CREATE INDEX "ix_harvest_schedules_supermarket" ON "harvest_schedules" ("supermarketId")`
    );
    // What the worker reads every minute: the due rows of the schedules that
    // are on.
    await queryRunner.query(
      `CREATE INDEX "ix_harvest_schedules_next_run" ON "harvest_schedules" ("nextRunAt") WHERE "enabled"`
    );
    await queryRunner.query(
      `ALTER TABLE "harvest_runs" ADD COLUMN "scheduleId" uuid`
    );
    await queryRunner.query(
      `CREATE INDEX "ix_harvest_runs_schedule" ON "harvest_runs" ("scheduleId")`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "ix_harvest_runs_schedule"`);
    await queryRunner.query(
      `ALTER TABLE "harvest_runs" DROP COLUMN "scheduleId"`
    );
    await queryRunner.query(`DROP TABLE "harvest_schedules"`);
    await queryRunner.query(`DROP TYPE "harvest_schedule_outcome"`);
  }
}
