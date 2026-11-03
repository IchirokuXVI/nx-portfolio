import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Why a `FAILED` run stopped before its work was done (plan 0215, section 9).
 *
 * Additive: one new type and one nullable column on `harvest_runs` that every
 * existing run leaves null. A run the guard stopped before this plan does not
 * exist, so nothing is filled in.
 *
 * `down` drops the column and then the type, in that order, because the type
 * cannot go while a column still uses it.
 */
export class RunStopReason1759500000000 implements MigrationInterface {
  name = 'RunStopReason1759500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "harvest_run_stop_reason" AS ENUM ('SOURCE_BLOCKED')`
    );
    await queryRunner.query(
      `ALTER TABLE "harvest_runs" ADD COLUMN "stopReason" "harvest_run_stop_reason"`
    );
    await queryRunner.query(`
      COMMENT ON COLUMN "harvest_runs"."stopReason" IS
        'Why a FAILED run stopped before its work was done (plan 0215). Null for every other run.'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "harvest_runs" DROP COLUMN IF EXISTS "stopReason"`
    );
    await queryRunner.query(`DROP TYPE IF EXISTS "harvest_run_stop_reason"`);
  }
}
