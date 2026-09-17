import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Where a copied price was read (plan 0118, section 5.1).
 *
 * Additive: two nullable columns and no backfill, because every row that exists
 * was read at its own scope, which is what null says.
 *
 * - `item_prices.copiedFromScopeId`, written by a run that copies a walked
 *   scope's prices onto other scopes.
 * - `supermarket_items.priceCopiedFromScopeId`, the chosen row's value,
 *   materialized beside `priceSourceKind`.
 *
 * **Neither has a foreign key.** The record of where a price was read has to
 * outlive the scope it names: a deleted warehouse cascades its own prices away
 * and its copies at a region stay priced.
 */
export class ScopeCopies1757500000000 implements MigrationInterface {
  name = 'ScopeCopies1757500000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "item_prices" ADD COLUMN "copiedFromScopeId" uuid`
    );
    await queryRunner.query(
      `ALTER TABLE "supermarket_items" ADD COLUMN "priceCopiedFromScopeId" uuid`
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "supermarket_items" DROP COLUMN "priceCopiedFromScopeId"`
    );
    await queryRunner.query(
      `ALTER TABLE "item_prices" DROP COLUMN "copiedFromScopeId"`
    );
  }
}
