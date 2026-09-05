import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A leaflet is a source (plan 0081).
 *
 * Four things, in one transaction:
 *
 * 1. `LEAFLET_IMPORT` on `harvest_run_mode` and `NAME_SIZE` on
 *    `item_source_match`.
 * 2. Four columns on `harvest_runs`: the document's digest, the run's warnings,
 *    the offers a rule dropped, and `revertedAt`.
 * 3. `source_aliases`, the names a chain printed.
 * 4. The per document dedupe index.
 *
 * **Neither new enum label may be used in this transaction, and neither is.**
 * Postgres 12 and later allow `ALTER TYPE ... ADD VALUE` inside a transaction
 * block but refuse to *use* the new label before it commits, and TypeORM runs a
 * migration in a transaction. So `source_aliases."matchedBy"` is created with no
 * `DEFAULT`: the writers state it, which they would have to anyway, and the
 * alternative (rebuilding both types) would drop and recreate the partial unique
 * index that holds the one active run per chain.
 */
export class LeafletImport1756600000000 implements MigrationInterface {
  name = 'LeafletImport1756600000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    // 1. The two new labels. `IF NOT EXISTS` so a partially applied migration
    // can be re-run, which is the one thing enum changes make awkward.
    await queryRunner.query(
      `ALTER TYPE "harvest_run_mode" ADD VALUE IF NOT EXISTS 'LEAFLET_IMPORT'`
    );
    await queryRunner.query(
      `ALTER TYPE "item_source_match" ADD VALUE IF NOT EXISTS 'NAME_SIZE'`
    );

    // 2. What a run now records beyond its counters.
    await queryRunner.query(
      `ALTER TABLE "harvest_runs" ADD "documentSha256" character varying`
    );
    await queryRunner.query(
      `ALTER TABLE "harvest_runs" ADD "warnings" jsonb NOT NULL DEFAULT '[]'::jsonb`
    );
    await queryRunner.query(
      `ALTER TABLE "harvest_runs" ADD "skipped" integer NOT NULL DEFAULT 0`
    );
    // Nullable and unwritten by this plan. It is here because the index below
    // has to name it, and rebuilding a unique index on this table later is
    // worse than one column plan 0082 fills.
    await queryRunner.query(
      `ALTER TABLE "harvest_runs" ADD "revertedAt" TIMESTAMP WITH TIME ZONE`
    );
    await queryRunner.query(`
      COMMENT ON COLUMN "harvest_runs"."input" IS
        'The run own input, kept so a re-run can repeat it exactly. For a LEAFLET_IMPORT it is the uploaded document (plan 0081, section 7), which plan 0082 reads to revert and an alias accept reads to write the price it was queued for.'
    `);

    // 3. The names a chain printed. A new type, so its labels are usable here.
    await queryRunner.query(
      `CREATE TYPE "source_alias_status" AS ENUM (
        'ACTIVE', 'CANDIDATE', 'UNRESOLVED', 'REJECTED'
      )`
    );
    await queryRunner.query(`
      CREATE TABLE "source_aliases" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "supermarketId" uuid NOT NULL,
        "aliasKey" character varying NOT NULL,
        "printedName" character varying NOT NULL,
        "printedFormat" character varying,
        "printedBrand" character varying,
        "itemId" uuid,
        "candidateItemId" uuid,
        "candidateEntryId" uuid,
        "status" "source_alias_status" NOT NULL DEFAULT 'UNRESOLVED',
        "matchedBy" "item_source_match" NOT NULL,
        "confidence" numeric(4,3) NOT NULL DEFAULT 0,
        "timesSeen" integer NOT NULL DEFAULT 1,
        "firstSeenAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "lastSeenAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "firstRunId" uuid,
        "lastRunId" uuid,
        CONSTRAINT "pk_source_aliases" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      COMMENT ON TABLE "source_aliases" IS
        'One name a chain printed for a product (plan 0081, section 2). Chain scoped, many aliases per item. Accepting sets itemId and never touches printedName, so renaming the item does not stop the next leaflet resolving.'
    `);
    // One row per printed string per chain. The key is the normalized name plus
    // the normalized format and deliberately not the brand (section 2.1).
    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_source_aliases_key"
        ON "source_aliases" ("supermarketId", "aliasKey")
    `);
    // The queue reads by status; plan 0082 deletes the undecided rows of a run.
    await queryRunner.query(
      `CREATE INDEX "ix_source_aliases_status" ON "source_aliases" ("status")`
    );
    await queryRunner.query(
      `CREATE INDEX "ix_source_aliases_first_run" ON "source_aliases" ("firstRunId")`
    );

    // 4. One import per document per chain (section 7).
    //
    // A run that FAILED does not block a retry, and a run that was reverted does
    // not block a corrected upload, which is plan 0082's requirement.
    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_harvest_run_leaflet_document"
        ON "harvest_runs" ("supermarketId", "documentSha256")
        WHERE "documentSha256" IS NOT NULL
          AND status <> 'FAILED'
          AND "revertedAt" IS NULL
    `);
  }

  /**
   * Postgres has no `ALTER TYPE ... DROP VALUE`, so undoing the two labels means
   * rebuilding both types. `harvest_run_mode` carries the store discovery lock
   * index in its predicate, which is dropped and recreated around the swap.
   */
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "uq_harvest_run_leaflet_document"`
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "source_aliases"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "source_alias_status"`);
    await queryRunner.query(
      `ALTER TABLE "harvest_runs" DROP COLUMN IF EXISTS "revertedAt"`
    );
    await queryRunner.query(
      `ALTER TABLE "harvest_runs" DROP COLUMN IF EXISTS "skipped"`
    );
    await queryRunner.query(
      `ALTER TABLE "harvest_runs" DROP COLUMN IF EXISTS "warnings"`
    );
    await queryRunner.query(
      `ALTER TABLE "harvest_runs" DROP COLUMN IF EXISTS "documentSha256"`
    );

    await queryRunner.query(
      `ALTER TYPE "item_source_match" RENAME TO "item_source_match_new"`
    );
    await queryRunner.query(
      `CREATE TYPE "item_source_match" AS ENUM (
        'EXTERNAL_ID', 'EAN', 'NAME_BRAND_SIZE', 'MANUAL'
      )`
    );
    await queryRunner.query(
      `ALTER TABLE "item_source_refs"
         ALTER COLUMN "matchedBy" TYPE "item_source_match"
         USING "matchedBy"::text::"item_source_match"`
    );
    await queryRunner.query(`DROP TYPE "item_source_match_new"`);

    await queryRunner.query(
      `DELETE FROM "harvest_runs" WHERE mode::text = 'LEAFLET_IMPORT'`
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "uq_harvest_run_active_store_discovery"`
    );
    await queryRunner.query(
      `ALTER TYPE "harvest_run_mode" RENAME TO "harvest_run_mode_new"`
    );
    await queryRunner.query(
      `CREATE TYPE "harvest_run_mode" AS ENUM (
        'STORE_DISCOVERY', 'CATALOG_DISCOVERY', 'REFRESH'
      )`
    );
    await queryRunner.query(
      `ALTER TABLE "harvest_runs"
         ALTER COLUMN "mode" TYPE "harvest_run_mode"
         USING "mode"::text::"harvest_run_mode"`
    );
    await queryRunner.query(`DROP TYPE "harvest_run_mode_new"`);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_harvest_run_active_store_discovery"
        ON "harvest_runs" ("mode")
        WHERE mode = 'STORE_DISCOVERY'
          AND status IN ('PENDING', 'RUNNING')
    `);
  }
}
