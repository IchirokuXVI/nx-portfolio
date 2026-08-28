# 0019 Documented response schemas

Swagger currently documents what the gateway **accepts** and nothing about what it **returns**.
Request DTOs are registered as classes and render correctly; every endpoint's 200 and 201 has an
empty body specification. `/docs` therefore tells a client author the shape of a `POST` body and
leaves them to read `apps/luna-shopper-backend/core/src/app/**/*.mappers.ts` to find out what
comes back.

The consequence is concrete: the frontend maps every response into its own models (velista rule
D4, never trust a backend DTO), and today those mappers are written against the backend source
rather than against a published contract. A field that changes shape breaks the client silently,
and nothing in either repository fails.

This plan makes the response side of the API self describing, using the JSON Schemas that
already exist rather than by hand writing a second description of every payload.

Depends on 0010, which built `libs/luna-shopper/contracts/src/schemas`. Companion to 0017 and
0018, which add the fields that most need documenting.

## 1. The obstacle, and why the obvious fix is the wrong one

The obvious fix is `@ApiOkResponse({ type: ZoneView })` on each handler. It does not compile:
every view in `contracts` is a TypeScript `interface`, which is erased at runtime, and
`@nestjs/swagger` needs a class with metadata to reflect over.

That leaves three options.

**Option A, hand written response DTO classes in the gateway.** A `ZoneViewDto` class with
`@ApiProperty()` on each field, declared `implements ZoneView` so the compiler complains when
the contract changes shape. It works and the `implements` clause gives real drift protection for
added and retyped fields.

It is rejected as the primary mechanism because it is a second, hand maintained description of
every payload in the system, roughly thirty classes, whose only job is to restate what
`contracts` already states twice (once as the interface, once as the JSON Schema). A field
added to `ZoneView` would need editing in three places, and the `implements` clause does not
catch the case that matters most in practice, a field being *documented* and then removed from
the schema, because an extra property on a class is not a type error.

**Option B, generate the OpenAPI schema from the JSON Schemas that already exist.** Plan 0010
wrote a JSON Schema for every NATS message request, response and event, with a registry, an ajv
validator, and a completeness spec that fails CI when a pattern has no schema. The response
shapes are therefore already described, already machine readable, and already tested. Feeding
them to Swagger via `@ApiResponse({ schema })` and `@ApiExtraModels` makes the documentation a
projection of the contract rather than a copy of it.

**This is the choice.** The property that earns it: a schema cannot drift from the docs, because
they are the same object, and the completeness spec that already guards the schemas now
transitively guards the docs.

**Option C, generate the interfaces and the docs from the schemas.** The full inversion, with
`json-schema-to-typescript` in the build. Rejected for now: it puts a code generation step in
front of the contracts library that every service and the frontend depend on, for a benefit
Option B already delivers. Noted as the direction to go if the schemas and the interfaces ever
do drift in practice.

## 2. The bridge

A small module in the gateway, `apps/luna-shopper-backend/gateway/src/app/docs/`:

- `toOpenApiSchema(jsonSchema)` converts a registry entry into the OpenAPI 3.1 schema object
  Swagger accepts. OpenAPI 3.1 is a superset of JSON Schema 2020-12, so this is mostly identity;
  what it must handle is rewriting internal `$ref` pointers into `#/components/schemas/...`
  names and hoisting every referenced subschema so the refs resolve.
- `ApiContractResponse(pattern, { status })`, a decorator that looks the response schema up by
  pattern name, hoists it, and applies `@ApiResponse`. Usage reads
  `@ApiContractResponse(ZONE_PATTERNS.listMine)` on the handler, which is shorter than the
  `@ApiOkResponse` it replaces and cannot name a shape the contract does not have.
- The hoisted components are registered once at bootstrap, next to where `SwaggerModule` is set
  up in the platform's Swagger helper.

A pattern with no response schema is a startup error, not a silently undocumented endpoint. The
completeness spec means that state is unreachable, so the error exists to keep it unreachable.

## 3. Coverage

Every handler in the gateway gets a documented success response: zones, memberships, lists,
lines, comments, merges, catalog, auth and account. That is the whole of
`apps/luna-shopper-backend/gateway/src/app/**/*.controller.ts`.

Error responses are documented once, globally, rather than per handler. Every error in this
system is the RFC 7807 problem envelope from 0004, and the set of statuses a route can produce
is derivable from its guards:

- Every route: 500 and, where throttled, 429.
- Every guarded route: 401.
- Every route resolving a membership: 403 and 404.
- Every route with a body: 400.

A single `@ApiProblemResponses()` composite decorator applies the right set, driven by
`ERROR_STATUS` from the platform so the status codes come from the same map the exception filter
uses. Hand listing `@ApiResponse({ status: 403 })` on a hundred handlers is exactly the
duplication this plan exists to avoid.

## 4. Two response wrappers that need naming

Two shapes in the gateway are not plain views and are easy to get wrong in a client:

- **`Paginated<T>`**, `{ items, nextCursor }`. Documented as a generic, so `ZonePage` renders as
  a real object with a typed `items` array rather than as an opaque blob. In OpenAPI this means
  one `Paginated` component per concrete `T`, generated by the bridge.
- **`WithMaybeToken<T>`**, `{ tokens?, data }`, returned by `POST /v1/zones` and
  `POST /v1/zones/join`. This one is load bearing and currently invisible: a client that assumes
  the zone is the response body rather than `data` fails immediately, and the optional `tokens`
  is how an anonymous caller receives their identity at all. It gets an explicit description
  saying when `tokens` is present.

## 5. Verification

The value of this plan is entirely in whether the documentation matches reality, so the
verification is the deliverable, not a formality.

- **A generation spec**: building the OpenAPI document succeeds, and every route in it has at
  least one documented success response with a non empty schema. This is the assertion that
  fails when someone adds a controller and forgets the decorator.
- **A round trip spec**: for every registered pattern, a fixture response validated by the ajv
  validator from 0010 also validates against the OpenAPI schema the bridge produced from the
  same source. This catches a bad `$ref` rewrite, which is the one thing in section 2 that can
  silently produce a schema that is well formed and wrong.
- **The e2e suite asserts the contract, not just the status.** `apps/luna-shopper-backend-e2e`
  already exercises the gateway over real HTTP; each response there is validated against the
  published schema. That closes the loop end to end: the docs describe the schema, the schema is
  validated by the tests, and the tests run against the real server.
- **A committed OpenAPI artifact.** The document is written to
  `apps/luna-shopper-backend/gateway/docs/openapi.json` by an Nx target and committed, so a
  change to any response shape shows up as a reviewable diff in the pull request that causes it.
  A CI check regenerates and fails on a diff, in the same spirit as the AsyncAPI generation 0010
  already has for the broker side.

## 6. What this gives the frontend

Velista's mappers can be written and tested against `openapi.json` instead of against the
backend source, which is the specific request behind this plan. Two consequences worth stating:

- The committed artifact means the frontend repository can vendor or fetch a versioned copy, so
  it is not coupled to a running backend to know the shape.
- Rule D4 does not change. The frontend still maps from `unknown` into its own models and never
  passes a contract type into a component. A published schema makes that mapping *verifiable*;
  it does not make the backend's shape safe to use directly.

## 7. Exit criteria

- Every gateway route documents a success response whose schema comes from
  `libs/luna-shopper/contracts/src/schemas`, with no hand written response DTO classes.
- Error responses are documented from `ERROR_STATUS` by one composite decorator, not per
  handler.
- `Paginated<T>` renders with a typed `items` array, and `WithMaybeToken<T>` documents when
  `tokens` is present.
- Adding a controller without a documented response fails a spec rather than shipping.
- Every fixture that validates against a contract schema also validates against the generated
  OpenAPI schema.
- `apps/luna-shopper-backend/gateway/docs/openapi.json` is committed and CI fails when it is
  stale.
- `nx run-many --all --target=test|lint|build` green for the luna projects.
