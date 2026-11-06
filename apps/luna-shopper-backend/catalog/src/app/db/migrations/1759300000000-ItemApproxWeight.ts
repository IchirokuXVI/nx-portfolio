import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The approximate weight of a piece (plan 0244, section 3.1).
 *
 * - `approxWeight`: the weight of one piece in grams, when the chain says it
 *   varies. A product has it or a `unitSize`, never both.
 * - `approxWeightSetBy`: who wrote it. `SOURCE` is a run, and the next run may
 *   change it. `ADMIN` is a person, and no run changes it.
 *
 * Two checks restate the rule: a weight sits only beside no size and is above
 * zero, and a weight always names its writer. Both columns are nullable and
 * start null, so every existing product passes both checks and the migration
 * writes no row. The products that production holds today are corrected by
 * release task 0006, not here.
 *
 * `down` drops the checks and then the columns.
 */
export class ItemApproxWeight1759300000000 implements MigrationInterface {
  name = 'ItemApproxWeight1759300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "items" ADD COLUMN "approxWeight" numeric(12,4) NULL`
    );
    await queryRunner.query(
      `ALTER TABLE "items" ADD COLUMN "approxWeightSetBy" varchar(16) NULL`
    );
    await queryRunner.query(
      `ALTER TABLE "items" ADD CONSTRAINT "item_approx_weight_beside_no_size"
         CHECK ("approxWeight" IS NULL OR ("unitSize" IS NULL AND "approxWeight" > 0))`
    );
    await queryRunner.query(
      `ALTER TABLE "items" ADD CONSTRAINT "item_approx_weight_has_a_writer"
         CHECK (("approxWeight" IS NULL) = ("approxWeightSetBy" IS NULL))`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "items" DROP CONSTRAINT "item_approx_weight_has_a_writer"`
    );
    await queryRunner.query(
      `ALTER TABLE "items" DROP CONSTRAINT "item_approx_weight_beside_no_size"`
    );
    await queryRunner.query(
      `ALTER TABLE "items" DROP COLUMN "approxWeightSetBy"`
    );
    await queryRunner.query(`ALTER TABLE "items" DROP COLUMN "approxWeight"`);
  }
}
