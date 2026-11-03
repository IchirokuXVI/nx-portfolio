import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Two instants on the offer of a scope (plan 0220, sections 6.1 and 15.1).
 *
 * - `delistedAt`: when the harvester's counter proved, over several whole
 *   walks, that the chain stopped listing the product at this scope.
 * - `outOfStockAt`: since when the chain shows the product out of stock
 *   here. It hides nothing and stops no purchase.
 *
 * Both are nullable and start null, so the migration states nothing about
 * any product. No index: every read that needs them already reads the row.
 *
 * `down` drops both columns.
 */
export class SupermarketItemDelistedAt1759200000000 implements MigrationInterface {
  name = 'SupermarketItemDelistedAt1759200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "supermarket_items" ADD "delistedAt" timestamptz NULL`
    );
    await queryRunner.query(
      `ALTER TABLE "supermarket_items" ADD "outOfStockAt" timestamptz NULL`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "supermarket_items" DROP COLUMN "outOfStockAt"`
    );
    await queryRunner.query(
      `ALTER TABLE "supermarket_items" DROP COLUMN "delistedAt"`
    );
  }
}
