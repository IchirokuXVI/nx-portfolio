import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Two changes to what a product search is allowed to match, both narrowing.
 *
 * ## 1. `catalog_norm`, so a match can be required to be literal
 *
 * The search matches a stemmed document, and the Spanish stemmer conflates more
 * than a shopper expects: "salado", "salada" and "salted" all reduce to `sal`,
 * so searching for salt answered with salted caramel ice cream. The prefix does
 * the same in the other direction and matched `lech:*` to "lechuga".
 *
 * The queries now recheck the indexed match against the text as it was typed,
 * and this is the function both sides go through. Accents are removed because
 * the Spanish full text configuration removes them too: without that, a literal
 * recheck would delete every match made from a keyboard that cannot type them.
 *
 * `translate` and not `unaccent`, so no extension has to be installed in either
 * cluster for a search to keep working. The list is the accented letters Spanish
 * writes, plus the ones the other four locales in the catalog put in a brand.
 *
 * ## 2. Item documents stop carrying their group's synonyms
 *
 * A synonym names a *kind* of thing, and the kind of thing is the product group,
 * which the suggest endpoint already lists above the products. Copying every
 * synonym onto every member multiplied one typed word by the size of the group:
 * a group of twenty cartons with four synonyms answered four different queries
 * with the same twenty rows, which is the "too many results" this migration is
 * for.
 *
 * A group is still found by its own synonyms, by `product_groups.search_*`,
 * which this does not touch. What changes is that finding the *kind* no longer
 * means also listing every member of it as a separate suggestion.
 *
 * Weight C, the group's **name**, stays on the item. A carton labelled only
 * "Pascual Semidesnatada" has to be reachable by "leche", and its group is where
 * that word is written.
 */
export class StricterCatalogSearch1757100000000 implements MigrationInterface {
  name = 'StricterCatalogSearch1757100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION "catalog_norm"(t text)
      RETURNS text LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $fn$
        SELECT translate(
          lower(t),
          'áéíóúüñàèìòùâêîôûäëïöçãõåø',
          'aeiouunaeiouaeiouaeiocaoao'
        )
      $fn$
    `);
    await queryRunner.query(`
      COMMENT ON FUNCTION "catalog_norm"(text) IS
        'Lowercased and stripped of accents, for the literal recheck the product searches apply beside their full text match. Both the stored text and the typed word go through it, so a query typed without accents still matches.'
    `);

    // Weight D is gone; A, B and C are exactly as they were.
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION "catalog_refresh_item_search"()
      RETURNS trigger LANGUAGE plpgsql AS $fn$
      DECLARE
        group_name_en text;
        group_name_es text;
      BEGIN
        IF NEW."productGroupId" IS NOT NULL THEN
          SELECT g."name" ->> 'en', g."name" ->> 'es'
            INTO group_name_en, group_name_es
            FROM "product_groups" g
            WHERE g."id" = NEW."productGroupId";
        END IF;

        NEW."search_en" :=
             setweight(to_tsvector('english', coalesce(NEW."name" ->> 'en', '')), 'A')
          || setweight(to_tsvector('english', coalesce(NEW."brand", '')), 'B')
          || setweight(to_tsvector('english', coalesce(group_name_en, '')), 'C');
        NEW."search_es" :=
             setweight(to_tsvector('spanish', coalesce(NEW."name" ->> 'es', '')), 'A')
          || setweight(to_tsvector('spanish', coalesce(NEW."brand", '')), 'B')
          || setweight(to_tsvector('spanish', coalesce(group_name_es, '')), 'C');
        RETURN NEW;
      END
      $fn$
    `);

    // A synonym no longer reaches the members, so a synonym-only edit no longer
    // has to re-index them. The name still does.
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION "catalog_refresh_group_members"()
      RETURNS trigger LANGUAGE plpgsql AS $fn$
      BEGIN
        IF NEW."name" IS NOT DISTINCT FROM OLD."name" THEN
          RETURN NULL;
        END IF;
        UPDATE "items" SET "productGroupId" = "productGroupId"
          WHERE "productGroupId" = NEW."id";
        RETURN NULL;
      END
      $fn$
    `);

    // Every existing document still holds the synonyms the old trigger wrote,
    // so it is rebuilt through the new one. Grouped rows alone: an ungrouped
    // item never had a weight C or D to lose.
    await queryRunner.query(
      `UPDATE "items" SET "productGroupId" = "productGroupId" WHERE "productGroupId" IS NOT NULL`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
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
    await queryRunner.query(
      `UPDATE "items" SET "productGroupId" = "productGroupId" WHERE "productGroupId" IS NOT NULL`
    );
    await queryRunner.query(`DROP FUNCTION IF EXISTS "catalog_norm"(text)`);
  }
}
