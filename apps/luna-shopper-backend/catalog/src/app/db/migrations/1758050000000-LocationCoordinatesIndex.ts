import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * An index on where a shop is (plan 0164, section 1).
 *
 * The shops near a point are read by a bounding box on `latitude` and
 * `longitude`, and exact distance is computed over what the box keeps. A plain
 * btree on the two columns serves that range: there are a few thousand shops,
 * so no extension is needed, and plan 0164 forbids adding one. The postal code
 * centroids have had the same index since plan 0060.
 *
 * A shop with no coordinates is never a candidate. Its row is in the index with
 * nulls, and the range condition leaves it out.
 *
 * `IF NOT EXISTS` and `IF EXISTS`, so running either direction twice changes
 * nothing more. Not `CONCURRENTLY`: `migrate.ts` runs every pending migration
 * in one transaction, and the table is small enough that the lock is brief.
 */
export class LocationCoordinatesIndex1758050000000 implements MigrationInterface {
  name = 'LocationCoordinatesIndex1758050000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "ix_locations_geo"
         ON "supermarket_locations" ("latitude", "longitude")`
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "ix_locations_geo"`);
  }
}
