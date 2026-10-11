import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A line names its favourite product and its supermarket (plan 0199, section
 * 1).
 *
 * Two nullable columns on `list_lines` and nothing else. **Every existing row
 * is null in both**, which is the honest value: no line named a favourite or a
 * chain before this plan. There is thus no backfill, and the migration reads
 * and writes no row.
 *
 * No foreign key on either. A product and a chain are catalog rows and catalog
 * is another database, exactly as `list_line_items."itemId"` and
 * `list_lines."productGroupId"` name rows with no foreign key.
 *
 * No check constraint says that the favourite is one of the products of the
 * line. The products are rows of `list_line_items`, and a check cannot read
 * another table. The services keep the rule: every write that takes a product
 * off a line clears the favourite in the same transaction.
 *
 * No index, because nothing reads lines by favourite or by chain.
 *
 * It adds no enum and extends none, so the single transaction `migrate.ts` runs
 * everything in is no obstacle.
 *
 * `down` drops both columns, which loses every favourite and every chain that a
 * household chose. That is the whole of what this migration stores.
 */
export class LineFavoriteAndSupermarket1756003600000 implements MigrationInterface {
  name = 'LineFavoriteAndSupermarket1756003600000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "list_lines"
        ADD COLUMN "favoriteItemId" uuid,
        ADD COLUMN "preferredSupermarketId" uuid
    `);

    await queryRunner.query(`
      COMMENT ON COLUMN "list_lines"."favoriteItemId" IS
        'The one product of the line that the household wants (plan 0199). Always one of the list_line_items rows of the line, or null; the services clear it when that product leaves the line. Opaque catalog id, no foreign key.'
    `);
    await queryRunner.query(`
      COMMENT ON COLUMN "list_lines"."preferredSupermarketId" IS
        'The supermarket chain the line is bought at (plan 0199). A chain and never a shop. Does not depend on the products of the line. Opaque catalog id, no foreign key.'
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "list_lines"
        DROP COLUMN "preferredSupermarketId",
        DROP COLUMN "favoriteItemId"
    `);
  }
}
