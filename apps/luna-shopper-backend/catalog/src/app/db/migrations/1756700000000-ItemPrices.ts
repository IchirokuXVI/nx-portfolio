import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Every price a source gave, and the one a shopper sees (plan 0080, section 8).
 *
 * Five steps in one transaction:
 *
 * 1. `item_prices` and its three indexes: the current row per kind, the run for
 *    undo, and the history list.
 * 2. `price_policies`, seeded with the six rows of section 3.
 * 3. Four columns on `supermarket_items`, and the partial index the sweep reads.
 * 4. One `item_prices` row for every `supermarket_items` row that carries a
 *    price, copied verbatim. An `ADMIN` row gets `overrides: {}` and no
 *    `protectedUntil`: nothing typed before this plan was typed against a
 *    snapshot, and inventing one is inventing history.
 * 5. `itemPriceId` back onto the source row, and `nextBoundaryAt` seven days
 *    after `lastObservedAt` for the two crawl kinds that have a max age.
 *
 * Every pre existing row resolves to the same price after this as before it: it
 * is the only row for its key and its kind is enabled. A crawl row older than a
 * week is marked stale by the first sweep, and not by this migration, because
 * the sweep is the one thing that owns that judgement.
 *
 * `priceSourceKind` loses its `NOT NULL DEFAULT 'ADMIN'`. A materialized row
 * with no price behind it has no source, and a default that claimed the owner
 * typed it was the one lie the old shape told.
 */
export class ItemPrices1756700000000 implements MigrationInterface {
  name = 'ItemPrices1756700000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    // 1. The rows a source gave.
    await queryRunner.query(`
      CREATE TABLE "item_prices" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "itemId" uuid NOT NULL,
        "priceScopeId" uuid NOT NULL,
        "sourceKind" "price_source_kind" NOT NULL,
        "price" numeric(12,2),
        "currency" character varying(3),
        "unitPrice" numeric(12,4),
        "unitPriceLabel" character varying,
        "observedAt" TIMESTAMP WITH TIME ZONE NOT NULL,
        "lastObservedAt" TIMESTAMP WITH TIME ZONE NOT NULL,
        "validFrom" TIMESTAMP WITH TIME ZONE,
        "validUntil" TIMESTAMP WITH TIME ZONE,
        "sourceRunId" uuid,
        "lastObservedRunId" uuid,
        "overrides" jsonb,
        "protectedUntil" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "pk_item_prices" PRIMARY KEY ("id"),
        CONSTRAINT "fk_item_prices_item" FOREIGN KEY ("itemId")
          REFERENCES "items"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_item_prices_scope" FOREIGN KEY ("priceScopeId")
          REFERENCES "price_scopes"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      COMMENT ON TABLE "item_prices" IS
        'Every price a source gave (plan 0080). One dated row per number, per product, per scope, per kind. A repeated value moves lastObservedAt and inserts nothing. No write changes another row.'
    `);
    await queryRunner.query(`
      COMMENT ON COLUMN "item_prices"."overrides" IS
        'ADMIN rows only: what each automated kind said when the operator typed (plan 0080, section 4.2). The protection test compares current rows to this, never to the previous run.'
    `);
    // The current row per kind: DISTINCT ON (item, scope, kind) ORDER BY
    // observedAt DESC reads at most six rows per key.
    await queryRunner.query(`
      CREATE INDEX "ix_item_prices_current"
        ON "item_prices" ("itemId", "priceScopeId", "sourceKind", "observedAt" DESC)
    `);
    // Undo deletes by run (plan 0082).
    await queryRunner.query(`
      CREATE INDEX "ix_item_prices_source_run" ON "item_prices" ("sourceRunId")
    `);
    // The history list, newest first.
    await queryRunner.query(`
      CREATE INDEX "ix_item_prices_history"
        ON "item_prices" ("itemId", "priceScopeId", "observedAt" DESC)
    `);

    // 2. The policy per kind.
    await queryRunner.query(`
      CREATE TABLE "price_policies" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "sourceKind" "price_source_kind" NOT NULL,
        "priority" integer NOT NULL,
        "maxAgeDays" integer,
        "enabled" boolean NOT NULL DEFAULT true,
        CONSTRAINT "pk_price_policies" PRIMARY KEY ("id"),
        CONSTRAINT "uq_price_policy_kind" UNIQUE ("sourceKind")
      )
    `);
    await queryRunner.query(`
      COMMENT ON TABLE "price_policies" IS
        'How each source kind competes for the price a shopper sees (plan 0080, section 3). Lower priority wins. ADMIN has no max age on purpose: its seven days are a protection window on the row, not an age.'
    `);
    // Section 3, verbatim. USER_RECEIPT and USER_REPORTED carry no max age
    // until backlog 0008 adds their writers (section 12), and USER_REPORTED is
    // disabled until then.
    await queryRunner.query(`
      INSERT INTO "price_policies" ("sourceKind", "priority", "maxAgeDays", "enabled") VALUES
        ('OFFICIAL_LEAFLET', 10, NULL, true),
        ('OFFICIAL_API', 20, 7, true),
        ('OFFICIAL_WEB', 30, 7, true),
        ('ADMIN', 40, NULL, true),
        ('USER_RECEIPT', 50, NULL, true),
        ('USER_REPORTED', 60, NULL, false)
    `);

    // 3. The materialized row learns what it is.
    await queryRunner.query(`
      ALTER TABLE "supermarket_items"
        ADD COLUMN "itemPriceId" uuid,
        ADD COLUMN "stale" boolean NOT NULL DEFAULT false,
        ADD COLUMN "validUntil" TIMESTAMP WITH TIME ZONE,
        ADD COLUMN "nextBoundaryAt" TIMESTAMP WITH TIME ZONE,
        ALTER COLUMN "priceSourceKind" DROP DEFAULT,
        ALTER COLUMN "priceSourceKind" DROP NOT NULL
    `);
    await queryRunner.query(`
      COMMENT ON COLUMN "supermarket_items"."nextBoundaryAt" IS
        'The earliest instant at which the effective price changes with no write (plan 0080, section 7). The sweep recomputes rows whose boundary has passed. Null for most rows.'
    `);
    // A row with no boundary is never scanned, and most rows have none.
    await queryRunner.query(`
      CREATE INDEX "ix_supermarket_items_next_boundary"
        ON "supermarket_items" ("nextBoundaryAt")
        WHERE "nextBoundaryAt" IS NOT NULL
    `);

    // 4. One price row per priced materialized row. The id is chosen here so
    // step 5 can point back without a second lookup.
    await queryRunner.query(`
      CREATE TEMP TABLE "backfilled_prices" ON COMMIT DROP AS
      SELECT gen_random_uuid() AS "priceId",
             si."id" AS "supermarketItemId",
             si."itemId",
             si."priceScopeId",
             si."priceSourceKind" AS "sourceKind",
             si."price",
             si."currency",
             si."unitPrice",
             si."unitPriceLabel",
             COALESCE(si."priceObservedAt", si."createdAt") AS "observedAt"
      FROM "supermarket_items" si
      WHERE si."price" IS NOT NULL OR si."unitPrice" IS NOT NULL
    `);
    await queryRunner.query(`
      INSERT INTO "item_prices" (
        "id", "itemId", "priceScopeId", "sourceKind", "price", "currency",
        "unitPrice", "unitPriceLabel", "observedAt", "lastObservedAt",
        "validFrom", "validUntil", "sourceRunId", "lastObservedRunId",
        "overrides", "protectedUntil"
      )
      SELECT "priceId", "itemId", "priceScopeId", "sourceKind", "price", "currency",
             "unitPrice", "unitPriceLabel", "observedAt", "observedAt",
             NULL, NULL, NULL, NULL,
             CASE WHEN "sourceKind" = 'ADMIN' THEN '{}'::jsonb ELSE NULL END,
             NULL
      FROM "backfilled_prices"
    `);

    // 5. Point back, and give the two crawl kinds their max age boundary.
    await queryRunner.query(`
      UPDATE "supermarket_items" si
      SET "itemPriceId" = b."priceId",
          "priceObservedAt" = b."observedAt",
          "nextBoundaryAt" = CASE
            WHEN b."sourceKind" IN ('OFFICIAL_API', 'OFFICIAL_WEB')
              THEN b."observedAt" + interval '7 days'
            ELSE NULL
          END
      FROM "backfilled_prices" b
      WHERE b."supermarketItemId" = si."id"
    `);
    // A row that carried no price has no source either.
    await queryRunner.query(`
      UPDATE "supermarket_items"
      SET "priceSourceKind" = NULL
      WHERE "itemPriceId" IS NULL
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "ix_supermarket_items_next_boundary"`);
    // A row with no source reads as the owner's again, which is what the old
    // shape said about every row.
    await queryRunner.query(`
      UPDATE "supermarket_items" SET "priceSourceKind" = 'ADMIN'
      WHERE "priceSourceKind" IS NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "supermarket_items"
        ALTER COLUMN "priceSourceKind" SET NOT NULL,
        ALTER COLUMN "priceSourceKind" SET DEFAULT 'ADMIN',
        DROP COLUMN "nextBoundaryAt",
        DROP COLUMN "validUntil",
        DROP COLUMN "stale",
        DROP COLUMN "itemPriceId"
    `);
    await queryRunner.query(`DROP TABLE "price_policies"`);
    await queryRunner.query(`DROP INDEX "ix_item_prices_history"`);
    await queryRunner.query(`DROP INDEX "ix_item_prices_source_run"`);
    await queryRunner.query(`DROP INDEX "ix_item_prices_current"`);
    await queryRunner.query(`DROP TABLE "item_prices"`);
  }
}
