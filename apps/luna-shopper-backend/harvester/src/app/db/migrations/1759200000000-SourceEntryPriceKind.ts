import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The adapters whose walk stamps `OFFICIAL_API`, as `run-source-kind.ts` named
 * them on the day this migration was written. A walk of any other adapter
 * stamps `OFFICIAL_WEB`.
 *
 * Frozen here on purpose. A migration describes the rows that exist when it
 * runs, and those were written under this list. A chain that changes its
 * adapter later must not change what this migration says about old prices.
 */
const API_ADAPTERS = ['mercadona-api', 'lidl-api', 'dia-api'];

/** The kinds a run can stamp. A file import names one of them in its input. */
const RUN_KINDS = ['OFFICIAL_API', 'OFFICIAL_WEB', 'OFFICIAL_LEAFLET'];

/**
 * A price row says which kind of source stated it (plan 0190).
 *
 * A website and a leaflet of one chain can print one product with the same
 * name and format, and they then share one row of `source_catalog_entries`.
 * That row has one `sourceKind`, and before this plan each run wrote its own
 * kind into it. An accept wrote the price under the kind of the row, so a
 * leaflet price could reach catalog as a website price. The kind now lives on
 * the price row, and the unique key holds it, so a website price and a
 * leaflet price for one scope are two rows.
 *
 * ## What this does to the rows that exist
 *
 * **It changes no price and deletes no row.** It adds one nullable column,
 * fills it where the kind can be read, and swaps the unique key.
 *
 * The kind of an existing price is the kind of the run in its `runId`,
 * because a run has one kind for its whole life:
 *
 * - **A `FILE_IMPORT` run**: the `sourceKind` of its input, which the
 *   operator stated at the upload. Only one of the three official kinds is
 *   taken.
 * - **Any other run**: the kind of the adapter of its chain, read from
 *   `supermarket_sources`. That is what the executor handed the sink.
 *
 * **A price whose kind cannot be read stays null.** It is not given the kind
 * of its row, because that kind is the one a later run may have rewritten:
 *
 * - The price names no run. Plan 0086 folded such rows in from the old price
 *   columns, and nothing recorded which run wrote them.
 * - The run is not in `harvest_runs` any more.
 * - The run is a file import whose input names no official kind, or a walk
 *   of a chain that has no source row.
 *
 * A null kind is not sent to catalog by an accept, and the settle of plan
 * 0191 keeps every price at the scope of such a row. The next run that
 * observes the scope writes its own row beside it, under its own kind.
 *
 * The migration prints how many rows it stamped with each kind, and how many
 * it left null for each of the three reasons.
 *
 * ## The key
 *
 * `(entryId, priceScopeId)` becomes `(entryId, priceScopeId, sourceKind)`.
 * Every existing pair is unique under the old key, so it is unique under the
 * new one. No run writes a null, and the key is `NULLS NOT DISTINCT`
 * (Postgres 15 and later, and every database of this service is 16), so a
 * row and a scope hold one price of no kind at most, as they did before.
 *
 * ## Down
 *
 * It restores the old key and drops the column. It **refuses** when two rows
 * share an entry and a scope, which the new key allows: restoring the old key
 * would then need a delete, and a migration does not choose which price of a
 * person's catalog goes.
 */
export class SourceEntryPriceKind1759200000000 implements MigrationInterface {
  name = 'SourceEntryPriceKind1759200000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "source_entry_prices"
         ADD COLUMN IF NOT EXISTS "sourceKind" "price_source_kind"`
    );
    await queryRunner.query(`
      COMMENT ON COLUMN "source_entry_prices"."sourceKind" IS
        'The kind of the run that observed this price (plan 0190). An accept writes the price to catalog under it. Null only for a row from before the plan whose kind could not be read: it is never guessed.'
    `);

    // A file import: the kind the operator stated, when it is an official one.
    await queryRunner.query(
      `
      UPDATE "source_entry_prices" p
         SET "sourceKind" = (r."input" ->> 'sourceKind')::"price_source_kind"
        FROM "harvest_runs" r
       WHERE r."id" = p."runId"
         AND p."sourceKind" IS NULL
         AND r."mode"::text = 'FILE_IMPORT'
         AND r."input" ->> 'sourceKind' = ANY($1::text[])
      `,
      [RUN_KINDS]
    );

    // Any other run: the kind of the adapter of its chain.
    await queryRunner.query(
      `
      UPDATE "source_entry_prices" p
         SET "sourceKind" = CASE
               WHEN s."adapterKey"::text = ANY($1::text[])
                 THEN 'OFFICIAL_API'::"price_source_kind"
               ELSE 'OFFICIAL_WEB'::"price_source_kind"
             END
        FROM "harvest_runs" r
        JOIN "supermarket_sources" s ON s."supermarketId" = r."supermarketId"
       WHERE r."id" = p."runId"
         AND p."sourceKind" IS NULL
         AND r."mode"::text <> 'FILE_IMPORT'
      `,
      [API_ADAPTERS]
    );

    const stamped: { sourceKind: string; rows: number }[] =
      await queryRunner.query(`
        SELECT "sourceKind"::text AS "sourceKind", count(*)::int AS "rows"
          FROM "source_entry_prices"
         WHERE "sourceKind" IS NOT NULL
         GROUP BY "sourceKind"
         ORDER BY "sourceKind"
      `);
    const [left]: { noRun: number; runGone: number; runSilent: number }[] =
      await queryRunner.query(`
        SELECT count(*) FILTER (WHERE p."runId" IS NULL)::int AS "noRun",
               count(*) FILTER (
                 WHERE p."runId" IS NOT NULL AND r."id" IS NULL
               )::int AS "runGone",
               count(*) FILTER (WHERE r."id" IS NOT NULL)::int AS "runSilent"
          FROM "source_entry_prices" p
          LEFT JOIN "harvest_runs" r ON r."id" = p."runId"
         WHERE p."sourceKind" IS NULL
      `);
    // The one place a harvester migration prints: plan 0190 asks for the
    // counts in the log of the Job, which is where `migrate.ts` prints too.
    console.log(
      'SourceEntryPriceKind1759200000000: stamped ' +
        (stamped.length === 0
          ? 'no price row'
          : stamped
              .map((each) => `${each.rows} ${each.sourceKind}`)
              .join(', ')) +
        ` from the run of each price. Left with no kind: ${left.noRun} that ` +
        `name no run, ${left.runGone} whose run is gone, ${left.runSilent} ` +
        'whose run does not say (a file import with no official kind in its ' +
        'input, or a walk of a chain with no source row).'
    );

    await queryRunner.query(
      `ALTER TABLE "source_entry_prices"
         DROP CONSTRAINT IF EXISTS "uq_source_entry_prices_scope"`
    );
    await queryRunner.query(
      `ALTER TABLE "source_entry_prices"
         ADD CONSTRAINT "uq_source_entry_prices_scope_kind"
         UNIQUE NULLS NOT DISTINCT ("entryId", "priceScopeId", "sourceKind")`
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const [shared]: { pairs: number }[] = await queryRunner.query(`
      SELECT count(*)::int AS "pairs"
        FROM (
          SELECT 1
            FROM "source_entry_prices"
           GROUP BY "entryId", "priceScopeId"
          HAVING count(*) > 1
        ) twice
    `);
    if (shared.pairs > 0) {
      throw new Error(
        `SourceEntryPriceKind1759200000000 cannot be undone: ${shared.pairs} ` +
          'row(s) hold two prices of two kinds for one scope, and the old key ' +
          'allows one. Decide which price of each pair stays, delete the ' +
          'other, and run the down again.'
      );
    }
    await queryRunner.query(
      `ALTER TABLE "source_entry_prices"
         DROP CONSTRAINT IF EXISTS "uq_source_entry_prices_scope_kind"`
    );
    await queryRunner.query(
      `ALTER TABLE "source_entry_prices"
         ADD CONSTRAINT "uq_source_entry_prices_scope"
         UNIQUE ("entryId", "priceScopeId")`
    );
    await queryRunner.query(
      `ALTER TABLE "source_entry_prices" DROP COLUMN IF EXISTS "sourceKind"`
    );
  }
}
