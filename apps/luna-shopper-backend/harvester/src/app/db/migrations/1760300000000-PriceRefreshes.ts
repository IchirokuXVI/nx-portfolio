import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A shopper refreshes the price of one product (plan 0216, section 4).
 *
 * Additive: a new type and a new table. Nothing existing changes, and
 * `harvest_runs` and its indexes least of all, because a refresh is not a run.
 *
 * The enum holds the statuses a stored row can reach. `FRESH` is not one: it
 * is an answer of the view for a request that started nothing, so no row ever
 * holds it.
 *
 * No column has a foreign key, for the reason `harvest_runs.presetId` has
 * none: a deleted source row or a deleted product row must not take the record
 * of who fetched what with it.
 */
export class PriceRefreshes1760300000000 implements MigrationInterface {
  name = 'PriceRefreshes1760300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "price_refresh_status" AS ENUM (
        'PENDING', 'DONE', 'NOT_STOCKED', 'FAILED', 'BLOCKED'
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "price_refreshes" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "requestedByUserId" uuid NOT NULL,
        "supermarketId" uuid NOT NULL,
        "sourceId" uuid NOT NULL,
        "entryId" uuid NOT NULL,
        "itemId" uuid NOT NULL,
        "priceScopeId" uuid NOT NULL,
        "fetchScopeId" uuid NOT NULL,
        "status" "price_refresh_status" NOT NULL,
        "pricesWritten" integer NOT NULL DEFAULT 0,
        "pricesConfirmed" integer NOT NULL DEFAULT 0,
        "error" text,
        "requestedAt" timestamptz NOT NULL DEFAULT now(),
        "finishedAt" timestamptz,
        CONSTRAINT "pk_price_refreshes" PRIMARY KEY ("id")
      )
    `);
    // The join of section 7.1, step 7: the refresh in flight for one product
    // at one fetch scope.
    await queryRunner.query(
      `CREATE INDEX "ix_price_refreshes_pending" ON "price_refreshes" ("entryId", "fetchScopeId") WHERE "status" = 'PENDING'`
    );
    await queryRunner.query(
      `CREATE INDEX "ix_price_refreshes_requested_by" ON "price_refreshes" ("requestedByUserId", "requestedAt")`
    );
    await queryRunner.query(
      `CREATE INDEX "ix_price_refreshes_supermarket" ON "price_refreshes" ("supermarketId", "requestedAt")`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "price_refreshes"`);
    await queryRunner.query(`DROP TYPE "price_refresh_status"`);
  }
}
