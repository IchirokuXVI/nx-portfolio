import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The unit a row's `unitSize` is in, as the source's own adapter stated it
 * (plan 0177).
 *
 * It belongs to the source group of the row, beside `unitSize` and
 * `sizeFormat`: every run that sees the entry rewrites it, and a decision never
 * touches it.
 *
 * **Nothing is backfilled, and that is the design.** The printed text cannot
 * say which unit a stored number is in, because the sources disagree about it:
 * one converted `75cl` to 750 and another kept `6x33cl` at 198. A backfill
 * read from `sizeFormat` would be the very guess this column replaces. So
 * every row that exists before this migration holds null until a run sees it
 * again, and a reader that meets a null falls back to the printed text.
 *
 * **`sizeFormat` and `externalId` are not written at all.** The first is half
 * of the alias key (plan 0081) and the second is the row's identity, and a
 * changed key detaches every leaflet alias and every replay of a curation
 * export.
 *
 * The check restates `SOURCE_SIZE_UNITS` in contracts. `PACK` is not one of
 * them: how many a pack holds is `packCount`.
 */
export class SourceEntrySizeUnit1758000000000 implements MigrationInterface {
  name = 'SourceEntrySizeUnit1758000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "source_catalog_entries"
         ADD COLUMN IF NOT EXISTS "sizeUnit" varchar(16)`
    );
    await queryRunner.query(
      `ALTER TABLE "source_catalog_entries"
         ADD CONSTRAINT "chk_source_catalog_entries_size_unit"
         CHECK ("sizeUnit" IN ('GRAM', 'KILOGRAM', 'MILLILITER', 'LITER', 'UNIT'))`
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "source_catalog_entries"
         DROP CONSTRAINT IF EXISTS "chk_source_catalog_entries_size_unit"`
    );
    await queryRunner.query(
      `ALTER TABLE "source_catalog_entries" DROP COLUMN IF EXISTS "sizeUnit"`
    );
  }
}
