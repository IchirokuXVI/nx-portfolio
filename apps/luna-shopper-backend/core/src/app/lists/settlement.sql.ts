import {
  NO_LINE_SETTLEMENTS,
  type LineSettlementSummary,
  type SettlementOutcome,
} from '@portfolio/luna-shopper/contracts';
import { READABLE_LIST } from '../zones/zone-summary.sql';

/**
 * One product's settlements, across every list the caller may read **at request
 * time** (plan 0047, section 6.2).
 *
 * Raw rather than a query builder, for the reason `ZONE_READABLE_LIST_IDS_SQL` is
 * raw: {@link READABLE_LIST} is written with every camelCase column quoted by
 * hand, because TypeORM does not rewrite `alias.property` inside a raw select
 * expression, and moving it into a `where` would put it somewhere TypeORM does
 * rewrite, against aliases this query does not declare.
 *
 * The access test is an `EXISTS` per settlement row rather than a list of ids
 * computed first. A person can hold thousands of readable lists across every zone
 * they are in, and the id list would be built in full to answer a page of twenty;
 * the `EXISTS` is a primary key lookup on `shopping_lists` and an index lookup on
 * the membership, evaluated only for the rows the item index already found.
 *
 * The cursor is the boundary row's **own** sort key, read back by id rather than
 * carried in the token. An ISO timestamp in a cursor is milliseconds and a
 * `timestamptz` is microseconds, so a token carrying the value skips or repeats
 * the boundary row; this shape cannot, and it costs one primary key lookup.
 *
 * `$1` is the item, `$2` the caller, `$3` the cursor row's id or null, `$4` the
 * limit.
 */
export const ITEM_SETTLEMENTS_SQL = `
  SELECT s."id",
         s."lineId",
         s."listId",
         s."itemId",
         s."outcome",
         s."quantity",
         s."settledByUserId",
         s."settledAt"
  FROM "line_settlements" s
  WHERE s."itemId" = $1
    AND EXISTS (
      SELECT 1
      FROM "shopping_lists" sl
      JOIN "zone_memberships" m
        ON m."zoneId" = sl."zoneId" AND m."userId" = $2
      WHERE sl.id = s."listId" AND (${READABLE_LIST})
    )
    AND (
      $3::uuid IS NULL
      OR (s."settledAt", s."id") <
         (SELECT b."settledAt", b."id" FROM "line_settlements" b WHERE b."id" = $3::uuid)
    )
  ORDER BY s."settledAt" DESC, s."id" DESC
  LIMIT $4
`;

/**
 * Both of plan 0047 section 5's derived indicators, for a set of lines, in one
 * pass over `ix_settlements_line`.
 *
 * `$1` is the line ids. Every column is quoted by hand because they are all
 * camelCase and this is raw SQL, for the same reason {@link ITEM_SETTLEMENTS_SQL}
 * above is written out rather than built.
 *
 * The most recent outcome is `(ARRAY_AGG(... ORDER BY ...))[1]` rather than a
 * `DISTINCT ON` or a correlated subquery: the group is already being formed for
 * the count, so taking its first element costs the sort it was going to do
 * anyway, where either alternative is a second visit to the same index.
 *
 * A line with no settlements produces **no row at all**, which is what makes
 * {@link NO_LINE_SETTLEMENTS} the default rather than a fallback: never bought,
 * and nothing to report.
 */
export const LINE_SETTLEMENT_SUMMARY_SQL = `
  SELECT s."lineId",
         COUNT(*) FILTER (WHERE s."outcome" = 'BOUGHT') AS "boughtCount",
         (ARRAY_AGG(s."outcome" ORDER BY s."settledAt" DESC, s."id" DESC))[1]
           AS "lastOutcome"
  FROM "line_settlements" s
  WHERE s."lineId" = ANY($1::uuid[])
  GROUP BY s."lineId"
`;

/** One row of {@link LINE_SETTLEMENT_SUMMARY_SQL}. A count comes back as text. */
interface SettlementSummaryRow {
  lineId: string;
  boughtCount: string;
  lastOutcome: SettlementOutcome;
}

/**
 * Run {@link LINE_SETTLEMENT_SUMMARY_SQL} and shape it, defaulting every line
 * that has no history at all.
 *
 * Takes the query function rather than a `DataSource` or an `EntityManager`, so
 * the same code answers from outside a transaction (the list read) and from
 * inside one (the settle, which has to count the row it has just written).
 */
export async function readLineSettlementSummaries(
  query: (sql: string, parameters: unknown[]) => Promise<unknown>,
  lineIds: readonly string[]
): Promise<Map<string, LineSettlementSummary>> {
  const summaries = new Map<string, LineSettlementSummary>(
    lineIds.map((id) => [id, NO_LINE_SETTLEMENTS])
  );
  if (lineIds.length === 0) {
    return summaries;
  }

  const rows = (await query(LINE_SETTLEMENT_SUMMARY_SQL, [
    [...lineIds],
  ])) as SettlementSummaryRow[];

  for (const row of rows) {
    summaries.set(row.lineId, {
      boughtCount: Number(row.boughtCount),
      lastOutcome: row.lastOutcome,
    });
  }
  return summaries;
}
