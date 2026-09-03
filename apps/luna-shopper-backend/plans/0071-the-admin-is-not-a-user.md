# 0071 The admin is not a user

The back office needs an operator to log in as, and today there is no such thing. What the code
calls a platform admin is an ordinary velista user whose uuid appears in a comma separated
environment variable, and the only other holder of that role is the harvester, which is a machine.
Neither can log in to anything, because neither was ever meant to.

This plan creates the operator identity: **a separate table, a separate signing key, and a separate
route namespace**, none of which the user facing half of auth can reach. It is the first of five
backend plans behind the `luna-shopper-admin` app, and nothing else in that set can start without
it.

Two things it deliberately does **not** do. It does not change how catalog and harvester decide who
is an admin, which is `0072`, and it does not move any existing route, which is `0073`. This plan
ends with an admin able to obtain a token and call exactly one thing: the routes that issued it.

## 1. Why a separate table, and not a flag on `users`

The cheap version is a `role` column, or a third `UserKind`. It was rejected on four counts, the
first of which is the one that decides it.

**Every user facing path in the system operates on `users`.** Registration, the temporary to
registered upgrade, password reset, Google OAuth linking, `account-deletion.service`,
`username-propagation.service`, and `orphan-user-reaper.service`. That last one deletes users, and
an admin account that owns no zone, joins nothing and never appears in a list is precisely the
shape it hunts. A separate table means none of that code can reach admin credentials by
construction, rather than because every future change to it remembered not to.

**`users.username` is deliberately not unique.** Plan `0018`, section 9 states it outright: "two
users may share a name", and `ix_users_username` is a plain index that exists "only so the back
office can search by it". Admin login is by username, which needs uniqueness. Mixing means adding a
partial unique index that argues with an explicit design decision recorded two plans ago. In
`admin_users` uniqueness is simply true.

**Admins would pollute what they are built to inspect.** `stats.service` counts users, and plan
`0074` adds a user listing to the admin app itself. An operator account showing up in both is a
small wrong answer that never stops being wrong.

**And separation is cheaper here than it looks**, because the downstream half is already solved for
a non human actor. `HARVESTER_ACTOR_ID` is a uuid the harvester holds so that "every write it makes
passes the existing platform admin gate ... No new authorization machinery, and no shared secret"
(`catalog-client.service.ts`). The precedent for an actor that is not a row in `users` is already
in the tree. `0072` replaces the mechanism, but the shape is established.

## 2. The table

One table in **auth's** database, alongside `users` but referencing nothing in it.

| Column         | Type              | Notes                                                                    |
| -------------- | ----------------- | ------------------------------------------------------------------------ |
| `id`           | uuid              | From `BaseEntity`. This is the actor id in `0075`'s audit rows.          |
| `username`     | varchar           | **Unique.** The login identifier.                                        |
| `passwordHash` | varchar           | argon2, via the existing `PasswordService`. Never in the clear.          |
| `displayName`  | varchar, null     | For the audit trail to render something human.                           |
| `disabledAt`   | timestamptz, null | Set, and login refuses. The only way to revoke without deleting.         |
| `lastLoginAt`  | timestamptz, null | Written on every successful login. Answers "is this account still used". |

`createdAt` and `updatedAt` come from `BaseEntity`.

There is no email column, no verification, no reset token, and no OAuth identity. An admin who
forgets their password is handled by the command in section 6, on the server, by the person who has
the server. That is the whole recovery story and it is deliberate: every recovery channel is also
an attack channel, and this table has one user.

## 3. The second signing key

Admin tokens are signed with **their own RS256 keypair**, not the auth keypair with a different
`aud`.

The argument is concrete rather than aesthetic. Five services already hold `AUTH_JWT_PUBLIC_KEY`:
gateway, catalog, core, harvester and realtime. If one key signed both kinds of token, every one of
those services would find an admin token structurally valid and would reject it only if it
remembered to check the audience. Realtime, which authenticates sockets, is exactly where
forgetting that check is plausible and expensive. A second key makes the mistake unrepresentable
instead of merely discouraged, which is the same reasoning `signParticipantToken` used when it
chose to reuse the auth key: there, sharing was correct because "the realtime service already
verifies with that public key, so a guest's socket needs no second trust root". Here the opposite
is wanted, so the opposite choice follows.

The keypair carries **a different `kid`**, so a verification failure says which key was expected
rather than only "invalid signature".

| Variable                     | Held by                                      |
| ---------------------------- | -------------------------------------------- |
| `ADMIN_JWT_PRIVATE_KEY_FILE` | auth, and nothing else                       |
| `ADMIN_JWT_PUBLIC_KEY_FILE`  | gateway now; catalog and harvester in `0072` |
| `ADMIN_JWT_KID`              | auth                                         |

Following the existing convention, the key is read from a file so no PEM sits in a `.env`
(`read-key.ts` already does this for the auth keypair and is reused unchanged).

## 4. The token, and what it is not

- `sub` is `admin_users.id`. `aud` is `platform-admin`. There is no `kind` claim, because
  `UserKind` describes velista users and an admin is not one.
- **No refresh token, and no `refresh_tokens` row.** The session is one short lived token that
  renews itself while it is still valid, which is `apps/luna-shopper-admin/plans/0003`. A long
  lived credential is exactly what this design refuses to hold.
- TTL is `ADMIN_ACCESS_TOKEN_TTL`, default `15m`, validated as a duration string by the existing
  `parseDurationMs`. It is configurable so development can raise it, and section 8 is why that
  cannot leak into production.

`AuthTokens` is not reused. Its shape (`userId`, `kind`, `username`, `accessToken`, `refreshToken`)
is wrong in three of five fields for an admin, and widening it would make the user facing contract
carry admin concepts. A new `AdminAuthTokens` in `libs/luna-shopper/contracts` holds `adminId`,
`username`, `displayName`, `accessToken` and `expiresAt`.

## 5. The routes and the guard

Three routes, all under the namespace `0073` formalizes:

| Route                         | Guard           | Notes                                                                                                       |
| ----------------------------- | --------------- | ----------------------------------------------------------------------------------------------------------- |
| `POST /v1/admin/auth/login`   | none            | Throttled and locked out, section 7.                                                                        |
| `POST /v1/admin/auth/refresh` | `AdminJwtGuard` | Presenting a valid token returns a new one.                                                                 |
| `GET  /v1/admin/auth/me`      | `AdminJwtGuard` | Identity, plus the environment name for the app's colour (`apps/luna-shopper-admin/plans/0001`, section 6). |

`AdminJwtGuard` is a new passport strategy verifying against the admin public key and requiring
`aud: platform-admin`. It attaches a `CurrentAdmin { adminId, username }`, distinct from
`CurrentUser`, so no handler can accept either by accident.

**`JwtAuthGuard` must reject admin tokens**, and this is worth stating as a requirement rather than
assuming it falls out of the key split. It does fall out, since the signature will not verify, but
the test that asserts it is what keeps a future key consolidation from silently merging the two
principals.

## 6. Creating an admin is a thing you do on the server

Two commands, in auth, alongside the existing `tools/db` scripts:

- **create**: takes a username, prompts for a password twice without echoing it, writes the row,
  prints the new uuid.
- **list**: prints username, display name, `disabledAt` and `lastLoginAt`. No secrets.

There is no update and no delete command in this plan, and no route for any of the three, ever. The
admin app may **read** the list (that is `0074`'s user management screen showing admins as a
read only section) and may not add, edit or delete. Changing an admin means having the server.

Password rules: minimum length enforced by the command, hashed with the existing `PasswordService`
so argon2 parameters stay in one place.

## 7. Throttling, lockout, and the record of failures

A single account login is a far better brute force target than a user base, because the attacker
knows the username is one of very few.

- **Throttling reuses what exists.** `THROTTLE_LIMITS.login` is already defined and already applied
  by `auth.controller.ts`. The admin login route takes the same treatment, keyed on IP.
- **Lockout** after a threshold of consecutive failures for a given username, for a configurable
  window. Separate from throttling because throttling limits a source and lockout protects an
  account.
- **Every failed attempt is recorded**: username attempted, IP, user agent, timestamp. In its own
  table, written on failure only.

The record has **no UI in this plan**, and that is intentional rather than an omission. Surfacing
failed logins belongs to a dashboard that does not exist yet and is explicitly low priority. But
the rows cannot be written retroactively, so the table is created now and filled from the first
day, for the same reason `0075` creates the audit table before anything reads it. A dashboard added
in six months with six months of history behind it is worth having; one that starts empty is not.

## 8. Development skips the login, and production must not be able to

The admin app signs in automatically in development. The server half of that is the dangerous half:
a switch that mints a token without a password is total compromise of every user's data if it is
ever on in production.

- The switch is `ADMIN_DEV_AUTOLOGIN`, **not** `NODE_ENV`. Deriving it from `NODE_ENV` means one
  mis set variable in a deploy, or one image built with the wrong target, turns it on.
- Auth **refuses to boot** when it is true and the resolved host is not local. Not a warning: a
  crash, because a service that will not start is a failed deploy and a service that logs a warning
  is a compromise nobody read.
- Neither `values.production.yaml` nor `values.staging.yaml` ever sets it, and
  `provision-release.sh --check` asserts it is absent, so the existing preflight catches it before
  a deploy rather than after.
- When on, it issues a token for a named existing admin (`ADMIN_DEV_AUTOLOGIN_USERNAME`) rather than
  inventing one, so the development session has a real actor id and `0075`'s audit rows are
  attributable even locally.

## 9. Secrets and deployment

- `provision-release.sh` generates the admin keypair beside the auth one, into the same per
  environment Secret machinery, so a fresh cluster gets one without a manual step.
- `--check` renders the chart and asserts the new `secretKeyRef`s resolve, which is what the flag
  already does for every other secret.
- `_env.tpl` gains the admin public key for the gateway (and, after `0072`, for catalog and
  harvester); `configmap.yaml.tpl` gains the TTL and lockout settings.
- `luna-slot.sh` and `luna-slot.ps1` generate a development keypair into
  `apps/luna-shopper-backend/secrets/` beside `jwt.pub`, and write the new variables into the per
  slot `.env` files. A generated `.env` that is missing a newly required variable kills one service
  at boot while the gateway stays up and returns 500s, which is a known and unpleasant failure, so
  both scripts are updated in this plan and not later.
- `k8s/e2e/luna-shopper-backend/compose.apps.yml` states its environment separately from
  `luna-slot.sh` and does not inherit from it. It is updated here too.

## 10. Migrations

One migration in auth: `admin_users` with the unique index on `username`, and the failed login
attempt table. No change to `users`, `credentials` or `refresh_tokens`, and nothing to backfill.

Prove it on a throwaway Postgres before the PR: run the built `migrate.js` and the CLI path, since
a secondary entry point needs its own line in `data-source.ts`.

## 11. Exit criteria

- An admin created by the command can `POST /v1/admin/auth/login` and receive a token.
- That token is accepted by `GET /v1/admin/auth/me` and **rejected** by any route guarded with
  `JwtAuthGuard`.
- A velista access token is **rejected** by every route guarded with `AdminJwtGuard`.
- A disabled admin cannot log in.
- Repeated failures throttle, then lock out, and each one writes a row.
- Auth refuses to start with `ADMIN_DEV_AUTOLOGIN=true` and a non local host.
- `provision-release.sh --check` passes against a rendered chart carrying the new secrets.
- `npx nx run luna-shopper-backend-gateway:openapi` regenerated and committed.

## 12. Out of scope

- How catalog and harvester decide an admin is an admin: `0072`.
- Moving existing routes into `/v1/admin/**`: `0073`.
- Any listing of users, zones or lists: `0074`.
- The audit trail: `0075`.
- Any UI: the `luna-shopper-admin` plan set.
