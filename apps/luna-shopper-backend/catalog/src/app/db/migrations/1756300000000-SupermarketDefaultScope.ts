import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The last rung of the scope ladder (plan 0049, section 3.1).
 *
 * Plan 0049 section 7 says catalog needs no schema change, and it is almost
 * right: the resolution it describes is a read, not a table. The exception is
 * this one column, which section 3.1 asks for by name ("an owner set field on
 * `Supermarket`") and which did not exist yet, because plan 0038 had no reason
 * to name a chain's fallback scope. One nullable column is the whole of it.
 *
 * No foreign key to `price_scopes` on purpose. A constraint here would make
 * deleting a scope refuse when some chain happens to point at it as its default,
 * and "this chain has no default any more" is a perfectly good answer that the
 * resolver already handles: it simply drops off the end of the ladder.
 */
export class SupermarketDefaultScope1756300000000 implements MigrationInterface {
  name = 'SupermarketDefaultScope1756300000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "supermarkets" ADD COLUMN "defaultPriceScopeId" uuid`
    );
    await queryRunner.query(`
      COMMENT ON COLUMN "supermarkets"."defaultPriceScopeId" IS
        'The scope to quote this chain''s prices from when the caller named no place (plan 0049, section 3.1). A result reached through it is flagged approximate, because it is a price for somewhere else.'
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "supermarkets" DROP COLUMN "defaultPriceScopeId"`
    );
  }
}
