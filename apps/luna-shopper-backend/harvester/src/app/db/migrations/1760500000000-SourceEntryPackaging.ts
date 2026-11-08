import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A source row holds the container its chain prints (plan 0248, section 2).
 *
 * One nullable column in the source's group, beside `sizeFormat`: a full read
 * that states it rewrites it, verbatim, and a decision never does. Mercadona
 * prints it (`Brik`, `Botella`, `Pack-4`). No other adapter reads one, and
 * their rows stay null.
 *
 * No backfill. The adapter read the text and dropped it, so no row holds it
 * anywhere. Every Mercadona row gets it on its next full read.
 *
 * `down` drops the column, which loses only what a run writes again.
 */
export class SourceEntryPackaging1760500000000 implements MigrationInterface {
  name = 'SourceEntryPackaging1760500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "source_catalog_entries" ADD "packaging" varchar(40)`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "source_catalog_entries" DROP COLUMN "packaging"`
    );
  }
}
