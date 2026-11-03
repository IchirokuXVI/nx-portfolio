import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A report key holds a count this migration may subtract when it is a JSON
 * number that is a whole number of zero or more. Anything else is a row the
 * report does not make exact, and it is left alone.
 */
const isCount = (key: string): string =>
  `(jsonb_typeof("report" -> '${key}') = 'number'
     AND ("report" ->> '${key}') ~ '^[0-9]+$')`;

/** The value of a key {@link isCount} accepted, as an integer. */
const countOf = (key: string): string => `("report" ->> '${key}')::integer`;

/** A run whose report states the prices catalog inserted (section 5, point 1). */
const PRICED = isCount('pricesPublished');

/**
 * A Carrefour EAN backfill run after plan 0103, when the runner and the ingest
 * both began to count each EAN (section 5, point 2). A backfill from before
 * that plan has no `productsWritten` and was counted once.
 */
const BACKFILL = `${isCount('eansWritten')} AND ${isCount('productsWritten')}`;

/**
 * The stored counters of old runs, corrected where the report makes the
 * correction exact (plan 0217, section 5).
 *
 * Plan 0217 makes each counter of `harvest_runs` count one kind of thing. Two
 * of the old numbers can be put right from what the same run wrote in its
 * report, and this migration does that and nothing else:
 *
 * - **`updated` held the prices catalog inserted.** `pricesPublished` is the
 *   sum of the same inserts, so it is subtracted. Every run that holds the key
 *   was written after the ingest began to add prices to `updated`.
 * - **A Carrefour backfill counted each EAN two times**, in `processed` and in
 *   `updated`, and counted a page with no EAN as `notFound`. `eansWritten` is
 *   the amount counted twice, and the pages with no EAN are already in the
 *   report as `noEanOnTheirPage`, so `notFound` is set to 0.
 *
 * **Every other row keeps its numbers.** That covers a run that failed before
 * its report was written, a run from before the report held these keys, and
 * the `processed` of Carrefour catalog, DIA catalog and DIA store discovery
 * runs, which counted two units at once. Their report does not say how much of
 * that count came from which unit, so a correction would be a guess, and the
 * back office clamps their progress bar at 100 percent instead. Nothing marks a
 * corrected row.
 *
 * A subtraction never goes below zero. `down` adds back from the same report
 * keys and sets `notFound` back from `noEanOnTheirPage`, which restores every
 * row whose counter held at least the amount its report states.
 */
export class HarvestRunCounters1759600000000 implements MigrationInterface {
  name = 'HarvestRunCounters1759600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "harvest_runs"
          SET "updated" = GREATEST(0, "updated" - ${countOf('pricesPublished')})
        WHERE ${PRICED}`
    );
    await queryRunner.query(
      `UPDATE "harvest_runs"
          SET "updated" = GREATEST(0, "updated" - ${countOf('eansWritten')}),
              "processed" = GREATEST(0, "processed" - ${countOf('eansWritten')}),
              "notFound" = 0
        WHERE ${BACKFILL}`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "harvest_runs"
          SET "updated" = "updated" + ${countOf('eansWritten')},
              "processed" = "processed" + ${countOf('eansWritten')},
              "notFound" = CASE WHEN ${isCount('noEanOnTheirPage')}
                                THEN ${countOf('noEanOnTheirPage')}
                                ELSE 0 END
        WHERE ${BACKFILL}`
    );
    await queryRunner.query(
      `UPDATE "harvest_runs"
          SET "updated" = "updated" + ${countOf('pricesPublished')}
        WHERE ${PRICED}`
    );
  }
}
