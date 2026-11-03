import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A merged product stays, and names the one that replaced it (plan 0239).
 *
 * Two columns, one check and one index, all additive:
 *
 * - `items.mergedIntoId` names the survivor of a merge, or is null. A foreign
 *   key onto `items` with `ON DELETE RESTRICT`, so a survivor cannot be
 *   deleted while a merged row still names it.
 * - `items.mergedAt` is when the merge was written.
 * - `ck_items_merged_into_other` refuses a row that names itself.
 * - `ix_items_merged_into` is partial on `NOT NULL`: almost every product is
 *   live, and the reads that look for a merged row look by its survivor (the
 *   one level rule, the delete, and the foreign key's own check).
 *
 * **Nothing is merged by this migration.** Every existing row stays live, and
 * no other table changes.
 *
 * `down` drops the index, the check, the key and both columns. A merge that
 * was written is then lost: the merged row reads as a live product again.
 */
export class MergedItems1759100000000 implements MigrationInterface {
  name = 'MergedItems1759100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "items"
        ADD "mergedIntoId" uuid,
        ADD "mergedAt" timestamptz,
        ADD CONSTRAINT "fk_items_merged_into" FOREIGN KEY ("mergedIntoId")
          REFERENCES "items" ("id") ON DELETE RESTRICT,
        ADD CONSTRAINT "ck_items_merged_into_other"
          CHECK ("mergedIntoId" IS NULL OR "mergedIntoId" <> "id")
    `);
    await queryRunner.query(`
      CREATE INDEX "ix_items_merged_into" ON "items" ("mergedIntoId")
        WHERE "mergedIntoId" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "ix_items_merged_into"`);
    await queryRunner.query(`
      ALTER TABLE "items"
        DROP CONSTRAINT "ck_items_merged_into_other",
        DROP CONSTRAINT "fk_items_merged_into",
        DROP COLUMN "mergedAt",
        DROP COLUMN "mergedIntoId"
    `);
  }
}
