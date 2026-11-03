import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Whole walks that did not list a product, per scope (plan 0220, section 11).
 *
 * - `source_entry_scope_presence` holds one row per source row and scope that
 *   a counted walk tracked, with the misses in a row, the first of them, when
 *   the pair went gone, the last run that counted it, and whether catalog has
 *   acknowledged the last transition.
 * - `source_catalog_entries.delistedAt` says when every counted scope lost the
 *   product. Only the counter writes it.
 *
 * **No backfill.** The first time a walk counts a scope, the counter seeds it
 * from the prices that scope already read (section 4.2, step 2).
 *
 * Additive. `down` drops the table, the column and its index.
 */
export class SourceEntryScopePresence1759900000000 implements MigrationInterface {
  name = 'SourceEntryScopePresence1759900000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "source_entry_scope_presence" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        "entryId" uuid NOT NULL,
        "priceScopeId" uuid NOT NULL,
        "missedWalks" smallint NOT NULL DEFAULT 0,
        "firstMissedAt" timestamptz,
        "goneAt" timestamptz,
        "lastCountedRunId" uuid,
        "pendingCatalog" boolean NOT NULL DEFAULT false,
        CONSTRAINT "pk_source_entry_scope_presence" PRIMARY KEY ("id"),
        CONSTRAINT "uq_source_entry_scope_presence"
          UNIQUE ("entryId", "priceScopeId"),
        CONSTRAINT "fk_source_entry_scope_presence_entry"
          FOREIGN KEY ("entryId")
          REFERENCES "source_catalog_entries" ("id") ON DELETE CASCADE
      )
    `);
    // A counted walk reads every row of one scope.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "ix_source_entry_scope_presence_scope"
        ON "source_entry_scope_presence" ("priceScopeId")
    `);
    // The gone pairs of an entry, for the row of the chain and for a bind.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "ix_source_entry_scope_presence_gone"
        ON "source_entry_scope_presence" ("entryId")
        WHERE "goneAt" IS NOT NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "source_catalog_entries"
        ADD COLUMN IF NOT EXISTS "delistedAt" timestamptz
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "ix_source_catalog_entries_delisted"
        ON "source_catalog_entries" ("delistedAt")
        WHERE "delistedAt" IS NOT NULL
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "ix_source_catalog_entries_delisted"`
    );
    await queryRunner.query(
      `ALTER TABLE "source_catalog_entries" DROP COLUMN IF EXISTS "delistedAt"`
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "source_entry_scope_presence"`
    );
  }
}
