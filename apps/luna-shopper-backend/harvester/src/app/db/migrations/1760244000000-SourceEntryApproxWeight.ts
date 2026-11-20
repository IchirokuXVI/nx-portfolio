import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The approximate weight of one piece, as the source printed it (plan 0244,
 * section 5.5).
 *
 * It belongs to the source group of the row, beside `soldByWeight`: every run
 * that states it rewrites it, and a decision never touches it. It is grams,
 * at the precision of `unitSize`.
 *
 * **The check holds the rule the plan states for the column:** a row with a
 * size has no weight, and a weight is above zero. Every write path already
 * keeps it (the ingest clears the weight beside a size, and a weight clears
 * the size of a partial read), so the check costs nothing and makes a row
 * that says both a write error rather than a quiet contradiction. Every row
 * that exists before this migration holds a null weight, which passes.
 *
 * **Nothing is backfilled.** The weight is a field of the source's payload,
 * and none of it is stored on the row. The next run fills it, and release
 * task 0006 writes the rows the plan names.
 */
export class SourceEntryApproxWeight1760244000000 implements MigrationInterface {
  name = 'SourceEntryApproxWeight1760244000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "source_catalog_entries"
         ADD COLUMN IF NOT EXISTS "approxWeight" numeric(12,4)`
    );
    await queryRunner.query(
      `ALTER TABLE "source_catalog_entries"
         ADD CONSTRAINT "chk_source_catalog_entries_approx_weight"
         CHECK ("approxWeight" IS NULL
                OR ("approxWeight" > 0 AND "unitSize" IS NULL))`
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "source_catalog_entries"
         DROP CONSTRAINT IF EXISTS "chk_source_catalog_entries_approx_weight"`
    );
    await queryRunner.query(
      `ALTER TABLE "source_catalog_entries"
         DROP COLUMN IF EXISTS "approxWeight"`
    );
  }
}
