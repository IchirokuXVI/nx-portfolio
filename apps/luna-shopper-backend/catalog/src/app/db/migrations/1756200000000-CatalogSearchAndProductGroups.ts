import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Product groups, and a search worth the name (plan 0048, sections 1 and 2).
 *
 * One append only migration for the whole catalog half of that plan, following
 * the rule plan 0025 restored: this adds, it does not edit an earlier file.
 *
 * ## What lands here
 *
 * `product_groups` is "milk as a thing you can buy", which is a different concept
 * from a browsing category and needs its own table. `items."productGroupId"`
 * points at it, nullable and owner curated, with **no automatic assignment**
 * anywhere.
 *
 * The rest is the search. Per locale `tsvector` columns on both tables, built
 * from the name in that locale, the item's brand, and the group's name and
 * synonyms, GIN indexed and refreshed by trigger. `pg_trgm` sits beside them with
 * its own indexes, because plain full text search handles a misspelled brand
 * badly and "pasqual" has to find Pascual.
 *
 * ## Why the vectors are columns and triggers rather than generated columns
 *
 * A Postgres generated column may only read the row it is on, and an item's
 * search document deliberately reads its **group's** name and synonyms: that is
 * the whole reason searching "leche" finds a carton labelled only "Pascual
 * Semidesnatada". So the columns are plain, one trigger maintains an item's pair
 * on any write to the item, and a second one touches a group's members when the
 * group's name or synonyms change, which re-runs the first.
 *
 * The weights are the ranking's raw material: the item's own name is `A`, its
 * brand `B`, its group's name `C` and the group's synonyms `D`, so a product
 * actually called "Milk" outranks one that merely belongs to the Milk group.
 *
 * ## The one thing that is easy to get wrong
 *
 * Deleting a group sets its members' `productGroupId` to null through the foreign
 * key, and that referential action performs a real `UPDATE`, so the item trigger
 * fires and the orphaned members' vectors lose the group's words by themselves.
 * Nothing has to remember to do it.
 */
export class CatalogSearchAndProductGroups1756200000000
  implements MigrationInterface
{
  name = 'CatalogSearchAndProductGroups1756200000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    // Typo and partial tolerance, which plain `tsvector` does not give: a lexeme
    // either matches or it does not (plan 0048, section 2).
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS pg_trgm`);

    // 1. The group itself.
    await queryRunner.query(`
      CREATE TABLE "product_groups" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        "name" jsonb NOT NULL,
        "slug" varchar NOT NULL,
        "referenceUnit" "unit_of_measure" NOT NULL DEFAULT 'UNIT',
        "synonyms" jsonb NOT NULL DEFAULT '{"en":[],"es":[]}'::jsonb,
        "search_es" tsvector,
        "search_en" tsvector,
        CONSTRAINT "pk_product_groups" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_product_groups_slug" ON "product_groups" ("slug")`
    );

    // 2. An item may belong to one. ON DELETE SET NULL rather than RESTRICT: a
    //    group is a curation decision, and undoing one must not be blocked by the
    //    products it was about.
    await queryRunner.query(
      `ALTER TABLE "items" ADD COLUMN "productGroupId" uuid`
    );
    await queryRunner.query(`
      ALTER TABLE "items"
        ADD CONSTRAINT "fk_items_product_group" FOREIGN KEY ("productGroupId")
          REFERENCES "product_groups" ("id") ON DELETE SET NULL
    `);
    await queryRunner.query(`
      CREATE INDEX "ix_items_product_group" ON "items" ("productGroupId")
        WHERE "productGroupId" IS NOT NULL
    `);

    // 3. The search documents.
    await queryRunner.query(`ALTER TABLE "items" ADD COLUMN "search_es" tsvector`);
    await queryRunner.query(`ALTER TABLE "items" ADD COLUMN "search_en" tsvector`);

    // A group's synonyms for one locale, as one string. Its own function because
    // three places need it and because a malformed `synonyms` (anything but an
    // array under the locale key) has to degrade to no words rather than throw
    // inside a trigger, where the failure would be an unwritable row.
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION "catalog_synonyms_text"(syn jsonb, loc text)
      RETURNS text LANGUAGE sql IMMUTABLE AS $fn$
        SELECT coalesce(
          (
            SELECT string_agg(word, ' ')
            FROM jsonb_array_elements_text(
              CASE WHEN jsonb_typeof(syn -> loc) = 'array'
                   THEN syn -> loc
                   ELSE '[]'::jsonb END
            ) AS t(word)
          ),
          ''
        )
      $fn$
    `);

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION "catalog_refresh_item_search"()
      RETURNS trigger LANGUAGE plpgsql AS $fn$
      DECLARE
        group_name_en text;
        group_name_es text;
        group_syn_en text;
        group_syn_es text;
      BEGIN
        IF NEW."productGroupId" IS NOT NULL THEN
          SELECT g."name" ->> 'en',
                 g."name" ->> 'es',
                 "catalog_synonyms_text"(g."synonyms", 'en'),
                 "catalog_synonyms_text"(g."synonyms", 'es')
            INTO group_name_en, group_name_es, group_syn_en, group_syn_es
            FROM "product_groups" g
            WHERE g."id" = NEW."productGroupId";
        END IF;

        NEW."search_en" :=
             setweight(to_tsvector('english', coalesce(NEW."name" ->> 'en', '')), 'A')
          || setweight(to_tsvector('english', coalesce(NEW."brand", '')), 'B')
          || setweight(to_tsvector('english', coalesce(group_name_en, '')), 'C')
          || setweight(to_tsvector('english', coalesce(group_syn_en, '')), 'D');
        NEW."search_es" :=
             setweight(to_tsvector('spanish', coalesce(NEW."name" ->> 'es', '')), 'A')
          || setweight(to_tsvector('spanish', coalesce(NEW."brand", '')), 'B')
          || setweight(to_tsvector('spanish', coalesce(group_name_es, '')), 'C')
          || setweight(to_tsvector('spanish', coalesce(group_syn_es, '')), 'D');
        RETURN NEW;
      END
      $fn$
    `);
    await queryRunner.query(`
      CREATE TRIGGER "tg_items_search"
        BEFORE INSERT OR UPDATE ON "items"
        FOR EACH ROW EXECUTE FUNCTION "catalog_refresh_item_search"()
    `);

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION "catalog_refresh_group_search"()
      RETURNS trigger LANGUAGE plpgsql AS $fn$
      BEGIN
        NEW."search_en" :=
             setweight(to_tsvector('english', coalesce(NEW."name" ->> 'en', '')), 'A')
          || setweight(to_tsvector('english', "catalog_synonyms_text"(NEW."synonyms", 'en')), 'B');
        NEW."search_es" :=
             setweight(to_tsvector('spanish', coalesce(NEW."name" ->> 'es', '')), 'A')
          || setweight(to_tsvector('spanish', "catalog_synonyms_text"(NEW."synonyms", 'es')), 'B');
        RETURN NEW;
      END
      $fn$
    `);
    await queryRunner.query(`
      CREATE TRIGGER "tg_product_groups_search"
        BEFORE INSERT OR UPDATE ON "product_groups"
        FOR EACH ROW EXECUTE FUNCTION "catalog_refresh_group_search"()
    `);

    // Renaming a group, or giving it a synonym, changes what every one of its
    // members is findable by. The no-op self assignment is deliberate: it fires
    // the item trigger above, so the document is built in exactly one place.
    // AFTER UPDATE only, because a group being inserted has no members yet.
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION "catalog_refresh_group_members"()
      RETURNS trigger LANGUAGE plpgsql AS $fn$
      BEGIN
        IF NEW."name" IS NOT DISTINCT FROM OLD."name"
           AND NEW."synonyms" IS NOT DISTINCT FROM OLD."synonyms" THEN
          RETURN NULL;
        END IF;
        UPDATE "items" SET "productGroupId" = "productGroupId"
          WHERE "productGroupId" = NEW."id";
        RETURN NULL;
      END
      $fn$
    `);
    await queryRunner.query(`
      CREATE TRIGGER "tg_product_groups_members"
        AFTER UPDATE ON "product_groups"
        FOR EACH ROW EXECUTE FUNCTION "catalog_refresh_group_members"()
    `);

    // 4. Backfill every item that already exists, through the same trigger.
    await queryRunner.query(
      `UPDATE "items" SET "productGroupId" = "productGroupId"`
    );

    // 5. The indexes. GIN for the full text match, GIN + trgm for the fuzzy one.
    //    The trigram indexes are expression indexes on the localized names, which
    //    is legal because `jsonb ->> text` is immutable.
    await queryRunner.query(
      `CREATE INDEX "ix_items_search_es" ON "items" USING gin ("search_es")`
    );
    await queryRunner.query(
      `CREATE INDEX "ix_items_search_en" ON "items" USING gin ("search_en")`
    );
    await queryRunner.query(
      `CREATE INDEX "ix_product_groups_search_es" ON "product_groups" USING gin ("search_es")`
    );
    await queryRunner.query(
      `CREATE INDEX "ix_product_groups_search_en" ON "product_groups" USING gin ("search_en")`
    );
    await queryRunner.query(`
      CREATE INDEX "ix_items_brand_trgm" ON "items"
        USING gin ("brand" gin_trgm_ops)
    `);
    await queryRunner.query(`
      CREATE INDEX "ix_items_name_en_trgm" ON "items"
        USING gin (("name" ->> 'en') gin_trgm_ops)
    `);
    await queryRunner.query(`
      CREATE INDEX "ix_items_name_es_trgm" ON "items"
        USING gin (("name" ->> 'es') gin_trgm_ops)
    `);
    await queryRunner.query(`
      CREATE INDEX "ix_product_groups_name_en_trgm" ON "product_groups"
        USING gin (("name" ->> 'en') gin_trgm_ops)
    `);
    await queryRunner.query(`
      CREATE INDEX "ix_product_groups_name_es_trgm" ON "product_groups"
        USING gin (("name" ->> 'es') gin_trgm_ops)
    `);
  }

  /**
   * The reverse. It is lossy in exactly one way, and knowingly: the curation that
   * assigned products to groups is deleted with the groups, because there is
   * nowhere else for it to live. Everything else here is derived data that the
   * forward migration would rebuild.
   *
   * `pg_trgm` is deliberately left installed. It is a database wide extension
   * that another schema may already depend on, and dropping something this
   * migration only ever created "if not exists" would be a reversal that removes
   * more than it added.
   */
  async down(queryRunner: QueryRunner): Promise<void> {
    for (const index of [
      'ix_product_groups_name_es_trgm',
      'ix_product_groups_name_en_trgm',
      'ix_items_name_es_trgm',
      'ix_items_name_en_trgm',
      'ix_items_brand_trgm',
      'ix_product_groups_search_en',
      'ix_product_groups_search_es',
      'ix_items_search_en',
      'ix_items_search_es',
    ]) {
      await queryRunner.query(`DROP INDEX IF EXISTS "${index}"`);
    }

    await queryRunner.query(
      `DROP TRIGGER IF EXISTS "tg_product_groups_members" ON "product_groups"`
    );
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS "tg_product_groups_search" ON "product_groups"`
    );
    await queryRunner.query(`DROP TRIGGER IF EXISTS "tg_items_search" ON "items"`);
    await queryRunner.query(
      `DROP FUNCTION IF EXISTS "catalog_refresh_group_members"()`
    );
    await queryRunner.query(
      `DROP FUNCTION IF EXISTS "catalog_refresh_group_search"()`
    );
    await queryRunner.query(
      `DROP FUNCTION IF EXISTS "catalog_refresh_item_search"()`
    );
    await queryRunner.query(
      `DROP FUNCTION IF EXISTS "catalog_synonyms_text"(jsonb, text)`
    );

    await queryRunner.query(`ALTER TABLE "items" DROP COLUMN "search_en"`);
    await queryRunner.query(`ALTER TABLE "items" DROP COLUMN "search_es"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "ix_items_product_group"`);
    await queryRunner.query(
      `ALTER TABLE "items" DROP CONSTRAINT "fk_items_product_group"`
    );
    await queryRunner.query(`ALTER TABLE "items" DROP COLUMN "productGroupId"`);

    await queryRunner.query(`DROP TABLE "product_groups"`);
  }
}
