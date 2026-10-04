import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A product has more than one barcode (plan 0185).
 *
 * One table, additive. `items.ean` and `uq_items_ean` are not touched: the
 * column stays the product's first barcode, and this table holds every barcode
 * of every product, the first one included.
 *
 * **The copy takes real barcodes only.** Plan 0184 counted 211 in-store codes
 * and 11 invalid codes among the products of the first catalog. An in-store
 * code is never a row of this table, and an invalid code names nothing, so
 * neither is copied. Such a product keeps its `items.ean` exactly as it was and
 * has no row here. The rule is the one `readGtin` states, written in SQL:
 *
 * - digits only, with no space around them,
 * - 8, 12, 13 or 14 of them,
 * - not 13 digits that start with 2,
 * - a valid check digit.
 *
 * `ItemEansMigration` in `item-eans-migration.integration.spec.ts` asserts the
 * SQL against the cases `readGtin` is tested with, so the two cannot drift.
 *
 * The check constraint is the first three lines of that rule. It is what keeps
 * an in-store code out of the table whatever writes to it. The check digit is
 * left to `requireProductEan`, which every write goes through.
 *
 * **It deletes nothing**, in either direction: `down` drops the table and the
 * products are as they were.
 */
export class ItemEans1758800000000 implements MigrationInterface {
  name = 'ItemEans1758800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "item_eans" (
        "ean"       varchar NOT NULL,
        "itemId"    uuid NOT NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_item_eans" PRIMARY KEY ("ean"),
        CONSTRAINT "fk_item_eans_item" FOREIGN KEY ("itemId")
          REFERENCES "items" ("id") ON DELETE CASCADE,
        CONSTRAINT "ck_item_eans_real" CHECK (
          "ean" ~ '^[0-9]+$'
          AND length("ean") IN (8, 12, 13, 14)
          AND NOT (length("ean") = 13 AND left("ean", 1) = '2')
        )
      )
    `);
    // A product's own list, oldest first, and the cascade when a product goes.
    await queryRunner.query(
      `CREATE INDEX "ix_item_eans_item" ON "item_eans" ("itemId", "createdAt")`
    );

    // The CASE is what orders the two tests: the cast to a number in the check
    // digit sum must never meet a code that holds something else than digits.
    await queryRunner.query(`
      INSERT INTO "item_eans" ("ean", "itemId", "createdAt")
      SELECT i."ean", i."id", i."createdAt"
        FROM "items" i
       WHERE CASE
               WHEN i."ean" IS NULL THEN false
               WHEN i."ean" !~ '^[0-9]+$' THEN false
               WHEN length(i."ean") NOT IN (8, 12, 13, 14) THEN false
               WHEN length(i."ean") = 13 AND left(i."ean", 1) = '2' THEN false
               ELSE (
                 SELECT (10 - (sum(
                          substr(i."ean", length(i."ean") - g, 1)::int
                          * CASE WHEN g % 2 = 1 THEN 3 ELSE 1 END
                        ) % 10)) % 10
                   FROM generate_series(1, length(i."ean") - 1) AS g
               ) = right(i."ean", 1)::int
             END
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "ix_item_eans_item"`);
    await queryRunner.query(`DROP TABLE "item_eans"`);
  }
}
