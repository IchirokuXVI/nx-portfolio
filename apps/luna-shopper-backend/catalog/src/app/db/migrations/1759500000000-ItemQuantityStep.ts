import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The steps the check `item_quantity_step_allowed` allows, restated from
 * `QUANTITY_STEPS` in the contracts library (plan 0261, S2). A migration is a
 * record of what it did, so it holds its own copy rather than importing a
 * list that may change later; `migrations.spec.ts` asserts the two are equal
 * today.
 */
export const ITEM_QUANTITY_STEPS_SQL = [
  1, 5, 10, 25, 50, 100, 200, 250, 500, 1000,
] as const;

/**
 * The step of a product sold by the kilo or the litre (plan 0261, section
 * 2.1).
 *
 * - `quantityStep`: how far one step moves a line of this product, in grams
 *   or millilitres. Null is velista's default steps.
 *
 * Two checks restate the rules: the value is one of the ten steps, and only a
 * product sold by the kilo or the litre (`KILOGRAM` or `LITER`, no size, no
 * weight) carries one. The column is nullable and starts null, so every
 * existing product passes both checks and the migration writes no row.
 *
 * `down` drops the checks and then the column.
 */
export class ItemQuantityStep1759500000000 implements MigrationInterface {
  name = 'ItemQuantityStep1759500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "items" ADD COLUMN "quantityStep" smallint NULL`
    );
    await queryRunner.query(
      `ALTER TABLE "items" ADD CONSTRAINT "item_quantity_step_allowed"
         CHECK ("quantityStep" IS NULL OR "quantityStep" IN (${ITEM_QUANTITY_STEPS_SQL.join(', ')}))`
    );
    await queryRunner.query(
      `ALTER TABLE "items" ADD CONSTRAINT "item_quantity_step_on_loose"
         CHECK ("quantityStep" IS NULL OR (
           "unitSize" IS NULL AND "approxWeight" IS NULL
           AND "defaultUnit" IN ('KILOGRAM', 'LITER')
         ))`
    );
    await queryRunner.query(
      `COMMENT ON COLUMN "items"."quantityStep" IS 'How far one step moves a line of this product, in grams or millilitres (plan 0261). Null: the default steps.'`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "items" DROP CONSTRAINT "item_quantity_step_on_loose"`
    );
    await queryRunner.query(
      `ALTER TABLE "items" DROP CONSTRAINT "item_quantity_step_allowed"`
    );
    await queryRunner.query(`ALTER TABLE "items" DROP COLUMN "quantityStep"`);
  }
}
