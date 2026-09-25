import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * An EAN that several rows of one chain share binds none of them (plan 0155).
 *
 * Two steps, in one transaction:
 *
 * 1. `item_source_match` gains `SHARED_EAN`. The type is **rebuilt** by
 *    rename, create and convert, as `OneSourceProduct` did, because
 *    `harvester/src/migrate.ts` runs every pending migration in one
 *    transaction, and Postgres refuses to use a label that `ALTER TYPE ... ADD
 *    VALUE` added before that transaction commits. Step 2 uses it at once.
 * 2. **The repair.** Every row the EAN rung made `ACTIVE` whose EAN another row
 *    of the same chain also carries goes back to the queue as a `CANDIDATE`
 *    with `SHARED_EAN`, keeping its item as the proposal. A row a person
 *    accepted (`matchedBy` other than `EAN`) is not touched.
 *
 * The repair writes no price and deletes no price row, here or in catalog: a
 * price such a row wrote stays until it expires. Running it again changes
 * nothing, because a repaired row is no longer `ACTIVE`.
 */
export class SharedEan1757600000000 implements MigrationInterface {
  name = 'SharedEan1757600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await rebuildMatchType(queryRunner, [
      'EAN',
      'NAME_BRAND_SIZE',
      'NAME_SIZE',
      'MANUAL',
      'SHARED_EAN',
    ]);

    await queryRunner.query(`
      UPDATE "source_catalog_entries" AS e
         SET "status" = 'CANDIDATE',
             "matchedBy" = 'SHARED_EAN',
             "confidence" = 0.6,
             "candidateEntryId" = NULL,
             "decidedAt" = NULL,
             "updatedAt" = now()
       WHERE e."status" = 'ACTIVE'
         AND e."matchedBy" = 'EAN'
         AND e."ean" IS NOT NULL
         AND EXISTS (
               SELECT 1
                 FROM "source_catalog_entries" AS o
                WHERE o."supermarketId" = e."supermarketId"
                  AND o."ean" = e."ean"
                  AND o."id" <> e."id"
             )
    `);
  }

  /**
   * Back to what the ladder before this plan would have made of a shared EAN:
   * bound, by EAN. That is the state the repair undid, and the old type cannot
   * say anything else about these rows.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "source_catalog_entries"
         SET "status" = 'ACTIVE',
             "matchedBy" = 'EAN',
             "confidence" = 1,
             "decidedAt" = now(),
             "updatedAt" = now()
       WHERE "matchedBy" = 'SHARED_EAN'
         AND "itemId" IS NOT NULL
    `);
    await queryRunner.query(`
      UPDATE "source_catalog_entries"
         SET "status" = 'UNRESOLVED',
             "matchedBy" = NULL,
             "confidence" = 0
       WHERE "matchedBy" = 'SHARED_EAN'
    `);
    await rebuildMatchType(queryRunner, [
      'EAN',
      'NAME_BRAND_SIZE',
      'NAME_SIZE',
      'MANUAL',
    ]);
  }
}

/**
 * Replace `item_source_match` with a type holding exactly `labels`. Both
 * columns of the type convert through text, so every label they hold must be
 * in the list.
 */
async function rebuildMatchType(
  queryRunner: QueryRunner,
  labels: readonly string[]
): Promise<void> {
  await queryRunner.query(
    `ALTER TYPE "item_source_match" RENAME TO "item_source_match_old"`
  );
  await queryRunner.query(
    `CREATE TYPE "item_source_match" AS ENUM (${labels
      .map((label) => `'${label}'`)
      .join(', ')})`
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
