import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Roles on velista accounts (plan 0175): one column and one constraint.
 *
 * `roles` holds values of `AccountRole` and defaults to the empty set, so every
 * existing account starts with none and nothing needs a backfill. The values
 * are not checked against a list here: a role is added in the contracts, and a
 * list in the database would make that a migration too. `permissionsOf` ignores
 * a value that names no role, so a stale one grants nothing.
 *
 * The constraint is the one rule that is about the row rather than the list: a
 * guest holds no role. The service refuses it first, with its own code; this is
 * what keeps a direct write from getting round it.
 */
export class UserRoles1772600000000 implements MigrationInterface {
  name = 'UserRoles1772600000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD "roles" text[] NOT NULL DEFAULT '{}'`
    );
    await queryRunner.query(`
      ALTER TABLE "users" ADD CONSTRAINT "ck_users_guest_has_no_roles"
        CHECK ("kind" = 'REGISTERED' OR "roles" = '{}')
    `);
    await queryRunner.query(`
      COMMENT ON COLUMN "users"."roles" IS
        'Roles on the account (plan 0175). What they grant is derived from PERMISSIONS_OF in the contracts at every token signing, and never stored. Set only by an operator.'
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" DROP CONSTRAINT "ck_users_guest_has_no_roles"`
    );
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "roles"`);
  }
}
