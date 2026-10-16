import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A buy and a taken back buy are changes of a line (plan 0203, section 1).
 *
 * `list_line_changes.kind` is a `varchar` under a check constraint, and not a
 * Postgres enum. The migration thus replaces the check with one that allows
 * eight kinds, and it extends no type. The single transaction that
 * `migrate.ts` runs every migration in is no obstacle.
 *
 * `up` reads and writes no row. Every existing row holds one of the six old
 * kinds, so the new check holds on the day it is added.
 *
 * `down` **deletes the rows of the two new kinds** before it puts the old check
 * back, because the old check refuses them. Those rows are the record that a
 * buy moved a quantity. The purchases themselves are rows of
 * `line_settlements` and stay.
 */
export class LineChangeBuyKinds1756003700000 implements MigrationInterface {
  name = 'LineChangeBuyKinds1756003700000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "list_line_changes"
        DROP CONSTRAINT "ck_list_line_changes_kind"
    `);
    await queryRunner.query(`
      ALTER TABLE "list_line_changes"
        ADD CONSTRAINT "ck_list_line_changes_kind" CHECK (
          "kind" IN (
            'ADDED','QUANTITY_CHANGED','RENAMED','MERGED','DELETED','APPROVAL_CHANGED',
            'BOUGHT','BUY_REVERTED'
          )
        )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM "list_line_changes"
      WHERE "kind" IN ('BOUGHT','BUY_REVERTED')
    `);
    await queryRunner.query(`
      ALTER TABLE "list_line_changes"
        DROP CONSTRAINT "ck_list_line_changes_kind"
    `);
    await queryRunner.query(`
      ALTER TABLE "list_line_changes"
        ADD CONSTRAINT "ck_list_line_changes_kind" CHECK (
          "kind" IN (
            'ADDED','QUANTITY_CHANGED','RENAMED','MERGED','DELETED','APPROVAL_CHANGED'
          )
        )
    `);
  }
}
