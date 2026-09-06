# 0088 What the back office opens to

The back office opens on the first resource in its navigation, a list of supermarkets, because
plan `0004` said a landing page in front of the thing an operator came to change is a click
between them and it. That was true of an empty landing page. It is not true of one that answers
the questions an operator otherwise opens six screens to answer: how many people are here, is
anything waiting for a decision, did last night's run finish, did somebody try to guess an admin
password.

Four plans deferred exactly this. `0071` section 7 records failed admin logins from the first day
and says the screen that reads them "belongs to a dashboard that does not exist yet". `0074`
section 6 and admin plans `0003` and `0007` each list "any dashboard" under out of scope. This
plan is that dashboard's backend: **one route, composed from four services, each answering a
question about its own database.** The screen is admin plan `0016`, and the chart components it
draws with are admin plan `0015`.

Depends on nothing that is not merged. `0017` section 8 built the shape this plan copies, the
public `GET /v1/stats`, and `0075` and `0077` section 8 wrote the three audit tables this plan is
the first thing to read.

## 1. One route, four subjects, and null where a service did not answer

`GET /v1/admin/dashboard`, behind `AdminJwtGuard` like every admin read. The gateway fans out in
parallel to four subjects and composes the answer:

| Subject                     | Answered by | Verifies the credential with            |
| --------------------------- | ----------- | --------------------------------------- |
| `admin.dashboard.identity`  | auth        | `AdminIdentityService`, as `listAdmins` |
| `admin.dashboard.core`      | core        | `CorePlatformAdminService.requireAdmin` |
| `admin.dashboard.catalog`   | catalog     | catalog's `PlatformAdminService`        |
| `admin.dashboard.harvest`   | harvester   | harvester's `PlatformAdminService`      |

Every subject takes `AdminDashboardRequest`, which is an `AdminCredential` plus the window
(section 2), and every handler verifies the credential before it counts anything. The harvester
gates every subject it exposes and the other three gate every admin subject, so a dashboard that
skips the check is the one unauthenticated read of the user directory in the API.

**A block is `null` when its service did not answer**, and the response is still 200. This is
`GatewayStatsService.ask` applied four times: a harvester that is not deployed, a catalog that is
restarting, a subject that timed out, each costs its own block and nothing else. The screen draws
the three blocks it got and says which one it did not, which is a better answer than a 502 for
the whole page because one service is down. The screen must be able to tell "did not answer" from
"answered zero", which is what `null` is for, so no handler ever answers `null` for a count.

**Not cached.** `GET /v1/stats` caches for sixty seconds because it is the one unauthenticated
read in the API and a thousand visitors can hit it. This route has one operator behind a bearer
token, the screen asks for it on open and once a minute while the tab is visible (admin plan
`0016`, section 6), and the counts are a handful of indexed aggregates. If a count over
`item_prices` ever proves slow enough to matter, the fix is the same Redis entry the public route
uses with `measuredAt` making the staleness visible, and it is one change in one service.

`measuredAt` is on the response anyway, for the same reason it is on the public one: the screen
prints when the numbers were taken, so an operator reading a tab they opened yesterday is not
reading it as now.

## 2. The window is the gateway's, and every day in it is present

Three of the four blocks carry a daily series: sign ups, zones and lists created, prices written.
Four services bucketing "the last thirty days" independently disagree about where a day starts
the moment one of them is a second behind another, so **the gateway states the window and the
services fill it**:

```ts
export interface AdminDashboardWindow {
  /** The first day in the series, as `YYYY-MM-DD`, UTC. */
  from: string;
  /** The last day in the series, as `YYYY-MM-DD`, UTC. Today. */
  to: string;
}

export interface AdminDashboardRequest extends AdminCredential {
  window: AdminDashboardWindow;
}
```

The gateway computes `to` as today in UTC and `from` as twenty nine days earlier, so the window
is thirty days inclusive. It is not a query parameter in this plan: a screen that wants ninety
days is a screen that wants a different chart, and the plan that adds it adds the parameter with
the range check it needs.

**Every day in the window is present in every series, in order, oldest first, with zero where
nothing happened.** A series with a hole is a chart that has to invent the gap, and a chart that
invents a gap draws a line across it as if the count were interpolated. The service groups by
`date_trunc('day', ... AT TIME ZONE 'UTC')`, then fills the window in code, and a spec asserts
thirty entries come back from a table with two rows in it.

```ts
export interface DailyCount {
  /** `YYYY-MM-DD`, UTC. */
  day: string;
  count: number;
}
```

## 3. The four blocks

The shapes below are the contract, in `libs/luna-shopper/contracts` as
`admin-dashboard.messages.ts` with schemas in `admin-dashboard.schemas.ts`, registered in
`registry.ts` beside `statsSchemas`. Every count is an integer with `minimum: 0`. Every
`activity` list is section 4's shape, newest first, at most ten rows. Nothing here is a page: a
dashboard is a fixed sized document, and a block that wanted more rows than this is a screen of
its own.

### 3.1 Identity, from auth

```ts
export interface AdminIdentityDashboard {
  users: {
    total: number;
    registered: number;
    temporary: number;
    /** `kind = REGISTERED` and `emailVerifiedAt` set. */
    verified: number;
  };
  /** Registered users created per day, over the window. */
  signUps: DailyCount[];
  admins: {
    total: number;
    disabled: number;
  };
  loginFailures: {
    /** Rows of `admin_login_failures` in the last twenty four hours, measured from now. */
    last24h: number;
    /** The same over seven days. */
    last7d: number;
    /** The newest rows, newest first, at most ten. */
    recent: AdminLoginFailureView[];
  };
  activity: AdminActivityEntry[];
}

export interface AdminLoginFailureView {
  at: string;
  username: string;
  ip: string | null;
}
```

`userAgent` is stored and deliberately not sent. It is 512 characters that tell an operator
reading a tile nothing, and the row that needs it is read from the database by the person
investigating it.

The failed login counts are the one thing in this plan that `0071` asked for by name. They are
counts and a short list rather than a chart, because the interesting number is almost always
zero and a chart of zeros says less than the word.

### 3.2 Core

```ts
export interface AdminCoreDashboard {
  zones: {
    total: number;
    active: number;
    markedForDeletion: number;
  };
  memberships: {
    /** `status = PENDING`: join requests nobody has answered. */
    pending: number;
  };
  lists: {
    total: number;
  };
  baskets: {
    total: number;
    draft: number;
    completed: number;
  };
  zonesCreated: DailyCount[];
  listsCreated: DailyCount[];
  activity: AdminActivityEntry[];
}
```

`baskets` are `generated_lists`. `draft` and `completed` are the two statuses a basket is ever
in: `ACTIVE` is never written (the live basket is `DRAFT`) and the sum of the two is not `total`
only when an `ARCHIVED` row exists, which is why `total` is sent rather than derived.

`memberships.pending` is the one number in this block that is work waiting rather than a total,
and the screen draws it as such, linking to the memberships list filtered to pending.

### 3.3 Catalog

```ts
export interface AdminCatalogDashboard {
  supermarkets: number;
  locations: number;
  items: number;
  productGroups: number;
  supermarketItems: {
    total: number;
    /** `price` is not null. */
    priced: number;
    /** `stale` is true. */
    stale: number;
    /** `available` is false. */
    unavailable: number;
  };
  /**
   * `item_prices` rows first observed per day, one series per source kind.
   * Every kind in `PriceSourceKind` is present, in enum order, with a full
   * window of days each, so the chart's series count and colour order never
   * depend on what happened this month.
   */
  pricesWritten: {
    sourceKind: PriceSourceKind;
    points: DailyCount[];
  }[];
  activity: AdminActivityEntry[];
}
```

`pricesWritten` counts by `observedAt`, the first observation, not by `lastObservedAt`. A walk
that confirms four thousand unchanged prices touches `lastObservedAt` on four thousand rows and
writes nothing new, and the chart is about what was written. The confirmations are on the run
itself, in the harvest block.

The series are every kind in enum order even when a kind has never written a price, because
admin plan `0015` assigns chart colours by position in a fixed order and a series that appears
only when it has data takes a different colour each month.

### 3.4 Harvest

```ts
export interface AdminHarvestDashboard {
  runs: {
    /** Every status in `HarvestRunStatus`, in enum order, over all time. */
    byStatus: { status: HarvestRunStatus; count: number }[];
    /** Runs requested inside the window. */
    inWindow: number;
  };
  /** The run in flight: `RUNNING`, else `PENDING`, the most recently requested. Null when none. */
  running: HarvestRunView | null;
  /** The most recently requested runs, newest first, at most five, whatever their status. */
  recent: HarvestRunView[];
  queues: {
    /** Per chain, every chain with a `supermarket_sources` row, in `supermarketId` order. */
    entries: {
      supermarketId: string;
      candidate: number;
      unresolved: number;
    }[];
    /** `discovered_places` with `status = NEW`. */
    places: number;
    /** Per chain, as `entries`. `source_locations` with `status = UNMAPPED`. */
    shops: {
      supermarketId: string;
      unmapped: number;
    }[];
  };
  sources: {
    total: number;
    enabled: number;
  };
}
```

`running` and `recent` are `HarvestRunView`, the shape `harvest.run.get` already answers, mapped
by the same `harvest.mappers.ts` function. The admin app already turns that view into a
`HarvestRun` with progress, so the dashboard's run in flight is drawn by the component the run
screen draws it with and nothing is mapped twice.

The queues are per chain because the queue screens are per chain: a source catalog entry is keyed
on (`supermarketId`, `externalId`) and there is no screen over every chain's rows (plan `0086`,
section 10). A count summed over the chains links nowhere. The chain is named by id and the
screen resolves the name through the supermarket reference it already holds, exactly as the
sources screen does.

There is no `activity` in this block. The harvester has no audit table: what it changes, it
changes in catalog through `CatalogClient`, attributed to the service actor (plan `0075`,
section 3), and those rows are in catalog's trail.

## 4. The activity feed is the three audit tables, read for the first time

`0075` section 5 decided that nothing reads `catalog_audit`, and `0077` section 8 said the same
of `core_audit` and `auth_audit`: "the value being bought is the recording, and a viewer can be
built at any later point against data that already exists." This is that later point, and it is a
deliberately small viewer. Each of the three services answers its ten newest rows:

```ts
export interface AdminActivityEntry {
  at: string;
  actorKind: 'ADMIN' | 'SERVICE';
  actorId: string;
  /** The table, as the audit row names it: `zones`, `item_prices`, `users`. */
  entity: string;
  entityId: string;
  action: 'CREATE' | 'UPDATE' | 'DELETE';
}
```

`before` and `after` are not sent. They are the row's whole previous state as `jsonb`, they are
what a person investigating one change reads, and a feed of twenty of them is a screen nobody
asked for. A row in the feed says who changed which row of which table and when, and the screen
links each one to the row's own detail page where it has one.

The gateway merges the three lists, sorts by `at` descending, keeps twenty, and puts them on the
response as `activity`. It also **decorates the actor**: an `ADMIN` actor id is an
`admin_users.id`, which `adminAuth.listAdmins` already answers in full (a handful of rows, no
page), so one call resolves every row on the feed. The decorated shape adds `actorName`, which is
the admin's display name, else username, else the id itself, which is plan `0074` section 3's
rule for a name the directory cannot resolve. A `SERVICE` actor keeps its id and the screen
names the service from it, since the ids are provisioned per cluster and the app knows the
harvester's.

```ts
export interface AdminDashboardActivityEntry extends AdminActivityEntry {
  actorName: string;
}
```

Reading the trail through a **service**, never a repository in the controller. Each service gains
one method on its audit service (`recent(limit)`), which is the only new query path into the
table, so the rule that the trail is written inside the transaction that changed the row keeps
one owner.

## 5. The response

```ts
export interface AdminDashboardResponse {
  window: AdminDashboardWindow;
  identity: AdminIdentityDashboard | null;
  core: AdminCoreDashboard | null;
  catalog: AdminCatalogDashboard | null;
  harvest: AdminHarvestDashboard | null;
  /** The three trails merged, newest first, at most twenty, actors named. */
  activity: AdminDashboardActivityEntry[];
  measuredAt: string;
}
```

Published to the OpenAPI document by a `hoistAdminDashboard()` in `openapi-schema.ts`, beside
`hoistPlatformStats()` and for the same reason: no broker message has this shape, the four
blocks are the contract schemas the four subjects already define, and only the composition is
authored in the gateway. The controller is `AdminDashboardController` in
`gateway/src/app/admin/`, registered in `GatewayAdminModule`, and the fan out lives in an
`AdminDashboardService` beside it, so the controller is one method and the service is what the
spec drives with a fake `NatsClient`.

The document changes, so both generated files change with it and both are committed in this PR:

```sh
npx nx run luna-shopper-backend-gateway:openapi
npx nx run luna-shopper-admin/models:wire-types
```

`wire-types.spec.ts` is what makes forgetting the second a red build, and admin plan `0016`
reads the types the second one writes.

## 6. Where each count comes from

Every count is one aggregate query per table with `count(*) FILTER (WHERE ...)`, which is what
`StatsService.core` and `StatsService.identity` already do, extended. A daily series is one
`GROUP BY` over the window's range, and the window fill is a pure function in
`libs/luna-shopper/platform` (`fillDailyWindow(window, rows)`) that all four services import
rather than four copies of a loop that is easy to get off by one in.

| Block    | Tables read                                                                                                  |
| -------- | ------------------------------------------------------------------------------------------------------------ |
| identity | `users`, `admin_users`, `admin_login_failures`, `auth_audit`                                                 |
| core     | `zones`, `zone_memberships`, `shopping_lists`, `generated_lists`, `core_audit`                               |
| catalog  | `supermarkets`, `supermarket_locations`, `items`, `product_groups`, `supermarket_items`, `item_prices`, `catalog_audit` |
| harvest  | `harvest_runs`, `source_catalog_entries`, `discovered_places`, `source_locations`, `supermarket_sources`     |

Nothing is joined across databases and nothing is written. The queries on `item_prices` and
`source_catalog_entries` are the two that touch a table with tens of thousands of rows, and both
group on an indexed column (`observedAt` has no index today and the query is a range scan on
thirty days, which is fine at this size and is what section 1's cache remark is about if it
stops being fine).

## 7. Tests

- Each service's handler refuses a request without a valid admin token, as its other admin
  handlers do, and a spec per service says so.
- Each service's dashboard service, against the integration database: the counts match rows
  inserted by the spec, a series has thirty entries from a table with two rows in it, and the
  first and last days are the window's `from` and `to`.
- `fillDailyWindow` is pure and carries its own edge cases: an empty window, a row outside the
  window, two rows on one day.
- `AdminDashboardService` in the gateway: one subject throwing leaves that block `null` and the
  other three present, the feed is merged newest first and capped at twenty, an actor id
  `listAdmins` did not return renders as the id.
- The route is documented: `openapi-document.spec.ts` stays green after regeneration, and the
  response component names the four blocks as `oneOf` with `null`.

## 8. Exit criteria

- `GET /v1/admin/dashboard` with an admin token answers all four blocks against the compose stack,
  and answers three with `harvest: null` when the harvester is stopped.
- Every daily series has exactly thirty entries.
- `openapi.json` and `wire-types.ts` are regenerated and committed, and both specs are green.
- Auth, core, catalog and harvester each verify the credential before counting.

## 9. Out of scope

- The screen: admin plan `0016`. The chart components: admin plan `0015`.
- A window parameter, or any range other than thirty days.
- Reading `before` and `after` off an audit row, or paging any trail. A full audit viewer is a
  plan of its own.
- Caching, per section 1.
- The realtime `admin:harvest` room, which stays deferred. The run in flight is polled by the
  screen through the route the run screen already polls.
