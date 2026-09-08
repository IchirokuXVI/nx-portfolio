/**
 * Where the people half of the back office lives (backend plan 0074).
 *
 * Here rather than beside the descriptors, which is where
 * `SUPERMARKETS_PATH` sits, because these five paths have two readers. The
 * descriptors list rows from them and {@link DirectoryServiceI} runs the named
 * actions against them, and the second lives in this library. One constant read
 * twice cannot disagree with itself; two copies eventually do.
 */

export const ADMIN_USERS_PATH = '/v1/admin/users';
export const ADMIN_ADMINS_PATH = '/v1/admin/admins';
export const ADMIN_ZONES_PATH = '/v1/admin/zones';
export const ADMIN_LISTS_PATH = '/v1/admin/lists';
export const ADMIN_BASKETS_PATH = '/v1/admin/baskets';

/**
 * The two flat collections admin plan 0017 put memberships and lines on.
 *
 * Both are ordinary URLs with an ordinary optional query parameter, `zoneId`
 * and `listId`. They replace the nested collections plan 0077 declared as
 * templates, which could not be read at all until the parent was named: an
 * operator looking for one person's memberships does not know the household
 * yet, which is why they came to the screen.
 *
 * **Only the collection moved.** One membership is still read, changed and
 * acted on under its zone, and one line under its list, which is why both
 * resources still declare a `memberPath`. What makes that work with no parent
 * in the URL is that the rows carry theirs: `zoneId` with `zoneName`, `listId`
 * with `listName`.
 */
export const ADMIN_MEMBERSHIPS_PATH = '/v1/admin/memberships';
export const ADMIN_LIST_LINES_PATH = '/v1/admin/list-lines';

/**
 * The pair a membership is addressed by.
 *
 * There is no flat route to one membership: every route that reaches one names
 * the zone first, so the address is the pair, and `AdminZoneMemberView` carries
 * `zoneId` so a row read across zones still has one.
 */
export const MEMBERSHIP_KEY = ['zoneId', 'membershipId'] as const;

/** The pair a list line is addressed by, for the same reason. */
export const LIST_LINE_KEY = ['listId', 'id'] as const;

/** One membership. */
export function zoneMemberPath(zoneId: string, membershipId: string): string {
  return `${ADMIN_ZONES_PATH}/${segment(zoneId)}/members/${segment(
    membershipId
  )}`;
}

/** One line. */
export function listLinePath(listId: string, lineId: string): string {
  return `${ADMIN_LISTS_PATH}/${segment(listId)}/lines/${segment(lineId)}`;
}

/** One path segment, from a value that arrived as data. */
function segment(value: string): string {
  return encodeURIComponent(value);
}
