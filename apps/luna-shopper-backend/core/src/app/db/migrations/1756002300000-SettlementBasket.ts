import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A purchase names its basket (plan 0134, section 6).
 *
 * One nullable column on `line_settlements`, backfilled from the basket line the
 * row already names, plus two indexes. It is the expand half of an expand and
 * contract: `generatedListLineId` keeps everything it holds, and plan 0136 is
 * where it goes.
 *
 * ## Why the column exists at all
 *
 * "Which basket was this bought through" is answered today by joining the basket
 * line, and plan 0136 deletes basket lines: an open basket stores none. So the
 * question moves onto the basket itself, where it can still be asked afterwards.
 *
 * ## The backfill is exact
 *
 * Today's reads call a purchase a basket purchase when the basket line it names
 * still exists, and the `UPDATE` joins exactly those rows. A row whose basket
 * line is already gone keeps a null `basketId` and stays what it is today, a
 * session purchase. Nothing that was in a basket's trip leaves it, and nothing
 * enters one.
 *
 * ## The two indexes
 *
 * `ix_settlements_basket_live` serves every read that asks about one basket and
 * one line: the `bought` half of the trips, the `EXISTS` of the walk order, and
 * the revert walk and the arithmetic plan 0136 builds on it.
 * `ix_settlements_basket_line_live`, on `generatedListLineId`, stays until 0136
 * drops its column.
 *
 * `ix_settlements_user` has no reader yet. It is for plan 0142, which reads one
 * person's purchases newest first, and it is created here because this is the
 * migration that reshapes this table's indexes: a second pass over what will be
 * the largest table in core is the cost plan 0047 section 3.4 warned about.
 */
export class SettlementBasket1756002300000 implements MigrationInterface {
  name = 'SettlementBasket1756002300000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "line_settlements" ADD COLUMN "basketId" uuid
    `);
    await queryRunner.query(`
      COMMENT ON COLUMN "line_settlements"."basketId" IS
        'The basket this purchase was made through, or null for the list page (plan 0134). No foreign key: a settlement outlives its basket. Stored and never served.'
    `);

    await queryRunner.query(`
      UPDATE "line_settlements" s
      SET "basketId" = gll."generatedListId"
      FROM "generated_list_lines" gll
      WHERE gll.id = s."generatedListLineId"
    `);

    await queryRunner.query(`
      CREATE INDEX "ix_settlements_basket_live"
        ON "line_settlements" ("basketId", "lineId", "settledAt")
        WHERE "revertedAt" IS NULL AND "basketId" IS NOT NULL
    `);
    await queryRunner.query(`
      CREATE INDEX "ix_settlements_user"
        ON "line_settlements" ("settledByUserId", "settledAt" DESC)
        WHERE "settledByUserId" IS NOT NULL
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    // Lossless, because `generatedListLineId` still holds what `basketId` was
    // derived from. That stops being true at plan 0136, and 0136 says so in its
    // own down.
    await queryRunner.query(`DROP INDEX IF EXISTS "ix_settlements_user"`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "ix_settlements_basket_live"`
    );
    await queryRunner.query(`
      ALTER TABLE "line_settlements" DROP COLUMN IF EXISTS "basketId"
    `);
  }
}
