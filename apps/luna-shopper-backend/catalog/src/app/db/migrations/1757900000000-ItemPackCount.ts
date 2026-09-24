import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * How many units a product's pack holds (plan 0162, section 2).
 *
 * Nullable, because a product that is not a pack has no count, and every row
 * that exists before this migration has none until a run sees one of its
 * entries again. No backfill: filling a count from anything other than a
 * source's own field is the guess the plan refuses.
 *
 * **The bounds are the contract's**, `PACK_COUNT_MIN` and `PACK_COUNT_MAX`,
 * restated as literals because a migration is frozen at the day it was written.
 * A count of 1 is not a pack and is stored as null, so the check starts at 2.
 */
export class ItemPackCount1757900000000 implements MigrationInterface {
  name = 'ItemPackCount1757900000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "items" ADD COLUMN IF NOT EXISTS "packCount" smallint`
    );
    await queryRunner.query(
      `ALTER TABLE "items" ADD CONSTRAINT "chk_items_pack_count"
         CHECK ("packCount" BETWEEN 2 AND 1000)`
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "items" DROP CONSTRAINT IF EXISTS "chk_items_pack_count"`
    );
    await queryRunner.query(
      `ALTER TABLE "items" DROP COLUMN IF EXISTS "packCount"`
    );
  }
}
