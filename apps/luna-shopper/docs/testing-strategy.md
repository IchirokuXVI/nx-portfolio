# Luna Shopper testing strategy (plan 0010)

How the backend is tested, and how the polyglot, broker-based system is kept
honest across service boundaries. This is the concrete implementation of
`apps/luna-shopper/plans/0010-testing-and-contracts.md`.

## Layers

| Layer | Tool | Where | Needs infra |
| --- | --- | --- | --- |
| **Unit** | Jest (`@nx/jest`) | colocated `*.spec.ts`, broker + DB mocked | no |
| **Schema contract** | Jest + Ajv | `libs/luna-shopper/contracts/src/schemas/*.spec.ts` | no |
| **Integration** | Jest, real Postgres/NATS | `*.integration.spec.ts` under the `test-integration` target | yes |
| **End to end** | Playwright (`@nx/playwright`) | `apps/luna-shopper-backend-e2e` | yes |

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

Bring up an isolated stack with the slot harness (see
`k8s/e2e/luna-shopper-backend/parallel-worktree-testing.md`), run migrations,
then the suites:

```sh
bash k8s/e2e/luna-shopper-backend/luna-slot.sh 1     # slot >= 1 for a worker
docker compose --env-file k8s/e2e/luna-shopper-backend/.env.slot \
  -f k8s/e2e/luna-shopper-backend/compose.yml up -d
npx nx run luna-shopper-auth:migration:run
npx nx run luna-shopper-core:migration:run

# integration (real Postgres); LUNA_INTEGRATION un-skips the gated specs
LUNA_INTEGRATION=1 npx nx run luna-shopper-core:test-integration
LUNA_INTEGRATION=1 npx nx run luna-shopper-auth:test-integration

# e2e (gateway REST + realtime SSE); serve the four services first, or run images
E2E_GATEWAY_URL=http://localhost:3000 E2E_REALTIME_URL=http://localhost:3001 \
  npx nx e2e luna-shopper-backend-e2e
```

Without a stack the integration specs skip (via `describeIntegration`) and the
e2e suite skips itself (it pings the gateway first), so both are green no-ops.

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

- The default PR pipeline (`nx affected -t lint test`) runs unit + schema tests
  and enforces the ajv dependency via lint's dependency-checks — no workflow edit
  needed.
- Integration (`test-integration`) and `e2e` must run in a job that has Docker:
  bring up the slot stack, run migrations, set `LUNA_INTEGRATION=1`, then
  `nx affected -t test-integration e2e`. Keep this out of the infra-free PR job.
