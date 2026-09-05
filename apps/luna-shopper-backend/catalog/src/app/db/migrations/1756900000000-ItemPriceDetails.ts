import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * What a leaflet printed beside a price (plan 0081, section 6.4).
 *
 * One table, keyed by the price row it describes and cascading with it. It is a
 * second table rather than five more columns on `item_prices` for one reason:
 * that table is read on every recompute of the effective price, and a jsonb
 * blob on every row is weight the hot path would pay for nothing. Only a
 * leaflet import writes here, so most price rows have no row at all.
 *
 * Nothing reads it except the admin's price history (plan 0080, section 10),
 * which shows the promotion wording beside the number.
 */
export class ItemPriceDetails1756900000000 implements MigrationInterface {
  name = 'ItemPriceDetails1756900000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "item_price_details" (
        "itemPriceId" uuid NOT NULL,
        "offerId" character varying,
        "page" integer,
        "rawText" jsonb,
        "promotion" jsonb,
        "loyalty" jsonb,
        CONSTRAINT "pk_item_price_details" PRIMARY KEY ("itemPriceId"),
        CONSTRAINT "fk_item_price_details_price" FOREIGN KEY ("itemPriceId")
          REFERENCES "item_prices"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      COMMENT ON TABLE "item_price_details" IS
        'What a leaflet printed beside one price (plan 0081, section 6.4). Stored verbatim, read only by the admin price history, and kept off item_prices because that table is read on every recompute.'
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "item_price_details"`);
  }
}
