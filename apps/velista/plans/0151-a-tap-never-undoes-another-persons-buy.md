> **PR:** [#747](https://github.com/IchirokuXVI/nx-portfolio/pull/747)

# 0151: a tap never undoes another person's buy, and a refused write says so

> Asked for by the owner on 2026-10-16: "create plans to fix the most important problems from
> the recent e2e report". Three findings of `docs/reports/2026-10-16-velista-e2e-slot1.md`
> on the shared basket: F6.1 (major, a tap meant to tick lands after the other person's tick
> arrived and becomes Undo, which reverts their purchase with no word to anyone), F6.2
> (major, the loser of two simultaneous "asks for" changes reads "That did not save. Try
> again" instead of "Somebody else changed this line. It says 3 now") and F5.5 (minor, a tick
> refused because the trip finished says nothing).
>
> Every fact below was read on `dev` at `d73a36b8` on 2026-10-16.
>
> Prerequisite reading: plan `0143` (a buy reaches the other phone at once), plan `0141`,
> `libs/velista/feature-shopping-lists/src/lib/basket-row/basket-row.ts` (`toggle`, the
> `touchedBy` and `meId` inputs, `_deafUntil`), `basket-page/basket-page.ts` (`revertRow`,
> `settleRow`, `_toggle`, `_reportSettle`, `_reportLeft`, `_say`),
> `settle-sheet/settle-sheet.ts` (`demand`, `errorKey`, `_failedOp`), `basket-error-copy.ts`,
> `libs/velista/data-access/src/lib/baskets/basket-store.ts` (`_write`, `_rereadIfOvertaken`,
> `_eventRead`), `libs/velista/models/src/lib/basket-view.ts:677-683` (`touchedBy`), and
> `apps/luna-shopper-backend/core/src/app/baskets/basket-revert.service.ts:72-131`.

## Brief for the agent

Load the `nx-portfolio-angular-developer` skill before you write code.

### Objective

The round control of a basket row undoes only what the person holding the phone bought.
Another person's buy is undone from the settle sheet, on purpose. A write that the server
refuses because somebody else moved first, or because the trip finished, is named in one
sentence next to the control that sent it.

### Context

- **The control decides from what is drawn.** `BasketRow.toggle()` (`basket-row.ts:794-800`)
  emits `revert` when `state()` is `DONE` or `NOT_AVAILABLE`, else `settle`, from the state
  at the click. `revertRow` (`basket-page.ts:1259-1268`) sends `{ target: 'UNITS', units:
  row.bought, from: row.bought }`, both taken from the row as drawn, so `from` always
  matches what the socket just drew. The only time guard in the row, `_deafUntil`
  (`basket-row.ts:561`, `:598`, 250 ms from `limits.ts:144`), covers a click that ends a
  reel gesture and not the status button.
- **The server checks the number, not the person.** `BasketRevertService.revert`
  (`basket-revert.service.ts:72-131`) checks the basket is open, `units` is positive and
  `boughtOfRow(row) === req.from`, then reverts BOUGHT settlements newest first (`:130`)
  with no filter on the settler. Settle records `settledByParticipantId`
  (`basket-settle.service.ts:200-204`) and revert records `revertedByParticipantId` (`:138`).
- **The row knows who acted last.** `touchedBy` is "the participant behind the newest
  standing act on this row" (`basket-view.ts:677-683`, folded at `basket-row-fold.ts:199`),
  and the row has `meId` (`basket-row.ts:284`). It does not know who bought each unit of a
  mixed row.
- **The stale copy is lost twice in the settle sheet.** `demand()`
  (`settle-sheet.ts:1176-1199`) sets `_failedOp('basket.demand')`, and `errorKey` is a live
  computed over `this._store.error()` (`:267-272`). `basketErrorKey` maps `stale_quantity` to
  `basket.error.staleLine` (`basket-error-copy.ts:111-121`). But every read that lands sets
  `_error.set(null)` (`basket-store.ts:1047`), including the quiet socket read that the other
  person's demand causes (`_eventRead`, `:944`), after which the key recomputes to the
  generic `basket.error.failed`. And the sheet renders `{{ key | rokuT }}` with no count
  (`settle-sheet.html:391-393`) while the copy exists only as `staleLine_one` and
  `staleLine_other` (`en.json:1805-1806`). The basket page avoids both: `_reportLeft`
  snapshots the key and the count into `_notice` when the failure happens
  (`basket-page.ts:1441-1452`), and the row passes `{ count }` (`basket-row.html:368-369`).
- **The list page reel sends a delta on purpose** (`line-api.ts:210-220`, the reason at
  `line-store.ts:623-629`). The basket demand takes an absolute value with `from`, and that
  contract is not changed here: with the right copy, the loser reads the new number.
- **A finished tick is silent by design of the page.** `_toggle` (`basket-page.ts:1284-1298`)
  calls `refused()` on null, which is a no-op unless a buy was held (the comment at
  `:1278-1280`). The copy `basket.error.basketFinished` exists (`en.json:1809`, mapped at
  `basket-error-copy.ts:130-134`), the store refetches on `basket_finished`
  (`basket-store.ts:1716-1723`) and the page then draws `finishedBanner()`
  (`basket-page.html:135-147`). The page has its own live region (`basket-page.html:675`, fed
  by `_say`, `:1472-1474`). Velista has no global announcer.

### Target state

1. `toggle()` on a row whose state is `DONE` or `NOT_AVAILABLE` and whose `touchedBy` is
   not `meId` emits `open` (the settle sheet) and never `revert`. The sheet already offers
   the undo of another person's buy with the person named.
2. A revert sent from the row is scoped to the person's own units: the client sends
   `units` equal to the units this person bought on the row when the row can tell, else
   `row.bought` as today. If the row cannot tell, the behaviour of item 1 already keeps
   another person's buy safe in the common case, and the mixed row stays a known gap
   (section 1).
3. A remote change that flips the control's meaning holds the control deaf for the same
   250 ms that `_deafUntil` uses for a reel, so a finger already on its way lands on
   nothing rather than on the opposite action.
4. `demand()` in the settle sheet snapshots `{ key, count }` when `setDemand` returns null,
   with the count read from the refreshed row's `asked`, and renders it with
   `rokuT: { count }`. The loser of two simultaneous changes reads "Somebody else changed
   this line. It says 3 now".
5. `_toggle` calls `_reportSettle(row.rowKey)` on null for every tap, so a tick refused with
   `basket_finished` says "The owner finished this shopping trip" in the row notice or, when
   the finished row hides its notice, through `_say`.

### Scope

- `libs/velista/feature-shopping-lists/src/lib/basket-row/basket-row.ts`, `.html` and
  `basket-row.spec.ts`.
- `basket-page/basket-page.ts`, `.html` and `basket-page.spec.ts` (stale notice tests at
  `:1381` and `:4725-4765` are the model).
- `settle-sheet/settle-sheet.ts`, `.html` and `settle-sheet.spec.ts` (no spec covers
  `stale_quantity` on demand today).
- `basket-error-copy.spec.ts` if a key changes.
- `libs/velista/ui/assets/i18n/en.json` and `es.json` only if a sentence is missing.
- This plan file: "What the build decided" at the end and the `> **PR:**` line at the top.

### Constraints

- No backend change. The revert route keeps its `from` check. If item 2 needs a server
  side scope on the settler, record it in "What the build decided" as a question for the
  owner and build items 1, 3, 4 and 5.
- The settle sheet stays the place where another person's buy is undone. Do not add a
  confirm dialog to the row.
- Dates and copy follow the velista rules (`Intl`, short sentences, the reason before the
  request). Keep the existing keys where they say the right thing.
- Do not use `@angular/core/rxjs-interop`.

### Action boundaries

- Edit only the files in Scope. Stop and ask before you change `BasketApi`, the basket
  models in `libs/velista/models`, or the backend.
- If the 250 ms hold of item 3 makes any existing spec of the row or the e2e suite
  (`apps/velista-luna-e2e`, `sync.spec.ts`) fail on timing, stop and report before you
  change the timing of a spec.

### Progress evidence

- New specs, each failing before the change:
  - a row `DONE` with `touchedBy` another participant: a click emits `open` and not `revert`;
  - a row `DONE` with `touchedBy` me: a click emits `revert`;
  - a row whose state changes from pending to `DONE` by input: a click within 250 ms emits
    nothing, a click after it emits per the rules above;
  - `demand` on a `stale_quantity` answer draws `basket.error.staleLine` with the server's
    count, and a later quiet read does not replace it;
  - a tick on a finished basket says `basket.error.basketFinished`.
- `npx nx run-many -t lint test -p velista/feature-shopping-lists velista/data-access` passes.
- `npx nx build velista` passes.
- `apps/velista-luna-e2e` stays 8 of 8 on a slot (see the suite notes in the repo).
- One two phone walk on a slot repeating the F6.1 steps: A ticks, B taps 400 ms later, the
  buy stands and B sees the settle sheet.

## 1. Not in this plan

- A mixed row (A bought one, B bought one) where B taps: the server reverts the newest
  units whoever bought them. An exact answer needs a revert scoped to the caller's own
  settlements in `basket-revert.service.ts:111-131`. Owner's call, it changes a backend
  rule.
- Turning the basket demand into a delta write. The list page did that for its reel; the
  basket's absolute write with the right copy is honest and needs no contract change.
- A global live announcer for velista. The page's own region is enough here.

## 2. Choices that are mine

- **The sheet, not a confirm, for another person's buy.** The sheet already names who
  bought and offers the undo. A second tap on the row that opens it is one gesture more
  and no new screen.
- **A deaf window after a remote flip.** It mirrors the reel's existing shield, so the row
  has one rule for "the control moved under the finger".

## What the build decided

1. **Who acted is the entry's last act under a list heading, and `touchedBy` elsewhere.** A
   row whose actor is not `meId`, or whose `meId` is unknown, opens the sheet. A row whose
   newest units are somebody else's also opens the sheet, even if this person acted on the
   row. The plan's item 1 asked only for the first case.
2. **Item 2, as far as the client can tell.** `ownBoughtUnits` (in `basket-row.ts`, used by
   the row and by `revertRow`) reads the entries that hold units, newest act first. It counts
   them until the first entry whose last act is not this person's `BOUGHT`. That is the
   prefix that the server's newest first walk reaches before anybody else's buy. A row whose
   entries carry no act sends `row.bought`, as before. `from` is still `row.bought`.
3. **The mixed row stays a gap, for the owner.** An entry knows only its last act. So two
   people's units on **one** entry count as the last person's, and the revert still takes
   the newest units, whoever bought them. The exact answer is a revert scoped to the caller's
   own settlements in `basket-revert.service.ts`. That is a backend rule and the owner's call.
4. **The hold is a second field, not `_deafUntil`.** The status control and the words keep
   separate beats, so a reel that closed itself does not silence the tick. An effect watches
   the press that is drawn. `toggle()` also catches a flip that no frame has drawn yet. A
   flip whose actor is this person holds nothing. This person's own press holds nothing
   either: a settle or a revert from `toggle()` sets a one shot `_ownPress`, and the next
   flip clears it and starts no hold. The store is not optimistic, so after an undo the act
   that is left on the entry is the older one (somebody else's, or none). Without the flag
   that flip read as remote, and a quick re-tick after an undo was dropped with no word.
5. **The walk at 400 ms lands inside the hold.** On slot 1 against backend slot 4, the
   patch reached the second phone 241 ms after the tick, and the tap at 404 ms did nothing.
   The buy stood, and a second tap opened the sheet. At 707 ms the patch arrived at 207 ms,
   and the first tap opened the sheet. The progress evidence expected the sheet at 400 ms.
6. **The sheet freezes the failure in `_failedOp`.** The signal now holds an operation or
   a frozen `{ key, count, correlationId }`. That keeps the sites that clear it unchanged.
   The count is the `asked` of the re-read entry that the demand named, then the row's.
7. **Every tap that the server refuses says why.** The default `refused` of `_toggle` is
   `_reportSettle(row.rowKey)`. A revert passes `basket.reopen` as the operation, and a held
   buy keeps its own report. The row notice is cleared when a tap starts, as it is for the
   reel. No i18n key was added.
8. The status control's accessible name still says "undo" on a row that somebody else
   bought. The sheet that the press opens holds the undo.
