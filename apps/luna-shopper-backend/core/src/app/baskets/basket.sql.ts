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

/** One row of {@link WRITABLE_LISTS_SQL}. */
export interface WritableListRow {
  listId: string;
  zoneId: string;
}
