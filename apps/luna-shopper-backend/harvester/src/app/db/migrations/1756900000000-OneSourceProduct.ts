import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * TypeORM's own logger rather than Nest's, because a migration runs in three
 * places and only one of them is a Nest process: the bundled `migrate.js` the
 * deploy Job runs, the `migration:run` CLI, and the integration suite. Reaching
 * for `@nestjs/common` here would add a package to a bundle that has no other
 * reason to hold one.
 */
function warn(queryRunner: QueryRunner, message: string): void {
  queryRunner.connection.logger.log('warn', message);
}

/**
 * One source product, however the source said it (plan 0086, section 11).
 *
 * `item_source_refs` and `source_aliases` fold into `source_catalog_entries`,
 * the price columns on that row become `source_entry_prices` (one per scope),
 * the owner facing `REFRESH` mode goes, and `LEAFLET_IMPORT` becomes
 * `FILE_IMPORT`.
 *
 * **The whole of it runs in one transaction, which the leaflet migration could
 * not.** That one had to add labels to types that already existed, and Postgres
 * refuses to *use* a label added by `ALTER TYPE ... ADD VALUE` before the
 * transaction commits. Nothing here adds a label: `source_entry_status` and
 * `price_source_kind` are new types, whose labels are usable immediately, and
 * `harvest_run_mode` and `item_source_match` are **rebuilt** by rename, create
 * and convert, which carries no such restriction. The rename and the drop of a
 * label happen in the same swap, which is why `LEAFLET_IMPORT` needs no
 * `RENAME VALUE` of its own.
 *
 * Two things it deliberately does not preserve, both stated in the plan:
 *
 * - **The `REFRESH` runs are deleted.** No cluster has ever started one:
 *   harvesting was never enabled for a chain in staging or production (plan
 *   0083), so the rows this deletes exist on developer slots only. The prices
 *   those runs wrote in catalog are rows of their own and stay.
 * - **A folded alias gets no price row.** The alias never held one, the
 *   documents the old runs stored are in a shape whose rules this plan deletes,
 *   and the next import of a current leaflet fills it. A queued alias accepted
 *   after the migration and before that import binds and writes nothing, which
 *   the accept's own answer says.
 */
export class OneSourceProduct1756900000000 implements MigrationInterface {
  name = 'OneSourceProduct1756900000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    // --- 1. The two new types ------------------------------------------------
    //
    // `price_source_kind` carries all six of catalog's labels rather than the
    // three official ones a row may hold today. Backlog 0008's till receipts are
    // observations of kind USER_RECEIPT on this same table, and a type that
    // already names them costs nothing now and saves a rebuild then.
    await queryRunner.query(`
      CREATE TYPE "source_entry_status" AS ENUM (
        'ACTIVE', 'CANDIDATE', 'UNRESOLVED', 'REJECTED'
      )
    `);
    await queryRunner.query(`
      CREATE TYPE "price_source_kind" AS ENUM (
        'OFFICIAL_API', 'OFFICIAL_WEB', 'OFFICIAL_LEAFLET',
        'ADMIN', 'USER_RECEIPT', 'USER_REPORTED'
      )
    `);

    // --- 2. The price per scope ---------------------------------------------
    await queryRunner.query(`
      CREATE TABLE "source_entry_prices" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        "entryId" uuid NOT NULL,
        "priceScopeId" uuid NOT NULL,
        "price" numeric(12,2),
        "currency" varchar(3) NOT NULL DEFAULT 'EUR',
        "unitPrice" numeric(12,4),
        "unitPriceLabel" varchar,
        "validFrom" timestamptz,
        "validUntil" timestamptz,
        "details" jsonb,
        "observedAt" timestamptz NOT NULL DEFAULT now(),
        "runId" uuid,
        CONSTRAINT "pk_source_entry_prices" PRIMARY KEY ("id"),
        CONSTRAINT "uq_source_entry_prices_scope"
          UNIQUE ("entryId", "priceScopeId"),
        CONSTRAINT "fk_source_entry_prices_entry" FOREIGN KEY ("entryId")
          REFERENCES "source_catalog_entries" ("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      COMMENT ON TABLE "source_entry_prices" IS
        'The latest price each scope stated for one source product (plan 0086, section 3.2). A chain has several leaflets at once, each for a region: the decision about a product is one and the prices are one per scope. Accepting the row writes every one of these that is still valid, each into its own scope with its own run id.'
    `);
    await queryRunner.query(
      `CREATE INDEX "ix_source_entry_prices_run" ON "source_entry_prices" ("runId")`
    );

    // --- 3. The new columns on the one table --------------------------------
    //
    // `sourceKind` defaults to OFFICIAL_API for the rows that exist, which is
    // what a Mercadona walk wrote, then is overwritten for the chains whose
    // adapter renders a page. `matchedBy` takes the type as it stands, still
    // carrying EXTERNAL_ID; step 7 rebuilds it and converts this column with the
    // rest.
    await queryRunner.query(`
      ALTER TABLE "source_catalog_entries"
        ADD "sourceKind" "price_source_kind" NOT NULL DEFAULT 'OFFICIAL_API',
        ADD "extra" jsonb,
        ADD "timesSeen" integer NOT NULL DEFAULT 1,
        ADD "firstSeenAt" timestamptz NOT NULL DEFAULT now(),
        ADD "firstRunId" uuid,
        ADD "lastRunId" uuid,
        ADD "itemId" uuid,
        ADD "candidateEntryId" uuid,
        ADD "status" "source_entry_status" NOT NULL DEFAULT 'UNRESOLVED',
        ADD "matchedBy" "item_source_match",
        ADD "confidence" numeric(4,3) NOT NULL DEFAULT 0,
        ADD "decidedAt" timestamptz
    `);
    await queryRunner.query(`
      UPDATE "source_catalog_entries" e
         SET "sourceKind" = 'OFFICIAL_WEB'
        FROM "supermarket_sources" s
       WHERE s."supermarketId" = e."supermarketId"
         AND s."adapterKey" = 'deza-web'
    `);

    // A row that carried a price becomes one price row for the scope that
    // chain's runs wrote prices for.
    //
    // **The plan says "the chain's national scope" and this migration cannot
    // ask for it.** Price scopes live in catalog, the harvester holds them as
    // opaque ids, and a migration reaches nothing over NATS. The only scope id
    // in this database is `harvest_runs."priceScopeId"`, which is the scope the
    // chain's prices were in fact written for, so that is what a folded price is
    // attributed to: the most recent run of the chain that named one. A chain
    // with no such run has nowhere honest to put the number, so its rows get no
    // price row and the count is logged. Nothing is lost that matters: the
    // column was a snapshot no shopper ever read, and the next walk rewrites it.
    await queryRunner.query(`
      INSERT INTO "source_entry_prices" (
        "entryId", "priceScopeId", "price", "currency",
        "unitPrice", "unitPriceLabel", "observedAt", "runId"
      )
      SELECT e."id", scope."priceScopeId", e."price", 'EUR',
             e."unitPrice", e."unitPriceLabel", e."lastSeenAt", NULL
        FROM "source_catalog_entries" e
        JOIN LATERAL (
          SELECT r."priceScopeId"
            FROM "harvest_runs" r
           WHERE r."supermarketId" = e."supermarketId"
             AND r."priceScopeId" IS NOT NULL
           ORDER BY r."requestedAt" DESC
           LIMIT 1
        ) scope ON TRUE
       WHERE e."price" IS NOT NULL
    `);
    const [orphanPrices] = await queryRunner.query(`
      SELECT count(*)::int AS count
        FROM "source_catalog_entries" e
       WHERE e."price" IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM "harvest_runs" r
            WHERE r."supermarketId" = e."supermarketId"
              AND r."priceScopeId" IS NOT NULL
         )
    `);
    if (orphanPrices?.count > 0) {
      warn(
        queryRunner,
        `${orphanPrices.count} snapshot price(s) were dropped: no run of their ` +
          'chain ever named a price scope, so there is no scope to attribute ' +
          'them to. The next run of the chain writes them again.'
      );
    }

    await queryRunner.query(`
      ALTER TABLE "source_catalog_entries"
        DROP COLUMN "price",
        DROP COLUMN "unitPrice",
        DROP COLUMN "unitPriceLabel"
    `);

    // --- 4. Fold `item_source_refs` in --------------------------------------
    //
    // A ref whose row does not exist is counted, logged and dropped: a
    // `setManual` against a product no walk ever saw could make one, and there
    // is no name to give it and nothing will fetch it. Two refs on one row,
    // which the old index allowed and no run ever wrote, keep the one with the
    // later `lastResolvedAt`.
    const [orphanRefs] = await queryRunner.query(`
      SELECT count(*)::int AS count
        FROM "item_source_refs" r
       WHERE NOT EXISTS (
         SELECT 1 FROM "source_catalog_entries" e
          WHERE e."supermarketId" = r."supermarketId"
            AND e."externalId" = r."externalId"
       )
    `);
    if (orphanRefs?.count > 0) {
      warn(
        queryRunner,
        `${orphanRefs.count} item source ref(s) named a product no run has ` +
          'observed, so there is no row to fold them into and no name to give ' +
          'them. They are dropped: nothing fetches by external id any more.'
      );
    }
    await queryRunner.query(`
      UPDATE "source_catalog_entries" e
         SET "itemId" = r."itemId",
             "status" = (CASE r."status"::text
                           WHEN 'MANUAL' THEN 'ACTIVE'
                           ELSE r."status"::text
                         END)::"source_entry_status",
             "matchedBy" = (CASE
                              WHEN r."status"::text = 'MANUAL' THEN 'MANUAL'
                              ELSE r."matchedBy"::text
                            END)::"item_source_match",
             "confidence" = r."confidence",
             "decidedAt" = r."lastResolvedAt"
        FROM (
          SELECT DISTINCT ON ("supermarketId", "externalId") *
            FROM "item_source_refs"
           ORDER BY "supermarketId", "externalId",
                    "lastResolvedAt" DESC NULLS LAST
        ) r
       WHERE r."supermarketId" = e."supermarketId"
         AND r."externalId" = e."externalId"
    `);

    // --- 5. Move `source_aliases` in ----------------------------------------
    //
    // `externalId` is `sha1(aliasKey)`, which is exactly
    // `entryKey(printedName, printedFormat)`: `aliasKey` was that same
    // normalized string before the hash.
    //
    // An alias whose key collides with a row of the same chain is the meeting
    // section 3 wanted (a DEZA leaflet and the DEZA web listing naming one
    // product), and the alias's decision wins onto that row **when the row has
    // none**, which is what an UNRESOLVED status means.
    await queryRunner.query(`
      INSERT INTO "source_catalog_entries" (
        "supermarketId", "externalId", "sourceKind", "name", "brand",
        "sizeFormat", "categoryPath", "timesSeen", "firstSeenAt", "lastSeenAt",
        "firstRunId", "lastRunId", "itemId", "candidateEntryId", "status",
        "matchedBy", "confidence", "decidedAt"
      )
      SELECT a."supermarketId",
             encode(digest(a."aliasKey", 'sha1'), 'hex'),
             'OFFICIAL_LEAFLET'::"price_source_kind",
             a."printedName", a."printedBrand", a."printedFormat",
             '[]'::jsonb, a."timesSeen", a."firstSeenAt", a."lastSeenAt",
             a."firstRunId", a."lastRunId", a."itemId", a."candidateEntryId",
             a."status"::text::"source_entry_status",
             a."matchedBy", a."confidence",
             CASE WHEN a."status"::text IN ('ACTIVE', 'REJECTED')
                  THEN a."lastSeenAt" END
        FROM "source_aliases" a
      ON CONFLICT ON CONSTRAINT "uq_source_catalog_entry" DO UPDATE SET
        "timesSeen" = "source_catalog_entries"."timesSeen" + EXCLUDED."timesSeen",
        "itemId" = CASE
          WHEN "source_catalog_entries"."status" = 'UNRESOLVED'
          THEN EXCLUDED."itemId" ELSE "source_catalog_entries"."itemId" END,
        "candidateEntryId" = CASE
          WHEN "source_catalog_entries"."status" = 'UNRESOLVED'
          THEN EXCLUDED."candidateEntryId"
          ELSE "source_catalog_entries"."candidateEntryId" END,
        "matchedBy" = CASE
          WHEN "source_catalog_entries"."status" = 'UNRESOLVED'
          THEN EXCLUDED."matchedBy" ELSE "source_catalog_entries"."matchedBy" END,
        "confidence" = CASE
          WHEN "source_catalog_entries"."status" = 'UNRESOLVED'
          THEN EXCLUDED."confidence"
          ELSE "source_catalog_entries"."confidence" END,
        "decidedAt" = CASE
          WHEN "source_catalog_entries"."status" = 'UNRESOLVED'
          THEN EXCLUDED."decidedAt" ELSE "source_catalog_entries"."decidedAt" END,
        "status" = CASE
          WHEN "source_catalog_entries"."status" = 'UNRESOLVED'
          THEN EXCLUDED."status" ELSE "source_catalog_entries"."status" END
    `);

    // --- 6. The old tables and their types ----------------------------------
    //
    // Dropped before the `item_source_match` rebuild below, so that rebuild has
    // two columns to convert rather than four.
    await queryRunner.query(`DROP TABLE "item_source_refs"`);
    await queryRunner.query(`DROP TABLE "source_aliases"`);
    await queryRunner.query(`DROP TYPE "item_source_ref_status"`);
    await queryRunner.query(`DROP TYPE "source_alias_status"`);

    // --- 7. The two rebuilt types -------------------------------------------
    //
    // `harvest_run_mode` loses REFRESH and renames LEAFLET_IMPORT in one swap.
    // The store discovery lock names `mode` in its predicate, so it is dropped
    // and recreated around it.
    await queryRunner.query(
      `DELETE FROM "harvest_runs" WHERE "mode"::text = 'REFRESH'`
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "uq_harvest_run_active_store_discovery"`
    );
    await queryRunner.query(
      `ALTER TYPE "harvest_run_mode" RENAME TO "harvest_run_mode_old"`
    );
    await queryRunner.query(`
      CREATE TYPE "harvest_run_mode" AS ENUM (
        'STORE_DISCOVERY', 'CATALOG_DISCOVERY', 'FILE_IMPORT'
      )
    `);
    await queryRunner.query(`
      ALTER TABLE "harvest_runs"
        ALTER COLUMN "mode" TYPE "harvest_run_mode"
        USING (CASE WHEN "mode"::text = 'LEAFLET_IMPORT'
                    THEN 'FILE_IMPORT' ELSE "mode"::text END)::"harvest_run_mode"
    `);
    await queryRunner.query(`DROP TYPE "harvest_run_mode_old"`);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_harvest_run_active_store_discovery"
        ON "harvest_runs" ("mode")
        WHERE mode = 'STORE_DISCOVERY'
          AND status IN ('PENDING', 'RUNNING')
    `);

    // `item_source_match` loses EXTERNAL_ID, which nothing ever wrote: an
    // existing row was touched, and touching is not a match. A row that somehow
    // carries it becomes MANUAL on an entry, since it had already been decided,
    // and NAME_SIZE on a shop, whose column is NOT NULL and whose only automatic
    // rung is a name comparison.
    await queryRunner.query(
      `ALTER TYPE "item_source_match" RENAME TO "item_source_match_old"`
    );
    await queryRunner.query(`
      CREATE TYPE "item_source_match" AS ENUM (
        'EAN', 'NAME_BRAND_SIZE', 'NAME_SIZE', 'MANUAL'
      )
    `);
    await queryRunner.query(`
      ALTER TABLE "source_locations"
        ALTER COLUMN "matchedBy" TYPE "item_source_match"
        USING (CASE WHEN "matchedBy"::text = 'EXTERNAL_ID'
                    THEN 'NAME_SIZE' ELSE "matchedBy"::text END)::"item_source_match"
    `);
    await queryRunner.query(`
      ALTER TABLE "source_catalog_entries"
        ALTER COLUMN "matchedBy" TYPE "item_source_match"
        USING (CASE WHEN "matchedBy"::text = 'EXTERNAL_ID'
                    THEN 'MANUAL' ELSE "matchedBy"::text END)::"item_source_match"
    `);
    await queryRunner.query(`DROP TYPE "item_source_match_old"`);

    // --- 8. What the one table is read by -----------------------------------
    await queryRunner.query(
      `CREATE INDEX "ix_source_catalog_entries_status" ON "source_catalog_entries" ("status")`
    );
    // A revert deletes the rows nobody decided on by `firstRunId` **and**
    // `lastRunId` (plan 0086, section 8).
    await queryRunner.query(
      `CREATE INDEX "ix_source_catalog_entries_first_run" ON "source_catalog_entries" ("firstRunId")`
    );
    await queryRunner.query(`
      COMMENT ON TABLE "source_catalog_entries" IS
        'One product as a source described it, and what became of it (plan 0086, D1). One row for every source kind: a walk, a crawl and a file all write here. The source group of columns is rewritten by every run and the decision group only by a person or the EAN rung, so accepting a row never rewrites the name the source gave it.'
    `);
    await queryRunner.query(`
      COMMENT ON COLUMN "harvest_runs"."input" IS
        'The run own input, kept so a re-run can repeat it exactly. For a FILE_IMPORT it is the uploaded HarvestDocument (plan 0086, section 6), which plan 0082 reads to revert and the digest index is taken from.'
    `);
  }

  /**
   * Split the one table back into three.
   *
   * **It cannot restore the `REFRESH` runs.** `up` deleted them and no copy is
   * kept, which is deliberate: no cluster ever started one, so the rows exist on
   * developer slots only and a slot that rolls back re-runs whatever it wants.
   *
   * Two more things it can only approximate, both because the information it
   * would need was never in this database. The price it puts back on a row is
   * the **newest** observation of any scope, since nothing here says which scope
   * was the national one. And a leaflet row's `aliasKey` cannot be recovered
   * from `sha1(aliasKey)`, so a restored alias is keyed on the hash: the next
   * import writes the real key against a fresh row.
   */
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "ix_source_catalog_entries_first_run"`
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "ix_source_catalog_entries_status"`
    );

    // The two types, as they were.
    await queryRunner.query(
      `ALTER TYPE "item_source_match" RENAME TO "item_source_match_old"`
    );
    await queryRunner.query(`
      CREATE TYPE "item_source_match" AS ENUM (
        'EXTERNAL_ID', 'EAN', 'NAME_BRAND_SIZE', 'NAME_SIZE', 'MANUAL'
      )
    `);
    await queryRunner.query(`
      ALTER TABLE "source_locations"
        ALTER COLUMN "matchedBy" TYPE "item_source_match"
        USING "matchedBy"::text::"item_source_match"
    `);
    await queryRunner.query(`
      ALTER TABLE "source_catalog_entries"
        ALTER COLUMN "matchedBy" TYPE "item_source_match"
        USING "matchedBy"::text::"item_source_match"
    `);
    await queryRunner.query(`DROP TYPE "item_source_match_old"`);

    await queryRunner.query(
      `DROP INDEX IF EXISTS "uq_harvest_run_active_store_discovery"`
    );
    await queryRunner.query(
      `ALTER TYPE "harvest_run_mode" RENAME TO "harvest_run_mode_old"`
    );
    await queryRunner.query(`
      CREATE TYPE "harvest_run_mode" AS ENUM (
        'STORE_DISCOVERY', 'CATALOG_DISCOVERY', 'REFRESH', 'LEAFLET_IMPORT'
      )
    `);
    await queryRunner.query(`
      ALTER TABLE "harvest_runs"
        ALTER COLUMN "mode" TYPE "harvest_run_mode"
        USING (CASE WHEN "mode"::text = 'FILE_IMPORT'
                    THEN 'LEAFLET_IMPORT' ELSE "mode"::text END)::"harvest_run_mode"
    `);
    await queryRunner.query(`DROP TYPE "harvest_run_mode_old"`);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_harvest_run_active_store_discovery"
        ON "harvest_runs" ("mode")
        WHERE mode = 'STORE_DISCOVERY'
          AND status IN ('PENDING', 'RUNNING')
    `);

    // The two tables, as they were.
    await queryRunner.query(`
      CREATE TYPE "item_source_ref_status" AS ENUM (
        'ACTIVE', 'CANDIDATE', 'REJECTED', 'MANUAL'
      )
    `);
    await queryRunner.query(`
      CREATE TYPE "source_alias_status" AS ENUM (
        'ACTIVE', 'CANDIDATE', 'UNRESOLVED', 'REJECTED'
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "item_source_refs" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        "itemId" uuid NOT NULL,
        "supermarketId" uuid NOT NULL,
        "externalId" varchar NOT NULL,
        "externalUrl" varchar,
        "matchedBy" "item_source_match" NOT NULL,
        "status" "item_source_ref_status" NOT NULL DEFAULT 'CANDIDATE',
        "confidence" numeric(4,3) NOT NULL DEFAULT 1,
        "lastResolvedAt" timestamptz,
        "lastSeenAt" timestamptz,
        CONSTRAINT "pk_item_source_refs" PRIMARY KEY ("id"),
        CONSTRAINT "uq_item_source_ref" UNIQUE ("itemId", "supermarketId")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "ix_item_source_refs_supermarket" ON "item_source_refs" ("supermarketId")`
    );
    await queryRunner.query(
      `CREATE INDEX "ix_item_source_refs_status" ON "item_source_refs" ("status")`
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
      CREATE UNIQUE INDEX "uq_source_aliases_key"
        ON "source_aliases" ("supermarketId", "aliasKey")
    `);
    await queryRunner.query(
      `CREATE INDEX "ix_source_aliases_status" ON "source_aliases" ("status")`
    );
    await queryRunner.query(
      `CREATE INDEX "ix_source_aliases_first_run" ON "source_aliases" ("firstRunId")`
    );

    // Split the rows back by `sourceKind`: leaflet rows to aliases, decided rows
    // of the other kinds to refs.
    await queryRunner.query(`
      INSERT INTO "source_aliases" (
        "supermarketId", "aliasKey", "printedName", "printedFormat",
        "printedBrand", "itemId", "candidateEntryId", "status", "matchedBy",
        "confidence", "timesSeen", "firstSeenAt", "lastSeenAt", "firstRunId",
        "lastRunId"
      )
      SELECT e."supermarketId", e."externalId", e."name", e."sizeFormat",
             e."brand", e."itemId", e."candidateEntryId",
             e."status"::text::"source_alias_status",
             COALESCE(e."matchedBy", 'NAME_SIZE'::"item_source_match"),
             e."confidence", e."timesSeen", e."firstSeenAt", e."lastSeenAt",
             e."firstRunId", e."lastRunId"
        FROM "source_catalog_entries" e
       WHERE e."sourceKind" = 'OFFICIAL_LEAFLET'
    `);
    await queryRunner.query(`
      INSERT INTO "item_source_refs" (
        "itemId", "supermarketId", "externalId", "externalUrl", "matchedBy",
        "status", "confidence", "lastResolvedAt", "lastSeenAt"
      )
      SELECT DISTINCT ON (e."itemId", e."supermarketId")
             e."itemId", e."supermarketId", e."externalId", e."url",
             COALESCE(e."matchedBy", 'NAME_BRAND_SIZE'::"item_source_match"),
             (CASE e."status"::text
                WHEN 'UNRESOLVED' THEN 'CANDIDATE'
                ELSE e."status"::text
              END)::"item_source_ref_status",
             e."confidence", e."decidedAt", e."lastSeenAt"
        FROM "source_catalog_entries" e
       WHERE e."sourceKind" <> 'OFFICIAL_LEAFLET'
         AND e."itemId" IS NOT NULL
       ORDER BY e."itemId", e."supermarketId", e."lastSeenAt" DESC
    `);
    await queryRunner.query(
      `DELETE FROM "source_catalog_entries" WHERE "sourceKind" = 'OFFICIAL_LEAFLET'`
    );

    // The three price columns, filled from the newest observation of any scope.
    await queryRunner.query(`
      ALTER TABLE "source_catalog_entries"
        ADD "price" numeric(12,2),
        ADD "unitPrice" numeric(12,4),
        ADD "unitPriceLabel" varchar
    `);
    await queryRunner.query(`
      UPDATE "source_catalog_entries" e
         SET "price" = p."price",
             "unitPrice" = p."unitPrice",
             "unitPriceLabel" = p."unitPriceLabel"
        FROM (
          SELECT DISTINCT ON ("entryId") *
            FROM "source_entry_prices"
           ORDER BY "entryId", "observedAt" DESC
        ) p
       WHERE p."entryId" = e."id"
    `);

    await queryRunner.query(`DROP TABLE "source_entry_prices"`);
    await queryRunner.query(`
      ALTER TABLE "source_catalog_entries"
        DROP COLUMN "decidedAt",
        DROP COLUMN "confidence",
        DROP COLUMN "matchedBy",
        DROP COLUMN "status",
        DROP COLUMN "candidateEntryId",
        DROP COLUMN "itemId",
        DROP COLUMN "lastRunId",
        DROP COLUMN "firstRunId",
        DROP COLUMN "firstSeenAt",
        DROP COLUMN "timesSeen",
        DROP COLUMN "extra",
        DROP COLUMN "sourceKind"
    `);
    await queryRunner.query(`DROP TYPE "source_entry_status"`);
    await queryRunner.query(`DROP TYPE "price_source_kind"`);
  }
}
