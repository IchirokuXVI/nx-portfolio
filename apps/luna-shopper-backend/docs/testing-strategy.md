# Luna Shopper testing strategy (plan 0010)

How the backend is tested, and how the polyglot, broker-based system is kept
honest across service boundaries. This is the concrete implementation of
`apps/luna-shopper-backend/plans/0010-testing-and-contracts.md`.

## Layers

| Layer               | Tool                          | Where                                                       | Needs infra |
| ------------------- | ----------------------------- | ----------------------------------------------------------- | ----------- |
| **Unit**            | Jest (`@nx/jest`)             | colocated `*.spec.ts`, broker + DB mocked                   | no          |
| **Schema contract** | Jest + Ajv                    | `libs/luna-shopper/contracts/src/schemas/*.spec.ts`         | no          |
| **Integration**     | Jest, real Postgres/NATS      | `*.integration.spec.ts` under the `test-integration` target | yes         |
| **End to end**      | Playwright (`@nx/playwright`) | `apps/luna-shopper-backend-e2e`                             | yes         |

`nx affected` runs the right unit + schema tests per change, mirroring CI. The
infra-backed layers are gated so they never break the fast, infra-free suite.

## The cross-service contract (the polyglot problem)

Shared TypeScript types are not enforceable in a future .NET or Spring service,
so the contract has a language-neutral form: **JSON Schema**, in
`libs/luna-shopper/contracts/src/schemas`.

- Every NATS **message** (request + reply) and every **event** payload has a
  schema, wired in `registry.ts` (`messageContracts`, `eventContracts`).
- `validator.ts` exposes one Ajv instance and `validateMessageRequest`,
  `validateMessageResponse`, `validateEvent`, plus `assertValid` for an optional
  runtime guard in development.
- `schemas.spec.ts` builds the Ajv instance (which fails on any duplicate `$id`
  or unresolvable `$ref`), asserts **every** subject/event enum value has a
  registered schema (so adding a subject without a schema fails CI), and checks
  representative valid and malformed payloads.
- `buildAsyncApiDocument()` renders the whole surface as an AsyncAPI 2.6 document
  from the same registry, for documentation/tooling.

A future polyglot service validates against the same schemas, so the contract
holds across languages. This is step 1 of the plan and the enforceable baseline.

## Running the infra-backed layers

One command per suite (plan 0015, section 4). Each brings the compose stack up,
waits on its healthchecks, migrates, runs the suite, and tears the stack down
including volumes. Cleanup is guaranteed even when the suite fails, and the exit
code is the suite's:

```sh
# integration (real Postgres), for auth, core and catalog
npx nx run luna-shopper-backend:test-integration:stack

# e2e (gateway REST + realtime SSE), building and starting the six services
npx nx run luna-shopper-backend:e2e:stack

# just the stack, to poke at by hand
npx nx run luna-shopper-backend:stack:up
npx nx run luna-shopper-backend:stack:down
```

These honour `.env.slot` when `luna-slot.sh` has written one, so a worktree on a
slot runs its own isolated copy with no extra flags. **CI runs exactly these
scripts**, which is the point: there is no CI-only sequence that can drift from
what you run locally.

The long hand is still there when you want the pieces separately:

```sh
bash k8s/e2e/luna-shopper-backend/luna-slot.sh 1     # slot >= 1 for a worker
docker compose --env-file k8s/e2e/luna-shopper-backend/.env.slot \
  -f k8s/e2e/luna-shopper-backend/compose.yml up -d --wait
npx nx run luna-shopper-backend-auth:migration:run
npx nx run luna-shopper-backend-core:migration:run
npx nx run luna-shopper-backend-catalog:migration:run

# Every port below comes from the file luna-slot.sh just wrote, never from a
# number typed into this document. It carries the whole slot: the databases, the
# broker, and the five services. Writing the numbers out here is how this section
# went stale once already, naming a `default + N*100` scheme that had been
# replaced by the 43000 band, so the commands pointed at dead ports.
set -a; . k8s/e2e/luna-shopper-backend/.env.slot; set +a

# integration (real Postgres); LUNA_INTEGRATION un-skips the gated specs
LUNA_INTEGRATION=1 npx nx run luna-shopper-backend-core:test-integration

# The platform library has one too (plan 0016): it drives a real NATS round trip
# and asserts the whole chain lands in ONE trace. It reads NATS_URL, which no
# project .env supplies for a library, so pass this slot's broker port.
LUNA_INTEGRATION=1 NATS_URL="nats://localhost:$LUNA_NATS_PORT" \
  npx nx run luna-shopper/platform:test-integration

# e2e: start the five services, then point the suite at THEIR ports. The default
# is :3000/:3001, which on a slot is either nothing (so the suite skips itself and
# reports a green run that tested nothing) or somebody else's stack.
bash k8s/e2e/luna-shopper-backend/run-services.sh start
E2E_GATEWAY_URL="http://localhost:$LUNA_GATEWAY_PORT" \
E2E_REALTIME_URL="http://localhost:$LUNA_REALTIME_PORT" \
  npx nx e2e luna-shopper-backend-e2e
bash k8s/e2e/luna-shopper-backend/run-services.sh stop
```

Without a stack the integration specs skip (via `describeIntegration`) and the
e2e suite skips itself (it pings the gateway first), so both are green no-ops.

### The gates, and when a skip becomes a failure

Those graceful skips are correct for a developer with no Docker running. In CI
they are a lie: a green check that proves nothing. So there is one more variable
(plan 0015, section 3).

| Variable             | Meaning                                                                      |
| -------------------- | ---------------------------------------------------------------------------- |
| `LUNA_INTEGRATION`   | a stack is up; run the gated integration specs                               |
| `LUNA_REQUIRE_STACK` | a stack was brought up **on purpose**; an intended skip is now a **failure** |
| `E2E_SEED`           | seed the demo world in the Playwright global setup                           |

`LUNA_REQUIRE_STACK` is set by both CI tiers and by the `*:stack` targets, and by
nothing else. Where it is set, a missing `LUNA_INTEGRATION`, an unreachable
gateway, or a missing `E2E_SEED` fails the run rather than skipping it.

Each gate has exactly **one** definition, which is what makes that inversion
trustworthy:

| Gate                                 | Where                                                                                                             |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `describeIntegration`, `requiredEnv` | `libs/luna-shopper/test-fixtures/src/lib/infra-gate.ts`, imported as `@portfolio/luna-shopper/test-fixtures/jest` |
| `gatewayReachable`, `gateOnStack`    | `apps/luna-shopper-backend-e2e/src/support/db.ts`                                                                 |

The integration gate is a jest-only second entry point rather than part of the
package barrel, because the Playwright suite imports that barrel and has no
`describe`.

`passWithNoTests` stays on the `test-integration` targets, because a service with
no integration specs yet is legitimate. The hole that leaves, a `testMatch` typo
emptying a suite while the pipeline stays green, is closed instead by
`apps/luna-shopper-backend/tools/ci/assert-integration-ran.js`: it reads each
run's Jest JSON summary and fails when a service known to have specs executed
none. It counts _executed_ tests rather than total, so a wholesale skip cannot
pass it either.

The `test-integration` and `e2e` targets are deliberately **uncached**. Their
results depend on a live database and on environment variables Nx does not hash,
so a replayed cache entry could report a pass from a run that touched nothing.

## Consumer-driven contract tests (Pact) — deferred

Step 2 of the plan: Pact **message pacts** for the critical few broker
interactions — gateway to auth, gateway to core, and the core to realtime event
stream. Pact has JVM and .NET implementations, so it stays polyglot. It is
**deferred**: the JSON Schema validation above is the plan's accepted interim
equivalent (it already fails CI on a breaking provider change), and Pact adds a
broker and `@pact-foundation/pact` to the toolchain. Adopt it for those three
interactions as the system grows; the schemas in `contracts` are the shapes the
pacts will assert.

## CI

Every layer runs, in two tiers of fidelity (plan 0015, section 2).

|                   | Where                                  | Services run as         | What it protects                                                              |
| ----------------- | -------------------------------------- | ----------------------- | ----------------------------------------------------------------------------- |
| **Unit + schema** | `pr.yml`, job `verify`                 | n/a                     | the fast, infra-free layer                                                    |
| **Tier 1**        | `pr.yml`, job `verify-infra`           | `node dist/.../main.js` | application correctness; fast enough to block a merge on                      |
| **Tier 2**        | `docker-ci.yml`, before `helm upgrade` | the just built images   | image shape: entrypoint, non root user, runtime deps, `SIGTERM`, baked config |

- Both `pr.yml` jobs are required checks on `main` and `dev`. That is what keeps
  the property this repo already relies on: every commit reaching those branches
  is tested, so the release workflow does not retest it.
- `verify-infra` **skips itself entirely** when no `luna-shopper` project is
  affected, so a pull request touching only the Angular micro frontends pays
  nothing beyond `npm ci`. `nx affected` further narrows which services'
  integration suites run; e2e is all or nothing, because it exercises the whole
  system.
- Tier 2 runs _before_ the `helm upgrade` and the `kubectl rollout restart`, so a
  red suite stops the deploy and a broken image never reaches staging. It costs
  the stack boot and the suite, not a rebuild: `docker-ci.yml` already built those
  images on the way to staging.
- Both tiers set `LUNA_REQUIRE_STACK=1`, so a suite that would skip fails instead,
  and `COMPOSE_PROJECT_NAME` per run, so a retried or overlapping run can never
  adopt a previous run's volumes.
- Retries are **1 for e2e in CI only** and **zero for integration**: an
  integration test that passes on retry is hiding a real ordering or isolation
  bug, and `runInBand` is already set, so there is no concurrency to blame.
- On failure both tiers upload the Playwright HTML report and traces, the compose
  logs, the per service logs, and the Jest JSON summaries. An infra backed suite
  that fails opaquely gets disabled within a month, so the diagnostics are part of
  the design.

If the pull request gate's wall time ever becomes a problem, the escape hatch is
to move e2e onto a `dev` push trigger and keep only integration on the PR. It is
written down here so that taking it is a decision rather than a drift.
