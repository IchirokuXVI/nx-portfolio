import { brandKey } from '@portfolio/luna-shopper/contracts';
import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The registry of brands, and the two columns that let an item reach it
 * (plan 0115, section 3.3).
 *
 * Three steps, additive throughout:
 *
 * 1. `brands` and its unique key index.
 * 2. `items.brandKey` and `items.brandId`, with their indexes and the foreign
 *    key.
 * 3. `items.brandKey` backfilled from `items.brand`.
 *
 * **The backfill runs in TypeScript, not in SQL**, and that is the point of the
 * whole file. The key is `brandKey`, which strips combining marks after an NFD
 * normalization; `translate` cannot do that, and no database here has
 * `unaccent`, so a SQL expression would produce a *different* key from the one
 * every write computes afterwards. One function, used everywhere, includes here.
 *
 * `brandId` stays null on every row, because **no brand exists yet**: nothing
 * but a person creates one, so a migration that invented rows from the text it
 * found would be exactly the automatic registration section 9 refuses.
 */
export class Brands1757300000000 implements MigrationInterface {
  name = 'Brands1757300000000';

  /** Rows read and written per pass. A page, not the table (section 3.3). */
  private static readonly PAGE = 1000;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "brands" (
        "id"                        uuid NOT NULL DEFAULT gen_random_uuid(),
        "createdAt"                 timestamptz NOT NULL DEFAULT now(),
        "updatedAt"                 timestamptz NOT NULL DEFAULT now(),
        "key"                       varchar(120) NOT NULL,
        "label"                     varchar(120) NOT NULL,
        "privateLabelSupermarketId" uuid,
        CONSTRAINT "pk_brands" PRIMARY KEY ("id"),
        CONSTRAINT "fk_brands_private_label_supermarket"
          FOREIGN KEY ("privateLabelSupermarketId")
          REFERENCES "supermarkets" ("id") ON DELETE SET NULL
      )
    `);
    // Unique, because the key is the thing every spelling of a brand meets at.
    // A second row holding one is the 409 the create route answers.
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_brands_key" ON "brands" ("key")`
    );
    await queryRunner.query(
      `CREATE INDEX "ix_brands_private_label" ON "brands" ("privateLabelSupermarketId")`
    );

    await queryRunner.query(
      `ALTER TABLE "items" ADD COLUMN "brandKey" varchar(120)`
    );
    await queryRunner.query(`ALTER TABLE "items" ADD COLUMN "brandId" uuid`);
    await queryRunner.query(
      `CREATE INDEX "ix_items_brand_key" ON "items" ("brandKey")`
    );
    await queryRunner.query(
      `CREATE INDEX "ix_items_brand_id" ON "items" ("brandId")`
    );
    await queryRunner.query(`
      ALTER TABLE "items"
        ADD CONSTRAINT "fk_items_brand" FOREIGN KEY ("brandId")
        REFERENCES "brands" ("id") ON DELETE SET NULL
    `);

    await Brands1757300000000.backfillItemKeys(queryRunner);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "items" DROP CONSTRAINT "fk_items_brand"`
    );
    await queryRunner.query(`DROP INDEX "ix_items_brand_id"`);
    await queryRunner.query(`DROP INDEX "ix_items_brand_key"`);
    await queryRunner.query(`ALTER TABLE "items" DROP COLUMN "brandId"`);
    await queryRunner.query(`ALTER TABLE "items" DROP COLUMN "brandKey"`);
    await queryRunner.query(`DROP TABLE "brands"`);
  }

  /**
   * Walk `items` by id in pages, keying each row's brand in TypeScript.
   *
   * By id rather than by offset, so a page is a keyset and no row is read twice
   * or skipped when the planner changes its mind. The update is one statement
   * per page over an id list, which is far fewer round trips than a row at a
   * time and still bounded in memory.
   */
  private static async backfillItemKeys(
    queryRunner: QueryRunner
  ): Promise<void> {
    let after = '00000000-0000-0000-0000-000000000000';
    for (;;) {
      const page: { id: string; brand: string | null }[] =
        await queryRunner.query(
          `SELECT "id", "brand" FROM "items"
            WHERE "id" > $1
            ORDER BY "id" ASC
            LIMIT ${Brands1757300000000.PAGE}`,
          [after]
        );
      if (page.length === 0) {
        return;
      }
      after = page[page.length - 1].id;

      // Only the rows that get a key are written. A product with no brand, or
      // with a brand of punctuation, keeps the null the column already holds.
      const keyed = page
        .map((row) => ({ id: row.id, key: brandKey(row.brand) }))
        .filter((row): row is { id: string; key: string } => row.key !== null);
      if (keyed.length === 0) {
        continue;
      }

      await queryRunner.query(
        `UPDATE "items" AS i
            SET "brandKey" = keyed."key"
           FROM (
             SELECT * FROM unnest($1::uuid[], $2::varchar[]) AS t("id", "key")
           ) AS keyed
          WHERE i."id" = keyed."id"`,
        [keyed.map((row) => row.id), keyed.map((row) => row.key)]
      );
    }
  }
}
