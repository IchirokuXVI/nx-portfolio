# 0233: a stored row lives as long as the policy says

> The privacy policy will tell people how long each kind of record is kept. Today nothing in
> the backend deletes an audit row, a failed operator login, or a spent or expired grant, ever.
> Plan `0075` section 4 named audit pruning and left it for later. This plan gives each of those
> tables a lifetime, a sweep that enforces it in the service that owns the table, and a
> setting with the owner's numbers as defaults, so the number the policy prints (plan `0231`
> section 2) is the number the code enforces.
>
> Prerequisite reading: `0011` section 3 (the orphan reaper, the shape every sweep here
> copies), `0075` sections 1 and 4 (the trails), `0071` section 7 (the operator lockout), `0023`
> section 4.1 and `0210` (the grants), and `0231` sections 2 and 5.3 (the keys the policy reads).

## Brief for the agent

### Objective

Add one retention sweep each to auth, core and catalog that deletes, in batches, the audit
rows older than six months, the failed operator logins older than 90 days, and the refresh
tokens, password resets, email verifications and OAuth states whose expiry is more than 14
days past, with each period a setting.

### Context

Every statement below was read on `dev` on 2026-10-27.

- Audit trails: `auth_audit` (`auth/src/app/entities/auth-audit.entity.ts`, index
  `ix_auth_audit_at` on `at`), `core_audit` (`core/src/app/entities/core-audit.entity.ts:55`,
  `ix_core_audit_at` at `:57`), `catalog_audit` (`catalog/src/app/entities/catalog-audit.entity.ts:53`,
  `ix_catalog_audit_at` at `:55`). The time column is `at` in all three (`:111` in core and
  catalog). Nothing prunes any of them (`auth/src/app/audit/auth-audit.service.ts:31`).
- `admin_login_failures` (`auth/src/app/entities/admin-login-failure.entity.ts:22`) holds the
  typed username, IP and user agent. Its only index is `(username, createdAt)`
  (`auth/src/app/db/migrations/1772400000000-AdminUsers.ts:55`), which does not serve a scan by
  `createdAt` alone. The lockout reads a 15 minute window (`k8s/helm/velista/values.yaml`,
  `adminLoginLockoutWindow`) and the dashboard reads recent failures
  (`auth/src/app/admin/dashboard.service.ts:186`).
- Grants with an `expiresAt` and no index on it: `refresh_tokens`
  (`auth/src/app/entities/refresh-token.entity.ts:25`), `password_resets`
  (`password-reset.entity.ts:67`), `email_verifications` (`email-verification.entity.ts:24`),
  `oauth_states` (`oauth-state.entity.ts:46`). A refresh token is refused once revoked or
  expired (`auth/src/app/tokens/token.service.ts:290` to `:291`), and a grant once consumed or
  expired (`token-grant.service.ts:147`, `:214`), so a row past its expiry decides nothing.
- `impersonation_sessions` (`impersonation-session.entity.ts:18`) records who opened an account
  as whom and why, with an `expiresAt` (`:53`). Its refresh tokens cascade from it
  (`1772700000000-ImpersonationSessions.ts:55`).
- Every existing sweep is a plain `setInterval` from `onApplicationBootstrap`, `unref`ed,
  non overlapping, cleared on shutdown, with no `@nestjs/schedule`:
  `auth/src/app/reaper/orphan-user-reaper.service.ts:31` to `:79`, its settings at
  `auth/src/app/config/app-config.ts:126` to `:132` and `:320` to `:324`; core has
  `zone-reaper.service.ts:61` and `basket-sweep.service.ts:89`; catalog has
  `effective-price.sweep.ts:29` to `:54`.
- Duration parsing exists as `parseDurationMs` in auth (`auth/src/app/tokens/duration.ts:15`)
  and core (`core/src/app/config/duration.ts:15`). Catalog has none.
- Each service runs more than one replica in a cluster, so a sweep runs on each of them.

### Target state

- In every deployment, no audit row older than `RETENTION_AUDIT` (default `180d`), no
  `admin_login_failures` row older than `RETENTION_ADMIN_LOGIN_FAILURES` (default `90d`), and no
  grant whose `expiresAt` is older than `RETENTION_EXPIRED_GRANTS` (default `14d`) survives
  longer than one sweep interval past that age.
- A sweep never holds a long lock, never deletes more than one batch per statement, and two
  replicas sweeping at once neither block each other nor fail.
- The policy reads the same three keys (plan `0231` section 5.3).

### Scope

- Work in: `auth/src/app` (a new `retention/` folder, config, one migration), `core/src/app`
  (a `retention/` folder, config), `catalog/src/app` (a `retention/` folder, config, and a
  `duration.ts` copied from core's), `k8s/helm/velista` (`values.yaml`, the ConfigMap,
  `_env.tpl`), and this plan file.
- Do NOT touch: the audit services' write paths, the lockout, the dashboard, the grant
  services, harvester, any `values.*.yaml` beyond what section 4 names, `package.json`.

### Constraints

- No new dependency, no `@nestjs/schedule`. Copy the reaper's timer shape.
- A sweep deletes only what this plan names. It never touches a row inside its lifetime.
- Prettier on each changed file, never on a directory, with `--end-of-line auto`.

### Acceptance criteria

- [ ] Each table of section 1 is swept by the service that owns it, proved by an integration
      spec on real Postgres that seeds rows on both sides of the cutoff.
- [ ] Two sweeps started at once on the same database both finish, and together delete each
      row once.
- [ ] Each period refuses a value below its floor at boot (section 3).
- [ ] The chart renders the three keys for auth, core, catalog and the gateway, and
      `provision-release.sh --check --render-only` passes for both environments.

### Action boundaries

- Proceed with in-scope edits, the migration, specs and integration specs on an ephemeral slot.
- Stop and ask before adding a table to a sweep, and before running a sweep against a cluster
  database by hand.

### Progress evidence

Report after each service's integration spec passes. Ground each claim in a command's output.

## 1. What is swept, where, and against which column

| Table | Service | Deleted when | Setting |
|---|---|---|---|
| `auth_audit` | auth | `at < now() - RETENTION_AUDIT` | `RETENTION_AUDIT` |
| `impersonation_sessions` | auth | `expiresAt < now() - RETENTION_AUDIT`, and `endedAt` set or `expiresAt` passed | `RETENTION_AUDIT` |
| `core_audit` | core | `at < now() - RETENTION_AUDIT` | `RETENTION_AUDIT` |
| `catalog_audit` | catalog | `at < now() - RETENTION_AUDIT` | `RETENTION_AUDIT` |
| `admin_login_failures` | auth | `createdAt < now() - RETENTION_ADMIN_LOGIN_FAILURES` | `RETENTION_ADMIN_LOGIN_FAILURES` |
| `refresh_tokens` | auth | `expiresAt < now() - RETENTION_EXPIRED_GRANTS` | `RETENTION_EXPIRED_GRANTS` |
| `password_resets` | auth | `expiresAt < now() - RETENTION_EXPIRED_GRANTS` | `RETENTION_EXPIRED_GRANTS` |
| `email_verifications` | auth | `expiresAt < now() - RETENTION_EXPIRED_GRANTS` | `RETENTION_EXPIRED_GRANTS` |
| `oauth_states` | auth | `expiresAt < now() - RETENTION_EXPIRED_GRANTS` | `RETENTION_EXPIRED_GRANTS` |

Notes on the rows that are not obvious:

- **A revoked or consumed grant waits for its expiry too.** A refresh token revoked on day 1 of
  a 30 day life is deleted on day 44. That is the owner's rule as stated ("14 days after
  expiry"), and it keeps one column and one index per table. A rule on `revokedAt` would delete
  sooner and needs a second index.
- **Support sessions are an audit trail.** An `impersonation_sessions` row is the record that an
  operator opened somebody's account and why. It gets the audit lifetime, counted from its
  expiry, not the grant lifetime, and its refresh tokens go with it by cascade (they expired
  with the session).
- **Core's `processed_events`** holds idempotency keys forever. It is not personal after plan
  `0232` hashes the deletion key, and its lifetime is a question for the idempotency design, so
  it is left out.
- **Not here:** application and assistant logs (k8s plan `0018`), backups (a bucket lifecycle
  rule), and the tables a deletion empties (plan `0232`).

## 2. The sweep

One `RetentionSweepService` per service, in `<svc>/src/app/retention/retention-sweep.service.ts`,
shaped exactly like `OrphanUserReaperService`: `setInterval` at `RETENTION_SWEEP_INTERVAL`
from `onApplicationBootstrap` when `RETENTION_SWEEP_ENABLED`, `unref`, a `running` flag so ticks
never overlap, cleared on shutdown, errors logged and swallowed. The first tick runs one
minute after boot, not at boot, so a crash looping pod does not sweep on every start.

Each table is one entry of a list the service walks in order:

```ts
interface RetentionTarget {
  table: string;      // quoted identifier
  column: string;     // the time column of section 1
  retainMs: number;   // from the setting
  extraWhere?: string; // only impersonation_sessions uses it
}
```

Per target, per tick, repeat until a batch deletes fewer rows than `RETENTION_SWEEP_BATCH` or
`RETENTION_SWEEP_MAX_BATCHES` batches have run:

```sql
DELETE FROM "<table>"
WHERE "id" IN (
  SELECT "id" FROM "<table>"
  WHERE "<column>" < $1
  ORDER BY "<column>"
  LIMIT $2
  FOR UPDATE SKIP LOCKED
)
```

- `$1` is computed once per tick in the service (`new Date(Date.now() - retainMs)`), not
  `now()` in SQL, so every batch of a tick agrees on the cutoff and the spec can fix the clock.
- `FOR UPDATE SKIP LOCKED` is what lets two replicas sweep at once: each takes rows the other
  has not locked, and neither waits. The same clause makes the harvester's schedule claim safe
  (plan `0206`).
- Each `DELETE` is its own short transaction. A batch of 1000 rows of these narrow tables is
  milliseconds; the batch limit is about lock time and WAL, not memory.
- The tick logs one line per target that deleted something: `{ table, deleted }`. A target
  that deleted nothing logs nothing.

`auth_audit`, `core_audit` and `catalog_audit` have `id` as their primary key and an index on
`at`; the grant tables and `admin_login_failures` extend `BaseEntity` with an `id`. The
subquery shape therefore works on all nine.

## 3. Settings

Added to each service's Joi schema and config block, with the same names in all three:

| Key | Default | Floor | Services |
|---|---|---|---|
| `RETENTION_SWEEP_ENABLED` | `true` | | auth, core, catalog |
| `RETENTION_SWEEP_INTERVAL` | `1h` | `1m` | auth, core, catalog |
| `RETENTION_SWEEP_BATCH` | `1000` | `1` | auth, core, catalog |
| `RETENTION_SWEEP_MAX_BATCHES` | `50` | `1` | auth, core, catalog |
| `RETENTION_AUDIT` | `180d` | `7d` | auth, core, catalog, gateway (read only, plan `0231`) |
| `RETENTION_ADMIN_LOGIN_FAILURES` | `90d` | `1d` | auth, gateway (read only) |
| `RETENTION_EXPIRED_GRANTS` | `14d` | `1d` | auth, gateway (read only) |

The floors exist because a typo of `0d` or `180` (read as milliseconds) would delete a whole
trail in one tick. A value under its floor refuses boot with a message that names the key. A
floor of seven days on the audit trail is far under anything the policy would state and far
over any accident.

Six months is written as `180d`. The policy prints the days the gateway reads (plan `0231`
section 2), so there is no rounding between what is said and what is done.

Catalog gains `catalog/src/app/config/duration.ts`, a copy of core's. Three copies of a 20 line
parser is the existing state (auth and core already have one each), and moving them into
`libs/luna-shopper/platform` is a refactor this plan does not need.

## 4. The chart

- `values.yaml` gains `lunaShopperBackend.config.retention: { audit: 180d,
  adminLoginFailures: 90d, expiredGrants: 14d }` with a comment that the privacy policy prints
  these numbers, so a change here is a change to the policy.
- The ConfigMap renders `RETENTION_AUDIT`, `RETENTION_ADMIN_LOGIN_FAILURES`,
  `RETENTION_EXPIRED_GRANTS`. `_env.tpl` gives all three to auth and the gateway, and
  `RETENTION_AUDIT` to core and catalog.
- The sweep's own interval, batch and enable keys are not in the chart. Their defaults are the
  deployment's answer, and a key nobody sets is a key nobody reads.
- Neither environment file changes. If plan `0231` is built first it has already added the
  three keys (its section 5.3); this plan then only adds them to the services that enforce
  them.

## 5. The migration

One auth migration, the next timestamp after the newest entry of
`auth/src/app/db/migrations/index.ts` at build time, registered there:

```sql
CREATE INDEX "ix_refresh_tokens_expires_at" ON "refresh_tokens" ("expiresAt");
CREATE INDEX "ix_password_resets_expires_at" ON "password_resets" ("expiresAt");
CREATE INDEX "ix_email_verifications_expires_at" ON "email_verifications" ("expiresAt");
CREATE INDEX "ix_oauth_states_expires_at" ON "oauth_states" ("expiresAt");
CREATE INDEX "ix_impersonation_sessions_expires_at" ON "impersonation_sessions" ("expiresAt");
CREATE INDEX "ix_admin_login_failures_created" ON "admin_login_failures" ("createdAt");
```

Not `CONCURRENTLY`: migrations run inside a transaction (the probe specs run them with
`transaction: 'each'`, for example `core/src/app/db/basket-shop.migration.integration.spec.ts:120`;
the builder confirms the bundled runner does the same, which I did not verify), and these
tables are small enough that a plain build takes well under a second. The builder states the
row counts of staging and production in the PR (`SELECT count(*)` of each, read through the
release tooling, not by hand on a pod) to show it. Each index is named in the entity too, so
TypeORM's schema and the migration agree.

No core or catalog migration: their audit tables already have an index on `at`.

## 6. The first sweep after deploy

The first tick deletes everything already past its lifetime. The trails date from plan `0075`,
so on 2026-10-27 no audit row is six months old and the audit half deletes nothing for a while.
The grant half deletes every grant that expired more than 14 days ago, which is most of
`refresh_tokens` on a cluster with any history: tens of thousands of rows at most, which the
batch limit spreads over a few ticks. These are rows no request can use, written by the system
rather than by a person, so this is the service's ordinary work and not a release task.

## 7. Tests

- **Unit**, per service: the target list built from settings; a floor refusing boot; the timer
  not overlapping; a batch smaller than the limit ending the loop; the max batches cap.
- **Integration**, per service, `retention-sweep.integration.spec.ts`, in a scratch schema like
  `auth/src/app/tokens/token-grant.integration.spec.ts`: seed rows a minute either side of each
  cutoff in every table of section 1, run one tick, assert by id which remain. Then seed 2,500
  old rows, run two sweeps at once with a batch of 500, and assert both finished and every old
  row is gone with no error.
- **Migration**: the migration runs and reverts on the slot, through both the bundled
  `migrate.js` and `migration:run`, and the entity indexes match.

## 8. Dependencies

- None blocks this plan.
- Plan `0231` reads the three periods for the policy. It can be built before or after this
  plan; whichever comes first adds the chart keys.
- Plan `0232` scrubs a deleted person from the trails at deletion. This plan does not replace
  that, and that plan does not need this one.
- Plan `0075` section 4 said admin authored audit rows would never be pruned. The owner's six
  months reverses that for every actor, and this plan follows the owner.

## 9. Decisions

The owner's: audit trails six months, failed operator logins 90 days, expired tokens, resets,
verifications and OAuth states 14 days after expiry.

Mine, for the owner to change:

1. **Support sessions get the audit lifetime**, counted from their expiry.
2. **A revoked or consumed grant is kept until 14 days after its expiry**, not after its
   revocation, for one rule and one index per table.
3. **Six months is `180d`.**
4. **Floors on each period** that refuse boot below seven days for the trails and one day for
   the rest.
5. **The same six month period for all three trails**, including catalog's, which holds no end
   user data and which the owner might prefer to keep longer for curation history.
6. **`processed_events` is not swept here.**
