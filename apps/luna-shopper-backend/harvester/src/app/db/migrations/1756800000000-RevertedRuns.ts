import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A reverted run leaves nothing behind (plan 0082).
 *
 * Two columns, and only two, because `revertedAt` is already here: plan 0081
 * added it nullable and unwritten so its per document dedupe index could name
 * it, and this plan is what fills it. What is added is who reverted and how
 * many price rows went, so the run page can say afterwards what the operation
 * actually did rather than repeating the estimate the confirmation offered.
 *
 * **No status is added and none is changed.** The status says how the run
 * ended, and reverting it does not change that. A reverted run is still the
 * COMPLETED or FAILED run it was, and the runs list draws a second chip beside
 * the first rather than replacing it.
 *
 * A partial index on `revertedAt`, because the runs list filters on it and
 * almost no run is reverted: the rows that answer the filter are the small side
 * of a very lopsided split, and a row that was never reverted is never scanned.
 */
export class RevertedRuns1756800000000 implements MigrationInterface {
  name = 'RevertedRuns1756800000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "harvest_runs" ADD "revertedByUserId" uuid`
    );
    await queryRunner.query(
      `ALTER TABLE "harvest_runs" ADD "revertedPriceCount" integer`
    );
    await queryRunner.query(`
      COMMENT ON COLUMN "harvest_runs"."revertedAt" IS
        'When this run writes were taken back (plan 0082). The status is untouched: it says how the run ended, and that did not change.'
    `);
    await queryRunner.query(`
      COMMENT ON COLUMN "harvest_runs"."revertedPriceCount" IS
        'How many item_prices rows the revert deleted, including those an alias accept wrote on the run behalf. Rows the run only confirmed were reset rather than deleted and are not counted here.'
    `);
    await queryRunner.query(`
      CREATE INDEX "ix_harvest_runs_reverted"
        ON "harvest_runs" ("revertedAt")
        WHERE "revertedAt" IS NOT NULL
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "ix_harvest_runs_reverted"`);
    await queryRunner.query(
      `ALTER TABLE "harvest_runs" DROP COLUMN IF EXISTS "revertedPriceCount"`
    );
    await queryRunner.query(
      `ALTER TABLE "harvest_runs" DROP COLUMN IF EXISTS "revertedByUserId"`
    );
  }
}
