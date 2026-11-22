import { WRITABLE_LIST } from '../../baskets/basket.sql';
import {
  GENERATED_BASKET,
  OPEN_GENERATED_BASKET,
} from '../../baskets/open-basket.sql';

/**
 * One definition of what a basket asks, or asked, of the lines of one list
 * (plan 0135, section 4).
 *
 * `$1` is the list. `basketParam` narrows the relation to one basket, for the
 * rows read, and is null for every basket of the list.
 *
 * **Two sources, chosen on the status alone.** A basket that is not `OPEN`
 * answers from `basket_trip_rows`, which its finish wrote. An `OPEN` basket
 * answers from its coverage. The invariant of plan 0135, that rows exist exactly
 * while the basket is not `OPEN`, is what makes the two halves disjoint, and it
 * is why the choice is never made on the claim window: the rows are written by a
 * status change, so only the status says whether they exist.
 *
 * `gl."status" = 'OPEN'` on the second half is not redundant. A finished basket
 * still covers the same lists, and without the predicate every finished trip
 * would answer twice, from its frozen rows and from the list as it stands now.
 *
 * **Both halves ask `GENERATED_BASKET`** (plan 0133, section 6). A trip is
 * something somebody composed, and the permanent basket is not one: it holds
 * every line its owner can write, so counting it would give every list one
 * endless trip. The first half joins `baskets` for that alone, since a
 * trip row carries no kind of its own; the second gets it from
 * {@link OPEN_GENERATED_BASKET} and from the `basket_sources` the permanent
 * basket has none of.
 *
 * ## What an open basket asks (plan 0136, section 7.2)
 *
 * It used to be the sum of the basket's origin rows, which were a copy of what
 * the list asked when the run composed it. A basket holds nothing of its own any
 * more, so the ask is recomputed from the two things that are still written down:
 * **`asked` is `left` plus the units of this basket's buys that met the ask**,
 * where `left` is the line's current `quantity` and those units are the
 * `applied` of this basket's standing purchases of it (plan 0274). A buy above
 * the ask lowers the line by what it held and no more, so the units above it
 * are in `bought` and not in `asked`. It is {@link OPEN_BASKET_ASKED}, the same
 * arithmetic `basket-rules` does for the basket screen, so a trip and the
 * basket it is a trip of cannot show different numbers.
 *
 * A line at zero with nothing bought is in neither half and is not a row of the
 * trip, which is plan 0122 section 3's "a trip left with no line is not
 * returned", unchanged. A line bought down to zero stays, because the purchase
 * is what it is there to show.
 */
export function basketAskedCte(basketParam: string | null): string {
  const frozen = basketParam ? `AND r."basketId" = ${basketParam}::uuid` : '';
  const open = basketParam ? `AND gl.id = ${basketParam}::uuid` : '';
  return `
  "basket_asked" AS (
    SELECT r."basketId" AS "basketId",
           r."lineId" AS "lineId",
           r."asked" AS "asked"
    FROM "basket_trip_rows" r
    JOIN "baskets" gl ON gl.id = r."basketId"
    WHERE r."listId" = $1::uuid AND ${GENERATED_BASKET} ${frozen}
    UNION ALL
    SELECT gl.id AS "basketId",
           ll.id AS "lineId",
           ${OPEN_BASKET_ASKED} AS "asked"
    FROM "shopping_lists" sl
    JOIN "zone_memberships" m ON m."zoneId" = sl."zoneId"
    JOIN "baskets" gl ON gl."ownerUserId" = m."userId"
    JOIN "list_lines" ll ON ll."listId" = sl.id
    ${basketLineBuys('gl.id', 'll.id', 'll."unit"')}
    WHERE sl.id = $1::uuid
      AND ${OPEN_GENERATED_BASKET}
      AND EXISTS (
        SELECT 1 FROM "basket_sources" bs
        WHERE bs."basketId" = gl.id
          AND bs."zoneId" = sl."zoneId"
          AND (bs."listId" IS NULL OR bs."listId" = sl.id)
      )
      AND ${WRITABLE_LIST}
      AND ll."deletedAt" IS NULL
      AND ll."approvalStatus" IN ('APPROVED', 'PENDING')
      AND (ll.quantity > 0 OR b."bought" > 0) ${open}
  )`;
}

/**
 * One basket's standing buys of one line, summed, as a lateral join aliased
 * `b` with two columns (plan 0274, section 3):
 *
 * - **`bought`**, the units bought, which is what a revert takes back and
 *   what the screen calls bought;
 * - **`applied`**, the units of those buys that met what the line asked,
 *   which is the half of the ask a buy took off the line.
 *
 * Within one line, and in the unit given (plan 0246, section 3.5): a buy made
 * before the line changed its unit is not added to what it asks. The three
 * arguments are SQL expressions for the basket, the line and that unit.
 *
 * One fragment for every read that derives an ask (the trips read through
 * {@link basketAskedCte}, the freeze at finish, and the basket read of a
 * finished trip), so none of them can count the ask another way.
 */
export function basketLineBuys(
  basketExpr: string,
  lineExpr: string,
  unitExpr: string
): string {
  return `LEFT JOIN LATERAL (
    SELECT COALESCE(
             SUM(s."quantity") FILTER (WHERE s."outcome" = 'BOUGHT'), 0
           )::int AS "bought",
           COALESCE(
             SUM(s."applied") FILTER (WHERE s."outcome" = 'BOUGHT'), 0
           )::int AS "applied"
    FROM "line_settlements" s
    WHERE s."basketId" = ${basketExpr}
      AND s."lineId" = ${lineExpr}
      AND s."unit" = ${unitExpr}
      AND s."revertedAt" IS NULL
  ) b ON TRUE`;
}

/**
 * What an open basket asks of a line `ll`, beside {@link basketLineBuys} as
 * `b` (plan 0274, section 3): `left` plus the units of this basket's buys that
 * met the ask, computed, never stored. The units above the ask are
 * `bought - applied`, which no read stores either.
 *
 * `rowNumbersOf` in `@portfolio/luna-shopper/basket-rules` is the same rule
 * for the basket screen.
 */
export const OPEN_BASKET_ASKED = `(ll.quantity + b."applied")::int`;
