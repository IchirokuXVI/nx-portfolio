import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A basket stops storing its rows (plan 0136, section 9).
 *
 * Three tables go, and with them the waiting settlement, the split, the stored
 * pick, the hand made order and every edit that lived in the basket alone. What
 * is left is a header, a rule saying which lists the basket covers, and the
 * people on it; its rows are read from `list_lines` on every request.
 *
 * ## It asserts the two migrations it depends on before it drops anything
 *
 * Plan 0134 moved "which basket was this bought through" onto the settlement and
 * plan 0135 froze each finished trip's ask into `basket_trip_rows`. Both are
 * backfills, and dropping `generatedListLineId` or the origins with either one
 * still pending would lose what they were carrying. So each is counted and the
 * migration **raises** rather than proceeding: a deploy that cannot work is
 * refused in seconds instead of losing a household's purchase history.
 *
 * ## What it loses on purpose, and logs
 *
 * - **Waiting settlements.** A purchase made on a basket line before that line
 *   reached any list. There is nowhere to put one now, and plan 0093's own
 *   `down` already deleted exactly these rows for the same reason it gives:
 *   "inventing a list for them would put somebody else's purchase in a
 *   household's history".
 * - **Basket lines that reached no list**, typed text on an open basket with no
 *   origin row behind it.
 * - **Plan 0056's extra units**, where a basket line asked for more than its
 *   origins did.
 *
 * None of the three is recoverable, so all three are counted and raised as
 * notices first: the deploy log is the record.
 *
 * ## One transaction
 *
 * TypeORM wraps a migration in one by default and nothing here opts out (plan
 * 0130, section 13). A run that fails half way leaves the tables as they were.
 */
export class BasketsBecomeViews1756002500000 implements MigrationInterface {
  name = 'BasketsBecomeViews1756002500000';

  async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Assert plan 0134. A settlement whose basket line still exists and whose
    //    `basketId` is null has not been backfilled, and dropping the column
    //    with that join still pending loses which basket bought what.
    await queryRunner.query(`
      DO $$
      DECLARE pending bigint;
      BEGIN
        SELECT count(*) INTO pending
        FROM "line_settlements" s
        JOIN "generated_list_lines" gll ON gll.id = s."generatedListLineId"
        WHERE s."basketId" IS NULL;
        IF pending > 0 THEN
          RAISE EXCEPTION
            'plan 0134 is not complete: % settlements name a basket line and no basket', pending;
        END IF;
      END $$;
    `);

    // 2. Assert plan 0135. A finished trip with origins and no frozen rows has
    //    not been backfilled, and its ask is about to stop being readable.
    await queryRunner.query(`
      DO $$
      DECLARE pending bigint;
      BEGIN
        SELECT count(*) INTO pending
        FROM "generated_lists" gl
        WHERE gl."kind" = 'GENERATED'
          AND gl."status" <> 'OPEN'
          AND EXISTS (
            SELECT 1
            FROM "generated_list_lines" gll
            JOIN "generated_list_line_origins" o
              ON o."generatedListLineId" = gll.id
            WHERE gll."generatedListId" = gl.id
          )
          AND NOT EXISTS (
            SELECT 1 FROM "basket_trip_rows" r WHERE r."basketId" = gl.id
          );
        IF pending > 0 THEN
          RAISE EXCEPTION
            'plan 0135 is not complete: % finished baskets have origins and no trip rows', pending;
        END IF;
      END $$;
    `);

    // 3. The waiting rows, counted, logged and deleted.
    await queryRunner.query(`
      DO $$
      DECLARE waiting bigint;
      BEGIN
        SELECT count(*) INTO waiting
        FROM "line_settlements" WHERE "lineId" IS NULL;
        DELETE FROM "line_settlements" WHERE "lineId" IS NULL;
        RAISE NOTICE 'deleted % waiting settlements', waiting;
      END $$;
    `);

    // 4. What the drop loses, as notices, so the deploy log is the record.
    await queryRunner.query(`
      DO $$
      DECLARE orphans bigint;
      DECLARE extra bigint;
      BEGIN
        SELECT count(*) INTO orphans
        FROM "generated_list_lines" gll
        JOIN "generated_lists" gl ON gl.id = gll."generatedListId"
        WHERE gl."status" = 'OPEN'
          AND NOT EXISTS (
            SELECT 1 FROM "generated_list_line_origins" o
            WHERE o."generatedListLineId" = gll.id
          );
        RAISE NOTICE
          'dropping % basket lines on open baskets that reached no list', orphans;

        SELECT count(*) INTO extra
        FROM "generated_list_lines" gll
        WHERE gll.quantity > COALESCE((
          SELECT SUM(o.quantity)
          FROM "generated_list_line_origins" o
          WHERE o."generatedListLineId" = gll.id
        ), 0);
        RAISE NOTICE
          'dropping extra units on % basket lines that asked for more than their origins', extra;
      END $$;
    `);

    // 5. The settlement's own shape. `lineId` and `listId` are `NOT NULL` again,
    //    because a purchase with no line was a waiting settlement and there is
    //    nothing left for one to wait for.
    await queryRunner.query(`DROP INDEX IF EXISTS "ix_settlements_waiting"`);
    // Plan 0134's `ix_settlements_basket_line` replaces it: the question it
    // served, "this basket's purchases of this line", is asked of the basket now.
    await queryRunner.query(
      `DROP INDEX IF EXISTS "ix_settlements_basket_line_live"`
    );
    await queryRunner.query(`
      ALTER TABLE "line_settlements"
        DROP CONSTRAINT IF EXISTS "ck_line_settlements_waiting_basket"
    `);
    await queryRunner.query(`
      ALTER TABLE "line_settlements"
        DROP CONSTRAINT IF EXISTS "ck_line_settlements_home"
    `);
    await queryRunner.query(`
      ALTER TABLE "line_settlements"
        ALTER COLUMN "lineId" SET NOT NULL,
        ALTER COLUMN "listId" SET NOT NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "line_settlements" DROP COLUMN "generatedListLineId"
    `);
    // The comments plan 0093 rewrote, put back to what they said before it.
    await queryRunner.query(`
      COMMENT ON COLUMN "line_settlements"."lineId" IS
        'The zone line this purchase is a fact about (plan 0047, section 3).'
    `);
    await queryRunner.query(`
      COMMENT ON COLUMN "line_settlements"."listId" IS
        'The line''s list, copied so a list scoped read needs no join (plan 0047, section 3). A line never moves between lists, so it cannot drift.'
    `);

    // 6. The three tables, children first, then the enum only they used.
    await queryRunner.query(`DROP TABLE "generated_list_line_options"`);
    await queryRunner.query(`DROP TABLE "generated_list_line_origins"`);
    await queryRunner.query(`DROP TABLE "generated_list_lines"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "generated_line_origin"`);

    // 7. The owner's standing "everything I add today also goes in the flat
    //    list". It was read by the basket's own add, which is gone: a line is
    //    added to a list by name now, and there is no second place for it to go.
    await queryRunner.query(`
      ALTER TABLE "generated_lists" DROP COLUMN IF EXISTS "defaultTargetListId"
    `);
  }

  /**
   * **It restores the shape and not the data.**
   *
   * The three tables, the enum, the column, the two constraints and the two
   * indexes come back **empty**, and `lineId` and `listId` are nullable again.
   * Basket lines, origins, options, picks, positions and waiting rows are not
   * recoverable: an open basket comes back with no lines, and a finished basket
   * keeps its `basket_trip_rows`, which the older code does not read.
   *
   * A `down` that cannot make the older code useful is written all the same,
   * because `migrations.spec.ts` runs every migration both ways and a schema
   * that cannot be rolled back is a schema nobody can test.
   */
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "generated_lists" ADD COLUMN "defaultTargetListId" uuid
    `);

    await queryRunner.query(`
      CREATE TYPE "generated_line_origin" AS ENUM ('DERIVED', 'ADDED')
    `);
    // The three tables as plan 0050's migration created them, plus the two
    // columns plan 0051 and plan 0055 added to the first and the one plan 0109
    // added to the second. Every name is the original, so a later migration
    // rolled forward again finds what it expects.
    await queryRunner.query(`
      CREATE TABLE "generated_list_lines" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        "generatedListId" uuid NOT NULL,
        "content" varchar NOT NULL,
        "quantity" integer NOT NULL DEFAULT 1,
        "settledQuantity" integer NOT NULL DEFAULT 0,
        "itemId" uuid,
        "origin" "generated_line_origin" NOT NULL DEFAULT 'DERIVED',
        "targetListId" uuid,
        "position" double precision NOT NULL DEFAULT 0,
        "createdByParticipantId" uuid,
        "lastEditedByParticipantId" uuid,
        "lastEditedAt" timestamptz,
        CONSTRAINT "pk_generated_list_lines" PRIMARY KEY ("id"),
        CONSTRAINT "fk_generated_list_lines_list" FOREIGN KEY ("generatedListId")
          REFERENCES "generated_lists" ("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "ix_generated_list_lines_list" ON "generated_list_lines" ("generatedListId", "position")`
    );

    await queryRunner.query(`
      CREATE TABLE "generated_list_line_origins" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "generatedListLineId" uuid NOT NULL,
        "zoneId" uuid NOT NULL,
        "listId" uuid NOT NULL,
        "lineId" uuid NOT NULL,
        "quantity" integer NOT NULL DEFAULT 1,
        "settled" integer NOT NULL DEFAULT 0,
        "lineVersion" integer NOT NULL DEFAULT 1,
        CONSTRAINT "pk_generated_list_line_origins" PRIMARY KEY ("id"),
        CONSTRAINT "uq_generated_list_line_origin" UNIQUE ("generatedListLineId", "lineId"),
        CONSTRAINT "fk_generated_list_line_origins_line" FOREIGN KEY ("generatedListLineId")
          REFERENCES "generated_list_lines" ("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "ix_generated_list_line_origins_line" ON "generated_list_line_origins" ("generatedListLineId")`
    );
    await queryRunner.query(
      `CREATE INDEX "ix_generated_list_line_origins_source" ON "generated_list_line_origins" ("lineId")`
    );

    await queryRunner.query(`
      CREATE TABLE "generated_list_line_options" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "generatedListLineId" uuid NOT NULL,
        "itemId" uuid NOT NULL,
        "position" integer NOT NULL DEFAULT 0,
        CONSTRAINT "pk_generated_list_line_options" PRIMARY KEY ("id"),
        CONSTRAINT "uq_generated_list_line_option" UNIQUE ("generatedListLineId", "itemId"),
        CONSTRAINT "fk_generated_list_line_options_line" FOREIGN KEY ("generatedListLineId")
          REFERENCES "generated_list_lines" ("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "ix_generated_list_line_options_line" ON "generated_list_line_options" ("generatedListLineId", "position")`
    );

    await queryRunner.query(`
      ALTER TABLE "line_settlements" ADD COLUMN "generatedListLineId" uuid
    `);
    await queryRunner.query(`
      ALTER TABLE "line_settlements"
        ALTER COLUMN "lineId" DROP NOT NULL,
        ALTER COLUMN "listId" DROP NOT NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "line_settlements"
        ADD CONSTRAINT "ck_line_settlements_home" CHECK (
          ("lineId" IS NULL AND "listId" IS NULL)
          OR ("lineId" IS NOT NULL AND "listId" IS NOT NULL)
        )
    `);
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
    await queryRunner.query(`
      CREATE INDEX "ix_settlements_basket_line_live"
        ON "line_settlements" ("generatedListLineId")
        WHERE "revertedAt" IS NULL
    `);
  }
}
