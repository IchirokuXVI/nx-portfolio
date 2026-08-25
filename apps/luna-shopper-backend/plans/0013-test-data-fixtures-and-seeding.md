# 0013 Test data, fixtures, and seeding

Defines how Luna Shopper produces and manages test data across every layer: in memory
fixtures for Jest unit tests, a database seeder for Playwright e2e and manual testing, and
the swap plus restore workflow for local, staging, and production. It complements plan 0010
(which decides the test *layers and tools*); this plan decides the *data* those layers run on.

## 0. The core idea: two independent mechanisms

Most seeding pain comes from making one tool do two jobs. Luna Shopper keeps them separate:

1. **A canonical test dataset (a seed concern).** One coherent, deterministic graph of data,
   authored once, consumed two ways: as plain objects for unit tests, and inserted into the
   two databases for e2e and manual testing.
2. **Restoring whatever was in the database before (a backup concern).** Putting a database
   back to an arbitrary prior state after a test run. A seeder cannot do this; it only creates
   the data it knows about. This is a `pg_dump` / `pg_restore` snapshot job and is built as a
   completely separate layer.

Sharing nothing but the fixture definitions, these two layers never contaminate each other.

## 1. Layer one: the fixtures library

New test only library `libs/luna-shopper/test-fixtures` (nx project name
`luna-shopper/test-fixtures`, path alias `@portfolio/luna-shopper/test-fixtures`, **no
package.json**, matching the `contracts` and `platform` convention). It is the single source of
truth for what the test data *is*, independent of where it lands.

It exports:

- **Factories / builders.** `makeUser(overrides?)`, `makeZone(overrides?)`, `makeList(...)`,
  `makeLine(...)`, `makeComment(...)`, one per aggregate. Each returns a well formed,
  entity shaped object with sensible defaults that any field can override. Unit tests use these
  to build one off objects with no database involved.
- **A named canonical scenario, the "demo world".** One hand authored, internally consistent
  graph built from the factories with **fixed UUID constants** (exported as named constants,
  for example `ALICE_ID`, `ZONE_WEEKLY_ID`, `LIST_GROCERIES_ID`). A representative shape:
  - Users: Alice (zone owner, registered), Bob (approved member), Carol (pending membership),
    plus a temp user to exercise the upgrade and merge paths.
  - One zone owned by Alice with Bob approved and Carol pending.
  - Two shopping lists under the zone, each with several lines spanning both line state
    machines (`approvalStatus` and `status`), a reordering case, and a couple of comments.
  - Just enough to drive the primary flows in plan 0010 section 1 end to end.

**Why fixed IDs matter.** The IDs are compile time constants, so a Playwright test knows exactly
which zone and list to open, and a unit test asserts against the same IDs. The seeder and the
unit fixtures then produce the *same* world, and the seed spanning two databases stays
referentially consistent because both halves reference the identical `userId` and `zoneId`
constants (Luna Shopper joins auth and core by application level id, not by a cross database
foreign key, so the shared constants are what keep the graph valid).

**Cross database split.** The scenario is authored as one object but is naturally partitioned:
the auth half (users, credentials, identities) and the core half (zones, memberships, lists,
lines, comments). The library exposes both partitions so each service's seeder consumes only
its own slice while sharing the same ids.

## 2. Layer two: the database seeder

A runnable seeder per database owning service, plus an orchestrator, exposed as Nx targets.

- `nx run luna-shopper-backend-auth:seed` inserts the auth half (users and credentials).
- `nx run luna-shopper-backend-core:seed` inserts the core half (zones, memberships, lists, lines,
  comments), referencing the auth user ids.
- `nx run luna-shopper-backend:seed` runs auth first, then core (order matters: core references auth
  user ids). This is the everyday entry point.

Design rules:

- **Insert through the real TypeORM repositories and entities**, reusing each service's
  `data-source.ts` connection wiring (the same pattern the migration CLI already uses). This
  guarantees argon2 password hashes, hashed rotating refresh tokens, version columns, and
  timestamps are all genuinely valid rather than hand written SQL that drifts from the entities.
- **Idempotent by fixed id.** Re running the seeder against an already seeded database is safe:
  it deletes the known seed ids and reinserts, or upserts. It only ever touches rows it owns
  (the canonical scenario ids), never arbitrary data.
- **The seeder does not replay NATS domain events.** Seeded rows are historical, so no realtime
  fan out fires for them. If a scenario ever needs seeded data to also emit events, that is a
  deliberate, separate step, not the default.
- **The seeder is the population tool, not the restore tool.** It builds the demo world on an
  empty or existing database and is what CI's throwaway stack and first time local setup use.
  Restoring a prior state is layer three's job (`db:restore`), not a truncate and reseed.

## 3. Layer three: swap and restore per environment

The honest answer differs by environment, because "restore what was there" only works when
nothing else is writing concurrently.

### 3.1 Local development: two selectable models

Both models are supported; a developer picks per run.

- **Default: the dev database *is* the demo world.** The everyday local databases are the
  seeded canonical scenario. A developer hacks on them freely. There is one database per
  service and no context switching. This matches the intent that in development the test data
  is simply the data that is always used.
- **Opt in: separate test databases.** An `apps/luna-shopper-backend/<svc>/.env.test` overrides
  `AUTH_DB_URL` / `CORE_DB_URL` to point at dedicated databases (for example `luna_auth_test`
  and `luna_core_test`), so a test run never touches the developer's own dev data. Selecting
  this model is just loading `.env.test` for the run (an env var toggle, no code branching).
  The compose stack in `k8s/e2e/luna-shopper-backend/compose.yml` gains the extra databases, or
  they are created on the existing Postgres instances.

Switching between "test data" and "real data" locally is therefore a **connection string swap**,
the safest possible mechanism: real data in one database, test data in another, chosen by which
env file is loaded.

### 3.2 Restore and reset: `pg_dump` snapshots (the chosen mechanism)

Restoring is done entirely with Postgres native dump and restore, exposed as guarded Nx targets:

- `nx run luna-shopper-backend:db:snapshot` runs `pg_dump` of both databases to a timestamped, git
  ignored directory (for example `apps/luna-shopper-backend/.snapshots/<label>-<timestamp>/`), with an
  optional `--label` so a snapshot can be named (`initial`, `before-e2e`, and so on).
- `nx run luna-shopper-backend:db:restore` runs `pg_restore` of a named or latest snapshot back into
  both databases.

This one mechanism covers every restore need:

- **"Run tests, then restore the data that was there before."** Snapshot, seed or test, then
  restore. The round trip is exact because it is a real database dump.
- **"Reset development to how it was initially, even if I altered too much."** The initial state
  is a snapshot captured once, right after the first seed, labelled `initial`. Resetting is
  `db:restore initial`. There is no separate truncate and reseed reset path; restoring the
  `initial` snapshot *is* the reset.

The targets are guarded so they refuse to run against a production connection string (see 3.5).

### 3.3 Staging: snapshot, test, restore

Staging has prior data but no concurrent real users during a controlled test run, so the
snapshot workflow is safe and is the intended path: `db:snapshot` the staging databases, seed
the demo world, run the Playwright suite, then `db:restore`. The same targets as local, pointed
at the staging connection strings via the staging env.

### 3.4 CI end to end: throwaway stack, no restore

CI needs no restore at all. The Playwright job brings up a disposable stack
(`docker compose -f k8s/e2e/luna-shopper-backend/compose.yml up`, or testcontainers), runs the
migrations, seeds the demo world, runs the suite, then tears the stack down with `down -v`. The
entire database is disposable, so the restore problem does not exist here. This is the gold
standard automated flow and is what `nx affected` drives in CI, consistent with plan 0010
section 3.

### 3.5 Production: self cleaning API driven end to end only

Production is never seeded and its database is never snapshot and restored for testing. On a live
database with concurrent users, a snapshot then restore round trip is not a restore, it is data
loss for everything written between the two points. Instead, production smoke tests are **self
cleaning and go only through the public gateway API**:

- The test creates its own namespaced throwaway data (a temp user, a throwaway zone) via the
  gateway.
- It exercises the flow.
- It deletes everything it created through the app's own account deletion and zone deletion
  flows (the mechanisms plan 0011 introduces), touching the database only through the public
  API.

No bulk seed, no database level swap, no restore. The `db:snapshot` / `db:restore` and `seed`
targets refuse to run when the resolved connection string is a production host, so this rule is
enforced, not merely documented.

## 4. Integration with the test suites

- **Unit tests (Jest).** Import the factories from `@portfolio/luna-shopper/test-fixtures`
  directly. No database, broker and repositories mocked, per plan 0010 section 1. The fixed id
  constants are also imported where a test asserts against known ids.
- **Integration tests.** Seed the demo world into the throwaway stack's databases, then exercise
  the real TypeORM repositories and NATS handlers, per plan 0010 section 1.
- **Playwright e2e.** A Playwright global setup performs the round trip: optionally
  `db:snapshot`, then `seed`, run the specs (which navigate using the fixed id constants
  imported from the fixtures library so the tests and the seed agree), then `db:restore` in
  global teardown. Against the CI throwaway stack the snapshot and restore steps are skipped in
  favour of tearing the stack down.

## 5. New Nx targets (summary)

| Target | Purpose |
| --- | --- |
| `luna-shopper-backend-auth:seed` | Insert the auth half of the demo world |
| `luna-shopper-backend-core:seed` | Insert the core half of the demo world |
| `luna-shopper-backend:seed` | Orchestrate auth then core |
| `luna-shopper-backend:db:snapshot` | `pg_dump` both databases to a labelled, git ignored dir |
| `luna-shopper-backend:db:restore` | `pg_restore` a named or latest snapshot into both databases |

All of them refuse to run against a production connection string.

## 6. Files and projects to create or change

- `libs/luna-shopper/test-fixtures` (new lib): factories, the canonical scenario, and the fixed
  id constants, partitioned into an auth half and a core half.
- Per service seeder entry points under `apps/luna-shopper-backend/<svc>/src/app/db/seed/`, reusing the
  existing `data-source.ts` wiring, plus the `seed` target in each `project.json`.
- An orchestrator target and the `db:snapshot` / `db:restore` scripts (a cross platform Node or
  ts-node wrapper, mirroring the cross platform migration `cli.js` approach rather than a shell
  script) under `apps/luna-shopper-backend/tools/` or similar, wired as workspace level Nx targets.
- `apps/luna-shopper-backend/<svc>/.env.test.example` documenting the separate test database URLs, and
  a `.snapshots/` entry plus the `.env.test` files added to `.gitignore`.
- Optional additions to `k8s/e2e/luna-shopper-backend/compose.yml` for the separate local test
  databases if the opt in model is used.
- Playwright global setup and teardown wiring the snapshot, seed, and restore round trip.

## 7. Exit criteria

- `libs/luna-shopper/test-fixtures` exists, is consumed by unit tests in at least auth and core,
  and exports the canonical scenario with fixed id constants.
- `nx run luna-shopper-backend:seed` populates both databases with the demo world, idempotently, through
  the real repositories.
- Local development can swap between real data and test data by env file selection, and a
  developer can reset to the `initial` snapshot with `db:restore initial`.
- `db:snapshot` and `db:restore` perform an exact round trip on local and staging and refuse to
  run against production.
- Playwright e2e runs against the seeded demo world using the shared fixed ids, and CI runs it
  against the throwaway stack with no restore step.
- Production has a self cleaning, API only smoke path and no seeding or database restore.

## 8. Future, not built now

- Multiple named scenarios beyond the single demo world (for example an "empty tenant" or a
  "large zone" scenario for pagination and performance testing).
- Seeded data that also emits realtime events, for testing the realtime fan out end to end from
  a known starting state.
- A faster local reset than a full `pg_restore` (Postgres template databases) if snapshot
  restore time becomes a bottleneck.
