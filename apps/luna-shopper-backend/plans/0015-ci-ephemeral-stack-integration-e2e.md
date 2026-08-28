# 0015 Running integration and e2e in CI on an ephemeral stack

Plan 0010 decided the test *layers* and plan 0013 decided the *data* they run on. Both are
built: `*.integration.spec.ts` suites behind a `test-integration` target, a Playwright suite in
`apps/luna-shopper-backend-e2e`, a compose stack in `k8s/e2e/luna-shopper-backend/compose.yml`,
a slot harness for parallel worktrees, and a seeder. What is missing is the last link: **none of
it runs in CI**. `.github/workflows/pr.yml` runs `nx affected -t lint test`, which is the unit
and schema layer only. This plan closes that gap.

## 0. The problem, stated precisely

Two things are true today and both are dangerous:

1. **The infra backed layers never execute on a pull request.** A migration that does not apply,
   a repository query that only a real Postgres rejects, or a broken end to end flow reaches
   `dev` and then `main` unchallenged.
2. **When they do execute without infrastructure they report success.** The integration specs are
   wrapped in `describeIntegration`, which skips unless `LUNA_INTEGRATION=1`, and the Playwright
   suite pings the gateway in `global-setup` and skips itself when nothing answers. Those
   graceful skips are correct for a developer with no Docker running. In CI they are a lie: a
   green check that proves nothing.

So wiring the suites into CI is only half the work. The other half is making a *skip* a
**failure** whenever CI intended the suite to run. A plan that only added workflow steps would
ship a pipeline that passes even when the stack fails to come up.

## 1. Decision: compose, not testcontainers

Both were considered. **Compose is adopted; testcontainers is not.**

The deciding argument is that `compose.yml` is already the single definition of what Luna
Shopper's infrastructure *is*: the Postgres major version, the three separate databases that
enforce the no shared database rule, NATS started with JetStream and a persistent store dir,
and Mailpit. It is the file developers already run, and it is documented in
`parallel-worktree-testing.md`. Introducing testcontainers would create a **second** definition
of the same infrastructure, in TypeScript, free to drift from the first. The failure mode of
that drift is the worst kind: CI passes on Postgres 16 while a developer reproduces on
Postgres 15, or CI's NATS has JetStream and the developer's does not. One definition, used
everywhere, is worth more than the ergonomics testcontainers buys.

Testcontainers' genuine advantages are:

- **Zero setup**: `nx run <svc>:test-integration` works with nothing running beforehand.
- **Random ports**: no collision between concurrent runs, which is exactly the problem the slot
  harness exists to solve.

Neither is decisive here. Random ports do not matter on a CI runner, which is an isolated
machine with the stack to itself. Zero setup is a real loss, and it is closed instead by section
4's wrapper targets, which bring the compose stack up, migrate, run the suite, and tear it down
in one command. That recovers the ergonomics without a second infra definition.

**Revisit this if** the suites ever need infrastructure that is genuinely per test rather than
per run (for instance one throwaway database per spec file for isolation, which compose cannot
express and testcontainers does naturally). At that point testcontainers becomes the right tool
for the integration layer specifically, and compose stays the definition for e2e.

## 2. Decision: two tiers of fidelity

Running the five services from freshly built docker images is the highest fidelity way to run
e2e, and it is slow: it means building five images inside the pull request gate. Running them as
plain Node processes from `dist` is fast and tests everything except the image itself.

Rather than choose once, the two are split across the two workflows that already exist:

| | Where | Services run as | What it protects |
| --- | --- | --- | --- |
| **Tier 1: PR gate** | `pr.yml`, every PR into `main`/`dev` | `node dist/.../main.js` after `nx run-many -t build` | Application correctness. Fast enough to block a merge on. |
| **Tier 2: pre deploy** | `docker-ci.yml`, on push to `main`, after the images are built and before `helm upgrade` | the just built images | Image shape: entrypoint, non root user, runtime deps, `SIGTERM` handling, baked config. |

Tier 2 costs almost nothing extra because `docker-ci.yml` **already builds those images** on the
way to staging. It simply runs the suite against them before deploying rather than after, which
turns the staging deploy into a gated one. A red tier 2 stops the `helm upgrade` and the
`kubectl rollout restart`, so a broken image never reaches staging.

Tier 1 is the one that must stay fast, because it blocks every merge.

## 3. Making a skip a failure

This section is the reason the plan is worth doing. Everything else is plumbing.

### 3.1 First, consolidate the gates

The skip logic is currently spread across four places, in two different implementations, and no
single one of them can be changed to fix this:

| Where | What it does |
| --- | --- |
| `apps/luna-shopper-backend/auth/src/test/infra-gate.ts` | `describeIntegration` = `describe.skip` unless `LUNA_INTEGRATION` |
| `apps/luna-shopper-backend/core/src/test/infra-gate.ts` | a second, identical copy of the same helper |
| `apps/luna-shopper-backend-e2e/src/core-flow.spec.ts` | its own local `gatewayReachable`, then `test.skip(...)` |
| `apps/luna-shopper-backend-e2e/src/support/db.ts` | a *different* `gatewayReachable`, imported by `seeded-flow.spec.ts` |

Note that the e2e skip does **not** live in `global-setup`. Global setup only guards seeding; it
warns and returns when the gateway is unreachable. The decision to run the tests at all is made
per spec file, which is why a new spec that forgets the guard behaves differently from its
neighbours.

So the first work item is consolidation, before any inversion:

- One integration gate, hoisted out of the two per service copies into a shared test only
  location (`libs/luna-shopper/test-fixtures` is the natural home, since it is already the
  test only library every service may depend on).
- One `gatewayReachable`, in `support/db.ts`, with `core-flow.spec.ts` importing it instead of
  redefining it.

Consolidating first is what makes the next step trustworthy: a gate with four definitions cannot
be reasoned about, and inverting three of the four would be worse than inverting none.

### 3.2 Then invert it

A new environment variable, `LUNA_REQUIRE_STACK=1`, is set by both CI tiers and by nothing else.
Where it is set, an intended skip becomes a failure:

- **The integration gate**: when `LUNA_REQUIRE_STACK=1` is set and `LUNA_INTEGRATION` is not, or
  when the database is unreachable, it throws instead of returning `describe.skip`.
- **The e2e gate**: an unreachable gateway becomes a thrown error naming the URL it tried and the
  timeout it waited, rather than a `test.skip`.

### 3.3 And close the empty suite hole

`passWithNoTests` is set on the `test-integration` targets, and **`catalog` has no
`test-integration` target at all**, so `nx run-many -t test-integration` today covers auth and
core only. Two consequences:

- Add the missing target to `catalog` so the service is not silently outside the net. It already
  has its own database and `migration:run`, so it has the same schema risk auth and core do.
- Keep `passWithNoTests` (a service with no integration specs yet is legitimate) but have CI read
  the Jest JSON summary and assert that the services expected to have specs actually executed at
  least one. Without that check a `testMatch` typo empties a suite and the pipeline stays green.

## 4. Local ergonomics: one command per suite

Targets on the `luna-shopper-backend` umbrella project wrap the sequence that
`docs/testing-strategy.md` currently spells out by hand, so a developer and CI run the same
thing:

- **`stack:up`** brings up compose (honoring `.env.slot` when present), waits on every
  healthcheck, and runs `migration:run` for auth, core, and catalog.
- **`stack:down`** tears the stack down **including volumes** (`down -v`), so nothing survives
  between runs.
- **`test-integration:stack`** runs `stack:up`, then `nx run-many -t test-integration` with
  `LUNA_INTEGRATION=1`, then `stack:down` in a guaranteed cleanup step. A failing suite must
  still tear down and must still surface the original exit code.
- **`e2e:stack`** does the same around building, starting, health gating, and stopping the five
  services plus `nx e2e luna-shopper-backend-e2e`.

The wait step is not optional and is not a `sleep`. Compose reports a container as started long
before Postgres accepts connections, and the existing healthchecks (`pg_isready`) already encode
the right condition, so the wait is `docker compose up --wait`, which blocks on them. NATS has no
healthcheck in the compose file today; **add one** (an HTTP probe against the monitoring port,
`8222/healthz`) so `--wait` covers it too. Without that, migrations can start against a broker
that is not listening yet and fail intermittently, which is precisely the flake that gets a CI
suite disabled.

## 5. Starting the five services in CI (tier 1)

There is no service orchestrator in the repo today, and the slot harness deliberately leaves
service lifecycle to the developer. CI needs one, so a small script,
`k8s/e2e/luna-shopper-backend/run-services.sh`, is added and used by both `e2e:stack` and CI:

1. `nx run-many -t build` for gateway, realtime, auth, core, and catalog.
2. Start each `node dist/apps/luna-shopper-backend/<svc>/main.js` in the background with its
   `.env` loaded, capturing stdout and stderr to a per service log file.
3. **Poll `GET /health/ready`** on each service's port until it passes or a timeout expires.
   Readiness, not liveness: readiness is the probe that already means "dependencies reachable",
   which is exactly the condition the suite needs. This reuses plan 0004 section 6 rather than
   inventing a second readiness signal.
4. On timeout, print the tail of every service log and exit non zero, so a boot failure is
   diagnosable from the CI output alone rather than from a bare timeout.
5. Record the PIDs so teardown kills them with `SIGTERM`, which also exercises the graceful
   shutdown path from plan 0004 section 7.

The script is shared, not inlined into a workflow, so the CI path and the local path cannot
diverge.

## 6. Seeding

The suite runs against the demo world from plan 0013. CI sets `E2E_SEED=1` and the existing
`global-setup` seeds it.

The **snapshot and restore** half of plan 0013 section 3 stays off in CI: there is nothing to
preserve on a stack that is destroyed minutes later, and `pg_dump` round trips would add only
time and a failure mode. This needs no new configuration, because `isThrowawayStack()` in
`support/db.ts` already keys off the `CI` environment variable, which GitHub Actions sets on
every runner. The behavior is already correct; this plan only has to avoid breaking it.

Because the fixtures use **fixed UUID constants**, the seeded world is identical on every run,
which is what lets the assertions be exact rather than defensive.

## 7. Workflow changes

### 7.1 `pr.yml`

The existing `verify` job is untouched and stays the fast gate. A second job, `verify-infra`,
runs in parallel:

- It computes affected projects once and **exits early when no Luna Shopper project is
  affected**, so a pull request touching only the Angular micro frontends pays nothing. The check
  is `nx show projects --affected --base=origin/${{ github.base_ref }}` filtered for
  `luna-shopper`, published as a step output that guards the remaining steps.
- Docker is available on `ubuntu-latest` with no setup action, so `compose up --wait` works
  directly.
- Playwright browsers are installed with `npx playwright install --with-deps chromium` and cached
  on the Playwright version, since a cold browser download on every run is a large fraction of
  the job's wall time.
- `LUNA_REQUIRE_STACK=1` is set for the whole job.
- `COMPOSE_PROJECT_NAME` is set to the run id so a retried or overlapping run never adopts a
  previous run's volumes.

Both jobs become required checks on `main` and `dev`, which preserves the property `pr.yml`
already documents: because every commit reaching those branches is tested, the staging and
release workflows do not retest.

### 7.2 `docker-ci.yml`

After the affected images are built and before the `helm upgrade` step, a tier 2 stage brings up
compose, runs the five **just built images** against it, and runs the e2e suite. On failure the
job stops before deploying. The images are already local to the runner at that point (or
pullable by the tag just pushed), so this adds the stack boot and the suite, not a rebuild.

This is the step that makes staging deploys gated rather than optimistic.

## 8. Diagnosing failures

An infra backed suite that fails opaquely gets disabled within a month, so failure output is part
of the design. On failure both tiers upload as artifacts:

- the Playwright HTML report and traces (`trace: 'on-first-retry'` is already configured),
- `docker compose logs` for every container,
- the per service logs from section 5,
- the Jest JSON summary for the integration run.

Retries are set to **1 for e2e in CI only** (the Nx Playwright preset's usual posture) and
**zero for integration**: an integration test that passes on retry is hiding a real ordering or
isolation bug, and `runInBand` is already set so there is no concurrency to blame it on.

## 9. Keeping it fast

The pull request gate is a merge blocker, so its cost is a design constraint rather than an
afterthought:

- The `verify-infra` job is **skipped entirely** when nothing under `luna-shopper` is affected.
- `nx affected` still narrows which `test-integration` targets run; only e2e is all or nothing.
- The compose stack is a handful of Alpine containers and boots in seconds; it is not the
  bottleneck.
- The Nx cache and the npm cache are shared with the `verify` job's install and build.
- If wall time still becomes a problem, the escape hatch is to move e2e out of the pull request
  gate onto a `dev` push trigger and keep only integration on the PR. That trade is recorded here
  so that taking it is a decision rather than a drift.

## 10. Exit criteria

- A pull request touching a Luna Shopper project runs the integration suites and the Playwright
  e2e suite against a stack CI brought up itself, and both must pass for the check to be green.
- A pull request touching no Luna Shopper project skips that job entirely and costs nothing.
- If the stack fails to come up, or a suite would skip, or a suite matches no specs, **the job
  fails**. No configuration produces a green check without the tests having actually run.
- The integration gate and the gateway reachability probe each have **one** definition, not the
  four they have today, and `catalog` has a `test-integration` target like auth and core.
- `nx run luna-shopper-backend:test-integration:stack` and `...:e2e:stack` run the same sequence
  locally, with cleanup guaranteed even on failure.
- Compose remains the single definition of the infrastructure; the same file backs local
  development, the slot harness, and both CI tiers.
- NATS has a healthcheck, so `up --wait` genuinely gates on the broker being ready.
- A push to `main` runs e2e against the built images and does not deploy to staging if it fails.
- A failing run uploads compose logs, service logs, and the Playwright trace, so it can be
  diagnosed without reproducing locally.
