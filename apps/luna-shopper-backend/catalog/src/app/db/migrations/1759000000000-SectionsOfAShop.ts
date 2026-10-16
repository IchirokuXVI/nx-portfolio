import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A section belongs to a shop (plan 0200, sections 1 and 2).
 *
 * Two tables, both new:
 *
 * - `shop_sections`: one aisle of one shop, with its own place in the order of
 *   that shop. The slug is unique within the shop, so two shops of one chain
 *   can both hold `fruteria`.
 * - `shop_section_categories`: the categories a section covers, a root or a
 *   leaf. The key onto `categories` is `ON DELETE RESTRICT`, as the one of
 *   `section_categories` was (plan 0166, rule R4).
 *
 * No trigger. A section names its one shop, so a foreign key says the whole
 * rule that two triggers held for the sections of a chain.
 *
 * ## The order is a constraint that can be deferred
 *
 * `uq_shop_sections_position` is `DEFERRABLE INITIALLY IMMEDIATE`. Postgres
 * checks a deferrable unique constraint at the end of the statement and not
 * row by row. One `UPDATE` can thus renumber a whole shop, and swap two
 * sections, without a collision halfway. A delete and an insert would give
 * each section a new id and lose its categories.
 *
 * ## What it copies
 *
 * For each row of `location_sections`, one row of `shop_sections` for that
 * shop with the slug and the name of the chain section and the position of the
 * selection, and one row of `shop_section_categories` for each category of
 * the chain section. A shop that selected nothing gets nothing: the sections
 * of its chain are not copied to it.
 *
 * **It deletes nothing and drops nothing.** The four tables of plan 0167 stay
 * as they are, with their rows, their triggers and their pins. Nothing reads
 * them after this migration. Release task `0004-remove-chain-sections` removes
 * their rows, and a later plan drops the empty tables.
 *
 * ## Down
 *
 * Drops the two tables. It restores nothing, because `up` removed nothing.
 */
export class SectionsOfAShop1759000000000 implements MigrationInterface {
  name = 'SectionsOfAShop1759000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "shop_sections" (
        "id"                    uuid NOT NULL DEFAULT gen_random_uuid(),
        "createdAt"             timestamptz NOT NULL DEFAULT now(),
        "updatedAt"             timestamptz NOT NULL DEFAULT now(),
        "supermarketLocationId" uuid NOT NULL,
        "slug"                  varchar(80) NOT NULL,
        "name"                  jsonb NOT NULL,
        "position"              integer NOT NULL,
        CONSTRAINT "pk_shop_sections" PRIMARY KEY ("id"),
        CONSTRAINT "fk_shop_sections_location" FOREIGN KEY ("supermarketLocationId")
          REFERENCES "supermarket_locations" ("id") ON DELETE CASCADE,
        CONSTRAINT "uq_shop_sections_slug" UNIQUE ("supermarketLocationId", "slug"),
        CONSTRAINT "uq_shop_sections_position" UNIQUE ("supermarketLocationId", "position")
          DEFERRABLE INITIALLY IMMEDIATE,
        CONSTRAINT "ck_shop_sections_position" CHECK ("position" >= 0)
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "shop_section_categories" (
        "sectionId"  uuid NOT NULL,
        "categoryId" uuid NOT NULL,
        CONSTRAINT "pk_shop_section_categories" PRIMARY KEY ("sectionId", "categoryId"),
        CONSTRAINT "fk_shop_section_categories_section" FOREIGN KEY ("sectionId")
          REFERENCES "shop_sections" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_shop_section_categories_category" FOREIGN KEY ("categoryId")
          REFERENCES "categories" ("id") ON DELETE RESTRICT
      )
    `);
    // The check a category delete makes, and the key's own delete check.
    await queryRunner.query(
      `CREATE INDEX "ix_shop_section_categories_category"
         ON "shop_section_categories" ("categoryId")`
    );

    // A slug is unique within a chain and a shop selects only sections of its
    // chain, so (shop, slug) names one copy. The second statement finds the
    // copy by that pair.
    await queryRunner.query(`
      INSERT INTO "shop_sections" ("supermarketLocationId", "slug", "name", "position")
      SELECT ls."supermarketLocationId", s."slug", s."name", ls."position"
        FROM "location_sections" ls
        JOIN "supermarket_sections" s ON s."id" = ls."sectionId"
    `);
    await queryRunner.query(`
      INSERT INTO "shop_section_categories" ("sectionId", "categoryId")
      SELECT copy."id", sc."categoryId"
        FROM "location_sections" ls
        JOIN "supermarket_sections" s ON s."id" = ls."sectionId"
        JOIN "shop_sections" copy
          ON copy."supermarketLocationId" = ls."supermarketLocationId"
         AND copy."slug" = s."slug"
        JOIN "section_categories" sc ON sc."sectionId" = s."id"
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "shop_section_categories"`);
    await queryRunner.query(`DROP TABLE "shop_sections"`);
  }
}
