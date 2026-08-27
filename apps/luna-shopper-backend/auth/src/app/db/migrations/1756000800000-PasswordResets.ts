import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The password reset grant table (plan 0022, section 1).
 *
 * Its own table rather than a `purpose` column on `email_verifications`: the two
 * grants expire on clocks a factor of twenty four apart, spending them does
 * different things, and a table named `email_verifications` holding password
 * resets is a lie the next reader of the schema has to discover.
 *
 * Shaped exactly like `email_verifications`, cascade included, so deleting a user
 * still takes every outstanding grant with it (plan 0011, section 1).
 *
 * Append only.
 */
export class PasswordResets1756000800000 implements MigrationInterface {
  name = 'PasswordResets1756000800000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "password_resets" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        "userId" uuid NOT NULL,
        "tokenHash" varchar NOT NULL,
        "expiresAt" timestamptz NOT NULL,
        "consumedAt" timestamptz,
        CONSTRAINT "pk_password_resets" PRIMARY KEY ("id"),
        CONSTRAINT "uq_password_reset_token" UNIQUE ("tokenHash"),
        CONSTRAINT "fk_password_resets_user" FOREIGN KEY ("userId")
          REFERENCES "users" ("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "ix_password_resets_user" ON "password_resets" ("userId")`
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "password_resets"`);
  }
}
