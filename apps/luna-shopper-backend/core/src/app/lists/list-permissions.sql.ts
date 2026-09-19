/**
 * What one account holds on each of several lists, in one read (plan 0131).
 *
 * The many list twin of `ListAccessService.permissionsForMembership`, which
 * answers for one list and one membership already in hand. The basket sheet asks
 * about every list on a line at once, and asking per row is how a sheet ends up
 * holding two answers to the same question.
 *
 * `$1` is the account, `$2` the list ids. A list the account has no approved
 * membership for matches nothing and is simply absent from the answer, which is
 * the same thing an empty set means.
 *
 * **It says whether the row is staff rather than what staff hold.** The derived
 * grant is `ALL_LIST_PERMISSIONS`, and writing it out again as a SQL array
 * literal would be a second copy of that list in a place no compiler reads, free
 * to drift the day a fifth permission is added. So the query answers the
 * question, the service spreads the constant, and there is one definition.
 *
 * Every camelCase column is quoted by hand, because Postgres folds an unquoted
 * identifier to lower case and the columns here are TypeORM's own names.
 */
export const LIST_PERMISSIONS_AMONG_SQL = `
SELECT sl.id AS "listId",
       (m.role IN ('OWNER', 'ADMIN')) AS "staff",
       COALESCE(la."permissions"::text[], ARRAY[]::text[]) AS "permissions"
FROM "shopping_lists" sl
JOIN "zone_memberships" m
  ON m."zoneId" = sl."zoneId" AND m."userId" = $1 AND m.status = 'APPROVED'
LEFT JOIN "list_access" la
  ON la."listId" = sl.id AND la."membershipId" = m.id
WHERE sl.id = ANY($2::uuid[])
`;

/** One row of {@link LIST_PERMISSIONS_AMONG_SQL}. */
export interface ListPermissionsAmongRow {
  listId: string;
  /** Whether this membership carries the derived grant of all four. */
  staff: boolean;
  /** The stored set, empty for a member with no `list_access` row. */
  permissions: string[];
}
