import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * First harvester migration (plan 0038, section 4.2). Five tables and the two
 * locks that make "one run at a time" true rather than hoped for.
 *
 * The harvester owns this database entirely and holds every cross service id as
 * an **opaque uuid**: there is not one foreign key here pointing at catalog, and
 * every read and write of catalog goes over NATS.
 */
export class InitialHarvesterSchema1756200000000 implements MigrationInterface {
  name = 'InitialHarvesterSchema1756200000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);

    await queryRunner.query(
      `CREATE TYPE "harvest_run_mode" AS ENUM (
        'STORE_DISCOVERY', 'CATALOG_DISCOVERY', 'REFRESH'
      )`
    );
    await queryRunner.query(
      `CREATE TYPE "harvest_run_trigger" AS ENUM ('MANUAL', 'SCHEDULED', 'SYSTEM')`
    );
    await queryRunner.query(
      `CREATE TYPE "harvest_run_status" AS ENUM (
        'PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'ABORTED', 'STALE'
      )`
    );
    await queryRunner.query(
      `CREATE TYPE "item_source_ref_status" AS ENUM (
        'ACTIVE', 'CANDIDATE', 'REJECTED', 'MANUAL'
      )`
    );
    await queryRunner.query(
      `CREATE TYPE "item_source_match" AS ENUM (
        'EXTERNAL_ID', 'EAN', 'NAME_BRAND_SIZE', 'MANUAL'
      )`
    );
    await queryRunner.query(
      `CREATE TYPE "discovered_place_status" AS ENUM ('NEW', 'IMPORTED', 'REJECTED')`
    );

    await queryRunner.query(`
      CREATE TABLE "supermarket_sources" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        "supermarketId" uuid NOT NULL,
        "adapterKey" varchar NOT NULL,
        "enabled" boolean NOT NULL DEFAULT false,
        "config" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "workers" integer NOT NULL DEFAULT 4,
        "maxRequestsPerSecond" numeric(6,2) NOT NULL DEFAULT 4,
        "lastRunAt" timestamptz,
        "lastSuccessAt" timestamptz,
        "consecutiveFailures" integer NOT NULL DEFAULT 0,
        CONSTRAINT "pk_supermarket_sources" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_supermarket_sources_supermarket"
        ON "supermarket_sources" ("supermarketId")
    `);

    await queryRunner.query(`
      CREATE TABLE "harvest_runs" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        "supermarketId" uuid,
        "sourceId" uuid,
        "priceScopeId" uuid,
        "mode" "harvest_run_mode" NOT NULL,
        "trigger" "harvest_run_trigger" NOT NULL DEFAULT 'MANUAL',
        "status" "harvest_run_status" NOT NULL DEFAULT 'PENDING',
        "input" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "requestedAt" timestamptz NOT NULL DEFAULT now(),
        "startedAt" timestamptz,
        "finishedAt" timestamptz,
        "heartbeatAt" timestamptz,
        "totalPlanned" integer,
        "processed" integer NOT NULL DEFAULT 0,
        "created" integer NOT NULL DEFAULT 0,
        "updated" integer NOT NULL DEFAULT 0,
        "unchanged" integer NOT NULL DEFAULT 0,
        "notFound" integer NOT NULL DEFAULT 0,
        "failed" integer NOT NULL DEFAULT 0,
        "stage" varchar,
        "stageLabel" varchar,
        "abortRequestedAt" timestamptz,
        "error" text,
        "correlationId" varchar,
        "requestedByUserId" uuid,
        CONSTRAINT "pk_harvest_runs" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "ix_harvest_runs_supermarket" ON "harvest_runs" ("supermarketId")`
    );
    await queryRunner.query(
      `CREATE INDEX "ix_harvest_runs_status" ON "harvest_runs" ("status")`
    );

    // One active run per supermarket, enforced by the DATABASE (section 4.2), so
    // it holds across restarts and between two callers racing. Application code
    // checking first and inserting second loses that race by construction.
    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_harvest_run_active"
        ON "harvest_runs" ("supermarketId")
        WHERE "supermarketId" IS NOT NULL
          AND status IN ('PENDING', 'RUNNING')
    `);
    // Store discovery runs are excluded from that lock by the null
    // `supermarketId`, so they get their own single row guard. The WHERE clause
    // already pins `mode` to one value, so indexing the column itself is what
    // makes the index allow exactly one such row.
    //
    // The column, not `mode::text`: a cast out of an enum is STABLE rather than
    // IMMUTABLE, because enum labels can be renamed, and Postgres rejects a non
    // immutable function in an index expression (42P17). A bare column reference
    // is not an expression at all, so no such check applies.
    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_harvest_run_active_store_discovery"
        ON "harvest_runs" ("mode")
        WHERE mode = 'STORE_DISCOVERY'
          AND status IN ('PENDING', 'RUNNING')
    `);

    await queryRunner.query(`
      CREATE TABLE "source_catalog_entries" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        "supermarketId" uuid NOT NULL,
        "externalId" varchar NOT NULL,
        "name" varchar NOT NULL,
        "brand" varchar,
        "ean" varchar,
        "unitSize" numeric(12,4),
        "sizeFormat" varchar,
        "price" numeric(12,2),
        "unitPrice" numeric(12,4),
        "unitPriceLabel" varchar,
        "categoryPath" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "url" varchar,
        "lastSeenAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_source_catalog_entries" PRIMARY KEY ("id"),
        CONSTRAINT "uq_source_catalog_entry" UNIQUE ("supermarketId", "externalId")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "ix_source_catalog_entries_ean" ON "source_catalog_entries" ("ean")`
    );
    // What a re-run reads to skip work it already did (section 6.3: resuming is
    // free and is not machinery).
    await queryRunner.query(
      `CREATE INDEX "ix_source_catalog_entries_last_seen" ON "source_catalog_entries" ("lastSeenAt")`
    );

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
      CREATE TABLE "discovered_places" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        "runId" uuid,
        "provider" varchar NOT NULL,
        "externalRef" varchar NOT NULL,
        "brandKey" varchar,
        "brandName" varchar,
        "name" varchar,
        "latitude" double precision NOT NULL,
        "longitude" double precision NOT NULL,
        "street" varchar,
        "city" varchar,
        "postalCode" varchar,
        "website" varchar,
        "openingHours" varchar,
        "tags" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "status" "discovered_place_status" NOT NULL DEFAULT 'NEW',
        "supermarketLocationId" uuid,
        "firstSeenAt" timestamptz NOT NULL DEFAULT now(),
        "lastSeenAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_discovered_places" PRIMARY KEY ("id"),
        CONSTRAINT "uq_discovered_place" UNIQUE ("provider", "externalRef")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "ix_discovered_places_run" ON "discovered_places" ("runId")`
    );
    await queryRunner.query(
      `CREATE INDEX "ix_discovered_places_brand" ON "discovered_places" ("brandKey")`
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "discovered_places"`);
    await queryRunner.query(`DROP TABLE "item_source_refs"`);
    await queryRunner.query(`DROP TABLE "source_catalog_entries"`);
    await queryRunner.query(`DROP TABLE "harvest_runs"`);
    await queryRunner.query(`DROP TABLE "supermarket_sources"`);
    await queryRunner.query(`DROP TYPE "discovered_place_status"`);
    await queryRunner.query(`DROP TYPE "item_source_match"`);
    await queryRunner.query(`DROP TYPE "item_source_ref_status"`);
    await queryRunner.query(`DROP TYPE "harvest_run_status"`);
    await queryRunner.query(`DROP TYPE "harvest_run_trigger"`);
    await queryRunner.query(`DROP TYPE "harvest_run_mode"`);
  }
}
