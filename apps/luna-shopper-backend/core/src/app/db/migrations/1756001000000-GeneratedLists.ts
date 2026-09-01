import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Generated shopping lists and their three child tables (plan 0050, section 9).
 *
 * One append only migration, and **nothing on `ShoppingList` or `ListLine`
 * changes**, which is the payoff of section 1: a basket that cannot be a shopping
 * list with a `kind` column is four new tables and no edit to the two busiest
 * ones in core.
 *
 * The number leaves a gap after the shopping profiles migration, so plan 0047's
 * pair (creating `line_settlements`, then dropping `list_lines.status`) keeps the
 * slots between. Nothing here references that table: a settlement's
 * `generatedListLineId` is an opaque column plan 0047 declares, so the two
 * migrations are independent whichever order they land in.
 *
 * ## The indexes that carry rules
 *
 * `uq_generated_lists_idempotency` is a **partial** unique index over
 * `("ownerUserId", "idempotencyKey")` where the key is not null. That is what
 * makes a double tap return the first basket rather than composing a second one
 * (plan 0004, section 9), and it is partial because a run that carried no key is
 * an ordinary run and any number of those may exist.
 *
 * `ix_generated_list_line_origins_source` indexes the **origin's** line id rather
 * than the basket's line. It is the reverse lookup the overlap check in section 3
 * runs on every generation: is this zone line already carried by an `ACTIVE`
 * basket of the same user.
 *
 * ## What is deliberately not here
 *
 * No foreign key on `ownerUserId`, `zoneId`, `listId`, `lineId`, `targetListId`
 * or `itemId`. The first is opaque across the auth boundary and the last is
 * opaque across the catalog one, exactly as `list_line_items."itemId"` is. The
 * three in the middle are core's own ids and still carry no constraint on
 * purpose: a zone line deleted underneath a basket must not be blocked by
 * somebody's shopping history, so a vanished origin is reported when it is read
 * rather than prevented (section 6).
 */
export class GeneratedLists1756001000000 implements MigrationInterface {
  name = 'GeneratedLists1756001000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "generated_list_status" AS ENUM ('DRAFT', 'ACTIVE', 'COMPLETED', 'ARCHIVED')
    `);
    await queryRunner.query(`
      CREATE TYPE "generated_line_origin" AS ENUM ('DERIVED', 'ADDED')
    `);

    await queryRunner.query(`
      CREATE TABLE "generated_lists" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        "ownerUserId" uuid NOT NULL,
        "name" varchar(120),
        "status" "generated_list_status" NOT NULL DEFAULT 'DRAFT',
        "generatedAt" timestamptz NOT NULL DEFAULT now(),
        "sourceSnapshot" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "defaultTargetListId" uuid,
        "idempotencyKey" varchar(200),
        CONSTRAINT "pk_generated_lists" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      COMMENT ON COLUMN "generated_lists"."ownerUserId" IS
        'The only user who may read this basket (plan 0050, section 8): not zone admins, not the zone owner, nobody. Plan 0051 widens that to share link participants, on its own terms.'
    `);
    await queryRunner.query(`
      COMMENT ON COLUMN "generated_lists"."name" IS
        'Null means the client renders the generation date instead (plan 0050, section 1). Core does not know the caller''s locale, so the default is never stored and never collides.'
    `);
    await queryRunner.query(`
      COMMENT ON COLUMN "generated_lists"."sourceSnapshot" IS
        'The zones, lists and profile the run used (plan 0050, section 4). Not decoration: the preferences change, and without it a three week old basket cannot be explained to the person looking at it.'
    `);
    await queryRunner.query(
      `CREATE INDEX "ix_generated_lists_owner" ON "generated_lists" ("ownerUserId", "generatedAt" DESC)`
    );
    // A double tap returns the first basket rather than composing a second one.
    // Partial, because a run that carried no key is an ordinary run.
    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_generated_lists_idempotency"
        ON "generated_lists" ("ownerUserId", "idempotencyKey")
        WHERE "idempotencyKey" IS NOT NULL
    `);

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
        CONSTRAINT "pk_generated_list_lines" PRIMARY KEY ("id"),
        CONSTRAINT "fk_generated_list_lines_list" FOREIGN KEY ("generatedListId")
          REFERENCES "generated_lists" ("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      COMMENT ON COLUMN "generated_list_lines"."itemId" IS
        'The pick: the exact product this line means to buy (plan 0050, section 1), and what a settlement records (plan 0047, section 3.2). Null for a free text line, which has no product identity. Opaque catalog reference, never a foreign key.'
    `);
    await queryRunner.query(`
      COMMENT ON COLUMN "generated_list_lines"."settledQuantity" IS
        'How many units have been settled (plan 0051, section 6). Outstanding is the difference from "quantity". A column rather than a sum over line_settlements because a NOT_AVAILABLE outcome closes the outstanding amount while contributing no bought units to sum.'
    `);
    await queryRunner.query(`
      COMMENT ON COLUMN "generated_list_lines"."targetListId" IS
        'The zone list an ADDED line was also written into (plan 0050, section 5). Always null on a DERIVED line, which is already in the lists its origins name.'
    `);
    await queryRunner.query(
      `CREATE INDEX "ix_generated_list_lines_list" ON "generated_list_lines" ("generatedListId", "position")`
    );
    await queryRunner.query(`
      CREATE INDEX "ix_generated_list_lines_item"
        ON "generated_list_lines" ("itemId")
        WHERE "itemId" IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE TABLE "generated_list_line_origins" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "generatedListLineId" uuid NOT NULL,
        "zoneId" uuid NOT NULL,
        "listId" uuid NOT NULL,
        "lineId" uuid NOT NULL,
        "quantity" integer NOT NULL DEFAULT 1,
        "lineVersion" integer NOT NULL DEFAULT 1,
        CONSTRAINT "pk_generated_list_line_origins" PRIMARY KEY ("id"),
        CONSTRAINT "uq_generated_list_line_origin" UNIQUE ("generatedListLineId", "lineId"),
        CONSTRAINT "fk_generated_list_line_origins_line" FOREIGN KEY ("generatedListLineId")
          REFERENCES "generated_list_lines" ("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      COMMENT ON COLUMN "generated_list_line_origins"."lineVersion" IS
        'The origin line''s version at generation time (plan 0050, section 4). Plan 0050 needed it to reconcile a status write back; plan 0047 made settling an append, so it now tells a reader that the origin has moved rather than naming a conflict to resolve.'
    `);
    await queryRunner.query(
      `CREATE INDEX "ix_generated_list_line_origins_line" ON "generated_list_line_origins" ("generatedListLineId")`
    );
    // The reverse lookup the overlap check runs on every generation: is this zone
    // line already carried by an ACTIVE basket of the same user (section 3).
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
    await queryRunner.query(`
      COMMENT ON COLUMN "generated_list_line_options"."itemId" IS
        'One product the line''s pick may be switched between (plan 0050, section 1): the union of the origin lines'' product sets, copied at generation time. Opaque catalog reference, never a foreign key.'
    `);
    await queryRunner.query(
      `CREATE INDEX "ix_generated_list_line_options_line" ON "generated_list_line_options" ("generatedListLineId", "position")`
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    // The children first, then the lines, then the basket, then the two types
    // nothing references any more. The cascades would take the children with the
    // parent; dropping them explicitly keeps the reverse readable as the mirror
    // of the forward.
    await queryRunner.query(`DROP TABLE "generated_list_line_options"`);
    await queryRunner.query(`DROP TABLE "generated_list_line_origins"`);
    await queryRunner.query(`DROP TABLE "generated_list_lines"`);
    await queryRunner.query(`DROP TABLE "generated_lists"`);
    await queryRunner.query(`DROP TYPE "generated_line_origin"`);
    await queryRunner.query(`DROP TYPE "generated_list_status"`);
  }
}
