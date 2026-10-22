# 0216: a shopper refreshes the price of one product

> This plan promotes backlog `0006` (the public item refresh and the global fetch cooldown). That
> design waited for one thing: a shared counter, which needed Redis. Redis exists since plan
> `0028`. This plan keeps what still holds from `0006`, replaces what plans `0080`, `0086`,
> `0118` and `0206` changed underneath it, and drops the rest.
>
> A signed in shopper asks for a fresh price of one product at one price scope. The gateway
> forwards the request to the harvester over NATS. The harvester decides whether the product can
> be fetched alone, claims a cooldown for the chain and one for the product in Redis, answers at
> once, and fetches in the background. The price goes through the same ingest write that a walk
> uses. A refresh is not a run: it has no `harvest_runs` row, so a walk never blocks it and it
> never blocks a walk or a schedule. The shopper learns the result by polling a short status
> route. Two chains can be fetched one product at a time today: Mercadona and LIDL. The others
> answer a reason that the client can show.
>
> Velista half: not written. The control needs a mock first, and the owner has not seen one.
>
> Prerequisite reading: backlog `0006` (the history of this file, in git), `0028` sections 2.4,
> 2.5, 2.9 and 5 (what goes in Redis and how it fails), `0080` (prices side by side, decided on
> read), `0083` (the per chain row), `0086` sections 5 and 9 (the ingest, and why `REFRESH` was
> deleted), `0118` (scope copies), `0206` (the switches and the one pod), `0215` (a chain that
> keeps refusing), `harvest-run.service.ts`, `source-ingest.ts`, `catalog-client.service.ts`,
> `account-throttler.guard.ts` and `libs/luna-shopper/platform/src/lib/redis/redis.service.ts`.

## Brief for the agent

### Objective

Let a registered velista user refresh the price of one product at one price scope, for the
chains whose adapter can fetch one product in one plain request, as sections 1 to 11 describe.
Add the harvester service, its table, its Redis claims, the NATS patterns, three gateway routes,
the adapter capability, the deployment switch, and the specs.

### Context

- **The harvester has no Redis client.** `RedisModule.forRoot()` is imported by the gateway
  (`apps/luna-shopper-backend/gateway/src/app/app.module.ts:84`) and by realtime
  (`apps/luna-shopper-backend/realtime/src/app/app.module.ts:43`) only. The chart gives
  `REDIS_URL` to those two roles alone (`k8s/helm/templates/luna-shopper-backend/_env.tpl:57-66`).
  `luna-slot.sh` already writes `REDIS_URL` into every service's `.env`, because it is in the
  `shared` group of `DERIVED_KEYS` (`k8s/e2e/luna-shopper-backend/luna-slot.sh:208`).
- `RedisService` (`libs/luna-shopper/platform/src/lib/redis/redis.service.ts:28`) exposes
  `client` and `tryCommand`. `RedisModule.forRoot` reads `REDIS_URL` with `getOrThrow`
  (`redis.module.ts:52`). A claim with `SET key 1 EX n NX` is already the dedupe window of realtime
  (`apps/luna-shopper-backend/realtime/src/app/consumer/jetstream.consumer.ts:488`).
- Plan `0028` section 2.9 keeps "a queue, a lock, or a scheduler" out of Redis. A cooldown is a
  rate counter of the same kind as the throttler storage (section 2.4) and the dedupe window
  (section 2.5), which that plan put in Redis.
- **Every harvester subject is admin gated today.** `PlatformAdminService`
  (`harvester/src/app/harvest/platform-admin.service.ts:13-18`) says that nothing the harvester
  exposes is open to ordinary users and names backlog `0006` as the one exception that was
  designed. The gateway's harvest controllers all sit behind `AdminJwtGuard`
  (`gateway/src/app/harvest/harvest.controller.ts:120-123`). Other services take the `userId` that
  the gateway puts on the message, for example `catalog.controller.ts:570-588`.
- **Gateway rate limits.** One global bucket of 120 a minute per IP
  (`libs/luna-shopper/platform/src/lib/throttling/throttler-config.ts:96`), counted in Redis since
  plan `0028` (`app.module.ts:95-101`). A verified operator is counted per operator
  (`gateway/src/app/throttling/gateway-throttler.guard.ts:79-94`). A route can add a per account
  limit with `AccountThrottlerGuard` and `@AccountThrottle`
  (`gateway/src/app/throttling/account-throttler.guard.ts:22-36` and `:59-91`), which keys on the
  verified user id and runs after `JwtAuthGuard`.
- **Guests are accounts.** `UserKind` is `TEMPORARY` or `REGISTERED`
  (`libs/luna-shopper/contracts/src/lib/enums/auth.enums.ts:11-14`), and the gateway's
  `CurrentUser` carries `kind` (`gateway/src/app/auth/jwt.strategy.ts:20-22`, `:70-75`). A guest
  identity is minted by the anonymous zone routes, which allow 10 a minute per IP
  (`throttler-config.ts:112`).
- **One active run per chain** is the partial unique index `uq_harvest_run_active` on
  `harvest_runs ("supermarketId") WHERE status IN ('PENDING','RUNNING')`
  (`harvester/src/app/db/migrations/1756200000000-InitialHarvesterSchema.ts:106-112`).
  `HarvestRunService.start` turns a violation into a 409 (`harvest-run.service.ts:498-505`).
  Plan `0206` skips a schedule slot with `SKIPPED_BUSY` when a run of the chain is in flight
  (`harvest-run.service.ts:386-397`).
- `REFRESH` was a run mode until plan `0086` deleted it. The enum comment still points at backlog
  `0006` (`libs/luna-shopper/contracts/src/lib/enums/harvest.enums.ts:19-25`).
- **The ingest needs a run.** `RunContext` is built from a `HarvestRun` and its `runId` is
  `run.id` (`harvester/src/app/harvest/run-context.ts:23-33`). Its flushes write to that run's
  row. `SourceIngest.open` loads every row of the chain and the whole catalog item index on each
  call (`source-ingest.ts:389-405`). The two writes a refresh needs are private:
  `replaceScopePrices` (`source-ingest.ts:1265`), which upserts `source_entry_prices` on
  `(entryId, priceScopeId, sourceKind)`, and `writePrices` (`source-ingest.ts:1327`), which calls
  `catalog.addPrices` and reports `updated` to the run context. The price entry is built by
  `priceEntryFor` (`source-ingest.ts:638`), and an observation priced another way than its row is
  sold is not written (`source-ingest.ts:556`).
- `CatalogClient.addPrices` takes a nullable `sourceRunId` (`catalog-client.service.ts:487-507`),
  and `item_prices.sourceRunId` is nullable (`catalog/src/app/entities/item-price.entity.ts:98-106`).
  `AddItemPriceBatchRequest.sourceRunId` is optional and nullable
  (`libs/luna-shopper/contracts/src/lib/messages/catalog.messages.ts:3205-3209`).
- `source_entry_prices` holds `observedAt` (`harvester/src/app/entities/source-entry-price.entity.ts:107-108`),
  a nullable `runId` (`:118-120`) and `copiedFromScopeId` (`:127-128`). A row with
  `copiedFromScopeId` set is a copy that a walk made from another scope (plan `0118`).
- **Adapters, one product at a time** (read on 2026-10-22):
  - Mercadona: `MercadonaClient.getProduct` and `fetchProduct`
    (`libs/luna-shopper/mercadona/src/lib/mercadona.client.ts:293` and `:307`) read
    `/products/{id}/?lang=es&wh={warehouse}`. One JSON request, no session. A 404 is null and
    means "not stocked in this warehouse" (`:288-292`). The warehouse is the `externalKey` of a
    `LOCAL_AREA` scope (`harvester/src/app/harvest/mercadona-catalog.runner.ts:97-117`). A walk
    takes the price from the listing and not from the detail, because the detail names one
    warehouse only (`mercadona-catalog.runner.ts:395-401`). For one warehouse the two are the
    same number.
  - LIDL: `LidlClient.getProduct(row)` (`libs/luna-shopper/lidl/src/lib/lidl.client.ts:143-157`)
    reads one product page by `row.path` and `row.externalId`. No session. The page states one
    price per offer region with its window, and the walk writes each region as its own scope
    (`lidl-catalog.runner.ts:261-277`). A walk already reads this page for every product.
  - El Jamón: `getProduct(urlOrPath)` (`libs/luna-shopper/eljamon/src/lib/eljamon.client.ts:198`)
    reads one product page, after a session of two requests. A walk takes the price from the
    listing and logs each disagreement with the page (`eljamon-catalog.runner.ts:104-110` and
    `:128-135`).
  - Carrefour: `readDetail(path)` (`libs/luna-shopper/carrefour/src/lib/carrefour.client.ts:226`)
    returns only the external id and the EAN (`carrefour/src/lib/types.ts:152-156`), through a
    headless Chromium launch.
  - DIA: the client has no product read. The runner "reads no product page"
    (`dia-catalog.runner.ts:63-64`). Prices come from listing pages under a session bound to one
    fulfilment store.
  - DEZA: no price, no product id and no product URL (`deza-catalog.runner.ts:169-175`).
- `AdapterCapabilities` (`libs/luna-shopper/contracts/src/lib/messages/harvest.messages.ts:343`)
  is the one place that states what each adapter can do. `ADAPTER_CAPABILITIES` is at `:402` and
  the lookup that answers no for an unknown adapter is at `:535`.
- A shopper's offer view carries `observedAt` and `sourceKind` of the effective row
  (`catalog.messages.ts:1152-1155` and `:1569-1571`).
- The harvester runs as one pod with `strategy: Recreate` (`k8s/helm/values.yaml:680-681`).
- The harvester publishes no realtime event. Nothing under `harvester/src` names `RealtimeEvent`
  or JetStream.
- The latest harvester migration is `1759400000000-HarvestSchedules.ts` today. Migrations are
  listed in `harvester/src/app/db/migrations/index.ts`. Plans `0215` to `0221` each add one, so
  take the next free timestamp on `dev` at build time.
- **This plan lands after plans `0215` and `0217`.** Plan `0217` deletes the
  `context.report({ updated: result.inserted })` call in `writePrices`, so after it the price
  write moves no run counter and the refresh path needs no reporter. Plan `0215` keeps no state
  per chain: its only trace of a stop is `stopReason: SOURCE_BLOCKED` on the `harvest_runs` row
  of the stopped run, and `consecutiveFailures` on the source row as before.

### Target state

Every acceptance criterion in section 14 holds, the specs of section 13 pass, and `openapi.json`
and the wire types are regenerated.

### Scope

- Work only in:
  - `apps/luna-shopper-backend/harvester/src/app/` (a new entity and migration, a refresh store,
    a refresh service, a fetcher per adapter, a narrow public write method on `SourceIngest`, the
    controller, the module, `app.module.ts` for `RedisModule`, `config/app-config.ts`,
    `.env.example`, and the comment of `platform-admin.service.ts`).
  - `apps/luna-shopper-backend/gateway/src/app/catalog/` (a new controller and its DTOs) and
    `gateway/src/app/throttling/account-throttler.guard.ts` (one new limit).
  - `libs/luna-shopper/contracts` (the capability, patterns, requests, views, enums, schemas, and
    the comment on `HarvestRunMode`).
  - `libs/luna-shopper/platform/src/lib/errors/` (one exception).
  - The deployment files for the two variables of section 9: `_env.tpl`,
    `configmap.yaml.tpl`, `k8s/helm/values.yaml`, `values.production.yaml`, `values.staging.yaml`,
    and `k8s/e2e/luna-shopper-backend/luna-slot.sh`.
  - The harvester section of `CLAUDE.md`, which says three switches control the harvester.
  - Their specs, and the generated files.
- Do NOT touch: the runners, the walk path of `SourceIngest` (`open`, `ingest`, `writeChunk`
  behave as before), the adapter libraries, catalog, `harvest_runs` and its indexes, the schedule
  worker, the postal code worker, the replica count or strategy of the harvester,
  `apps/velista`, `libs/velista`, `apps/luna-shopper-admin` and `libs/luna-shopper-admin` except
  the generated wire types.

### Constraints

- A refresh creates no `harvest_runs` row and takes no lock that a run takes.
- A refresh writes a price only through `replaceScopePrices` and `writePrices` of
  `SourceIngest`, and builds the entry with `priceEntryFor`. Do not write a second path to
  `catalog.addPrices` or to `source_entry_prices`. Make the two methods reachable through one new
  public method. The walk's behaviour and counters do not change.
- A refresh creates nothing: no row, no item, no candidate, no queue entry, no scope, no copy
  target.
- The cooldown claims are Redis `SET ... NX PX`. A claim is never released, whatever the fetch
  answers.
- Redis that cannot answer refuses every refresh. Redis that cannot answer changes nothing for a
  run, and the harvester's readiness does not probe Redis.
- `supermarket_sources.enabled`, `HARVEST_ENABLED` and the new `HARVEST_REFRESH_ENABLED` all gate
  a refresh. No variable per chain.
- Every number in section 5 is configuration with the default stated there.
- The adapter libraries stay as they are. A fetcher calls a method they already export.
- Regenerate `openapi.json` and the wire types with their targets, never by hand.
- No dash as punctuation in a comment or a message. Reword the sentence.

### Action boundaries

- Proceed with in scope edits, specs, the migration file and the generators.
- Stop and ask if `catalog.addPrices` refuses a batch with `sourceRunId: null` and an official
  kind. Do not change catalog to make it pass.
- Stop and ask if `writePrices` cannot be reached without a `RunContext` unless its signature
  changes for the walk. Changing it to take a run id and an optional reporter is in scope.
- Stop and ask before you change `harvester.replicas`, the strategy, or a deploy script.
- Stop and ask before you add El Jamón, Carrefour or DIA to the fetchers. Section 6 says why
  they are out.
- Stop and ask for the rule of step 5 of section 7.1 before you build it. Plan `0215` holds no
  chain wide stop, so "its stop of the chain is in force" needs the owner's reading (for
  example, the newest run of the chain ended with `stopReason: SOURCE_BLOCKED` less than
  `HARVEST_REFRESH_BLOCKED_MINUTES` ago). Build steps 1 to 4 and 6 to 9 meanwhile.
- Do not set `HARVEST_REFRESH_ENABLED` true in either values file. The owner decides that.

### Progress evidence

Report after each of these, with the spec output:

1. The capability, the contracts and the exception.
2. The entity, the migration and the store, with an integration spec on real Postgres.
3. The narrow write method on `SourceIngest`, with the spec that feeds one observation to the
   walk path and to the refresh path and compares the writes.
4. The Redis claims, with specs for each refusal and an integration spec on a real Redis.
5. The two fetchers and the background execution.
6. The gateway routes and the regenerated documents.

## 1. What is being built

| Piece                                            | Where                                                      |
| ------------------------------------------------ | ---------------------------------------------------------- |
| `refreshesOneProduct` on each adapter            | `AdapterCapabilities`, contracts                           |
| `price_refreshes`                                | a harvester entity and migration                           |
| The resolution of an item and a scope to a fetch | `harvest/price-refresh.resolver.ts`                        |
| The chain and product cooldowns                  | `harvest/price-refresh.cooldown.ts`, Redis                 |
| The request, the status and the read             | `harvest/price-refresh.service.ts`, three NATS patterns    |
| One fetcher per adapter that can                 | `harvest/price-refresh.fetchers.ts`, Mercadona and LIDL    |
| One public write method                          | `SourceIngest.writeRefreshedPrices`                        |
| Three routes                                     | `gateway/src/app/catalog/item-refresh.controller.ts`       |
| `PriceNotRefreshableException`                   | `libs/luna-shopper/platform/src/lib/errors`                |
| `HARVEST_REFRESH_ENABLED`, `REDIS_URL`           | the configuration, section 9                               |

## 2. What a refresh is

A refresh is **one fetch of one product of one chain at one fetch scope, and one write of what
it read.** It keeps the meaning backlog `0006` gave the deleted `REFRESH` mode: it updates a price
and never creates anything.

It is not a run, and that is the central choice of this plan. A run row would take
`uq_harvest_run_active`. A walk of Mercadona lasts 10 to 20 minutes and a walk of El Jamón more
than two hours (plan `0206`, context). A refresh as a run would be refused for that whole time,
and a refresh in flight would make a schedule slot `SKIPPED_BUSY` and a person's spawn a 409. A
shopper's one request is not worth either.

So a refresh has its own small table (section 4), its own claims (section 5), and its own
background task. It shares two things with a walk, and only two: the adapter client that fetches,
and the ingest write that stores.

What a refresh does to the source is bounded by section 5, not by the run's token bucket. A walk
in flight and a refresh of the same chain add up: the chain sees the walk's rate plus at most one
request per chain interval. At the default interval that is one request in 30 seconds beside a
walk of 4 a second.

## 3. Which product and which scope

The request names `itemId` and `priceScopeId`. The scope is the one the shopper is looking at:
the `priceScopeId` of the offer the client drew, which carries `observedAt` and `sourceKind`
(`catalog.messages.ts:1152-1155`).

The harvester resolves the pair from its own tables, with no call to core:

1. **The row.** The `source_catalog_entries` row with status `ACTIVE` and this `itemId` that has a
   `source_entry_prices` row at `priceScopeId`. The scope belongs to one chain, so the row is of
   that chain. No such row means the harvester never priced this product at this scope:
   `NOT_HARVESTED`. More than one `ACTIVE` row of the chain bound to the item at that scope means
   a walk would settle between them (`source-ingest.ts`, `settle`), and a refresh fetches one
   product: `AMBIGUOUS`.
2. **The fetch scope.** The scope the price was read at. When the row at `priceScopeId` has
   `copiedFromScopeId`, the fetch scope is that scope. Otherwise it is `priceScopeId`.
3. **The fetch key.** The `externalKey` of the fetch scope, read through
   `CatalogClient.listAllPriceScopes(supermarketId)` (`catalog-client.service.ts:151`). For
   Mercadona it is the warehouse. For LIDL it is the region, and section 6 explains why LIDL
   writes every region it reads.
4. **The copies.** Every other `source_entry_prices` row of the same row whose
   `copiedFromScopeId` is the fetch scope. A refresh rewrites those copies with the value it read,
   as a walk would. It adds no copy target that the row does not already have.

The resolution is the same for the status read (section 7.2) and the request (section 7.1), so
the client is never told "refreshable" for a pair that the request then refuses for a reason the
read did not state.

## 4. The table

`price_refreshes`, in the harvester database:

| Column              | Type                    | Notes                                               |
| ------------------- | ----------------------- | --------------------------------------------------- |
| `id`                | uuid                    | primary key                                         |
| `requestedByUserId` | uuid                    | not null. The shopper.                              |
| `supermarketId`     | uuid                    | not null                                            |
| `sourceId`          | uuid                    | not null. The `supermarket_sources` row.            |
| `entryId`           | uuid                    | not null. The `source_catalog_entries` row.         |
| `itemId`            | uuid                    | not null                                            |
| `priceScopeId`      | uuid                    | not null. The scope the shopper asked about.        |
| `fetchScopeId`      | uuid                    | not null. Section 3, step 2.                        |
| `status`            | `price_refresh_status`  | `PENDING`, `DONE`, `NOT_STOCKED`, `FAILED`, `BLOCKED` |
| `pricesWritten`     | integer                 | default 0. Rows catalog inserted, copies excluded.  |
| `pricesConfirmed`   | integer                 | default 0. Values catalog already held.             |
| `error`             | text                    | null unless `FAILED` or `BLOCKED`                   |
| `requestedAt`       | timestamptz             | default now()                                       |
| `finishedAt`        | timestamptz             | null while `PENDING`                                |

Indexes: `(entryId, fetchScopeId) WHERE status = 'PENDING'`, which the join of section 7.1
reads, `(requestedByUserId, requestedAt)`, and `(supermarketId, requestedAt)`.

A refresh that is refused before a fetch writes no row. The row exists to answer the poll and to
let a person see who fetched what and when. A refusal costs nothing at the source, and recording
it is a write on the path whose purpose is to avoid work (backlog `0006`, section 5).

**The status names what the fetch found, not what the shopper sees.** `DONE` means the source
answered a price and the write went through. The price the shopper sees is still decided on read
by plan `0080`. A refresh that writes an `OFFICIAL_API` row under a protected `ADMIN` row changes
nothing that the shopper sees, and that is correct.

A row that stays `PENDING` for 2 minutes is written `FAILED` with the error "interrupted" by a
60 second timer in the refresh service (a `setInterval` with `unref`, as the reaper in
`harvest-run.service.ts:235-236`). A restart of the pod is the only way to leave one behind.

Rows older than 90 days are deleted by the same timer.

## 5. The cooldowns

Three limits stand between a shopper and a chain. Each answers a different question.

| Limit                | Key                                                    | Default        | Variable                                  |
| -------------------- | ------------------------------------------------------ | -------------- | ----------------------------------------- |
| Per account          | the gateway's `account` bucket, keyed on the user id   | 10 per 10 min  | `ACCOUNT_THROTTLE_LIMITS.priceRefresh`    |
| Per product          | `harvest:refresh:product:<entryId>:<fetchScopeId>`     | 30 minutes     | `HARVEST_REFRESH_PRODUCT_MINUTES`         |
| Per chain            | `harvest:refresh:chain:<supermarketId>`                | 30 seconds     | `HARVEST_REFRESH_CHAIN_SECONDS`           |
| After a 403          | `harvest:refresh:blocked:<supermarketId>`              | 30 minutes     | `HARVEST_REFRESH_BLOCKED_MINUTES`         |

**Per chain, not per platform.** Backlog `0006` capped the whole platform at one fetch per five
minutes and asked in its section 5 whether the cap belonged to each chain. It is per chain here,
because the politeness argument is about one source: a refresh of LIDL costs Mercadona nothing.
A platform cap also gets tighter with each chain added.

**Per product, from two facts.** A price the harvester read at the fetch scope less than
`HARVEST_REFRESH_PRODUCT_MINUTES` ago is answered as `FRESH` with no claim and no fetch. The
`observedAt` of the `source_entry_prices` row says that, and a walk moves it too. The Redis key
covers the case that the stored time cannot: a fetch that failed or found nothing leaves the time
where it was, and without the key every shopper could ask for that product again at the chain
rate.

**The order of the claims** is: the blocked key is read, the product key is read, the chain key
is claimed with `SET NX PX`, then the product key is set. Two shoppers who ask for one product at
one instant both pass the product read, and the chain claim lets one through. The other is refused
with the chain's remaining time. A chain slot is never spent on a product that is still cooling
down.

**No claim is released.** A fetch that fails keeps the chain and the product keys to their end.
Releasing them turns a failing source into a loop of requests (backlog `0006`, section 3).

**A 403 sets the blocked key** for `HARVEST_REFRESH_BLOCKED_MINUTES`. While it stands, every
refresh of the chain is refused with its remaining time. A chain that refuses one product refuses
the next one too (the incident of 2026-09-25 in plan `0215`), so the next shopper is not sent to
find that out again.

**When Redis cannot answer,** the request is refused with a 429 and `retryAfterSeconds: 60`. That
is how the throttler fails (plan `0028`, section 5), and for the same reason: a refresh with no
working cooldown is an open proxy to a third party. Runs do not use Redis and do not notice.

## 6. Which chains can refresh

`AdapterCapabilities` gains `refreshesOneProduct: boolean`. The unknown adapter answers false, as
every other capability does.

| Adapter         | `refreshesOneProduct` | Why                                                               |
| --------------- | --------------------- | ----------------------------------------------------------------- |
| `mercadona-api` | true                  | One JSON request by product id and warehouse, no session.         |
| `lidl-api`      | true                  | One page request by path, no session. A walk reads the same page. |
| `eljamon-web`   | false                 | The page price can differ from the listing price, which a walk writes. A refresh and the next walk would write each other's numbers back and forth. It also needs two session requests first. |
| `carrefour-web` | false                 | The product page parser reads no price, and each fetch launches Chromium (about 1 s and 300 MB). |
| `dia-api`       | false                 | No product read exists in the client. A price needs a session bound to one fulfilment store and a listing page. |
| `deza-web`      | false                 | The site prints no price, and a row has no id and no URL.          |
| others          | false                 | They write no price.                                              |

**The fetchers.** One function per adapter that can, in `price-refresh.fetchers.ts`, each with
the source row's `workers` ignored and one request in flight:

- **Mercadona** builds a `MercadonaClient` for the warehouse of the fetch key, with the
  harvester's user agent and base URL as `mercadona-catalog.runner.ts:109-117` builds one, and
  calls `fetchProduct(externalId, ['es'])`. A product is turned into a `SourceObservation` with
  one price whose `scopeKey` is the warehouse, the way the walk turns a listing row. Null (a 404)
  is `NOT_STOCKED`.
- **LIDL** builds a `LidlListRow` from the stored row: `externalId`, and `path` taken from the
  stored `url` with the base URL removed. The other fields are the stored values or null, because
  `normalizeProduct` reads the prices from the page. Each region price becomes one price with
  `scopeKey` the region id, as `lidl-catalog.runner.ts:261-277` does. A region that has no scope
  yet is dropped with no write, because a refresh creates no scope. Null is `NOT_STOCKED`.

**LIDL writes every region the page names, and Mercadona one warehouse.** Both write what one
request returned and nothing more. A LIDL page returns all regions at once, and dropping the ones
the shopper did not ask about would throw away a price already paid for. A Mercadona request
returns one warehouse.

**A 404 writes no availability.** `NOT_STOCKED` is recorded on the refresh and nothing else is
written. Availability is a scope wide fact that a walk claims with its own writer
(`SourceEntryAvailabilityWriter`, `source-entry-availability.ts:159`), and the next walk decides
it. A refresh that writes availability false from one 404 is a write that a walk would make from
a whole listing.

**A timeout.** The fetch runs under an `AbortSignal` of 20 seconds. A fetch that does not finish
is `FAILED`.

**A 403 or a block error** (`MercadonaHttpError` with status 403, `LidlHttpError` with status 403)
is `BLOCKED`, sets the blocked key of section 5, and is not retried. A 429 or a 5xx is retried by
the client as a walk's request is.

## 7. The NATS surface

Three patterns, in a new `PRICE_REFRESH_PATTERNS` in the contracts. All three take `userId` from
the gateway and no admin credential. `PlatformAdminService`'s comment changes to name these
three subjects as the only ones open to a shopper.

### 7.1 `priceRefresh.request`

Request: `{ userId, itemId, priceScopeId }`. The checks, in this order:

1. `HARVEST_ENABLED` and `HARVEST_REFRESH_ENABLED` are both true, or `REFRESH_OFF`.
2. Section 3 resolves the pair, or `NOT_HARVESTED` or `AMBIGUOUS`.
3. The source row exists and `enabled` is true, or `SOURCE_OFF`.
4. `refreshesOneProduct` of the row's `adapterKey` is true, or `NO_SINGLE_FETCH`.
5. When plan `0215` is built, its stop of the chain is not in force, or `CHAIN_REFUSING`.
6. The fetch scope's price is older than the product window, or the answer is `FRESH`.
7. A `PENDING` refresh of the same `(entryId, fetchScopeId)` exists, and the answer is that
   refresh. The shopper joins it, whoever started it.
8. The claims of section 5, or a 429 with the remaining seconds.
9. A `PENDING` row is inserted, the fetch starts in the background, and the row is answered.

Steps 1 to 5 throw `PriceNotRefreshableException`: a 409 with `details.reason` set to one value
of `PriceRefreshRefusal`. Step 8 throws `RateLimitedException` with `retryAfterSeconds`, the
shape the throttler already answers (`problem-throttler.guard.ts:40-43`), so the client draws one
countdown for both.

Answer: `PriceRefreshView`.

```ts
interface PriceRefreshView {
  /** Null for FRESH, which started nothing. */
  id: string | null;
  itemId: string;
  priceScopeId: string;
  status: PriceRefreshStatus; // FRESH | PENDING | DONE | NOT_STOCKED | FAILED | BLOCKED
  /** The stored observation time at the fetch scope, after the refresh when it is DONE. */
  observedAt: string | null;
  requestedAt: string | null;
  finishedAt: string | null;
}
```

`FRESH` is a status of the view and never of a row.

### 7.2 `priceRefresh.check`

Request: `{ userId, itemId, priceScopeId }`. Runs steps 1 to 7 and reads the keys of step 8
without claiming them. Answer:

```ts
interface PriceRefreshCheckView {
  refreshable: boolean;
  /** Null when refreshable. */
  reason: PriceRefreshRefusal | null;
  /** Seconds until a request can pass the cooldowns. Zero when it can now. */
  retryAfterSeconds: number;
  /** The refresh in flight for this product and scope, if any. */
  pendingRefreshId: string | null;
  observedAt: string | null;
}
```

`FRESH` reads as `refreshable: false` with the reason `FRESH` and the seconds until the product
window ends. The client draws "updated a few minutes ago" from it. It is the read that tells a
client what to show before anybody presses anything, and it is the answer to "what does the
shopper see when a chain has no single fetch": a reason, and the client decides the words.

### 7.3 `priceRefresh.get`

Request: `{ userId, refreshId }`. Answers the `PriceRefreshView` of a refresh that this user
requested or joined. A join is not stored, so the rule is: the user requested it, or the user has
a refresh request answered with it in the last 2 minutes. Keep the second half simple: a Redis key
`harvest:refresh:viewer:<refreshId>:<userId>` with a 2 minute TTL, set on a join. Any other id is
a 404, so a refresh id says nothing about another shopper.

## 8. How the shopper learns the new price

**By polling.** Envoy closes a route at 15 seconds, and a Mercadona request that retries a 429
three times with backoff can come close to that. So the request answers before the fetch, with
the `PENDING` view, and the client asks `GET` for the status every 2 seconds until it is not
`PENDING` or 30 seconds have passed. On `DONE` the client reads the offer again through the read
it already uses (`GET /v1/catalog/items/:id/offers` or the list it drew the price in). The new
`observedAt` and price are there.

A realtime event addressed to the shopper was considered and is not built. The harvester publishes
no domain event today, and the first one would need a subject in `DOMAIN_EVENT_SUBJECTS`
(`realtime.events.ts:361`), an audience, and a client listener, for a wait that is usually under
two seconds. Plan `0038` made the same choice for the admin runs, which poll.

## 9. The configuration

| Variable                           | Default | Where it is set                                                |
| ---------------------------------- | ------- | -------------------------------------------------------------- |
| `HARVEST_REFRESH_ENABLED`          | false   | `app-config.ts`, `.env.example`, ConfigMap, `_env.tpl`, the three values files (`refreshEnabled`), `luna-slot.sh` |
| `HARVEST_REFRESH_CHAIN_SECONDS`    | 30      | `app-config.ts`, `.env.example`                                |
| `HARVEST_REFRESH_PRODUCT_MINUTES`  | 30      | `app-config.ts`, `.env.example`                                |
| `HARVEST_REFRESH_BLOCKED_MINUTES`  | 30      | `app-config.ts`, `.env.example`                                |
| `REDIS_URL`                        | none    | required by the harvester's Joi schema. `_env.tpl` gives it to the harvester role. `luna-slot.sh` already writes it. |

**A fourth switch, because it is a fourth decision.** `HARVEST_ENABLED` decides that a pod may
fetch when a person asks. `HARVEST_SCHEDULER_ENABLED` decides that it may fetch when nobody asks.
`HARVEST_REFRESH_ENABLED` decides that it may fetch when any shopper asks. Each is a different
answer to "who can make this cluster contact a chain". A refresh needs `HARVEST_ENABLED` and its
own switch both, and the row of the chain. It is false in both values files when this plan
merges, and the owner turns it on. The `CLAUDE.md` section on the harvester says "three
switches" and changes to four in this plan.

**`REDIS_URL` is required in the harvester,** as `RedisModule.forRoot` reads it with `getOrThrow`.
The readiness indicators of the harvester do not gain Redis (`app.module.ts:49-65` probes the
database and NATS only). A Redis outage refuses refreshes and nothing else. The comment in
`_env.tpl:57-61` that names two roles changes to name three, with the reason.

## 10. The gateway

A new controller, `ItemRefreshController`, under `catalog/items`, behind `JwtAuthGuard`:

| Route                                           | Pattern                | Answer                        |
| ----------------------------------------------- | ---------------------- | ----------------------------- |
| `GET /v1/catalog/items/:id/refresh?priceScopeId=` | `priceRefresh.check`   | 200, `PriceRefreshCheckView`  |
| `POST /v1/catalog/items/:id/refresh`            | `priceRefresh.request` | 201, `PriceRefreshView`       |
| `GET /v1/catalog/items/:id/refreshes/:refreshId` | `priceRefresh.get`     | 200, `PriceRefreshView`       |

The `POST` body is `{ priceScopeId }`, a uuid. It answers 201 with a contract body, as every POST
in the gateway does. `FRESH` is a 201 too: the request was answered, and the body says nothing was
fetched.

**Registered accounts only.** A `TEMPORARY` account is refused with a 403 on all three routes. A
guest identity costs one request to an anonymous zone route, so a per account limit means little
for guests, and a guest can register. The check reads `CurrentUser.kind` in the controller. The
owner may reverse this (section 16).

**The per account limit** is `ACCOUNT_THROTTLE_LIMITS.priceRefresh = { ttl: minutes(10), limit:
scaleThrottleLimit(10) }` on the `POST` alone, through `AccountThrottlerGuard`. The two reads stay
on the global bucket. Ten in ten minutes is one refresh a minute for ten minutes, more than a
person checks prices by hand, and few enough that a script with a good token spends its bucket
before it spends a chain's.

The `itemId` of the path and the `itemId` of a refresh read by id must match, or the answer is
404.

## 11. A chain that keeps refusing (plan 0215)

Plan `0215` stops a run of a chain that keeps answering 403. This plan does not depend on it, and
it reads 0215's state if 0215 is built first:

- A chain that 0215 holds stopped refuses a refresh with `CHAIN_REFUSING` (section 7.1, step 5).
- A refresh that meets a 403 is `BLOCKED` and sets the blocked key for 30 minutes (section 5).
  It writes nothing to `supermarket_sources.consecutiveFailures` and nothing to 0215's state.
  A refresh is one request, and one refused request is not evidence that a walk will fail. If
  the owner wants a refresh 403 to count toward 0215's stop, that is a change to 0215.
- Plan `0215` lands first and does not add the step 5 check. This plan adds it, with the rule the
  owner confirms (action boundaries).

## 12. What this plan does not do

- **No velista screen.** The control, its countdown, its states and its words need a mock first.
  The follow up is a velista plan with the next free number, written after the owner sees the
  mock. It reads `PriceRefreshCheckView.reason` and draws a sentence for each value.
- **No back office screen.** The rows of `price_refreshes` are readable in the database. A list in
  the admin app is a follow up that also needs a mock.
- **No refresh for El Jamón, Carrefour, DIA or DEZA.** Section 6 gives the reason for each.
- **No availability write on a 404.** Section 6.
- **No new scope, row, item, candidate or copy target.**
- **No realtime event.** Section 8.
- **No queue.** A refused request is refused, not queued (backlog `0006`, section 4).
- **No refresh counted in run estimates, `consecutiveFailures`, schedules or the dashboard.**
- **No alert on a `BLOCKED` refresh.** Plan `0218` owns alerts.

## 13. Tests

- **Capability**: every adapter states `refreshesOneProduct`, and the unknown adapter answers
  false.
- **Resolver**: an `ACTIVE` row with a price at the scope, a copy that resolves to its origin and
  names its sibling copies, no row, a row that is not `ACTIVE`, two `ACTIVE` rows.
- **Write**: one observation through the walk path (`writeChunk` with a run context) and through
  `writeRefreshedPrices` produces the same `source_entry_prices` values and the same
  `catalog.addPrices` batch, except that the refresh sends `sourceRunId: null` and writes
  `runId: null`. A sold by weight row and a price sold another way behave as the walk does. A
  copy is rewritten. A region with no scope is dropped.
- **Cooldown**, with a fake Redis: each key refuses with its remaining seconds, the product key is
  read before the chain claim, a failed fetch keeps both keys, a 403 sets the blocked key, a Redis
  error refuses with 60 seconds.
- **Service**: each refusal of section 7.1 in its order, `FRESH` with no claim and no row, a join
  answers the pending row, the background fetch writes `DONE`, `NOT_STOCKED`, `FAILED` on a
  timeout, `BLOCKED` on a 403, a `PENDING` row older than 2 minutes becomes `FAILED`, `get`
  answers 404 to another user.
- **Fetchers**: Mercadona and LIDL against the fixtures their libraries already commit, with no
  network.
- **Integration, real Postgres and real Redis**: the migration creates the table, the enum and
  the indexes. Two requests for one product at one instant start one fetch. A refresh during a
  `RUNNING` run of the chain starts, and the run's row is untouched.
- **Gateway**: each route reaches its pattern, a `TEMPORARY` account is refused, the eleventh
  `POST` in ten minutes is a 429, and `openapi-document.spec.ts` passes after regeneration.

## 14. Acceptance criteria

- [ ] A registered user refreshes one product at one scope of Mercadona or LIDL, and the price is
      written through the walk's ingest write.
- [ ] A refresh creates no `harvest_runs` row, and a running walk neither blocks it nor is
      blocked by it.
- [ ] A refresh creates no row, item, candidate, scope or copy target.
- [ ] A refreshed price whose row is a copy is fetched at its origin and rewritten at the copies.
- [ ] One chain is fetched at most once per chain interval by refreshes, across every shopper.
- [ ] One product at one fetch scope is fetched at most once per product window.
- [ ] A price observed within the product window answers `FRESH` and fetches nothing.
- [ ] A failed fetch releases no claim.
- [ ] A 403 blocks refreshes of the chain for the blocked window.
- [ ] With Redis down, every refresh is refused with a 429 and every run is unaffected.
- [ ] A chain whose row is off, or whose adapter cannot refresh, is refused with its reason.
- [ ] With `HARVEST_REFRESH_ENABLED` false, nothing is fetched.
- [ ] A `TEMPORARY` account is refused.
- [ ] The request answers before the fetch, and the status route reports the outcome.
- [ ] `openapi.json` and `wire-types.ts` are regenerated.

## 15. Verification

```sh
npx nx test luna-shopper/contracts
npx nx test luna-shopper/platform
npx nx test luna-shopper-backend-harvester
npx nx test luna-shopper-backend-gateway
npx nx run luna-shopper-backend-gateway:openapi
npx nx run luna-shopper-admin/models:wire-types
npx nx build luna-shopper-backend-harvester
npx nx build luna-shopper-backend-gateway
npx nx affected -t lint test
```

`nx test` does not type check. The build lines do.

The integration specs run on an ephemeral Luna slot (`luna-slot.sh --ephemeral --up <n>`), which
has the harvester database and Redis. The agent does not fetch a live storefront. A person, not
the agent, may then check the live path: with `HARVEST_ENABLED`, `HARVEST_REFRESH_ENABLED` and
one row on, a refresh of one Mercadona product against the live site is one request. The person
reads the request count from the log and turns the row off after.

## 16. Decisions

Chosen in this plan, and open to the owner's correction:

- A refresh is not a run, so the one active run index does not touch it (section 2).
- The cooldowns live in Redis in the harvester, which gains `REDIS_URL`, and not in the gateway.
  The harvester is the service that fetches, knows the chain of a product, and holds the per
  chain gate. A claim in the gateway would need a second NATS call to learn the chain first. The
  Postgres claim of backlog `0006` section 3 also works, and was not chosen because Redis now
  exists.
- The chain cooldown is per chain, not per platform (section 5).
- Default numbers: 30 seconds per chain, 30 minutes per product, 30 minutes after a 403, 10
  requests per account in 10 minutes.
- Refused requests are not recorded. Started ones are, for 90 days.
- A refreshed price carries `sourceRunId: null` in catalog. The `price_refreshes` row is the
  record of what wrote it. A refresh id there would read as a run that the back office cannot
  open.
- A 404 writes no availability (section 6).
- LIDL writes every region one page names (section 6).
- The shopper polls, and no realtime event is built (section 8).
- A refresh 403 does not feed plan `0215`'s stop (section 11).

**Owner**: ask, do not choose.

1. May a guest (a `TEMPORARY` account) refresh a price? This plan says no.
2. Are the default numbers of section 5 right? Backlog `0006` had one fetch per five minutes for
   the whole platform, and nothing has measured either.
3. Where is `HARVEST_REFRESH_ENABLED` turned on, and when: staging first, production after the
   velista control ships?
4. Should El Jamón refresh from its product page although a walk writes the listing price, which
   can differ? This plan says no.
5. Should a refresh that meets a 403 count toward plan `0215`'s stop of a chain?
