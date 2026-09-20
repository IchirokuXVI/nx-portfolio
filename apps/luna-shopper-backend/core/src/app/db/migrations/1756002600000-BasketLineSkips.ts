import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A line skipped for now (plan 0137, section 2).
 *
 * One new table, `basket_line_skips`, and nothing else. There is no backfill:
 * before this migration nobody could say "not today" at all, so there is no
 * older record of one to carry forward.
 *
 * ## Why both foreign keys cascade
 *
 * This is where a skip differs from a settlement on purpose. A settlement is a
 * zone fact that outlives the basket it came off, so `line_settlements.basketId`
 * carries no key. A skip means nothing without its basket and nothing without
 * its line, so it goes with either.
 *
 * ## The index is deliberately not unique
 *
 * A row can be skipped, bought in part, which ends the skip, and skipped again
 * for the rest, and both rows keep a null `revertedAt`. What stops two standing
 * skips on one line is the lock the write takes over the row's list lines.
 */
export class BasketLineSkips1756002600000 implements MigrationInterface {
  name = 'BasketLineSkips1756002600000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "basket_line_skips" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "basketId" uuid NOT NULL,
        "lineId" uuid NOT NULL,
        "skippedByParticipantId" uuid NOT NULL,
        "skippedAt" timestamptz NOT NULL,
        "revertedAt" timestamptz,
        "revertedByParticipantId" uuid,
        CONSTRAINT "pk_basket_line_skips" PRIMARY KEY ("id"),
        CONSTRAINT "fk_basket_line_skips_basket" FOREIGN KEY ("basketId")
          REFERENCES "generated_lists" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_basket_line_skips_line" FOREIGN KEY ("lineId")
          REFERENCES "list_lines" ("id") ON DELETE CASCADE,
        CONSTRAINT "ck_basket_line_skips_revert" CHECK (
          ("revertedAt" IS NULL AND "revertedByParticipantId" IS NULL)
          OR ("revertedAt" IS NOT NULL AND "revertedByParticipantId" IS NOT NULL)
        )
      )
    `);
    await queryRunner.query(`
      COMMENT ON TABLE "basket_line_skips" IS
        'One basket''s "not today" on one covered list line (plan 0137). Private to the basket, ended by a purchase through it, and stale after the skip window.'
    `);
    // Every read of this table is "the standing skips of this basket", so the
    // index is the pair and the partial predicate is the standing half.
    await queryRunner.query(`
      CREATE INDEX "ix_basket_line_skips_standing"
        ON "basket_line_skips" ("basketId", "lineId")
        WHERE "revertedAt" IS NULL
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    // Every skip goes with the table, and that is the honest answer rather than
    // a loss to apologize for: a skip is one trip's intention with a twelve hour
    // life, and the schema below this migration has nowhere to put one.
    await queryRunner.query(
      `DROP INDEX IF EXISTS "ix_basket_line_skips_standing"`
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "basket_line_skips"`);
  }
}
