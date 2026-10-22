# 0215: a run stops when a chain keeps refusing it

> Four of the six storefront clients treat a 403 as the failure of one product and go on at full
> rate. Mercadona, LIDL, El Jamón and DEZA thus spend the rest of their queue on a chain that has
> stopped answering. On 2026-09-25 a Mercadona walk sent about 1,800 requests into a five minute
> block, failed 1,764 of 4,249 items and ended `FAILED`. A daily schedule (plan `0206`) repeats
> that until the third failure. DIA and Carrefour already stop, in two different ways, and both
> lose part of what they read when they do.
>
> This plan adds one guard per run, shared by every worker and every client of the run. A run of
> refusals trips it. The run then pauses, waits out one cool down, sends one probe, and either
> goes on or stops. A stopped run keeps everything it read, ends `FAILED` with a new
> `stopReason: SOURCE_BLOCKED`, and says in plain words what happened. Plan `0218` reads that
> reason for its alerts.
>
> Prerequisite reading: `0038` sections 6.3 and 6.6 (the shared token bucket, and "everything
> observed before the abort is kept"), `0090` sections 4 and 13 (the Carrefour block), `0174`
> section 10 (the DIA stop), `0119` (`details: NEW`), `0206` sections 6 and 7 (the three failure
> rule, and the retry of an interrupted run), `run-executor.service.ts`, `run-context.ts`,
> `runner/worker-pool.ts`, `runner/token-bucket.ts`, and the six `*.client.ts` files named in the
> context below.

## Brief for the agent

### Objective

Build the per run refusal guard of sections 2 to 5 as a new framework free library, wire it into
all six storefront clients and the harvester run path, make a stopped run keep what it read, and
record the stop as `FAILED` with `stopReason: SOURCE_BLOCKED`, as sections 1 to 9 describe.

### Context

All paths are under `D:\Projects\nx-portfolio\.claude\worktrees\harvester-plans` (or your own
checkout of `dev`). Harvester paths are relative to `apps/luna-shopper-backend/harvester/src/app/`.

**The clients.**

- `libs/luna-shopper/mercadona/src/lib/mercadona.client.ts`: `RETRYABLE_STATUSES` is 429 and 5xx
  (:88). Both request paths, the static `request` used by `resolveWarehouse` and `listStores`
  (:105 to :141) and the instance `getJson` (:377 to :407), throw `MercadonaHttpError` at once on
  any other status, a 403 included (:135, :398). A 404 is a value (:128, :391).
- `libs/luna-shopper/lidl/src/lib/lidl.client.ts`: the same shape. `request` (:241 to :280)
  retries 429 and 5xx (:55) and throws `LidlHttpError` on a 403 (:270).
- `libs/luna-shopper/eljamon/src/lib/eljamon.client.ts`: `request` (:311 to :368) also retries a
  request with no answer (:350 to :356), and throws `ElJamonHttpError` on a 403 (:363).
- `libs/luna-shopper/deza/src/lib/deza.client.ts`: `request` (:195 to :237) throws
  `DezaHttpError` on a 403 (:228). The runner builds one client per query (`deza-catalog.runner.ts`
  :198 to :201), so any counter kept inside a DEZA client starts at zero on each query.
- `libs/luna-shopper/dia/src/lib/dia.client.ts`: a 403 is retried once after
  `forbiddenRetryMs` = 60 s (:135, :402 to :406). A 429, a 5xx or a request with no answer is
  retried with backoff of 30, 60 and 120 s (:134, :382 to :392, :407 to :411). Every request that
  still fails goes through `failed()` (:417 to :424). The fifth in a row (:138) makes the client
  throw `DiaStoppedError` (:83 to :94) on that call and on every call after it (:345 to :347).
  Any 2xx or 3xx resets the count (:394 to :395).
- `libs/luna-shopper/carrefour/src/lib/carrefour.client.ts`: a 403 or a 429 is never retried
  (:313 to :321). The third in a row (`CONSECUTIVE_REFUSALS`, :138) throws
  `CarrefourBlockedError` (`errors.ts`:36 to :48). A 200, a 404 or a 5xx resets the count
  (:309 to :310, :324). `isSkippable` (`errors.ts`:74 to :76) is how a caller tells the block
  from a refused page.
- The counters of DIA and Carrefour live in one client instance. Mercadona builds one client per
  warehouse (`mercadona-catalog.runner.ts`:109 to :118) and DEZA one per query, so neither shape
  could share a count across a run.

**The run path.**

- `runner/worker-pool.ts`: a worker that throws hands the error to `onError` and takes the next
  item (:71 to :77). The pool stops taking items once the signal is aborted (:59 to :62). Nothing
  else stops it.
- `runner/token-bucket.ts`: one bucket per run, built by the executor (`run-executor.service.ts`
  :337 to :341). `RunContext.acquire` is the one function every client awaits before a request
  (`run-context.ts`:37).
- `harvest/mercadona-catalog.runner.ts`: with `details: NEW`, the known products are reported from
  the listing **before** the detail pool starts (:211 to :226). The pool's `onError` counts one
  `failed` and logs the error (:300 to :308). A product whose detail failed is not reported. The
  negative availability and `assortmentComplete` are written only when the run was not aborted
  (:328 to :342).
- `harvest/lidl-catalog.runner.ts`:90 and `harvest/eljamon-catalog.runner.ts`:127 call
  `context.signal.throwIfAborted()` before they report any product, and
  `harvest/carrefour-catalog.runner.ts`:87 does it once per category. An abort of those runs thus
  throws away every product they read.
- `harvest/dia-catalog.runner.ts`:84 to :96 catches `DiaStoppedError`, writes the report, and
  throws again. DIA reports its products only after the whole walk (:98 onward), so a stopped DIA
  run reports none.
- `harvest/carrefour-catalog.runner.ts`:96 to :103 and :130 to :136 catch the block, report the
  products, write the report, and then throw. `harvest/carrefour-detail.runner.ts`:148 throws
  when `isSkippable` is false.
- `harvest/run-executor.service.ts`: the sink is drained only on the success branch (:509 to
  :543). The catch branch (:560 to :575) flushes the counters and finishes the run, and never
  drains. `RunReportSink.product` pushes a chunk only at 400 products (`run-report.sink.ts`:329 to
  :336). **So a run that throws loses every product it reported after its last full chunk**, and
  the Carrefour comment "the run ends FAILED and keeps every product it read" is only true up to
  that chunk. Each pushed chunk is written at once (`source-ingest.ts`:1774 to :1780).
- The status of a finished run is `ABORTED` when the signal is aborted, else the ratio verdict
  (:546 to :548). The verdict fails a run above `failureRatio` (:620 to :631), which is
  `HARVEST_FAILURE_RATIO`, default 0.25 (`config/app-config.ts`:83). The catch branch writes
  `describeError(error).message` as the `error` (:569).
- `recordVerdict` (:591 to :602) leaves an `ABORTED` run out and calls
  `recordRunFinished(source, status === COMPLETED)` for every other one.
  `supermarket-source.service.ts`:229 to :240 resets `consecutiveFailures` on success and adds one
  otherwise. Three or more make a schedule skip with `SKIPPED_FAILING`
  (`harvest-run.service.ts`:88 and :349). The first run that completes clears it.
- `HarvestRunView.interrupted` (`libs/luna-shopper/contracts/src/lib/messages/harvest.messages.ts`
  :597 onward) is true only for `ABORTED` with no `abortRequestedAt`, or `STALE`. Only an
  interrupted scheduled run is started again (plan `0206`, section 7). A `FAILED` run is not.
- `HarvestRunStatus` (`libs/luna-shopper/contracts/src/lib/enums/harvest.enums.ts`:112 to :119)
  is a Postgres enum on `harvest_runs.status` (`entities/harvest-run.entity.ts`:52 to :58).
  `harvest_runs.error` is free text (:154 to :155). `harvest_runs.report` is free form jsonb.
- The stale reaper marks a `RUNNING` run whose heartbeat is older than `HARVEST_STALE_AFTER`,
  default 900 s (`config/app-config.ts`:81). `RunContext.heartbeat` writes at most once per 10 s
  (`run-context.ts`:16, :86 to :90).
- The latest harvester migration is `1759400000000-HarvestSchedules.ts`. Migrations are listed in
  `db/migrations/index.ts`.
- The production incident, read from the pod log on 2026-09-25 (run `26770beb`): a Mercadona
  catalog discovery at 6 workers and 6 requests per second got a 403 on every
  `/api/products/<id>/?wh=4661` from 16 s into the `DETAIL` stage for about five minutes, then 200
  again. Later walks at 4/4 and 8/8 ran clean. It was a block of the address, not a rate limit
  that a slower run avoids.
- **Sibling plans that land after this one.** Plan `0218` reads `stopReason` for its alerts and
  adds an alert draft to `HarvestRunStore.finish` after the argument this plan adds. Plan `0219`
  adds a `retryForbidden` option to the DIA request loop that this plan rewrites. Plans `0222` and
  `0223` add store discovery runners for DEZA and Carrefour that pass `context.guard` to their
  client. Plan `0216` reads this plan's stop for its refresh check. Build this plan first.

### Target state

Every acceptance criterion holds, the specs of the Tests section pass, `npx nx build
luna-shopper-backend-harvester` succeeds, and `openapi.json` and the wire types are regenerated.

### Scope

- Work only in:
  - A new library `libs/luna-shopper/source-guard` (project `luna-shopper/source-guard`, alias
    `@portfolio/luna-shopper/source-guard`), made with the `@nx/js:library` generator, and its
    entry in `tsconfig.base.json`.
  - The six clients and their specs: `libs/luna-shopper/{mercadona,lidl,eljamon,deza,dia,carrefour}/src/lib/*.client.ts`,
    `carrefour/src/lib/errors.ts`, and the `index.ts` of `dia` and `carrefour`.
  - In the harvester: `runner/worker-pool.ts`, `harvest/run-context.ts`,
    `harvest/run-executor.service.ts`, a new `harvest/refusal-policy.ts`, the six catalog runners,
    `carrefour-detail.runner.ts`, the store discovery runners that build one of the six clients
    (`mercadona-store-discovery.runner.ts`, `lidl-store-discovery.runner.ts`,
    `eljamon-store-discovery.runner.ts`, `dia-store-discovery.runner.ts`, and
    `deza-store-discovery.runner.ts` or `carrefour-store-discovery.runner.ts` if plan `0222` or
    `0223` is already on `dev`),
    `harvest/harvest-run.store.ts`, `harvest/harvest.mappers.ts`, the run entity, one migration and
    `db/migrations/index.ts`.
  - `libs/luna-shopper/contracts`: the two enums of section 9, `HarvestRunView.stopReason`, and
    the run view schema.
  - Their specs, and the generated `openapi.json` and `wire-types.ts`.
- Do NOT touch: the token bucket, the sink, the ingest, the schedule worker and service, the
  stale reaper, `supermarket-source.service.ts`, the OpenStreetMap and Nominatim clients, the
  fixture capture tools, `apps/luna-shopper-admin` and `libs/luna-shopper-admin` (except the
  generated `wire-types.ts`), the Helm chart and every `.env`.

### Constraints

- The guard aborts the run's signal, and the success branch of `RunExecutor.execute` turns any
  aborted signal into `ABORTED` (`run-executor.service.ts:546`). Check the guard's stop before
  that test, so a run the guard stopped ends `FAILED` with `stopReason: SOURCE_BLOCKED`, and a
  person's abort still ends `ABORTED`. A spec pins both outcomes.
- `@portfolio/luna-shopper/source-guard` imports nothing: no Nest, no TypeORM, no other
  `@portfolio` library, no Node module. It takes its clock and its sleep as options.
- A client used without a guard behaves exactly as it does today, with two exceptions that keep
  today's behaviour: DIA and Carrefour build their own guard from their own policy when none is
  passed (section 4).
- The guard is one object per run. Never one per client, per warehouse or per query.
- No new environment variable and no new `supermarket_sources` column. The policy of each adapter
  is a constant (section 3).
- A stopped run never claims a complete assortment and never writes a negative availability that
  the abort path would not write.
- The migration is additive.
- Never provoke a block to capture a fixture. The guard reads the status and never the body of a
  refusal, so a spec answers a synthesized `403` beside the committed `200` fixtures.
- Regenerate `openapi.json` and the wire types, never by hand.
- No dash as punctuation in a comment or a message. Reword the sentence.

### Action boundaries

- Proceed with in scope edits, the new library, specs, the migration file and the generators.
- Stop and ask before you change a number of section 3.
- Stop and ask before you change how `recordRunFinished` counts a stopped run (section 7).
- Stop and ask if a runner cannot report what it read on a stop without changing the sink or the
  ingest.
- Stop and ask before you run the migration anywhere but a throwaway slot.
- Do not start a run against a live storefront to test this. The specs use fakes and fixtures.

### Progress evidence

Report after each of these, with the spec output:

1. The library: the guard, the error and their specs with a fake clock.
2. The six clients with a guard option, and one fixture based spec file each.
3. The executor, the context and the pool: a stopped run drains, ends `FAILED` with
   `stopReason`, and writes its report block.
4. The runners: each keeps what it read on a stop, and on an abort.
5. The contracts, the migration, the regenerated `openapi.json` and `wire-types.ts`.

## 1. What is being built

| Piece                                          | Where                                               |
| ---------------------------------------------- | --------------------------------------------------- |
| `SourceGuard`, `SourceBlockedError`, policies  | `libs/luna-shopper/source-guard`                     |
| Each client reports its answers to the guard   | the six `*.client.ts`                               |
| The policy of each adapter                     | a constant per adapter, chosen in `refusal-policy.ts` |
| One guard per run, inside `acquire`            | `run-context.ts`, `run-executor.service.ts`         |
| A stop takes the abort path and keeps the data | the executor and the runners                        |
| `stopReason` on a run                          | `harvest_runs`, `HarvestRunView`, two enums         |
| `DiaStoppedError` and `CarrefourBlockedError` go | both libraries and their runners                  |

## 2. Which refusal is one product and which is a block

A 403 arrives with no label. The design does not guess from one answer. It reads what surrounds
it.

**A refusal** is an answer that says the chain will not serve this client:

- a 403, from every adapter,
- a 429 that is still a 429 after the client's own retries (Mercadona, LIDL, El Jamón, DEZA and
  DIA retry a 429 before they give up, Carrefour never retries one),
- for DIA only, any request that still fails after DIA's own retries, a request with no answer
  included. Plan `0174` section 10 measured the DIA block as refused connections, not as a status,
  and that is what `failed()` counts today.

**Every other answer clears the count**: a 2xx, a 3xx that DIA reads, and a 404. A 5xx that
outlived its retries, and a request with no answer at all, leave the count as it was for the five
adapters other than DIA. They say nothing either way about a block.

**A block** is either of these, over the answers of the whole run in the order they arrive, from
any worker and any client:

- **The consecutive rule.** `consecutive` refusals with no clearing answer between them.
- **The window rule.** Of the last `window.size` answers, `window.refusals` or more were
  refusals. It catches an edge that refuses one request in two, which never makes five in a row.

**What each adapter has shown so far.**

| Adapter       | Seen as one product                                             | Seen as a block                                 |
| ------------- | --------------------------------------------------------------- | ----------------------------------------------- |
| `mercadona-api` | never. "Not stocked here" is a 404 (`mercadona.client.ts`:288 to :292) | 2026-09-25, every detail for five minutes |
| `carrefour-web` | "an occasional page with hundreds of clean loads either side" (`carrefour-detail.runner.ts`:140 to :146) | plan `0090` section 4, after the Cloudflare cookies are kept |
| `dia-api`     | not seen                                                          | Akamai, refused connections, plan `0174` section 10 |
| `lidl-api`, `eljamon-web`, `deza-web` | not seen                                  | not seen                                         |

A refusal that does not trip the guard is an **isolated refusal**. It costs that one item, as a
403 does today: the client throws its own `*HttpError`, the runner counts one `failed`, and the
item is fetched again by the next run. The run's report names the first 50 of them (section 6.3),
so a product that is refused on every run shows up by its URL.

## 3. The policy of each adapter

```ts
export interface RefusalPolicy {
  /** Refusals in a row that trip the guard. */
  consecutive: number;
  /** The window rule, or null for none. */
  window: { size: number; refusals: number } | null;
  /** How many times a run may pause before a trip stops it: 0 or 1. */
  coolDowns: 0 | 1;
  /** How long a pause lasts. */
  coolDownMs: number;
  /** How many probes, one at a time, may be refused after a pause before the run stops. */
  probes: number;
}
```

| Adapter                                 | consecutive | window   | coolDowns | coolDownMs | probes |
| --------------------------------------- | ----------- | -------- | --------- | ---------- | ------ |
| `mercadona-api`, `lidl-api`, `eljamon-web`, `deza-web` | 5 | 20 of 50 | 1 | 600,000 (10 min) | 3 |
| `dia-api`                               | 5           | none     | 0         | 0          | 0      |
| `carrefour-web`                         | 3           | none     | 0         | 0          | 0      |

Each adapter library exports its own constant (`MERCADONA_REFUSAL_POLICY` and so on), beside its
client, because the numbers are a fact about that storefront. `harvest/refusal-policy.ts` maps an
`adapterKey` to one of them. An adapter with no policy (OpenStreetMap, a file import) gets no
guard, and its run behaves as today.

**Why these numbers.**

- **Five in a row** is the DIA number, and nothing in production has refused a lone product five
  times in a row. At 6 requests per second the 2026-09-25 block made five refusals in under one
  second.
- **20 of 50** trips on an edge that refuses 40 percent of the time and never on one isolated
  refusal in a healthy run.
- **Ten minutes** is twice the one block measured. A five minute pause risks a probe at the last
  second of a five minute block. The stale reaper allows 15 minutes, and section 5 keeps the
  heartbeat moving through the pause.
- **One pause per run.** A second block in the same run is the chain saying no twice. Stopping
  costs one rerun, and with `details: NEW` the rerun fetches only what is missing (section 7).
- **Three probes.** The first request after the pause may be a product that is genuinely
  refused. Three in a row refused is not that.
- **DIA and Carrefour keep their numbers and get no pause.** DIA already waits 60 s on every 403
  and 30 to 120 s on every other failure before it counts one. Carrefour treats a retry as what
  "turns a refusal into a deeper block" (`errors.ts`:9 to :10). Both move onto the shared guard for
  the outcome of section 6, and keep the detection they have today. The owner may want them to
  pause too (Decisions, Owner).

## 4. The guard

`libs/luna-shopper/source-guard/src/lib/source-guard.ts`:

```ts
export class SourceGuard {
  constructor(policy: RefusalPolicy, options?: SourceGuardOptions);
  /** Awaited before every request. Waits through a pause, lets one probe at a time through
   *  after it, and rejects with SourceBlockedError once the run is stopped. */
  admit(signal?: AbortSignal): Promise<void>;
  /** A clearing answer (section 2). */
  answered(): void;
  /** A refusal. Answers 'retry' when the request is to be sent again once `admit` lets it,
   *  'fail' when it is an isolated refusal. Throws SourceBlockedError when this refusal stops
   *  the run. */
  refused(status: number, url: string): 'retry' | 'fail';
  /** Null until the run stops. */
  readonly stop: SourceStop | null;
  /** What the run's report states (section 6.3). */
  summary(): SourceGuardSummary;
}

export interface SourceGuardOptions {
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** Called on a trip, on a resume and on a stop. The harvester writes the stage, a warning
   *  and the abort from these. */
  onTrip?: (trip: SourceTrip) => void;
  onResume?: () => void;
  onStop?: (stop: SourceStop) => void;
  /** Called about every 30 s while a pause lasts, so the run keeps its heartbeat. */
  onWait?: () => void;
}

export class SourceBlockedError extends Error {
  constructor(readonly stop: SourceStop);
}
```

**The states.**

1. **Open.** `admit` resolves at once. `refused` counts. Below the threshold it answers `'fail'`.
2. **Paused.** The refusal that trips the guard calls `onTrip`. With a pause left, the guard
   enters the pause, and that refusal answers `'retry'`. Every `admit` now waits. A request already
   in flight that comes back refused also answers `'retry'` and is not counted. A request in
   flight that comes back clean is counted as an answer and does not end the pause.
3. **Probing.** After `coolDownMs`, `admit` lets **one** waiter through. The others keep waiting.
   A clean answer to the probe calls `onResume`, clears every count, and opens the guard. A
   refused probe answers `'fail'` for that one request and lets the next waiter through as the
   next probe. The `probes`th refused probe stops the run.
4. **Stopped.** A trip with no pause left, or the last refused probe, sets `stop`, calls
   `onStop`, makes that `refused` call throw `SourceBlockedError`, and rejects every waiting and
   every later `admit` with it. Nothing is sent after a stop.

An abort of `signal` while `admit` waits rejects that wait with the signal's reason, so a person's
abort and a shutdown are as fast during a pause as at any other time.

**What a block costs now.** At most `consecutive` refusals, plus the requests already in flight
(at most the worker count), plus `probes`. For the 2026-09-25 run: about 16 requests and a ten
minute wait, then the walk goes on. Today: about 1,800.

**Each client.** The change in each request loop is the same few lines:

```ts
// before the request, where `acquire` is awaited today: nothing changes, because the run's
// `acquire` already awaits the guard (section 5).
if (isRefusal(response.status, attempt)) {
  if (this.guard?.refused(response.status, url) === 'retry' && !retriedAfterPause) {
    retriedAfterPause = true;
    continue; // back to the gate, which waits out the pause
  }
  throw new MercadonaHttpError(response.status, url);
}
if (clears(response.status)) {
  this.guard?.answered();
}
```

- Mercadona, LIDL, El Jamón and DEZA take `guard?: SourceGuard` in their options, as they take
  `acquire` today. Mercadona's static `request` takes it through `ResolveWarehouseOptions` and
  `ListStoresOptions`. With no guard, nothing changes.
- DIA replaces `consecutiveFailures`, `stopped` and `failed()` with the guard: `failed()` calls
  `refused`, a 2xx or 3xx calls `answered`. Its per request 403 retry after 60 s stays as it is.
  With no guard passed, it builds one from `DIA_REFUSAL_POLICY`, so the capture tool and the
  client specs keep the stop.
- Carrefour replaces `refusals` and `CONSECUTIVE_REFUSALS` with the guard the same way, and builds
  its own from `CARREFOUR_REFUSAL_POLICY` when none is passed. A refused page still throws
  `CarrefourHttpError`. `isSkippable` answers false for `SourceBlockedError`.
- `DiaStoppedError` and `CarrefourBlockedError` are deleted, with their exports. Every runner that
  named them names `SourceBlockedError` (the grep is in the context).

## 5. One guard per run

`RunExecutor.execute` builds the guard beside the bucket, from
`refusalPolicyOf(source?.adapterKey)`, and hands it to the `RunContext`:

- `RunContext.acquire` becomes `await guard.admit(signal)` and then `await bucket.acquire()`. Every
  client of the run already awaits `acquire`, so every worker stops at the gate during a pause
  with no change in the runners. The bucket is not touched.
- `RunContext.guard` is exposed, and each runner passes it to the clients it builds, beside
  `acquire`.
- `onTrip` writes a `SOURCE_PAUSED` warning and sets the stage to `PAUSED` with a label such as
  "The chain refused 5 requests in a row. Waiting 10 minutes before trying one more." The context
  remembers the stage and label it last set, and `onResume` puts them back and writes a
  `SOURCE_RESUMED` warning.
- `onWait` calls `context.heartbeat()`, so a ten minute pause never reaches the 15 minute reaper.
- `onStop` records the stop and aborts the run's own `AbortController`.

**The pool.** `runWorkerPool` treats a `SourceBlockedError` like the abort it comes with: the item
counts neither as processed nor as failed, `onError` is not called for it, and the result gains
`stopped: boolean`. Without this, every worker waiting at the gate would count one more `failed`
and log one more line on the stop.

## 6. What a stopped run is

### 6.1 It takes the abort path

The stop aborts the run's signal. That is a choice with a reason: **every runner already knows
what not to claim after an abort.** Mercadona writes no negative availability and no
`assortmentComplete` (`mercadona-catalog.runner.ts`:328), DIA states only positives for a scope it
did not finish (`dia-catalog.runner.ts`:745 onward), DEZA states availability only for the
products it saw. A second flag beside the signal would have to be added to each of those checks,
and one forgotten check writes "not stocked" for a product nobody asked about.

The abort path has to keep what it read for that to hold. Today four runners lose it (context).
This plan fixes them for both causes:

- `lidl-catalog.runner.ts`:90 and `carrefour-catalog.runner.ts`:87: break out of the loop on an
  aborted signal instead of throwing, then report what was read, as the loop end does today.
- `eljamon-catalog.runner.ts`:127: report every listed row as today and then return. A product
  whose page was not read is reported with `DETAIL_FAILED_KEY`, as a failed page is today
  (`eljamon-catalog.runner.ts`:291 to :297), and is read again by the next `NEW` walk.
- `dia-catalog.runner.ts`:84 to :96: on `SourceBlockedError`, go on to report the products, as an
  aborted walk does. The scopes that did not finish state positives only.
- `carrefour-catalog.runner.ts`:130 to :136 and `carrefour-detail.runner.ts`:148: return after
  the report instead of throwing.
- Mercadona and DEZA already return on an abort. A stop during the Mercadona listing walk
  reports nothing, because the products are reported only after the walk. That is 151 requests
  per warehouse, and the rerun repeats them.

**The executor drains on an abort too.** When the runner throws and the run's signal is aborted,
the catch branch drains the sink before it finishes the run, the same `sink.drain()` and
`setReport` the success branch does. This is the backstop for any runner that still throws after
an abort. A runner that throws with no abort keeps today's catch branch.

### 6.2 Its status and its reason

| How the run ended              | `status`  | `stopReason`     | `error`                          |
| ------------------------------ | --------- | ---------------- | -------------------------------- |
| The guard stopped it           | `FAILED`  | `SOURCE_BLOCKED` | the sentence below               |
| A person or a shutdown aborted | `ABORTED` | null             | as today                         |
| Over the failure ratio         | `FAILED`  | null             | as today                         |
| Anything else threw            | `FAILED`  | null             | as today                         |

**Why `FAILED` and a reason, and not a new status.** Every reader of `status` today, the schedule
rule, `interrupted`, the run filters and the screens of the back office, treats a stopped run
correctly as a failure that is not an interruption. A new status value would need a branch in
each of them, and a reader that missed one would treat a block as success or as a deploy. The
reason is additive: a reader that does not know it sees the failure it saw before. `interrupted`
stays false for it, so plan `0206`'s retry never restarts a run into a block.

The sentence, for example:

> Stopped: the chain refused 5 requests in a row at 14:03 and still refused 3 probes after a 10
> minute pause. The 2,140 products read before are kept.

DIA and Carrefour, with no pause, say "and the run does not pause for this chain" in place of the
probe half. The shutdown sentence of plan `0206` still wins over it, as it wins over any other.

A stop wins over the ratio verdict: a stopped run is `FAILED` with its reason even when its
failed share is under 0.25.

### 6.3 Its report

The executor merges one block into `harvest_runs.report` for every run that had a guard, stopped
or not:

```json
"refusals": {
  "isolated": 2,
  "isolatedUrls": ["https://tienda.mercadona.es/api/products/12345/?lang=es&wh=4661"],
  "paused": { "at": "2026-09-25T14:03:11Z", "consecutive": 5, "resumedAt": null },
  "probesRefused": 3,
  "stoppedAt": "2026-09-25T14:13:14Z",
  "lastStatus": 403,
  "lastUrl": "https://tienda.mercadona.es/api/products/67890/?lang=es&wh=4661"
}
```

`isolatedUrls` holds the first 50. The block is absent for a run with no guard, and `paused` and
`stoppedAt` are null when they did not happen. The report stays free form, as
`HarvestRunView.report` says it is. Nothing decides on it. Plan `0218` decides on `stopReason`.

## 7. The three failure rule and a rerun

**A stopped run counts as one failure of the source.** It is `FAILED`, so `recordVerdict` adds one
to `consecutiveFailures`, and nothing in `supermarket-source.service.ts` changes. That is the
back off plan `0206` already built: a chain that blocks three scheduled walks in a row stops being
asked until a person starts a run that completes. Each of those three walks now costs about
sixteen refused requests and not four thousand.

**A rerun with `details: NEW` fetches only the remainder** (plan `0119`):

- Mercadona reports every known product from the listing before the detail pool (context). A
  product whose detail was never fetched has no row, or a row with no EAN, and both are "not
  known", so the next `NEW` walk fetches exactly those.
- El Jamón reports every listed row on a stop, and a row whose page was not read carries
  `DETAIL_FAILED_KEY`, which `knownIds` does not count as known.
- LIDL, DEZA, DIA and the Carrefour crawl have no `NEW` choice. A rerun repeats the run, and what
  the stopped run wrote stays written.
- The Carrefour detail backfill picks the rows with no EAN, so it resumes by itself.

A rerun is a person's act, or the next slot of a schedule. This plan starts nothing by itself.

## 8. What the owner sees

- The run page shows `FAILED` and the `error` sentence, which it already renders. No screen
  change is needed for a person to read why a run stopped.
- The warnings list shows `SOURCE_PAUSED` and `SOURCE_RESUMED` with their sentences, and the stage
  reads `PAUSED` while a pause lasts.
- `HarvestRunView.stopReason` is in the contract for the back office and for plan `0218`. A badge
  or a filter on it is a back office follow up, and it needs a mock first.

## 9. The contracts and the table

- `harvest.enums.ts` gains:

  ```ts
  /** Why a run that ended FAILED stopped before its work was done (plan 0215). */
  export enum HarvestRunStopReason {
    /** The chain refused requests until the run's guard stopped it. */
    SOURCE_BLOCKED = 'SOURCE_BLOCKED',
  }
  ```

  and `HarvestWarningCode` gains `SOURCE_PAUSED` and `SOURCE_RESUMED`.
- `HarvestRunView.stopReason: HarvestRunStopReason | null`. Not required in the schema, as
  `interrupted` is not, so the back office's typed fixtures stay valid.
- `harvest_runs."stopReason"`: a nullable Postgres enum column `harvest_run_stop_reason`, in one
  additive migration. Take the next free timestamp on `dev` at build time: plans `0216` to `0221`
  each add a harvester migration, so do not assume that `1759500000000` is free.
  `HarvestRunStore.finish` takes it as a fourth optional argument, after `error`:
  `finish(runId, status, error?, stopReason?)`. Plan `0218` adds its alert draft as a fifth. The
  mapper and the dashboard's run mapping carry it.
- Regenerate `openapi.json` and `wire-types.ts`.

## 10. What this plan does not do

- It does not slow a run down or change its rate after a block. Self adjusting rate limits are
  not wanted now (owner, 2026-10-22).
- It does not resume a stopped run, and it does not start a rerun by itself.
- It does not alert anybody. Plan `0218` reads `stopReason`.
- It does not touch the OpenStreetMap, Overpass or Nominatim clients. A radius search is a few
  requests and has never been blocked.
- It does not add a policy column to `supermarket_sources`. A per chain number that an owner turns
  is a later plan if a policy constant ever needs one.
- It does not design a back office screen.
- It does not change what counts as a failed item for the ratio. An isolated refusal is still one
  `failed`.

## Tests

- **`source-guard.spec.ts`**, with a fake clock and a fake sleep:
  - four refusals then a clean answer then four refusals never trip, and both runs of four are
    `'fail'`,
  - the fifth refusal in a row trips, answers `'retry'`, and calls `onTrip`,
  - 20 refusals among 50 answers with no five in a row trip by the window rule,
  - during a pause every `admit` waits, and a refused answer of a request in flight is `'retry'`
    and not counted,
  - after the pause exactly one `admit` resolves until that probe answers,
  - a clean probe opens the guard, clears the counts and calls `onResume`,
  - three refused probes stop the run, the third `refused` throws `SourceBlockedError`, every
    waiting `admit` rejects with it, and a later `admit` rejects at once,
  - a second trip in a run with `coolDowns: 1` already spent stops at once,
  - `coolDowns: 0` stops on the first trip,
  - an aborted signal releases a waiting `admit` with the signal's reason,
  - `onWait` is called during a pause,
  - `summary()` names the first 50 isolated URLs and no more.
- **One client spec per adapter**, each against its committed `200` fixtures and a synthesized
  `403`:
  - `mercadona.client.spec.ts`: `getProduct` with `product-detail-es.json` and a run of 403 trips a
    passed guard. After a fake pause, a probe answered from the fixture opens it and the request
    that tripped is sent again once. `resolveWarehouse` reports to a passed guard. With no guard, a
    403 throws `MercadonaHttpError` as today.
  - `lidl.client.spec.ts`: the same with `search-page.json` and `product-single-price.json`. A 429
    counts as a refusal only after its retries.
  - `eljamon.client.spec.ts`: the same with `category-page-1.html` and `product.html`. A request
    with no answer after its retries does not count.
  - `deza.client.spec.ts`: two clients built on one guard, as the runner builds one per query,
    share the count with `search-one-page.html`.
  - `dia.client.spec.ts`: the existing "five in a row stop the client" spec passes against the
    guard with no guard passed, and now expects `SourceBlockedError`. The 403 retry after 60 s
    spec is unchanged.
  - `carrefour.client.spec.ts`: the existing third refusal spec with `listing-page.json` expects
    `SourceBlockedError`, and `isSkippable` is false for it.
- **`worker-pool.spec.ts`**: a `SourceBlockedError` counts neither processed nor failed, calls no
  `onError`, and the result says `stopped`.
- **Executor**, with fake runners:
  - a guard stop ends the run `FAILED` with `stopReason: SOURCE_BLOCKED`, the stop sentence, the
    `refusals` block, and a drained sink,
  - a runner that throws after the stop still has its reported products drained,
  - a person's abort during a pause ends `ABORTED` with no `stopReason`,
  - a shutdown during a pause has the shutdown sentence,
  - a stopped run adds one to `consecutiveFailures`, and `interrupted` is false for it,
  - a stopped run under the ratio is still `FAILED`.
- **Runners**, each with its existing fake site and a guard that stops partway:
  - Mercadona: known products are written, no negative availability and no `assortmentComplete`
    when the stop came in the listing walk, and the negatives are written when it came in the
    detail phase after a whole listing walk.
  - LIDL, El Jamón, Carrefour: the products read before the stop are reported, and the same holds
    for a person's abort.
  - DIA: the products of the scopes walked are reported, and an unfinished scope states no
    negative.
  - DEZA: availability is stated only for products the crawl saw.
- **Migration**: the column and the type exist after it, and its `down` removes both.
- **Gateway**: `openapi-document.spec.ts` passes after regeneration.

## Acceptance criteria

- [ ] `@portfolio/luna-shopper/source-guard` exists and imports nothing.
- [ ] One guard is built per run and shared by every client and every worker of the run.
- [ ] Five refusals in a row, or 20 in 50 answers, pause a Mercadona, LIDL, El Jamón or DEZA run.
- [ ] During a pause no request is sent, and the run's heartbeat keeps moving.
- [ ] After the pause one probe at a time is sent, a clean probe resumes the run, and three
      refused probes stop it.
- [ ] A second trip in one run stops it without a second pause.
- [ ] DIA stops on the fifth failure in a row and Carrefour on the third refusal in a row, as
      today, through the same guard.
- [ ] `DiaStoppedError` and `CarrefourBlockedError` no longer exist.
- [ ] An isolated refusal costs one item and nothing else.
- [ ] A stopped run ends `FAILED` with `stopReason: SOURCE_BLOCKED` and a readable `error`.
- [ ] A stopped run keeps every product it reported, including the last partial chunk.
- [ ] A stopped run writes no negative availability that an aborted run would not write.
- [ ] LIDL, El Jamón and Carrefour keep what they read on a person's abort as well.
- [ ] A stopped run adds one to `consecutiveFailures` and is not `interrupted`.
- [ ] A client used without a guard behaves as today.
- [ ] `openapi.json` and `wire-types.ts` are regenerated.

## Verification

```sh
npx nx test luna-shopper/source-guard
npx nx test luna-shopper/mercadona
npx nx test luna-shopper/lidl
npx nx test luna-shopper/eljamon
npx nx test luna-shopper/deza
npx nx test luna-shopper/dia
npx nx test luna-shopper/carrefour
npx nx test luna-shopper/contracts
npx nx test luna-shopper-backend-harvester
npx nx run luna-shopper-backend-gateway:openapi
npx nx run luna-shopper-admin/models:wire-types
npx nx test luna-shopper-backend-gateway
npx nx build luna-shopper-backend-harvester
npx nx affected -t lint test
```

`nx test` does not type check. The build line is the one that does.

**On a slot, with no storefront.** Run the migration on an ephemeral Luna slot
(`bash k8s/e2e/luna-shopper-backend/luna-slot.sh --ephemeral --up <n>`), point the harvester's
`MERCADONA_BASE_URL` (`config/app-config.ts`:120, a variable that exists today) at a local stub that answers the committed fixtures and then a 403 for
every product for two minutes, set `HARVEST_ENABLED=true` for that slot only, and start a
`CATALOG_DISCOVERY` with a policy constant shortened in a local build. Read the run: the stage
goes to `PAUSED`, the probe after the pause resumes it, and a second stub phase of steady 403
stops it with `stopReason: SOURCE_BLOCKED`. Then `--ephemeral --down <n>`. Never point a slot at a
real storefront for this.

## Decisions

Chosen in this plan, and open to the owner's correction:

- One guard per run in a new framework free library, and not a counter per client. A count per
  client cannot see a block across Mercadona's warehouses or DEZA's queries, and the pool cannot
  see a status.
- The guard sits inside `RunContext.acquire`, so every worker stops at the gate during a pause
  with no change in the pool's loop.
- Refusals are a 403, a 429 after the client's retries, and for DIA any failure after its retries.
  Every other answer clears the count.
- Five in a row, or 20 in 50, then one pause of ten minutes, three probes, and a stop. One pause
  per run.
- DIA and Carrefour move onto the guard and keep their numbers and their "no pause".
- A stop takes the abort path, so no runner needs a second check before it claims completeness.
  The runners that lost their data on an abort are fixed for both causes.
- The executor drains the sink when a runner throws after an abort.
- `FAILED` with `stopReason: SOURCE_BLOCKED`, and not a new status.
- An isolated refusal still counts one `failed`, and the report names the first 50.
- The policies are constants in each adapter library, not columns and not variables.

**Owner** (ask, do not choose):

1. **Does a stop count as one failure for the three failure rule?** This plan counts it, which
   stops the schedules of a chain after three blocked walks. The other answers are "a stop
   suspends the chain's schedules at once" and "a stop does not count, because the chain and not
   the run was at fault".
2. **Do DIA and Carrefour get the pause too?** This plan keeps their stop at once, because their
   own notes say a retry deepens the block. A pause of ten minutes and one probe is milder than
   the retry those notes describe.
3. **Is ten minutes the pause you want?** It is twice the one block measured. A longer pause makes
   a scheduled walk end later, and a shorter one risks a probe inside the block.
