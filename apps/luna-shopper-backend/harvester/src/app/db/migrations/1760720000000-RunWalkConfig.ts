import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * What a run walked under, beside its request (owner decisions 130b and 127b).
 *
 * Two nullable columns on `harvest_runs`. `configFingerprint` is a sha256 in
 * hex over the canonical JSON of the source row's `adapterKey` and `config`
 * at the spawn, never the config itself. `adapterKey` is that row's adapter.
 *
 * It adds the columns and deletes and rewrites no row. No backfill: the
 * config a stored run walked under is not known now, and a digest of today's
 * config would claim it was. Every run from before reads null, which draws no
 * estimate from it.
 *
 * `down` drops both columns, which loses only what later spawns wrote.
 */
export class RunWalkConfig1760720000000 implements MigrationInterface {
  name = 'RunWalkConfig1760720000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "harvest_runs"
         ADD COLUMN "configFingerprint" character varying,
         ADD COLUMN "adapterKey" character varying`
    );
    await queryRunner.query(`
      COMMENT ON COLUMN "harvest_runs"."configFingerprint" IS
        'sha256 hex of the canonical JSON of the source row adapterKey and config at the spawn (owner decision 130b). Null for a run with no source row and for runs stored before the column.'
    `);
    await queryRunner.query(`
      COMMENT ON COLUMN "harvest_runs"."adapterKey" IS
        'The adapter of the source row at the spawn (owner decision 127b). Null where configFingerprint is.'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "harvest_runs"
         DROP COLUMN IF EXISTS "adapterKey",
         DROP COLUMN IF EXISTS "configFingerprint"`
    );
  }
}
