import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The catalog's own comparison figure on every materialized row (plan 0245,
 * section 6).
 *
 * - `comparablePrice`: the price of a kilo, a litre or one unit of the
 *   product, derived from `price` and the item's size.
 * - `comparableBasis`: which of the three it is.
 *
 * A check keeps the two null together. The backfill runs over every row in
 * this migration, so a deploy answers correct orders at once and nothing
 * waits for a sweep. Its two expressions are a frozen copy of
 * `COMPARABLE_PRICE_SQL` and `COMPARABLE_BASIS_SQL` in
 * `catalog/comparable-price.sql.ts`, as they stood when this was written;
 * `comparable-price.integration.spec.ts` proves both equal to
 * `comparablePriceOf`. No index: the listing's sort reads
 * `uq_supermarket_item_scope` as before.
 *
 * `down` drops the check, the columns and the type.
 */
const BASE_SIZE = `(CASE
    WHEN i."defaultUnit" IN ('KILOGRAM', 'LITER') THEN round(i."unitSize" * 1000, 4)
    ELSE i."unitSize"
  END)`;

const COUNT = `(CASE
    WHEN i."unitSize" > 0 THEN i."unitSize"
    WHEN i."packCount" > 0 THEN i."packCount"
    ELSE 1
  END)`;

const PRICE = `(CASE
    WHEN si."price" IS NULL THEN NULL
    WHEN i."defaultUnit" = 'KILOGRAM' AND coalesce(i."unitSize", 0) <= 0
      THEN round(si."price", 4)
    WHEN i."defaultUnit" IN ('GRAM', 'KILOGRAM', 'MILLILITER', 'LITER')
      THEN CASE WHEN ${BASE_SIZE} > 0
                THEN round(si."price" * 1000 / ${BASE_SIZE}, 4) END
    ELSE round(si."price" / ${COUNT}, 4)
  END)`;

const BASIS = `(CASE
    WHEN si."price" IS NULL THEN NULL
    WHEN i."defaultUnit" = 'KILOGRAM' AND coalesce(i."unitSize", 0) <= 0
      THEN 'KILOGRAM'
    WHEN i."defaultUnit" IN ('GRAM', 'KILOGRAM')
      THEN CASE WHEN ${BASE_SIZE} > 0 THEN 'KILOGRAM' END
    WHEN i."defaultUnit" IN ('MILLILITER', 'LITER')
      THEN CASE WHEN ${BASE_SIZE} > 0 THEN 'LITER' END
    ELSE 'UNIT'
  END)::"comparable_basis"`;

export class SupermarketItemComparablePrice1759400000000 implements MigrationInterface {
  name = 'SupermarketItemComparablePrice1759400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "comparable_basis" AS ENUM ('KILOGRAM', 'LITER', 'UNIT')`
    );
    await queryRunner.query(
      `ALTER TABLE "supermarket_items" ADD COLUMN "comparablePrice" numeric(12,4) NULL`
    );
    await queryRunner.query(
      `ALTER TABLE "supermarket_items" ADD COLUMN "comparableBasis" "comparable_basis" NULL`
    );
    await queryRunner.query(
      `ALTER TABLE "supermarket_items" ADD CONSTRAINT "supermarket_item_comparable_pair"
         CHECK (("comparablePrice" IS NULL) = ("comparableBasis" IS NULL))`
    );
    await queryRunner.query(
      `UPDATE "supermarket_items" si
          SET "comparablePrice" = ${PRICE},
              "comparableBasis" = ${BASIS}
         FROM "items" i
        WHERE i."id" = si."itemId"
          AND si."price" IS NOT NULL`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "supermarket_items" DROP CONSTRAINT "supermarket_item_comparable_pair"`
    );
    await queryRunner.query(
      `ALTER TABLE "supermarket_items" DROP COLUMN "comparableBasis"`
    );
    await queryRunner.query(
      `ALTER TABLE "supermarket_items" DROP COLUMN "comparablePrice"`
    );
    await queryRunner.query(`DROP TYPE "comparable_basis"`);
  }
}
