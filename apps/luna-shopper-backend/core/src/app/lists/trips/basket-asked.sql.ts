import {
  GENERATED_BASKET,
  OPEN_GENERATED_BASKET,
} from '../../baskets/open-basket.sql';
import { WRITABLE_LIST } from '../../baskets/basket.sql';

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
 * **`asked` is `bought + left`**, where `left` is the line's current `quantity`
 * and `bought` is this basket's standing purchases of it. That is the same
 * arithmetic `basket-rows.ts` does for the basket screen, so a trip and the
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
           (ll.quantity + b."bought")::int AS "asked"
    FROM "shopping_lists" sl
    JOIN "zone_memberships" m ON m."zoneId" = sl."zoneId"
    JOIN "baskets" gl ON gl."ownerUserId" = m."userId"
    JOIN "list_lines" ll ON ll."listId" = sl.id
    LEFT JOIN LATERAL (
      SELECT COALESCE(
               SUM(s."quantity") FILTER (WHERE s."outcome" = 'BOUGHT'), 0
             )::int AS "bought"
      FROM "line_settlements" s
      WHERE s."basketId" = gl.id
        AND s."lineId" = ll.id
        AND s."revertedAt" IS NULL
    ) b ON TRUE
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
