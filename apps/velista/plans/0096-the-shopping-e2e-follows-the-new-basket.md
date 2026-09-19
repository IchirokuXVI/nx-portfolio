# 0096: the shopping e2e follows the new basket

> The last plan of the series (backend `0130`, section 12). It needs every plan above it:
> backend `0131` to `0143` and velista `0090` to `0095` on `dev`. Backend `0144`, the
> rename, can land before or after it, and section 7 says what each order costs.
>
> `apps/velista-luna-e2e` drives velista's basket screens against a real, seeded backend
> (velista `0080`). Its three specs were written for a basket that is composed once,
> frozen, split, added to by guests and finished, and for a link that binds an account
> for good. Every one of those is gone. From backend `0136` until this plan, the suite is
> red by construction and `dev` is not releasable, because the suite runs only on a push
> to `main`. This plan rewrites the suite to the new model, journey by journey, and its
> last acceptance criterion is the whole suite green against a slot. That criterion is
> what ends the window.
>
> Prerequisite reading: backend `0130` in full, velista `0080` (what the suite is, how it
> seeds, why it has no snapshot), velista `0090` to `0095`, the memory notes "velista-luna-e2e
> suite" and "e2e in this repo", and every file under `apps/velista-luna-e2e/src/`.

## Brief for the agent

### Objective

Rewrite `apps/velista-luna-e2e` so that its specs are the journeys of section 3, its
support files speak the new routes and screens, and the suite passes whole against an
ephemeral Luna slot and a velista slot.

### Context

- The suite is Playwright, one worker, no parallelism, no web server of its own
  (`playwright.config.ts`, `project.json`). It reads `VELISTA_BASE_URL`, velista's **own**
  origin and never the shell's, and `E2E_GATEWAY_URL`. `E2E_SEED=1` runs
  `apps/luna-shopper-backend/tools/db/seed.js` from `global-setup.ts`, and
  `LUNA_REQUIRE_STACK=1` turns a missing stack into a failure.
- **There is no snapshot and no restore.** The seed rewrites the demo world's rows by
  fixed id, and every spec puts each value it depends on back as an absolute value
  through `resetAliceWorld` (`support/api.ts` lines 283 to 310).
- The demo world (`libs/luna-shopper/test-fixtures/src/lib/demo-world.ts`): Alice owns
  the zone "Weekly shop" with the lists Groceries and Hardware. Dana is an approved
  member holding the full permission set on both. Bob holds write without decide on
  Groceries and signs in with Google, so a spec cannot be him. The seeded lines are Milk
  (2, products Milk and Bread), Bread (1, approved by the reset), Eggs (12), Nails (100)
  and Apples (rejected).
- Today's specs: `shop.spec.ts` (eleven steps, one owner trip), `guest.spec.ts` (seven
  steps) and `member.spec.ts` (three steps). `support/app.ts` holds the screen helpers and
  `support/api.ts` the gateway helpers, each naming the route it calls.
- `finishOpenBaskets` (`support/api.ts` lines 217 to 231) exists for one reason, which its
  own comment gives: "a run refuses a line another basket still holds". Backend `0133`
  deleted that rule.
- The CI job is `e2e-velista-luna` in `.github/workflows/docker-ci.yml` (line 625), which
  runs `npx nx e2e velista-luna-e2e --skip-nx-cache` against the tier 2 compose stack.
- What the new screens are, selector by selector, is whatever velista `0090` to `0095`
  built. This plan names journeys and assertions. The builder reads the components for
  the roles and labels, because "Nothing is a test id" (`support/app.ts`, its header).

### Target state

Every journey of section 3 passes, in one run of the whole suite, twice in a row against
the same slot without a reseed between the runs, and
`npx nx run-many -t lint -p velista-luna-e2e` is green.

### Scope

- Work only in: `apps/velista-luna-e2e/` (specs, `support/`, `playwright.config.ts` for
  one new variable), `libs/luna-shopper/test-fixtures` only if a journey needs a seeded
  row that does not exist (section 5 argues none does), and one added step in the
  `e2e-velista-luna` job of `.github/workflows/docker-ci.yml` for the expiry pass
  (section 6).
- Do NOT touch: any file under `libs/velista`, `apps/velista` or
  `apps/luna-shopper-backend`. A journey that fails because the app is wrong is a finding
  to report, with the step and the evidence, and not something to fix from here. Velista
  `0086` is the precedent: the suite found two defects and a plan of its own fixed them.

### Constraints

- A spec drives the browser for everything under test. `support/api.ts` only puts the
  world in a known state and reads back what the app wrote, and each helper names its
  route in its doc comment.
- Every selector is one the app draws for a person: a role, a label, a visible name. No
  test id is added to the app for this suite.
- Every value a spec depends on is set as an absolute value, never as a delta, so the
  suite passes on a fresh database and on the run after it.
- A spec never depends on another spec having run. The file order is alphabetical and one
  worker, and that is an accident, not a contract.
- **No spec sleeps.** A wait is an `expect` on what the screen or the API will say, with
  `expect.poll` for a read that follows a write through the broker.
- A slot is borrowed: `--list` first, `--down` when finished, including on an abandoned
  run (`CLAUDE.md`, "Serving from a worktree").
- Only make the changes this plan names.

### Action boundaries

- Proceed with in scope edits and runs against slots.
- Stop and ask before editing `docker-ci.yml` beyond the one step of section 6, before
  adding a row to the demo world, and when a journey cannot pass because the app or the
  backend disagrees with backend `0130`: report the step, the request, the answer and the
  section it contradicts.

### Progress evidence

Report after `support/` compiles against the new routes, and after each spec file passes
alone, with the Playwright summary line. The final report is the whole suite, run twice,
with both summary lines.

### Session strategy

One session per spec file is reasonable once `support/` is done. Build `support/` and
`live.spec.ts` first, in one session, because every later spec leans on those helpers.

## 1. What is being built

| Piece                          | File                                       |
| ------------------------------ | ------------------------------------------ |
| Gateway helpers, new routes    | `src/support/api.ts`                       |
| Screen helpers, new screens    | `src/support/app.ts`                       |
| The basket that is always there | `src/live.spec.ts` (new)                  |
| A generated basket, to a trip  | `src/generated.spec.ts` (replaces `shop.spec.ts`) |
| The owner and a guest          | `src/guest.spec.ts` (rewritten)            |
| A visitor with an account      | `src/member.spec.ts` (rewritten)           |
| A history without baskets      | `src/history.spec.ts` (new)                |
| A visit that ends              | `src/expiry.spec.ts` (new, gated)          |
| The expiry pass in CI          | one step in `e2e-velista-luna`             |

Deleted: `src/shop.spec.ts`.

## 2. The support files

**`support/api.ts`**

- Delete `finishOpenBaskets`, `GeneratedListSummary` with its four value status union,
  `BasketLineView` and `readBasketLines`.
- Add, each naming its route: `readLiveBasket(s)` (`GET /v1/baskets/live`),
  `readBasket(s, basketId)` (`GET /v1/baskets/:id`), `listBaskets(s)` with the three
  value status (`OPEN`, `FINISHED`, `ARCHIVED`), `finishBasket(s, basketId)`,
  `revertRow(s, basketId, rowKey, units, from)`, `unskipRow(s, basketId, rowKey)`,
  `acknowledgeChanges(s, basketId)` (reads the newest change, then
  `POST …/changes/seen`), `addLine(s, listId, content, quantity)`
  (`POST /v1/lists/:id/lines`), `setListAccess(s, listId, membershipId, permissions)`
  (the route the list settings sheet calls, read from `gateway/src/app/lists/`), and
  `purchaseSessions(s)` (`GET /v1/purchases/sessions`).
- The row types here are the wire's, written by hand and as narrow as the assertions
  need: `{ rowKey, content, left, bought, state, mark }`. This file is the one place in
  the repository that is allowed to read wire names directly, because it is a test of the
  wire as much as of the screen.

**`resetAliceWorld`**, in this order, every step absolute:

1. Every `OPEN` `GENERATED` basket of Alice's is finished. Not because a run refuses
   anything any more, but because an open generated basket claims its lines for sixty
   hours and draws a second card on the home page, and a spec that asserts "one basket
   card" must not inherit one.
2. On Alice's `LIVE` basket: every standing skip is taken back, and every standing
   purchase of the **current session** on a seeded line is reverted. A `LIVE` basket's
   `bought` is scoped to the session (backend `0130` section 4), and a spec that ran ten
   minutes ago is inside this one's session.
3. Every line an earlier run added to Groceries or Hardware is deleted, as today. The
   delete is a soft delete now (backend `0132`), and `listLines` must not return it. If it
   does, that is a finding.
4. Dana's access on both lists is put back to the full set.
5. Bread approved, the four quantities set, Milk's two products set, the postal code
   ensured, as today.
6. **Last:** the changes of Alice's `LIVE` basket are acknowledged, and so are Dana's.
   Steps 1 to 5 are themselves changes of demand, and a spec that asserts "one change"
   must start from none.

**`support/app.ts`**

- `generateBasket` keeps its shape and gains the people argument the get list sheet takes.
  It returns the basket id from the URL, as today.
- `openLiveBasket(page)`: from the home page, by the control velista `0091` gives the
  basket that is always there, and asserts the URL velista `0091` gave it.
- `rows` and `row` keep their meaning over whatever element velista `0090` draws a row
  with. `rowState(page, name)` reads the state the row **says**, from its accessible name
  or its status control, never from a class.
- `banner(page)`, `openChangesSheet(page)`, `markOf(row)`.
- `openSettleSheet` keeps its contract. The URL it waits for is
  `/sheet/lines/<rowKey>/settle` with the row's anchor id.
- `readShareLinkFromSheet` presses "Make a link" first when the sheet offers it (velista
  `0094` section 3: opening the sheet no longer mints).
- `newVisitor` is unchanged, and its comment stays: `browser.newContext()` inherits none
  of the config's `use`.

## 3. The journeys

Each numbered item is one `test.step`. "Alice" is the page under test unless a step says
otherwise. "Through the API" means `support/api.ts`, as the named user.

### 3.1 `live.spec.ts`: the basket that is always there

1. **It exists with no creation.** Alice signs in and opens the live basket from the home
   page. The four wanted seeded lines are rows. Apples, rejected, is not. No "Get
   shopping list" sheet was opened, and `listBaskets` holds no new `GENERATED` basket.
2. **A line added on the zone list by a second account arrives without a reload.** Dana,
   through the API, adds "Oat milk" (1) to Groceries. On Alice's page the row appears with
   the "New" mark, and the banner reads "1 change on your lists".
3. **The acknowledgement.** The changes sheet opens from the banner and says "“Oat milk”
   was added, asking for 1", naming Groceries, because Alice owns the zone. After it is
   closed the banner is gone, and `readLiveBasket` says the unseen count is zero.
4. **A quantity change and a delete arrive as `CHANGED` and `REMOVED`.** Dana, through
   the API, sets Eggs to 6 and deletes "Oat milk". Eggs shows "Changed" and 6 to get. The
   "Oat milk" row is still there, disabled, saying "No longer on the list", with no button
   inside it. The progress sentence counts four lines, not five.
5. **A reload keeps the marks.** `page.reload()`. The same two marks and the same banner
   count are there, because nothing acknowledged them: the page was reloaded before the
   dwell. Assert through the API too, not only on screen.
6. **Skip and take back.** Alice skips Nails from its row. The row says it is skipped and
   still counts as pending. The zone line's quantity, through the API, is still 100, and
   `lineSettlements` of Nails holds nothing new. She takes the skip back and the row is
   an ordinary wanted row.
7. **The shop had none.** Alice marks Bread as not available. The row says so, the
   progress sentence counts one unavailable, and Bread's zone line still asks for 1.
8. **Buy and revert, with `from`.** Alice buys 1 of 2 Milk from the settle sheet: the row
   says 1 to get, and the zone line asks for 1. She buys the rest from the row, and the
   zone line is at 0. She reverts both from the row. The zone line asks for 2 again and
   this trip left no standing settlement, asserted against the ids present when the step
   started (memory note: settlements outlive the spec that made them).
9. **A stale write is refused in words.** Dana, through the API, sets Milk to 5 while
   Alice's settle sheet is open on a row that said 2. Alice's "Got them all" is refused,
   the sheet says the line changed, and the row now says 5. No purchase was recorded.
10. **Nothing can be removed.** The row, its sheet and the page offer no delete and no
    "remove from this basket". Asserted by role and name over the whole page.

### 3.2 `generated.spec.ts`: a generated basket, to a named trip

1. **Generate with sources and a person.** From Groceries and Hardware, named, shared
   with Dana in the sheet. Four rows, "0 of 4 got".
2. **Search**, **filter and group**, **prices from one shop**: steps 2, 3 and 4 of
   today's `shop.spec.ts`, carried over with their assertions. They do not depend on the
   model.
3. **It follows its lists.** Dana, through the API, adds "Screws" to Hardware. The row
   arrives marked. This is the step that was impossible before the series.
4. **Settle from the row and from the sheet**, with a shop chosen, and assert through
   `lineSettlements` that the purchase carries a unit price and that the request the page
   sent carried `priceScopeId` and no amount (`page.waitForRequest`, then its post data).
5. **Presence.** Dana opens the basket in her own context. Alice's header shows a second
   face. On Alice's **live** basket, opened in a second tab, the header shows none.
6. **Finish.** The finish sheet, the banner "This trip is finished.", and no control left
   on any row.
7. **A named trip on the zone list.** The Groceries page shows a group under the trip's
   name and date, whose rows say what was asked and what was bought. No group is called
   "Loose buys".
8. **The numbers froze.** Dana, through the API, raises Milk. The finished trip's row for
   Milk still says what it said in step 7.
9. **Reopen.** The owner reopens from the banner. The rows have controls again and the
   zone list's group is live again.
10. **What the next basket remembers.** Today's step 11, carried over: the order and the
    grouping, not the list filter and not the search.

### 3.3 `guest.spec.ts`: the owner and a guest

1. Alice generates a basket, opens the share sheet, presses "Make a link" and reads it.
   The sheet says when the link stops working.
2. A guest opens the path of the link (the origin is compiled in: memory note), is told
   they have twelve hours, skips the name and lands as Guest 1. **No composer is drawn**
   for the guest, and the page holds no text inviting them to register.
3. The guest buys some of Milk, and Alice sees the rest without a reload.
4. The guest skips Nails, and Alice sees it skipped: a skip belongs to the basket, not to
   the person (backend `0130` section 11 point 3).
5. The guest sees no list name anywhere: not on a row, not in the settle sheet, not in the
   changes sheet after Dana adds a line through the API. The change is told without its
   list and without Dana's name.
6. A guest request cannot add a line: `POST /v1/baskets/:id/lines` with the guest's
   credential, sent through the API helper, is refused. This is the one assertion in the
   suite about a request the screen does not make, and it is here because the screen not
   offering it proves nothing about the server.
7. Alice sees Guest 1 in the people sheet, with when their visit ends and no "Keep".
8. Alice revokes the link with the cascade, and the guest is refused on screen with the
   "taken back" sentence, not the "time has ended" one.

### 3.4 `member.spec.ts`: a visitor with an account

1. Alice generates a basket from Groceries and Hardware and makes a link.
2. **Dana, signed in, opens the link.** Straight to the basket, no offer screen, as
   before. What is new: a notice says she is on the list until a time and to ask Alice to
   add her, and in the people sheet her row says "with the link, until". This step used
   to assert that an account opening a link is on the basket for good. It now asserts the
   opposite, which is the point of backend `0130` section 11 point 6.
3. Dana sees which list each row belongs to, because she holds `WRITE` on both. The settle
   sheet names Groceries for Milk.
4. **Alice keeps her.** From the people sheet, "Keep on this list". Dana's notice goes on
   her next read, and her row no longer says "until". The share sheet's picker shows her
   ticked.
5. **An add from the basket names its list and lands `PENDING`.** Through the API, Alice
   narrows Dana's access on Hardware to read and write. Dana, in her **own** live basket,
   adds "Washers" and picks Hardware in the composer. The row appears, marked as waiting
   for approval, and is buyable. Through the API, the zone line exists on Hardware with
   `approvalStatus: 'PENDING'` and Dana as its author. Alice approves it through the API
   and Dana's row loses the waiting mark without a reload.
6. Dana, with read and write only, has no control to change what Hardware asks for on an
   approved row, and the owner's basket shows Alice the control on the same row.

### 3.5 `history.spec.ts`: a history without any basket

1. After the reset, Alice has no `GENERATED` basket of today's run. She buys Eggs from the
   live basket with a shop chosen, and Bread by hand from the Groceries page.
2. The shopping lists page, "Bought" tab: one entry, titled by today's date, "2 bought",
   an amount, and "1 without a price". Open, it lists Eggs with a line amount and Bread
   with none.
3. "My lists" is empty and says where the purchases are.
4. The Groceries page shows the same two purchases under one dated group, with no group
   name, and each row names who bought it.
5. Through the API, `purchaseSessions` answers one entry whose purchases are the two
   settlements this spec made, by id.

### 3.6 `expiry.spec.ts`: a visit that ends

Gated: `test.skip(!process.env['E2E_LINK_VISIT_TTL_SECONDS'], …)` with a reason that says
how to run it. The variable is added to `playwright.config.ts` beside the other two and
documents that the **backend** must run with the matching lifetime.

1. Alice generates a basket and makes a link. A guest joins.
2. The spec waits, with `expect.poll` on the guest's page and a timeout of the lifetime
   plus thirty seconds, for the page to say "Your time on this list has ended". It does
   not sleep and it does not reload: the eviction arrives on the socket.
3. The guest's next tap writes nothing. Through the API, the row is as it was.
4. The link still works for a **new** visitor, because the link's twelve hours are not
   the visit's (backend `0130` section 11 point 6). A second guest joins and shops.

## 4. How to run it

The suite opens **velista's own origin**, so velista is the only front end it needs. The
"serve all five apps" rule in the memory note is about suites that go through the shell,
which fetches four `remoteEntry.mjs` files at startup. If a run shows an empty body and
refused `remoteEntry.mjs` requests, `VELISTA_BASE_URL` is pointing at the shell.

```sh
npx playwright install                          # once per fresh worktree
bash k8s/e2e/luna-shopper-backend/luna-slot.sh --list
tools/dev/ng-slot.sh --list

LUNA_REFERENCE_SEED=0 bash k8s/e2e/luna-shopper-backend/luna-slot.sh --ephemeral --up 3
tools/dev/ng-slot.sh --up --apps velista --backend-slot 3

E=/tmp/luna-slot-ephemeral/slot3/env/apps/luna-shopper-backend
export AUTH_DB_URL=$(sed -n 's/^AUTH_DB_URL=//p' $E/auth/.env)
export CORE_DB_URL=$(sed -n 's/^CORE_DB_URL=//p' $E/core/.env)
export CATALOG_DB_URL=$(sed -n 's/^CATALOG_DB_URL=//p' $E/catalog/.env)
E2E_SEED=1 LUNA_REQUIRE_STACK=1 \
  VELISTA_BASE_URL=http://localhost:42005 E2E_GATEWAY_URL=http://localhost:43200 \
  npx nx e2e velista-luna-e2e --skip-nx-cache

bash k8s/e2e/luna-shopper-backend/luna-slot.sh --ephemeral --down 3
tools/dev/ng-slot.sh --down
```

- The ports are slot 3's and slot 1's. Read them from `--list`, do not copy them.
- `LUNA_REFERENCE_SEED=0`: the reference catalog and the demo world both insert
  Mercadona, and the second one dies (memory note).
- The seed resolves its three database URLs through dotenv, which never overwrites a set
  variable, which is why exporting them from the slot's rendered files works. Check the
  three variable names against `apps/luna-shopper-backend/tools/db/seed.js` before
  trusting the block above.
- **The expiry pass** is a second backend start, because a short lifetime breaks every
  other journey that has a visitor in it:

```sh
BASKET_LINK_SESSION_TTL=20s LUNA_REFERENCE_SEED=0 \
  bash k8s/e2e/luna-shopper-backend/luna-slot.sh --ephemeral --up 3
E2E_LINK_VISIT_TTL_SECONDS=20 … npx nx e2e velista-luna-e2e --skip-nx-cache -- expiry.spec.ts
```

  An ephemeral slot hands its values to the services through their environment, where a
  set variable outranks a `.env`, so a variable exported in front of the script reaches
  core. The name `BASKET_LINK_SESSION_TTL` is backend `0140`'s to confirm. Read its
  `app-config.ts` and use the name it declares.

## 5. The traps

- **Playwright will not click a button with `aria-disabled="true"`.** Velista holds
  actions that way on purpose. Such a step needs `click({ force: true })` and an
  `eslint-disable playwright/no-force-option` line with the reason.
- **`toBeVisible()` on a bare component host can read hidden** while its content is on
  screen, because an Angular host is inline. Assert on an inner element.
- **A `REMOVED` row has no button**, so `getByRole('button')` finds nothing in it by
  design. Find it by its text.
- **A URL that matches no route renders the 404 outside `AppLayout`.** Scope an assertion
  about a screen inside `lib-app-layout`.
- **A settle pane closes on Escape, not Cancel**, and picking a shop dismisses the picker
  back onto the filter sheet, as today.
- **The share link's origin is compiled in.** Open `new URL(link).pathname` against the
  suite's base URL.
- **The coalesced re-read.** Velista `0086` gave `refresh()` a generation counter, so an
  answer that was overtaken is dropped. If a row added through the screen disappears
  after a burst of socket events, that guard regressed, and it is a finding.
- **The session is six hours wide.** Two runs inside six hours share a session on Alice's
  live basket. Every count a spec asserts is either reset to an absolute value by
  `resetAliceWorld` step 2 or asserted as a difference against ids read at the start of
  the step.
- **The acknowledgement has a dwell.** A step that wants marks to survive (3.1 step 5)
  reloads **before** the dwell ends, and a step that wants them acknowledged waits for
  the banner to go, never for a number of milliseconds.
- `expect.timeout` stays at ten seconds: room for a write through the broker on a loaded
  machine.

## 6. CI

The `e2e-velista-luna` job runs the suite once, as today, and `expiry.spec.ts` skips
itself there. One added step after it restarts core in the compose stack with the short
lifetime and runs `expiry.spec.ts` alone. The tier 2 compose file states each service's
environment by hand (memory note), so the variable is added to
`k8s/e2e/luna-shopper-backend/compose.apps.yml` as `${BASKET_LINK_SESSION_TTL:-12h}` for
core, which leaves every other run on the real lifetime. If the step needs more than
that, stop and ask.

## 7. The rename, before or after

Backend `0144` renames the routes that survived under `/v1/generated-lists` and the
remaining `generatedList.*` events. If it lands first, `support/api.ts` is written
against `/v1/baskets` throughout. If it lands after, `0144` owns updating the helpers it
breaks, and they are few: `listBaskets`, `finishBasket`, the share link read. Each helper
names its route in its doc comment so that the change is a search.

## 8. Not in this plan

- The zone list's own e2e, the assistant, the account screens.
- Offline journeys. Playwright can cut the network, and the marks surviving an offline
  hour is asserted by velista `0093`'s unit specs. A browser journey for it is worth a
  plan of its own once the service worker's behaviour on the basket is decided.
- Performance assertions.
- Any fix to the app.

## 9. Acceptance criteria

- [ ] `shop.spec.ts` is gone and `finishOpenBaskets` is gone, and nothing in the suite
      names a status other than `OPEN`, `FINISHED` and `ARCHIVED`.
- [ ] No spec adds a line as a guest, splits a row, removes a row from a basket or expects
      a basket to refuse a line another basket holds.
- [ ] `live.spec.ts` proves a source change reaches an open basket without a reload,
      marked per viewer, and that a reload before the acknowledgement keeps the marks.
- [ ] `member.spec.ts` step 2 proves a signed in visitor is on the basket for a limited
      time, and step 4 proves the owner keeping them.
- [ ] `guest.spec.ts` proves, against the server and not only the screen, that a guest
      cannot add a line.
- [ ] `history.spec.ts` passes for an account with no generated basket.
- [ ] `expiry.spec.ts` passes against a backend started with a short lifetime, and skips
      itself with a reason otherwise.
- [ ] The whole suite is green twice in a row against one slot with no reseed between the
      runs. **This is the criterion that makes `dev` releasable again** (backend `0130`,
      section 12).

## 10. Verification

```sh
npx nx run-many -t lint -p velista-luna-e2e
npx tsc -p apps/velista-luna-e2e/tsconfig.json --noEmit
```

Then section 4, the whole suite, twice, and the expiry pass once. Paste both summary
lines and the expiry summary line into the pull request. Give every slot back.
