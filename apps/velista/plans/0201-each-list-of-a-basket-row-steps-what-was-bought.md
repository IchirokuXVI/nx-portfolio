# 0201: each list of a basket row steps what was bought

> Decided on 2026-11-22. In the basket's row sheet each list draws a stepper that changes
> what the list asks for (velista `0190`). The owner's ruling: the stepper records the buys
> of that list's line in this trip instead. It starts at what this basket already bought
> for that line in this trip, which is 0 the first time. A list that asks for 3 and is
> stepped from 0 to 1 has 1 bought and 2 to go; stepping above 3 is buying more than asked,
> which is fine. Each list's name carries what it asks for: "Compra semanal · 3". The number
> of the stepper turns green when it reaches the ask, and amber above it, so a shopper who
> missed the green still notices. The section "Add it to another list" records buys too: a
> buy for a list that did not ask makes its line at an asked amount of 0 (backend `0273`).
> Guests never see that section.
>
> Revised on 2026-11-22 with velista `0200`: the row sheet has one job, recording buys, and
> says so in a heading ("What you bought" / "Lo que has comprado", or the mock's words).
> Changing an ask or a product moved to the detailed view of velista `0200`.
>
> This was the design of the sheet before velista `0139`: the entries pane of velista `0090`
> had a "got" reel per list (commit `3b8da1e91`, `row-entries.ts`, output `allocated`),
> removed by `9f74867a1`. Its revert then took units from the whole row; this plan takes
> them from one line.
>
> **Blocked until the owner approves a mock**: the same mock as velista `0200`
> (`apps/velista/plans/mocks/basket-row-buys/`), with the frames of section 1. Build nothing
> visible before it is approved.
>
> Depends on velista `0200` (the detailed view) and on backend `0273` (a buy for a list that
> did not ask). **Release `0200`, `0201` and backend `0273` together.** Without `0200` the
> row sheet loses the only place to change an ask; without `0273` the section "Add it to
> another list" cannot record a buy. Velista `0204` later draws these steppers as reels
> in the compact view.
>
> What the backend already does, read on `dev` at `e06813139` (no change needed):
> - A settle with `lineIds: [lineId]`, a `quantity`, `from` equal to that line's `left` and no
>   `allocations` records the buy on that line, above its ask too
>   (`apps/luna-shopper-backend/core/src/app/baskets/basket-settle.service.ts:95`, `:131` to
>   `:140`; `basket-rows.ts:663` to `:669`). With `allocations` the units are capped at the
>   line's `left` (`basket-settle.service.ts:410`), so this plan sends none.
> - A revert with `lineIds: [lineId]`, `target: 'UNITS'` and `from` equal to that line's
>   `bought` takes the newest buys of the line in this trip first, and shrinks a buy by
>   reverting it and appending the rest (`basket-revert.service.ts:88` to `:209`).
> - A guest may settle and revert: both are authorized by the basket owner's access.
>
> Code anchors, on `dev` at `e06813139`: `libs/velista/data-access/src/lib/baskets/basket-store.ts:474`
> (`targetOf`, which names every line of the row), `:1125` (`settle`), `:1143` (`revert`),
> `:1173` (`setLeft`, the old reel's call, a model for the at shop fields), `:1417`
> (`addLine`); `libs/velista/models/src/lib/basket-view.ts:535` to `:622` (`BasketRowEntry`:
> `left`, `bought`, `asked`, `demandEditable`), `:1246` (`BasketSettleRequest`), `:1306`
> (`BasketRevertRequest`); `libs/velista/feature-shopping-lists/src/lib/row-entries/row-entries.{html,ts}`
> (the entries, `shown` at `row-entries.ts:321`, the other lists at `:248`);
> `libs/velista/feature-shopping-lists/src/lib/settle-sheet/settle-sheet.ts:299` to `:309`
> (`demandRuns`, `raiseRuns`), `:520` (`canSettle`), `:921` to `:970` (`raise`);
> `libs/velista/ui/src/lib/list/quantity-stepper.ts` (the stepper; this plan adds an input).

## Brief for the agent

### Objective

Make each list's stepper in the basket row sheet show and change what this basket bought for
that list's line in this trip, show the list's ask beside its name, colour the number when
it reaches or passes the ask, and make the section "Add it to another list" record buys.

### Context

- `BasketRowEntry` carries `asked`, `bought` (this basket, this trip) and `left`.
  `boughtElsewhere` is not part of `bought` and stays out of this stepper.
- `BasketStore.settle` and `revert` target every line of the row (`targetOf`). This plan
  needs a target of one line.
- The sheet gathers a stepper's presses into runs (`quantityRuns`) and writes once they stop.
- `productLists` gives each list the basket covers and the reader may write to, with its
  oldest line of the product or `lineId: null`.

### Target state

1. **The store.** `settle` and `revert` take an optional `lineId`; with it the target is
   `{ rowKey, lineIds: [lineId] }`. A new `buyForList` calls backend `0273`'s route and
   updates the row from its answer as a settle does.
2. **The stepper's value** is `entry.bought` plus the open run. Minimum 0. The product's
   step and the row's unit as today.
3. **A run up** (net `to > from`) is a settle of that line: `outcome: 'BOUGHT'`,
   `quantity: to - from`, `from: entry.left`, no `allocations`, with the price scope, the
   shop and the item as `setLeft` sends them. **A run down** is a revert of that line:
   `target: 'UNITS'`, `units: from - to`, `from: entry.bought`. A run back to its start
   sends nothing.
4. **Who gets a stepper.** Every entry while the sheet `canSettle`, a list the reader was not
   served included ("Another list"): a buy is the basket's act, not a write to the list. A
   finished basket draws the number only, as today.
5. **The label.** "<list> · <ask>", the ask in the exact form with its unit ("· 1,5 kg"),
   joined with `" · "` as the rest of the app joins words. The list name is cut first, the
   ask never. The line "zone · line" under it is unchanged.
6. **The colour.** The stepper gains an input `target: number | null` (null: no colour). With
   a target, the number is `--app-status-success-fg` when the value equals it and
   `--app-action-quiet-fg` (amber) when the value is above it; below it, the normal colour.
   An entry whose ask is 0 and which has a buy is amber. The live region also says it: the
   amount it settles on is followed by "reached" or "more than asked" (keys
   `amount.reached`, `amount.over`).
7. **"Add it to another list".** Its heading becomes "Bought for another list" /
   "Comprado para otra lista" (keys of the mock's words). Its steppers start at 0 and a run
   up calls `buyForList` with the list, its `lineId` from `productLists` (or none) and the
   quantity. After the answer that list is an entry of the row and leaves the section. The
   section is still never drawn for a guest.
8. **The heading.** The lists of the row sheet sit under a heading that states the sheet's
   job, "What you bought" / "Lo que has comprado" (the mock's words), with velista `0200`'s
   "Lists and amounts" button in the same row.
9. **What goes.** `demandRuns` and `raise` leave the row sheet; the ask is changed only in
   velista `0200`'s detailed view. "Got all N", "They had none" and "Not today" are
   unchanged.

### Scope

- Work in `data-access` (the store), `models` (the request shapes), `feature-shopping-lists`
  (the entries and the settle sheet), `ui` (the stepper's `target` input), the i18n files.
- Do NOT change the zone list, the product page, the settle actions, or the backend.

### Constraints

- Rule D4: the answer of `buyForList` goes through the basket mappers.
- Rule T1, the hygiene and contrast specs (both colours on the stepper's surface, Day and
  Night).
- No dashes as punctuation in copy or comments.

### Action boundaries

- Stop if the mock is not approved, or if velista `0200` or backend `0273` is not built.
- Stop and ask if the server refuses a settle or a revert of one line for an entry whose
  list the reader was not served.

### Progress evidence

The specs of section 2; `npx nx affected -t lint test`; `npx nx build velista`; a walk on a
slot with two lists asking 3 and 1 and a third list asking nothing: step the first to 3 and
see green, to 4 and see amber, back to 2; buy 1 for the third list; read the row history.

## 1. Frames the mock must have

1. The row sheet with its "What you bought" heading and three lists: one below its ask, one
   at it (green), one above it (amber), each with "<list> · <ask>".
2. "Bought for another list" open, with one list stepped to 1.
3. A list name long enough to be cut.

## 2. Specs

1. The stepper shows `bought` plus the run; a run up of 2 sends one settle with
   `lineIds: [lineId]`, `quantity: 2`, `from: left`, no allocations; a run down of 1 sends one
   revert of that line with `from: bought`.
2. A run up then down to its start sends nothing.
3. The label reads "Compra semanal · 3"; with grams "· 1,5 kg".
4. The stepper's number has the success colour at the target, amber above, none below or
   with a null target.
5. `buyForList` is called with `lineId` null for a list with no line, and the list leaves
   the section after the answer.
6. A guest sees no "Bought for another list".

## 3. Acceptance criteria

- The steppers of the sheet record buys per list and never change an ask.
- A shopper sees when a list's ask is reached, and when it is passed.

## Not in this plan

- The detailed view, the change of an ask and of a product (velista `0200`).
- The reel in the compact view (velista `0204`).
