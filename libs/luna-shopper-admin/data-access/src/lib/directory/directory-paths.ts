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
 * The two nested collections plan 0077 added, written as their shape.
 *
 * Neither is a URL: `{zoneId}` and `{listId}` are the halves the caller
 * supplies, and the four functions below are how one is actually built. They are
 * constants anyway because the in-memory gateway keys a table by
 * `ResourceSource.path`, so each resource needs a name of its own there, and a
 * name that says what the real routes look like is the one worth having.
 *
 * There is no flat route for either. A membership is read, changed and acted on
 * under its zone, and a line under its list, which is why both resources declare
 * a `memberPath` as well as a `collectionPath`.
 */
export const ADMIN_ZONE_MEMBERS_PATH = '/v1/admin/zones/{zoneId}/members';
export const ADMIN_LIST_LINES_PATH = '/v1/admin/lists/{listId}/lines';

/**
 * The pair a membership is addressed by.
 *
 * `AdminZoneMemberView` does not carry its zone, because the URL that answered
 * it already named one. The gateway puts the value back on the row (see
 * `ResourceSource.pathParams`), and this is the key that reads it.
 */
export const MEMBERSHIP_KEY = ['zoneId', 'membershipId'] as const;

/** The pair a list line is addressed by, for the same reason. */
export const LIST_LINE_KEY = ['listId', 'id'] as const;

/** One zone's membership. */
export function zoneMembersPath(zoneId: string): string {
  return `${ADMIN_ZONES_PATH}/${segment(zoneId)}/members`;
}

/** One membership. */
export function zoneMemberPath(zoneId: string, membershipId: string): string {
  return `${zoneMembersPath(zoneId)}/${segment(membershipId)}`;
}

/** One list's lines. */
export function listLinesPath(listId: string): string {
  return `${ADMIN_LISTS_PATH}/${segment(listId)}/lines`;
}

/** One line. */
export function listLinePath(listId: string, lineId: string): string {
  return `${listLinesPath(listId)}/${segment(lineId)}`;
}

/** One path segment, from a value that arrived as data. */
function segment(value: string): string {
  return encodeURIComponent(value);
}
