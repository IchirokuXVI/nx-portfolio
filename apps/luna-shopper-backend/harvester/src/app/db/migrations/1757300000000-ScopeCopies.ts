import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Where a copied source price was read (plan 0118, section 5.1).
 *
 * Additive: one nullable column and no backfill, because every row that exists
 * was read at its own scope, which is what null says. No foreign key, and there
 * could be none: catalog owns the scope.
 */
export class ScopeCopies1757300000000 implements MigrationInterface {
  name = 'ScopeCopies1757300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "source_entry_prices" ADD COLUMN "copiedFromScopeId" uuid`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "source_entry_prices" DROP COLUMN "copiedFromScopeId"`
    );
  }
}
