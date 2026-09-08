> **PR:** [#273](https://github.com/IchirokuXVI/nx-portfolio/pull/273)

# 0020 A queue is also a list

Three screens in the harvester section review rows a run produced, and each one picked a shape and
kept it.

| Screen            | Shape today                         | Missing       |
| ----------------- | ----------------------------------- | ------------- |
| `harvest/entries` | `QueueFrame`, one row at a time     | a list        |
| `harvest/places`  | `QueueFrame`, one row at a time     | a list        |
| `harvest/shops`   | a list of rows with per row actions | one at a time |

Both shapes are right, for different work. One at a time is right when each row is a judgement:
`0006` section 5 argues it well, and the argument holds. A list is right when the rows are alike and
the answer is the same for all of them, which is the ordinary end of a crawl, where two hundred rows
are obviously not products this shop tracks and each one costs a separate press.

**This plan gives all three screens both views, and gives the list view a checkbox per row.** It adds
no route and no backend call. What it adds is a second way to spend the calls that already exist.

Depends on `0006` for the queue frame, on `0011` for the shops screen and on `0014` for the one
entries queue. `0018` fixes the invisible reject button on the queue frame, and this plan assumes it
landed.

## 1. Two views, one store, one URL

`QueueFrame` (`libs/luna-shopper-admin/ui/src/lib/harvest/queue-frame.ts`) already owns everything
the two views share: the title, the tally, the loading, failed and empty states, and the action bar's
position. It gains a **view toggle** in its header, a second content slot, and a rule about the bar:

- **Review**, the default and unchanged: the projected subject, and the confirm, reject and skip bar.
- **List**: the projected rows, and a **selection bar in the same fixed position**. Same place on the
  screen, same size, same reachability by thumb. An operator who has learned where the buttons are
  does not have to learn it twice.

The view is a query parameter, `view=review` or `view=list`. A reload keeps it, a link carries it,
and it costs no storage. Each screen keeps the view it has today as its default, so nobody's habit
breaks: `entries` and `places` open in review, `shops` opens in list.

Both views read one `QueueStore`. Switching views loads nothing, sends nothing and loses no place:
the store holds the same rows and the same cursor, and the two views are two renderings of `items()`.

### 1.1 The shops screen moves onto the store

`shops-queue-page.ts` holds its own `shops` signal and reads one page:

```text
const page = await this._service.listShops({ supermarketId, limit: 100 });
this.shops.set(page.items);
```

It never reads `nextCursor`. **A chain with more than a hundred source locations shows a hundred of
them, with nothing on the screen saying so.** Moving it onto `QueueStore` fixes that as a side effect
of getting the selection and the bulk runner, because the store pages.

The resolved location names it keeps beside the rows stay exactly where they are. They come from
catalog rather than from the harvester, `0011` says why, and that is not a paging problem.

## 2. What the list view draws

One row per item, compact, on one line where the viewport allows it. The columns are per screen
because the rows are, so each page projects its own and `QueueFrame` owns only the checkbox column
and the selection bar.

The columns are the ones already decided: whatever the review view leads with. `entries` shows the
kind badge, the name, the brand and size, the EAN, the proposal and `timesSeen`. `places` shows the
name, the street, the city and the external reference. `shops` keeps the columns it has, including
`matchedBy`, which `0011` argues is a column rather than a detail.

**A row in the list opens in the review view.** Clicking it switches the view and makes that row the
subject, because a list whose rows cannot be examined is a list that pushes every hard case into a
decision made from four columns.

The places queue is the interesting one. `0011` shows near duplicates beside the current place,
because a place is offered as new precisely when nothing matched it and the evidence is the other
row. The list view is a better answer to that question than the review view is, and the near
duplicates panel stays in review for the cases where it is not.

## 3. Selection

`QueueStore` gains a selection: `selected()`, `toggle(id)`, `selectLoaded()`, `clearSelection()`.
Three rules:

- **Selection is by id and survives paging.** Loading the next page does not clear it, so an operator
  can work down a long queue and act once at the end.
- **A row that leaves the queue leaves the selection.** `_advance` already filters the item out of
  `items`, and it takes the id out of the selection in the same step. Nothing stays selected that
  cannot be acted on.
- **Select all selects what is loaded, and says so.** The control reads `Select all 250 loaded`, not
  `Select all`. The store holds the rows it has fetched and knows no more than that, and a checkbox
  that claimed four thousand rows would be claiming a number it cannot see and starting four thousand
  separate calls. An operator who wants more presses it after loading more.

The list view needs a way to load more, since there is no decision to trigger the prefetch. A **load
more** button under the rows, showing what is loaded, plus the store's existing prefetch when a
decision happens in either view.

## 4. What can be done to a selection, and what cannot

A bulk action is offered only where **the row already carries everything the call needs**. Anything
that needs the operator to choose a target for that particular row is not a bulk action, and offering
it as one would mean applying one operator's choice to rows they did not look at.

**Offered:**

| Screen    | Action             | Call                                      |
| --------- | ------------------ | ----------------------------------------- |
| `entries` | Reject             | `rejectEntry(id)`                         |
| `entries` | Accept as proposed | `acceptEntry(id, { itemId: row.itemId })` |
| `places`  | Reject             | `rejectPlace(id)`                         |
| `places`  | Import             | `importPlace(id, {})`                     |
| `shops`   | Ignore             | `ignoreShop(id)`                          |
| `shops`   | Stop ignoring      | `unignoreShop(id)`                        |
| `shops`   | Unmap              | `unmapShop(id)`                           |

**Not offered:** accepting an entry to an item the operator picks, creating a product from an entry,
and mapping a shop to one of ours. Each is a choice about one row: an item chosen through a picker, a
form filled in from the row, a location chosen through a picker. Those stay in the review view, one
at a time, which is what that view is for.

Two of the offered ones need a word.

**Accept as proposed** uses the row's own `itemId`, which the ladder wrote when it proposed a match.
A selected row whose `itemId` is null cannot be accepted this way. The bar says so **before** the
action runs: `Accept 31 of 44 selected. 13 have no proposal and are left alone.` A count that
appears only in the failure report afterwards is a count that arrives too late to change the
decision.

**Import a place** sends an empty body, which `ImportDiscoveredPlaceDto` allows, so catalog resolves
the chain from the place's own brand. A place whose brand it cannot resolve is refused, and section 6
is what happens to it.

Every bulk action confirms first, through `ConfirmDialog`, naming the action and the exact count it
will act on.

## 5. There is no bulk route, and the plan does not add one

The harvester exposes one call per row. Nothing in `HarvestService` takes a list of ids, and this
plan does not change that: a bulk endpoint is a transaction boundary, a partial failure shape and a
timeout budget in a service that has none of those today, for a control this plan can build without
it.

**So a bulk action is one call per row, from the browser.** That is a real cost and the design has to
be honest about it rather than hide it behind a spinner.

- **Four at a time.** Enough that two hundred rows do not take two hundred round trips end to end,
  few enough that draining a queue does not arrive at the gateway as a burst.
- **A progress line, counting rows and not time**: `Rejecting 42 of 200`. It replaces the selection
  bar's buttons while it runs.
- **Stop, which stops between rows.** What has already gone through stays through. The bar says so
  plainly, because a "cancel" that reads as an undo on a screen that writes to the catalog is the
  worst possible misreading: `Stopped after 42 of 200. The 42 are done and are not undone.`

## 6. A partial failure names the rows

The rule the whole feature rests on. Two hundred calls will not all succeed, and a bulk that reports
one word is a bulk an operator cannot recover from.

When a run finishes, whatever it finished as:

- **Rows that succeeded leave the queue**, exactly as a single decision makes them leave.
- **Rows that failed stay in the queue and stay selected.** Pressing the action again retries exactly
  those, with no reselecting.
- **Each failure is listed by the row's own name, with its own reason**, read through
  `gatewayErrorKey` the way a single decision's failure is. Not an error count.
- **Rows the action could not apply to** (an entry with no proposal) are neither: they were never
  attempted, they stay selected, and they are listed separately from the failures, because "I did not
  try" and "I tried and it was refused" are different sentences.

`QueueStore.decideMany` holds all of this, so the three pages hold none of it and cannot each get it
subtly wrong. It takes the act, runs it over the selection four at a time, and answers a result
carrying the succeeded ids, the failed ids with their errors, and the skipped ids.

## 7. Testing

`queue-store.spec.ts`:

- Selection survives a page load and drops an id when its row is decided or removed.
- `selectLoaded` selects the loaded rows and no more.
- `decideMany` runs at most four calls at once, over a fake act that records overlap.
- A mixed run: some succeed, some throw. The succeeded leave, the failed stay, both stay selected,
  and the result names each.
- Stopping mid run leaves the completed ones completed and the rest untouched and selected.
- A skipped row is never passed to the act and is reported apart from the failures.

`queue-frame.spec.ts`:

- The toggle switches views and writes the query parameter. Arriving with the parameter opens that
  view.
- The action bar shows in review, the selection bar in list, and both occupy the same fixed position
  under the narrow media query.
- The selection bar's buttons are replaced by the progress line while a run is in flight.

`entries-queue.spec.ts`, `places-queue.spec.ts`, `shops-queue.spec.ts`:

- The list view renders one row per item with a checkbox, and clicking a row opens it in review.
- Each screen offers exactly the bulk actions of section 4 and no others.
- The entries bar states the count it will act on and the count with no proposal, before running.
- The confirmation names the action and the count.
- `shops` pages past a hundred rows, which it does not today.

## 8. Exit criteria

- Every one of the three screens can be worked one row at a time and as a list, and the toggle
  between them survives a reload.
- Two hundred entries can be rejected from one selection, with a count while it runs.
- A bulk that half fails leaves the failed rows in the queue, selected, each with its own reason.
- Stopping a bulk does not undo what it already did, and the screen says that.
- No new gateway route, no new harvester call, and no bulk endpoint.
