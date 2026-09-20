import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * What a trip asked, written down when it ends (plan 0135, section 6).
 *
 * One new table, `basket_trip_rows`, plus the backfill of every basket that is
 * already finished or archived.
 *
 * ## Why the table exists at all
 *
 * A finished basket's ask is read today from `generated_list_line_origins`, and
 * it stays true only because a finished basket refuses every write, so its
 * origins happen to stop moving. Plan 0136 deletes that table and makes an open
 * basket's ask a view of lists that never stop moving. So the freeze becomes an
 * act: the finish writes the numbers down, and a reopen deletes them.
 *
 * ## The backfill changes nothing a reader sees
 *
 * A finished basket's origins have not moved since it finished, so the sums
 * written here are the sums every read computed yesterday.
 *
 * The status literal is the one plan 0133's migration wrote, and that migration
 * runs first inside the same transaction when both are pending. A **rebuilt**
 * enum type is usable in the transaction that rebuilt it; a value added to an
 * existing type is not. That is plan 0133's trap rather than this one's, and it
 * is named here so nobody reorders the two.
 */
export class BasketTripRows1756002400000 implements MigrationInterface {
  name = 'BasketTripRows1756002400000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "basket_trip_rows" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "basketId" uuid NOT NULL,
        "listId" uuid NOT NULL,
        "lineId" uuid NOT NULL,
        "asked" integer NOT NULL,
        CONSTRAINT "pk_basket_trip_rows" PRIMARY KEY ("id"),
        CONSTRAINT "uq_basket_trip_rows_line" UNIQUE ("basketId", "lineId"),
        CONSTRAINT "ck_basket_trip_rows_asked" CHECK ("asked" >= 0),
        CONSTRAINT "fk_basket_trip_rows_basket" FOREIGN KEY ("basketId")
          REFERENCES "generated_lists" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_basket_trip_rows_line" FOREIGN KEY ("lineId")
          REFERENCES "list_lines" ("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      COMMENT ON TABLE "basket_trip_rows" IS
        'What a trip asked of each zone line, frozen by the finish (plan 0135). Rows exist exactly while the basket is not OPEN.'
    `);
    await queryRunner.query(`
      CREATE INDEX "ix_basket_trip_rows_list"
        ON "basket_trip_rows" ("listId", "basketId")
    `);

    // The freeze of section 3, over every basket that is not open. The list
    // comes from the line rather than from the origin's copy, which is what
    // makes the unique key safe to group under: one line is in one list. The
    // inner join to `list_lines` drops an origin whose line is gone, which the
    // foreign key requires and which loses nothing, because `basket_rows` drops
    // the same origin on every read today.
    await queryRunner.query(`
      INSERT INTO "basket_trip_rows" ("basketId", "listId", "lineId", "asked")
      SELECT gll."generatedListId",
             ll."listId",
             ll.id,
             SUM(o."quantity")::int
      FROM "generated_list_line_origins" o
      JOIN "generated_list_lines" gll ON gll.id = o."generatedListLineId"
      JOIN "generated_lists" gl ON gl.id = gll."generatedListId"
      JOIN "list_lines" ll ON ll.id = o."lineId"
      WHERE gl."status" <> 'OPEN'
      GROUP BY gll."generatedListId", ll."listId", ll.id
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    // Lossless **while `generated_list_line_origins` exists**, because a
    // finished basket's origins still hold every number the backfill read. Plan
    // 0136 deletes that table, and from then on this down loses what every
    // finished trip asked. It is said here as well as there, because this is the
    // file somebody reads before running it.
    await queryRunner.query(`DROP TABLE IF EXISTS "basket_trip_rows"`);
  }
}
