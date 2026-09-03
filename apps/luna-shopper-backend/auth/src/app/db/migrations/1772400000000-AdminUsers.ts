import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The operator identity (plan 0071, section 10).
 *
 * Two tables, and nothing else: `users`, `credentials` and `refresh_tokens` are
 * untouched, there is no foreign key in either direction, and there is nothing to
 * backfill. That is the separation of section 1 expressed in DDL — an admin
 * credential is not reachable from any query the user facing half of this service
 * makes.
 *
 * `admin_login_failures` is created here even though nothing reads it yet
 * (section 7). Rows cannot be written retroactively, so the table starts
 * collecting on the first day and a dashboard added later has history behind it.
 */
export class AdminUsers1772400000000 implements MigrationInterface {
  name = 'AdminUsers1772400000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "admin_users" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        "username" varchar NOT NULL,
        "passwordHash" varchar NOT NULL,
        "displayName" varchar,
        "disabledAt" timestamptz,
        "lastLoginAt" timestamptz,
        CONSTRAINT "pk_admin_users" PRIMARY KEY ("id")
      )
    `);
    // Unique, unlike `ix_users_username`, and section 1 is why: login is by name,
    // so two operators sharing one would make "which account did this"
    // unanswerable at exactly the moment it is asked.
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_admin_users_username" ON "admin_users" ("username")`
    );

    await queryRunner.query(`
      CREATE TABLE "admin_login_failures" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        "username" varchar NOT NULL,
        "ip" varchar,
        "userAgent" varchar(512),
        CONSTRAINT "pk_admin_login_failures" PRIMARY KEY ("id")
      )
    `);
    // The lockout counts failures for one username since a moment, which is this
    // index exactly. No foreign key to `admin_users`: the attempts worth keeping
    // are the ones naming an account that does not exist.
    await queryRunner.query(
      `CREATE INDEX "ix_admin_login_failures_username_created" ON "admin_login_failures" ("username", "createdAt")`
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "admin_login_failures"`);
    await queryRunner.query(`DROP TABLE "admin_users"`);
  }
}
