# 0022 A section and the screens inside it

The navigation is twenty two links in one wrapping row, and `0021` makes it twenty three. Every
one of them is a peer of every other, so "Price policies" sits beside "Baskets" beside "Chain
sources" with nothing to say that the first two are never opened in the same hour. An operator
looking for the shops queue reads the whole row, because the row has no shape to skip through.

**This plan gives the navigation two levels.** Five sections on the first row, and on the second
the screens inside whichever section the operator is in. It also splits the dashboard the same
way: the screen the app opens to keeps the three things that are true of the whole system, and
each section gets a dashboard of its own holding the numbers that belong to it.

Depends on `0004` for the descriptor and the chrome, on `0006` for the harvester's hand written
screens, and on `0016` for the dashboard it takes apart. It reads the same document `0016`
reads, so **there is no backend work in this plan at all**: `GET /v1/admin/dashboard` already
answers four blocks and a feed, and this puts each block on the screen that its section owns.

`0021` is being built beside this. Section 8 is the whole of what the two owe each other.

## 1. The five sections

| Section    | Label     | Home        | Screens                                                                                                 |
| ---------- | --------- | ----------- | ------------------------------------------------------------------------------------------------------- |
| `overview` | Overview  | `/`         | none                                                                                                    |
| `catalog`  | Catalog   | `/catalog`  | Supermarkets, Shops, Price scopes, Products, Product groups, Prices, Price policies, Products in a shop |
| `shoppers` | Shoppers  | `/shoppers` | Users, Zones, Memberships, Lists, List lines, Baskets                                                   |
| `harvest`  | Harvester | `/harvest`  | Runs, Discovered places, Source products, Import a file, Source shops, Chain sources                    |
| `admins`   | Admins    | `/admins`   | Admins                                                                                                  |

Five is the number the first row can hold at a glance, and eight is the widest second row. Both
fit on one line on a laptop, which is the only claim the split has to make good on.

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
section 5 explains why.

Both labels are one line each in `en.json` and the user can overrule either without touching
anything else in this plan.

### 1.2 The paths do not move

A resource stays at `/items`, not `/catalog/items`. The section is a property of the link, not a
prefix on the URL.

Moving them rewrites every link in the app that is built from a segment: `activityTarget`,
every dashboard tile, every reference picker, `memberPath` on the two nested collections, the e2e
suites, and `0021`'s `harvest/postal-codes` which is being written right now against the paths as
they are. It also breaks every bookmark an operator has. What it buys is a URL that
states its section, and nothing on the screen needs the URL to state it, because the app knows
which section owns a screen from the same list it draws the navigation from.

The harvester keeps the `harvest/` prefix it has, which it has for its own reason (`0006`) and
not because it is a section. That the app is now mixed on this point is deliberate and stated
here so nobody tidies it.

**A section home is a new path and must not collide with a resource segment.** `/catalog`,
`/shoppers` and `/admins` collide with nothing today. `/admins` is the admins resource itself,
which is the case section 4 covers: a section with one screen has no home of its own.

## 2. How a screen says which section it is in

Two optional fields and one list.

```ts
/** In `ShellLink` (ui) and in `ResourceDescriptor` (models). */
readonly section?: string;
```

```ts
/** In the app, beside `ADMIN_RESOURCES`. */
export interface ShellSection {
  readonly key: string;
  /** A translation key. */
  readonly label: string;
  /** Where the section link goes. */
  readonly home: string;
  /** Whether `home` is matched exactly, per `AppShell`'s existing rule. */
  readonly exact?: boolean;
}

export const ADMIN_SECTIONS: readonly ShellSection[] = [
  /* the table in section 1 */
];
```

The membership is on the screen and the order is in the app, because those are two different
decisions with two different owners. A resource is declared in `feature-catalog`, and which
section it belongs to is a fact about that resource that belongs beside it, which keeps
`shell-links.ts`'s property intact: a screen and everything the navigation needs to draw it are
added in one file. The order of the sections and what they are called is the app's, exactly as
`ADMIN_RESOURCES`' order already is.

**Optional in the type, required by a spec.** Making `section` required breaks every
descriptor in every existing spec, which is a large diff to state a rule that a spec can state
in four lines. `shell-sections.spec.ts` asserts, against the real `ADMIN_RESOURCES` and the real
`SHELL_LINKS`:

- Every descriptor and every link names a section.
- Every section it names is declared in `ADMIN_SECTIONS`.
- No section's `home` equals a resource's segment, unless that section has exactly one screen and
  its home **is** that screen.
- Every declared section has at least one screen or a home component of its own.

## 3. Drawing it

`AdminShellPage` keeps its job of putting the two lists together and gains one more: working out
which section the current URL is in.

```ts
readonly sections = computed<readonly SectionView[]>(...)   // the first row
readonly screens = computed<readonly ShellLink[]>(...)      // the second row
```

The active section is the section of the longest link path that the current URL starts with. The
longest, not the first, because `/harvest` and `/harvest/runs` are both prefixes of
`/harvest/runs/abc` and only one of them is the screen. A URL matching no screen, which is the
not found page, leaves both rows drawn and neither marked: the operator is somewhere the app does
not know about, and guessing a section for them is worse than admitting it.

`AppShell` takes a second input, `screens`, and draws a second `nav` under the first when it is
not empty. It reads them and knows nothing else, exactly as it does today with `links`. The
existing `links` input becomes `sections`, and its exact matching rule moves onto `ShellSection`
as `exact`, which is what `/` needs and only `/`.

**A section with no second row draws no second row**, and the page does not shift under the
operator when it appears: the second `nav` reserves its height. A row that pushes the page down
by forty pixels on every third navigation is the sort of thing that makes a two level navigation
feel worse than the flat one it replaced.

### 3.1 On a phone

`compact` already collapses the navigation behind one button. Open, it becomes the sections as a
list, and the current section's screens indented under it. Only the current section expands: a
menu that opens twenty three links has not solved anything, and the operator who wants another
section taps it and gets its home.

Following either level closes the menu, as today.

### 3.2 A badge cannot hide inside a collapsed section

`ShellLink.badge` exists and nothing sets one today (`0010` removed the last). The rule is stated
now, before something sets one again: **a section's badge is the sum of its screens' badges**, and
`null` only when every screen it holds answers `null`. A screen that answers `0` contributes `0`,
which is the distinction `0010` section 4 drew and it survives the sum.

Work waiting behind a link an operator can no longer see is the one way this plan can make the
app worse. The sum is the answer to it.

## 4. Where a section link goes

To its home, which is either a dashboard of its own or, for a section with one screen, that
screen.

`adminRoutes` already takes an optional `home` for the empty path and already falls back to a
redirect. Sections need the same idea one level down, so each of the three section homes is an
ordinary route declared beside the screens it summarises, in the library that owns them:

- `/catalog` from `feature-catalog`, beside `CATALOG_SECTION`.
- `/shoppers` from `feature-people`.
- `/harvest` from `feature-harvest`, at the empty path under the segment it already owns.

The admins section has one screen and links straight at it. **A section with one screen gets no
dashboard**, because a dashboard summarising one list is a click between the operator and the
list, which is the whole of `0004`'s argument and it still holds at this level.

## 5. The overview keeps three things

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

Those three are what stays because each of them is a question about the whole tool rather than
about a part of it. Work waiting is every queue in the app in one place, which is the reason to
open the app at all. Failed sign ins are a fact about the tool itself. Recent activity crosses all
three trails by definition. A count of users is not any of those: it is the first line of the
shoppers dashboard, and it was on the overview only because there was nowhere else for it.

**The sign ins stay on the overview and do not move to the admins section.** They are two numbers
that are nearly always zero, and the value in them is that somebody sees them without going to
look. A screen an operator opens once a month is not that place. This is the one asymmetry in the
split and it is on purpose.

## 6. The three section dashboards

Each is a component in the library that owns its section, reading `DashboardStore` exactly as
`DashboardPage` does. The store is `providedIn: 'root'` and already re-reads once a minute while
the tab is visible, so a section dashboard subscribes to a document that is already being kept
fresh and issues no request of its own.

Every view function in `dashboard-view.ts` moves with the section that uses it, and none of them
changes. This plan is a re-arrangement of components, not of the code that shapes their inputs.
`peopleTiles`, `signUpsChart` and `zonesAndListsChart` go to `feature-people`. `catalogTiles` and
`pricesWrittenChart` go to `feature-catalog`. `recentRunRows` and `runsByStatusChart` go to
`feature-harvest`. `waitingTiles`, `loginFailureRows` and `activityRows` stay.

Where a function is now used by two libraries it goes to `models` beside `weekDelta`, which is
where the pure ones already live. Nothing is copied.

**Catalog** (`/catalog`): the catalog tiles, then the prices written chart. `catalog: null` draws
`0016` section 5's notice in place of the whole page body rather than in place of a section,
because on this screen the block is the page.

**Shoppers** (`/shoppers`): the people tiles, then the sign ups chart, then the zones and lists
chart. `core: null` the same way.

**Harvester** (`/harvest`): the run in flight with its progress bar, the last five runs, the runs
by status chart, and the sources line. Plus `0021`'s postal codes card, per section 8. This is
the one that keeps `0016`'s poll interval rule: while a run is in flight the store polls at
`RUN_POLL_INTERVAL_MS`, and the rule moves onto this screen, so a run in flight speeds the poll
up when somebody is watching it and not when they are reading the catalog. `harvest: null` the
same way as the other two.

A section dashboard whose block is `null` still draws its header and its notice. The operator
opened a section and is told which service did not answer, which is `0016` section 5's
copy, one screen further in.

## 7. Translations

One `shell.sections.*` object in `ui`'s `en.json`, five keys. The screen labels are the ones
already there: a resource's label comes from its descriptor, and the harvester's from
`harvest.nav.*`.

The three section dashboards keep the keys their content already has under `dashboard.*`, moved
under `dashboard.catalog.*`, `dashboard.shoppers.*` and `dashboard.harvest.*` where a key is now
owned by one screen, and left where it is where the overview still uses it. A section dashboard's
heading is its section's label, so no new heading key is added.

## 8. What this and `0021` owe each other

`0021` is being built now and touches three things this plan moves. All three are small and this
is the whole list:

- **Its screen names a section.** `harvest/postal-codes` is a harvester screen, which `0021`
  section 1 already argues for its own reasons, so its `ShellLink` gains `section: 'harvest'` and
  nothing else changes about it.
- **Its dashboard card lands on two screens, and that is not a duplicate.** `0021` section 6 puts
  a card on the dashboard: codes queued, codes failed, and the age of the oldest queued row. The
  **queued count is a work waiting tile on the overview**, because `0021` earns that place by
  arguing the number represents users being told velista has nothing for them, and that argument
  survives this split intact. The **card with all three numbers is on the harvester dashboard**,
  where the failures and the age belong beside the runs that produced them. One call either way:
  both read `postalCodeDiscovery.summary`, which is one request whichever screen is open.
- **The banner is unmoved.** `0021` section 4.1's "harvesting is off in this deployment" banner
  sits above the postal codes list, on the list, and this plan does not put it on a dashboard.

Whichever of the two lands first, the other rebases onto it. If `0021` lands first, this plan
moves its card and adds its section key. If this lands first, `0021` is written against the
sections that exist. Neither is blocked by the other.

## 9. Testing

- `AdminShellPage` draws the sections in `ADMIN_SECTIONS`' order and the current section's screens
  in the registry's order.
- The active section is the longest matching link path: `/harvest/runs/abc` marks Harvester and
  `Runs`, not Harvester alone.
- A URL matching no screen draws both rows and marks neither.
- The overview link is active only on `/`.
- A section with one screen links at that screen and has no home route.
- `shell-sections.spec.ts`: the four assertions of section 2, against the real lists.
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

## 10. Exit criteria

- The first row holds five entries and fits on one line at 1280 pixels. The widest second row
  holds eight and fits on the same line.
- Every screen reachable before this plan is reachable after it, at the same URL, in at most two
  clicks from anywhere.
- The overview holds work waiting, failed sign ins and recent activity, and nothing else.
- Opening the catalog, the shoppers section or the harvester shows that section's numbers with no
  request beyond the one the store already makes.
- A screenshot of the two rows and of the phone menu is in the PR.
- `npx nx test` is green for `luna-shopper-admin/feature-resource`, `feature-dashboard`,
  `feature-catalog`, `feature-people`, `feature-harvest`, `ui`, `models` and the app, and the app
  builds inside its budgets.

## 11. Out of scope

- **Moving a resource's path under its section.** Section 1.2 says why, and the day a URL has to
  state its section is the day to revisit it.
- **A third level.** Eight screens in the widest section is a row, not a tree.
- **Lists that read their filters from the URL**, which `0016` also left out and which is what
  lets a work waiting tile open a list already filtered.
- **Making the sections configurable per operator**, or remembering which section was last open.
  The app opens on the overview, every time.
- **A screen for the failed sign ins.** There is no route that lists them. The dashboard document
  carries the recent ones and that is all there is to draw.
