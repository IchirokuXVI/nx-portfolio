# 0049 What the first walk found

> Follows the seven remodel plans, `0041` to `0047`, which are merged. Prerequisite reading:
>
> - `0041`: the frame, the rail, the split.
> - `0042`: a chain holds its shops.
> - `0043`: the price rules.
> - `0044`: the Review queues.
> - `0046`: the account menu and the way in.
> - `0002`, section 5: the development sign in.
> - `0008`: the gateway does not answer.
>
> Other people build plans `0050` and `0051` at the same time. `0050` is the arrow of a select
> and a typeahead that opens without typing. `0051` is a search that accepts an id. This plan
> touches no select, no typeahead and no reference picker, and adds no search by id.

The owner walked the remodel on slot 0 on 2026-10-05, the day after it merged, and named eight
things. Five are defects and three are removals. Each one is small, and each one has a cause
that a spec can pin, so this plan states the cause beside the fix.

## Brief for the agent

### Objective

Fix the five defects and make the three removals that the owner named after the first walk of
the remodeled back office. Use the `nx-portfolio-angular-developer` skill.

### Context

- **The way in**: `feature-auth/src/lib/sign-in-page.ts` and
  `data-access/src/lib/auth/session-bootstrap.ts`. The server says whether it hands out a
  session with no password, in `devAutologin` of `GET /v1/admin/environment`. The app never
  decides that for itself (`0002`, section 5).
- **The split**: `feature-resource/src/lib/resource-split-page.ts`. The chains are one split,
  and the Shops tab of a chain is a second split inside the first, under the header of the chain.
- **The shop count**: `locationCount` on the chain, from `SupermarketService.locationCounts` in
  the catalog service. The list is `SupermarketLocationService.list`. The row is drawn from
  `LOCATIONS` in `feature-catalog/src/lib/locations.ts`.
- **The price rules**: `feature-catalog/src/lib/price-policies.ts` and
  `products/price-rules-page.ts`. Each row has a switch, and the form under a row is the generic
  form over the fields of the descriptor.
- **The Review queues**: `EntriesQueuePage`, `ShopsQueuePage` and `PlacesQueuePage`, all on
  `QueueFrame` (`ui/src/lib/harvest/queue-frame.ts`) and `QueueStore`
  (`data-access/src/lib/harvest/queue-store.ts`). The Brands queue is a table of its own and is
  not part of this plan.
- **The rail**: `ui/src/lib/chrome/app-shell.ts`.

### Target state

1. A development server never leaves the operator on the sign in form.
   - The server says `devAutologin`. Then the sign in page takes the session by itself and
     goes in.
   - During that time the page draws one line that says so, in place of the form.
   - If nothing answers, the page tries again after 1, 2, 4 and 8 seconds.
   - If the server refuses in words, or the waits run out, the form comes back with the reason.
   - Production and staging answer `devAutologin: false`, so nothing changes there.
2. The white panel of the shops list reaches the bottom of the page. At 72 rem and above, the
   column of a split under a header is as tall as the pane that holds it.
3. The count of shops and the list of shops agree. A shop can have no label, no address and no
   town. Its row then shows its postal code, or else the reference of its source, or else its
   id. No row is drawn with no text.
4. The form of a price rule has no "Enabled" checkbox. The switch on the row is the one place
   that turns a rule on and off.
5. A queue keeps its rows in their places.
   - A press on a line of the column opens that row and moves no line.
   - "Skip" goes to the next row and moves no line.
   - After a decision on the open row, the row under it opens. After the last row, the first
     row opens.
   - The column does not scroll.
6. The three queues have no "As a list" view.
   - The list of checkboxes, the bar of bulk actions and the bulk report are deleted.
   - Their texts, their specs and everything that only they used are deleted too.
   - "Grouped by chain" stays on the Places queue, because it is a view of that queue's own.
   - A link that still says `view=list` opens the rows.
7. No queue says "N left, N decided". The tab of each queue shows how many rows wait.
8. The foot of the rail holds the deployment and one button, the account.
   - The button that showed the language is deleted.
   - The account menu keeps the choice of language and marks the language in use.
   - The "More" sheet on a phone is not changed.

### Scope

In, with the specs of each file:

- `feature-auth/src/lib/sign-in-page.ts`
- `feature-resource/src/lib/resource-split-page.ts`
- `feature-catalog/src/lib/locations.ts`, `price-policies.ts`, `products/price-rules-page.ts`
- `feature-harvest`: the three queue pages and `queue-bulk.ts`
- `data-access/src/lib/harvest/queue-store.ts`
- `ui/src/lib/harvest/queue-frame.ts` and `ui/src/lib/chrome/app-shell.ts`
- `en.json`

In, backend: one case in `supermarket-national-scope.integration.spec.ts` of the catalog
service. No source file of the backend changes.

Out:

- The gateway, the contracts, `openapi.json` and `wire-types.ts`.
- The Brands queue.
- Selects, typeaheads and reference pickers (`0050`).
- Search by id (`0051`).

### Constraints

- The client never decides that it is in development. It reads `devAutologin`, as `0002` says.
- Do not change `session-keepalive.ts`, `reachability-policy.ts` or `SessionBootstrap`.
- The next row loads, and no accept or reject button moves (`0044`).
- The app has one locale file, `en.json`. Every new text goes there, and every text that loses
  its last reader is deleted. `no-unread-translation-key.spec.ts` and
  `no-unused-public-export.spec.ts` stay green.
- A price rule is switched on and off by the row. The form sends only what it changed.

### Action boundaries

- Stop and ask before you change a gateway route, a DTO or a contract. Target 3 turned out to
  need none.
- Do not delete `PlaceGroupsView` or the `view` query parameter. The Places queue uses both.
- Do not delete "Apply a decisions file". It is a tool of the Products queue and not a view.

### Progress evidence

- `npx nx lint` and `npx nx test` for `luna-shopper-admin`, `luna-shopper-admin/ui`,
  `luna-shopper-admin/data-access`, `luna-shopper-admin/feature-auth`,
  `luna-shopper-admin/feature-catalog`, `luna-shopper-admin/feature-harvest` and
  `luna-shopper-admin/feature-resource`.
- `npx nx build luna-shopper-admin`, because the pull request checks do not build this app.
- `luna-shopper-backend-catalog:test-integration` for the one spec file, against a slot.
- A browser walk of the eight targets on a slot of your own, at 1360 px. Walk the queues at
  390 px too.
- The numbers that prove each target: the height of the panel, the order of the lines before
  and after a press, and the requests of a sign in that failed first.

## 1. What was found, one defect at a time

### 1.1 The sign in form on a development server

**What the owner saw.** On slot 0 the app showed the sign in form. Any name and password let him
in.

**The cause.** The session with no password is taken in one place, `SessionBootstrap.run()`,
once, before the first screen. Two cases leave it untaken. In both, the server says yes a
moment later.

- Nothing answered the first read. `0008` then raises the cover and skips the sign in, on
  purpose, because there is nobody to ask. Later the server answers, the cover comes down, and
  the app reads the deployment a second time. Nothing asks for the session a second time. The
  page under the cover is the sign in form.
- The gateway answered and the sign in itself did not. This occurs while the gateway is up and
  the auth service is not up yet. The one try fails and the guard sends the operator to the
  form.

Both cases occur while the backend starts or restarts with the tab open. A development stack
does that after every pull. The form then accepts anything, because the gateway ignores the
typed name and password on such a server.

**What `0046` did.** Nothing in this path. `session-bootstrap.ts` was last changed by plan
`0013`, and `0046` changed the look of the page only. The gap is as old as `0008`. It showed on
this walk because the seven services and the app all started again after the merge. Both cases
were reproduced in a browser before the fix, by holding back the gateway and by failing the
first sign in.

**The fix.** The sign in page reads `devAutologin` in an effect. Each time the value is true,
the page signs in and goes to `/`. That covers three cases:

- The operator reached the page after the one try failed.
- The page was drawn under the cover, and the server comes back.
- The operator signs out on a development server.

**One consequence.** "Sign out" on a development server signs the operator in again at once.
That is the meaning of "the sign in must never show" on such a server. The session lifecycle
already says that a cover there protects nothing.

### 1.2 The white panel that stops short

**The cause.** At 72 rem a split is a grid with `align-items: start`, so each pane is as tall as
what it holds. The column of the outer split, the chains, states `min-block-size: 100dvh`. The
column of a split under a header, the shops, states no height, because it does not start at the
top of the window. So it was as tall as its rows.

**The fix.** Two rules in `resource-split-page.ts`. The column of a split under a header takes
the height of its row. The pane of the open row takes the height of its own row, so a split
drawn inside that pane has that height to give. The column keeps `max-block-size: 100dvh` and
stays in view while the open shop scrolls.

### 1.3 Two shops counted, one shown

**What was checked.** The count and the list are two queries over `supermarket_locations`, each
with one condition, the chain. The table has no deleted mark and neither query has another
filter. An integration spec now proves on real Postgres that they return the same number for the
barest row the table allows. So the gateway does not disagree with itself, and nothing in the
backend changed.

**The cause that was found.** The line of a shop in the column is its label, or else its
address, or else its town. All three can be null. A shop with none of them was a row with no
text: a blank strip 44 px high, which reads as the edge of the list. This was reproduced on a
slot: a chain with one ordinary shop and one bare shop shows "Shops 2" over what looks like one
row.

**What is not known.** The rows of Dia on slot 0 were not read. A builder is not permitted to
sign in to slot 0, and the copy of the slot 3 database was refused. So this plan fixes one real
cause of "2 counted, 1 shown". It cannot say that slot 0 has that cause. Section 3 says how the
owner can tell in a minute.

**The fix.** `LOCATIONS.title` and its `brief.heading` fall back to the postal code, then the
reference of the source, then the id. It is the rule `BASKETS.title` already follows for a list
with no name.

### 1.4 A checkbox that repeats the switch

**The cause.** `0043` put a switch on each row of the price rules and kept the generic form
under the row. The form draws every editable field of the descriptor, and `enabled` was one.

**The fix.** `enabled` is not a field of `PRICE_POLICIES` any more. The switch sends the change
by itself and the rows are read from the gateway, so neither needs the descriptor to know the
column. The two texts of the field are deleted.

### 1.5 A queue that turned when a row was chosen

**The cause.** `QueueStore` had no idea of "the open row" apart from "the first row". So
`focus(id)` turned the list until that row was first, and `skip()` moved the first row to the
end. That was right for a queue that was one card with nothing beside it (`0006`). `0044` drew
the rows as a column beside the card, and the turning became visible. A press on row 5 sent
rows 1 to 4 to the end.

**The fix.** The store names the open row by its id. `focus` and `skip` move the name and no
row. When the open row leaves, the row under it takes the name, and after the last row the
first one does. `upcoming` is the rows after the open one and then the rows before it, which is
what the Places queue reads to find near duplicates. With fewer than three rows left under the
open row, the store reads the next page.

Two pages took the first row for themselves instead of asking the store. `ShopsQueuePage.current`
now follows the store. Opening another line or skipping also closes a mapping picker that was
open for the row before it.

### 1.6 The "As a list" view

Deleted from `QueueFrame`:

- The second entry of the view switch.
- The list of checkboxes, the selection bar and the progress line.
- The bulk report.
- Nine inputs and four outputs that fed them.

Deleted from `QueueStore`: the selection, `decideMany`, `stopBulk` and the count of decisions.

Deleted from the three pages:

- Their list row template. On Shops and Places, which had no line of their own, it is now the
  line of the column.
- Their bulk buttons and their dialog for a bulk action.
- The file `queue-bulk.ts`.

38 keys of `en.json` lost their last reader and are deleted.

The switch is drawn only for a queue that has a view of its own. So Products and Shops have no
switch, and Places has "One at a time" and "Grouped by chain".

**What goes with it.** Bulk accept, bulk reject, bulk ignore and bulk unmap lived in that view
and nowhere else, so they are gone. For Products, "Apply a decisions file" still decides many
rows in one request. Section 3 names this for the owner.

### 1.7 The count above a queue

**The cause.** "N left" was the number of rows that the browser held, 25 at most on a first
page. "N decided" counted this visit only. Neither is the size of the queue. The switch of
the four queues shows the real number of each one, from the dashboard read.

**The fix.** The line and its two inputs are deleted. A row above a queue that holds no tool and
no switch is hidden.

### 1.8 Two buttons that said one thing

**The cause.** `0026` put a language button in the header. `0041` moved it to the foot of the
rail, and `0046` then put the same choice in the account menu and left the button.

**The fix.** The button and its menu are deleted. The account menu and the "More" sheet are not
changed.

## 2. Not in this plan

- A second try of the session in `SessionBootstrap`. The page is where the operator is left, so
  the page is where the try belongs.
- A way to choose a row of a queue on a screen narrower than 72 rem. There the queue is one row
  at a time, with "Skip". See section 3.
- A name for a shop that has no address. The row says its postal code or its id, and the
  operator gives it a label on its Details tab.

## 3. Decisions for the owner

1. Is the second Dia shop on slot 0 a bare row? Open Chains, then Dia, with this change.
   - If two rows show and one is a postal code or an id, section 1.3 found the cause.
   - If one row shows, the cause is another one, and the rows of Dia are necessary to find it.
2. Bulk work on the queues is gone with the list view. If the owner still wants to reject two
   hundred rows at once, that action needs a new home. One example is a "Reject all of these"
   button over the column. Nothing is scheduled.
3. On a phone a queue has no way to jump to a row. The list view was that way. If the owner
   misses it, the column can be drawn above the open row below 72 rem.
4. "Sign out" does nothing lasting on a development server. A later plan can hide it there.
   This plan leaves it.

## 4. What this plan deletes

- `feature-harvest/src/lib/queue-bulk.ts`.
- From `QueueStore`, the members: `selected`, `selectedCount`, `toggle`, `selectLoaded`,
  `clearSelection`, `decideMany`, `stopBulk`, `bulk`, `result`, `decided`.
- From `QueueStore`, the types: `QueueBulkResult`, `QueueBulkFailure`, `QueueBulkProgress`.
- From `QueueFrame`, the inputs: `remaining`, `decided`, `defaultView`, `selected`,
  `selectedCount`, `progress`, `progressKey`, `report`.
- From `QueueFrame`, the outputs: `pickRow`, `selectAll`, `clearSelection`, `stop`.
- From `QueueFrame`, the rest: the `queueRow` template, the `queueBulk` slot, `QueueReport`,
  `QueueView`.
- From `en.json`, under `harvest.queue`: `tally`, `view.list`, `select`, `selectAll`,
  `clearSelection`, `bulk.*`.
- From `en.json`, the bulk texts of each queue: `harvest.entries.bulk.*`,
  `harvest.places.bulk.*`, `harvest.shops.bulk.*`.
- From `en.json`: `catalog.pricePolicies.enabled` and `enabledHelp`.
- From `AppShell`: the language button of the rail and the `language` menu.
