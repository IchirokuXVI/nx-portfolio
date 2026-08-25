import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Core side of the catalog link (plan 0012, section 4). `list_lines.itemId` was
 * added nullable in plan 0007; it becomes the live optional reference to a catalog
 * `Item`. The reference is cross service (catalog owns its own database), so it is
 * validated in application code, NOT by a database foreign key: this migration only
 * adds an index for the lookups that filter lines by item, and documents the
 * column's meaning. Append only.
 */
export class FormalizeLineItemRef1756000400000 implements MigrationInterface {
  name = 'FormalizeLineItemRef1756000400000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX "ix_lines_item" ON "list_lines" ("itemId") WHERE "itemId" IS NOT NULL`
    );
    await queryRunner.query(
      `COMMENT ON COLUMN "list_lines"."itemId" IS 'Opaque reference to a catalog Item (plan 0012). Validated in application code, never a database foreign key: catalog is a separate service with its own database.'`
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`COMMENT ON COLUMN "list_lines"."itemId" IS NULL`);
    await queryRunner.query(`DROP INDEX "ix_lines_item"`);
  }
}
