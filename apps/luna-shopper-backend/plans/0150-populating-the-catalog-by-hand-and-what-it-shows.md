# 0150: populating the catalog by hand, and what it shows

> **An operational plan. It writes no code and no tests.** Its product is a populated local
> Luna slot that the developer keeps, and a report under `D:\Projects\catalog-report\`. A
> defect found on the way is recorded there, not fixed.
>
> Prerequisite reading: `0038` sections 6.5 and 8.1 (a manual price, and why a crawl is
> polite), `0080` and `0117` (every price side by side, decided on read), `0083` (a chain is
> switched on by a row), `0086` (one source product), `0106` and `0108` (Mercadona shops and
> warehouses), `0107` (the postal code queue), `0116` (scope kinds), `0118` to `0120` (walks,
> copies, writes, presets, each with a "Verification" section worth copying), `0098` to `0100`
> (the curation toolchain), and `libs/luna-shopper/tools/leaflet/cli/src/README.md`.

The harvester never ran for real outside a crawl on the developer's machine. Before it
runs in production, somebody has to drive the whole path the way an operator does: turn a
chain on, let postal codes find shops, walk a catalog, read a leaflet, curate what arrived,
accept shops, type prices, and then shop from the result as a user. This plan is that walk.
It is run by one lead session in three parts, and the middle part is handed to a second agent
with a fresh context, so that the shopper side is judged by somebody who did not build the
data.

## Brief for the agent

### Objective

Populate a dedicated local Luna slot with a real catalog through the backend API only, check
that shops, price scopes and prices come out as the design says, shop from that catalog as an
ordinary user, re-run the harvest over manually edited prices, and write down everything
observed. Leave the slot's data in place for the developer.

### Context

- **Everything goes through the gateway.** Admin routes live under `/v1/admin/**`. Log in with
  `POST /v1/admin/auth/login`. On a slot, `luna-slot.sh` turns on dev autologin for `dev-admin`
  (password `dev-admin-password`), and the token lasts 15 minutes, so renew it with
  `POST /v1/admin/auth/refresh` or log in again. Shopper routes use a user token from
  `POST /v1/auth/register` and `POST /v1/auth/login`. Read request shapes from
  `apps/luna-shopper-backend/gateway/docs/openapi.json`, never from memory.
- **Run modes are `STORE_DISCOVERY`, `CATALOG_DISCOVERY` and `FILE_IMPORT`.** There is no
  separate price crawl: a `CATALOG_DISCOVERY` walk writes prices. `LEAFLET_IMPORT` is the old
  name of `FILE_IMPORT`. Runs are `POST /v1/admin/harvest/runs`, read back with
  `GET /v1/admin/harvest/runs/{id}` (counters, `stage`, `warnings`, `report`). A Mercadona walk
  needs `priceScopeIds` whose `externalKey` is a warehouse. A preset
  (`/v1/admin/harvest/presets`, `POST /presets/{id}/runs`) repeats a run exactly, which part 3
  needs.
- **Three switches must all be on before anything runs**, and each one is a different decision:
  `HARVEST_ENABLED=true` in the slot's `apps/luna-shopper-backend/harvester/.env` (then
  `luna-slot.sh --restart --services harvester`, because a running service never rereads its
  `.env`), a source row per chain (`PUT /v1/admin/harvest/sources/{supermarketId}` with an
  `adapterKey`, then `PUT .../enabled` with `{ "enabled": true }`), and the chain itself existing
  in catalog. A new source row is created disabled.
- **Postal codes discover shops by themselves.** `POST /v1/admin/harvest/postal-codes` with
  `{ country, postalCode, discoverNow: true }` queues a code. The worker drains the queue every
  `HARVEST_DISCOVERY_POLL_SECONDS` (60) and starts one `STORE_DISCOVERY` run per due source,
  triggered `SYSTEM`. Adding a postal code to a shopping profile
  (`POST /v1/account/shopping-profiles/{id}/postal-codes`) queues it the same way. Queue state is
  `GET /v1/admin/harvest/postal-codes` and `.../summary`. `DONE` means "we looked", not "shops
  were created".
- **A discovered place becomes a shop only when it is imported.** `GET /v1/admin/harvest/places`
  and `.../places/groups` list them, `POST /v1/admin/harvest/places/{id}/import` accepts one and
  `.../reject` refuses one. An import with no `priceScopeId` makes catalog create a `STORE` scope
  for the new location (`PriceScopeService.ensureStoreScope`). A source with
  `autoImportPlaces: true` imports by itself, which this plan must not allow (see Constraints).
- **Prices are rows side by side and the winner is decided on read** (plan 0080). A manual price
  is `POST /v1/admin/catalog/item-prices` with `sourceKind: ADMIN`, and it carries seven days of
  protection (`protectedUntil`) plus an `overrides` snapshot of what each automated kind said at
  that moment. The policy table is `GET /v1/admin/catalog/price-policies`: lower priority wins,
  `maxAgeDays` expires a row, an expired row falls through to the next source and then to a
  less specific scope. The sweep in `effective-price.sweep.ts` recomputes every 60 seconds, so
  wait at least 70 seconds before you read a result that depends on the clock. The shopper
  view is `GET /v1/catalog/items/{id}/offers`, and the admin view is
  `GET /v3/admin/catalog/supermarket-items`.
- **A leaflet is read by a tool and uploaded by you.**
  `npx nx run luna-shopper/leaflet-cli:read -- --pdf <pdf or dir of page_NN.png> --chain <slug>`
  has chain prompts for `deza`, `dia`, `el-jamon` and `lidl`. `--engine manual` writes
  `<out>/PROMPT.md` so that you read each page image yourself and write `page_NN.json`, then
  `--out <out> --resume --engine manual` finishes. The tool never uploads: send the result with
  `POST /v1/admin/harvest/imports` and `sourceKind: OFFICIAL_LEAFLET`. An offer the matcher
  cannot bind becomes a `CANDIDATE` entry and writes no price until somebody accepts it.
- **Curation is `npx nx run luna-shopper/curation-cli:curate -- ...`.** Read the header of
  `libs/luna-shopper/tools/curation/cli/src/cli.mjs` first. It takes its own ephemeral rehearsal
  slot, decides there, writes `decisions.jsonl` into `--run-dir`, and changes the main slot only
  on `--apply`. Point `--main-url` at this plan's slot. `--implementation suggestions` works the
  harvest entries queue, `--implementation groups` assigns product groups. The default engine
  is `claude`. The entries queue can also be decided by hand through
  `/v1/admin/harvest/entries/{id}/accept`, `.../item`, `.../reject`.
- **Known defects to recognise, not to rediscover:** a list created in a zone that was just
  created can answer 500 and then work minutes later, and one `PENDING` zone membership breaks
  unscoped assistant turns. Record them if they reappear, with the time.

### Target state

- A non zero local slot, claimed by `luna-slot.sh --up` with no number, holding: every shop the
  queue discovered for the chosen postal codes, some of them imported, one or more walked
  catalogs with prices, one leaflet of at least 10 pages with content imported, curated entries
  and product groups, a set of manual prices, one shopper account with a group, a list and a
  finished shopping session, and a second run of the same harvest over edited prices.
- That slot stopped with `--down --keep-data`, so its databases survive and `--auto` never
  hands the number to anybody else.
- A report tree under `D:\Projects\catalog-report\<YYYY-MM-DD>-slot<N>\`, laid out as in the
  section "The report" below, whose `README.md` alone tells the developer what was done, what
  was wrong and how to bring the slot back.

### Scope

Read anything in the repository. Write only:

- the per slot `.env` files that `luna-slot.sh` owns, and only the keys this plan names
  (`HARVEST_ENABLED`)
- the slot's databases, through the gateway
- `D:\Projects\catalog-report\` and the `--out` and `--run-dir` folders of the two CLIs, which
  go under that report tree rather than inside the worktree
- `$CLAUDE_JOB_DIR/tmp` for scratch scripts

### Constraints

- **Never write a row with SQL.** Reads with `docker exec ... psql` are allowed to check what an
  API answer implies (a scope's kind, a row's `protectedUntil`). Every write goes through the
  gateway, because the point is to prove the API path.
- **Never start a `STORE_DISCOVERY` run by hand, and never create a shop by hand.** Shops come
  only from postal codes through the queue, and a place becomes a shop only through
  `places/{id}/import`. Keep `autoImportPlaces` false on every source so that acceptance stays a
  decision you make and record.
- **Slot 0 belongs to the developer.** Run `luna-slot.sh --list` first, then `--up` with no
  number. Never take, stop or reset slot 0, and never serve against it.
- **Change no price policy.** Test priority and expiry with the defaults, through `observedAt`,
  `validFrom` and `validUntil` on the rows you write. If a case can only be shown by editing a
  policy, write it down as untested and why.
- **Be polite to the storefronts.** Keep each source's default `maxRequestsPerSecond` and
  `workers`. Run one catalog walk at a time. Do not walk Carrefour (a browser, 851 page loads).
  A LIDL walk belongs on a Monday (plan 0089), so skip it on any other day.
- **Predict before you observe.** For every price check, write the expected winner and the
  reason into the report first, then read the API, then mark it matching or not. A result
  explained after the fact proves nothing.
- **Record every refusal verbatim**: status, error code, body. A 201 with `applied: false` from a
  bulk route is a refusal.
- **Plain English in the report, no dashes as punctuation.**

### Action boundaries

- **Stop and ask before:** changing code or any file under version control, running a migration
  by hand, deleting a run or reverting one (`/runs/{id}/revert`), editing a policy, running
  `--reset-env`, or any action that touches slot 0 or another worktree's slot.
- **Stop and report** if the stack cannot come up or a service will not bind its port after one
  `--restart` (see the troubleshooting notes in `parallel-worktree-testing.md`), or if a
  storefront answers 403 or 429 twice in a row. Abort that run with `/runs/{id}/abort` first.
- **Do not fix defects.** A defect is a finding with a reproduction, not a task.
- **The run is done** when the three parts are written up and the slot is down with its data
  kept. It is not done when a step "looks fine": each check names the response it rests on.

### Progress evidence

After each numbered step, append to `run-log.md` one line: the time, the step, what was sent,
and the ids or counts that came back. A claim in `README.md` that cites no line of the log or
file of `responses/` does not count.

## Setup

1. This session makes no commits. Work in a worktree anyway, so that the `.env` edit and the
   slot claim are not in the developer's checkout: `git reset --hard dev`, then `npm install`
   (all seven backend builds fail without it).
2. `bash k8s/e2e/luna-shopper-backend/luna-slot.sh --list`, then
   `bash k8s/e2e/luna-shopper-backend/luna-slot.sh --up`. Write the slot number and gateway port
   at the top of `run-log.md`.
3. Set `HARVEST_ENABLED=true` in `apps/luna-shopper-backend/harvester/.env` and run
   `--restart --services harvester`. Make sure that the harvester log shows the new boot.
4. Log in as `dev-admin`. Save `GET /v1/admin/harvest/sources`, `GET /v1/admin/catalog/price-policies`
   and the supermarket list as the baseline in `responses/00-baseline/`.

## Part 1: the operator (lead session)

1. **Choose the ground.** Pick three to five Spanish postal codes in one city served by
   Mercadona, DEZA, LIDL and Dia. Córdoba (for example 14004, 14011, 14013) is the default,
   because DEZA is a Córdoba chain and El Jamón and Mercadona are present. State the choice and
   the reason.
2. **Configure the sources.** For each chain you will use, upsert its source row with the right
   `adapterKey` and `autoImportPlaces: false`, then enable it. Record each answer. Enable
   `osm-places` too, because the queue asks OpenStreetMap for every code.
3. **Register the postal codes** with `discoverNow: true`. Then only watch: poll the queue and
   `GET /v1/admin/harvest/runs?mode=STORE_DISCOVERY` until every code is `DONE` or `FAILED`.
   Record which sources the worker asked for each code, how long it took, and every run's
   counters and warnings.
4. **Accept some places.** Read `places/groups`, then import at least two places per chain and
   reject at least one place that is not a supermarket or is a duplicate. For every import,
   make sure that the location exists with its address and coordinates, that a `STORE` scope was
   created for it with priority 100 and `externalKey` equal to the location id, and that no
   second scope or second location appeared. Record where the answers disagree with plan 0116.
5. **Walk a catalog.** Run `CATALOG_DISCOVERY` for Mercadona with `priceScopeIds` for the
   warehouse that serves your postal codes (plans 0106 and 0108 say how that is found), and save
   the request as a preset for part 3. Expect about 4,400 requests and 18 minutes. Record the
   report, especially `pricesRecorded`, `pricesPublished` and `pricesConfirmed`. If time allows,
   run one DEZA walk, which writes availability and never a price.
6. **Read a leaflet.** Find a current leaflet (valid today, 2026 dates on it) of a chain with a
   chain prompt, preferring one whose shops you imported in step 4. Save the PDF and its source
   URL. Read at least 10 pages with offers on them through the leaflet CLI, with
   `--engine manual` unless an Ollama vision model is already running. Keep the drift check's
   verdict. Upload the result as `OFFICIAL_LEAFLET` with the leaflet's own `validFrom` and
   `validUntil`. Record how many offers bound to a product, how many became `CANDIDATE` and how
   many `UNRESOLVED`.
7. **Curate.** Run the curation CLI with `--implementation suggestions` against this slot, read
   `decisions.jsonl` and `report.json`, and apply it. Then run `--implementation groups` the same
   way. Accept the leaflet's `CANDIDATE` entries that are right and reject the wrong ones, by
   hand or through the CLI, and make sure that accepting one writes the price it was queued for.
   Record every decision you disagreed with and why.
8. **Type prices, and check who wins.** Choose 8 to 12 products that have both a walked
   Mercadona price and, where possible, a leaflet price. Build a table of cases before you
   write anything. It must at least cover:
   - an `ADMIN` price on a product with only an `OFFICIAL_API` price (protection makes `ADMIN`
     win for seven days)
   - an `ADMIN` price with `observedAt` more than seven days ago (protection lapsed, so
     the policy order decides)
   - an `OFFICIAL_LEAFLET` price beside an `OFFICIAL_API` price (priority 10 beats 20)
   - a leaflet row whose `validUntil` is in the past, or passes during the run (it falls through
     to the next source after the sweep)
   - a price on a `STORE` scope beside one on the warehouse scope (the narrower scope wins where
     it exists, and the other shops still see the wider one)
   - deleting an `ADMIN` row (the shown price returns to the automated source)

   For each case, write the prediction, the request, the answer of
   `GET /v1/catalog/items/{id}/offers` and of `/v3/admin/catalog/supermarket-items`, and the
   verdict. Read again after 70 seconds for every case that depends on time.
9. **Pick the products for part 2.** From everything above, list 10 to 15 products the shopper
   must look for: suspected duplicates, products with prices from several sources, products the
   curator hesitated on, a leaflet offer, a product priced only on a `STORE` scope. Give each
   one its search words and the reason it was picked, never its id, so the shopper has to find
   it the way a user does. Write this list to `part2/handover.md`.

## Part 2: the shopper (a second agent)

Start it with the Agent tool as a fresh agent, not a fork, and give it the brief below with the
slot's gateway URL and the contents of `part2/handover.md`. It must not read `part1/`.

> You are a shopper testing a local Luna Shopper backend at `<gateway URL>`. Use only the
> shopper routes of the gateway (read their shapes in
> `apps/luna-shopper-backend/gateway/docs/openapi.json`). Never call `/v1/admin/**` and never
> read a database. Write everything to `D:\Projects\catalog-report\<run>\part2\`.
>
> 1. Register an account (`POST /v1/auth/register`, then log in). Create a shopping profile and
>    add the postal codes `<codes>` to it.
> 2. Create a group (`POST /v1/zones`) and a list in it. If creating the list answers 500,
>    record the time and body, wait two minutes and retry once.
> 3. Find each product in the handover list with `GET /v1/catalog/suggest` and
>    `GET /v1/catalog/items` using the search words given, the way a person types them.
>    For each, record every result you saw, which one you chose and why. Then add lines for them,
>    linking the product you chose.
> 4. Search for 10 more products of your own choosing across different categories: fresh food,
>    a branded drink, a cleaning product, a private label product, one word with an accent or
>    `ñ`.
> 5. Look for errors on everything you searched: the same product listed twice, one product
>    with two different names, a wrong size or unit price, a price that disagrees with the
>    shop it names, a product with no price at shops that sell it, a search that misses an
>    obvious match. Every finding names the query, the ids involved and the answers.
> 6. Shop. Create a basket from the list (`POST /v1/baskets`), read it, settle rows as bought
>    or not available (`POST /v1/baskets/{id}/rows/{rowKey}/settle`), including one at a
>    different shop than suggested, then finish it with `PATCH` and read
>    `GET /v1/purchases/sessions`. Record whether the prices shown in the basket match the offers
>    you read in step 3.
> 7. Write `part2/findings.md`: one entry per problem with reproduction, then a short list of
>    things that worked as a shopper expects. Do not fix or explain code. Stop and report
>    if the gateway stops answering.

When it returns, the lead copies its findings into the report's `README.md`, marking each
finding confirmed or not after checking it against the admin view.

## Part 3: the rerun (lead session)

1. On 5 to 8 products the walk priced in part 1, change prices by hand: raise one, lower one,
   add an `ADMIN` price equal to the walked price, and put one `ADMIN` price on a product whose
   walked price you expect the storefront to change. Record `protectedUntil` and the `overrides`
   snapshot of each.
2. Rerun the Mercadona walk from its preset. Compare the second report with the first.
3. For each edited product, predict and then read: whether the `ADMIN` row still wins, whether
   a walked price that changed displaced it, whether one that did not change left it in place,
   and whether the leaflet rows from part 1 are untouched. Read again after the sweep.
4. Record the counts of created, updated and unchanged rows, and whether any product was created
   twice by the second walk.

## The report

```
D:\Projects\catalog-report\<YYYY-MM-DD>-slot<N>\
  README.md          summary, findings ranked by severity, how to bring the slot back
  run-log.md         one line per step, with times, ids and counts
  responses\         raw JSON answers, one folder per step, named <step>-<what>.json
  part1\             places.md, prices.md (the prediction table), leaflet\, curation\
  part2\             handover.md, findings.md, and the shopper agent's raw answers
  part3\             rerun.md, the two run reports side by side
```

`README.md` closes with the slot section: the slot number, the ports, the fact that it is
locked, and the commands to use it again from any checkout:

```sh
bash k8s/e2e/luna-shopper-backend/luna-slot.sh --up <N>     # brings it back with its data
# HARVEST_ENABLED is a hand edit, so set it again in that checkout if runs are needed
bash k8s/e2e/luna-shopper-backend/luna-slot.sh --unlock <N> # only when the data can go
```

## Finish

1. Make sure that `README.md` answers, for each of the user's six part 1 items and the part 2
   and part 3 items, what was done and whether it behaved as designed.
2. `bash k8s/e2e/luna-shopper-backend/luna-slot.sh --down --keep-data`, then `--list`, and
   record that the slot shows as locked.
3. Make sure that no rehearsal slot from the curation CLI and no `ng-slot` server is left
   running.
4. Report the path of the report and the slot number to the developer.
