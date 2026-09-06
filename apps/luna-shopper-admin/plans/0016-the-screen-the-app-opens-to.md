# 0016 The screen the app opens to

The app opens on the supermarkets list. `0004` decided that: "an operator opens this tool to
change a specific thing, and a landing page in front of that is a click between them and it."
That is an argument against an empty landing page, and it stands. It is not an argument against
one that answers, on arrival and in one screen, the questions an operator otherwise opens six
screens to answer: is anything waiting for a decision, did last night's run finish, how many
people are here this week compared to last, did somebody try to guess an admin password.

So the empty path draws a **dashboard**, and the navigation gains an "Overview" link in front of
the resources. Every resource is still one click away, exactly as before, because the navigation
is unchanged apart from the new first entry.

Depends on backend plan `0088`, which is the route this screen reads and the wire types it reads
it with, and on `0015`, which is the three components it draws with. Both are read through their
public surface only: `Wire.*` from `models`, and `lib-line-chart`, `lib-bar-chart`,
`lib-stat-tile` from `ui`.

## 1. One read, one document, once a minute

`GET /v1/admin/dashboard` answers one document with four blocks and a feed (`0088`, section 5).
The screen reads it whole. There is no per block request and no per chart request: a block that
did not answer arrives as `null` in the same document, which is the case section 5 is about.

The data layer follows `0006`'s shape exactly:

- `DashboardServiceI` in `libs/luna-shopper-admin/data-access/src/lib/dashboard/`, one method,
  `read(): Promise<Wire.AdminAdminDashboardResponse>` (or whatever name the generator gives
  `admin.AdminDashboardResponse`, which is what `0088`'s `hoistAdminDashboard` registers).
- `DASHBOARD_SERVICE`, a `serviceToken` whose default is `DashboardMemory`.
- `DashboardMemory`, seeded with a **deterministic** document: thirty days of counts shaped like a
  real month (a weekday rhythm, one spike), a run in flight reusing `HARVEST_RUN_SEED`'s running
  run, two chains with rows in the entries queue, three pending join requests, two failed logins
  in the last day, and a feed of twenty rows across the three trails. Deterministic, because a
  screenshot of the memory dashboard is what the PR shows and a spec asserts counts against it.
- `DashboardApi`, the HTTP implementation, bound in `app-providers.ts` with
  `provideService(DASHBOARD_SERVICE, DashboardApi)` beside the harvester's.
- `DashboardStore`, `providedIn: 'root'`, holding `document`, `loading`, `failed` (a
  `GatewayError` or `null`) and `measuredAt`, with `load()` and `watch()`.

`watch()` re-reads **every sixty seconds while the tab is visible**, with the same
`document.visibilityState` gate `RunWatch` uses and for the same reason: a dashboard left open on
a second monitor is the common case, and an operator glancing at it expects it to be roughly now.
A hidden tab polls nothing. A refresh button re-reads at once. The interval is a constant
`DASHBOARD_POLL_INTERVAL_MS = 60_000` beside `RUN_POLL_INTERVAL_MS`.

A re-read that fails **keeps the last document** and shows the failure beside the timestamp
rather than replacing the screen with an error. The numbers on screen were true a minute ago, and
a screen that blanks every time the gateway hiccups is one that is never trusted.

## 2. The route, and the link in front of everything

`adminRoutes(descriptors, sections)` redirects the empty path to the first resource. It gains a
third argument, `home?: Type<unknown>`: a component drawn at the empty path inside the chrome.
With it, the redirect is not emitted. Without it, nothing changes, so every existing spec and the
assertion that the empty path lands on the first resource stay as they are, and `routes.spec.ts`
gains the case with a home.

The link is a `ShellLink` with a new optional `leading: true`, and `AdminShellPage.links` puts
leading extra links **before** the resources and the rest after them, as today. The dashboard's
library exports `DASHBOARD_LINK` beside its route, the way `HARVEST_LINKS` sits beside
`harvestRoutes`, and the app passes it to `provideShellLinks` first. `routerLinkActive` on a link
to `/` with `exact: false` is active on every page, so the shell passes `exact: true` for a link
whose path is `/`, and only for that one.

The library is **`libs/luna-shopper-admin/feature-dashboard`**, a new feature library beside the
other four, with the same `project.json`, `tsconfig` trio, `jest.config.cts` and
`eslint.config.mjs` as `feature-harvest`, a path alias in `tsconfig.base.json`, and
`types/**/*.d.ts` in its `tsconfig.lib.json` include. Its translations go in `ui`'s `en.json`
like the harvester's, under a `dashboard` object appended **at the end** of the file, because
`0015` inserts its `chart` object at the top and the two must not collide.

## 3. What is on it, top to bottom

The order is the order of what an operator does with it: what needs a decision first, then what
is running, then how the product is doing, then what changed.

### 3.1 The header

"Overview", the time the numbers were taken (`measuredAt`, formatted with `formatSince` as
"2 minutes ago" and `formatInstant` in a `title`), and the refresh button. When a re-read has
failed, the failure's key sits here in `--admin-danger` ink, and the stale timestamp says how old
the numbers below are.

### 3.2 Work waiting

Stat tiles, `tone: 'attention'` whenever the count is above zero, each linking to the screen
where the work is done:

| Tile                                    | From                                   | Links to                                    |
| --------------------------------------- | -------------------------------------- | ------------------------------------------- |
| Join requests waiting                   | `core.memberships.pending`             | `/zones`                                    |
| Products to decide, one tile per chain  | `harvest.queues.entries[]` (candidate + unresolved) | `/harvest/entries?supermarketId=<id>` |
| Shops to map, one tile per chain        | `harvest.queues.shops[]`               | `/harvest/shops`                            |
| Places found                            | `harvest.queues.places`                | `/harvest/places`                           |
| Stale prices                            | `catalog.supermarketItems.stale`       | `/prices`                                   |
| Failed admin sign ins, last 24 hours    | `identity.loginFailures.last24h`       | nothing, section 3.6 has the rows           |

The entries queue already reads `supermarketId` from the query string, so that link opens the
queue on the chain. The shops queue does not, and the resource lists do not read a filter from the
URL at all, so those tiles open the unfiltered screen. Teaching the lists to read their filters
from the URL is a change to `ResourceListPage` for every resource and is not in this plan.

A chain is named through the supermarket reference the app already resolves for the sources
screen. A chain the reference cannot name shows its id, per `0007` section 4.

A chain with nothing waiting in a queue draws no tile for that queue. A block that is `null`
draws section 5's notice in place of its tiles, so an operator sees "the harvester did not
answer" and not an empty row that reads as "nothing waiting".

### 3.3 The harvester

- The run in flight, when `harvest.running` is not null: mode, chain, and `lib-run-progress`
  fed by `runProgress(view)`, the same function the run screen uses (`HarvestRun` in `models` is
  the wire view itself, so nothing is mapped), linking to `/harvest/runs/<id>`. Once a minute is the wrong cadence for a running bar, so while this
  section shows a run the store's poll interval drops to `RUN_POLL_INTERVAL_MS`, and goes back
  when the run reaches a terminal state.
- The last five runs as rows: mode, status chip, chain, requested when, processed and failed,
  each linking to its run screen. Same row as the runs list draws, which is why the runs list's
  row is extracted into `ui` as `lib-run-row` rather than copied.
- `lib-bar-chart` of `harvest.runs.byStatus`, one series, six categories in enum order.
- Sources: "3 of 4 chains enabled", linking to `/harvest/sources`.

### 3.4 People

- Tiles: users, with `trend` from `identity.signUps` and a seven day delta, and with registered,
  temporary and verified beneath it as a caption. Then zones (active of total), lists, and
  baskets (draft and completed as the caption).
- `lib-line-chart`, one series: registered sign ups per day.
- `lib-line-chart`, two series: zones created and lists created per day.

The seven day delta is `weekDelta(series)`: the sum of the last seven days minus the sum of the
seven before them, a pure function in `models` with its own spec. Its caption is "in the last 7
days".

### 3.5 Catalog

- Tiles: supermarkets, locations, items, product groups, and supermarket items with "priced,
  stale, unavailable" as the caption.
- `lib-bar-chart`, stacked: `catalog.pricesWritten`, one series per `PriceSourceKind`, thirty
  categories of days. **Colour is the kind's position in the enum, one to six, always**, and a
  kind whose thirty days are all zero is left out of the drawing and the legend but keeps its
  number for the next month it appears. `0015` section 2 is why.

### 3.6 Admin sign ins

Two numbers, last 24 hours and last 7 days, and `identity.loginFailures.recent` as a short table
of when, username and IP. This is the whole of what `0071` section 7 promised a dashboard, and it
is deliberately plain: the interesting number is nearly always zero.

### 3.7 Recent activity

`activity` as a table of twenty rows: when (`formatSince`), who (`actorName`, or the service's
name for a `SERVICE` actor: the app knows the harvester is the only service that writes, so the
row says "harvester"), what (the action and the table, as "updated a zone"), and the row itself
as a link where the app has a screen for it. `activityTarget(entry)` in `models` maps an audit
`entity` to a route: `zones` to `/zones/:id`, `shopping_lists` to `/lists/:id`, `users` to
`/users/:id`, `items` to `/items/:id`, `item_prices` to `/prices/:id`, `supermarket_items` and
`list_lines` and `zone_memberships` to their parent's screen when the entry carries enough to
reach it, and `null` otherwise. A row with no target is text. A target the app cannot build is
`null`, never a guessed URL that lands on the not found page.

## 4. Phone

Tiles wrap into two columns, then one. Charts take the full width and their height stays. The two
tables (sign ins, activity) become the card layout the resource list uses below the breakpoint,
from `Viewport.compact` rather than a media query, for the reason `0004` gives: a switch a spec
cannot set is a switch nothing asserts.

## 5. When a block did not answer

A `null` block draws, in its section, one notice: which service did not answer, and the retry
button, which is the refresh. The rest of the page draws. The copy is per service ("The harvester
did not answer", "Catalog did not answer") because the four are four deployments and the operator
is about to go and look at one of them.

**Do not use `harvesterDeployed`** to decide that a null harvest block is expected. That helper
says production and staging do not run the harvester, and both do now (`values.staging.yaml` and
`values.production.yaml` set `enabled: true`), so it is stale and the document is the truth: the
block is null or it is not. Correcting the helper belongs to the harvester screens, not here.

A document that failed to load at all, with nothing to keep, draws the page's error state with
the failure's key and the retry, in the same place the resource list draws its own.

## 6. Tests

- The empty path renders `DashboardPage` inside the chrome when a home is given, and redirects
  to the first resource when it is not.
- The leading link is first in the navigation and the harvester's links are still last.
- Against `DashboardMemory`: every section renders, the work waiting tiles carry the seeded
  counts and link where the table in 3.2 says, a chain with nothing waiting has no tile, the
  run in flight draws a progress bar, the five recent runs link to their screens.
- A document with `harvest: null` draws the harvester notice and every other section.
- A document with every block `null` draws four notices and the feed, which is empty.
- `weekDelta` on a thirty day series, on a series shorter than fourteen days, and on all zeros.
- `activityTarget` for each entity the table in 3.7 names, and `null` for one it does not.
- The store polls at the dashboard interval, drops to the run interval while a run is in flight,
  stops on a hidden tab, and keeps the previous document when a re-read fails.
- Assert on component inputs, never on rendered interpolated text.

## 7. Exit criteria

- The app opens on the dashboard, signed in, against the compose stack with `0088`'s branch
  running, and every block is populated. Stopping the harvester makes its section a notice and
  nothing else changes.
- A screenshot of the memory dashboard at desktop and at phone width is in the PR.
- `npx nx test luna-shopper-admin/feature-dashboard`, `luna-shopper-admin/data-access`,
  `luna-shopper-admin/models`, `luna-shopper-admin/feature-resource` and `luna-shopper-admin`
  are green, and the app builds inside its budgets.
- No socket is opened. No request is made while the tab is hidden.

## 8. Out of scope

- The route and the numbers: backend plan `0088`. The components: `0015`.
- A choice of window. It is thirty days, and it is the backend's.
- Lists that read their filters from the URL, which is what lets "stale prices" open the
  prices list already filtered.
- A per zone breakdown of pending join requests, or any screen that lists memberships across
  zones. There is no flat memberships route to read.
- Reading `before` and `after` off an audit row, and any audit viewer beyond the twenty row feed.
- Alerts, notifications, or anything that fires when a number crosses a line.
