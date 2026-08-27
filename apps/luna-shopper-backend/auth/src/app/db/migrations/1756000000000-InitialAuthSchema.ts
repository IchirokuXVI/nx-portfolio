import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The auth baseline (plan 0025). Creates the whole identity schema: users,
 * credentials, oauth identities, and the three grant tables (email
 * verifications, password resets, oauth states).
 *
 * This is a squash. It replaces the original `InitialAuthSchema` plus
 * `GlobalUsername` (plan 0018), `PasswordResets` (plan 0022) and `OAuthStates`
 * (plan 0023), which were collapsed while the service had never been deployed and
 * no database anywhere held their history. Plans 0018, 0022 and 0023 still
 * describe the decisions; only the migration files were merged.
 *
 * **Append only from here.** The squash was a one time reset of the baseline,
 * taken during the last window in which it was free. Every later change is a new
 * migration, never an edit to this one.
 *
 * Applied by the deploy Job (plan 0002); `synchronize` is never used.
 *
 * ## Why each grant gets its own table
 *
 * `email_verifications`, `password_resets` and `oauth_states` are deliberately
 * three tables rather than one with a `purpose` column. They expire on clocks
 * nothing like each other (a day, an hour, ten minutes), and spending them does
 * entirely different things. A ten minute grant sharing a table with a day long
 * one is a query filter away from a bug nobody sees, and a table named
 * `email_verifications` holding password resets is a lie the next reader of the
 * schema has to discover.
 *
 * All three cascade from `users`, so deleting a user still takes every
 * outstanding grant with it (plan 0011, section 1).
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

    // `username` is NOT NULL from creation (plan 0018). It arrived as a nullable
    // column plus a backfill, because at the time the plan assumed rows already
    // existed; none ever did, so the squash creates it in its final shape and the
    // backfill is gone. The real names come from the request locale's word pool
    // at identity creation, so a guest is never nameless.
    await queryRunner.query(`
      CREATE TABLE "users" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        "kind" "user_kind" NOT NULL,
        "email" varchar,
        "emailVerifiedAt" timestamptz,
        "displayName" varchar,
        "username" varchar NOT NULL,
        CONSTRAINT "pk_users" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_users_email" ON "users" ("email") WHERE "email" IS NOT NULL`
    );
    // Not unique, on purpose (plan 0018, section 2): two users may share a name.
    // The index exists only so the back office can search by it.
    await queryRunner.query(
      `CREATE INDEX "ix_users_username" ON "users" ("username")`
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

    // Shaped exactly like `email_verifications`, cascade included (plan 0022).
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

    // `userId` is nullable here and nowhere else among the grants (plan 0023,
    // section 4.1): a state minted by somebody with no account is the ordinary
    // sign in from scratch. The cascade still applies when it is set.
    await queryRunner.query(`
      CREATE TABLE "oauth_states" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        "userId" uuid,
        "locale" varchar,
        "tokenHash" varchar NOT NULL,
        "expiresAt" timestamptz NOT NULL,
        "consumedAt" timestamptz,
        CONSTRAINT "pk_oauth_states" PRIMARY KEY ("id"),
        CONSTRAINT "uq_oauth_state_token" UNIQUE ("tokenHash"),
        CONSTRAINT "fk_oauth_states_user" FOREIGN KEY ("userId")
          REFERENCES "users" ("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "ix_oauth_states_user" ON "oauth_states" ("userId")`
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "oauth_states"`);
    await queryRunner.query(`DROP TABLE "password_resets"`);
    await queryRunner.query(`DROP TABLE "refresh_tokens"`);
    await queryRunner.query(`DROP TABLE "email_verifications"`);
    await queryRunner.query(`DROP TABLE "oauth_identities"`);
    await queryRunner.query(`DROP TABLE "credentials"`);
    await queryRunner.query(`DROP TABLE "users"`);
    await queryRunner.query(`DROP TYPE "auth_provider"`);
    await queryRunner.query(`DROP TYPE "user_kind"`);
  }
}
