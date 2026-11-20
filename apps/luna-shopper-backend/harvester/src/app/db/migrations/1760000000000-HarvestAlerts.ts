import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The outbox of alerts to the owner (plan 0218, section 4).
 *
 * Additive: two new types and a new table. No existing row changes, and no
 * alert is written for anything that happened before it: the first row is the
 * first outcome a deploy with this migration decides.
 *
 * `supermarketId`, `runId` and `scheduleId` have **no foreign key**, for the
 * reason `harvest_runs.presetId` has none.
 */
export class HarvestAlerts1760000000000 implements MigrationInterface {
  name = 'HarvestAlerts1760000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "harvest_alert_kind" AS ENUM (
        'RUN_FAILED', 'RUN_BLOCKED', 'RUN_STALE', 'POSTAL_CODE_FAILED',
        'SLOT_REFUSED', 'TEST'
      )
    `);
    await queryRunner.query(`
      CREATE TYPE "harvest_alert_status" AS ENUM (
        'PENDING', 'SENDING', 'SENT', 'SUPPRESSED', 'GAVE_UP'
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "harvest_alerts" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        "kind" "harvest_alert_kind" NOT NULL,
        "dedupeKey" varchar(200) NOT NULL,
        "status" "harvest_alert_status" NOT NULL DEFAULT 'PENDING',
        "supermarketId" uuid,
        "runId" uuid,
        "scheduleId" uuid,
        "payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "attempts" smallint NOT NULL DEFAULT 0,
        "nextAttemptAt" timestamptz NOT NULL DEFAULT now(),
        "claimedAt" timestamptz,
        "sentAt" timestamptz,
        "lastError" text,
        CONSTRAINT "pk_harvest_alerts" PRIMARY KEY ("id"),
        CONSTRAINT "ck_harvest_alerts_attempts" CHECK ("attempts" >= 0)
      )
    `);
    // What every insert conflicts on: one outcome is one row.
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_harvest_alerts_dedupe_key" ON "harvest_alerts" ("dedupeKey")`
    );
    // What the worker reads every 30 seconds: the due rows of one status.
    await queryRunner.query(
      `CREATE INDEX "ix_harvest_alerts_due" ON "harvest_alerts" ("status", "nextAttemptAt")`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "harvest_alerts"`);
    await queryRunner.query(`DROP TYPE "harvest_alert_status"`);
    await queryRunner.query(`DROP TYPE "harvest_alert_kind"`);
  }
}
