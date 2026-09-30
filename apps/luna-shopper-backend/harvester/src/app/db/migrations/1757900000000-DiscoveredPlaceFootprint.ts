import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The size of a place's mapped outline (plan 0176).
 *
 * A store discovery run measures the area of every shop OpenStreetMap maps as a
 * way or a relation, and the place carries that number until an import writes
 * it onto the catalog location. Without a column here the number would be lost
 * between the run and the import, which is a separate step.
 *
 * Additive and nullable, with no backfill: the next run over a code fills the
 * places it meets, and a node never has one.
 */
export class DiscoveredPlaceFootprint1757900000000 implements MigrationInterface {
  name = 'DiscoveredPlaceFootprint1757900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "discovered_places" ADD COLUMN "footprintM2" integer`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "discovered_places" DROP COLUMN "footprintM2"`
    );
  }
}
