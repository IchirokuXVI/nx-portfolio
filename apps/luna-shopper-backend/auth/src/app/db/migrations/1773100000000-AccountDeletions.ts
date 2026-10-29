import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The outbox of `user.deleted` (plan 0232, section 5): one new table that
 * references nothing and that nothing references.
 *
 * It only adds. No release task: nothing a person or a run wrote is read,
 * changed or deleted.
 */
export class AccountDeletions1773100000000 implements MigrationInterface {
  name = 'AccountDeletions1773100000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "account_deletions" (
        "userId" uuid NOT NULL,
        "deletedAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_account_deletions" PRIMARY KEY ("userId")
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "account_deletions"`);
  }
}
