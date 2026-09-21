import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * What an account has been shown (plan 0145, section 1).
 *
 * One new table and nothing else. It references no other table and no other
 * table references it, so it can be created at any point in the order and is
 * placed last, after every migration that exists today.
 *
 * **The account is the key.** `userId` is the primary key rather than a column
 * beside a generated one, which is what makes the row at most one per account
 * without a second unique index saying so, and what makes the concurrent double
 * write in section 6 resolve to one row rather than to two.
 *
 * No foreign key, because core holds no user table (the same rule
 * `shopping_profiles` follows). The row is left behind when an account is
 * deleted, and `AccountDeletionService` is where that is swept, not here.
 *
 * Both timestamps are null on every row this migration can create, which is
 * none: the table is empty when it is made and the row is created on demand by
 * the first write. No backfill, and nothing to read.
 *
 * It adds no enum and extends none, so the single transaction `migrate.ts` runs
 * everything in is no obstacle (plan 0130, section 13).
 *
 * `down` drops the table, which loses the fact that anybody finished the setup
 * or the tour. That is the whole of what this plan stores, and the cost of
 * losing it is a setup offered a second time.
 */
export class UserAppState1756003200000 implements MigrationInterface {
  name = 'UserAppState1756003200000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "user_app_state" (
        "userId" uuid NOT NULL,
        "setupCompletedAt" TIMESTAMP WITH TIME ZONE,
        "tourSeenAt" TIMESTAMP WITH TIME ZONE,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "pk_user_app_state" PRIMARY KEY ("userId")
      )
    `);

    await queryRunner.query(`
      COMMENT ON TABLE "user_app_state" IS
        'What one account has been shown (plan 0145). One row per account, created on demand by the first write; a missing row reads as two nulls. The account lives in auth''s database, so "userId" carries no foreign key.'
    `);
    await queryRunner.query(`
      COMMENT ON COLUMN "user_app_state"."setupCompletedAt" IS
        'When the setup was finished OR dismissed (plan 0145). A timestamp and not a boolean, so a later release can ask how old the answer is.'
    `);
    await queryRunner.query(`
      COMMENT ON COLUMN "user_app_state"."tourSeenAt" IS
        'When the tour was finished or skipped (plan 0145). Replaying the tour does not clear it: it is a fact about the past, not a switch.'
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "user_app_state"`);
  }
}
