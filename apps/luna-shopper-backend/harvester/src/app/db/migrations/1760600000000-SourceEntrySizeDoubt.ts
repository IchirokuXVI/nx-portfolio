import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A size its own unit price disproves, recorded on the row (plan 0249, D1).
 *
 * Three nullable columns, so the queue can filter on a doubt and a person
 * sees the size the chain itself is pricing beside the size it printed:
 * `sizeDoubtImplied` in base units, `sizeDoubtRatio`, and the run whose
 * observation recorded it.
 *
 * **The check holds the three together**: a doubt is the implied size, its
 * ratio and its run, or nothing. The ingest writes and clears them as one.
 *
 * **Nothing is backfilled.** The check needs the row's prices and labels,
 * which the next run reads anyway, so every row starts with no doubt and the
 * first walk of each chain records them.
 */
export class SourceEntrySizeDoubt1760600000000 implements MigrationInterface {
  name = 'SourceEntrySizeDoubt1760600000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "source_catalog_entries"
         ADD COLUMN IF NOT EXISTS "sizeDoubtImplied" numeric(14,4),
         ADD COLUMN IF NOT EXISTS "sizeDoubtRatio" numeric,
         ADD COLUMN IF NOT EXISTS "sizeDoubtRunId" uuid`
    );
    await queryRunner.query(
      `ALTER TABLE "source_catalog_entries"
         ADD CONSTRAINT "chk_source_catalog_entries_size_doubt"
         CHECK (("sizeDoubtImplied" IS NULL) = ("sizeDoubtRatio" IS NULL)
                AND ("sizeDoubtRatio" IS NULL) = ("sizeDoubtRunId" IS NULL))`
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "source_catalog_entries"
         DROP CONSTRAINT IF EXISTS "chk_source_catalog_entries_size_doubt"`
    );
    await queryRunner.query(
      `ALTER TABLE "source_catalog_entries"
         DROP COLUMN IF EXISTS "sizeDoubtRunId",
         DROP COLUMN IF EXISTS "sizeDoubtRatio",
         DROP COLUMN IF EXISTS "sizeDoubtImplied"`
    );
  }
}
