import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Item search documents are built from normalized text (plan 0156).
 *
 * ## 1. The stemmer folds only some accents
 *
 * "plátano" and "platano" both stem to `platan`, which is why a query typed
 * without accents usually worked. "lejía" stems to `lej` and "lejia" to `leji`,
 * so the prefix `leji:*` missed every bleach. The stemmer keeps `ñ`, so "pina"
 * (`pin:*`) never reached "piña" (`piñ`). The item documents are now built from
 * `catalog_norm` of the name, the brand and the group name, and the item
 * searches pass the typed words through `catalog_norm` before `to_tsquery`. The
 * two sides agree because one function normalizes both.
 *
 * ## 2. `catalog_norm` drops apostrophes
 *
 * "Seagram's" was indexed as `seagram` and `s`, and a shopper types
 * "seagrams". Every apostrophe a keyboard or a storefront writes is now
 * deleted, so both become `seagrams`.
 *
 * Still `translate` and no `unaccent`: plan 0115 recorded why no extension is
 * installed for search. Product group documents are not changed. They keep
 * their accents, and the group search binds the typed words unnormalized.
 *
 * The rebuild is one statement over every item and the functions are
 * `CREATE OR REPLACE`, so running this twice changes nothing more.
 */
export class NormalizedItemSearch1757800000000 implements MigrationInterface {
  name = 'NormalizedItemSearch1757800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // The characters past the end of the second list are deleted: the straight
    // apostrophe, the typographic one and the backtick.
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION "catalog_norm"(t text)
      RETURNS text LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $fn$
        SELECT translate(
          lower(t),
          'áéíóúüñàèìòùâêîôûäëïöçãõåø''’\`',
          'aeiouunaeiouaeiouaeiocaoao'
        )
      $fn$
    `);
    await queryRunner.query(`
      COMMENT ON FUNCTION "catalog_norm"(text) IS
        'Lowercased, stripped of accents and apostrophes. The item search documents are built from it, and the typed words go through it before to_tsquery and before the literal recheck, so a query typed without accents matches.'
    `);

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
             setweight(to_tsvector('english', "catalog_norm"(coalesce(NEW."name" ->> 'en', ''))), 'A')
          || setweight(to_tsvector('english', "catalog_norm"(coalesce(NEW."brand", ''))), 'B')
          || setweight(to_tsvector('english', "catalog_norm"(coalesce(group_name_en, ''))), 'C');
        NEW."search_es" :=
             setweight(to_tsvector('spanish', "catalog_norm"(coalesce(NEW."name" ->> 'es', ''))), 'A')
          || setweight(to_tsvector('spanish', "catalog_norm"(coalesce(NEW."brand", ''))), 'B')
          || setweight(to_tsvector('spanish', "catalog_norm"(coalesce(group_name_es, ''))), 'C');
        RETURN NEW;
      END
      $fn$
    `);

    // Every item, grouped or not, since the name and the brand change too.
    await queryRunner.query(
      `UPDATE "items" SET "productGroupId" = "productGroupId"`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
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
    await queryRunner.query(
      `UPDATE "items" SET "productGroupId" = "productGroupId"`
    );
  }
}
