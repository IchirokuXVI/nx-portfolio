# 0022 A section and the screens inside it

The navigation is twenty three links in one wrapping row. Every one of them is a peer of every
other, so "Price policies" sits beside "Baskets" beside "Chain sources" with nothing to say that
the first two are never opened in the same hour. An operator looking for the shops queue reads
the whole row, because the row has no shape to skip through.

**This plan gives the navigation two levels.** Five sections on the first row, and on the second
the screens inside whichever section the operator is in. A section is a real branch of the route
table, so a screen's URL says which section it is in. It also splits the dashboard the same way:
the screen the app opens to keeps the three things that are true of the whole system, and each
section gets a dashboard of its own holding the numbers that belong to it.

Depends on `0004` for the descriptor and the chrome, on `0006` for the harvester's hand written
screens, on `0016` for the dashboard it takes apart, and on `0021` for the postal codes screen it
moves into a section. It reads the same document `0016` reads, so **there is no backend work in
this plan at all**: `GET /v1/admin/dashboard` already answers four blocks and a feed, and this
puts each block on the screen that its section owns.

## 1. The five sections

| Section    | Label     | Segment    | Home        | Screens                                                                                                 |
| ---------- | --------- | ---------- | ----------- | ------------------------------------------------------------------------------------------------------- |
| `overview` | Overview  | none       | `/`         | none                                                                                                    |
| `catalog`  | Catalog   | `catalog`  | `/catalog`  | Supermarkets, Shops, Price scopes, Products, Product groups, Prices, Price policies, Products in a shop |
| `shoppers` | Shoppers  | `shoppers` | `/shoppers` | Users, Zones, Memberships, Lists, List lines, Baskets                                                   |
| `harvest`  | Harvester | `harvest`  | `/harvest`  | Runs, Discovered places, Source products, Import a file, Source shops, Chain sources, Postal codes      |
| `admins`   | Admins    | none       | `/admins`   | Admins                                                                                                  |

Five is the number the first row holds at a glance, and eight is the widest second row. Both fit
on one line on a laptop, which is the only claim the split has to make good on.

### 1.1 Core is called Shoppers, and Auth is called Admins

`Core` and `Auth` are the names of two backend deployments. They are the right names in
`values.staging.yaml` and in a NATS subject, and they are the wrong names on a tab, because a tab
names what the operator is about to look at and nobody is about to look at a deployment.

The section holds users, zones, memberships, lists, list lines and baskets: the people who use
velista and the things they own together. **Shoppers** names them. Three that were considered and
are not used:

- **People**, which is `0007`'s own title, and reads well until the section next to it is full of
  admins, who are also people.
- **Users**, which is one of the six screens inside it. A section and one of its members cannot
  carry the same word without an operator having to learn which is which.
- **Accounts**, because an account is the auth idea and Auth is the next section along.

**Admins** for the auth section by the same rule, and because the section is the admin account
table and nothing else. The failed sign ins that auth also answers stay on the overview, where
section 6 explains why.

Both labels are one line each in `en.json` and the user can overrule either without touching
anything else in this plan.

### 1.2 The paths move, and two sections do not move at all

A resource moves from `/items` to `/catalog/items`. The section is a branch of the route table,
not a label sitting beside one.

The alternative was a section that groups the navigation and leaves every path where it is. It is
rejected on the reading it produces. An operator who lands on `/list-lines` from a link, a
bookmark or the browser's own history cannot tell which of five sections drew that screen. The
second row of the navigation becomes the only thing that says so, and it says so only while the
tab is open. A URL is the one part of a screen that survives being sent to somebody, pasted into
an issue, or reopened a week later.

The usual argument against moving is the cost of it. **There is no such cost here.** This app has
one operator, they have said the bookmarks do not matter, and nothing outside the app links into
it. Staging and production run the same app, and the only inbound link anybody has is the root.

Two of the five sections move nothing:

- **Harvest** already owns `harvest/` and keeps it. `0006` gave it that prefix for its own
  reasons, and this plan makes the reason general rather than particular to one section.
- **Admins** has one screen, so a segment of its own puts the admins list at `/admins/admins`.
  **A section with one screen has no segment**, and its link points straight at its only screen.
  This is the same rule section 5 states about a section dashboard, from the same argument.

So fourteen screens move: eight in the catalog and six in the shoppers section. Section 3 is the
whole of what moving them touches.

## 2. A section is a route branch

`adminRoutes` today takes the resources, the hand written screens, and the home. It gains a shape
that says which of those belong together:

```ts
export interface AdminSection {
  readonly key: string;
  /** A translation key for the tab. */
  readonly label: string;
  /** The URL segment this section owns. Absent for a section with one screen. */
  readonly segment?: string;
  /** The screen at the section's own path. */
  readonly home?: Type<unknown>;
  /** Resources mounted under the segment, in navigation order. */
  readonly resources?: readonly AnyResourceDescriptor[];
  /** Hand written screens under the segment. */
  readonly screens?: readonly Route[];
  /** Navigation entries for those hand written screens. */
  readonly links?: readonly ShellLink[];
}

export function adminRoutes(sections: readonly AdminSection[], home?: Type<unknown>): Route[];
```

A section builds one branch:

```ts
{
  path: section.segment ?? '',
  children: [
    ...(section.resources ?? []).flatMap(resourceRoutes),
    ...(section.screens ?? []),
    ...(section.home ? [{ path: '', pathMatch: 'full', component: section.home }] : []),
  ],
}
```

`resourceRoutes` is unchanged, and that is the point: **a descriptor still knows only its own
segment.** Where it is mounted is the section's business, exactly as `0021` already mounts
`POSTAL_CODES` inside `harvestRoutes` and passes it through `resourceRoutes` untouched. That hand
mount is the mechanism this plan makes general, so it stops being a special case and becomes how
every resource is mounted.

`ADMIN_RESOURCES` and `SHELL_LINKS` are replaced by one `ADMIN_SECTIONS` in the app, holding the
order, the labels, the segments and the members. The list stays the app's, for the reason
`ResourceRegistry` already gives: it is the app that decides which screens exist.

**Every mounted resource is registered.** `provideResources` is fed from the sections rather than
from a second list, so a descriptor mounted in a section is in the registry. Today `POSTAL_CODES`
is mounted and not registered, so a reference field pointing at postal codes finds nothing and has
nothing to say about why. Nothing points at it yet, and the fix costs one line once the sections
own both lists.

`shell-sections.spec.ts` asserts, against the real `ADMIN_SECTIONS`:

- Every section has at least one screen, counting its home.
- A section with exactly one screen and no home has no segment.
- No two sections share a segment, and no section's segment equals a resource segment mounted at
  the root.
- Every descriptor in the registry is mounted by exactly one section.

## 3. Nothing builds a resource link from a segment

Moving fourteen screens breaks every link that was built by hand from a resource's segment. There
are seven such places today. The fix is the same one everywhere: **ask the registry where a
resource lives**.

```ts
/** On `ResourceRegistry`. */
pathOf(name: string): string[] | null;
```

It answers `['/', 'catalog', 'items']` for `items`, and `null` for a resource this app did not
mount. The registry is the right owner because it is built from the same sections that declare
the routes, so a path it answers is a path that exists. It already resolves a descriptor by name
for the reference picker, and this is the same question asked about the URL instead of the rows.

The seven places, and what each becomes:

| Today                                                   | After                                     |
| ------------------------------------------------------- | ----------------------------------------- |
| `admin-shell-page.ts`, `` `/${descriptor.segment}` ``   | the registry, per section                 |
| `zone-detail-page.ts`, `` `/${MEMBERSHIPS.segment}` ``  | `pathOf('memberships')`                   |
| `list-detail-page.ts`, `` `/${LIST_LINES.segment}` ``   | `pathOf('list-lines')`                    |
| `import-upload-page.ts`, `['/', 'price-scopes', 'new']` | `pathOf('price-scopes')`, then `'new'`    |
| `dashboard-view.ts`, nine literal tile links            | a `PathOf` parameter, per section 7       |
| `dashboard-page.ts`, the two harvester links            | unchanged, they use `HARVEST_SEGMENT`     |
| `activity-target.ts`, its own `SEGMENTS` map            | the map keeps table to resource name only |

The generic resource pages need nothing. `ResourceListPage` and `ResourceFormPage` build every hop
with `relativeTo`, so a row link, a create link and the way back out of a form all follow the mount
wherever it goes. That is fourteen screens' worth of navigation that moves for free, and it is
why this change is seven places rather than seventy.

**`activityTarget` gets better rather than only different.** Its `SEGMENTS` map is a second, hand
written copy of the segment list, and it drifts silently the day a segment is renamed. After this
it maps an audit table to a **resource name**, which is real knowledge that lives nowhere else
(`shopping_lists` is the table and `lists` is the screen), and the path comes from the registry.
It stays pure and takes the resolver as an argument, the way `dashboard-view.ts` already takes
`Translate` and `NameChain`.

A hand written screen keeps the constant pattern it has: `HARVEST_SEGMENT` from
`harvest-paths.ts`, which every harvester link already builds from. The two sections that gain a
segment export theirs the same way, for the same use.

**One scan spec keeps it true.** `no-literal-resource-path.spec.ts`, in the spirit of velista's
`no-unguarded-history-back.spec.ts`, reads the admin scope and the app and names any file that
builds a router link from a bare resource segment. Without it the next screen written adds an
eighth place by hand and nobody notices until a section moves again.

## 4. Drawing it

`AdminShellPage` keeps its job of putting the navigation together and gains one more: working out
which section the current URL is in.

```ts
readonly sections = computed<readonly SectionView[]>(...)   // the first row
readonly screens = computed<readonly ShellLink[]>(...)      // the second row
```

The active section is the section whose link path is the longest prefix of the current URL. The
longest, not the first, because `/harvest` and `/harvest/runs` are both prefixes of
`/harvest/runs/abc` and only one of them is the screen. A URL matching no screen, which is the
not found page, leaves both rows drawn and neither marked: the operator is somewhere the app does
not know about, and guessing a section for them is worse than admitting it.

`AppShell` takes a second input, `screens`, and draws a second `nav` under the first when it is
not empty. It reads them and knows nothing else, exactly as it does today with `links`. The
existing `links` input becomes `sections`, and its exact matching rule moves onto the section as
`exact`, which is what `/` needs and only `/`.

**A section with no second row draws no second row**, and the page does not shift under the
operator when it appears: the second `nav` reserves its height. A row that pushes the page down
by forty pixels on every third navigation makes a two level navigation feel worse than the flat
one it replaced.

### 4.1 On a phone

`compact` already collapses the navigation behind one button. Open, it becomes the sections as a
list, and the current section's screens indented under it. Only the current section expands: a
menu that opens twenty three links has not solved anything, and the operator who wants another
section taps it and gets its home.

Following either level closes the menu, as today.

### 4.2 A badge cannot hide inside a collapsed section

`ShellLink.badge` exists and nothing sets one today (`0010` removed the last). The rule is stated
now, before something sets one again: **a section's badge is the sum of its screens' badges**, and
`null` only when every screen it holds answers `null`. A screen that answers `0` contributes `0`,
which is the distinction `0010` section 4 drew and it survives the sum.

Work waiting behind a link an operator can no longer see is the one way this plan makes the app
worse. The sum is the answer to it.

## 5. Where a section link goes

To its home, which is either a dashboard of its own or, for a section with one screen, that
screen.

The three section dashboards are ordinary routes at the empty path of their branch, declared in
the library that owns the section: `/catalog` from `feature-catalog`, `/shoppers` from
`feature-people`, `/harvest` from `feature-harvest`.

The admins section has one screen and links straight at it. **A section with one screen gets no
dashboard**, because a dashboard summarising one list is a click between the operator and the
list, which is the whole of `0004`'s argument and it still holds at this level.

## 6. The overview keeps three things

The screen the app opens to answers what is true of the system, not what is true of one section.
After this plan it holds, top to bottom:

1. **The header.** `measuredAt`, the refresh button, and the stale notice. Unchanged from `0016`
   section 3.1.
2. **Work waiting.** `0016` section 3.2 whole, plus `0021`'s postal codes.
3. **Failed admin sign ins.** `0016` section 3.6 whole: the two numbers and the short table.
4. **Recent activity.** `0016` section 3.7 whole.

And it loses the counts and the charts: users, zones, lists and baskets go to the shoppers
dashboard, the catalog counts and the prices written chart go to the catalog dashboard, and the
run in flight, the recent runs, the runs by status chart and the sources line go to the harvester
dashboard.

Those three are what stays because each is a question about the whole tool rather than about a
part of it. Work waiting is every queue in the app in one place, which is the reason to open the
app at all. Failed sign ins are a fact about the tool itself. Recent activity crosses all three
audit trails by definition. A count of users is not any of those: it is the first line of the
shoppers dashboard, and it was on the overview only because there was nowhere else for it.

**The sign ins stay on the overview and do not move to the admins section.** They are two numbers
that are nearly always zero, and the value in them is that somebody sees them without going to
look. A screen an operator opens once a month is not that place. This is the one asymmetry in the
split and it is on purpose.

## 7. The three section dashboards

Each is a component in the library that owns its section, reading `DashboardStore` exactly as
`DashboardPage` does. The store is `providedIn: 'root'` and already re-reads once a minute while
the tab is visible, so a section dashboard reads a document that is already being kept fresh and
issues no request of its own.

Every view function in `dashboard-view.ts` moves with the section that uses it, and none of them
changes except to take `PathOf` where it held a literal path. `peopleTiles`, `signUpsChart` and
`zonesAndListsChart` go to `feature-people`. `catalogTiles` and `pricesWrittenChart` go to
`feature-catalog`. `recentRunRows` and `runsByStatusChart` go to `feature-harvest`.
`waitingTiles`, `loginFailureRows` and `activityRows` stay. Where a function is used by two
libraries it goes to `models` beside `weekDelta`, which is where the pure ones already live.
Nothing is copied.

**Catalog** (`/catalog`): the catalog tiles, then the prices written chart. `catalog: null` draws
`0016` section 5's notice in place of the whole page body rather than in place of a section,
because on this screen the block is the page.

**Shoppers** (`/shoppers`): the people tiles, then the sign ups chart, then the zones and lists
chart. `core: null` the same way.

**Harvester** (`/harvest`): the run in flight with its progress bar, the last five runs, the runs
by status chart, and the sources line. Plus `0021`'s postal codes card, per section 9. This is the
one that keeps `0016`'s poll interval rule: while a run is in flight the store polls at
`RUN_POLL_INTERVAL_MS`, and the rule moves onto this screen, so a run in flight speeds the poll up
when somebody is watching it and not when they are reading the catalog. `harvest: null` the same
way as the other two.

A section dashboard whose block is `null` still draws its header and its notice. The operator
opened a section and is told which service did not answer, which is `0016` section 5's copy, one
screen further in.

## 8. Translations

One `shell.sections.*` object in `ui`'s `en.json`, five keys. The screen labels are the ones
already there: a resource's label comes from its descriptor, and the harvester's from
`harvest.nav.*`.

The three section dashboards keep the keys their content already has under `dashboard.*`, moved
under `dashboard.catalog.*`, `dashboard.shoppers.*` and `dashboard.harvest.*` where a key is now
owned by one screen, and left where it is where the overview still uses it. A section dashboard's
heading is its section's label, so no new heading key is added.

## 9. What this and `0021` owe each other

`0021` is built and open in PR #277. It is not merged, so this plan is written against it and
rebases onto it. Four things:

- **Its screen does not move.** `harvest/postal-codes` is already inside the harvester's branch,
  which is where this plan puts it.
- **Its hand mount becomes the mechanism.** `0021` calls `resourceRoutes(POSTAL_CODES)` inside
  `harvestRoutes` and explains in a comment why a resource is mounted somewhere other than the
  app's flat list. After this plan that is how every resource is mounted, so the comment shortens
  to a line and the special case is gone.
- **Its descriptor joins the registry.** `POSTAL_CODES` is mounted and not registered today, per
  section 2. Nothing points at it yet, so nothing is broken, and the sections fix it by owning
  both lists.
- **Its dashboard card lands on two screens, and that is not a duplicate.** `0021` section 6 puts
  a card on the dashboard: codes queued, codes failed, and the age of the oldest queued row. The
  **queued count is a work waiting tile on the overview**, because `0021` earns that place by
  arguing the number represents users being told velista has nothing for them, and that argument
  survives this split intact. The **card with all three numbers is on the harvester dashboard**,
  where the failures and the age belong beside the runs that produced them. One call either way:
  both read `postalCodeDiscovery.summary`, which is one request whichever screen is open.

`0021` section 4.1's "harvesting is off in this deployment" banner sits above the postal codes
list, on the list, and this plan does not put it on a dashboard.

## 10. Testing

- `adminRoutes` mounts a section's resources under its segment, its hand written screens beside
  them, and its home at the empty path of the branch.
- A section with no segment mounts its screens at the root, and `/admins` still draws the admins
  list.
- Every route reachable before this plan is reachable after it, at the path the table in section 1
  gives. `routes.spec.ts` asserts the whole list rather than a sample.
- `shell-sections.spec.ts`: the four assertions of section 2, against the real `ADMIN_SECTIONS`.
- `pathOf` answers the mounted path for every registered resource and `null` for a name nobody
  mounted.
- `no-literal-resource-path.spec.ts` names a file that builds a link from a bare segment, and
  passes on the scope as this plan leaves it.
- `activityTarget` maps each audit table of `0016` section 3.7 to a path through a resolver, and
  answers `null` for a table with no screen and for a resolver that does not know the resource.
- The active section is the longest matching link path: `/harvest/runs/abc` marks Harvester and
  `Runs`, not Harvester alone.
- A URL matching no screen draws both rows and marks neither.
- The overview link is active only on `/`.
- A section's badge is the sum of its screens', and `null` when every screen answers `null`.
- Compact: the menu lists the sections, the current one expands, the others do not, and following
  either level closes it.
- Against `DashboardMemory`: the overview draws work waiting, sign ins and activity, and draws no
  people, catalog or harvester numbers. Each section dashboard draws its own and no other's.
- A document with `harvest: null` draws the notice on the harvester dashboard and leaves the
  overview's work waiting tiles for the other queues.
- The store polls at the run interval while the harvester dashboard shows a run in flight, and at
  the dashboard interval on every other screen.
- Assert on component inputs, never on rendered interpolated text.

## 11. Exit criteria

- The first row holds five entries and fits on one line at 1280 pixels. The widest second row
  holds eight and fits on the same line.
- Every screen reachable before this plan is reachable after it, in at most two clicks from
  anywhere, at the path section 1 gives.
- A URL says which section drew the screen, for every screen except the four that section 1.2
  keeps at the root.
- No link in the app leads to a path that no longer exists. The scan spec and `routes.spec.ts`
  are what prove it, and clicking every navigation entry against the compose stack is what
  confirms it.
- The overview holds work waiting, failed sign ins and recent activity, and nothing else.
- Opening the catalog, the shoppers section or the harvester shows that section's numbers with no
  request beyond the one the store already makes.
- A screenshot of the two rows and of the phone menu is in the PR.
- `npx nx test` is green for `luna-shopper-admin/feature-resource`, `feature-dashboard`,
  `feature-catalog`, `feature-people`, `feature-harvest`, `ui`, `models` and the app, and the app
  builds inside its budgets.

## 12. Out of scope

- **A third level.** Eight screens in the widest section is a row, not a tree.
- **Redirects from the old paths.** They double the route table to serve one operator who has said
  the bookmarks do not matter, and each one outlives the reason it was added.
- **Lists that read their filters from the URL**, which `0016` also left out and which is what
  lets a work waiting tile open a list already filtered.
- **Making the sections configurable per operator**, or remembering which section was last open.
  The app opens on the overview, every time.
- **A screen for the failed sign ins.** There is no route that lists them. The dashboard document
  carries the recent ones and that is all there is to draw.
