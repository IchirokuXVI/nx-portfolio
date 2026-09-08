import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A purchase can be recorded before it has a list to belong to (plan 0093,
 * section 2).
 *
 * `lineId` and `listId` become nullable, together. A row with both null is a
 * **waiting settlement**: it belongs to a basket line, through
 * `generatedListLineId`, and to no zone line yet. Every other column means what
 * it meant.
 *
 * ## What this reverses
 *
 * Plan 0058 section 4.1 refused to record a purchase made on a basket line that
 * had reached no list, and plan 0055 section 6 made that unavoidable: the settle
 * advanced the basket line and wrote no settlement, because a settlement is a
 * zone fact and there was no zone line for it to be a fact about.
 *
 * So somebody added "batteries" in the shop, bought four, sent the line to the
 * flat's list at home, and the flat got a line asking for nothing and a history
 * saying batteries were never bought. The reasoning was right about the estimate
 * plan 0047 section 6.3 computes and wrong about the record: the shopper bought
 * them **for** that household, which is why they sent the line there.
 *
 * ## The two constraints
 *
 * `ck_line_settlements_home` keeps the pair together. A row naming a line and no
 * list, or a list and no line, would be a purchase readable by one key and
 * invisible to the other, and every list scoped read in core takes the
 * denormalized `listId` rather than the join.
 *
 * `ck_line_settlements_waiting_basket` keeps a waiting row attached to
 * something. A row with no zone line **and** no basket line would belong to
 * nothing at all, and nothing could ever find it to bring it home.
 *
 * ## Why the partial index
 *
 * Re-homing reads one basket line's waiting rows, oldest first, and that is the
 * only read a waiting row ever gets: every list scoped read selects by `lineId`,
 * so a null one is invisible to them by construction. The index answers exactly
 * that query off `("generatedListLineId", "settledAt") WHERE "lineId" IS NULL`,
 * and covers none of the rows that are already home, which is nearly all of
 * them.
 *
 * ## No data moves
 *
 * Purchases made before this plan on lines with no origins were never written
 * and cannot be recovered, which is plan 0047 section 8's honest migration
 * again. Nothing is backfilled and no existing row changes.
 */
export class WaitingSettlements1756001900000 implements MigrationInterface {
  name = 'WaitingSettlements1756001900000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "line_settlements"
        ALTER COLUMN "lineId" DROP NOT NULL,
        ALTER COLUMN "listId" DROP NOT NULL
    `);
    await queryRunner.query(`
      COMMENT ON COLUMN "line_settlements"."lineId" IS
        'The zone line this purchase is a fact about, or null while it waits for one (plan 0093, section 2). A row with this and "listId" null is a waiting settlement: it belongs to a basket line through "generatedListLineId" and to no household yet, and it is re-homed the moment the line reaches a list.'
    `);
    await queryRunner.query(`
      COMMENT ON COLUMN "line_settlements"."listId" IS
        'The line''s list, copied so a list scoped read needs no join (plan 0047, section 3). Null exactly when "lineId" is, which is what "ck_line_settlements_home" enforces.'
    `);

    // Both or neither, named rather than anonymous so a violation says which
    // rule was broken, which is the shape `ck_line_settlements_actor` and
    // `ck_line_settlements_revert` already carry.
    await queryRunner.query(`
      ALTER TABLE "line_settlements"
        ADD CONSTRAINT "ck_line_settlements_home" CHECK (
          ("lineId" IS NULL AND "listId" IS NULL)
          OR ("lineId" IS NOT NULL AND "listId" IS NOT NULL)
        )
    `);
    // A waiting row belongs to a basket line or it belongs to nothing, and a row
    // belonging to nothing can never be brought home.
    await queryRunner.query(`
      ALTER TABLE "line_settlements"
        ADD CONSTRAINT "ck_line_settlements_waiting_basket" CHECK (
          "lineId" IS NOT NULL OR "generatedListLineId" IS NOT NULL
        )
    `);
    await queryRunner.query(`
      CREATE INDEX "ix_settlements_waiting"
        ON "line_settlements" ("generatedListLineId", "settledAt")
        WHERE "lineId" IS NULL
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "ix_settlements_waiting"`);
    await queryRunner.query(`
      ALTER TABLE "line_settlements"
        DROP CONSTRAINT "ck_line_settlements_waiting_basket"
    `);
    await queryRunner.query(`
      ALTER TABLE "line_settlements"
        DROP CONSTRAINT "ck_line_settlements_home"
    `);
    // The earlier schema has nowhere to put a purchase that belongs to no list,
    // so going back deletes those rows. Stated rather than hidden: it is the one
    // lossy step here, it loses exactly the rows this plan added the ability to
    // write, and the alternative, inventing a list for them, would put somebody
    // else's purchase in a household's history.
    await queryRunner.query(`
      DELETE FROM "line_settlements" WHERE "lineId" IS NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "line_settlements"
        ALTER COLUMN "listId" SET NOT NULL,
        ALTER COLUMN "lineId" SET NOT NULL
    `);
  }
}
