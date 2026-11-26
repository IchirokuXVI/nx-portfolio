import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Which run last replaced the category paths of a source row whole (164a,
 * owner decision of 2026-11-26).
 *
 * One nullable `uuid` column on `source_catalog_entries`. The write of the
 * paths at the end of a run sets it to the run's id when the run states the
 * paths with `REPLACE`, and an `ADD` leaves it alone. The export of a run
 * reads it to say that a row's paths are complete.
 *
 * It adds the column and deletes and rewrites no row. No backfill: which run
 * replaced a row's paths before the column existed is not known, and naming
 * one would claim it. Every row reads null until the next walk of its chain
 * that reads its paths whole. No index: the export reads the column only on
 * rows it already selected by `lastRunId`.
 *
 * `down` drops the column, which loses only what later runs wrote.
 */
export class SourceEntryCategoryPathsReplacedBy1760760000000 implements MigrationInterface {
  name = 'SourceEntryCategoryPathsReplacedBy1760760000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "source_catalog_entries"
         ADD COLUMN "categoryPathsReplacedByRunId" uuid`
    );
    await queryRunner.query(`
      COMMENT ON COLUMN "source_catalog_entries"."categoryPathsReplacedByRunId" IS
        'The run whose REPLACE write last stated categoryPaths whole. Null for a row no such write reached, and for every row stored before the column.'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "source_catalog_entries"
         DROP COLUMN IF EXISTS "categoryPathsReplacedByRunId"`
    );
  }
}
