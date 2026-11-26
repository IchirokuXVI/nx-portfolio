import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The bounds the check `item_piece_count_bounds` allows, restated from
 * `PIECE_COUNT_MIN` and `PIECE_COUNT_MAX` in the contracts library (plan
 * 0278, section 2). A migration is a record of what it did, so it holds its
 * own copy rather than importing bounds that may change later;
 * `migrations.spec.ts` asserts the two are equal today.
 */
export const ITEM_PIECE_COUNT_MIN_SQL = 2;
export const ITEM_PIECE_COUNT_MAX_SQL = 10000;

/**
 * The piece count of a product (plan 0278, section 2).
 *
 * - `pieceCount`: how many pieces the whole product holds, counted across
 *   its pack. Null for a product whose pieces nobody counted.
 *
 * Two checks restate the rules: the value is in its bounds, and only a
 * product with a fixed size in `GRAM` or `MILLILITER`, no weight, and a pack
 * count below it (or none) holds one. The column is nullable and starts null,
 * so every existing product passes both checks and the migration writes no
 * row.
 *
 * `down` drops the checks and then the column.
 */
export class ItemPieceCount1759600000000 implements MigrationInterface {
  name = 'ItemPieceCount1759600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "items" ADD COLUMN "pieceCount" smallint NULL`
    );
    await queryRunner.query(
      `ALTER TABLE "items" ADD CONSTRAINT "item_piece_count_bounds"
         CHECK ("pieceCount" IS NULL OR "pieceCount" BETWEEN ${ITEM_PIECE_COUNT_MIN_SQL} AND ${ITEM_PIECE_COUNT_MAX_SQL})`
    );
    await queryRunner.query(
      `ALTER TABLE "items" ADD CONSTRAINT "item_piece_count_on_sized"
         CHECK ("pieceCount" IS NULL OR (
           "unitSize" IS NOT NULL AND "approxWeight" IS NULL
           AND "defaultUnit" IN ('GRAM', 'MILLILITER')
           AND ("packCount" IS NULL OR "pieceCount" > "packCount")
         ))`
    );
    await queryRunner.query(
      `COMMENT ON COLUMN "items"."pieceCount" IS 'How many pieces the whole product holds, counted across its pack (plan 0278). Null: not counted. Only a person writes it.'`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "items" DROP CONSTRAINT "item_piece_count_on_sized"`
    );
    await queryRunner.query(
      `ALTER TABLE "items" DROP CONSTRAINT "item_piece_count_bounds"`
    );
    await queryRunner.query(`ALTER TABLE "items" DROP COLUMN "pieceCount"`);
  }
}
