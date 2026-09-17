import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A brand may be a spelling of another brand (plan 0124, section 2).
 *
 * One nullable column, its foreign key, one index and one check. Additive, and
 * it writes no row: every link is a person's decision in the back office, as
 * every brand row already is.
 *
 * **The check is the self link and nothing more.** The one level rule, that a
 * link never points at a linked brand and a brand others point at is never
 * linked itself, is two rows apart and a check constraint cannot read another
 * row. `BrandService` enforces it inside the transaction under `FOR UPDATE`
 * locks, which is also what makes two concurrent links serialise. A trigger
 * would be a second place the rule lives, and a slower one.
 */
export class BrandLinks1757600000000 implements MigrationInterface {
  name = 'BrandLinks1757600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "brands" ADD COLUMN "canonicalBrandId" uuid`
    );
    // ON DELETE SET NULL, as the private label chain is: there is no delete
    // today, and the day one is added a brand losing its canonical brand goes
    // back to standing for itself rather than vanishing with it.
    await queryRunner.query(`
      ALTER TABLE "brands"
        ADD CONSTRAINT "fk_brands_canonical" FOREIGN KEY ("canonicalBrandId")
        REFERENCES "brands" ("id") ON DELETE SET NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "brands"
        ADD CONSTRAINT "ck_brands_not_own_canonical"
        CHECK ("canonicalBrandId" IS NULL OR "canonicalBrandId" <> "id")
    `);
    // The link is read from both ends: a brand's canonical label on every read,
    // and the brands pointing at it for the link count and the spellings table.
    await queryRunner.query(
      `CREATE INDEX "ix_brands_canonical" ON "brands" ("canonicalBrandId")`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "ix_brands_canonical"`);
    await queryRunner.query(
      `ALTER TABLE "brands" DROP CONSTRAINT "ck_brands_not_own_canonical"`
    );
    await queryRunner.query(
      `ALTER TABLE "brands" DROP CONSTRAINT "fk_brands_canonical"`
    );
    await queryRunner.query(
      `ALTER TABLE "brands" DROP COLUMN "canonicalBrandId"`
    );
  }
}
