import { WRITABLE_LIST } from './generated-list.sql';

/**
 * The reads sharing makes (plan 0051, sections 5.2 and 6.4).
 *
 * Raw SQL for the reason `generated-list.sql.ts` gives about its own fragments,
 * and every camelCase column is quoted by hand: TypeORM does not rewrite
 * `alias.property` inside raw SQL the way it does inside `where`, so an unquoted
 * `sl."zoneId"` reaches Postgres as `zoneid` and fails at runtime where no mocked
 * repository could catch it.
 *
 * Both queries below reuse {@link WRITABLE_LIST}, which is the **single**
 * definition of "a list this person may write", rather than restating it. That
 * matters more here than it did in plan 0050: section 6.4's security property is
 * that a guest can never cause a write anywhere the owner could not have written
 * themselves, and a second, slightly different copy of the predicate is exactly
 * how that property would quietly stop holding.
 */

/**
 * Which of these lists the given person may write, at request time. `$1` is the
 * person, `$2` the list ids to test.
 *
 * Serves both halves of the plan, which ask the same question about two different
 * people:
 *
 * - **Section 5.2**, asked about a *participant*: they see origins, list names,
 *   settlement history and the allocation sheet only if this answers with every
 *   list the run drew from. The all or nothing shape has a known cliff, one
 *   source list where they hold only `READ` collapses the whole view, and it is
 *   accepted for now because it fails in the safe direction.
 * - **Section 6.4**, asked about the *owner*: before a settlement is written to an
 *   origin, the check is whether the basket's owner still holds `WRITE` on that
 *   origin's list. Not the guest's access, because a guest has none, and not a
 *   stored grant from generation time, because access moves.
 *
 * **At request time, never from the snapshot.** A basket outlives the access it
 * was built with, and the asker's standing today is the only one that can be
 * honestly checked.
 */
export const WRITABLE_AMONG_SQL = `
  SELECT sl.id AS "listId"
  FROM "shopping_lists" sl
  JOIN "zone_memberships" m
    ON m."zoneId" = sl."zoneId" AND m."userId" = $1
  WHERE sl.id = ANY($2)
    AND ${WRITABLE_LIST}
`;

/**
 * Every zone line one basket draws on, with the list and zone it belongs to.
 * `$1` is the basket.
 *
 * The provenance rows are the basket's real sources, as opposed to
 * `sourceSnapshot`, which records the lists the **run** was pointed at. The two
 * differ in an ordinary way: a run may read a list that contributed no qualifying
 * line, and a basket edited afterwards may carry lines whose origins were since
 * deleted. Section 5.2 asks about "every source list of the run", and this is the
 * narrower and more honest reading of it, because a list that contributed nothing
 * discloses nothing by being hidden.
 */
export const BASKET_SOURCE_LISTS_SQL = `
  SELECT DISTINCT o."listId" AS "listId", o."zoneId" AS "zoneId"
  FROM "generated_list_line_origins" o
  JOIN "generated_list_lines" gll ON gll.id = o."generatedListLineId"
  WHERE gll."generatedListId" = $1
`;

/**
 * The next guest number for a basket. `$1` is the basket.
 *
 * `max + 1` under the transaction the join runs in, rather than a sequence,
 * because the number is **per basket** and has to stay small and legible: "Guest
 * 2" is a label a person reads on a screen in a shop, and a global sequence would
 * put "Guest 40817" there.
 *
 * Two guests joining at the same instant is the case this has to survive. The
 * join takes a row lock on the basket first, so the read below cannot be
 * concurrent with another one, which is cheaper than a unique index on
 * (`generatedListId`, `guestNumber`) that would make the loser retry rather than
 * simply wait.
 */
export const NEXT_GUEST_NUMBER_SQL = `
  SELECT COALESCE(MAX(p."guestNumber"), 0) + 1 AS "next"
  FROM "generated_list_participants" p
  WHERE p."generatedListId" = $1
`;

/** One row of {@link WRITABLE_AMONG_SQL}. */
export interface WritableAmongRow {
  listId: string;
}

/** One row of {@link BASKET_SOURCE_LISTS_SQL}. */
export interface BasketSourceListRow {
  listId: string;
  zoneId: string;
}
