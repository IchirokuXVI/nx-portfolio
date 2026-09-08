import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Rename the `WAREHOUSE` price scope kind to `REGION` (plan 0089, section 4).
 *
 * The value was named after the only chain that had one. Mercadona publishes a
 * price per warehouse, so `WAREHOUSE` read as the truth. LIDL publishes a price
 * per offer region, which is the same idea under another name: an opaque group of
 * shops the chain prices together, keyed by a number the chain publishes. A
 * second value for the same behaviour makes every reader ask what the difference
 * is, and there is none, so the one value takes the wider name.
 *
 * `ALTER TYPE ... RENAME VALUE` rewrites the label in place. Existing rows keep
 * their identity because Postgres stores the enum by its internal id, so no row
 * is rewritten and no index is rebuilt. `NATIONAL`, `POSTAL_CODE` and `STORE` are
 * untouched.
 *
 * The rename reaches the wire, because these values are the wire format. The only
 * consumer is the back office, which reads them out of the committed OpenAPI
 * document, so the document and its generated types are regenerated in the same
 * change.
 */
export class PriceScopeRegionRename1757000000000 implements MigrationInterface {
  name = 'PriceScopeRegionRename1757000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "price_scope_kind" RENAME VALUE 'WAREHOUSE' TO 'REGION'`
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "price_scope_kind" RENAME VALUE 'REGION' TO 'WAREHOUSE'`
    );
  }
}
