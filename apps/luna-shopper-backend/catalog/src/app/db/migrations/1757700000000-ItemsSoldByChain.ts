import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The path the chain filter walks (plan 0146, section 4).
 *
 * `soldBy` narrows the item search with an `EXISTS` over `supermarket_items`,
 * which runs once per candidate row. The catalog holds thousands of products and
 * tens of thousands of source rows, so without an index the browse screen scans
 * that table on every page.
 *
 * **Partial on `available`, because the filter is.** A row saying the chain does
 * not stock the product can never satisfy the `EXISTS`, so it does not belong in
 * the index either, and leaving it out keeps the index to the rows the read
 * actually visits.
 *
 * `uq_supermarket_item_scope` already covers the same two columns, and it is not
 * enough on its own: it is the whole table, unavailable rows included, and the
 * planner still has to fetch each heap tuple to test `available`.
 */
export class ItemsSoldByChain1757700000000 implements MigrationInterface {
  name = 'ItemsSoldByChain1757700000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_supermarket_items_item_scope_available"
         ON "supermarket_items" ("itemId", "priceScopeId")
         WHERE "available"`
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_supermarket_items_item_scope_available"`
    );
  }
}
