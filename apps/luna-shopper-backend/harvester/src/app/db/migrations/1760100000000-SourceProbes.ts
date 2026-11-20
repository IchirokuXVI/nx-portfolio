import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A probe per chain checks the storefront shape (plan 0219, section 4).
 *
 * Additive: a new type and a new table. `trigger` reuses
 * `harvest_run_trigger`, and a probe is only ever `MANUAL` or `SCHEDULED`.
 *
 * - `ix_source_probes_source_started` serves the newest probe of each source,
 *   which the source list reads with one `DISTINCT ON`, and the due test of
 *   the worker.
 * - `attempt` counts the probes of one `UNREACHABLE` series, 1 to 3. A manual
 *   probe and one the interval made due are attempt 1 (the owner decided the
 *   retry on 2026-11-06).
 * - `uq_source_probe_running` allows one `RUNNING` probe per source. It is the
 *   backstop for a manual start racing the worker.
 *
 * `sourceId` has **no foreign key**, as `harvest_runs.sourceId` has none.
 */
export class SourceProbes1760100000000 implements MigrationInterface {
  name = 'SourceProbes1760100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "source_probe_status" AS ENUM (
        'RUNNING', 'PASSED', 'SHAPE_CHANGED', 'BLOCKED', 'UNREACHABLE', 'ERROR', 'ABORTED'
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "source_probes" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        "sourceId" uuid NOT NULL,
        "supermarketId" uuid NOT NULL,
        "adapterKey" varchar NOT NULL,
        "trigger" "harvest_run_trigger" NOT NULL,
        "status" "source_probe_status" NOT NULL DEFAULT 'RUNNING',
        "previousStatus" "source_probe_status",
        "changed" boolean NOT NULL DEFAULT false,
        "attempt" smallint NOT NULL DEFAULT 1,
        "startedAt" timestamptz NOT NULL,
        "finishedAt" timestamptz,
        "requests" integer NOT NULL DEFAULT 0,
        "steps" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "error" text,
        "requestedByUserId" uuid,
        CONSTRAINT "pk_source_probes" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "ix_source_probes_source_started" ON "source_probes" ("sourceId", "startedAt" DESC)`
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_source_probe_running" ON "source_probes" ("sourceId") WHERE "status" = 'RUNNING'`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "uq_source_probe_running"`);
    await queryRunner.query(`DROP INDEX "ix_source_probes_source_started"`);
    await queryRunner.query(`DROP TABLE "source_probes"`);
    await queryRunner.query(`DROP TYPE "source_probe_status"`);
  }
}
