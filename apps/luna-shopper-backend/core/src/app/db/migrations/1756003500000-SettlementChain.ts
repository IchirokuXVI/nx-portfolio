import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The chain of the shop a settle was made at (plan 0163, section 5).
 *
 * One nullable column on `line_settlements`, and `ck_line_settlements_location_scope`
 * widened to say what it means: the chain is written together with the shop and
 * never without it. Core cannot join catalog, and plan 0165 counts purchases by
 * chain, which is why the chain is copied onto the row rather than looked up.
 *
 * **Every existing row has the new column null**, so the widened constraint
 * holds on the day it is added. Old rows are not backfilled: velista never sent
 * a shop before this plan, so there is nothing to fill.
 *
 * The constraint is dropped and added again under the same name, inside the one
 * transaction `migrate.ts` runs everything in, so there is no moment at which
 * the old rule is missing. It adds no enum and extends none (plan 0130, section
 * 13). No index: plan 0165 reads through `ix_settlements_line`.
 *
 * `down` puts the old constraint back and drops the column, which loses the
 * chain of every settle this plan recorded. The shop stays, and the chain can be
 * read from catalog again for it.
 */
export class SettlementChain1756003500000 implements MigrationInterface {
  name = 'SettlementChain1756003500000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "line_settlements"
        ADD COLUMN "supermarketId" uuid
    `);

    await queryRunner.query(`
      ALTER TABLE "line_settlements"
        DROP CONSTRAINT "ck_line_settlements_location_scope",
        ADD CONSTRAINT "ck_line_settlements_location_scope" CHECK (
          ("supermarketLocationId" IS NULL OR "priceScopeId" IS NOT NULL)
          AND ("supermarketId" IS NULL OR "supermarketLocationId" IS NOT NULL)
        )
    `);

    await queryRunner.query(`
      COMMENT ON COLUMN "line_settlements"."supermarketId" IS
        'The chain of "supermarketLocationId", copied at settle time so a count by chain needs no join into catalog (plan 0163). Never set without the shop. Opaque catalog id, no foreign key.'
    `);
    await queryRunner.query(`
      COMMENT ON COLUMN "line_settlements"."supermarketLocationId" IS
        'The shop the settle was made at, when one was chosen (plan 0143, plan 0163). Served back only in a person''s own history and on the item history of plan 0151; plan 0165 reads it only as counts. Never set without "priceScopeId".'
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "line_settlements"
        DROP CONSTRAINT "ck_line_settlements_location_scope",
        ADD CONSTRAINT "ck_line_settlements_location_scope" CHECK (
          "supermarketLocationId" IS NULL OR "priceScopeId" IS NOT NULL
        )
    `);
    await queryRunner.query(`
      COMMENT ON COLUMN "line_settlements"."supermarketLocationId" IS NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "line_settlements"
        DROP COLUMN "supermarketId"
    `);
  }
}
