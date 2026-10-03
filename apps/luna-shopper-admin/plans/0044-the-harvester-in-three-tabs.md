# 0044 The harvester in three tabs

> Fourth of the seven remodel plans. Needs `0041` (the frame). It does not need `0042` or `0043`,
> but its links to a chain and to a product point at their addresses, so build it after them.
> Prerequisite reading: `0041`, `0014` (one queue), `0020` (a queue is also a list), `0030`
> (presets), `0035` (bulk work), `0027` and `0032` (brands), `0021` (postal codes).
>
> Mock: `plans/mocks/remodel/`, boards `Review`, `Runs`, `Setup`, `Phone-Review` and
> `Phone-Runs`, published at <https://claude.ai/artifact/KJTKDyRWfdJTL9PCUPwjQv>.

The harvester has ten screens in one flat row, and they are three kinds of work. Four are
queues where a person decides something (discovered places, source products, source shops,
suggested brands). Three start or follow work (runs, presets, import a file). Three are set
up once and then left alone (chain sources, registered brands, postal codes).

This plan gives each kind one tab: Review, Runs, Setup. The four queues share one page, and
the rail shows how many decisions wait.

## Brief for the agent

### Objective

Regroup the harvester screens into three tabs, put the four queues on one Review page with
their counts, and put presets and file import on the Runs page. Use the
`nx-portfolio-angular-developer` skill.

### Context

- **Routes today**: `harvestRoutes()` in `libs/luna-shopper-admin/feature-harvest/src/lib/routes.ts`
  and the brand routes in `feature-brands/src/lib/routes.ts`.
- **Queues**: `EntriesQueuePage`, `ShopsQueuePage`, `PlacesQueuePage` (all on `QueueFrame`,
  `ui/src/lib/harvest/queue-frame.ts`) and `BrandSuggestionsPage` (a table with a register
  panel, and no reject).
- **Counts**: `GET /v1/admin/dashboard` gives `harvest.queues.entries[]` (candidate and
  unresolved per chain), `harvest.queues.places` and `harvest.queues.shops[]` (unmapped per
  chain), plus `harvest.running` and `harvest.recent`.
- **The run form** is `RunRequestForm`. `ShellLink.badge` exists and nothing uses it.

### Target state

1. **Section "Harvest"** has three tabs: Review (`/harvest/review`), Runs (`/harvest/runs`),
   Setup (`/harvest/setup`). `/harvest` redirects to Review.
2. **What waits is counted.** The Review tab and the Harvest entry of the rail show the sum of
   the waiting products, shops, places and brands. The count is read with the dashboard, again after
   each decision batch, and again when the tab gains focus.
3. **A run in progress shows on every Harvest tab.** In the header on a wide screen and as one
   line under the tabs on a phone: the state, the chain and kind, a progress bar, "N of M".
   It links to the run. Nothing is drawn when no run is in progress.
4. **Review**, `/harvest/review/:queue` with `products`, `shops`, `places` or `brands`.
   - A switch of four entries picks the queue, each with its count (section 2 adds the count
     of Brands).
   - A chain filter is shared by the four queues and kept in the `chain` query parameter. The
     Shops queue needs a chain. With none chosen it lists the chains that have shops waiting,
     with the count of each, and a press chooses the chain.
   - At 72 rem and above the queue is split: the list at the left (360 px) and the open row at
     the right. `QueueFrame` gains this as a third view, and the "One at a time" and "List"
     switch stays for narrower screens and for bulk work.
   - **Products**: the open row puts "The source says" and "Proposed product" side by side
     (one above the other on a phone), with the reason for the proposal as a state, then
     "Prices it brings" with a `ScopeMark` on each. Actions: "Yes, it is this product", "Pick
     another product", "Create the product", "Skip", "Not a product we track". On a phone
     Reject, Skip and the accept action sit in a bar above the navigation bar, and the other
     two are links in the card. "Apply a decisions file" is a button of this queue.
   - **Shops** and **Places** keep their content and actions. "Grouped by chain" is a view of
     the Places queue, not a page.
   - **Brands** keeps its table, its register panel and its bulk review.
5. **Runs**, `/harvest/runs`.
   - The header shows "Runs may start" or "Runs are off" as a state with an info button, and
     the actions "Import a file" and "New run".
   - **Presets**: a chain picker and the presets of that chain, each with its name, a one line
     summary, the result of its last run and "Start". The chain is remembered. "Edit presets"
     shows edit and delete on each row.
   - **Import a file**: a drop zone and "Choose a file" that open `/harvest/runs/import` with
     the file. That page is today's import page.
   - **Running now**: the run in progress with its counters, "Open" and "Stop this run".
   - **Earlier runs**: today's list with its three filters.
   - "New run" opens `RunRequestForm` at `/harvest/runs/new`, with "Save as preset".
   - At 72 rem and above presets and import are a column 420 px wide at the left. Below that
     the order is: running, presets, earlier runs, and the two actions in a bar at the bottom.
6. **Setup**, `/harvest/setup/:part` with `sources`, `brands` or `postal-codes`.
   - **Chain sources**: one row per chain on a wide screen (how it is fetched, the two
     switches, workers, requests a second, last good run, failures in a row) and one card per
     chain on a phone. "Change" opens the form in the row, with the caution from `0041`. Each
     switch column has its own info button.
   - **Brands**: the registered brands list and its detail page.
   - **Postal codes**: the list, its summary tiles, the add page and the detail page.
7. **The harvester dashboard is removed.** Its running run and recent runs are the Runs tab.
   Its chart moves to the Overview page. Its notice stays at the top of the Runs tab.
8. **Old addresses redirect** and keep their query parameters: `/harvest/entries`,
   `/harvest/shops`, `/harvest/places` and `/harvest/suggested-brands` to their queue,
   `/harvest/places/groups` to the Places queue with the grouped view, `/harvest/presets` to
   Runs, `/harvest/imports/upload` to `/harvest/runs/import`, `/harvest/sources`,
   `/harvest/brands/...` and `/harvest/postal-codes/...` to their part of Setup.
9. **Texts** come from the table in `0041` section 3. Info of Review: "Each queue holds what a
   run found and could not place by itself." "Accept, point it at another row, or reject it.
   A rejected row is never offered again."

### Scope

- In: `feature-harvest`, `feature-brands`, `ui/src/lib/harvest/**`, `feature-dashboard` (the
  chart), `apps/luna-shopper-admin/src/app/sections.ts`, `en.json`, specs.
- In, backend: `queues.brands` on the dashboard read (section 2), with the contract,
  `openapi.json` and the wire types.
- Out: what a decision does, the run form's fields, any other gateway change.

### Constraints

- Keep a page's queue in a signal, because a new `QueueStore` is built on every filter change.
- `decideMany` keeps the partial failure rule. Bulk work stays in the list view.
- The action bar of a queue on a phone sits above the navigation bar and never under it. Both
  reserve their height, so the last field of a card is reachable.
- An accept or reject button never moves when the next row loads, so that two quick presses
  do not hit different actions.
- No per chain setting is added to any screen. Whether a chain may be fetched is the row
  switch that exists.
- Colors that tell accept from reject also differ in shape: the accept action is filled, the
  reject action is outlined.

### Action boundaries

- Do not change a harvester route. This plan moves screens.
- Do not delete `PlaceGroupsPage` logic. Move it into the Places queue.
- After the brands count of section 2, run `luna-shopper-backend-gateway:openapi` and then
  `luna-shopper-admin/models:wire-types`, and commit both outputs.

### Progress evidence

- `npx nx lint` and `npx nx test` for `luna-shopper-admin/feature-harvest`,
  `luna-shopper-admin/feature-brands`, `luna-shopper-admin/ui` and `luna-shopper-admin`.
- `npx nx test luna-shopper-backend-gateway`, with a case in `admin-dashboard.service.spec.ts`
  for `queues.brands`.
- `npx nx build luna-shopper-admin`.
- A spec for each redirect of target 8, and one for the count on the rail.
- A browser walk on a Luna slot with the demo seed, at 390 px and 1360 px: accept one source
  product, reject one, map one source shop, add one place, register one brand, start a preset,
  stop the run, import a file, turn a chain switch on and off. Attach screenshots that match
  the five boards.

## 1. Not in this plan

- Keyboard shortcuts for accept, reject and skip.
- A reject action for a suggested brand. The gateway has none.

## 2. What the gateway does not serve yet

| The mock shows | Today | In this plan |
| --- | --- | --- |
| A count on the Brands queue | The dashboard counts entries, places and shops | **In.** Add `queues.brands` to the harvest block of `GET /v1/admin/dashboard`: the number of suggested brands, from the read that `GET /v1/admin/catalog/brand-suggestions` uses. |
| "Wrote" and "Queued" in an earlier run row | The run view has `created`, `updated` and other counters | In. Show "Wrote" as created plus updated, and leave "Queued" out unless the report carries it. |

## 3. Decisions made

The owner settled these on 2026-10-03.

- **Review opens first**, because it is where a person has work.
- **Registered brands sit under Setup.** They are reference data that the brand queue feeds.
- **The brands count of section 2 is part of this plan.**

## 4. What this plan deletes

- `HarvestDashboard`, `HARVEST_LINKS` and `BRANDS_LINKS` as flat link lists, and the ten
  entries of the old second row.
- `PlaceGroupsPage` as a routed page, `PresetsPage` as a routed page, and `lib-switch-panel`.
  Their content lives in the Places queue, the Runs tab and the "Runs may start" state.
- Every lead paragraph that `0041` section 3 lists under `harvest.*` and `brands.*`.
- `harvest.nav.*` keys with no tab, and the three absence checks in `routes.spec.ts`.
- The chain picker copies of the presets page and the shops queue, which the shared chain
  filter and the remembered chain replace.
