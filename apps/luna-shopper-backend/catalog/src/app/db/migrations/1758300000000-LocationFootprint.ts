import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A shop knows its size (plan 0176).
 *
 * `footprintM2` is the area of the shop's building outline in whole square
 * metres, as OpenStreetMap maps it. Nullable, and null on every row this
 * migration meets: a shop mapped as a point has no outline, and the rows that
 * do have one gain the number when a store discovery run meets them again.
 *
 * `IF NOT EXISTS` and `IF EXISTS`, so running either direction twice changes
 * nothing more.
 */
export class LocationFootprint1758300000000 implements MigrationInterface {
  name = 'LocationFootprint1758300000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "supermarket_locations"
         ADD COLUMN IF NOT EXISTS "footprintM2" integer`
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "supermarket_locations" DROP COLUMN IF EXISTS "footprintM2"`
    );
  }
}
