import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Rung 4 gets a second key, the words of the name in any order (plan 0221).
 *
 * `item_source_match` gains `NAME_WORDS_SIZE`. The value is added with `ALTER
 * TYPE ... ADD VALUE`, which Postgres allows inside the one transaction
 * `harvester/src/migrate.ts` runs, because nothing in this migration uses the
 * value. The first row that holds it is written by a run, after the deploy
 * committed.
 *
 * It writes no row, so it has nothing to repair.
 */
export class NameWordsSizeMatch1760200000000 implements MigrationInterface {
  name = 'NameWordsSizeMatch1760200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "item_source_match" ADD VALUE IF NOT EXISTS 'NAME_WORDS_SIZE'`
    );
  }

  /**
   * Postgres cannot drop a label, so the type is rebuilt without it, as
   * `SharedEan` rebuilds it. A row that holds the value first goes back to
   * `NAME_SIZE`, the rung 4 value it would have held before this plan. Its
   * status and its proposal stay: it is still a `CANDIDATE` for that product.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "source_catalog_entries"
         SET "matchedBy" = 'NAME_SIZE',
             "updatedAt" = now()
       WHERE "matchedBy" = 'NAME_WORDS_SIZE'
    `);
    // No run writes the value onto a location, but the type is shared, so
    // the cast below must be safe on every column that holds it.
    await queryRunner.query(`
      UPDATE "source_locations"
         SET "matchedBy" = 'NAME_SIZE',
             "updatedAt" = now()
       WHERE "matchedBy" = 'NAME_WORDS_SIZE'
    `);
    await queryRunner.query(
      `ALTER TYPE "item_source_match" RENAME TO "item_source_match_old"`
    );
    await queryRunner.query(
      `CREATE TYPE "item_source_match" AS ENUM ('EAN', 'NAME_BRAND_SIZE', 'NAME_SIZE', 'MANUAL', 'SHARED_EAN')`
    );
    for (const table of ['source_locations', 'source_catalog_entries']) {
      await queryRunner.query(`
        ALTER TABLE "${table}"
          ALTER COLUMN "matchedBy" TYPE "item_source_match"
          USING "matchedBy"::text::"item_source_match"
      `);
    }
    await queryRunner.query(`DROP TYPE "item_source_match_old"`);
  }
}
