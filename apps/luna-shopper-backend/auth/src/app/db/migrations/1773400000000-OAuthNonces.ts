import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The nonce of a Google sign in from the Android app (plan 0238): one new
 * table, shaped like the other grants.
 *
 * `userId` cascades, so a deleted account leaves no nonce naming it behind.
 * The expiry index is there from the start, because the retention sweep reads
 * every grant table by it (plan 0233).
 *
 * It only adds. No release task: nothing a person or a run wrote is read,
 * changed or deleted.
 */
export class OAuthNonces1773400000000 implements MigrationInterface {
  name = 'OAuthNonces1773400000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "oauth_nonces" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        "userId" uuid,
        "silent" boolean NOT NULL DEFAULT false,
        "termsVersion" varchar,
        "locale" varchar,
        "tokenHash" varchar NOT NULL,
        "expiresAt" timestamptz NOT NULL,
        "consumedAt" timestamptz,
        CONSTRAINT "pk_oauth_nonces" PRIMARY KEY ("id"),
        CONSTRAINT "uq_oauth_nonce_token" UNIQUE ("tokenHash"),
        CONSTRAINT "fk_oauth_nonces_user" FOREIGN KEY ("userId")
          REFERENCES "users" ("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "ix_oauth_nonces_user" ON "oauth_nonces" ("userId")`
    );
    await queryRunner.query(
      `CREATE INDEX "ix_oauth_nonces_expires_at" ON "oauth_nonces" ("expiresAt")`
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "oauth_nonces"`);
  }
}
