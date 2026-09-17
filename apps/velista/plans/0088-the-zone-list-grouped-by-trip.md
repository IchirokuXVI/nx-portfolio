# 0088: the zone list grouped by trip

> Backend half: `apps/luna-shopper-backend/plans/0122`, which must be merged first.
> Mock: `mocks/list-trips/`, published at https://claude.ai/artifact/2g3FFABu4JMAt8RLrdLgFR.
>
> A zone list is one flat column today. A line bought last week and a line wanted now sit
> side by side, told apart by a number and a muted name, and the page cannot say what a
> shopping trip took, what it left, or what it did not find. This plan makes the grouped
> view the zone list's default and only view: what is still to buy comes first, then the
> baskets being shopped right now, then every past trip under its name and date, folded
> until somebody opens it. A line appears in every trip that touched it and is still one
> line.
>
> Prerequisite reading: `0043` (the line is a quantity, and section 1.1 on what was taken
> back), `0060` (the header sentence), `0082` (search, order, the category view, the
> reorder hold), backend `0122` in full, and `libs/velista/feature-lists/src/lib/list-page/`.

## Brief for the agent

### Objective

Draw the zone list page as the groups of sections 2 to 8, reading trips through a new
store, with the group fold animated and accessible, and keep search, A to Z, the category
view and reorder working under the rules of sections 6 and 7.

### Context

- `ListPage` draws `lib-list-header`, `lib-list-tools` and one `lib-line-list` over
  `ListViewStore.compose(page.lines)`. `LineStore` (`data-access/src/lib/lines/`) loads
  **every** line, 100 at a time, in a background loop. Search, the counts and `canReorder`
  depend on that and it does not change.
- A line's state is its `quantity`. `isSettled` is `quantity === 0 && boughtCount > 0`.
  `Line.claimed` is true while a live basket holds the line with units outstanding.
- Backend `0122` serves `GET /v1/lists/:id/trips` (`live`, `items`, `nextCursor`),
  `GET /v1/lists/:id/trips/:kind/:tripId/rows`, and `list.tripsChanged` in the list room.
  A row carries `lineId`, `asked`, `bought`, `left`, `outcome`, `settledByUserId`, and no
  name.
- `line.settled` and `line.claimChanged` already reach the page through the zone room.
- `LineStore.reorder()` sends the whole `orderedLineIds`, and the server renumbers only the
  lines it names.
- There is no accordion in `velista/ui`. `ShareRow` and the group tree in `get-list-sheet`
  are the house disclosure patterns (`aria-expanded` on a real button over a region).
- The memory note on stale answers: a store that refetches on an event must drop an answer
  that a newer request overtook. `0086` added a generation counter for exactly this.

### Target state

Sections 2 to 9 hold on the zone list page at a phone viewport in both themes, the basket
page is untouched, and
`npx nx run-many -t lint test -p velista/ui velista/models velista/data-access velista/feature-lists velista/feature-shell`
plus `npx nx build velista` are green.

### Scope

- Work only in: `libs/velista/models/src/lib/` (trip models, `compose-list-view.ts` or a
  sibling), `libs/velista/data-access/src/lib/` (a `trips/` folder: client, mapper, store),
  `libs/velista/ui/src/lib/list/` (a trip group, a trip row), `libs/velista/feature-lists/`
  (the page, its selector, its specs), the two translation files, and the e2e specs that
  name the list page.
- Do NOT touch: any backend project, the basket pages, `LineStore`'s paging, the line
  detail sheet, the line page.

### Constraints

- Use the `nx-portfolio-angular-developer` skill, and the `design-taste-frontend` skill for
  the group head, the fold and the trip row. The mock is the reference for both.
- Rule D4: trips and rows are mapped from `unknown` into models this scope owns. Rule D1:
  only the page injects stores.
- Nothing per app imports `@angular/core/rxjs-interop`.
- Dates through `Intl`, never `DatePipe`. Tokens only, no literal colour.
- Motion uses `--app-motion-slow` and the house ease, and is zero under
  `prefers-reduced-motion` through the tokens alone.
- Only make the changes this plan names. No suggestion is drawn here (`0089`).

### Action boundaries

- Proceed with in scope edits, specs and a front end slot pointed at a backend that has
  `0122`.
- Stop and ask if `0122` is not merged, if reorder cannot keep the positions of the lines
  it does not show (section 7), or if an e2e suite needs more than selector changes.

### Progress evidence

Report after the models and the store with their specs, after the composed view, after the
group and row components, and after the page with its e2e run. Each report names the run.

## 1. What is being built

| Piece                                   | Where                                                        |
| --------------------------------------- | ------------------------------------------------------------ |
| `Trip`, `TripRow`, their mappers        | `models`, `data-access/src/lib/trips/`                       |
| `TripStore`: heads, rows, refetch       | `data-access/src/lib/trips/`                                 |
| The grouped view as a pure function     | `models/src/lib/compose-list-view.ts`                        |
| `lib-trip-group` and `lib-trip-row`     | `libs/velista/ui/src/lib/list/`                              |
| The page draws groups                   | `feature-lists` `list-page.*`, `select-list-state.ts`        |
| Search, order, category, reorder rules  | sections 6 and 7                                             |
| Copy                                    | `en.json`, `es.json`                                         |

## 2. The groups, in order

1. **To buy.** Always first, always open, never foldable. Its heading holds the reorder
   action.
2. **Live trips**, newest first. The newest is open when the page loads and every other
   one is closed. There are usually none and rarely two.
3. **Past trips**, newest first, all closed. A basket trip is labelled with its name and
   its date, or with the date alone when it has no name. A loose trip is labelled "Loose
   buys" and its date. A name that repeats the date is accepted for now.
4. **"Show older trips"**, a button, while `nextCursor` is not null.

An empty history draws nothing under To buy: no heading, no empty state.

## 3. What goes in To buy

- Every line with `quantity > 0` that is **not** `claimed`, in the list order.
- Then, last, every line with `quantity === 0` and `boughtCount === 0`. Such a line has no
  purchase to be grouped under, and it has to stay reachable so somebody can raise it or
  delete it. It draws as any row at zero draws today. The product owner knows a pending
  line at zero is odd and will revisit it.
- Rejected lines keep sorting last of all, with their decision buttons, as today.
- A claimed line leaves To buy and is drawn by the live trip that holds it. If that trip's
  rows have not arrived yet, the line stays in To buy with its "is buying this" indicator
  until they do, so no line is ever on neither side.
- A line at zero **with** purchases is in no live group. It lives in its trips, and search
  finds it (section 6).

Rows here are `lib-line-row`, unchanged: the reel, the indicators, the decisions.

## 4. A trip group

**The head** is a real `button` with `aria-expanded` and `aria-controls`: a caret, the
label, and a count on the right. A basket trip counts "`boughtLineCount` of `lineCount`
bought". A loose trip counts its lines. A live trip also carries the live dot and "Marta is
buying now", the name being the owner the claimed lines already name, or the nameless form
when `claimedByUserId` is null.

**The fold.** The region animates between `grid-template-rows: 0fr` and `1fr` over
`--app-motion-slow`, and the caret turns a quarter. While closed the region is `inert`, so
nothing inside takes focus or is read. Opening never moves the scroll position.

**Rows load on first open** and stay loaded for the visit. Until they arrive the region
holds `lineCount` skeleton rows at `--app-line-row-height`, so the fold opens to its final
height once and does not jump. The store then reads every page of that trip's rows.

**What is open is remembered for the visit**, in `ListViewStore`, and never stored.

## 5. A trip row

`lib-trip-row`, **read only**. A trip row is a fact about a trip, and the one place the
live quantity changes is To buy.

- The name comes from the line in `LineStore`, joined on `lineId`. A row whose line is not
  held is not drawn.
- On the right, where the reel sits on a line row: `left` as the number, muted when zero,
  and under it "bought 3 of 6", or "bought 3" on a loose row where `asked` is null.
- One indicator by `outcome`, using the shapes and roles `0043` section 3.3 already fixed:
  `BOUGHT` the tick, `PARTLY` the tick with "Bought some", `NOT_AVAILABLE` the cross,
  `NOT_BOUGHT` plain muted text "Was on the list, nobody bought it". In a live trip, a row
  whose line is `claimed` shows the claimed indicator instead of `NOT_BOUGHT`.
- A loose row names the buyer after "Bought", resolved from the zone's members, and leaves
  it off when `settledByUserId` is null.
- **Live trips only:** when the line's current `quantity` differs from `left`, a caption
  says "The list now asks for 4". The basket holds a copy taken when it was composed, and
  this one sentence is all the page says about the difference until the improvements phase
  makes the basket follow the list.
- Tapping a row opens the line detail sheet, exactly as a line row does.
- Past rows are quieter than live rows: no raised surface, secondary text. Never struck
  through (`0043`).

## 6. Search, A to Z and the category view

- **Search flattens the page.** While a query is active the groups are not drawn. The page
  draws every matching line once, as a `lib-line-row` with its reel, in the current order.
  Every line is in memory and trip rows are not, so this is the one search that is both
  honest and cheap, and it is how a line at zero that lives only in old trips is found and
  raised again. Clearing the query puts the groups back as they were.
- **A to Z** orders To buy, and the rows inside every open trip. Trips stay newest first.
- **The category view** filters To buy and the rows inside every trip to that category. A
  trip left with no row is not drawn. The one category heading of `0082` sits above To buy.
- The filter badge, the sheet and what is remembered do not change.

## 7. Reorder orders what is to buy

- Reorder mode draws To buy alone, without the zero lines of section 3 and without any
  trip. The hold of `0082` section 7 and its message stay as they are.
- On a drop the page sends the **whole** order, as today: the reordered lines take, in
  their new order, the slots they held among all the list's lines, and every other line
  keeps its slot. No line hidden from the person moves, and no backend change is needed.
- `canReorder` still needs the complete list and more than one line in To buy.

## 8. Loading and staying current

- `TripStore.load(listId)` reads the first page when the page opens, beside the lines.
  The rows of the newest live trip are read at once, because that group is open.
- **One signal, three sources.** `list.tripsChanged`, `line.settled` for a line of this
  list, and `line.claimChanged` naming a line of this list all mean the same thing: read
  the first page of heads again, and the rows of every trip that is open or live. Coalesce
  a burst into one read after a short quiet, and drop any answer a newer request overtook.
- Heads already paged in are kept. A head the fresh first page no longer holds, and that no
  later page holds either, is dropped. A rows read that answers not found drops its group
  and asks for the heads again: a loose trip's id can disappear when a purchase is undone.
- A refetch is quiet. No skeleton and no spinner once a group has rows.
- A failed heads read leaves To buy fully usable and says so under it with a retry, the
  way the page already reports a failed load. It never blocks the lines.
- The header sentence and the bar (`0060`) do not change. They count lines, not groups.

## 9. Copy

| Key                         | English                           | Spanish                                   |
| --------------------------- | --------------------------------- | ----------------------------------------- |
| `list.trips.toBuy`          | To buy                            | Por comprar                               |
| `list.trips.loose`          | Loose buys                        | Compras sueltas                           |
| `list.trips.labelNamed`     | {{name}} · {{date}}               | {{name}} · {{date}}                       |
| `list.trips.bought`         | {{bought}} of {{total}} bought    | {{bought}} de {{total}} comprados         |
| `list.trips.lines`          | {{count}} lines                   | {{count}} líneas                          |
| `list.trips.liveBy`         | {{name}} is buying now            | {{name}} está comprando                   |
| `list.trips.live`           | Somebody is buying now            | Alguien está comprando                    |
| `list.trips.older`          | Show older trips                  | Ver compras anteriores                    |
| `list.trips.failed`         | The past trips did not load.      | No se han cargado las compras anteriores. |
| `list.trips.row.boughtOf`   | bought {{bought}} of {{asked}}    | {{bought}} de {{asked}} comprados         |
| `list.trips.row.bought`     | bought {{bought}}                 | {{bought}} comprados                      |
| `list.trips.row.partly`     | Bought some                       | Comprado en parte                         |
| `list.trips.row.notBought`  | Was on the list, nobody bought it | Estaba en la lista y nadie lo compró      |
| `list.trips.row.boughtBy`   | Bought · {{name}}                 | Comprado · {{name}}                       |
| `list.trips.row.nowAsks`    | The list now asks for {{count}}   | La lista pide ahora {{count}}             |

Reuse `line.indicator.*` for the tick, the cross and the claimed dot. Plural forms follow
whatever the translator already does for `list.header.pending`.

## 10. Accessibility

- To buy and every trip label are headings one level below the page title, and a trip's
  heading wraps its button, the disclosure pattern.
- The count in a head is part of the button's name. The live dot is decorative and the
  words beside it are not.
- A closed region is `inert`. An opening region does not take focus.
- The trip row is a button named by the line, then the outcome, then the numbers in words.
- "Show older trips" keeps focus where it was and announces how many trips arrived through
  the page's polite status element.

## 11. Not in this plan

- Suggestions in To buy: `0089`.
- Sending a line added during a trip to the live basket. On hold.
- The basket following a quantity raised on the list. First item of the improvements
  phase.
- A better home for lines at zero that were never bought.
- More than one live trip open at once, and forgetting a basket sooner than its 60 hours.

## 12. Tests

1. The mappers refuse a malformed trip and a malformed row, and fall back on an unknown
   `kind` and `outcome` as rule D4 requires.
2. The composed view: a claimed line is in its live trip and not in To buy. It stays in To
   buy while that trip's rows are missing. A zero line with no purchase is last in To buy.
   A zero line with purchases is in neither.
3. Two live trips: the newer is open, the older closed. No live trip: every group closed.
4. A named trip, an unnamed trip and a loose trip each draw their label, dates through
   `Intl` in the locale.
5. Each `outcome` draws its indicator, and a claimed row in a live trip draws the dot.
6. `nowAsks` appears only in a live trip and only when the numbers differ.
7. The head is a button with `aria-expanded`. The closed region is `inert`. Opening asks
   for rows once, and a second opening asks for nothing.
8. Three signals in a burst cause one heads read, and an overtaken answer is dropped.
9. A not found rows answer drops the group and reads the heads.
10. Search draws flat rows with reels and no group, and clearing it restores what was open.
11. A to Z orders rows inside an open trip and leaves the trips in date order. A category
    hides a trip with no row in it.
12. Reorder mode shows To buy alone, and the order sent keeps every unseen line in its
    slot.
13. A failed heads read leaves the lines usable and offers a retry.
14. `no-unguarded-history-back.spec.ts`, `token-hygiene.spec.ts` and `routes.spec.ts` stay
    green.

## 13. Acceptance criteria

- [ ] The zone list opens on To buy, then live trips, then past trips, newest first.
- [ ] A past trip shows only its label until tapped, and opens with a short animation.
- [ ] The newest live trip is open on arrival.
- [ ] One line can appear in many trips, and every appearance opens the same line.
- [ ] A trip row says what that trip left and what it bought, and never changes with the
      line's live quantity.
- [ ] Purchases made by hand appear under "Loose buys" and a date.
- [ ] Lines are reordered inside To buy only, and nothing else moves.
- [ ] Search reaches every line of the list, in a trip or not.
- [ ] The page costs one heads read and one rows read on arrival, however long the history.

## 14. Verification

```sh
npx nx run-many -t lint test -p velista/ui velista/models velista/data-access velista/feature-lists velista/feature-shell
npx nx build velista
tools/dev/ng-slot.sh --list
bash k8s/e2e/luna-shopper-backend/luna-slot.sh --list
tools/dev/ng-slot.sh --up --apps shell,velista
```

On the slot, with two accounts in one group (memory note on the two account browser
recipe): compose a basket from the list, settle one line fully, one partly and one as not
in the shop, settle a fourth by hand from the list, finish the basket, and check every
group at a phone viewport in both themes. Then run the velista e2e suites that open a zone
list, and give the slots back.
