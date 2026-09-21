import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * What was paid, recorded at the shelf (plan 0143, section 5).
 *
 * Two columns beside the two `line_settlements` has carried unwritten since
 * plan 0047 section 3.4, and four check constraints that say what the four of
 * them mean together.
 *
 * **Every existing row has all four columns null**, so every constraint holds
 * on the day it is added and there is no backfill. The outcome enum is compared
 * and never extended, so the one transaction `migrate.ts` runs everything in is
 * no obstacle here (plan 0130, section 13).
 *
 * `down` is **lossy for every price this plan recorded**, and says so. It drops
 * the currency and the scope, and it clears the amount and the shop that
 * depended on them, which leaves the table exactly as plan 0047 shaped it: four
 * columns, all null.
 *
 * The plan asked `down` to drop the two columns and leave `pricePaidCents`
 * holding amounts with no currency. That state fails this migration's own
 * `ck_line_settlements_price` on the way back up, so a `down` followed by an
 * `up` broke on a row the `down` had just orphaned. A migration that cannot be
 * re-applied is not reversible, and the amount was not money any more anyway:
 * an amount with no currency is a number, which is section 2's own argument for
 * the column existing.
 *
 * No index. Nothing reads by scope or by shop yet, and `line_settlements` is
 * the table plan 0047 section 3.4 warned is the largest in core.
 */
export class SettlementPricePaid1756003100000 implements MigrationInterface {
  name = 'SettlementPricePaid1756003100000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "line_settlements"
        ADD COLUMN "pricePaidCurrency" character varying(3),
        ADD COLUMN "priceScopeId" uuid
    `);

    await queryRunner.query(`
      ALTER TABLE "line_settlements"
        ADD CONSTRAINT "ck_line_settlements_price" CHECK (
          ("pricePaidCents" IS NULL) = ("pricePaidCurrency" IS NULL)
        ),
        ADD CONSTRAINT "ck_line_settlements_price_amount" CHECK (
          "pricePaidCents" IS NULL OR "pricePaidCents" >= 0
        ),
        ADD CONSTRAINT "ck_line_settlements_price_bought" CHECK (
          "pricePaidCents" IS NULL OR "outcome" = 'BOUGHT'
        ),
        ADD CONSTRAINT "ck_line_settlements_location_scope" CHECK (
          "supermarketLocationId" IS NULL OR "priceScopeId" IS NOT NULL
        )
    `);

    await queryRunner.query(`
      COMMENT ON COLUMN "line_settlements"."pricePaidCents" IS
        'Catalog price of ONE unit of "itemId" at "priceScopeId", in the minor unit of "pricePaidCurrency", read by the gateway when the settle was made (plan 0143). Not the row total and not catalog unitPrice. Null when nobody knew.'
    `);
    await queryRunner.query(`
      COMMENT ON COLUMN "line_settlements"."priceScopeId" IS
        'The price scope the shopper was looking at: a chain catchment, not a shop. Opaque catalog id, no foreign key (plan 0143).'
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "line_settlements"
        DROP CONSTRAINT "ck_line_settlements_location_scope",
        DROP CONSTRAINT "ck_line_settlements_price_bought",
        DROP CONSTRAINT "ck_line_settlements_price_amount",
        DROP CONSTRAINT "ck_line_settlements_price"
    `);

    // Every price this plan wrote goes with the currency that gave it a
    // meaning, and the shop goes with the scope that placed it.
    //
    // Both are the same rule stated twice, and it is the rule of the plan
    // itself: an amount of money with no currency is a number, and a shop with
    // no scope is a place this table may not hold. Leaving either behind would
    // put the table in a state its own `up` refuses, so a `down` followed by an
    // `up` would fail on the constraint the `down` had just orphaned a row
    // against. A migration that cannot be re-applied is not reversible.
    //
    // Every row written before this plan has all four columns null, so on the
    // only database that has never had these columns this statement matches
    // nothing.
    await queryRunner.query(`
      UPDATE "line_settlements"
         SET "pricePaidCents" = NULL,
             "supermarketLocationId" = NULL
       WHERE "pricePaidCurrency" IS NOT NULL
          OR "supermarketLocationId" IS NOT NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "line_settlements"
        DROP COLUMN "priceScopeId",
        DROP COLUMN "pricePaidCurrency"
    `);
  }
}
