import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * First catalog migration (plan 0012, section 5): supermarkets (chains),
 * supermarket locations (stores), items (global products) and supermarket items
 * (per location price + in store position). Localized text fields are jsonb
 * carrying at least English and Spanish. Append only.
 */
export class InitialCatalogSchema1756000500000 implements MigrationInterface {
  name = 'InitialCatalogSchema1756000500000';

  async up(queryRunner: QueryRunner): Promise<void> {
    // gen_random_uuid() for uuid defaults, consistent with the other services.
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);

    await queryRunner.query(
      `CREATE TYPE "item_category" AS ENUM (
        'PRODUCE', 'DAIRY', 'BAKERY', 'MEAT', 'SEAFOOD', 'FROZEN', 'BEVERAGES',
        'SNACKS', 'PANTRY', 'HOUSEHOLD', 'PERSONAL_CARE', 'OTHER'
      )`
    );
    await queryRunner.query(
      `CREATE TYPE "unit_of_measure" AS ENUM (
        'UNIT', 'GRAM', 'KILOGRAM', 'MILLILITER', 'LITER', 'PACK'
      )`
    );

    await queryRunner.query(`
      CREATE TABLE "supermarkets" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        "name" jsonb NOT NULL,
        "logoUrl" varchar,
        "websiteUrl" varchar,
        CONSTRAINT "pk_supermarkets" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "supermarket_locations" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        "supermarketId" uuid NOT NULL,
        "label" jsonb,
        "address" varchar,
        "city" varchar,
        "country" varchar,
        "latitude" double precision,
        "longitude" double precision,
        CONSTRAINT "pk_supermarket_locations" PRIMARY KEY ("id"),
        CONSTRAINT "fk_locations_supermarket" FOREIGN KEY ("supermarketId")
          REFERENCES "supermarkets" ("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "ix_locations_supermarket" ON "supermarket_locations" ("supermarketId")`
    );

    await queryRunner.query(`
      CREATE TABLE "items" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        "name" jsonb NOT NULL,
        "brand" varchar,
        "imageUrl" varchar,
        "sku" varchar,
        "category" "item_category" NOT NULL DEFAULT 'OTHER',
        "defaultUnit" "unit_of_measure" NOT NULL DEFAULT 'UNIT',
        CONSTRAINT "pk_items" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "supermarket_items" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        "itemId" uuid NOT NULL,
        "supermarketLocationId" uuid NOT NULL,
        "price" numeric(12,2),
        "currency" varchar(3),
        "positionInStore" varchar,
        "available" boolean NOT NULL DEFAULT true,
        CONSTRAINT "pk_supermarket_items" PRIMARY KEY ("id"),
        CONSTRAINT "uq_supermarket_item" UNIQUE ("itemId", "supermarketLocationId"),
        CONSTRAINT "fk_supermarket_items_item" FOREIGN KEY ("itemId")
          REFERENCES "items" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_supermarket_items_location" FOREIGN KEY ("supermarketLocationId")
          REFERENCES "supermarket_locations" ("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "ix_supermarket_items_item" ON "supermarket_items" ("itemId")`
    );
    await queryRunner.query(
      `CREATE INDEX "ix_supermarket_items_location" ON "supermarket_items" ("supermarketLocationId")`
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "supermarket_items"`);
    await queryRunner.query(`DROP TABLE "items"`);
    await queryRunner.query(`DROP TABLE "supermarket_locations"`);
    await queryRunner.query(`DROP TABLE "supermarkets"`);
    await queryRunner.query(`DROP TYPE "unit_of_measure"`);
    await queryRunner.query(`DROP TYPE "item_category"`);
  }
}
