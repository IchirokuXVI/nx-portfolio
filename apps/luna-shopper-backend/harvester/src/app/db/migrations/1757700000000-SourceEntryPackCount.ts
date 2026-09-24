import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * How many units the pack holds, as the source stated it (plan 0162, section 2).
 *
 * It belongs to the source group of the row, beside `sizeFormat`: every run
 * that sees the entry rewrites it, and a decision never touches it. Nullable,
 * because most products are not packs and every row that exists before this
 * migration has none until a run sees it again.
 *
 * The bounds restate catalog's `chk_items_pack_count`, so a count this row
 * holds is always one catalog accepts.
 */
export class SourceEntryPackCount1757700000000 implements MigrationInterface {
  name = 'SourceEntryPackCount1757700000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "source_catalog_entries"
         ADD COLUMN IF NOT EXISTS "packCount" smallint`
    );
    await queryRunner.query(
      `ALTER TABLE "source_catalog_entries"
         ADD CONSTRAINT "chk_source_catalog_entries_pack_count"
         CHECK ("packCount" BETWEEN 2 AND 1000)`
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "source_catalog_entries"
         DROP CONSTRAINT IF EXISTS "chk_source_catalog_entries_pack_count"`
    );
    await queryRunner.query(
      `ALTER TABLE "source_catalog_entries" DROP COLUMN IF EXISTS "packCount"`
    );
  }
}
