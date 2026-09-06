import type { LineApprovalStatus } from '@portfolio/luna-shopper/contracts';

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
 * The same lines {@link CANDIDATE_LINES_SQL} reads, with its two predicates
 * lifted out into columns (plan 0057, section 3.2). `$1` is the list ids.
 *
 * The origins sheet **shows** what the run silently dropped, which is the one
 * place this codebase deliberately serves something the caller cannot act on. A
 * line the run would not have taken is a fact worth knowing while standing in a
 * dairy aisle: "the parents' house also wants milk and it has not been approved
 * yet" is actionable in a way that its absence is not. So the two predicates
 * become `approvalStatus` and the quantity, and the service turns them into
 * `NOT_APPROVED` and `SETTLED` reasons beside the row.
 *
 * A separate constant rather than a parameterised one, because the two reads
 * want opposite things and a flag that flips a `WHERE` clause reads as an
 * accident at every call site. The **projection** is deliberately identical to
 * {@link CANDIDATE_LINES_SQL}'s plus the one column, so the same
 * {@link CandidateLineRow} shape describes both and `mergeKey` sees exactly what
 * a run would have seen.
 */
export const SHEET_CANDIDATE_LINES_SQL = `
  SELECT
    ll.id AS "id",
    ll."listId" AS "listId",
    ll.content AS "content",
    ll.quantity AS "quantity",
    ll.version AS "version",
    ll."itemSetHash" AS "itemSetHash",
    ll."approvalStatus" AS "approvalStatus"
  FROM "list_lines" ll
  WHERE ll."listId" = ANY($1)
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
 * Which of these lines is already carried by a **live** basket of this user
 * (plan 0050, section 3). `$1` is the caller, `$2` the candidate line ids, `$3`
 * the statuses that count as live, and `$4` a basket to ignore, or null.
 *
 * Two live baskets both claiming the same milk is how a household ends up with
 * two milks. The overlap is **reported** rather than silently dropped, so the
 * person can see why a line they distinctly remember writing is missing, which is
 * the difference between answering that question and guessing at it.
 *
 * ## It tested `ACTIVE` and therefore never fired
 *
 * A run composes a `DRAFT` and nothing ever writes `ACTIVE`, so the check plan
 * 0050 section 3 describes has never refused anything. Plan 0092 section 3.2
 * fixed it against `LIVE_GENERATED_LIST_STATUSES`, which is the set every other
 * "is somebody still shopping this" question in this folder already asks, and
 * that is why the constant is a parameter rather than a literal here: the claim
 * query beside it passes the same one.
 *
 * `$4` is the caller's own basket, excluded because a line may legitimately be
 * carried twice by **one** basket: plan 0094 puts two siblings on one zone line
 * on purpose. The run passes null, having no basket yet.
 *
 * It runs on the reverse index over `generated_list_line_origins."lineId"`, which
 * exists for this query alone.
 */
export const LIVE_OVERLAP_SQL = `
  SELECT DISTINCT o."lineId" AS "lineId", gl.id AS "generatedListId"
  FROM "generated_list_line_origins" o
  JOIN "generated_list_lines" gll ON gll.id = o."generatedListLineId"
  JOIN "generated_lists" gl ON gl.id = gll."generatedListId"
  WHERE gl."ownerUserId" = $1
    AND o."lineId" = ANY($2)
    AND gl.status::text = ANY($3::text[])
    AND ($4::uuid IS NULL OR gl.id <> $4::uuid)
`;

/**
 * The four numbers a history row shows, for a whole page of baskets (plan 0053,
 * section 2). `$1` is the basket ids.
 *
 * `lineCount` and `settledLineCount` are exactly what the query builder this
 * replaced computed, down to the `>=` that defines finished; the two outcome
 * counts are what plan 0053 adds, and `settledLineCount` is deliberately still
 * their sum rather than being redefined as one of them. `NOT_AVAILABLE` closes a
 * line's outstanding amount exactly as a purchase does, so it has always meant
 * "nothing left to do on this line" and it still does.
 *
 * Raw SQL rather than the query builder it grew out of, because the outcome is
 * not on the line: it is the newest settlement's, and TypeORM does not express a
 * `LEFT JOIN LATERAL` and does not rewrite camelCase columns inside a raw
 * `addSelect` expression either, so half of this was going to be hand quoted
 * whichever way it was written.
 *
 * The lateral is `LIMIT 1` per line over `generated_list_lines`' settlements,
 * which is the same "what did the last act on this line say" that
 * `GeneratedListService.lastOutcomes` answers for a basket being drawn. A line
 * with no settlement produces a null outcome and is counted by neither filter,
 * which is right: a finished line always has one, and an unfinished line is
 * outside both filters anyway.
 *
 * Ordering by `createdAt` and then `id` matches `lastOutcomes` exactly. A settle
 * writes one row per origin it touched and all of them carry the same outcome,
 * so which of a single act's rows comes last cannot change the answer.
 */
export const GENERATED_LIST_COUNTS_SQL = `
  SELECT l."generatedListId" AS "generatedListId",
         count(*)::int AS "lineCount",
         count(*) FILTER (
           WHERE l."settledQuantity" >= l.quantity
         )::int AS "settledLineCount",
         count(*) FILTER (
           WHERE l."settledQuantity" >= l.quantity AND s."outcome" = 'BOUGHT'
         )::int AS "boughtLineCount",
         count(*) FILTER (
           WHERE l."settledQuantity" >= l.quantity
             AND s."outcome" = 'NOT_AVAILABLE'
         )::int AS "notAvailableLineCount"
  FROM "generated_list_lines" l
  LEFT JOIN LATERAL (
    SELECT ls."outcome"
    FROM "line_settlements" ls
    WHERE ls."generatedListLineId" = l.id
    ORDER BY ls."createdAt" DESC, ls.id DESC
    LIMIT 1
  ) s ON TRUE
  WHERE l."generatedListId" = ANY($1::uuid[])
  GROUP BY l."generatedListId"
`;

/** One row of {@link GENERATED_LIST_COUNTS_SQL}. */
export interface GeneratedListCountsRow {
  generatedListId: string;
  lineCount: number;
  settledLineCount: number;
  boughtLineCount: number;
  notAvailableLineCount: number;
}

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

/**
 * One row of {@link SHEET_CANDIDATE_LINES_SQL}: a candidate line plus the
 * approval the run would have filtered on.
 */
export interface SheetCandidateLineRow extends CandidateLineRow {
  approvalStatus: LineApprovalStatus;
}

/** One row of {@link LIVE_OVERLAP_SQL}. */
export interface LiveOverlapRow {
  lineId: string;
  generatedListId: string;
}
