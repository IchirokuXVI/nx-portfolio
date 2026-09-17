import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Run requests saved under a name, and the run that remembers which one it was
 * started from (plan 0120, sections 2 and 7).
 *
 * Additive: a new table, and one nullable column on `harvest_runs` that every
 * existing run leaves null, because nobody started one from a preset.
 *
 * `presetId` has **no foreign key**, on purpose. Deleting a preset leaves its
 * runs as they were, and a run still says it came from a preset that is gone.
 */
export class RunPresets1757400000000 implements MigrationInterface {
  name = 'RunPresets1757400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "harvest_run_presets" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        "supermarketId" uuid NOT NULL,
        "name" varchar(80) NOT NULL,
        "input" jsonb NOT NULL,
        "createdByUserId" uuid NOT NULL,
        "updatedByUserId" uuid NOT NULL,
        CONSTRAINT "pk_harvest_run_presets" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "ix_harvest_run_presets_supermarket" ON "harvest_run_presets" ("supermarketId")`
    );
    // Two presets of one chain may not differ only in case.
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_harvest_run_presets_name" ON "harvest_run_presets" ("supermarketId", lower("name"))`
    );
    await queryRunner.query(
      `ALTER TABLE "harvest_runs" ADD COLUMN "presetId" uuid`
    );
    await queryRunner.query(
      `CREATE INDEX "ix_harvest_runs_preset" ON "harvest_runs" ("presetId")`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "ix_harvest_runs_preset"`);
    await queryRunner.query(
      `ALTER TABLE "harvest_runs" DROP COLUMN "presetId"`
    );
    await queryRunner.query(`DROP TABLE "harvest_run_presets"`);
  }
}
