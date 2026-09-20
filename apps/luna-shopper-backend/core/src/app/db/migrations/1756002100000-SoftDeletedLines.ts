import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A deleted line keeps its row and its purchases (plan 0132, section 5).
 *
 * Two nullable columns on `list_lines` and one index made partial. Nothing else
 * changes shape, and nothing is backfilled: a line deleted before this migration
 * is gone, with its `line_settlements` rows, and cannot be rebuilt.
 *
 * ## The two columns
 *
 * `deletedAt` is TypeORM's `@DeleteDateColumn`, so every repository read and
 * every query builder made from `ListLine` skips a row where it is set. Raw SQL
 * does not, and each of the raw reads carries the predicate by hand (section
 * 4.2).
 *
 * `deletedByUserId` names the member who deleted it, and stays null when an
 * operator did: the audit trail is where an operator's name is kept.
 * `ck_list_lines_deleted_by` keeps the pair honest, so a standing line can never
 * carry a deleter left over from anything.
 *
 * ## The index
 *
 * `ix_lines_list_quantity` serves both line counts, and neither count reads a
 * deleted line, so it becomes partial on `"deletedAt" IS NULL`. The other two
 * indexes on this table are already partial on `"itemSetHash"` and
 * `"productGroupId"` being set, and the delete nulls both, so a deleted line is
 * outside them without any change here. Nothing indexes `"deletedAt"`: no read
 * in this plan looks for a deleted line, and an index with no reader is a write
 * cost with no query.
 */
export class SoftDeletedLines1756002100000 implements MigrationInterface {
  name = 'SoftDeletedLines1756002100000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "list_lines"
        ADD COLUMN "deletedAt" timestamptz NULL,
        ADD COLUMN "deletedByUserId" uuid NULL
    `);
    await queryRunner.query(`
      COMMENT ON COLUMN "list_lines"."deletedAt" IS
        'When the line was deleted, or null while it stands (plan 0132). A deleted line keeps its row and its line_settlements and nothing else.'
    `);
    await queryRunner.query(`
      COMMENT ON COLUMN "list_lines"."deletedByUserId" IS
        'The member who deleted the line (plan 0132). Null while it stands, and null when an operator deleted it, because the audit trail names an operator.'
    `);
    await queryRunner.query(`
      ALTER TABLE "list_lines"
        ADD CONSTRAINT "ck_list_lines_deleted_by" CHECK (
          "deletedByUserId" IS NULL OR "deletedAt" IS NOT NULL
        )
    `);

    await queryRunner.query(`DROP INDEX "ix_lines_list_quantity"`);
    await queryRunner.query(`
      CREATE INDEX "ix_lines_list_quantity"
        ON "list_lines" ("listId", "quantity")
        WHERE "deletedAt" IS NULL
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    // The earlier schema has nowhere to put a line that is deleted but still
    // there, so going back deletes those rows, and their settlements with them
    // by cascade. Stated rather than hidden: it is the one lossy step here, it
    // loses exactly the rows this plan added the ability to keep, and the
    // alternative, letting them stand again, would put a line somebody deleted
    // back on a household's list with no products and no comments.
    await queryRunner.query(`
      DELETE FROM "list_lines" WHERE "deletedAt" IS NOT NULL
    `);

    await queryRunner.query(`DROP INDEX IF EXISTS "ix_lines_list_quantity"`);
    await queryRunner.query(`
      CREATE INDEX "ix_lines_list_quantity"
        ON "list_lines" ("listId", "quantity")
    `);

    await queryRunner.query(`
      ALTER TABLE "list_lines"
        DROP CONSTRAINT IF EXISTS "ck_list_lines_deleted_by"
    `);
    await queryRunner.query(`
      ALTER TABLE "list_lines"
        DROP COLUMN IF EXISTS "deletedByUserId",
        DROP COLUMN IF EXISTS "deletedAt"
    `);
  }
}
