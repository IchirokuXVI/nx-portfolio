import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Account deletion and zone ownership fallback (plan 0011). Adds the zone
 * `markedForDeletionAt` marker (with a partial index the zone reaper scans) and
 * the `processed_events` inbox that makes the `user.deleted` handler idempotent.
 * Append only.
 */
export class AccountDeletion1756000410000 implements MigrationInterface {
  name = 'AccountDeletion1756000410000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "zones" ADD COLUMN "markedForDeletionAt" timestamptz`
    );
    await queryRunner.query(
      `CREATE INDEX "ix_zones_marked_for_deletion" ON "zones" ("markedForDeletionAt") WHERE "markedForDeletionAt" IS NOT NULL`
    );
    await queryRunner.query(`
      CREATE TABLE "processed_events" (
        "key" varchar NOT NULL,
        "processedAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_processed_events" PRIMARY KEY ("key")
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "processed_events"`);
    await queryRunner.query(`DROP INDEX "ix_zones_marked_for_deletion"`);
    await queryRunner.query(
      `ALTER TABLE "zones" DROP COLUMN "markedForDeletionAt"`
    );
  }
}
