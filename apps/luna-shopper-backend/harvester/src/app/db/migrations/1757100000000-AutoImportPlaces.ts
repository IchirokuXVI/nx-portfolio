import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Plan 0107: a postal code asks every configured place source, and a chain an
 * operator has marked trusted writes its shops straight into the catalog.
 *
 * Two columns, and they belong to one change even though they sit on two
 * tables. `autoImportPlaces` is the trust switch of section 3.1.
 * `requeuedAt` is what keeps section 2.1 from breaking plan 0097's "discover it
 * again, now": once a code is due per source rather than per code, a requeue of
 * a code every source answered last week would find nothing due and mark the
 * row done without asking anybody anything.
 *
 * Both are nullable or defaulted, so the existing rows need no backfill: every
 * chain starts untrusted and no code has been requeued.
 */
export class AutoImportPlaces1757100000000 implements MigrationInterface {
  name = 'AutoImportPlaces1757100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "supermarket_sources"
        ADD COLUMN "autoImportPlaces" boolean NOT NULL DEFAULT false
    `);
    await queryRunner.query(`
      ALTER TABLE "postal_code_discovery_requests"
        ADD COLUMN "requeuedAt" timestamptz
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "postal_code_discovery_requests" DROP COLUMN "requeuedAt"`
    );
    await queryRunner.query(
      `ALTER TABLE "supermarket_sources" DROP COLUMN "autoImportPlaces"`
    );
  }
}
