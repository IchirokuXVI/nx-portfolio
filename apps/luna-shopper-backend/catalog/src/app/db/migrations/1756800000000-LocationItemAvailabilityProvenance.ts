import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `supermarket_location_items` gains provenance for `available` (plan 0084,
 * section 2).
 *
 * The sentence this migration retires is "an automated source can only ever
 * populate availability at the scope level". That was a finding about one
 * source: Mercadona's availability signal is a 404 on a warehouse scoped detail
 * call, and a warehouse cannot say whether one particular shop stocks a product.
 * DEZA states, per product, which of its shops carry it. So the column stays
 * where it is and gains provenance, which is the same move plan 0038 section 5.3
 * made for the price when a second writer appeared.
 *
 * **All three columns are nullable with no default, and that is the whole
 * decision.** A row that exists before this migration was written by a person or
 * by nothing, and the migration cannot tell which. A default of `ADMIN` claims
 * the first and protects rows nobody typed; a default of `OFFICIAL_WEB` claims
 * the second and lets a crawl overwrite a person. Null means "no provenance
 * recorded", and the write path reads a null kind beside a non null `available`
 * as `ADMIN`, because nothing but a person ever wrote that column before today.
 *
 * **Not a dated table.** Plan 0080 built `item_prices` as intervals because a
 * price is compared over time and the history is the product. Availability is a
 * boolean whose history nobody reads, at a row count of products times shops.
 * One current value with provenance is the whole requirement, and
 * `availabilitySourceRunId` still lets plan 0082 find what a run touched.
 */
export class LocationItemAvailabilityProvenance1756800000000 implements MigrationInterface {
  name = 'LocationItemAvailabilityProvenance1756800000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "supermarket_location_items"
        ADD COLUMN "availabilitySourceKind" "price_source_kind",
        ADD COLUMN "availabilityObservedAt" timestamptz,
        ADD COLUMN "availabilitySourceRunId" uuid
    `);

    // Plan 0082 asks "what did this run touch", and it asks it of a run rather
    // than of a product. Without the index that is a sequential scan of a table
    // whose row count is products times shops.
    await queryRunner.query(`
      CREATE INDEX "ix_location_items_availability_run"
        ON "supermarket_location_items" ("availabilitySourceRunId")
        WHERE "availabilitySourceRunId" IS NOT NULL
    `);

    await queryRunner.query(`
      COMMENT ON COLUMN "supermarket_location_items"."availabilitySourceKind" IS
        'Who last wrote available (plan 0084). Null means no provenance was recorded; a null kind beside a non null available is read as ADMIN, because nothing else ever wrote it.'
    `);
    await queryRunner.query(`
      COMMENT ON COLUMN "supermarket_location_items"."availabilitySourceRunId" IS
        'The harvest run that wrote it. Opaque: catalog never joins it to anything.'
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "ix_location_items_availability_run"`
    );
    await queryRunner.query(`
      ALTER TABLE "supermarket_location_items"
        DROP COLUMN IF EXISTS "availabilitySourceRunId",
        DROP COLUMN IF EXISTS "availabilityObservedAt",
        DROP COLUMN IF EXISTS "availabilitySourceKind"
    `);
  }
}
