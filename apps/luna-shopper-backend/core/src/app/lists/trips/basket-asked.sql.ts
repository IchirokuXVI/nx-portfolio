import { GENERATED_BASKET } from '../../baskets/open-basket.sql';

/**
 * One definition of what a basket asks, or asked, of the lines of one list
 * (plan 0135, section 4).
 *
 * `$1` is the list. `basketParam` narrows the relation to one basket, for the
 * rows read, and is null for every basket of the list.
 *
 * **Two sources, chosen on the status alone.** A basket that is not `OPEN`
 * answers from `basket_trip_rows`, which its finish wrote. An `OPEN` basket
 * answers from its origins. The invariant of plan 0135, that rows exist exactly
 * while the basket is not `OPEN`, is what makes the two halves disjoint, and it
 * is why the choice is never made on the claim window: the rows are written by a
 * status change, so only the status says whether they exist.
 *
 * `gl."status" = 'OPEN'` on the second half is not redundant. A finished basket
 * keeps its origins until plan 0136 drops the table, and without the predicate
 * every finished trip would answer twice.
 *
 * **Both halves ask `GENERATED_BASKET`** (plan 0133, section 6). A trip is
 * something somebody composed, and the permanent basket is not one: it holds
 * every line its owner can write, so counting it would give every list one
 * endless trip. The first half joins `generated_lists` for that alone, since a
 * trip row carries no kind of its own.
 *
 * Plan 0136 replaces the second half with the open basket's coverage and leaves
 * the first alone. That is the seam, and it is why this relation lives in a file
 * of its own.
 */
export function basketAskedCte(basketParam: string | null): string {
  const frozen = basketParam ? `AND r."basketId" = ${basketParam}::uuid` : '';
  const open = basketParam
    ? `AND gll."generatedListId" = ${basketParam}::uuid`
    : '';
  return `
  "basket_asked" AS (
    SELECT r."basketId" AS "basketId",
           r."lineId" AS "lineId",
           r."asked" AS "asked"
    FROM "basket_trip_rows" r
    JOIN "generated_lists" gl ON gl.id = r."basketId"
    WHERE r."listId" = $1::uuid AND ${GENERATED_BASKET} ${frozen}
    UNION ALL
    SELECT gll."generatedListId" AS "basketId",
           o."lineId" AS "lineId",
           SUM(o."quantity")::int AS "asked"
    FROM "generated_list_line_origins" o
    JOIN "generated_list_lines" gll ON gll.id = o."generatedListLineId"
    JOIN "generated_lists" gl ON gl.id = gll."generatedListId"
    WHERE o."listId" = $1::uuid
      AND ${GENERATED_BASKET}
      AND gl."status" = 'OPEN' ${open}
    GROUP BY gll."generatedListId", o."lineId"
  )`;
}
