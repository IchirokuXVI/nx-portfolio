import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A scope says how specific it is, and a shop holds several (plan 0105).
 *
 * Five steps in one file, and one file on purpose (section 9, D5): the join
 * table is seeded from the column it replaces, so leaving the column behind for
 * a second migration would give two answers to one question for however long
 * that migration took to arrive.
 *
 * 1. `price_scopes.priority`, nullable to begin with.
 * 2. Backfilled from the kind, with the defaults of section 2.2, then made
 *    NOT NULL. Existing rows are never renumbered afterwards.
 * 3. `supermarket_location_price_scopes`.
 * 4. One row per existing location, from its `priceScopeId`. Every shop
 *    therefore starts with exactly the stack it has today, of size one, and
 *    every read returns what it returned before this ran.
 * 5. `supermarket_locations.priceScopeId` is dropped.
 *
 * `down` reverses all five. It can only restore a single scope per shop, so it
 * takes the most specific one; a stack of more than one is information the old
 * column cannot hold, and losing the rest is what going back means.
 */
export class PriceScopePriority1757200000000 implements MigrationInterface {
  name = 'PriceScopePriority1757200000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "price_scopes" ADD COLUMN "priority" integer`
    );
    // The defaults of section 2.2, written once here rather than read from the
    // TypeScript constant: a migration states the schema at the moment it ran,
    // and a constant that moves later must not silently rewrite history.
    await queryRunner.query(`
      UPDATE "price_scopes"
         SET "priority" = CASE "kind"
                            WHEN 'STORE'       THEN 100
                            WHEN 'POSTAL_CODE' THEN 200
                            WHEN 'REGION'      THEN 300
                            WHEN 'NATIONAL'    THEN 1000
                          END
    `);
    await queryRunner.query(
      `ALTER TABLE "price_scopes" ALTER COLUMN "priority" SET NOT NULL`
    );

    await queryRunner.query(`
      CREATE TABLE "supermarket_location_price_scopes" (
        "supermarketLocationId" uuid NOT NULL,
        "priceScopeId"          uuid NOT NULL,
        CONSTRAINT "pk_location_price_scopes"
          PRIMARY KEY ("supermarketLocationId", "priceScopeId"),
        CONSTRAINT "fk_location_price_scopes_location"
          FOREIGN KEY ("supermarketLocationId")
          REFERENCES "supermarket_locations" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_location_price_scopes_scope"
          FOREIGN KEY ("priceScopeId")
          REFERENCES "price_scopes" ("id") ON DELETE RESTRICT
      )
    `);
    // The primary key already serves a lookup by shop. This is the other
    // direction, which is what "the shops that sell at this scope" reads.
    await queryRunner.query(`
      CREATE INDEX "ix_location_scopes_scope"
        ON "supermarket_location_price_scopes" ("priceScopeId")
    `);

    await queryRunner.query(`
      INSERT INTO "supermarket_location_price_scopes"
             ("supermarketLocationId", "priceScopeId")
      SELECT "id", "priceScopeId" FROM "supermarket_locations"
    `);

    await queryRunner.query(
      `ALTER TABLE "supermarket_locations" DROP COLUMN "priceScopeId"`
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "supermarket_locations" ADD COLUMN "priceScopeId" uuid`
    );
    // The most specific scope of each stack, which for every shop that predates
    // this migration is the only one it had.
    await queryRunner.query(`
      UPDATE "supermarket_locations" l
         SET "priceScopeId" = pick."priceScopeId"
        FROM (
          SELECT DISTINCT ON (ls."supermarketLocationId")
                 ls."supermarketLocationId" AS "locationId",
                 ls."priceScopeId"
            FROM "supermarket_location_price_scopes" ls
            JOIN "price_scopes" s ON s."id" = ls."priceScopeId"
           ORDER BY ls."supermarketLocationId", s."priority" ASC, ls."priceScopeId" ASC
        ) pick
       WHERE pick."locationId" = l."id"
    `);
    await queryRunner.query(
      `ALTER TABLE "supermarket_locations" ALTER COLUMN "priceScopeId" SET NOT NULL`
    );
    await queryRunner.query(`
      ALTER TABLE "supermarket_locations"
        ADD CONSTRAINT "fk_locations_price_scope" FOREIGN KEY ("priceScopeId")
        REFERENCES "price_scopes" ("id") ON DELETE RESTRICT
    `);
    await queryRunner.query(`
      CREATE INDEX "ix_locations_price_scope"
        ON "supermarket_locations" ("priceScopeId")
    `);

    await queryRunner.query(`DROP TABLE "supermarket_location_price_scopes"`);
    await queryRunner.query(
      `ALTER TABLE "price_scopes" DROP COLUMN "priority"`
    );
  }
}
