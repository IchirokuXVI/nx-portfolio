import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Whether a row is sold by weight, as the source's own adapter stated it (plan
 * 0181).
 *
 * It belongs to the source group of the row, beside `unitSize`, `sizeUnit` and
 * `sizeFormat`: every run that reads the product whole rewrites it, and a
 * decision never touches it.
 *
 * **Nothing is backfilled, and that is the design.** Whether a product is sold
 * by weight is a field of the source's own payload (`approx_size` at
 * Mercadona, a bare `kg` at El Jamón, a `kg` basis on a leaflet tile), and
 * none of those is stored on the row. A backfill read from `sizeFormat` would
 * call every fixed pack of 0.3 kg sold by weight. So every row that exists
 * before this migration says false until a run reads it again, which is what
 * it said before the column existed.
 *
 * **`sizeFormat` and `externalId` are not written at all.** The first is half
 * of the alias key (plan 0081) and the second is the row's identity.
 */
export class SourceEntrySoldByWeight1758100000000 implements MigrationInterface {
  name = 'SourceEntrySoldByWeight1758100000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "source_catalog_entries"
         ADD COLUMN IF NOT EXISTS "soldByWeight" boolean NOT NULL DEFAULT false`
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "source_catalog_entries"
         DROP COLUMN IF EXISTS "soldByWeight"`
    );
  }
}
