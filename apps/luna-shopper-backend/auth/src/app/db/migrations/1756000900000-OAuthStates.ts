import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The OAuth state grant table (plan 0023, section 4.1).
 *
 * Its own table for the reason `password_resets` got one: the three grants expire
 * on clocks nothing like each other (a day, an hour, ten minutes) and spending
 * them does entirely different things. A ten minute grant sharing a table with a
 * day long one is a query filter away from a bug nobody sees.
 *
 * `userId` is nullable here and nowhere else among the grants, because a state
 * minted by somebody with no account is the ordinary sign in from scratch. The
 * cascade still applies when it is set, so deleting a user takes their
 * outstanding states with them (plan 0011, section 1).
 *
 * Append only.
 */
export class OAuthStates1756000900000 implements MigrationInterface {
  name = 'OAuthStates1756000900000';

  async up(queryRunner: QueryRunner): Promise<void> {
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
  }
}
