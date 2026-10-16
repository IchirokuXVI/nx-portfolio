import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Support sessions (plan 0194): one table and one nullable column.
 *
 * It only adds. No row is read, changed or deleted, so an existing refresh
 * token keeps its 30 day life and names no session.
 *
 * `impersonation_sessions.adminId` has no foreign key, as `auth_audit.actorId`
 * has none: the row must outlive the admin it names. `userId` cascades, so a
 * deleted account leaves no session behind, and the refresh rows of a session
 * cascade from the session in turn.
 */
export class ImpersonationSessions1772700000000 implements MigrationInterface {
  name = 'ImpersonationSessions1772700000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "impersonation_sessions" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        "adminId" uuid NOT NULL,
        "userId" uuid NOT NULL,
        "reason" varchar NOT NULL,
        "reasonNote" text,
        "expiresAt" timestamptz NOT NULL,
        "endedAt" timestamptz,
        "codeHash" varchar NOT NULL,
        "codeExpiresAt" timestamptz NOT NULL,
        "codeConsumedAt" timestamptz,
        CONSTRAINT "pk_impersonation_sessions" PRIMARY KEY ("id"),
        CONSTRAINT "uq_impersonation_sessions_code" UNIQUE ("codeHash"),
        CONSTRAINT "fk_impersonation_sessions_user" FOREIGN KEY ("userId")
          REFERENCES "users" ("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "ix_impersonation_sessions_user" ON "impersonation_sessions" ("userId")`
    );
    await queryRunner.query(
      `CREATE INDEX "ix_impersonation_sessions_pair" ON "impersonation_sessions" ("adminId", "userId")`
    );
    await queryRunner.query(`
      COMMENT ON COLUMN "impersonation_sessions"."expiresAt" IS
        'The hard deadline of the support session (plan 0194): creation time plus two hours. Written by the insert and never again.'
    `);

    await queryRunner.query(
      `ALTER TABLE "refresh_tokens" ADD "impersonationSessionId" uuid`
    );
    await queryRunner.query(`
      ALTER TABLE "refresh_tokens" ADD CONSTRAINT "fk_refresh_tokens_impersonation_session"
        FOREIGN KEY ("impersonationSessionId")
        REFERENCES "impersonation_sessions" ("id") ON DELETE CASCADE
    `);
    // Partial: only the rows of a support session are ever looked up by it,
    // and they are a handful beside the rows of ordinary sessions.
    await queryRunner.query(`
      CREATE INDEX "ix_refresh_tokens_impersonation_session"
        ON "refresh_tokens" ("impersonationSessionId")
        WHERE "impersonationSessionId" IS NOT NULL
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "ix_refresh_tokens_impersonation_session"`
    );
    await queryRunner.query(
      `ALTER TABLE "refresh_tokens" DROP CONSTRAINT "fk_refresh_tokens_impersonation_session"`
    );
    await queryRunner.query(
      `ALTER TABLE "refresh_tokens" DROP COLUMN "impersonationSessionId"`
    );
    await queryRunner.query(`DROP TABLE "impersonation_sessions"`);
  }
}
