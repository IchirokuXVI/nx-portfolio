# 0010 Testing strategy and service contracts

Defines how the backend is tested. Although numbered here, these conventions apply **from the
first feature (plan 0005) onward**; the plan is a reference, not an execution order gate. It
also answers the open question of how to keep a polyglot, broker based system honest across
service boundaries.

## 1. Layers and tools

- **Unit tests: Jest** (`@nx/jest`), colocated with the code, fast, with the broker and the
  database mocked. Every service uses Jest. Priority coverage on the logic that is easy to get
  wrong and expensive if it is: token verification, membership authorization, the merge
  transaction (0008), and the ownership fallback (0011).
- **Integration tests**: exercise the real edges against real infrastructure from the dev
  stack (a throwaway Postgres and a real NATS/JetStream, via the docker-compose stack from
  0002 or testcontainers). These cover TypeORM repositories/migrations and NATS message
  handlers, which mocks cannot validate honestly.
- **End to end tests: Playwright** (`@nx/playwright`), driving the gateway's REST surface and
  the realtime channel through whole flows: create a zone and get a token, join and get
  approved, create a list, add lines, and see a realtime update arrive. e2e targets the gateway
  and realtime services, never a service's internal port.

Everything is generated and run through the **Nx plugin** (`@nx/nest`, `@nx/jest`,
`@nx/playwright`), so `nx affected` runs the right tests per change, mirroring the existing
CI.

## 2. Cross service contracts (the polyglot problem)

Shared TypeScript types in `libs/luna-shopper/contracts` are not enforceable in a .NET or Spring
service, so the contract needs a language neutral form and a test that fails when it is broken.
Recommended, in order of effort:

1. **Schema as the canonical contract (do this first, cheap).** Express every NATS message and
   event payload as **JSON Schema** (optionally described together in an **AsyncAPI** document
   that lists subjects, request/reply pairs, and event shapes) inside `contracts`. Each service
   validates inbound and outbound messages against the schema in its tests, and optionally at
   runtime in development. A future .NET/Spring service validates against the same schema, so the
   contract holds across languages.
2. **Consumer driven contract tests with Pact (add for the highest risk interactions).** Pact
   supports **message pacts** for broker interactions, and has JVM and .NET implementations, so
   it stays polyglot. Apply it to the interactions whose breakage hurts most: gateway to auth,
   gateway to core, and the core to realtime event stream. A provider change that breaks a
   consumer then fails CI, not production.

Start with schema validation everywhere; adopt Pact message pacts for the critical few as the
system grows. Do not skip step 1 in favor of only step 2.

## 3. CI wiring

- `nx affected` runs unit, integration, and e2e for changed projects, as the existing pipeline
  already does for the rest of the monorepo.
- Contract checks run on **both** sides: a consumer change re verifies against provider
  schemas/pacts, and a provider change re verifies it still satisfies every consumer.

## 4. Exit criteria

- Each service has Jest unit tests, real infrastructure integration tests, and the gateway has
  Playwright e2e covering the core flows.
- Every NATS message and event has a JSON Schema in `contracts`, validated in tests.
- The critical cross service interactions have Pact message pacts (or an agreed equivalent).
- `nx affected` runs the right tests per change in CI.
