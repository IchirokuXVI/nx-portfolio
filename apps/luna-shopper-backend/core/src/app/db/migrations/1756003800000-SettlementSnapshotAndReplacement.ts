import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * What a buy records, and the row a correction replaces (plan 0202, sections 1
 * and 3).
 *
 * Two nullable columns on `line_settlements`, and one index. No check of the
 * table changes. The six it carries (`actor`, `revert`, `price`,
 * `price_amount`, `price_bought` and `location_scope`) say nothing about either
 * column, and a rewrite satisfies each of them as an ordinary revert and an
 * ordinary buy do.
 *
 * - `itemSnapshot` is what the product was called when it was bought. It is
 *   `jsonb`, so a row holds the fields of the day it was written and a later
 *   field needs no migration.
 * - `replacesSettlementId` is set on the row a change of product wrote, and
 *   names the row it stands in for. A history leaves out a reverted row that
 *   another row names here.
 *
 * `up` reads and writes no row. Every existing row is null in both columns:
 * there is no backfill of old buys.
 *
 * The index is unique, because a row is replaced once. The row that replaced it
 * is the one a later change replaces. It is partial, so it holds only the
 * corrections, and it is what the histories look a replaced row up by.
 *
 * `down` drops the index and both columns. The rows a correction wrote stay,
 * and so do the rows it marked reverted, so after a `down` a correction reads
 * as a buy taken back and another buy made at the same moment. No quantity and
 * no sum changes.
 */
export class SettlementSnapshotAndReplacement1756003800000
  implements MigrationInterface
{
  name = 'SettlementSnapshotAndReplacement1756003800000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "line_settlements"
        ADD COLUMN "itemSnapshot" jsonb,
        ADD COLUMN "replacesSettlementId" uuid
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "ux_settlements_replaces"
        ON "line_settlements" ("replacesSettlementId")
        WHERE "replacesSettlementId" IS NOT NULL
    `);
    await queryRunner.query(`
      COMMENT ON COLUMN "line_settlements"."itemSnapshot" IS
        'What the product of "itemId" was called when this was settled: name (every locale), brand, unitSize, packCount and defaultUnit, as the gateway read them from catalog (plan 0202). Null on a free text buy, on every row from before that plan, and when catalog did not answer.'
    `);
    await queryRunner.query(`
      COMMENT ON COLUMN "line_settlements"."replacesSettlementId" IS
        'The settlement this row stands in for, set by a change of product from the basket (plan 0202). The row it names is marked reverted and is not a buy that was given back. No foreign key: both rows are of one line and leave with it.'
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "ux_settlements_replaces"`);
    await queryRunner.query(`
      ALTER TABLE "line_settlements"
        DROP COLUMN "replacesSettlementId",
        DROP COLUMN "itemSnapshot"
    `);
  }
}
