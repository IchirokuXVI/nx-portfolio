import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Shop sections, and where a product is in a shop (plan 0167, section 1).
 *
 * Four tables, all new, and no data to move:
 *
 * - `supermarket_sections`: a chain's own aisle names, in the chain's default
 *   order. The slug is unique within the chain.
 * - `section_categories`: the categories a section covers, a root or a leaf.
 *   The key onto `categories` is `ON DELETE RESTRICT`, so deleting a category a
 *   section covers is refused the way deleting one a product carries is (plan
 *   0166, rule R4).
 * - `location_sections`: which of its chain's sections a shop has, and in what
 *   order. A shop with no rows inherits every section of its chain.
 * - `supermarket_item_sections`: the pin. In one chain, a product is in these
 *   sections and no others.
 *
 * ## The rule a foreign key cannot say
 *
 * A section belongs to one chain, and both a shop's list and a pin may only
 * name a section of their own chain. Two triggers hold it, one per table, and
 * raise `check_violation` naming a constraint (`ck_location_sections_chain`,
 * `ck_item_sections_chain`) with the offending section in the detail, the shape
 * the category tree's triggers use, so `SectionService` can name the refusal.
 * Each takes a `FOR SHARE` lock on the section row it read. A section never
 * changes chain (the service has no write that moves one), and neither does a
 * shop, so checking the two join tables is the whole rule.
 *
 * ## Down
 *
 * Drops the four tables and the two functions. Nothing else read them.
 */
export class ShopSections1758200000000 implements MigrationInterface {
  name = 'ShopSections1758200000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "supermarket_sections" (
        "id"            uuid NOT NULL DEFAULT gen_random_uuid(),
        "createdAt"     timestamptz NOT NULL DEFAULT now(),
        "updatedAt"     timestamptz NOT NULL DEFAULT now(),
        "supermarketId" uuid NOT NULL,
        "slug"          varchar(80) NOT NULL,
        "name"          jsonb NOT NULL,
        "position"      integer NOT NULL,
        CONSTRAINT "pk_supermarket_sections" PRIMARY KEY ("id"),
        CONSTRAINT "fk_supermarket_sections_supermarket" FOREIGN KEY ("supermarketId")
          REFERENCES "supermarkets" ("id") ON DELETE CASCADE,
        CONSTRAINT "ck_supermarket_sections_position" CHECK ("position" >= 0)
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_supermarket_sections_slug"
         ON "supermarket_sections" ("supermarketId", "slug")`
    );
    // The chain's sections in its default order: step 1 of the rule for a shop
    // with no list of its own, and the back office's list.
    await queryRunner.query(
      `CREATE INDEX "ix_supermarket_sections_position"
         ON "supermarket_sections" ("supermarketId", "position", "id")`
    );

    await queryRunner.query(`
      CREATE TABLE "section_categories" (
        "sectionId"  uuid NOT NULL,
        "categoryId" uuid NOT NULL,
        CONSTRAINT "pk_section_categories" PRIMARY KEY ("sectionId", "categoryId"),
        CONSTRAINT "fk_section_categories_section" FOREIGN KEY ("sectionId")
          REFERENCES "supermarket_sections" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_section_categories_category" FOREIGN KEY ("categoryId")
          REFERENCES "categories" ("id") ON DELETE RESTRICT
      )
    `);
    // The check a category delete makes, and the key's own delete check.
    await queryRunner.query(
      `CREATE INDEX "ix_section_categories_category"
         ON "section_categories" ("categoryId")`
    );

    await queryRunner.query(`
      CREATE TABLE "location_sections" (
        "supermarketLocationId" uuid NOT NULL,
        "sectionId"             uuid NOT NULL,
        "position"              integer NOT NULL,
        CONSTRAINT "pk_location_sections" PRIMARY KEY ("supermarketLocationId", "sectionId"),
        CONSTRAINT "uq_location_sections_position" UNIQUE ("supermarketLocationId", "position"),
        CONSTRAINT "fk_location_sections_location" FOREIGN KEY ("supermarketLocationId")
          REFERENCES "supermarket_locations" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_location_sections_section" FOREIGN KEY ("sectionId")
          REFERENCES "supermarket_sections" ("id") ON DELETE CASCADE,
        CONSTRAINT "ck_location_sections_position" CHECK ("position" >= 0)
      )
    `);
    // A section's shops: its cascade on delete, and its location count.
    await queryRunner.query(
      `CREATE INDEX "ix_location_sections_section"
         ON "location_sections" ("sectionId")`
    );

    await queryRunner.query(`
      CREATE TABLE "supermarket_item_sections" (
        "supermarketId" uuid NOT NULL,
        "itemId"        uuid NOT NULL,
        "sectionId"     uuid NOT NULL,
        CONSTRAINT "pk_supermarket_item_sections" PRIMARY KEY ("supermarketId", "itemId", "sectionId"),
        CONSTRAINT "fk_item_sections_supermarket" FOREIGN KEY ("supermarketId")
          REFERENCES "supermarkets" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_item_sections_item" FOREIGN KEY ("itemId")
          REFERENCES "items" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_item_sections_section" FOREIGN KEY ("sectionId")
          REFERENCES "supermarket_sections" ("id") ON DELETE CASCADE
      )
    `);
    // The rule's read: the pins of the products of one basket, in one chain.
    await queryRunner.query(
      `CREATE INDEX "ix_item_sections_item"
         ON "supermarket_item_sections" ("itemId", "supermarketId")`
    );
    // The products pinned to one section, and that section's cascade.
    await queryRunner.query(
      `CREATE INDEX "ix_item_sections_section"
         ON "supermarket_item_sections" ("sectionId")`
    );

    await queryRunner.query(`
      CREATE FUNCTION "location_sections_same_chain"() RETURNS trigger
      LANGUAGE plpgsql AS $$
      DECLARE
        section_chain uuid;
        location_chain uuid;
      BEGIN
        SELECT s."supermarketId" INTO section_chain
          FROM "supermarket_sections" s
         WHERE s."id" = NEW."sectionId"
           FOR SHARE;
        SELECT l."supermarketId" INTO location_chain
          FROM "supermarket_locations" l
         WHERE l."id" = NEW."supermarketLocationId";
        IF section_chain IS NOT NULL AND location_chain IS NOT NULL
          AND section_chain <> location_chain THEN
          RAISE EXCEPTION 'section_of_another_chain: % is not a section of the chain of %', NEW."sectionId", NEW."supermarketLocationId"
            USING ERRCODE = 'check_violation',
                  CONSTRAINT = 'ck_location_sections_chain',
                  DETAIL = NEW."sectionId"::text;
        END IF;
        RETURN NEW;
      END
      $$
    `);
    await queryRunner.query(`
      CREATE TRIGGER "tg_location_sections_same_chain"
        BEFORE INSERT OR UPDATE OF "sectionId", "supermarketLocationId" ON "location_sections"
        FOR EACH ROW EXECUTE FUNCTION "location_sections_same_chain"()
    `);

    await queryRunner.query(`
      CREATE FUNCTION "item_sections_same_chain"() RETURNS trigger
      LANGUAGE plpgsql AS $$
      DECLARE
        section_chain uuid;
      BEGIN
        SELECT s."supermarketId" INTO section_chain
          FROM "supermarket_sections" s
         WHERE s."id" = NEW."sectionId"
           FOR SHARE;
        IF section_chain IS NOT NULL AND section_chain <> NEW."supermarketId" THEN
          RAISE EXCEPTION 'section_of_another_chain: % is not a section of chain %', NEW."sectionId", NEW."supermarketId"
            USING ERRCODE = 'check_violation',
                  CONSTRAINT = 'ck_item_sections_chain',
                  DETAIL = NEW."sectionId"::text;
        END IF;
        RETURN NEW;
      END
      $$
    `);
    await queryRunner.query(`
      CREATE TRIGGER "tg_item_sections_same_chain"
        BEFORE INSERT OR UPDATE OF "sectionId", "supermarketId" ON "supermarket_item_sections"
        FOR EACH ROW EXECUTE FUNCTION "item_sections_same_chain"()
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "supermarket_item_sections"`);
    await queryRunner.query(`DROP TABLE "location_sections"`);
    await queryRunner.query(`DROP TABLE "section_categories"`);
    await queryRunner.query(`DROP TABLE "supermarket_sections"`);
    await queryRunner.query(`DROP FUNCTION "item_sections_same_chain"()`);
    await queryRunner.query(`DROP FUNCTION "location_sections_same_chain"()`);
  }
}
