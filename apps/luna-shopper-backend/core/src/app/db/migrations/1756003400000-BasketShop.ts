import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The shop a basket is bought at (plan 0163, section 1).
 *
 * One nullable column on `baskets` and one check constraint. The column is
 * written once, by the request that creates a generated basket, and never
 * changed after by anybody. The constraint says the other half of that rule in
 * the database: a `LIVE` basket never has a shop, because its shop is a choice
 * of the device and not of the basket.
 *
 * **Every existing row is null**, so the constraint holds on the day it is
 * added and there is no backfill. No foreign key: a shop is a catalog row and
 * catalog is another database, exactly as `pricingProfileId` beside it names a
 * profile with no foreign key. No index, because nothing reads baskets by shop.
 *
 * It adds no enum and extends none, so the single transaction `migrate.ts` runs
 * everything in is no obstacle (plan 0130, section 13).
 *
 * `down` drops the constraint and the column, which loses which shop each
 * basket was started at. That is the whole of what this migration stores.
 */
export class BasketShop1756003400000 implements MigrationInterface {
  name = 'BasketShop1756003400000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "baskets"
        ADD COLUMN "supermarketLocationId" uuid
    `);

    await queryRunner.query(`
      ALTER TABLE "baskets"
        ADD CONSTRAINT "ck_baskets_live_no_shop" CHECK (
          "kind" <> 'LIVE' OR "supermarketLocationId" IS NULL
        )
    `);

    await queryRunner.query(`
      COMMENT ON COLUMN "baskets"."supermarketLocationId" IS
        'The shop this basket was started at (plan 0163). Set only when a GENERATED basket is created and never changed after; always null on a LIVE basket. Opaque catalog id, no foreign key.'
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "baskets"
        DROP CONSTRAINT "ck_baskets_live_no_shop"
    `);
    await queryRunner.query(`
      ALTER TABLE "baskets"
        DROP COLUMN "supermarketLocationId"
    `);
  }
}
