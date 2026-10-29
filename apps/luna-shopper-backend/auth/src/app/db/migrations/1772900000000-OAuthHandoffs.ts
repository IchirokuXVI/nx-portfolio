import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A Google sign in that lands only on the account that asked for it (plan
 * 0230): one column on `oauth_states` and one new table.
 *
 * It only adds. `oauth_states.codeChallenge` is nullable because rows exist at
 * the moment of the deploy. They are at most ten minutes old, and a consume
 * refuses a row without a challenge, so nobody who could finish the flow loses
 * anything. No release task: nothing a person or a run wrote is read, changed
 * or deleted.
 *
 * `oauth_handoffs` is shaped like the other grants. `userId` cascades, so a
 * deleted account leaves no staged link onto itself behind.
 */
export class OAuthHandoffs1772900000000 implements MigrationInterface {
  name = 'OAuthHandoffs1772900000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "oauth_states" ADD "codeChallenge" varchar`
    );

    await queryRunner.query(`
      CREATE TABLE "oauth_handoffs" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        "userId" uuid,
        "providerUserId" varchar NOT NULL,
        "email" varchar,
        "displayName" varchar,
        "codeChallenge" varchar NOT NULL,
        "locale" varchar,
        "tokenHash" varchar NOT NULL,
        "expiresAt" timestamptz NOT NULL,
        "consumedAt" timestamptz,
        CONSTRAINT "pk_oauth_handoffs" PRIMARY KEY ("id"),
        CONSTRAINT "uq_oauth_handoff_token" UNIQUE ("tokenHash"),
        CONSTRAINT "fk_oauth_handoffs_user" FOREIGN KEY ("userId")
          REFERENCES "users" ("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "ix_oauth_handoffs_user" ON "oauth_handoffs" ("userId")`
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "oauth_handoffs"`);
    await queryRunner.query(
      `ALTER TABLE "oauth_states" DROP COLUMN "codeChallenge"`
    );
  }
}
