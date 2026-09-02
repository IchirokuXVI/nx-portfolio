import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The country a discovery run was searching, on the places it found (plan 0061,
 * section 4).
 *
 * The runner always had it in its own `StoreDiscoveryInput` and discarded it,
 * so `import()` hardcoded `country: null` on the location it created. That is
 * the column catalog needs to key the centroid lookup that fills the postcode
 * two thirds of OSM stores lack.
 *
 * **Existing rows are left null rather than assumed to be `es`.** Every place
 * discovered so far was found by a Spanish run, but this table records what a
 * run reported, and inventing a value it never reported would be indistinguishable
 * afterwards from one it did. A re run fills them, and catalog's own backfill
 * covers the locations already imported from them.
 */
export class DiscoveredPlaceCountry1756300000000 implements MigrationInterface {
  name = 'DiscoveredPlaceCountry1756300000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "discovered_places"
        ADD COLUMN "country" character varying(2)
    `);
    await queryRunner.query(`
      COMMENT ON COLUMN "discovered_places"."country" IS
        'ISO 3166-1 alpha-2, from the run that found the place and not from an OSM tag (plan 0061). Keys the postal code centroid lookup on import.'
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "discovered_places" DROP COLUMN "country"
    `);
  }
}
