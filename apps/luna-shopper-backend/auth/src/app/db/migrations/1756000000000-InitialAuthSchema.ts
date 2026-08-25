import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * First auth migration (plan 0005, section 6): creates the identity schema
 * (users, credentials, oauth identities, email verifications, refresh tokens).
 * Append only thereafter; never edited or deleted after shipping. Applied by the
 * deploy Job (plan 0002), never by `synchronize`.
 */
export class InitialAuthSchema1756000000000 implements MigrationInterface {
  name = 'InitialAuthSchema1756000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);

    await queryRunner.query(
      `CREATE TYPE "user_kind" AS ENUM ('TEMPORARY', 'REGISTERED')`
    );
    await queryRunner.query(
      `CREATE TYPE "auth_provider" AS ENUM ('GOOGLE', 'EMAIL')`
    );

    await queryRunner.query(`
      CREATE TABLE "users" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        "kind" "user_kind" NOT NULL,
        "email" varchar,
        "emailVerifiedAt" timestamptz,
        "displayName" varchar,
        CONSTRAINT "pk_users" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_users_email" ON "users" ("email") WHERE "email" IS NOT NULL`
    );

    await queryRunner.query(`
      CREATE TABLE "credentials" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        "userId" uuid NOT NULL,
        "passwordHash" varchar NOT NULL,
        CONSTRAINT "pk_credentials" PRIMARY KEY ("id"),
        CONSTRAINT "uq_credentials_user" UNIQUE ("userId"),
        CONSTRAINT "fk_credentials_user" FOREIGN KEY ("userId")
          REFERENCES "users" ("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "oauth_identities" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        "userId" uuid NOT NULL,
        "provider" "auth_provider" NOT NULL,
        "providerUserId" varchar NOT NULL,
        CONSTRAINT "pk_oauth_identities" PRIMARY KEY ("id"),
        CONSTRAINT "uq_oauth_provider_user" UNIQUE ("provider", "providerUserId"),
        CONSTRAINT "fk_oauth_identities_user" FOREIGN KEY ("userId")
          REFERENCES "users" ("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "email_verifications" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        "userId" uuid NOT NULL,
        "tokenHash" varchar NOT NULL,
        "expiresAt" timestamptz NOT NULL,
        "consumedAt" timestamptz,
        CONSTRAINT "pk_email_verifications" PRIMARY KEY ("id"),
        CONSTRAINT "uq_email_verification_token" UNIQUE ("tokenHash"),
        CONSTRAINT "fk_email_verifications_user" FOREIGN KEY ("userId")
          REFERENCES "users" ("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "refresh_tokens" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        "userId" uuid NOT NULL,
        "tokenHash" varchar NOT NULL,
        "expiresAt" timestamptz NOT NULL,
        "revokedAt" timestamptz,
        CONSTRAINT "pk_refresh_tokens" PRIMARY KEY ("id"),
        CONSTRAINT "uq_refresh_token" UNIQUE ("tokenHash"),
        CONSTRAINT "fk_refresh_tokens_user" FOREIGN KEY ("userId")
          REFERENCES "users" ("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "ix_refresh_tokens_user" ON "refresh_tokens" ("userId")`
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "refresh_tokens"`);
    await queryRunner.query(`DROP TABLE "email_verifications"`);
    await queryRunner.query(`DROP TABLE "oauth_identities"`);
    await queryRunner.query(`DROP TABLE "credentials"`);
    await queryRunner.query(`DROP TABLE "users"`);
    await queryRunner.query(`DROP TYPE "auth_provider"`);
    await queryRunner.query(`DROP TYPE "user_kind"`);
  }
}
