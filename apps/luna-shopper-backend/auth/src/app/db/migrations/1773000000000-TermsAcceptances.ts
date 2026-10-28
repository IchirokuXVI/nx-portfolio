import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Every account records which Terms it accepted (plan 0231, section 4.1): one
 * new table, and one nullable column on each of the two rows that carry a
 * Google sign in across its round trip.
 *
 * It only adds. Rows of `oauth_states` and `oauth_handoffs` that exist at the
 * deploy read as "no version", which records nothing and refuses nothing while
 * `TERMS_ACCEPTANCE_REQUIRED` is false. No release task: nothing a person or a
 * run wrote is read, changed or deleted.
 *
 * `userId` cascades, so an account delete takes its acceptances (plan 0232).
 */
export class TermsAcceptances1773000000000 implements MigrationInterface {
  name = 'TermsAcceptances1773000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "terms_acceptance_via" AS ENUM ('REGISTER', 'UPGRADE', 'GOOGLE', 'GUEST', 'PROMPT')`
    );
    await queryRunner.query(`
      CREATE TABLE "terms_acceptances" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "userId" uuid NOT NULL,
        "version" varchar NOT NULL,
        "acceptedAt" timestamptz NOT NULL DEFAULT now(),
        "via" "terms_acceptance_via" NOT NULL,
        CONSTRAINT "pk_terms_acceptances" PRIMARY KEY ("id"),
        CONSTRAINT "uq_terms_acceptance_user_version" UNIQUE ("userId", "version"),
        CONSTRAINT "fk_terms_acceptances_user" FOREIGN KEY ("userId")
          REFERENCES "users" ("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `ALTER TABLE "oauth_states" ADD "termsVersion" varchar`
    );
    await queryRunner.query(
      `ALTER TABLE "oauth_handoffs" ADD "termsVersion" varchar`
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "oauth_handoffs" DROP COLUMN "termsVersion"`
    );
    await queryRunner.query(
      `ALTER TABLE "oauth_states" DROP COLUMN "termsVersion"`
    );
    await queryRunner.query(`DROP TABLE "terms_acceptances"`);
    await queryRunner.query(`DROP TYPE "terms_acceptance_via"`);
  }
}
