import { brandKey } from '@portfolio/luna-shopper/contracts';
import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The brand key beside the brand a source printed (plan 0115, section 6).
 *
 * Additive: the column, its index, and a backfill. **`brand` itself is not
 * touched**, here or anywhere in plan 0115: what a chain printed is the run's to
 * state and a decision never rewrites it (plan 0086, D8).
 *
 * The index is **partial**, because the only read of the column is the
 * suggestions query and that query is always about the queue. An `ACTIVE` row is
 * already a product and a `REJECTED` one is something the owner said is not
 * tracked, so indexing either would pay for rows no read ever asks for.
 *
 * The backfill runs in TypeScript, in pages of 1,000 by id, for the reason the
 * catalog migration gives at length: `brandKey` strips combining marks after an
 * NFD normalization, no database here has `unaccent`, and a SQL expression would
 * write a different key from the one every write computes afterwards.
 */
export class SourceEntryBrandKey1757200000000 implements MigrationInterface {
  name = 'SourceEntryBrandKey1757200000000';

  /** Rows read and written per pass. A page, not the table. */
  private static readonly PAGE = 1000;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "source_catalog_entries" ADD COLUMN "brandKey" varchar(120)`
    );
    await queryRunner.query(`
      CREATE INDEX "ix_source_catalog_entries_queued_brand_key"
        ON "source_catalog_entries" ("brandKey")
       WHERE "brandKey" IS NOT NULL
         AND status IN ('CANDIDATE', 'UNRESOLVED')
    `);

    await SourceEntryBrandKey1757200000000.backfill(queryRunner);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "ix_source_catalog_entries_queued_brand_key"`
    );
    await queryRunner.query(
      `ALTER TABLE "source_catalog_entries" DROP COLUMN "brandKey"`
    );
  }

  /**
   * Walk the table by id in pages, keying each row's brand in TypeScript.
   *
   * By id rather than by offset, so a page is a keyset and no row is read twice
   * or skipped when the planner changes its mind.
   */
  private static async backfill(queryRunner: QueryRunner): Promise<void> {
    let after = '00000000-0000-0000-0000-000000000000';
    for (;;) {
      const page: { id: string; brand: string | null }[] =
        await queryRunner.query(
          `SELECT "id", "brand" FROM "source_catalog_entries"
            WHERE "id" > $1
            ORDER BY "id" ASC
            LIMIT ${SourceEntryBrandKey1757200000000.PAGE}`,
          [after]
        );
      if (page.length === 0) {
        return;
      }
      after = page[page.length - 1].id;

      const keyed = page
        .map((row) => ({ id: row.id, key: brandKey(row.brand) }))
        .filter((row): row is { id: string; key: string } => row.key !== null);
      if (keyed.length === 0) {
        continue;
      }

      await queryRunner.query(
        `UPDATE "source_catalog_entries" AS e
            SET "brandKey" = keyed."key"
           FROM (
             SELECT * FROM unnest($1::uuid[], $2::varchar[]) AS t("id", "key")
           ) AS keyed
          WHERE e."id" = keyed."id"`,
        [keyed.map((row) => row.id), keyed.map((row) => row.key)]
      );
    }
  }
}
