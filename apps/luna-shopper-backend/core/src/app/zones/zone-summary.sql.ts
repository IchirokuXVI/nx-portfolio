import type { SelectQueryBuilder } from 'typeorm';
import type { ZoneMembership } from '../entities';

/**
 * The zone summary query fragments (plan 0017, section 4.1).
 *
 * Every number here is computed on read rather than denormalized into counter
 * columns (section 2): each has a bounded, indexed source, a page is at most
 * `clampPageSize` rows, and a counter column would make drift a permanent
 * possibility for numbers Postgres produces correctly for free.
 *
 * **How this differs from the plan's SQL.** The plan writes the summary as
 * `LEFT JOIN LATERAL` clauses on the listing query. TypeORM's query builder can
 * only emit a plain `LEFT JOIN (subquery)`, which Postgres rejects when the
 * subquery references an outer alias, so the top level laterals are written here
 * as correlated scalar subqueries in the SELECT list instead. That is the same
 * shape of work: still one round trip, still one index scan per count per zone,
 * still no N+1. The one lateral the plan really needs, the per previewed list
 * line counts, survives verbatim inside {@link ZONE_LISTS_PREVIEW_SQL}, because
 * there it sits in raw SQL this module controls end to end.
 *
 * Aliases are load bearing. `m` is the caller's membership row and `z` is the
 * zone, both already in the query, and the subqueries refer to them directly.
 * TypeORM does NOT rewrite `alias.property` inside a raw `addSelect` the way it
 * does inside `where`/`orderBy`, so **every camelCase column here is quoted by
 * hand**. An unquoted `m.userId` reaches Postgres as `m.userid` and fails at
 * runtime with "column does not exist", which no mocked repository can catch.
 */

/** How many lists a zone's preview carries. Server fixed, never client tunable. */
export const ZONE_LIST_PREVIEW_LIMIT = 3;

/**
 * The single definition of "a list this caller may read" (plan 0017, section
 * 3.2), which mirrors `ListAccessService.requireRead`: an APPROVED membership,
 * and then either manager status (the list's creator, or a zone OWNER/ADMIN, who
 * can always see a list they govern) or an explicit `list_access` row.
 *
 * It is written once and interpolated into both the count and the preview, which
 * is what stops a card reading "3 lists" above a preview showing one. A PENDING
 * applicant fails the first clause, so they see no lists and a count of zero.
 */
const READABLE_LIST = `
  m.status = 'APPROVED'
  AND (
    m.role IN ('OWNER', 'ADMIN')
    OR sl."createdByUserId" = m."userId"
    OR EXISTS (
      SELECT 1 FROM "list_access" la
      WHERE la."listId" = sl.id AND la."membershipId" = m.id
    )
  )
`;

/**
 * Members and pending requests in one index scan over `(zoneId, status)`, two
 * aggregates, one raw column. Returned as JSON rather than two scalar subqueries
 * so the membership index is scanned once, as the plan's lateral does.
 */
const ZONE_MEMBER_COUNTS_SQL = `(
  SELECT json_build_object(
    'memberCount', count(*) FILTER (WHERE m2.status = 'APPROVED'),
    'pendingRequestCount', count(*) FILTER (WHERE m2.status = 'PENDING')
  )
  FROM "zone_memberships" m2
  WHERE m2."zoneId" = z.id
)`;

/**
 * The oldest pending requester's name, or null. Ordered by `createdAt` then `id`
 * so the answer is stable across pages and refreshes, and so approving the first
 * requester makes the answer the second requester with no bookkeeping.
 */
const ZONE_FIRST_PENDING_SQL = `(
  SELECT m3.username
  FROM "zone_memberships" m3
  WHERE m3."zoneId" = z.id AND m3.status = 'PENDING'
  ORDER BY m3."createdAt" ASC, m3.id ASC
  LIMIT 1
)`;

/**
 * The owner's per zone name, or null (plan 0024, section 2.3). Core holds this
 * without asking auth: the owner's membership row carries the same per zone
 * `username` every other member has, written on create and maintained by plan
 * 0018's rename flows.
 *
 * Identified by role rather than by ordering, which makes it simpler than the
 * first pending lookup above. `LIMIT 1` is belt and braces: one APPROVED OWNER
 * per zone is an invariant of create and transfer, not a constraint Postgres
 * enforces, and a scalar subquery must return one row whatever the data does.
 */
const ZONE_OWNER_USERNAME_SQL = `(
  SELECT m4.username
  FROM "zone_memberships" m4
  WHERE m4."zoneId" = z.id
    AND m4.role = 'OWNER'
    AND m4.status = 'APPROVED'
  LIMIT 1
)`;

/** Lists the caller may read, counted. Same predicate as the preview below. */
const ZONE_LIST_COUNT_SQL = `(
  SELECT count(*)::int
  FROM "shopping_lists" sl
  WHERE sl."zoneId" = z.id AND (${READABLE_LIST})
)`;

/**
 * The inline lists preview (plan 0017, section 3.3): at most three readable
 * lists, newest activity first, each with its line totals. `json_agg` over an
 * ordered `LIMIT` subselect is what keeps this one value per zone; a join
 * returning three rows per zone would multiply the zone rows and break paging.
 * `coalesce` turns "nothing readable" into `[]` rather than `null`.
 */
const ZONE_LISTS_PREVIEW_SQL = `(
  SELECT coalesce(json_agg(preview), '[]'::json)
  FROM (
    SELECT
      sl.id AS "id",
      sl.name AS "name",
      lc.line_count AS "lineCount",
      lc.ready_count AS "readyCount"
    FROM "shopping_lists" sl
    LEFT JOIN LATERAL (
      SELECT
        count(*) AS line_count,
        count(*) FILTER (WHERE ll.status = 'READY') AS ready_count
      FROM "list_lines" ll
      WHERE ll."listId" = sl.id
    ) lc ON true
    WHERE sl."zoneId" = z.id AND (${READABLE_LIST})
    ORDER BY sl."updatedAt" DESC, sl.id DESC
    LIMIT ${ZONE_LIST_PREVIEW_LIMIT}
  ) preview
)`;

/** The raw column names the summary adds, kept in one place for the reader. */
export const ZONE_SUMMARY_COLUMNS = {
  memberCounts: 'zoneMemberCounts',
  firstPending: 'zoneFirstPending',
  ownerUsername: 'zoneOwnerUsername',
  listCount: 'zoneListCount',
  listsPreview: 'zoneListsPreview',
} as const;

/**
 * Attaches the summary to a query already selecting the caller's membership as
 * `m` and its zone as `z`. The caller then reads the page with
 * `getRawAndEntities()` and pairs each entity with its raw row.
 */
export function selectZoneSummary(
  qb: SelectQueryBuilder<ZoneMembership>
): SelectQueryBuilder<ZoneMembership> {
  return qb
    .addSelect(ZONE_MEMBER_COUNTS_SQL, ZONE_SUMMARY_COLUMNS.memberCounts)
    .addSelect(ZONE_FIRST_PENDING_SQL, ZONE_SUMMARY_COLUMNS.firstPending)
    .addSelect(ZONE_OWNER_USERNAME_SQL, ZONE_SUMMARY_COLUMNS.ownerUsername)
    .addSelect(ZONE_LIST_COUNT_SQL, ZONE_SUMMARY_COLUMNS.listCount)
    .addSelect(ZONE_LISTS_PREVIEW_SQL, ZONE_SUMMARY_COLUMNS.listsPreview);
}

/**
 * The line totals for one list (plan 0017, section 4.2), the same aggregate the
 * preview uses, attached to a list query aliased `l`. `ListView.counts` and
 * `ZoneListPreview` are therefore produced from one definition.
 */
export const LIST_COUNTS_SQL = `(
  SELECT json_build_object(
    'lineCount', count(*),
    'readyCount', count(*) FILTER (WHERE ll.status = 'READY')
  )
  FROM "list_lines" ll
  WHERE ll."listId" = l.id
)`;

/** The raw column the list line counts arrive in. */
export const LIST_COUNTS_COLUMN = 'listLineCounts';
