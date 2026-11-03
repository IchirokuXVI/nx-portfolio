# 0243: A second client builds from the contracts

> The owner decided on 2026-11-02 that a developer who writes another Velista client builds
> it inside the monorepo, beside `velista-client`. Today such a developer gets
> `gateway/docs/openapi.json` and nothing else. The realtime surface (event names, rooms,
> client messages, payloads) is described only by code, and velista restates it by hand in
> `libs/velista/data-access/src/lib/realtime/realtime-events.ts`. The version protocol has
> one floor for every client. The links the server builds into mail and redirects, and the
> paths a client must serve for them, are spread over four services' configuration.
>
> This plan closes those gaps: the realtime surface becomes a published, generated document
> with every payload typed; velista imports the names it restates today; the version
> protocol learns which client is asking; and one hand written page, with generated parts,
> tells a client author what the server expects of a client.
>
> Most of the realtime contract already exists in `libs/luna-shopper/contracts`, which the
> brief of this plan had assumed absent: `RealtimeEvent` (every event name, as the NATS
> subject), `RealtimeClientMessage` (the messages a client sends), `RealtimeRoom` and the room
> builders `zoneRoom`, `zoneStaffRoom`, `listRoom`, `userRoom`, `basketRoom` and their
> presence peers (`lib/messages/realtime.messages.ts`), JSON Schemas per event
> (`schemas/events/realtime.schemas.ts`), and an AsyncAPI 2.6 builder of the internal NATS
> surface (`schemas/asyncapi.ts`) whose output nobody commits. Velista restates the names
> because the `contracts` barrel re-exports the ajv validator (`src/index.ts`, `export *
> from './schemas'`), and a value import would put ajv in the client bundle (velista
> `libs/velista/models/src/lib/enums.ts`, the comment on `import type`).
>
> Paths below are today's. Docs `0003` moves the server to `apps/velista-server/*` and
> `libs/velista-server/*` (alias `@velista/server/*`), velista to `velista-client`, the back
> office to `velista-admin`, and this plans directory to `apps/velista-server/plans`.
>
> Prerequisite reading: backend `0009` (the realtime transport), backend `0010` section 2
> (schemas as the contract, AsyncAPI named there), backend `0019` (response schemas projected
> from the contract schemas), backend `0030` (audiences and the user room), velista `0004`
> sections 4.1 and 9.3 (rule D4, and why contracts imports are type only), velista `0034`
> (the client version), admin `0004` section 2 (wire types), backend `0241` (the environment
> manifest), and in the code `apps/luna-shopper-backend/realtime/src/app/socket/realtime.gateway.ts`,
> `realtime/src/app/consumer/jetstream.consumer.ts`, `libs/velista/data-access/src/lib/realtime/realtime-socket.ts`,
> `libs/luna-shopper/platform/src/lib/versioning/client-version.ts`,
> `libs/velista/models/src/lib/app-version.ts`,
> `apps/luna-shopper-backend/gateway/src/app/client-version/min-client-version.guard.ts` and
> `tools/openapi/generate-wire-types.mjs`.
>
> **Build order.** Step 2 of the series: after docs `0003`, in parallel with backend `0240`,
> `0241`, `0242`, docs `0004`, velista `0178`, k8s `0020` and `0021`. The generated part of
> the client page (target state 9) reads backend `0241`'s manifest; if `0241` has not merged,
> the builder writes the page with that table left out and says so. The tag constraints
> this plan documents are docs `0003`'s; this plan adds none. The series order, as every
> plan of the series states it: docs `0003` first, alone, after the pull request gate; then
> in parallel docs `0004`, backend `0240` to `0243`, velista `0178`, k8s `0020` and `0021`
> (backend `0242` after velista `0178` for the admin mechanism, k8s `0020` after backend
> `0241` for the generated files); k8s `0019` after docs `0003` and backend `0240`, in the
> same rollup to `main` as `0240`; docs `0005` last, with docs `0006` read from the start.

## Brief for the agent

### Objective

Publish the realtime surface as a generated `asyncapi.json` beside `openapi.json`, with a
typed payload schema for every event and a stale check; give `contracts` a browser safe
entry for the realtime names and the version protocol, and make the realtime service and
velista import from it; add a client name to the version protocol with a floor per client,
keeping today's installed apps working; and write the page a client author reads.

### Context

- **Who emits what.** Core and the other services publish a `DomainEvent` envelope
  (`contracts/src/lib/events/realtime.events.ts`: `event`, `eventId`, and the audience
  `zoneId`, `listId`, `userIds`, `basketIds`) on the NATS subject of the event. The realtime
  service consumes the stream (`jetstream.consumer.ts`), resolves rooms from the audience,
  and emits `message.event` with `message.payload` into those rooms
  (`realtime.gateway.ts:142`, `this.server.local.to(message.rooms).emit(...)`). It reshapes
  one payload per room (`zone.countsUpdated` is redacted outside the staff room) and computes
  three presence events itself (`presence.zoneUpdated`, `presence.listUpdated`,
  `presence.basketUpdated`). The socket event name is the `RealtimeEvent` value.
- **The handshake.** socket.io, transport `websocket` only, CORS `origin: true`
  (`realtime.gateway.ts:79-82`). The token is read from `handshake.auth.token`, then the
  `Authorization: Bearer` header, then the `token` query (`tokenOf`). A basket participant
  joins `basket:{id}` at connection from a participant credential. `RealtimeClientMessage`
  messages are acknowledged with `{ ok: boolean }`. A read only SSE fallback serves
  `GET /v1/zones/:id/stream` and `GET /v1/lists/:id/stream` (`sse/sse.controller.ts`), with
  the token also accepted as a query parameter.
- **What velista restates.** `realtime-events.ts` declares `REALTIME_EVENT_NAMES` (43
  names), `REALTIME_CLIENT_MESSAGES`, `zoneRoom`, `zoneStaffRoom` and `listRoom`, and its own
  `RealtimeEvent` union (its models, rule D4). `realtime-socket.ts` filters incoming names
  through `KNOWN_EVENT_NAMES` before `toRealtimeEvent` maps them
  (`realtime-event-mapper.ts`). `wire-contract.spec.ts` already validates captured payloads
  against `allSchemas` from `contracts`.
- **Payload schemas.** `domainEventContracts` maps each subject to a schema id. Only two
  events have a typed envelope (`TYPED_ENVELOPES`: `basket.linesChanged`, `basket.updated`)
  and the three presence events have their own schemas. Every other event maps to the
  generic `domainEventEnvelope`, whose payload is untyped. Many payloads are views that
  already have message schemas (`ZoneView`, `MembershipView`, `ListView`, the line and
  comment views).
- **`contracts` is framework free**: its sources import only `ajv` and `ajv-formats` (and
  `node:fs` in specs). `tsconfig.base.json` already has one secondary alias,
  `@portfolio/luna-shopper/contracts/brand-key`, pointing at a single file.
- **The version protocol.** `x-client-version` carries a semantic version; `MIN_CLIENT_VERSION`
  is one floor (empty turns the mechanism off); the guard sets `x-min-client-version` on
  every response and refuses an older client with `client_too_old`, HTTP 426
  (`error-codes.ts`, `UPGRADE_REQUIRED`). `main.ts` lists `x-min-client-version` in
  `exposedHeaders`; `enableCors` sets no `allowedHeaders`, so the `cors` package reflects
  whatever request headers a preflight asks for. `values.production.yaml:59` sets
  `minClientVersion: '0.17.0'`, so installed Android apps from 0.17.0 on send the header and
  are compared. The comparison exists twice, in `platform` (`client-version.ts`) and in
  velista (`app-version.ts`), because `platform` pulls Nest, pino and `node:crypto`; both
  specs assert one table of cases. The back office sends no version header. The OpenAPI
  document mentions neither header nor the 426.
- **Links the server builds.** `gateway/src/app/auth/app-url.ts` builds
  `<APP_BASE_URL with {locale}>/<path>#<fragment>` for `auth/callback` (the Google handoff,
  backend `0230`, `google.controller.ts:66`) and `auth/impersonate` (a support session,
  backend `0194`, `admin-impersonation.controller.ts:39`). Auth builds
  `<MAIL_VERIFY_BASE_URL>?token=` and `<MAIL_RESET_BASE_URL>?token=` (`mail.service.ts`).
  `GOOGLE_CALLBACK_URL` is the gateway's own route. No other URL is built by core or the
  gateway; a basket share link is built by the client.
- **Client paths velista serves for them**: `{locale}/auth/verify`,
  `{locale}/auth/reset-password`, `{locale}/auth/callback`, `{locale}/auth/impersonate`
  (`libs/velista/feature-shell/src/lib/routes.ts`).
- **Shared code.** Framework free, imported by velista today: `basket-rules`,
  `shop-map/model`, `shop-map/recorder`, `shop-map/editor`, `postal-codes`, `osm-places`
  (their sources import nothing outside themselves but `osm-places` from `postal-codes`
  and the recorder and the editor from `shop-map/model`), and `contracts` (type imports).
  These seven are the libraries docs `0003` D6 tags `scope:shared-core`. Angular
  code a second Angular client could reuse: `libs/velista/data-access`, `models`, `native`,
  parts of `platform`. All carry `"tags": []` today.

### Target state

1. **A browser safe realtime entry.** `contracts` gains a secondary entry
   (`@velista/server/contracts/realtime`, the alias as docs `0003` names it) that exports
   `RealtimeEvent`, `RealtimeClientMessage`, `RealtimeRoom`, every room builder, the
   acknowledgement type and the payload types, and imports nothing from `schemas/`. A spec
   asserts its module graph reaches no `ajv`.
2. **The server imports it.** The realtime service and every publisher import the names
   from that entry or from the barrel, as today; no string literal names an event, a room
   or a client message outside `contracts`.
3. **Velista imports it.** `REALTIME_EVENT_NAMES`, `REALTIME_CLIENT_MESSAGES` and the three
   room functions in `realtime-events.ts` are replaced by imports from the entry. Velista
   keeps its own `RealtimeEvent` union and its mapper from `unknown` (rule D4): it imports
   names and wire types, never its models. A spec asserts every server event name is handled
   by the mapper or listed in an explicit ignore list with a reason.
4. **Every event has a typed payload.** Each socket event (domain and presence) maps to a
   schema of its payload, reusing the view schemas where the payload is a view. A
   completeness spec in `contracts` fails on an event whose payload maps to the generic
   envelope. The two variants of `zone.countsUpdated` are one schema with the staff fields
   nullable, as the payload is.
5. **The document.** A target `velista-server-realtime:asyncapi` writes
   `apps/velista-server/realtime/docs/asyncapi.json` (or beside `openapi.json`, owner
   decision), an AsyncAPI 3.0 document of the client surface: the socket.io connection and
   its token, one channel per room kind with its address pattern, one message per server
   event with its payload schema, one operation per client message with its acknowledgement,
   and the SSE endpoints named in the description. The internal NATS surface is not in it.
   A spec in the realtime project builds the document and compares it with the committed
   file after normalising line endings, failing with the regenerate command, as
   `openapi-document.spec.ts` does.
6. **The wire types read it.** `tools/openapi/generate-wire-types.mjs` accepts the AsyncAPI
   document's `components.schemas` as a second input (it reads `components.schemas` and
   nothing else today), so a client author generates types for both surfaces with one tool.
   The admin output stays as it is.
7. **A client name.** Clients send `x-client-name` beside `x-client-version`. The gateway
   reads `MIN_CLIENT_VERSIONS` (`velista-client=0.17.0,velista-admin=0.5.0`; names match
   `^[a-z0-9-]+$`, each version validated with `isComparableVersion` at boot):
   - a request with a name uses that name's floor; a name with no floor is served;
   - a request with a version and **no** name is treated as `velista-client`, which is what
     every installed app that predates this plan is;
   - `MIN_CLIENT_VERSION` stays and means the `velista-client` floor when
     `MIN_CLIENT_VERSIONS` does not name it; both set with different values for
     `velista-client` refuses boot;
   - `x-min-client-version` on a response is the floor of the asking client, and the
     response carries `Vary: x-client-name`.
   Velista sends `x-client-name: velista-client`; the back office sends `x-client-name:
   velista-admin` and `x-client-version` from `VELISTA_ADMIN_APP_VERSION` (today
   `LUNA_ADMIN_APP_VERSION`, renamed by docs `0003`). The chart gains `minClientVersions` beside `minClientVersion`, empty, rendered
   into the ConfigMap and the gateway's env.
8. **One comparison, or two in step.** The header names and the comparison move to a browser
   safe `contracts` entry (`@velista/server/contracts/client`); `platform` re-exports them for
   the server and velista imports them, and the duplicated copy and its forced comment go
   (owner decision, recommended). If the owner keeps two copies, both gain the name header
   constant, and the shared table of cases in `client-version.spec.ts` and
   `app-version.spec.ts` stays identical.
9. **The page.** `apps/velista-server/docs/writing-a-client.md`, hand written prose with
   generated tables between marked comments: the documents (`openapi.json`, `asyncapi.json`,
   `env-manifest.json`) and what each describes; authentication and the realtime handshake;
   the version protocol (both headers, the 426 and `client_too_old`, `Vary`); the links the
   server builds and the client paths that must answer them (from the context above), with
   the configuration keys that shape them (`APP_BASE_URL` and its `{locale}`,
   `MAIL_VERIFY_BASE_URL`, `MAIL_RESET_BASE_URL`, `GOOGLE_CALLBACK_URL`, `CORS_ORIGINS`), whose
   descriptions and defaults are a table generated from backend `0241`'s manifest; rule D4
   for clients; and the code map of target state 10. `tools/docs/client-page.mjs --check`
   fails on stale tables.
10. **The code map** in that page: the framework free libraries any TypeScript client may
    import, tagged `scope:shared-core` (`contracts` through its browser safe entries,
    `basket-rules`, `shop-map/model`, `shop-map/recorder`, `shop-map/editor`,
    `postal-codes`, `osm-places`), the Angular libraries a second Angular client may reuse,
    tagged `scope:client` with `type:data-access`, `type:models`, `type:native` and
    `type:platform` (velista's `data-access`, `models`, `native`, and the named parts of
    `platform`), the rule that those may not import a library tagged `type:feature` or
    `type:ui`, and the rule that nothing tagged `scope:server` imports a library tagged
    `scope:client` or `scope:admin`, each with the `depConstraints` entry of docs `0003` D6
    that enforces it.
11. **The OpenAPI document states the protocol.** Every operation lists `x-client-name` and
    `x-client-version` as optional header parameters and a 426 problem response whose
    headers include `x-min-client-version`. The admin wire types are regenerated.

### Scope

In: `libs/luna-shopper/contracts` (two entries, payload schemas, the completeness spec),
`tsconfig.base.json` (two aliases), the realtime service (imports, the document target and
spec), `libs/velista/data-access/src/lib/realtime/*` and `gateway-interceptor.ts`,
`libs/velista/models/src/lib/app-version.ts`, `libs/luna-shopper/platform/src/lib/versioning/*`,
the gateway (`min-client-version.guard.ts`, `app-config.ts`, `main.ts`, the OpenAPI
decorators), the back office's HTTP interceptor, `_env.tpl` and `configmap.yaml.tpl` (one
key), `values.yaml` (one key), `tools/openapi/generate-wire-types.mjs`, `tools/docs/` (new),
`apps/velista-server/docs/writing-a-client.md` (new), the regenerated `openapi.json` and
wire types.

Out: realtime enforcement of the floor (velista `0034` section 9 still holds), any change to
event payload shapes, a client SDK, moving any library (docs `0003` tags them; extraction is
later), the internal NATS AsyncAPI document (stays as the builder it is), Pact tests.

### Constraints

- The new entries import nothing from Nest, pino, `node:*`, ajv or `process`, and compile
  under velista's browser tsconfig.
- Rule D4 stands for velista: wire types may be imported, models are velista's own, and the
  mapper still reads `unknown`.
- A payload schema describes what the wire carries today. Where a schema and a captured
  payload disagree, the payload wins and the disagreement is reported.
- Generated files are written with LF and compared after normalising line endings.
- Regenerate, never hand edit: the OpenAPI document, the wire types, `asyncapi.json`, the
  page's tables.
- An installed app that sends `x-client-version: 0.17.x` and no name is compared exactly as
  today.

### Action boundaries

Stop and ask before: adding a package (an AsyncAPI parser or validator is the obvious
candidate, see owner decisions), changing a payload's shape, changing `minClientVersion` in
any values file, changing what the guard answers for a request with no version, or touching
a cluster.

### Progress evidence

- `npx nx test velista-server/contracts` (today `luna-shopper/contracts`) passes the completeness spec
  and the no ajv spec of the entries.
- `npx nx run velista-server-realtime:asyncapi` writes the document; the stale spec fails
  after a payload schema change and passes after regeneration.
- `npx nx test velista-client/data-access` (today `velista/data-access`) passes, including a
  spec that builds each handled event from the `contracts` payload types and runs it through
  `toRealtimeEvent`, and the handled or ignored spec.
- `npx nx build velista-client --configuration=production` succeeds and the bundle contains
  no ajv (`grep -r "ajv" dist/apps/<client>` finds nothing new).
- Guard specs: no header (served); version only, below the `velista-client` floor
  (refused, as today); name `velista-admin` below its floor (refused); unknown name (served);
  both variables set and disagreeing (boot refused); `Vary` set.
- `npx nx run velista-server-gateway:openapi` and the wire types target produce the header
  parameters and the 426; their specs pass.
- `node tools/docs/client-page.mjs --check` passes.
- On an ephemeral slot, velista and the back office send `x-client-name`, and a browser
  reads `x-min-client-version` cross origin with `MIN_CLIENT_VERSIONS` set.

## Decisions taken in this plan

- **D1. AsyncAPI, not an OpenAPI extension.** AsyncAPI is the standard for message driven
  surfaces, has renderers and a maintained Node parser, and its `components.schemas` is the
  shape the wire type generator already reads. An `x-realtime-events` extension is invisible
  to every OpenAPI tool, and OpenAPI 3.1 `webhooks` describes HTTP requests the server makes,
  which a socket message is not. Rejected: both.
- **D2. AsyncAPI 3.0 for the client document.** Version 3 names operations `send` and
  `receive` from the application's side and separates channels from operations, which reads
  correctly for a client author; the 2.6 `publish` and `subscribe` read backwards. The
  internal NATS builder stays 2.6 and internal. socket.io has no AsyncAPI binding, so the
  document names the `ws` protocol, states that the framing is socket.io, and names the
  client libraries that speak it.
- **D3. A secondary entry, not a split library.** The names already live in `contracts`; the
  only obstacle is ajv in the barrel. An entry that skips `schemas/` removes it with one
  alias, as `contracts/brand-key` already does. Rejected: moving the realtime names into a
  new library, which moves 710 server imports for no gain.
- **D4. A separate name header.** `x-client-version` stays a plain semantic version, so the
  parser, the table of cases and every installed app are unchanged. Folding the name into the
  value (`velista-client/0.17.0`) would change the parser on both sides and make the old
  header ambiguous. Rejected: the folded value.
- **D5. No name means `velista-client`.** Every client that sends a version today is velista,
  and the floor of 0.17.0 exists to retire some of them deliberately. Reading a missing name
  as "no floor" would silently exempt every installed app from that floor.
- **D6. The page is prose with generated tables.** The routes are in `openapi.json` and the
  events in `asyncapi.json`; the page explains the conventions neither document can carry and
  generates only what would otherwise be copied (the configuration keys).

## Owner decisions

- **AsyncAPI or an extension.** Recommendation: AsyncAPI 3.0 (D1, D2).
- **Header shape.** Recommendation: `x-client-name` beside `x-client-version` (D4).
- **Where `asyncapi.json` lives.** Recommendation: `apps/velista-server/realtime/docs/`,
  beside the service that serves the surface. Alternative: beside `openapi.json` under the
  gateway, or a shared `apps/velista-server/docs/` holding all three documents.
- **Where the page lives.** Recommendation: `apps/velista-server/docs/writing-a-client.md`.
  Alternative: `docs/clients.md` at the repository root.
- **One copy of the version comparison.** Recommendation: one copy in a browser safe
  `contracts` entry (target state 8); the reason for the duplicate (`platform` pulls Nest)
  does not apply to `contracts`. Alternative: keep two copies under the shared table.
- **An AsyncAPI validator in the dev dependencies** (`@asyncapi/parser`), so the stale spec
  also proves the document valid. Recommendation: yes, pinned. Alternative: no package, and
  the spec checks only that the document matches the builder.
- **The back office floor.** Recommendation: leave `velista-admin` without a floor until a
  release needs one; the header is sent from the first build.

## Owner steps outside the code

None.
