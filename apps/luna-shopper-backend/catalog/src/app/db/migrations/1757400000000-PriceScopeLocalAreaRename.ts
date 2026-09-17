import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Rename the `POSTAL_CODE` price scope kind to `LOCAL_AREA` (plan 0116, section 2).
 *
 * No code path ever created a `POSTAL_CODE` scope, so the rename changes the
 * meaning of no row. It is a rename rather than a fifth value beside the old one,
 * because a kind nobody writes is still a kind an operator can pick by mistake.
 * Mercadona's warehouses move into it, at the default priority of 200.
 *
 * `ALTER TYPE ... RENAME VALUE` rewrites the label in place, the same shape as
 * `PriceScopeRegionRename1757000000000`. Postgres stores the enum by its internal
 * id, so no row is rewritten and the value keeps its position between `REGION`
 * and `STORE`.
 *
 * There is no data migration. The one warehouse scope in each cluster is the
 * reference seed's `4661`, and the seed upserts it by id as `LOCAL_AREA` on the
 * next deploy (section 4).
 */
export class PriceScopeLocalAreaRename1757400000000 implements MigrationInterface {
  name = 'PriceScopeLocalAreaRename1757400000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "price_scope_kind" RENAME VALUE 'POSTAL_CODE' TO 'LOCAL_AREA'`
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "price_scope_kind" RENAME VALUE 'LOCAL_AREA' TO 'POSTAL_CODE'`
    );
  }
}
