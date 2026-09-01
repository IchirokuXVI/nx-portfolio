import {
  NO_LINE_CLAIM,
  type LineClaim,
  type LineClaimRef,
} from '@portfolio/luna-shopper/contracts';

/**
 * The two reads behind "somebody is out buying this" (plan 0052, section 4).
 *
 * Raw SQL rather than a query builder, for the reason `generated-list.sql.ts`
 * gives about its own fragments: every camelCase column is quoted by hand,
 * because TypeORM does not rewrite `alias.property` inside a raw select
 * expression and an unquoted `o."lineId"` would reach Postgres as `lineid` and
 * fail at runtime, where no mocked repository could catch it.
 */

/**
 * Which of these zone lines is in a live basket, and whose it is. `$1` is the
 * line ids, `$2` the statuses that count as live, `$3` the oldest a basket may
 * have been generated and still claim anything.
 *
 * Four predicates, and each is one of plan 0052's rules written down once:
 *
 * - **`gl.status`** against the live set, which is `DRAFT` and `ACTIVE` both. A
 *   run composes a `DRAFT`, so counting only `ACTIVE` would leave the lines a run
 *   just took unclaimed, which is the one moment the indicator exists for.
 * - **`gl."generatedAt" >= $3`**, section 4.1. A basket nobody finished holds its
 *   lines forever, and the honest place to answer that is here rather than in a
 *   repair job over the lines: an old live basket simply stops claiming.
 * - **`gll."settledQuantity" < gll."quantity"`**, section 3.3. A basket line that
 *   has been settled all the way through is done, whether it was bought or the
 *   shop did not have it, so it releases its origins without waiting for the trip
 *   to end.
 * - **the `EXISTS`**, section 6. The owner's standing in the line's zone, now: a
 *   claim by somebody who has left reports itself without a name rather than
 *   naming a person the reader can no longer resolve. `o."zoneId"` is the
 *   provenance row's own copy, which is what it records one for, and it is what
 *   the settle path already reaches for instead of joining back through the list.
 *
 * `DISTINCT ON` resolves section 3.4, where one line is carried by two baskets at
 * once: the most recently generated wins, so the last person to take it is the
 * one named, and the same rule decides the read and the event rather than the two
 * disagreeing about who has the milk.
 */
export const LINE_CLAIMS_SQL = `
  SELECT DISTINCT ON (o."lineId")
         o."lineId" AS "lineId",
         gl."ownerUserId" AS "ownerUserId",
         EXISTS (
           SELECT 1
           FROM "zone_memberships" zm
           WHERE zm."zoneId" = o."zoneId"
             AND zm."userId" = gl."ownerUserId"
             AND zm.status = 'APPROVED'
         ) AS "ownerInZone"
  FROM "generated_list_line_origins" o
  JOIN "generated_list_lines" gll ON gll.id = o."generatedListLineId"
  JOIN "generated_lists" gl ON gl.id = gll."generatedListId"
  WHERE o."lineId" = ANY($1::uuid[])
    AND gl.status::text = ANY($2::text[])
    AND gl."generatedAt" >= $3::timestamptz
    AND gll."settledQuantity" < gll."quantity"
  ORDER BY o."lineId", gl."generatedAt" DESC, gl.id DESC
`;

/**
 * The zone lines one basket is currently claiming, so a transition can say which
 * lines it released. `$1` is the basket.
 *
 * It asks the basket rather than the lines, which is the shape the release
 * already has: a basket is completed or deleted as a whole, and the rooms that
 * have to hear about it are whichever zones its origins name.
 *
 * `settledQuantity < quantity` is here as well, and it is not redundant with the
 * caller's transition: a basket being completed may hold lines that were finished
 * an hour ago and released then, and announcing those a second time would be an
 * event saying nothing changed.
 */
export const BASKET_CLAIMED_LINES_SQL = `
  SELECT DISTINCT o."zoneId" AS "zoneId",
                  o."listId" AS "listId",
                  o."lineId" AS "lineId"
  FROM "generated_list_line_origins" o
  JOIN "generated_list_lines" gll ON gll.id = o."generatedListLineId"
  WHERE gll."generatedListId" = $1::uuid
    AND gll."settledQuantity" < gll."quantity"
`;

/**
 * The zone lines one basket line is claiming. `$1` is the basket line.
 *
 * The narrow twin of {@link BASKET_CLAIMED_LINES_SQL}, for the two transitions
 * that are about one line rather than a whole trip: a line settled all the way
 * through, and a line taken out of the basket. It carries no
 * `settledQuantity` predicate, because the caller is the thing that just changed
 * it and the row it is asking about may already be gone.
 */
export const BASKET_LINE_CLAIMED_LINES_SQL = `
  SELECT DISTINCT o."zoneId" AS "zoneId",
                  o."listId" AS "listId",
                  o."lineId" AS "lineId"
  FROM "generated_list_line_origins" o
  WHERE o."generatedListLineId" = $1::uuid
`;

/** One row of {@link LINE_CLAIMS_SQL}. */
interface LineClaimRow {
  lineId: string;
  ownerUserId: string;
  ownerInZone: boolean;
}

/** One row of {@link BASKET_CLAIMED_LINES_SQL}: a ref plus the room it goes to. */
export interface ZoneLineClaimRef extends LineClaimRef {
  zoneId: string;
}

/**
 * Run {@link LINE_CLAIMS_SQL} and shape it, defaulting every line no live basket
 * carries.
 *
 * Takes the query function rather than a `DataSource` or an `EntityManager`, for
 * the reason `readLineSettlementSummaries` does: the same code answers from
 * outside a transaction (the list read) and from inside one (a settle, which has
 * to see the basket line it has just moved).
 *
 * A line no basket carries produces **no row at all**, which is what makes
 * {@link NO_LINE_CLAIM} the default rather than a fallback.
 */
export async function readLineClaims(
  query: (sql: string, parameters: unknown[]) => Promise<unknown>,
  lineIds: readonly string[],
  liveStatuses: readonly string[],
  generatedSince: Date
): Promise<Map<string, LineClaim>> {
  const claims = new Map<string, LineClaim>(
    lineIds.map((id) => [id, NO_LINE_CLAIM])
  );
  if (lineIds.length === 0) {
    return claims;
  }

  const rows = (await query(LINE_CLAIMS_SQL, [
    [...lineIds],
    [...liveStatuses],
    generatedSince,
  ])) as LineClaimRow[];

  for (const row of rows) {
    claims.set(row.lineId, {
      claimed: true,
      // Claimed without a name, never unclaimed, when the owner has left the
      // zone (section 6). The household still needs to know somebody has it.
      claimedByUserId: row.ownerInZone ? row.ownerUserId : null,
    });
  }
  return claims;
}
