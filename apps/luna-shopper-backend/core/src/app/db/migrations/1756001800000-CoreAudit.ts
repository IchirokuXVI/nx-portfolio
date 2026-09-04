import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Core's audit trail (plan 0077, section 8): one table, two enum types, two
 * indexes.
 *
 * `catalog_audit`'s shape, in core's database. Nothing to backfill, and nothing
 * on an existing table changes: the table starts empty either way, and every day
 * it does not exist is a day of history that cannot be recovered later.
 *
 * No foreign key on `actorId`. An admin lives in auth's database, so there is no
 * local table to point at, and a trail that lost its rows when an operator was
 * deleted would answer "who changed this" with silence exactly when it is asked.
 */
export class CoreAudit1756001800000 implements MigrationInterface {
  name = 'CoreAudit1756001800000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "core_audit_actor_kind" AS ENUM ('ADMIN', 'SERVICE')`
    );
    await queryRunner.query(
      `CREATE TYPE "core_audit_action" AS ENUM ('CREATE', 'UPDATE', 'DELETE')`
    );

    await queryRunner.query(`
      CREATE TABLE "core_audit" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "actorId" uuid NOT NULL,
        "actorKind" "core_audit_actor_kind" NOT NULL,
        "entity" character varying NOT NULL,
        "entityId" uuid NOT NULL,
        "action" "core_audit_action" NOT NULL,
        "before" jsonb,
        "after" jsonb,
        "at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "pk_core_audit" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      COMMENT ON TABLE "core_audit" IS
        'Who changed a core row and what it said before (plan 0077, section 8). Written inside the transaction that made the change. Read by nothing.'
    `);
    await queryRunner.query(`
      COMMENT ON COLUMN "core_audit"."before" IS
        'The changed fields only, never the whole row. Null on a create, and a write that changes nothing writes no row.'
    `);
    await queryRunner.query(`
      COMMENT ON COLUMN "core_audit"."actorId" IS
        'An admin_users.id from auth database. No foreign key: the admins are not in this database, and the trail outlives the row it names.'
    `);

    // Every query against this table is "recently" or "between".
    await queryRunner.query(
      `CREATE INDEX "ix_core_audit_at" ON "core_audit" ("at")`
    );
    // One row's own history, without scanning a table that grows per operator.
    await queryRunner.query(
      `CREATE INDEX "ix_core_audit_entity" ON "core_audit" ("entity", "entityId")`
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "ix_core_audit_entity"`);
    await queryRunner.query(`DROP INDEX "ix_core_audit_at"`);
    await queryRunner.query(`DROP TABLE "core_audit"`);
    await queryRunner.query(`DROP TYPE "core_audit_action"`);
    await queryRunner.query(`DROP TYPE "core_audit_actor_kind"`);
  }
}
