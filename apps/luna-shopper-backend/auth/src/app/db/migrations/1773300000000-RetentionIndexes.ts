import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The indexes the retention sweep reads by (plan 0233, section 5): the expiry
 * of the five grant tables and of support sessions, and the attempt time of a
 * failed operator login. Before it, a sweep of any of them was a full scan.
 * The fifth grant table, `oauth_handoffs`, joined in a review follow up
 * (section 10).
 *
 * And one beyond the plan's list (section 10): the successor
 * pointer of a refresh token. `fk_refresh_tokens_replaced_by` is `ON DELETE
 * SET NULL` onto the same table, so every deleted token makes Postgres look
 * for the rows that name it. Without an index that is a scan of the whole
 * table per deleted row: one batch of 1000 took 1713 ms on 50,000 tokens, and
 * 12 ms with it. Partial, because only a rotated row has a successor.
 *
 * Not `CONCURRENTLY`: the bundled runner (`migrate.ts`) and the CLI both run
 * the set in one transaction, and `CREATE INDEX CONCURRENTLY` cannot run in
 * one. These tables are small enough that a plain build is well under a
 * second.
 *
 * It only adds. No release task: no row is read, changed or deleted.
 */
export class RetentionIndexes1773300000000 implements MigrationInterface {
  name = 'RetentionIndexes1773300000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX "ix_refresh_tokens_expires_at" ON "refresh_tokens" ("expiresAt")`
    );
    await queryRunner.query(
      `CREATE INDEX "ix_password_resets_expires_at" ON "password_resets" ("expiresAt")`
    );
    await queryRunner.query(
      `CREATE INDEX "ix_email_verifications_expires_at" ON "email_verifications" ("expiresAt")`
    );
    await queryRunner.query(
      `CREATE INDEX "ix_oauth_states_expires_at" ON "oauth_states" ("expiresAt")`
    );
    await queryRunner.query(
      `CREATE INDEX "ix_oauth_handoffs_expires_at" ON "oauth_handoffs" ("expiresAt")`
    );
    await queryRunner.query(
      `CREATE INDEX "ix_impersonation_sessions_expires_at" ON "impersonation_sessions" ("expiresAt")`
    );
    await queryRunner.query(
      `CREATE INDEX "ix_admin_login_failures_created" ON "admin_login_failures" ("createdAt")`
    );
    await queryRunner.query(
      `CREATE INDEX "ix_refresh_tokens_replaced_by" ON "refresh_tokens" ("replacedById") WHERE "replacedById" IS NOT NULL`
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "ix_refresh_tokens_replaced_by"`);
    await queryRunner.query(`DROP INDEX "ix_admin_login_failures_created"`);
    await queryRunner.query(
      `DROP INDEX "ix_impersonation_sessions_expires_at"`
    );
    await queryRunner.query(`DROP INDEX "ix_oauth_handoffs_expires_at"`);
    await queryRunner.query(`DROP INDEX "ix_oauth_states_expires_at"`);
    await queryRunner.query(`DROP INDEX "ix_email_verifications_expires_at"`);
    await queryRunner.query(`DROP INDEX "ix_password_resets_expires_at"`);
    await queryRunner.query(`DROP INDEX "ix_refresh_tokens_expires_at"`);
  }
}
