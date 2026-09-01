/**
 * The three reads a generation run makes (plan 0050, sections 2 and 3).
 *
 * Raw SQL rather than a query builder, for the reason `zone-summary.sql.ts`
 * gives about its own fragments: the predicates below are written with **every
 * camelCase column quoted by hand**, because TypeORM does not rewrite
 * `alias.property` inside raw SQL the way it does inside `where`, and an
 * unquoted `sl."zoneId"` reaches Postgres as `zoneid` and fails at runtime where
 * no mocked repository could catch it.
 */

/**
 * The single definition of "a list this caller may draw a basket from".
 *
 * It mirrors `ListAccessService.requireWrite` exactly as `READABLE_LIST` mirrors
 * `requireRead`: an APPROVED membership, and then either the derived staff grant
 * (a zone OWNER or ADMIN holds all four permissions on every list in their zone)
 * or a `list_access` row that actually carries `WRITE`.
 *
 * **`WRITE` and not `READ`**, which is where this departs from plan 0050 section
 * 2 as written. That section allowed a reader to generate, arguing that
 * generation is a pure read and that restricting it would break the household
 * where the shopper is not the admin. Plan 0051 section 2 overrides it: a basket
 * settles the lines it drew from, and settling is a write, so taking the line
 * into a basket takes `WRITE`. The argument the original made still holds
 * against `DECIDE`, and `DECIDE` is not what is being asked for here.
 */
export const WRITABLE_LIST = `
  m.status = 'APPROVED'
  AND (
    m.role IN ('OWNER', 'ADMIN')
    OR EXISTS (
      SELECT 1 FROM "list_access" la
      WHERE la."listId" = sl.id
        AND la."membershipId" = m.id
        AND 'WRITE' = ANY(la."permissions")
    )
  )
`;

/**
 * Every list, in every zone, that this caller may draw a basket from. `$1` is the
 * caller.
 *
 * Asked once for the whole run rather than once per source, and filtered in the
 * service afterwards. A person belongs to a handful of zones holding a few dozen
 * lists between them, so one query over their memberships is cheaper than a
 * permission resolution per named source, and it is the same answer for the
 * `ALL` case, which has no named sources to resolve.
 *
 * The zone comes back beside the list because a source may name a zone and mean
 * every list in it, and because the provenance rows record both.
 */
export const WRITABLE_LISTS_SQL = `
  SELECT sl.id AS "listId", sl."zoneId" AS "zoneId"
  FROM "shopping_lists" sl
  JOIN "zone_memberships" m
    ON m."zoneId" = sl."zoneId" AND m."userId" = $1
  WHERE ${WRITABLE_LIST}
  ORDER BY sl."zoneId", sl."updatedAt" DESC, sl.id
`;

/**
 * The lines that qualify for a basket (plan 0050, section 3). `$1` is the list
 * ids the run resolved.
 *
 * Two predicates, and both are worth stating loudly:
 *
 * - **`approvalStatus = 'APPROVED'`.** A `PENDING` line is a request nobody has
 *   agreed to yet and a `REJECTED` one is a decision. Neither belongs in a
 *   basket, and this is the rule that makes zone approval mean something.
 * - **`quantity > 0`.** Plan 0050 asked for `status = 'PENDING'` here, on a
 *   column plan 0047 deleted. Wanting a thing is what that column was standing in
 *   for: quantity is now the only thing that says whether the household wants it,
 *   and a line at zero is one they know about and do not currently need.
 *
 * Ordered by list and then position so a basket composed from one list comes out
 * in the order that list is written in, which is the order the person who wrote
 * it walks the shop in.
 */
export const CANDIDATE_LINES_SQL = `
  SELECT
    ll.id AS "id",
    ll."listId" AS "listId",
    ll.content AS "content",
    ll.quantity AS "quantity",
    ll.version AS "version",
    ll."itemSetHash" AS "itemSetHash"
  FROM "list_lines" ll
  WHERE ll."listId" = ANY($1)
    AND ll."approvalStatus" = 'APPROVED'
    AND ll.quantity > 0
  ORDER BY ll."listId", ll.position ASC, ll.id ASC
`;

/**
 * The product sets of the candidate lines, in attachment order (plan 0048,
 * section 1.1). `$1` is the line ids.
 *
 * One query for every line rather than a relation load per line: a run reads a
 * few hundred lines and the N+1 would be the whole cost of the feature.
 */
export const CANDIDATE_LINE_ITEMS_SQL = `
  SELECT lli."lineId" AS "lineId", lli."itemId" AS "itemId"
  FROM "list_line_items" lli
  WHERE lli."lineId" = ANY($1)
  ORDER BY lli."lineId", lli.position ASC, lli."createdAt" ASC
`;

/**
 * Which of these lines is already carried by an `ACTIVE` basket of this user
 * (plan 0050, section 3). `$1` is the caller, `$2` the candidate line ids.
 *
 * Two live baskets both claiming the same milk is how a household ends up with
 * two milks. The overlap is **reported** rather than silently dropped, so the
 * person can see why a line they distinctly remember writing is missing, which is
 * the difference between answering that question and guessing at it.
 *
 * It runs on the reverse index over `generated_list_line_origins."lineId"`, which
 * exists for this query alone.
 */
export const ACTIVE_OVERLAP_SQL = `
  SELECT DISTINCT o."lineId" AS "lineId", gl.id AS "generatedListId"
  FROM "generated_list_line_origins" o
  JOIN "generated_list_lines" gll ON gll.id = o."generatedListLineId"
  JOIN "generated_lists" gl ON gl.id = gll."generatedListId"
  WHERE gl."ownerUserId" = $1
    AND gl.status = 'ACTIVE'
    AND o."lineId" = ANY($2)
`;

/** One row of {@link WRITABLE_LISTS_SQL}. */
export interface WritableListRow {
  listId: string;
  zoneId: string;
}

/** One row of {@link CANDIDATE_LINES_SQL}. */
export interface CandidateLineRow {
  id: string;
  listId: string;
  content: string;
  quantity: number;
  version: number;
  itemSetHash: string | null;
}

/** One row of {@link ACTIVE_OVERLAP_SQL}. */
export interface ActiveOverlapRow {
  lineId: string;
  generatedListId: string;
}
