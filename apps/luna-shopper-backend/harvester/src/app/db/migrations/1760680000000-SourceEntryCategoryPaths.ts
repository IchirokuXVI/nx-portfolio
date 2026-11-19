import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A source row holds every category path its chain files it under (plan
 * 0268, section 2).
 *
 * One `jsonb` column beside `categoryPath`, default `[]`. `categoryPath` keeps
 * its meaning and its value (D1). The drain of a run writes the new column
 * after its last chunk, and nothing else does.
 *
 * It adds the column and deletes and rewrites no row. No backfill (D3): every
 * row reads `[]` until the next walk of its chain states its paths.
 *
 * `down` drops the column, which loses only what a walk writes again.
 */
export class SourceEntryCategoryPaths1760680000000 implements MigrationInterface {
  name = 'SourceEntryCategoryPaths1760680000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "source_catalog_entries"
         ADD "categoryPaths" jsonb NOT NULL DEFAULT '[]'::jsonb`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "source_catalog_entries" DROP COLUMN "categoryPaths"`
    );
  }
}
