import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Price scopes and source provenance (plan 0038, section 5).
 *
 * **One append only migration for every catalog change in that plan.** Plan 0025
 * reset the history to a single baseline and restored the append only rule
 * immediately, so this adds and backfills rather than editing
 * `1756000500000-InitialCatalogSchema`, even though no production database
 * exists yet.
 *
 * What it does, and the one thing it must not break:
 *
 * Prices move from the **location** to a **price scope** (section 5.2). This is
 * the change that stops Mercadona writing twelve identical rows for Córdoba: the
 * chain publishes one price per warehouse, so the price belongs to the warehouse.
 * Every row that exists today is given a `STORE` scope of its own, so **every
 * pre-existing price still resolves to the same value**, and the collapse to
 * coarser scopes happens only when a warehouse scope is created deliberately.
 *
 * What is genuinely per store (`positionInStore`, and now a nullable per store
 * `available` override) splits out into `supermarket_location_items`. A warehouse
 * cannot answer which aisle a product is in.
 *
 * The whole thing runs in one transaction, which TypeORM gives it by default.
 */
export class PriceScopesAndSourceProvenance1756100000000
  implements MigrationInterface
{
  name = 'PriceScopesAndSourceProvenance1756100000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "price_scope_kind" AS ENUM (
        'NATIONAL', 'WAREHOUSE', 'POSTAL_CODE', 'STORE'
      )`
    );
    // The full value set from backlog 0001, even though only OFFICIAL_API and
    // ADMIN are reachable today: adding a value to a Postgres enum later is a
    // migration, and defining them now is free.
    await queryRunner.query(
      `CREATE TYPE "price_source_kind" AS ENUM (
        'OFFICIAL_API', 'OFFICIAL_WEB', 'OFFICIAL_LEAFLET',
        'ADMIN', 'USER_RECEIPT', 'USER_REPORTED'
      )`
    );

    // 1. The scopes themselves.
    await queryRunner.query(`
      CREATE TABLE "price_scopes" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        "supermarketId" uuid NOT NULL,
        "kind" "price_scope_kind" NOT NULL,
        "externalKey" varchar,
        "label" jsonb,
        CONSTRAINT "pk_price_scopes" PRIMARY KEY ("id"),
        CONSTRAINT "uq_price_scope" UNIQUE ("supermarketId", "kind", "externalKey"),
        CONSTRAINT "fk_price_scopes_supermarket" FOREIGN KEY ("supermarketId")
          REFERENCES "supermarkets" ("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "ix_price_scopes_supermarket" ON "price_scopes" ("supermarketId")`
    );

    // 2. One STORE scope per existing location, keyed on the location's own id.
    //    This is what makes the whole migration meaning preserving: today's rows
    //    keep exactly the prices they had, one scope per store.
    await queryRunner.query(`
      INSERT INTO "price_scopes" ("supermarketId", "kind", "externalKey", "label")
      SELECT l."supermarketId", 'STORE', l."id"::text, l."label"
      FROM "supermarket_locations" l
    `);

    // 3. Point each location at its scope.
    await queryRunner.query(
      `ALTER TABLE "supermarket_locations" ADD COLUMN "priceScopeId" uuid`
    );
    await queryRunner.query(`
      UPDATE "supermarket_locations" l
      SET "priceScopeId" = s."id"
      FROM "price_scopes" s
      WHERE s."kind" = 'STORE' AND s."externalKey" = l."id"::text
    `);
    await queryRunner.query(
      `ALTER TABLE "supermarket_locations" ALTER COLUMN "priceScopeId" SET NOT NULL`
    );
    await queryRunner.query(`
      ALTER TABLE "supermarket_locations"
        ADD CONSTRAINT "fk_locations_price_scope" FOREIGN KEY ("priceScopeId")
          REFERENCES "price_scopes" ("id") ON DELETE RESTRICT
    `);

    // The entity has address, city and country but no postal code, which is a
    // plain gap independent of any of this (section 5.5).
    await queryRunner.query(
      `ALTER TABLE "supermarket_locations" ADD COLUMN "postalCode" varchar`
    );
    // `node/1156230891` plus whose ref it is. Storing a ref without naming the
    // provider would be meaningless.
    await queryRunner.query(
      `ALTER TABLE "supermarket_locations" ADD COLUMN "externalRef" varchar`
    );
    await queryRunner.query(
      `ALTER TABLE "supermarket_locations" ADD COLUMN "externalProvider" varchar`
    );
    // Partial, because most locations are hand entered and carry no ref at all;
    // a plain UNIQUE would allow only one of them.
    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_locations_external_ref"
        ON "supermarket_locations" ("externalRef")
        WHERE "externalRef" IS NOT NULL
    `);

    // 4. The chain's stable identity across discovery runs (section 5.4).
    //    Matching on the brand NAME splits `Dia` from `Maxi Dia`.
    await queryRunner.query(
      `ALTER TABLE "supermarkets" ADD COLUMN "externalBrandKey" varchar`
    );
    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_supermarkets_external_brand_key"
        ON "supermarkets" ("externalBrandKey")
        WHERE "externalBrandKey" IS NOT NULL
    `);

    // 5. The identifier that joins a product across chains, and the size without
    //    which `defaultUnit` says nothing (section 5.3).
    await queryRunner.query(`ALTER TABLE "items" ADD COLUMN "ean" varchar`);
    await queryRunner.query(
      `ALTER TABLE "items" ADD COLUMN "unitSize" numeric(12,4)`
    );
    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_items_ean" ON "items" ("ean") WHERE "ean" IS NOT NULL
    `);

    // 6. Re-key the prices onto the scope, backfilling through the location
    //    BEFORE the location column is dropped.
    await queryRunner.query(
      `ALTER TABLE "supermarket_items" ADD COLUMN "priceScopeId" uuid`
    );
    await queryRunner.query(`
      UPDATE "supermarket_items" si
      SET "priceScopeId" = l."priceScopeId"
      FROM "supermarket_locations" l
      WHERE l."id" = si."supermarketLocationId"
    `);
    await queryRunner.query(
      `ALTER TABLE "supermarket_items" ALTER COLUMN "priceScopeId" SET NOT NULL`
    );

    // The source's own normalized price, stored verbatim and never recomputed
    // (section 2.4), and the source's own label for it, as TEXT rather than a
    // UnitOfMeasure: `100 ml` sits on a per litre number and `lv` means washing
    // machine loads, so it is a price tag for a human.
    await queryRunner.query(
      `ALTER TABLE "supermarket_items" ADD COLUMN "unitPrice" numeric(12,4)`
    );
    await queryRunner.query(
      `ALTER TABLE "supermarket_items" ADD COLUMN "unitPriceLabel" varchar`
    );
    await queryRunner.query(
      `ALTER TABLE "supermarket_items" ADD COLUMN "priceObservedAt" timestamptz`
    );
    // Existing rows default to ADMIN, which is true: a person typed them in.
    // Section 6.5 is the rule that reads this, and it is what stops the first
    // import writing over a price the owner set.
    await queryRunner.query(`
      ALTER TABLE "supermarket_items"
        ADD COLUMN "priceSourceKind" "price_source_kind" NOT NULL DEFAULT 'ADMIN'
    `);

    // 7. Split the genuinely per store half out.
    await queryRunner.query(`
      CREATE TABLE "supermarket_location_items" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        "itemId" uuid NOT NULL,
        "supermarketLocationId" uuid NOT NULL,
        "positionInStore" varchar,
        "available" boolean,
        CONSTRAINT "pk_supermarket_location_items" PRIMARY KEY ("id"),
        CONSTRAINT "uq_supermarket_location_item"
          UNIQUE ("itemId", "supermarketLocationId"),
        CONSTRAINT "fk_location_items_item" FOREIGN KEY ("itemId")
          REFERENCES "items" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_location_items_location" FOREIGN KEY ("supermarketLocationId")
          REFERENCES "supermarket_locations" ("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "ix_location_items_location" ON "supermarket_location_items" ("supermarketLocationId")`
    );
    // Both columns move across. `available` is copied as an explicit per store
    // override rather than left null, because today's rows genuinely WERE per
    // store: someone had checked that shop. Null from here on means "no store
    // specific information, use the scope's".
    await queryRunner.query(`
      INSERT INTO "supermarket_location_items"
        ("itemId", "supermarketLocationId", "positionInStore", "available")
      SELECT si."itemId", si."supermarketLocationId", si."positionInStore", si."available"
      FROM "supermarket_items" si
    `);

    // 8. Retire the location keyed shape.
    await queryRunner.query(
      `ALTER TABLE "supermarket_items" DROP CONSTRAINT "uq_supermarket_item"`
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "ix_supermarket_items_location"`
    );
    await queryRunner.query(
      `ALTER TABLE "supermarket_items" DROP COLUMN "supermarketLocationId"`
    );
    await queryRunner.query(
      `ALTER TABLE "supermarket_items" DROP COLUMN "positionInStore"`
    );
    await queryRunner.query(`
      ALTER TABLE "supermarket_items"
        ADD CONSTRAINT "uq_supermarket_item_scope" UNIQUE ("itemId", "priceScopeId")
    `);
    await queryRunner.query(`
      ALTER TABLE "supermarket_items"
        ADD CONSTRAINT "fk_supermarket_items_price_scope" FOREIGN KEY ("priceScopeId")
          REFERENCES "price_scopes" ("id") ON DELETE CASCADE
    `);
    await queryRunner.query(
      `CREATE INDEX "ix_supermarket_items_scope" ON "supermarket_items" ("priceScopeId")`
    );
  }

  /**
   * The reverse, and it is genuinely lossy in one place: a price written against
   * a scope that is not a STORE scope has no single location to go back to. Those
   * rows are dropped rather than duplicated across the scope's locations, because
   * inventing twelve rows from one is worse than losing one. A down migration
   * after a real harvest is not a routine operation.
   */
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "supermarket_items" ADD COLUMN "supermarketLocationId" uuid`
    );
    await queryRunner.query(
      `ALTER TABLE "supermarket_items" ADD COLUMN "positionInStore" varchar`
    );
    await queryRunner.query(`
      UPDATE "supermarket_items" si
      SET "supermarketLocationId" = l."id"
      FROM "supermarket_locations" l
      WHERE l."priceScopeId" = si."priceScopeId"
    `);
    await queryRunner.query(`
      UPDATE "supermarket_items" si
      SET "positionInStore" = li."positionInStore"
      FROM "supermarket_location_items" li
      WHERE li."itemId" = si."itemId"
        AND li."supermarketLocationId" = si."supermarketLocationId"
    `);
    // Scope wide prices with no location to return to.
    await queryRunner.query(
      `DELETE FROM "supermarket_items" WHERE "supermarketLocationId" IS NULL`
    );
    await queryRunner.query(
      `ALTER TABLE "supermarket_items" ALTER COLUMN "supermarketLocationId" SET NOT NULL`
    );

    await queryRunner.query(
      `DROP INDEX IF EXISTS "ix_supermarket_items_scope"`
    );
    await queryRunner.query(
      `ALTER TABLE "supermarket_items" DROP CONSTRAINT "fk_supermarket_items_price_scope"`
    );
    await queryRunner.query(
      `ALTER TABLE "supermarket_items" DROP CONSTRAINT "uq_supermarket_item_scope"`
    );
    await queryRunner.query(`
      ALTER TABLE "supermarket_items"
        ADD CONSTRAINT "uq_supermarket_item" UNIQUE ("itemId", "supermarketLocationId")
    `);
    await queryRunner.query(
      `CREATE INDEX "ix_supermarket_items_location" ON "supermarket_items" ("supermarketLocationId")`
    );
    await queryRunner.query(
      `ALTER TABLE "supermarket_items" DROP COLUMN "priceSourceKind"`
    );
    await queryRunner.query(
      `ALTER TABLE "supermarket_items" DROP COLUMN "priceObservedAt"`
    );
    await queryRunner.query(
      `ALTER TABLE "supermarket_items" DROP COLUMN "unitPriceLabel"`
    );
    await queryRunner.query(
      `ALTER TABLE "supermarket_items" DROP COLUMN "unitPrice"`
    );
    await queryRunner.query(
      `ALTER TABLE "supermarket_items" DROP COLUMN "priceScopeId"`
    );

    await queryRunner.query(`DROP TABLE "supermarket_location_items"`);

    await queryRunner.query(`DROP INDEX IF EXISTS "uq_items_ean"`);
    await queryRunner.query(`ALTER TABLE "items" DROP COLUMN "unitSize"`);
    await queryRunner.query(`ALTER TABLE "items" DROP COLUMN "ean"`);

    await queryRunner.query(
      `DROP INDEX IF EXISTS "uq_supermarkets_external_brand_key"`
    );
    await queryRunner.query(
      `ALTER TABLE "supermarkets" DROP COLUMN "externalBrandKey"`
    );

    await queryRunner.query(`DROP INDEX IF EXISTS "uq_locations_external_ref"`);
    await queryRunner.query(
      `ALTER TABLE "supermarket_locations" DROP COLUMN "externalProvider"`
    );
    await queryRunner.query(
      `ALTER TABLE "supermarket_locations" DROP COLUMN "externalRef"`
    );
    await queryRunner.query(
      `ALTER TABLE "supermarket_locations" DROP COLUMN "postalCode"`
    );
    await queryRunner.query(
      `ALTER TABLE "supermarket_locations" DROP CONSTRAINT "fk_locations_price_scope"`
    );
    await queryRunner.query(
      `ALTER TABLE "supermarket_locations" DROP COLUMN "priceScopeId"`
    );

    await queryRunner.query(`DROP TABLE "price_scopes"`);
    await queryRunner.query(`DROP TYPE "price_source_kind"`);
    await queryRunner.query(`DROP TYPE "price_scope_kind"`);
  }
}
