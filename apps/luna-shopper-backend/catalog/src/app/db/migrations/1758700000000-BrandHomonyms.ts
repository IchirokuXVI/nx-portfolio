import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A printed key may name more than one brand (plan 0178).
 *
 * One table, additive, and it writes no row: every homonym is a person's
 * decision in the back office, as every brand row already is. `brands` is not
 * touched, so `uq_brands_key` still holds and a key still has exactly one brand
 * of its own. This table is the list of the other brands a printed key names.
 *
 * **No brand is deleted or renamed here.** The `D.O.` brand the plan was
 * written about is a registry row, and a person removes it.
 *
 * The unique index is what makes adding the same homonym twice one row. The
 * rule that a homonym is never the brand's own key reads a second table, which
 * a check constraint cannot do, so `BrandService` enforces it under the brand's
 * row lock.
 */
export class BrandHomonyms1758700000000 implements MigrationInterface {
  name = 'BrandHomonyms1758700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "brand_homonyms" (
        "id"         uuid NOT NULL DEFAULT gen_random_uuid(),
        "createdAt"  timestamptz NOT NULL DEFAULT now(),
        "updatedAt"  timestamptz NOT NULL DEFAULT now(),
        "printedKey" varchar(120) NOT NULL,
        "brandId"    uuid NOT NULL,
        CONSTRAINT "pk_brand_homonyms" PRIMARY KEY ("id"),
        CONSTRAINT "fk_brand_homonyms_brand" FOREIGN KEY ("brandId")
          REFERENCES "brands" ("id") ON DELETE CASCADE
      )
    `);
    // Leads on the printed key, because that is what the queue asks by: which
    // brands does this key name.
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_brand_homonyms_key_brand" ON "brand_homonyms" ("printedKey", "brandId")`
    );
    // The other end: a brand's own list, and the cascade when a spelling goes.
    await queryRunner.query(
      `CREATE INDEX "ix_brand_homonyms_brand" ON "brand_homonyms" ("brandId")`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "ix_brand_homonyms_brand"`);
    await queryRunner.query(`DROP INDEX "uq_brand_homonyms_key_brand"`);
    await queryRunner.query(`DROP TABLE "brand_homonyms"`);
  }
}
