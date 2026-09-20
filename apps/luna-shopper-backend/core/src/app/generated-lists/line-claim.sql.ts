import {
  NO_LINE_CLAIM,
  type LineClaim,
  type LineClaimRef,
} from '@portfolio/luna-shopper/contracts';
import { OPEN_GENERATED_BASKET } from '../baskets/open-basket.sql';
import { WRITABLE_LIST } from './generated-list.sql';

/**
 * The two reads behind "somebody is out buying this" (plan 0052, section 4),
 * rewritten onto coverage (plan 0136, section 7.1).
 *
 * A basket holds no lines of its own any more, so neither of these can ask one.
 * Both stand on the same three joins the coverage does — `basket_sources` to the
 * zone's lists, the owner's membership, {@link WRITABLE_LIST} — so the claim and
 * the basket cannot disagree about which lines a trip is carrying.
 *
 * Raw SQL rather than a query builder, for the reason `generated-list.sql.ts`
 * gives about its own fragments: every camelCase column is quoted by hand,
 * because TypeORM does not rewrite `alias.property` inside a raw select
 * expression and an unquoted `ll."listId"` would reach Postgres as `listid` and
 * fail at runtime, where no mocked repository could catch it.
 */

/**
 * Which of these zone lines is in a basket somebody is shopping, and whose it
 * is. `$1` is the line ids, `$2` the oldest a basket may have been generated and
 * still claim anything.
 *
 * The predicates, and each is one rule written down once:
 *
 * - **`OPEN_GENERATED_BASKET`** (plan 0133, section 6). Open, so a trip that is
 *   over claims nothing, and `GENERATED`, so the permanent basket claims nothing
 *   either. The `basket_sources` join says the second of those on its own — a
 *   `LIVE` basket has no source rows — and the fragment is asked anyway, because
 *   a claim over every line its owner can write would tell every household that
 *   somebody is always out buying everything, and that must not depend on a
 *   table happening to be empty.
 * - **`gl."generatedAt" >= $2`**, section 4.1. A basket nobody finished holds its
 *   lines forever, and the honest place to answer that is here rather than in a
 *   repair job over the lines: an old live basket simply stops claiming.
 * - **{@link WRITABLE_LIST}** is imported rather than restated, so the claim and
 *   the coverage cannot disagree about which lists a basket reads.
 * - **The membership join**, and with it the end of plan 0052 section 6's
 *   "claimed without a name". Coverage needs an approved membership, so an owner
 *   who left the zone covers none of its lists and claims none of its lines. A
 *   basket that cannot write a line is not out buying it.
 * - **`quantity > 0`** and **`deletedAt IS NULL`**, which is what replaces the
 *   old `settledQuantity < quantity`: a line bought all the way down to zero is
 *   done, and so is one the household deleted (plan 0132), so both release
 *   without waiting for the trip to end.
 * - **The `NOT EXISTS`**, which is the other half of "done". A line the shop did
 *   not have keeps its quantity, so only the basket's newest standing settlement
 *   on it can say the shopper has finished with it. Plan 0137 adds "and no
 *   standing skip" to the same clause.
 *
 * `DISTINCT ON` resolves section 3.4, where one line is covered by two baskets at
 * once: the most recently generated wins, so the last person to take it is the
 * one named, and the same rule decides the read and the event rather than the two
 * disagreeing about who has the milk.
 */
export const LINE_CLAIMS_SQL = `
  SELECT DISTINCT ON (ll.id)
         ll.id AS "lineId",
         gl."ownerUserId" AS "ownerUserId"
  FROM "list_lines" ll
  JOIN "shopping_lists" sl ON sl.id = ll."listId"
  JOIN "basket_sources" bs
    ON bs."zoneId" = sl."zoneId" AND (bs."listId" IS NULL OR bs."listId" = sl.id)
  JOIN "generated_lists" gl ON gl.id = bs."basketId"
  JOIN "zone_memberships" m
    ON m."zoneId" = sl."zoneId" AND m."userId" = gl."ownerUserId"
  WHERE ll.id = ANY($1::uuid[])
    AND ll."deletedAt" IS NULL
    AND ll.quantity > 0
    AND ll."approvalStatus" IN ('APPROVED', 'PENDING')
    AND ${OPEN_GENERATED_BASKET}
    AND gl."generatedAt" >= $2::timestamptz
    AND ${WRITABLE_LIST}
    AND NOT EXISTS (
      SELECT 1
      FROM "line_settlements" s
      WHERE s."basketId" = gl.id
        AND s."lineId" = ll.id
        AND s."revertedAt" IS NULL
        AND s."outcome" = 'NOT_AVAILABLE'
        AND NOT EXISTS (
          SELECT 1
          FROM "line_settlements" s2
          WHERE s2."basketId" = gl.id
            AND s2."lineId" = ll.id
            AND s2."revertedAt" IS NULL
            AND (s2."settledAt", s2.id) > (s."settledAt", s.id)
        )
    )
  ORDER BY ll.id, gl."generatedAt" DESC, gl.id DESC
`;

/**
 * The zone lines one basket covers and could be claiming. `$1` is the basket.
 *
 * One read where there were two (plan 0136, section 7.1). `BASKET_CLAIMED_LINES_SQL`
 * asked the basket's own lines and `BASKET_LINE_CLAIMED_LINES_SQL` asked one of
 * them; a basket has neither any more, so the narrow twin has nothing left to be
 * narrow about and the only question that survives is this one, asked by create,
 * finish, reopen and delete to say which lines to announce.
 *
 * It asks the basket rather than the lines, which is the shape the release
 * already has: a basket is finished or deleted as a whole, and the rooms that
 * have to hear about it are whichever zones its coverage names.
 *
 * **`quantity > 0` is here and is not redundant with the caller's transition.** A
 * basket being finished covers lines that were bought to zero an hour ago and
 * released then, and announcing those a second time would be an event saying
 * nothing changed. What it deliberately does **not** repeat is the claim's
 * `NOT EXISTS` and its window: this read names candidates, and
 * `announceReleased` asks {@link LINE_CLAIMS_SQL} which of them nothing carries
 * any more.
 *
 * **It answers nothing for a `LIVE` basket**, which has no `basket_sources` rows,
 * for the reason the claim gives: the permanent basket claims nothing, so it has
 * nothing to release.
 */
export const BASKET_CLAIMED_LINES_SQL = `
  SELECT DISTINCT
         sl."zoneId" AS "zoneId",
         sl.id AS "listId",
         ll.id AS "lineId"
  FROM "generated_lists" gl
  JOIN "basket_sources" bs ON bs."basketId" = gl.id
  JOIN "shopping_lists" sl
    ON sl."zoneId" = bs."zoneId" AND (bs."listId" IS NULL OR bs."listId" = sl.id)
  JOIN "zone_memberships" m
    ON m."zoneId" = sl."zoneId" AND m."userId" = gl."ownerUserId"
  JOIN "list_lines" ll ON ll."listId" = sl.id
  WHERE gl.id = $1::uuid
    AND ${WRITABLE_LIST}
    AND ll."deletedAt" IS NULL
    AND ll.quantity > 0
    AND ll."approvalStatus" IN ('APPROVED', 'PENDING')
`;

/** One row of {@link LINE_CLAIMS_SQL}. */
interface LineClaimRow {
  lineId: string;
  ownerUserId: string;
}

/** One row of {@link BASKET_CLAIMED_LINES_SQL}: a ref plus the room it goes to. */
export interface ZoneLineClaimRef extends LineClaimRef {
  zoneId: string;
}

/**
 * Run {@link LINE_CLAIMS_SQL} and shape it, defaulting every line no open trip
 * carries.
 *
 * Takes the query function rather than a `DataSource` or an `EntityManager`, for
 * the reason `readLineSettlementSummaries` does: the same code answers from
 * outside a transaction (the list read) and from inside one (a settle, which has
 * to see the settlement it has just written).
 *
 * A line no basket covers produces **no row at all**, which is what makes
 * {@link NO_LINE_CLAIM} the default rather than a fallback.
 *
 * **The owner is always named** (plan 0136, section 7.1). Coverage needs an
 * approved membership, so a row here is already proof that the owner is in the
 * line's zone and there is no "claimed without a name" case left to answer.
 */
export async function readLineClaims(
  query: (sql: string, parameters: unknown[]) => Promise<unknown>,
  lineIds: readonly string[],
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
    generatedSince,
  ])) as LineClaimRow[];

  for (const row of rows) {
    claims.set(row.lineId, {
      claimed: true,
      claimedByUserId: row.ownerUserId,
    });
  }
  return claims;
}
