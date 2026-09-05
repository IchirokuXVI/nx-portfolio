import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `harvest_runs.report`: what a run has to say about itself beyond its counters
 * (plan 0085, section 3).
 *
 * A run had two ways to speak: the counters, which say how much, and `error`,
 * which is why it failed. Neither fits "this one finished, and here is what it
 * could not reach". DEZA answers at most 300 rows to any query, so a run splits
 * a capped section by search term until a pass adds nothing new or a budget of
 * 25 queries runs out, and **completeness cannot be proven against that source
 * at all**: there is no total to check against. The honest artifact is the list
 * of sections the budget could not finish, and it needs somewhere to live that
 * is not an error field.
 *
 * The same column carries the availability rows a person had typed, which plan
 * 0084 section 3 declines to overwrite and requires the run to report instead.
 *
 * Additive, defaulted, and it backfills nothing: a run that finished before this
 * migration made no such remarks and an empty bag says so.
 */
export class HarvestRunReport1756600000000 implements MigrationInterface {
  name = 'HarvestRunReport1756600000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "harvest_runs"
        ADD COLUMN "report" jsonb NOT NULL DEFAULT '{}'::jsonb
    `);
    await queryRunner.query(`
      COMMENT ON COLUMN "harvest_runs"."report" IS
        'Free form remarks a finished run makes about itself: sections a budget could not finish, availability a person had typed and the run declined to overwrite. Not an error, never queried, read once by a person (plan 0085).'
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "harvest_runs" DROP COLUMN IF EXISTS "report"`
    );
  }
}
