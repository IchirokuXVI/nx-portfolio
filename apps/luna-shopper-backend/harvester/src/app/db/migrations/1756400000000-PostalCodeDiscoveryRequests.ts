import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The postal code discovery queue (plan 0063, section 9).
 *
 * The unique key over (`country`, `postalCode`) **is** the deduplication, and it
 * is a constraint rather than a check in a service because the racing writers are
 * two ordinary profile saves by two people living in the same street. A check
 * that reads then inserts loses that race by construction, exactly as it would
 * for the active run index this table stands beside.
 *
 * `nextAttemptAt` is nullable and null means due now, so the worker's claim can
 * ask `IS NULL OR <= now()` and the partial index below serves it: the rows the
 * worker looks at are the QUEUED ones, and there are never many.
 */
export class PostalCodeDiscoveryRequests1756400000000 implements MigrationInterface {
  name = 'PostalCodeDiscoveryRequests1756400000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "postal_code_discovery_status" AS ENUM (
        'QUEUED', 'RUNNING', 'DONE', 'FAILED'
      )`
    );

    await queryRunner.query(`
      CREATE TABLE "postal_code_discovery_requests" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        "country" character varying(2) NOT NULL,
        "postalCode" character varying(16) NOT NULL,
        "status" "postal_code_discovery_status" NOT NULL DEFAULT 'QUEUED',
        "requestedAt" timestamptz NOT NULL DEFAULT now(),
        "lastAttemptedAt" timestamptz,
        "discoveredAt" timestamptz,
        "nextAttemptAt" timestamptz,
        "attempts" integer NOT NULL DEFAULT 0,
        "runId" uuid,
        "error" text,
        CONSTRAINT "pk_postal_code_discovery_requests" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      ALTER TABLE "postal_code_discovery_requests"
        ADD CONSTRAINT "uq_postal_code_discovery_country_code"
        UNIQUE ("country", "postalCode")
    `);

    // The worker only ever looks at the codes still waiting, so the index it
    // needs covers those and nothing else.
    await queryRunner.query(`
      CREATE INDEX "ix_postal_code_discovery_due"
        ON "postal_code_discovery_requests" ("nextAttemptAt", "requestedAt")
        WHERE status = 'QUEUED'
    `);

    await queryRunner.query(`
      CREATE INDEX "ix_postal_code_discovery_status"
        ON "postal_code_discovery_requests" ("status")
    `);

    await queryRunner.query(`
      COMMENT ON TABLE "postal_code_discovery_requests" IS
        'Postal codes announced by core that catalog holds no shops in, waiting to become a STORE_DISCOVERY run (plan 0063). Drained serially; the active run index forbids a fan out.'
    `);
    await queryRunner.query(`
      COMMENT ON COLUMN "postal_code_discovery_requests"."discoveredAt" IS
        'When a run last completed for this code. The 30 day cooldown counts from here; DONE means we looked, never that we found shops.'
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TABLE IF EXISTS "postal_code_discovery_requests"`
    );
    await queryRunner.query(
      `DROP TYPE IF EXISTS "postal_code_discovery_status"`
    );
  }
}
