import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The audit trail (plan 0075, section 6): one table, two enum types, two indexes.
 *
 * Nothing to backfill, and nothing on an existing table changes. That is not a
 * happy accident but the reason the plan is scheduled now rather than when a
 * viewer is first wanted: the table starts empty either way, and every day it
 * does not exist is a day of history that cannot be recovered later.
 *
 * No foreign key on `actorId`. An admin lives in auth's database and the
 * harvester's actor id lives in a configuration value, so there is no local
 * table to point at, and a trail that lost its rows when an operator was deleted
 * would answer "who changed this" with silence exactly when it is asked.
 */
export class CatalogAudit1756600000000 implements MigrationInterface {
  name = 'CatalogAudit1756600000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "catalog_audit_actor_kind" AS ENUM ('ADMIN', 'SERVICE')`
    );
    await queryRunner.query(
      `CREATE TYPE "catalog_audit_action" AS ENUM ('CREATE', 'UPDATE', 'DELETE')`
    );

    await queryRunner.query(`
      CREATE TABLE "catalog_audit" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "actorId" uuid NOT NULL,
        "actorKind" "catalog_audit_actor_kind" NOT NULL,
        "entity" character varying NOT NULL,
        "entityId" uuid NOT NULL,
        "action" "catalog_audit_action" NOT NULL,
        "before" jsonb,
        "after" jsonb,
        "at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "pk_catalog_audit" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      COMMENT ON TABLE "catalog_audit" IS
        'Who changed a catalog row and what it said before (plan 0075). Written inside the transaction that made the change. Read by nothing.'
    `);
    await queryRunner.query(`
      COMMENT ON COLUMN "catalog_audit"."before" IS
        'The changed fields only, never the whole row (plan 0075, section 1). Null on a create.'
    `);
    await queryRunner.query(`
      COMMENT ON COLUMN "catalog_audit"."actorKind" IS
        'Whether a person or a machine wrote it. A retention job prunes SERVICE rows and keeps ADMIN ones (plan 0075, section 4), which is why it is stored rather than resolved.'
    `);

    // Every query against this table is "recently" or "between".
    await queryRunner.query(
      `CREATE INDEX "ix_catalog_audit_at" ON "catalog_audit" ("at")`
    );
    // One row's own history, without scanning a table that grows per run.
    await queryRunner.query(
      `CREATE INDEX "ix_catalog_audit_entity" ON "catalog_audit" ("entity", "entityId")`
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "ix_catalog_audit_entity"`);
    await queryRunner.query(`DROP INDEX "ix_catalog_audit_at"`);
    await queryRunner.query(`DROP TABLE "catalog_audit"`);
    await queryRunner.query(`DROP TYPE "catalog_audit_action"`);
    await queryRunner.query(`DROP TYPE "catalog_audit_actor_kind"`);
  }
}
