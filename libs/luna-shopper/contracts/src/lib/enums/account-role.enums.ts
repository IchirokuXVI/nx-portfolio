/**
 * Roles on a velista account, and the permissions they grant (plan 0175).
 *
 * **A role is only a name for a set of permissions.** Code checks permissions,
 * never role names: the gateway's `@RequirePermission` reads a
 * {@link Permission}, the access token carries permissions, and
 * `GET /v1/account/me` answers permissions. The one place a role name is read is
 * {@link PERMISSIONS_OF}, so granting a role more (or less) is a change to that
 * table and to no guard.
 *
 * **Permissions are derived, never stored.** `users.roles` holds roles, and the
 * token and `me` compute permissions from them with {@link permissionsOf}, so a
 * change to the table reaches every account at its next token refresh.
 *
 * These are velista accounts only. The back office's operators live in
 * `admin_users` with their own token and hold no role.
 *
 * Browser reachable: nothing here names `process` or a Node module.
 */

/** Every role an account can hold, in the order a screen lists them. */
export const ACCOUNT_ROLES = ['admin', 'premium'] as const;

/** A role on a velista account. A guest holds none. */
export type AccountRole = (typeof ACCOUNT_ROLES)[number];

/** Every permission a role can grant. */
export const PERMISSIONS = ['shopMap.record'] as const;

/**
 * Something an account may do that not every account may.
 *
 * `shopMap.record` is walking a shop to record its map (backend plan 0168).
 */
export type Permission = (typeof PERMISSIONS)[number];

/**
 * What each role grants, and the only place a role name is read.
 *
 * `premium` grants nothing yet: it exists so the paid version has a role to
 * grant.
 */
export const PERMISSIONS_OF: Readonly<
  Record<AccountRole, readonly Permission[]>
> = Object.freeze({
  admin: Object.freeze(['shopMap.record'] as const),
  premium: Object.freeze([] as const),
});

/** Whether a value is one of {@link ACCOUNT_ROLES}. */
export function isAccountRole(value: unknown): value is AccountRole {
  return (ACCOUNT_ROLES as readonly unknown[]).includes(value);
}

/** Whether a value is one of {@link PERMISSIONS}. */
export function isPermission(value: unknown): value is Permission {
  return (PERMISSIONS as readonly unknown[]).includes(value);
}

/**
 * The permissions a set of roles grants, each once, in {@link PERMISSIONS}
 * order so two accounts with the same grants carry the same array.
 *
 * A value that is not a role is ignored rather than trusted, so a stale row
 * naming a role that was removed grants nothing.
 */
export function permissionsOf(roles: readonly string[]): Permission[] {
  const granted = new Set<Permission>();
  for (const role of roles) {
    if (isAccountRole(role)) {
      for (const permission of PERMISSIONS_OF[role]) {
        granted.add(permission);
      }
    }
  }
  return PERMISSIONS.filter((permission) => granted.has(permission));
}
