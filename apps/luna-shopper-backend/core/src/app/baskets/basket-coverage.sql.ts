import { WRITABLE_LIST } from '../generated-lists/generated-list.sql';

/**
 * The two directions of one rule (plan 0133, section 5).
 *
 * "Which lists does this basket read" and "which open baskets cover this list"
 * are the same predicate read from opposite ends, and they are written here side
 * by side so that a spec can prove it: a basket is in `coveringBaskets(L)`
 * exactly when `L` is in `listsOf(basket)` and the basket is open.
 *
 * Raw SQL with every camelCase column quoted by hand, for the reason
 * `generated-list.sql.ts` gives at length: TypeORM does not rewrite
 * `alias.property` inside raw SQL, and an unquoted `sl."zoneId"` reaches Postgres
 * as `zoneid` and fails at runtime where no mocked repository could catch it.
 */

/**
 * Both queries' three predicates, stated once. `${alias}` is the row the basket
 * is being read from.
 *
 * - The basket is the owner's, and the owner holds `WRITE` on the list now.
 *   {@link WRITABLE_LIST} is imported rather than rewritten, because it is the
 *   single definition of "a list this person can draw a basket from" and
 *   coverage must not grow a second one.
 * - A `LIVE` basket covers every one of those lists, with no rows of its own.
 * - A `GENERATED` basket covers the ones its sources name, where a source with a
 *   null `listId` names the whole zone.
 */
const COVERS = `
    gl."kind" = 'LIVE'
    OR EXISTS (
      SELECT 1 FROM "basket_sources" bs
      WHERE bs."basketId" = gl.id
        AND bs."zoneId" = sl."zoneId"
        AND (bs."listId" IS NULL OR bs."listId" = sl.id)
    )
`;

/**
 * The lists one basket reads, now. `$1` is the basket.
 *
 * Never stored, which is the whole of plan 0130 section 3's "coverage": a
 * basket's sources are a rule evaluated on every read, so a list added to a
 * covered zone appears without a write to the basket, and a list whose owner
 * loses `WRITE` disappears the same way.
 *
 * The order is {@link WRITABLE_LISTS_SQL}'s, so a basket's lists come back in
 * the order a run would have read them.
 */
export const BASKET_COVERAGE_SQL = `
  SELECT sl.id AS "listId", sl."zoneId" AS "zoneId"
  FROM "generated_lists" gl
  JOIN "zone_memberships" m ON m."userId" = gl."ownerUserId"
  JOIN "shopping_lists" sl ON sl."zoneId" = m."zoneId"
  WHERE gl.id = $1::uuid
    AND (${WRITABLE_LIST})
    AND (${COVERS})
  ORDER BY sl."zoneId", sl."updatedAt" DESC, sl.id
`;

/**
 * The open baskets that cover one list, now, each with its owner. `$1` is the
 * list.
 *
 * The owner is answered beside the basket because plan 0139 addresses the
 * owner's `user:` room as well as the basket's room: the home card counts a
 * basket somebody else is shopping, and it is drawn from a socket that is in
 * neither of the basket's own rooms.
 *
 * **It ignores the claim window.** A basket past the window is finished by the
 * sweep within one tick, and until then it still shows the line, so answering
 * that it covers the list is the honest answer rather than a stale one.
 */
export const COVERING_BASKETS_SQL = `
  SELECT gl.id AS "basketId", gl."ownerUserId" AS "ownerUserId"
  FROM "shopping_lists" sl
  JOIN "zone_memberships" m ON m."zoneId" = sl."zoneId"
  JOIN "generated_lists" gl ON gl."ownerUserId" = m."userId"
  WHERE sl.id = $1::uuid
    AND gl."status" = 'OPEN'
    AND (${WRITABLE_LIST})
    AND (${COVERS})
`;

/** One row of {@link BASKET_COVERAGE_SQL}: a list this basket reads. */
export interface CoveredList {
  listId: string;
  zoneId: string;
}

/** One row of {@link COVERING_BASKETS_SQL}: a basket, and who owns it. */
export interface CoveringBasket {
  basketId: string;
  ownerUserId: string;
}
