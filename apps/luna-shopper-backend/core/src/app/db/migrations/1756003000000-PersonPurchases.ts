import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * One person's purchases, found through every basket they ever shopped (plan
 * 0142, section 9).
 *
 * One index swapped for a wider one. No column, no backfill, nothing lossy.
 *
 * The third route of section 2 needs a person's participant rows **live or
 * ended**: being removed from a basket afterwards does not unbuy the bread, so
 * a purchase they settled there is still theirs. The index that served that
 * column was partial on `"revokedAt" IS NULL`, and a partial index cannot find
 * an ended row, so the read would fall back to a sequential scan of every
 * participant of every basket in the cluster.
 *
 * The wider index serves the shared baskets read of plan 0114 section 8 just as
 * well: that read filters `"revokedAt" IS NULL` over one person's rows, which
 * are a handful, so dropping the predicate costs it a filter over a few rows
 * and saves the database a second index on one column. One column, one index,
 * so the narrow one goes.
 *
 * `"userId" IS NOT NULL` stays. A guest participant has no account and can
 * never be an answer here, and the predicate keeps every one of them out of the
 * index.
 *
 * Plan 0144 renames the table, and this index with it.
 */
export class PersonPurchases1756003000000 implements MigrationInterface {
  name = 'PersonPurchases1756003000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX "ix_generated_list_participants_user"
        ON "generated_list_participants" ("userId")
        WHERE "userId" IS NOT NULL
    `);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "ix_generated_list_participants_user_live"`
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX "ix_generated_list_participants_user_live"
        ON "generated_list_participants" ("userId")
        WHERE "userId" IS NOT NULL AND "revokedAt" IS NULL
    `);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "ix_generated_list_participants_user"`
    );
  }
}
