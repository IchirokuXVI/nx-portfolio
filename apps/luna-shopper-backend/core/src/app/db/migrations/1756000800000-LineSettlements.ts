import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A line's quantity becomes its only state, and what happened on a trip becomes
 * a row of its own (plan 0047).
 *
 * Three things, and the middle one is destructive:
 *
 * 1. `line_settlements` is created. One row per origin line touched by one
 *    settling act, which is the record every history, indicator and estimate on
 *    the line page is computed from.
 * 2. `list_lines."status"` is dropped, having first set `quantity = 0` on every
 *    `READY` line. `PENDING` and `NOT_AVAILABLE` lines keep the quantity they
 *    have: they were never obtained, so the household still wants them.
 * 3. The `(listId, status)` index becomes `(listId, quantity)`, because the
 *    second list count stops being "how many are ready" and becomes "how many are
 *    wanted" (section 2.3).
 *
 * **No settlements are backfilled**, and that is the honest migration rather than
 * an omission (section 8). There is nobody to attribute a purchase to and no date
 * to give it, so inventing rows would put a name and a time on the screen that
 * nothing ever recorded. No line shows a bought indicator until it is genuinely
 * bought again, which costs one cycle of history that was never recorded in the
 * first place.
 *
 * `pricePaidCents` and `supermarketLocationId` are declared here and written by
 * nothing in this plan (section 3.4). They are what "the price you actually paid"
 * and "where you got it" fill in once backlog 0004 exists, and both are cheap now
 * and a migration each later on a table that will by then be the largest in core.
 */
export class LineSettlements1756000800000 implements MigrationInterface {
  name = 'LineSettlements1756000800000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "settlement_outcome" AS ENUM ('BOUGHT', 'NOT_AVAILABLE')`
    );
    await queryRunner.query(`
      CREATE TABLE "line_settlements" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "lineId" uuid NOT NULL,
        "listId" uuid NOT NULL,
        "itemId" uuid,
        "outcome" "settlement_outcome" NOT NULL,
        "quantity" integer NOT NULL,
        "settledByUserId" uuid NOT NULL,
        "settledAt" timestamptz NOT NULL DEFAULT now(),
        "generatedListLineId" uuid,
        "pricePaidCents" integer,
        "supermarketLocationId" uuid,
        CONSTRAINT "pk_line_settlements" PRIMARY KEY ("id"),
        CONSTRAINT "fk_line_settlements_line" FOREIGN KEY ("lineId")
          REFERENCES "list_lines" ("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      COMMENT ON COLUMN "line_settlements"."itemId" IS
        'The exact product bought, copied at settle time (plan 0047, section 3.2). An opaque catalog reference validated in application code, never a database foreign key, and deliberately not a join through the line''s product set: the set can change afterwards and the settlement does not move with it.'
    `);
    await queryRunner.query(`
      COMMENT ON COLUMN "line_settlements"."generatedListLineId" IS
        'The basket line this came off (plan 0051). Stored and never served: the basket is private, the purchase is not (plan 0047, section 3.1).'
    `);

    // The line page's own history, newest first (section 6.1).
    await queryRunner.query(
      `CREATE INDEX "ix_settlements_line" ON "line_settlements" ("lineId", "settledAt" DESC)`
    );
    // The cross list item history (section 6.2). This index is what the copied
    // `itemId` buys: the question is answerable without touching `list_lines` at
    // all, let alone the join table whose contents may have changed since.
    await queryRunner.query(
      `CREATE INDEX "ix_settlements_item" ON "line_settlements" ("itemId", "settledAt" DESC)`
    );
    // A list scoped read, which is why `listId` is denormalized onto the row.
    await queryRunner.query(
      `CREATE INDEX "ix_settlements_list" ON "line_settlements" ("listId", "settledAt" DESC)`
    );

    // Everything marked ready was, by the old model, already in somebody's
    // trolley. Zero is what the new model calls that: the household is stocked,
    // the line stays where it is, and nothing is deleted.
    await queryRunner.query(
      `UPDATE "list_lines" SET "quantity" = 0 WHERE "status" = 'READY'`
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "ix_lines_list_status"`);
    await queryRunner.query(`ALTER TABLE "list_lines" DROP COLUMN "status"`);
    await queryRunner.query(`DROP TYPE "line_status"`);
    await queryRunner.query(
      `CREATE INDEX "ix_lines_list_quantity" ON "list_lines" ("listId", "quantity")`
    );
  }

  /**
   * The reverse, and it is lossy in one direction that cannot be helped: a line
   * that was `READY` came back as `PENDING` at quantity zero, because the
   * quantity it held before the migration is not written down anywhere. Every
   * line comes back `PENDING`, which is the value the column defaulted to and the
   * only one that is true of a line nothing has said anything about.
   */
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "ix_lines_list_quantity"`);
    await queryRunner.query(
      `CREATE TYPE "line_status" AS ENUM ('PENDING', 'READY', 'NOT_AVAILABLE')`
    );
    await queryRunner.query(
      `ALTER TABLE "list_lines" ADD COLUMN "status" "line_status" NOT NULL DEFAULT 'PENDING'`
    );
    await queryRunner.query(
      `CREATE INDEX "ix_lines_list_status" ON "list_lines" ("listId", "status")`
    );

    await queryRunner.query(`DROP TABLE "line_settlements"`);
    await queryRunner.query(`DROP TYPE "settlement_outcome"`);
  }
}
