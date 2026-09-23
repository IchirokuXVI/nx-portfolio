import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The price scope key a run declared for a place (plan 0152, section 1).
 *
 * A hand import dropped it, because it survived only as a tag
 * (`mercadona:warehouse`, `lidl:offerRegion`) and nothing read the tag. The
 * column is what the import joins the chain's scope by.
 *
 * Additive and nullable, with no backfill: a row written before this migration
 * has no column value, and the service reads the key from the tag for it.
 */
export class DiscoveredPlaceScopeKey1757500000000 implements MigrationInterface {
  name = 'DiscoveredPlaceScopeKey1757500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "discovered_places" ADD COLUMN "scopeKey" varchar`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "discovered_places" DROP COLUMN "scopeKey"`
    );
  }
}
