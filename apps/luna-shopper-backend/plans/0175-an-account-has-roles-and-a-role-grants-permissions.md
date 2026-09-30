> **PR:** [#546](https://github.com/IchirokuXVI/nx-portfolio/pull/546)

# 0175: an account has roles, and a role grants permissions

> First of the shop map series as rewritten on 2026-09-29, because mapping a shop is the
> first thing that only some accounts can do. Consumed by `0168` (walks, behind the mapping
> permission), velista `0122` (the Walks button and the walk screens) and admin `0038`
> (granting roles in the back office).
>
> Prerequisite reading: `apps/luna-shopper-backend/auth/src/app/entities/user.entity.ts`,
> `tokens/token.service.ts` (`signAccessToken`), the gateway's `auth/jwt.strategy.ts`
> (`CurrentUser`), `GET /v1/account/me`, the back office users screen
> (`/v1/admin/users`) and `auth_audit` (plan 0077 section 8).

Velista accounts have no roles today. The only admins are the back office's operators, who
live in their own table with their own token, and who never walk into a shop with velista.
The user decided on 2026-09-29 that mapping stays in velista and that a few roles are fine:
an admin, and a premium account for the paid version later.

So a velista account gets roles, and a role is only a name for a set of permissions. Code
checks permissions, never role names. Two later steps then change one table in the
contracts and no guard. Both are backlog today:

- **Mapping by every account** (backend backlog `0017` for what that needs first).
- **Prices that users send from velista**, where an admin's price outranks other users'
  prices (backend backlog `0001` section 2.6). That adds a permission of its own when it is
  built.

## Brief for the agent

### Objective

Store roles on velista accounts, derive permissions from them in one table, carry the
permissions in the access token, enforce them in the gateway with one decorator, serve them
on `GET /v1/account/me`, and let the back office set an account's roles with an audit row.

### Context

- **Accounts**: `users` in the auth database, with `kind` (`REGISTERED` or `GUEST`) and a
  username. A guest is a real temporary account.
- **Tokens**: `signAccessToken` signs `{ sub, kind }` with RS256. The gateway's
  `JwtStrategy.validate` answers `CurrentUser { userId, kind }`. The access token lives
  `accessTokenTtl` (15 minutes), then the client refreshes it.
- **Operators** are `admin_users`, with their own token audience and public key
  (`admin-token-separation.spec.ts`). They are not velista accounts and this plan does not
  touch them.
- **The back office** lists and opens accounts through `/v1/admin/users`.

### Target state

- `users.roles text[] NOT NULL DEFAULT '{}'`, holding values of `AccountRole`.
- In `libs/luna-shopper/contracts`: `AccountRole = 'admin' | 'premium'`,
  `Permission = 'shopMap.record'`, and `PERMISSIONS_OF: Record<AccountRole, Permission[]>`
  with `admin: ['shopMap.record']` and `premium: []`.
- The access token carries `perms: Permission[]`, computed at signing from the account's
  roles. `CurrentUser` gains `permissions`.
- `@RequirePermission('shopMap.record')` on a route answers 403 `PERMISSION_REQUIRED`
  without it, with the permission's name in `details`.
- `GET /v1/account/me` answers `permissions` beside what it answers today.
- The back office's user rows and account read (`/v1/admin/users`) carry `roles`, and the
  list filters by role.
- `PUT /v1/admin/users/:id/roles { roles }` sets the roles, writes an `auth_audit` row with
  the operator as actor, and does not revoke the account's refresh tokens. It has no need
  to: a refresh re-reads the account's row, so the next refresh carries the new
  permissions, and they lag at most one access token lifetime.
- `openapi.json` and `wire-types.ts` are regenerated.

### Scope

Work only in `apps/luna-shopper-backend/auth` (entity, migration, token signing, the admin
roles handler), `apps/luna-shopper-backend/gateway/src/app/auth` (the claim, `CurrentUser`,
the decorator and guard), the account controller's `me`, the admin users controller,
`libs/luna-shopper/contracts`, and the regenerated `openapi.json` and `wire-types.ts`.

Do not touch: `admin_users` and the operator token, velista, the back office screens (admin
`0038`), prices.

### Constraints

- **A guest holds no role.** Setting roles on a guest is refused with `GUEST_HAS_NO_ROLES`,
  and an upgrade from guest keeps an empty set.
- **Permissions are derived, never stored.** The token and `me` compute them from roles
  with `PERMISSIONS_OF`, so changing the table changes every account.
- **One permission.** Nothing for prices is reserved: user price submissions are backlog.
- **`premium` grants nothing yet.** It exists so the paid version has a role to grant.
- Only make changes directly requested.

### Action boundaries

Stop and ask before: letting an account grant roles, giving operators a velista role,
adding a role or a permission not named here, or reading a role name anywhere outside
`PERMISSIONS_OF`.

### Progress evidence

Per section: the files changed and the spec run. At the end: the migration up and down on
an ephemeral Luna slot, a spec over HTTP that sets `admin` on an account from the back
office, refreshes, and passes a route guarded by `shopMap.record` that it failed before,
the refusal for a guest, and the regenerated documents.

## 1. Not in this plan

- Screens: admin `0038` (granting), velista `0122` (showing the Walks button).
- Prices that users submit, and ranking them: backlog `0001` section 2.6.
- Mapping by every account: backlog `0017`.
- Paying for premium.
