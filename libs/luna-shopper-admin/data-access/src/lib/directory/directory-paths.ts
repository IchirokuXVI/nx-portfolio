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
