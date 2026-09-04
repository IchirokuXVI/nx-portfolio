import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Auth's audit trail (plan 0077, section 8): one table, two enum types, two
 * indexes.
 *
 * `catalog_audit`'s shape, in auth's database. Nothing to backfill, and nothing
 * on an existing table changes: the table starts empty either way, and every day
 * it does not exist is a day of history that cannot be recovered later.
 *
 * No foreign key on `actorId`, even though `admin_users` is in this database and
 * one could be written. A cascade would erase an operator's history at the moment
 * their access was withdrawn, which is exactly when somebody reads it, and a
 * restrict would make removing an operator impossible once they had touched a
 * row. The trail records what the gate verified and outlives the row it names.
 */
export class AuthAudit1772500000000 implements MigrationInterface {
  name = 'AuthAudit1772500000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "auth_audit_actor_kind" AS ENUM ('ADMIN', 'SERVICE')`
    );
    await queryRunner.query(
      `CREATE TYPE "auth_audit_action" AS ENUM ('CREATE', 'UPDATE', 'DELETE')`
    );

    await queryRunner.query(`
      CREATE TABLE "auth_audit" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "actorId" uuid NOT NULL,
        "actorKind" "auth_audit_actor_kind" NOT NULL,
        "entity" character varying NOT NULL,
        "entityId" uuid NOT NULL,
        "action" "auth_audit_action" NOT NULL,
        "before" jsonb,
        "after" jsonb,
        "at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "pk_auth_audit" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      COMMENT ON TABLE "auth_audit" IS
        'Who changed an auth row and what it said before (plan 0077, section 8). Written inside the transaction that made the change. Read by nothing.'
    `);
    await queryRunner.query(`
      COMMENT ON COLUMN "auth_audit"."before" IS
        'The changed fields only, never the whole row. Null on a create, and a write that changes nothing writes no row.'
    `);
    await queryRunner.query(`
      COMMENT ON COLUMN "auth_audit"."actorId" IS
        'An admin_users.id. No foreign key on purpose: the trail outlives the operator it names, and withdrawing access must not erase what that operator did.'
    `);

    // Every query against this table is "recently" or "between".
    await queryRunner.query(
      `CREATE INDEX "ix_auth_audit_at" ON "auth_audit" ("at")`
    );
    // One row's own history, without scanning a table that grows per operator.
    await queryRunner.query(
      `CREATE INDEX "ix_auth_audit_entity" ON "auth_audit" ("entity", "entityId")`
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "ix_auth_audit_entity"`);
    await queryRunner.query(`DROP INDEX "ix_auth_audit_at"`);
    await queryRunner.query(`DROP TABLE "auth_audit"`);
    await queryRunner.query(`DROP TYPE "auth_audit_action"`);
    await queryRunner.query(`DROP TYPE "auth_audit_actor_kind"`);
  }
}
