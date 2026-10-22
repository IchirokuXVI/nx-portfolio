# 0219: a probe per chain checks the storefront shape

> A walk of a chain is the only thing today that finds out a storefront changed. A Mercadona walk
> takes 10 to 20 minutes, an El Jamón walk 157, and the parsers of every adapter answer an empty
> list or a null when the markup or the JSON moves, so a redesign shows up late and looks like a
> run that stored little. This plan adds a **probe**: two to five requests per chain, made from the
> harvester pod, that run the real client and the real parsers over one category list, one listing
> page and one product (and one shop read where the chain names its own shops), and assert that
> the fields the walk depends on are present and plausible. Each probe is a row in a new table
> `source_probes`. A 60 second worker starts one probe per chain per day where
> `HARVEST_SCHEDULER_ENABLED` is true, and an admin can start one by hand on any cluster or luna
> slot. The result is classified as `PASSED`, `SHAPE_CHANGED`, `BLOCKED`, `UNREACHABLE` or `ERROR`,
> and a change of status is marked on the row for plan `0218` to alert on. The shape checks live
> in each adapter library, beside the parsers they test, so the opt in live specs and the probe
> share one definition.
>
> Prerequisite reading: `0206` (the schedule worker, the claim, the switches and the clock token
> this plan copies), `0083` (the per chain row), `0090` sections 5, 11 and 13 (why Carrefour needs
> Chromium and never retries a refusal), `0085` (DEZA prints no price), `0089` (LIDL is a rolling
> window), sibling plans `0215` (a run stops when a chain keeps refusing it) and `0218` (the owner
> hears when a run fails), the files `harvest/catalog-discovery.runner.ts`,
> `harvest/harvest-schedule.worker.ts`, `harvest/harvest-schedule.store.ts`,
> `harvest/run-executor.service.ts`, and the `live-source.spec.ts` of each adapter library.

## Brief for the agent

### Objective

Add a per chain storefront probe to the harvester: a framework free `probe` function in each of
the six chain adapter libraries, a `source_probes` table, a probe service and dispatcher, a daily
probe worker, three NATS patterns and three gateway routes, and the latest probe on
`SupermarketSourceView`, as sections 1 to 11 describe.

### Context

- Six chain adapters exist: `mercadona-api`, `deza-web`, `carrefour-web`, `lidl-api`,
  `eljamon-web`, `dia-api`. `CatalogDiscoveryRunner.runnerFor`
  (`harvester/src/app/harvest/catalog-discovery.runner.ts:73`) dispatches on
  `SupermarketSource.adapterKey`. `osm-places` and `manual` have no catalog walk (:68).
- `SOURCE_ADAPTER_KEYS` excludes `osm-places`, because no source row can switch it
  (`libs/luna-shopper/contracts/src/lib/messages/harvest.messages.ts:325`).
- Five libraries carry an opt in live spec that asserts field names against the live source,
  run only with `LUNA_LIVE_SOURCE_TEST=1`: mercadona, dia, lidl, eljamon and osm-places
  (`libs/luna-shopper/<lib>/src/lib/live-source.spec.ts`). DEZA and Carrefour have none.
- The parsers degrade quietly. `parseSectionTree` answers `[]` when its container is missing
  (`libs/luna-shopper/deza/src/lib/sections.ts:23`). Carrefour's `categoryLinks` answers `[]`
  when `items` is not an array (`libs/luna-shopper/carrefour/src/lib/state.ts:47`). DIA's
  `parseRow` drops a row with no `sku_id` or `display_name` (`libs/luna-shopper/dia/src/lib/listing.ts:44`).
  `MercadonaClient.listCategories` answers `[]` on a null payload
  (`libs/luna-shopper/mercadona/src/lib/mercadona.client.ts:263`). A shape change is thus an
  empty or thin result, not an exception.
- Every adapter's HTTP error carries a numeric `status`: `MercadonaHttpError`
  (`mercadona.client.ts:44`), `DiaHttpError` (`dia.client.ts:50`), `LidlHttpError`
  (`lidl.client.ts:45`), `ElJamonHttpError` (`eljamon.client.ts:45`), `DezaHttpError`
  (`deza.client.ts:32`), `CarrefourHttpError` (`carrefour/src/lib/errors.ts:18`).
- DIA retries a 403 once after `forbiddenRetryMs`, 60 seconds by default, with no option to
  turn the retry off (`dia.client.ts:135` and `:402`).
- **This plan lands after plan `0215`.** That plan rewrites the request loops of all six clients,
  DIA's included: it keeps DIA's one 403 retry after 60 seconds and moves the failure count onto a
  shared guard. It deletes `DiaStoppedError` and `CarrefourBlockedError`, and a client used with
  no guard throws `SourceBlockedError` (`@portfolio/luna-shopper/source-guard`) where those were
  thrown. Read the DIA and Carrefour clients as plan `0215` left them on `dev`.
- Carrefour drives headless Chromium through Playwright, launched lazily in
  `PlaywrightSession.start` (`carrefour.client.ts:391`), one browser per client, about 300 MB
  resident. Every call into the browser has a 90 second deadline (`:122`). Pages are at least
  `CARREFOUR_MIN_DELAY_MS` = 2000 ms apart (`carrefour/src/lib/types.ts:234`). Three refusals in a
  row throw `CarrefourBlockedError` (`carrefour.client.ts:138`), `SourceBlockedError` after plan
  `0215`. Any listing page names the first
  level of the tree, and the walk seeds from `DEFAULT_SEED_PATH` (`:368`). The harvester image
  carries Chromium (`harvester/src/Dockerfile:49`).
- All six libraries already import `@portfolio/luna-shopper/contracts`. The comment in
  `libs/luna-shopper/carrefour/src/index.ts` that says Carrefour does not is out of date.
- A run of a chain holds `uq_harvest_run_active`, one `PENDING` or `RUNNING` run per
  `supermarketId` (`harvester/src/app/db/migrations/1756200000000-InitialHarvesterSchema.ts:109`).
- `RunExecutor.recordVerdict` (`run-executor.service.ts:591`) writes `consecutiveFailures` for
  every run that does not end `ABORTED`. Plan `0206` stops the schedules of a chain at 3.
- `HarvestScheduleWorker` (`harvest/harvest-schedule.worker.ts`) ticks every
  `SCHEDULE_TICK_MS` = 60 000 ms (:22) on a plain `setInterval` with `unref`, reads the clock
  through the `HARVEST_CLOCK` token, does nothing unless `harvestEnabled` and `schedulerEnabled`
  are both true, and claims a row with `FOR UPDATE SKIP LOCKED`
  (`harvest-schedule.store.ts:106`).
- `HarvesterConfig` holds `harvestEnabled`, `schedulerEnabled`, `userAgent` and
  `mercadonaBaseUrl` (`harvester/src/app/config/app-config.ts:154` to `:169`).
- `start` refuses a run for a source whose row is off (`harvest-run.service.ts:346` and `:462`).
- The latest harvester migration is `1759400000000-HarvestSchedules.ts` today. Plans `0215` to
  `0221` each add one, so take the next free timestamp on `dev` at build time.
- The gateway mounts the source routes at `admin/harvest/sources`
  (`gateway/src/app/harvest/harvest.controller.ts:995`). Envoy's default route timeout is 15
  seconds, so a route cannot wait for a Carrefour probe to finish.

### Target state

Every acceptance criterion holds, the specs of the Tests section pass, the opt in live specs of
the six chain libraries call the library's `probe`, and `openapi.json` and the wire types are
regenerated.

### Scope

- Work only in:
  - `libs/luna-shopper/{mercadona,dia,lidl,eljamon,deza,carrefour}/src/`: a `probe.ts` and its
    spec in each, the export from `index.ts`, the live spec of each (rewritten to call `probe`,
    and new for DEZA and Carrefour), and in `dia` the one client option of section 3.6.
  - `libs/luna-shopper/contracts`: the enum, the step and probe views, the patterns, the
    requests, the schemas, and `SupermarketSourceView.lastProbe`.
  - `apps/luna-shopper-backend/harvester/src/app/`: a `SourceProbe` entity, a migration, a probe
    store, a probe service, a probe dispatcher, a probe worker, the controller, the module, the
    source mapper.
  - `apps/luna-shopper-backend/gateway/src/app/harvest/`: the routes and DTOs of section 8.
  - `CLAUDE.md`, section "Luna Shopper backend": one paragraph, section 12.
  - Their specs and the generated files.
- Do NOT touch: the catalog runners, the store discovery runners, the sink, the executor,
  `harvest_runs`, `harvest_schedules`, the schedule worker, `consecutiveFailures`, the Helm chart,
  the values files, `luna-slot.sh`, `apps/luna-shopper-admin`, and `libs/luna-shopper/osm-places`.

### Constraints

- The libraries stay framework free: no Nest, no TypeORM, no database. Each `probe` takes plain
  options and the same seams its client takes (`fetchImpl`, `sleepImpl`, Carrefour's
  `openSession`), so a spec runs it against the committed fixtures with no network and no browser.
- A probe runs the library's real client and real parsers, and asserts on what they return. It
  does not validate a JSON schema. The one raw key list is the Mercadona product step's, which its
  live spec asserts today.
- A probe never retries a 403 or a 429 and makes no request after one.
- A probe writes nothing outside `source_probes`. It never writes a price, an entry, a place,
  availability, `consecutiveFailures`, `lastRunAt` or `lastSuccessAt`.
- The claim of a due probe is one transaction with `FOR UPDATE SKIP LOCKED`. Two harvester
  processes never start two probes of one chain.
- Add no dependency. The worker timer is a `setInterval` with `unref`, like the schedule worker.
- The migration is additive.
- Regenerate `openapi.json` and the wire types, never by hand.
- No dash as punctuation in a comment or a message. Reword the sentence.

### Action boundaries

- Proceed with in scope edits, specs, the migration file and the generators.
- Stop and ask before you run any probe against a live storefront. The opt in live specs are
  run by the owner, not by you.
- Stop and ask before you run the migration anywhere but a throwaway slot.
- Stop and ask if the owner has not answered decision **O1** by the time you write the due query
  and the manual refusal. Until then build option (a) of section 6.
- Do not write a `harvest_alerts` row or call plan `0218`'s code. Plan `0218` has no probe alert,
  and section 10 says why the `changed` column is the whole interface.
- Do not turn a `supermarket_sources` row on in a cluster.

### Progress evidence

Report after each of these, with the spec output:

1. The contracts types and the six library `probe` functions with their fixture specs.
2. The entity, the migration, the store and the claim, with an integration spec on real Postgres.
3. The dispatcher, the service, the classification and the manual routes.
4. The worker, the reaper and the latest probe on the source view.

## 1. What is being built

| Piece                                            | Where                                           |
| ------------------------------------------------ | ----------------------------------------------- |
| `probe<Chain>(options)` per chain                | `libs/luna-shopper/<lib>/src/lib/probe.ts`      |
| `SourceProbeStatus`, `SourceProbeStepView`       | `contracts`, `harvest.enums.ts` and messages    |
| `source_probes`                                  | a harvester entity and migration                |
| The dispatcher on `adapterKey`                   | `harvest/source-probe.runner.ts`                |
| Start, classify, finish, list, read              | `harvest/source-probe.service.ts` and its store |
| The daily worker and the reaper                  | `harvest/source-probe.worker.ts`                |
| Three patterns and three routes                  | contracts, harvester controller, gateway        |
| `SupermarketSourceView.lastProbe`                | the source mapper                               |

**Terms.** A *probe* is one execution of the checks for one chain. A *step* is one read inside a
probe: the category list, one listing page, one product, or the shop list. A *problem* is one
sentence that a step found wrong with what the parser read.

## 2. Why a probe and not a shorter walk

The owner approved a live check per chain on 2026-10-22. Three things decide its shape.

**It runs on the harvester pod.** A chain judges the address it sees. GitHub runners are Azure
addresses, and Mercadona has answered the VPS with 403s that it did not give other addresses. A
check from anywhere else answers a different question. The probe uses the user agent, the base
URL and the rate of the row, so it sees what the next walk would see.

**It runs the real parsers.** Four of the six sources answer HTML or a page state, not a JSON API:
DEZA, El Jamón, Carrefour's `__INITIAL_STATE__` and LIDL's Nuxt payload. A JSON schema has
nothing to check there. And the definition of "the shape the adapter parses" already exists, once,
as the parser. A schema would be a second copy that drifts from it. Since the parsers answer an
empty list or a null on a change (Context), the probe asserts on what they return: a count above a
floor, and required fields present and plausible on most rows.

**It lives in the library.** Each adapter library is the one boundary that knows what its source
looks like (`carrefour/src/index.ts`, `deza.client.ts`). The checks belong beside the parsers, and
the opt in live spec then calls the same function. A developer with no database runs
`LUNA_LIVE_SOURCE_TEST=1 npx nx test luna-shopper/<lib>` and gets the verdict the cluster gets.

## 3. The probe of each chain

### 3.1 What every probe does

```ts
// libs/luna-shopper/contracts, beside the harvest views
export interface SourceProbeStepView {
  /** 'warehouse' | 'categories' | 'listing' | 'product' | 'shops' */
  name: string;
  /** The URL the step read, or null when the client hides it. */
  url: string | null;
  ok: boolean;
  /** The status of a refused or failed response, null when none. */
  httpStatus: number | null;
  /** The message of an exception the step met, null when none. */
  error: string | null;
  /** One sentence per thing the parser read wrong. Empty when ok. */
  problems: string[];
  /** A few parsed values, for a person to read: a count, a name, a price in cents. */
  sample: Record<string, string | number | boolean | null>;
  durationMs: number;
}

export interface SourceProbeResult {
  steps: SourceProbeStepView[];
  /** Requests made, or pages loaded for Carrefour. */
  requests: number;
}
```

Each library exports one function, `probeMercadona`, `probeDia`, `probeLidl`, `probeElJamon`,
`probeDeza` and `probeCarrefour`. Each takes its client's options and answers a
`SourceProbeResult`. It never throws for a source failure. Rules for all six:

- **The steps run in order and the probe stops at the first step that is not ok.** A later step
  reads an id or a path out of an earlier one.
- **A step that throws** records `httpStatus` from the error's `status` when it is a number, and
  `error` from its message, and is not ok.
- **A plausibility rule** is a floor, never an exact value. Prices and the assortment change each
  week. A rule that fails on the source doing its job gets disabled, as each live spec says.
- **The 80 per cent rule.** On a listing step, at least 80 per cent of the rows read carry every
  required field, and at least one row exists. A product with no brand is real. A page where most
  rows lost their brand is a change.
- `sample` carries at most six values per step and never a whole payload.

### 3.2 The request set per chain

| Chain (`adapterKey`) | Steps and their client calls                                                                                                                                                                                       | Requests |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- |
| `mercadona-api`      | warehouse: `resolveWarehouse` (:181). categories: `listCategories` (:263). listing: `listCategoryProducts` of the first child (:275). product: `getProduct` of the first listed id (:293). shops: `listStores` (:225) | 5        |
| `dia-api`            | categories: `menu` (`dia.client.ts:142`). listing: `listing` of the first leaf (:156). shops: `storeFile` (:270, two requests) and `storeDetail` of the first shop (:291)                                         | 5        |
| `lidl-api`           | listing: the search page at offset 0 through `normalizeListPage` (`lidl.client.ts:114`). product: `getProduct` of the first row (:143). shops: one store page of five through `normalizeStorePage` (:204)           | 3        |
| `eljamon-web`        | categories: `topCategories` (`eljamon.client.ts:113`, two requests for the session at :241). listing: page 1 of the first category through `walkCategory` (:138). product: `getProduct` (:198). shops: `listStores` (:108) | 5        |
| `deza-web`           | categories: `fetchSectionTree` (`deza.client.ts:92`). listing: `openQuery` of the first leaf section (:103)                                                                                                        | 2        |
| `carrefour-web`      | listing: `readListing` of the seed path (`carrefour.client.ts:208`, `:368`), which also names the first level. product: `readDetail` of the first card's path (:226)                                               | 2 pages  |

Three chains do not fit "a category list, a listing page and a product", and the probe follows the
walk, not the template:

- **DIA has no product step.** Its walk reads no product page. The listing carries the price.
- **LIDL has no category step.** Its walk pages the in store index and has no tree (`0089`).
- **DEZA has no product step.** A DEZA row has no product page and no URL. Its shops come from the
  rows, so the listing step checks them.
- **Carrefour has no separate category step.** The seed listing names the first level, and a
  third page would cost two more seconds and a third chance of a refusal.

The shop step exists for the chains whose store discovery reads the chain itself: Mercadona, DIA,
LIDL and El Jamón. Plans `0222` and `0223` add shop discovery for DEZA and Carrefour, and neither
adds a probe step. A shop step for those two probes is a follow up once this plan and the plan of
that chain are both on `dev`. This plan does not add it.

### 3.3 What each step asserts

| Chain     | Step       | Asserts                                                                                                    |
| --------- | ---------- | ---------------------------------------------------------------------------------------------------------- |
| Mercadona | warehouse  | a non empty string for postal code `14013`, the code the live spec uses                                  |
| Mercadona | categories | at least 10 roots and at least 50 children (26 and 151 on the day the client was written, `:262`)       |
| Mercadona | listing    | the 80 per cent rule over id, name and a unit price above zero                                           |
| Mercadona | product    | the raw payload carries `id`, `ean`, `brand`, `display_name` and `price_instructions` with its five keys, as the live spec asserts, and `normalizeProduct` (`normalize.ts:113`) answers a product |
| Mercadona | shops      | at least 100 shops, each with a finite latitude and longitude                                            |
| DIA       | categories | at least 20 leaves, each with `id`, `name` and `path`                                                    |
| DIA       | listing    | the 80 per cent rule over `skuId`, `displayName` and `prices.price` above zero                           |
| DIA       | shops      | at least 100 shops with `idTienda`, latitude and longitude, and the detail names `storeCode` and `postalCode` |
| LIDL      | listing    | `total` above zero and the 80 per cent rule over `externalId` and `path`                                 |
| LIDL      | product    | a product with an `ean` and at least one region price                                                     |
| LIDL      | shops      | every shop on the page names an offer region                                                              |
| El Jamón  | categories | at least 5 categories with `code`, `slug` and `path`                                                     |
| El Jamón  | listing    | the 80 per cent rule over `code`, `description`, `url` and a price above zero                            |
| El Jamón  | product    | a product with `code`, `name`, `price` and a non empty `categoryPath`                                    |
| El Jamón  | shops      | at least one shop with `externalRef`, `postalCode` and a latitude                                        |
| DEZA      | categories | at least 5 sections                                                                                       |
| DEZA      | listing    | the 80 per cent rule over `name` and at least one shop code. Nothing about a price, which DEZA never prints |
| Carrefour | listing    | at least 5 first level categories, and the 80 per cent rule over the cards read by `readCards`: `externalId`, `name`, `path` and `priceCents` above zero |
| Carrefour | product    | a detail whose `externalId` is the card's and whose `ean` is present                                      |

The floors are constants in each `probe.ts`, each with a comment that names the count it was set
against. They are not settings.

### 3.4 Pacing

The probe uses the client's own pacing and the row's rate, never faster than a walk:

- `acquire` is a `TokenBucket` (`harvester/src/app/runner/token-bucket.ts`) at the row's
  `maxRequestsPerSecond`, as a run uses.
- `minIntervalMs` is 1000 for every client that takes it. A probe is not in a hurry.
- Carrefour keeps its own 2000 ms floor.

### 3.5 Carrefour and Chromium

`probeCarrefour` builds one `CarrefourClient`, reads two pages, and calls `close()` in a
`finally`, as the runner does (`carrefour-catalog.runner.ts:140`). A probe that never opened a page
still closes, because `close` is idempotent (`carrefour.client.ts:201`).

- The cost is one Chromium launch, about a second and about 300 MB, held for the 5 to 10 seconds
  of two pages 2 seconds apart.
- The worker runs one probe at a time in a process (section 7), so probes never hold two browsers.
- A Carrefour probe is not started while a Carrefour run is in flight (section 6), so a probe
  never adds a browser beside a walk's for the same chain. A probe beside another chain's walk is
  allowed.
- A launch that fails, or a deadline that passes, is `CarrefourBrowserError`, and section 5 maps
  it to `ERROR`, not to `SHAPE_CHANGED`. A broken browser in our image is our fault, not a
  redesign.
- A 403 on the first page is one refusal, not three, so the client throws `CarrefourHttpError`
  with status 403 and the probe stops there.

On a developer machine the probe needs Playwright's Chromium, as the `capture-fixtures` target of
the Carrefour library already does.

### 3.6 DIA's 403 retry

`DiaClient` waits 60 seconds and retries a 403 once (`dia.client.ts:402`). That is a retry the
probe must not make. Add `retryForbidden?: boolean` to `DiaClientOptions`, default `true`, so
every existing caller behaves as today, and `probeDia` passes `false`. Plan `0215` rewrites this
request loop and keeps the retry, so add the option to the loop as plan `0215` left it. With the
option false, a 403 goes straight to the guard's count and throws `DiaHttpError` with status 403.

## 4. The table

```sql
CREATE TYPE "source_probe_status" AS ENUM (
  'RUNNING', 'PASSED', 'SHAPE_CHANGED', 'BLOCKED', 'UNREACHABLE', 'ERROR', 'ABORTED'
);

CREATE TABLE "source_probes" (
  "id"                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "createdAt"         timestamptz NOT NULL DEFAULT now(),
  "updatedAt"         timestamptz NOT NULL DEFAULT now(),
  "sourceId"          uuid NOT NULL,
  "supermarketId"     uuid NOT NULL,
  "adapterKey"        varchar NOT NULL,
  "trigger"           "harvest_run_trigger" NOT NULL,
  "status"            "source_probe_status" NOT NULL DEFAULT 'RUNNING',
  "previousStatus"    "source_probe_status" NULL,
  "changed"           boolean NOT NULL DEFAULT false,
  "startedAt"         timestamptz NOT NULL,
  "finishedAt"        timestamptz NULL,
  "requests"          integer NOT NULL DEFAULT 0,
  "steps"             jsonb NOT NULL DEFAULT '[]'::jsonb,
  "error"             text NULL,
  "requestedByUserId" uuid NULL
);

CREATE INDEX "ix_source_probes_source_started" ON "source_probes" ("sourceId", "startedAt" DESC);
CREATE UNIQUE INDEX "uq_source_probe_running"
  ON "source_probes" ("sourceId") WHERE "status" = 'RUNNING';
```

- `trigger` reuses `harvest_run_trigger`. A probe is `MANUAL` or `SCHEDULED`, never `SYSTEM`.
- `sourceId` has no foreign key, as `harvest_runs.sourceId` has none. Deleting a source row leaves
  its probes.
- `uq_source_probe_running` is the backstop for a manual start racing the worker.
- `previousStatus` is the status of the newest finished probe of the same source that is not
  `ABORTED`, read when this probe finishes. `changed` is true when the two differ and
  `previousStatus` is not null. The first probe of a chain is never a change.

### 4.1 Why a table and not a run

A run of a new mode `PROBE` was the other way. It is not taken, for four reasons:

1. **The chain lock.** A run holds `uq_harvest_run_active`. A daily probe would make a person's
   walk answer `ActiveRunExistsError` for the seconds it runs, and make a scheduled slot
   `SKIPPED_BUSY`.
2. **The failure counter.** `recordVerdict` writes `consecutiveFailures` for every run that does
   not end `ABORTED`. Three red probes would stop every schedule of the chain. Whether a red probe
   holds a walk back is an owner question (**O3**), and it is not answered by an accident of the
   run table.
3. **Nothing of a run applies.** A probe has no sink, no counters, no price scope, no report, no
   revert and no export.
4. **The run list.** Six probes a day is 2,190 rows a year among the runs a person reads.

A field on `supermarket_sources` was the third way. It keeps one result and loses the history,
and a probe that turns red every other day can only be read from its history.

### 4.2 Retention

The worker deletes probes older than 90 days, once per day, and always keeps the newest probe of
each source. A probe row is about 2 KB, so a year of daily probes of six chains is under 5 MB.

## 5. The verdict

The first step that is not ok decides the status, in this order:

| The step                                                                         | Status          |
| -------------------------------------------------------------------------------- | --------------- |
| `httpStatus` is 403 or 429, or the error is `SourceBlockedError` (plan `0215`)   | `BLOCKED`       |
| `httpStatus` is 500 or more, or the error is a network error or a timeout       | `UNREACHABLE`   |
| `httpStatus` is 404 or 410                                                       | `SHAPE_CHANGED` |
| `problems` is not empty, with no exception                                       | `SHAPE_CHANGED` |
| any other exception, `CarrefourBrowserError` among them                          | `ERROR`         |

Every step ok is `PASSED`. A probe stopped by a shutdown is `ABORTED`.

A 404 on a path the probe has to read is a moved URL, which is a change of the shape the walk
uses. Some clients throw it with its status, and the table catches that. Others answer null on a
404, as Mercadona's `getJson` does (`mercadona.client.ts:263` and `:293`), and the step then sees
an empty result and reports a problem. Both end `SHAPE_CHANGED`.

`error` on the row is one sentence that names the step and the first problem, for example
`listing: 2 of 40 rows carried a price above zero`. The steps hold the rest.

## 6. When a probe may start

A probe of a source starts only when all of these hold. The worker skips a source that fails one,
and a manual start answers the refusal in the right column.

| Condition                                                       | Manual refusal                           |
| --------------------------------------------------------------- | ---------------------------------------- |
| `HARVEST_ENABLED` is true                                       | `ValidationException`, the spawn's text  |
| the source row exists                                           | `NotFoundException`                      |
| `adapterKey` is one of the six chains of section 3.2            | `ValidationException`, names the adapter |
| the source row is on (option (a) of **O1**)                     | `ValidationException`, the spawn's text  |
| no run of the chain is `PENDING` or `RUNNING`                   | `ConflictException`                      |
| no probe of the source is `RUNNING`                             | `ConflictException`                      |

**A run in flight is the live check already.** It reads the same pages at the same rate from the
same address, and a probe beside it adds requests and tells nothing new.

**O1, the row that is off.** Plan `0083` made the row the switch that says the cluster fetches from
the chain. A probe is two to five requests, but it is still a fetch. The three options:

- (a) A probe runs only for a row that is on, scheduled and manual. The row keeps one meaning.
- (b) A person can probe a row that is off, and the worker probes only rows that are on.
- (c) Both probe every row.

The brief builds (a) until the owner answers. Each option is one predicate in the due query and
one in the manual check.

## 7. The worker

`SourceProbeWorker` copies the lifecycle of `HarvestScheduleWorker`: a timer in `onModuleInit`,
cleared in `onModuleDestroy`, a `stopping` flag in `onApplicationShutdown`, the clock from
`HARVEST_CLOCK`, and one tick at a time in a process.

- **The interval is 60 seconds**, a constant in the worker, as `SCHEDULE_TICK_MS` is.
- **A tick does nothing unless `HARVEST_ENABLED` and `HARVEST_SCHEDULER_ENABLED` are both true.**
  A probe the worker starts is a fetch nobody asked for, which is what the third switch decides.
  It is true in production only, so staging and every luna slot probe only by hand.
- **A source is due** when section 6 allows it and its newest probe started more than 24 hours
  ago, or it has none. The 24 hours is a constant, `PROBE_INTERVAL_MS`.
- **A tick starts at most one probe.** After a deploy all six chains are due, and the worker
  spreads them one per minute instead of six at once.
- **The claim**, one transaction: select one due source with `FOR UPDATE SKIP LOCKED` on its
  `supermarket_sources` row, oldest newest probe first, insert the `RUNNING` probe row with
  `trigger: SCHEDULED`, commit. A second process skips the locked row, and once the first commits
  the new row makes the source not due. The tick then runs the probe and waits for it.
- **The reaper.** Each tick first marks `ABORTED` every `RUNNING` probe whose `startedAt` is more
  than 10 minutes old. A probe lives in the memory of the process that started it, and a pod
  killed during one leaves the row `RUNNING`. Ten minutes is twice the deadline of section 9.
- **The retention** of section 4.2 runs in the first tick after midnight UTC.
- The worker never throws out of a tick. An error is logged.

The worker does not read `harvest_schedules`. A probe is not a preset and starts no run, so the
schedule rows of plan `0206` do not fit it. The worker reuses that plan's machinery: the switch,
the clock token, the poll and the claim.

## 8. The routes

| Route                                                       | Pattern               | Answers                                   |
| ----------------------------------------------------------- | --------------------- | ----------------------------------------- |
| `POST /v1/admin/harvest/sources/:supermarketId/probes`      | `sourceProbe.start`   | 201, the `SourceProbeView`, `RUNNING`     |
| `GET /v1/admin/harvest/sources/:supermarketId/probes`       | `sourceProbe.list`    | 200, newest first, `limit` 1 to 100, 20 by default |
| `GET /v1/admin/harvest/probes/:id`                          | `sourceProbe.get`     | 200, the `SourceProbeView`                |

All three require an admin, through `PlatformAdminService.requireAdmin`, as every harvest pattern
does.

**The start answers before the probe ends.** A Carrefour probe takes up to about 15 seconds with
the browser launch, which is Envoy's default route timeout. The service inserts the row, starts the
probe without awaiting it, and answers the row. The client reads `GET /probes/:id` until `status`
is not `RUNNING`. The service keeps the probes in flight in a map, as the executor keeps runs,
so `onApplicationShutdown` aborts them.

```ts
export interface SourceProbeView {
  id: string;
  sourceId: string;
  supermarketId: string;
  adapterKey: AdapterKey;
  trigger: HarvestRunTrigger;
  status: SourceProbeStatus;
  previousStatus: SourceProbeStatus | null;
  changed: boolean;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  requests: number;
  steps: SourceProbeStepView[];
  error: string | null;
  requestedByUserId: string | null;
}
```

`SupermarketSourceView` gains `lastProbe: { id, status, startedAt, finishedAt, changed } | null`,
the newest probe of the source that is not `ABORTED`. The source list reads it with one
`DISTINCT ON ("sourceId")` query over the index of section 4, not one query per row. It is not
required in the schema, as `presetId` is not, so the typed fixtures of the back office stay valid.

## 9. Limits of one probe

- A probe has an `AbortController` with a 5 minute deadline. A Mercadona probe at 1 request per
  second is 5 to 10 seconds. The deadline is for a source that hangs.
- A probe never changes the row it reads. It reads `enabled`, `adapterKey`, `config` and
  `maxRequestsPerSecond` once, at its start.
- The base URL comes from the row's `config`, as each runner reads it (`readBaseUrl` in
  `carrefour-catalog.runner.ts:318`, `baseUrl` in `dia-catalog.runner.ts:351`), and from
  `mercadonaBaseUrl` for Mercadona. A slot that points a chain at a local recording thus probes
  the recording.

## 10. How it joins the sibling plans

- **Plan `0218`, alerts.** A finished probe with `changed: true` is the event. A change to any
  status but `PASSED` is "the chain stopped answering as the walk expects", and a change back to
  `PASSED` is the recovery. This plan sends nothing. Plan `0218` as written alerts on runs and
  schedule slots only, and has no entry point for a probe. The `changed` column is thus the whole
  interface, and a probe alert is a follow up to `0218` once the owner answers **O4**. A red probe
  that stays red does not repeat the alert each day, because `changed` is false the second time.
- **Plan `0215`, a run stops when a chain keeps refusing it.** A probe meets at most one refusal
  and stops at it, so it needs no stop of its own. `BLOCKED` is the early sign of what `0215`
  stops a walk for. A probe writes nothing that `0215` reads, and reads nothing that `0215` writes.
  Whether a `BLOCKED` probe holds back the next walk is **O3**.
- **Plan `0206`, schedules.** A probe changes no schedule and no `consecutiveFailures`.
- **Plans `0222` and `0223`** add shop discovery for DEZA and Carrefour and no probe step. A shop
  step for those two probes is a follow up (section 3.2).
- **Plan `0220`, delisted products.** A walk that ran against a changed storefront lists less than
  the chain sells. Whether `0220` refuses to mark products gone while the chain's latest probe is
  not `PASSED` is that plan's decision. `lastProbe` on the source gives it the fact.

## 11. A probe by hand on a luna slot

On a slot the scheduler is off, so a probe starts only by hand:

1. Set `HARVEST_ENABLED=true` in the harvester's `.env` of the slot and restart it with
   `luna-slot.sh --restart --services harvester`.
2. Turn the chain's source row on (option (a) of **O1**).
3. Sign in as an admin and `POST /v1/admin/harvest/sources/<supermarketId>/probes` through the
   slot's gateway, then read `GET /v1/admin/harvest/probes/<id>`.

With no database at all, `LUNA_LIVE_SOURCE_TEST=1 npx nx test luna-shopper/<lib>` runs the same
`probe` function and fails with its problems. That is the check for a developer who edits a parser.

## 12. The documentation

Add one paragraph to the harvester part of `CLAUDE.md`, after the three switches: a probe per
chain reads two to five pages a day in production, it obeys the row and the switches as a scheduled
run does, it writes only `source_probes`, and its checks live in each library's `probe.ts`, so a
parser change updates the probe in the same file set.

## 13. What this plan does not do

- **No back office screen.** The follow up is an admin plan, the next free number in
  `apps/luna-shopper-admin/plans/`: "a source shows its latest probe". It shows `lastProbe` on the
  sources list, the steps of a probe, and a button that starts one. It needs a mock first.
- **No alert delivery.** Plan `0218` owns it.
- **No gate on a walk.** A red probe does not stop a scheduled or manual walk. That is **O3**.
- **No probe of OpenStreetMap.** It has no source row to hang a probe on, it is volunteer funded,
  and the postal code queue reads it every day and fails visibly when it changes. Its live spec
  stays as it is.
- **No probe from GitHub Actions.** The runner's address is not the one the chains judge, and the
  scheduler stays in the harvester.
- **No fixture refresh.** A red probe tells a person to run the library's `capture-fixtures` and
  read the diff. The probe never writes a fixture.
- **No per chain cadence.** One constant interval for every chain.
- **No probe of the price of a known product.** A price moves, so it cannot be asserted, and the
  walk already writes it.

## Tests

- **Each library, `probe.spec.ts`**, with a fake fetch (or Carrefour's fake `openSession`) over
  the committed fixtures:
  - the fixtures pass every step, with the request count of section 3.2,
  - a fixture with the required field renamed is not ok at that step, names the field in
    `problems`, and makes no later request,
  - a 403 on the first step is not ok, carries `httpStatus: 403`, and makes no second request,
  - a listing where most rows lost a required field fails the 80 per cent rule, and one where a
    few did passes,
  - `probeDia` passes `retryForbidden: false`, and the client then makes no second request after
    a 403. Existing DIA client specs pass unchanged,
  - `probeCarrefour` closes the client when a step throws.
- **Each library, `live-source.spec.ts`** calls `probe` and asserts every step is ok. It stays
  skipped without `LUNA_LIVE_SOURCE_TEST=1`. DEZA and Carrefour gain one.
- **Verdict**: each row of the table of section 5, and the order when two apply.
- **Service**: a manual start refuses each case of section 6, answers `RUNNING` before the probe
  ends, and writes `trigger: MANUAL` and the user. `previousStatus` and `changed` for a first
  probe, a repeat, a change and a recovery, with `ABORTED` probes skipped. A probe writes nothing
  to `supermarket_sources`.
- **Worker**, with a clock passed in and no real timer: both switches off start nothing, a source
  probed 23 hours ago is not due and one probed 25 hours ago is, one probe per tick, a source with
  a run in flight is skipped, a source whose row is off is skipped, the reaper marks a 15 minute
  old `RUNNING` probe `ABORTED`, an error inside a tick does not stop the next tick.
- **Integration, on real Postgres**: two workers on one database claim the same due source and
  one probe row is written. A second manual start while one is `RUNNING` answers a conflict. The
  migration creates the type, the table and both indexes. Retention keeps the newest probe of a
  source older than 90 days.
- **Gateway**: each route reaches its pattern, and `openapi-document.spec.ts` passes after
  regeneration.

## Acceptance criteria

- [ ] Each of the six chain libraries exports a `probe` function that runs its real client and
      parsers and answers a `SourceProbeResult`.
- [ ] Each library's live spec calls that function. DEZA and Carrefour have a live spec.
- [ ] A probe makes no request after a 403 or a 429, and DIA's probe does not wait to retry one.
- [ ] A probe writes only `source_probes`.
- [ ] A probe is classified `PASSED`, `SHAPE_CHANGED`, `BLOCKED`, `UNREACHABLE`, `ERROR` or
      `ABORTED` by the rules of section 5.
- [ ] With both switches on, each enabled chain is probed once per 24 hours, one probe per tick.
- [ ] With `HARVEST_SCHEDULER_ENABLED` false, no probe starts by itself.
- [ ] No probe starts while a run of the same chain is in flight.
- [ ] Two harvester processes on one database start one probe for one due source.
- [ ] An admin starts a probe through the gateway and gets 201 before the probe ends.
- [ ] `changed` is true exactly when the status differs from the previous finished probe that is
      not `ABORTED`.
- [ ] `SupermarketSourceView.lastProbe` carries the newest probe that is not `ABORTED`.
- [ ] No run, schedule or `consecutiveFailures` changes because of a probe.
- [ ] `openapi.json` and `wire-types.ts` are regenerated.

## Verification

```sh
npx nx test luna-shopper/contracts
npx nx test luna-shopper/mercadona
npx nx test luna-shopper/dia
npx nx test luna-shopper/lidl
npx nx test luna-shopper/eljamon
npx nx test luna-shopper/deza
npx nx test luna-shopper/carrefour
npx nx test luna-shopper-backend-harvester
npx nx run luna-shopper-backend-harvester:test-integration
npx nx test luna-shopper-backend-gateway
npx nx run luna-shopper-backend-gateway:openapi
npx nx run luna-shopper-admin/models:wire-types
npx nx build luna-shopper-backend-harvester
npx nx affected -t lint test
```

`nx test` does not type check. The build line does. The integration target needs a Postgres from
an ephemeral luna slot. The owner, not the agent, runs `LUNA_LIVE_SOURCE_TEST=1` against the live
sources after the merge.

## Decisions

Chosen in this plan, and open to the owner's correction:

- The probe is a row in `source_probes`, not a run of a new mode and not a field on the source
  row (section 4.1).
- The checks run the real parsers and assert counts and required fields. No JSON schema
  (section 2).
- The checks live in each adapter library and the live specs call them (section 2).
- The request set follows each walk: five for Mercadona, DIA and El Jamón, three for LIDL, two
  for DEZA, two pages for Carrefour (section 3.2). About 22 requests a day for all six chains,
  against 4,383 for one Mercadona walk.
- The 80 per cent rule and floors well under today's counts (section 3.3).
- Mercadona's warehouse is read for postal code `14013`, the code its live spec uses, so the probe
  needs no price scope from catalog.
- Scheduled probes need both `HARVEST_ENABLED` and `HARVEST_SCHEDULER_ENABLED`, so only production
  probes by itself (section 7).
- Once per 24 hours per chain, one probe per tick (section 7).
- A run of the chain in flight skips the probe (section 6).
- A browser failure is `ERROR`, not `SHAPE_CHANGED` (section 5).
- Probes are kept 90 days, and the newest of each source always (section 4.2).
- OpenStreetMap gets no probe (section 13).
- DIA gains `retryForbidden`, default true (section 3.6).

**Owner**, to answer before the build reaches section 6:

- **O1.** Does a probe run for a chain whose row is off: (a) never, (b) only when a person starts
  it, or (c) always? The brief builds (a) until you answer.
- **O2.** Is once a day the right cadence, and does staging also probe by itself? Staging is a
  different VPS and a different address, so its probe answers a different question about blocks,
  but the third switch is off there by your decision on plan `0206`.
- **O3.** Does a probe that is not `PASSED` hold back the chain's next scheduled walk, as a new
  schedule outcome? This plan does not build it. A yes is a follow up to plan `0206`.
- **O4.** Which statuses alert through plan `0218`: every change, or only `SHAPE_CHANGED` and
  `BLOCKED`? `UNREACHABLE` for one day is often the chain's own outage.
