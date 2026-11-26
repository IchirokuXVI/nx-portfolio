> **PR:** [#1085](https://github.com/IchirokuXVI/nx-portfolio/pull/1085)

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
> says so in a heading ("What you bought" / "Lo que has comprado"). Changing an ask or a
> product moved to the detailed view of velista `0200`.
>
> Amended on 2026-11-22 after the owner approved the mock: colours A, so only the stepper's
> number takes the colour (green at the ask, amber above it). The buy steppers pass the
> list's ask as a second snap point beside 1000 (velista `0195`), so stepping lands exactly on
> the ask even when the step would skip it. The words "What you bought" / "Lo que has
> comprado", "Lists and amounts" / "Listas y cantidades" and "Bought for another list" /
> "Comprado para otra lista" are final. A guest sees no "Lists and amounts" and no "Bought
> for another list".
>
> Amended again on 2026-11-22: the ask comes from the wire. Backend `0274` adds `asked` to
> every entry, in the basket read, in every write answer and in the socket patches, so
> velista stops computing an entry's ask as `bought + left` (target state 10). The release
> raises `minClientVersion`, because the demand route's `quantity` changes meaning with it
> (velista `0200`).
>
> Amended on 2026-11-23 after its review: the steppers stay live on a row with nothing left,
> until the shopping list is finished.
>
> Amended on 2026-11-23: the buy steppers (the entries and "Bought for another list") draw the
> plain minus at 1, never the trash, and still step to 0, because a buy taken back to 0 takes
> no line off its list. The stepper's `trashAtZero` input, true by default, turns it off.
>
> This was the design of the sheet before velista `0139`: the entries pane of velista `0090`
> had a "got" reel per list (commit `3b8da1e91`, `row-entries.ts`, output `allocated`),
> removed by `9f74867a1`. Its revert then took units from the whole row; this plan takes
> them from one line.
>
> **The mock is approved**: the same mock as velista `0200`
> (`apps/velista/plans/mocks/basket-row-buys/`), published at
> https://claude.ai/artifact/BfjSwJoGP4hyuG3DXTEiy6. Take every look and word from its boards
> (section 1 lists them) and the notes in its `canvas.json`.
>
> Depends on velista `0195` (the `snaps` input of the stepper), velista `0200` (the detailed
> view), backend `0273` (a buy for a list that did
> not ask) and backend `0274` (a buy records how much of the ask it met). **Release `0200`,
> `0201` and backends `0273` and `0274` together.** Without `0200` the row sheet loses the
> only place to change an ask; without `0273` the section "Add it to another list" cannot
> record a buy; without `0274` the ask moves with every buy above it (a list asking 3 reads
> "· 4" after a buy of 4), amber can never show, and a minus after such a buy raises the
> list's ask. Velista `0204` later draws these steppers as reels
> in the compact view.
>
> **Release note: this release raises `minClientVersion`.** Backend `0274` changes what the
> demand route's `quantity` means (the whole ask, no longer `left`), so a client of before
> this release must not reach the new server. The release notes say it, and the velista
> unit's release raises the number in the same deploy.
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
> The ask as velista computes it, on this branch:
> `libs/velista/data-access/src/lib/mapping/basket-mappers.ts:183` to `:243`
> (`toBasketRowEntry`, `asked: bought + left` at `:231` with its comment "Not on the wire"
> at `:227`; it maps the entries of the read and, through `toBasketRowResult` at `:469` to
> `:481`, of every write answer), `:311` (the row's `asked`, already read from the wire with
> the sum as the fallback, the model to copy), `:983` to `:1030` (`toBasketEntryPatch`, the
> socket patch, strict, with no `asked`);
> `libs/velista/models/src/lib/basket-patch.ts:24` to `:45` (`BasketEntryPatch`, no
> `asked`), `:51` to `:66` (`basketEntryPatchOf`, a write answer applied as a patch),
> `:228` (`patchEntry`, `asked: patch.bought + patch.left`), `:264` to `:276`
> (`samePatched`); `libs/velista/models/src/lib/basket-row-fold.ts:175` to `:203`
> (`rebuildBasketRow`, the row's `asked` from `rowNumbersOf`), `:252` to `:261`
> (`toRuleEntry`, no `applied`); `libs/luna-shopper/basket-rules/src/lib/basket-rules.ts:71`
> to `:93` (`BasketRuleEntry`, `BasketRuleNumbers.asked` "`bought + left`", which backend
> `0274` changes); `libs/velista/data-access/src/lib/baskets/basket-memory.ts:2101`, `:2380`
> and `:2730` (the fake's `asked: bought + left`).

## Brief for the agent

### Objective

Make each list's stepper in the basket row sheet show and change what this basket bought for
that list's line in this trip, show the list's ask beside its name, colour the number when
it reaches or passes the ask, and make the section "Add it to another list" record buys.

### Context

- `BasketRowEntry` carries `asked`, `bought` (this basket, this trip) and `left`.
  `boughtElsewhere` is not part of `bought` and stays out of this stepper.
- Today velista computes an entry's `asked` as `bought + left` in three places: the entry
  mapper, the patch fold and the fake. After a buy above the ask that sum is wrong (a list
  asking 3 with 4 bought has `left` 0, and the sum says 4). Backend `0274` puts the right
  number on the wire as `asked`.
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
   step and the row's unit as today. **Its snap points** are the list's ask beside 1000
   (`snaps: [...QUANTITY_SNAP_POINTS, entry.asked]`, velista `0195`), so a press lands
   exactly on the ask even when the step would skip it: with an ask of 990 g and a step of
   25, up from 975 lands on 990, then on 1000. An ask of 0 adds no point (velista `0195`
   ignores a point at 0). The ask stepper of velista `0200`'s detailed view passes no
   `snaps`.
3. **A run up** (net `to > from`) is a settle of that line: `outcome: 'BOUGHT'`,
   `quantity: to - from`, `from: entry.left`, no `allocations`, with the price scope, the
   shop and the item as `setLeft` sends them. **A run down** is a revert of that line:
   `target: 'UNITS'`, `units: from - to`, `from: entry.bought`. A run back to its start
   sends nothing.
4. **Who gets a stepper.** Every entry while the shopping list is not finished, whatever the
   row has left, a list the reader was not served included ("Another list"): a buy is the
   basket's act, not a write to the list. A row stepped to its ask keeps its steppers, so a
   shopper can buy above the ask or take back a mistap; only "Got all N", "They had none"
   and "Not today" follow `canSettle`. A finished basket draws the number only, as today.
5. **The label.** "<list> · <ask>", the ask in the exact form with its unit ("· 1,5 kg"),
   joined with `" · "` as the rest of the app joins words. The list name is cut first, the
   ask never. The line "zone · line" under it is unchanged.
6. **The colour.** Only the stepper's number takes the colour (colours A of the mock): no
   ring, no fill, no colour on the label. The stepper gains an input `target: number | null`
   (null: no colour). With a target, the number is `--app-status-success-fg` when the value
   equals it and `--app-action-quiet-fg` (amber) when the value is above it; below it, the
   normal colour.
   An entry whose ask is 0 and which has a buy is amber. The live region also says it: the
   amount it settles on is followed by "reached" or "more than asked" (keys
   `amount.reached`, `amount.over`).
7. **"Add it to another list".** Its heading becomes "Bought for another list" /
   "Comprado para otra lista". Its steppers start at 0, take no ask as a snap point (the
   list asks nothing yet), and a run up calls `buyForList` with the list, its `lineId` from `productLists` (or none) and the
   quantity. After the answer that list is an entry of the row and leaves the section. The
   section is still never drawn for a guest.
8. **The heading.** The lists of the row sheet sit under a heading that states the sheet's
   job, "What you bought" / "Lo que has comprado", with velista `0200`'s "Lists and amounts"
   / "Listas y cantidades" button at its right. A guest who can change nothing sees the
   heading without the button (velista `0200`, target state 2).
9. **What goes.** `demandRuns` and `raise` leave the row sheet; the ask is changed only in
   velista `0200`'s detailed view. "Got all N", "They had none" and "Not today" are
   unchanged. With them go the row sheet's two callers of `setDemand` (`demand` and the
   other lists path of `raise`), which sent the line's `left` as `quantity`; velista `0200`
   owns the callers that stay.
10. **The ask comes from the wire** (rule D4). Backend `0274` adds `asked` to every entry:
    in the basket read, in every write answer and in the socket patches.
    - **The entry mapper** (`toBasketRowEntry`, `basket-mappers.ts:231`) reads `asked` from
      the wire, as the row's mapper at `:311` already does: `'asked' in raw ?
      atLeastZero(raw['asked']) : bought + left`. The sum is only the fallback for a missing
      field. The comment "Not on the wire" goes. This covers the read and every write answer
      (`toBasketRowResult` maps its entries through the same function).
    - **The patch.** `BasketEntryPatch` gains `asked`; `toBasketEntryPatch` reads it with
      the same fallback (a missing `asked` does not refuse the patch, because a server
      without it means `bought + left`); `basketEntryPatchOf` copies it; `patchEntry` sets
      `asked: patch.asked` in place of `patch.bought + patch.left` (`basket-patch.ts:228`);
      `samePatched` compares it.
    - **The row fold.** `toRuleEntry` (`basket-row-fold.ts:252`) passes
      `applied: entry.asked - entry.left` to the shared rules, the field backend `0274`
      adds to `BasketRuleEntry`, so `rowNumbersOf` gives the row the right `asked` after a
      patch or a write answer too. Velista adds no sum of its own.
    - **The fake** (`basket-memory.ts:2101`, `:2380`, `:2730`) keeps the ask it was given and
      answers `asked` as backend `0274` does, so a memory spec of a buy above the ask reads
      the original ask.

### Scope

- Work in `data-access` (the store, the basket mappers, the fake), `models` (the request
  shapes, `basket-patch.ts`, `basket-row-fold.ts`), `feature-shopping-lists` (the entries
  and the settle sheet), `ui` (the stepper's `target` input), the i18n files.
- Do NOT change `libs/luna-shopper/basket-rules`: backend `0274` adds `applied` there, and
  this plan only passes it.
  Velista `0200` adds the stepper's disabled state and velista `0195` its `snaps` input in
  the same `quantity-stepper.*` files.
- Do NOT change the zone list, the product page, the settle actions, or the backend.

### Constraints

- Rule D4: the answer of `buyForList` goes through the basket mappers.
- Rule T1, the hygiene and contrast specs (both colours on the stepper's surface, Day and
  Night).
- No dashes as punctuation in copy or comments.

### Action boundaries

- Stop if velista `0195`, velista `0200` or backends `0273` and `0274` are not built (a stand
  in for their answers is fine while they are being built, and is removed before this plan
  is marked ready).
- Stop and ask if the mock shows something on a row this plan does not list.
- Stop and ask if the server refuses a settle or a revert of one line for an entry whose
  list the reader was not served.

### Progress evidence

The specs of section 2; `npx nx affected -t lint test`; `npx nx build velista`; a walk on a
slot with two lists asking 3 and 1 and a third list asking nothing: step the first to 3 and
see green, to 4 and see amber with the label still "· 3", back to 3 and see green with the
label still "· 3", back to 2; buy 1 for the third list and see "· 0" in amber; read the row
history.

## 1. The mock's boards

The boards of `apps/velista/plans/mocks/basket-row-buys/` for this plan, each Day in English
beside Night in Spanish:

1. `RowSheet.dc.html`: the row sheet with its "What you bought" heading, the "Lists and
   amounts" button and the lists, one at its ask (green) and one above it (amber), each
   with "<list> · <ask>".
2. `OtherList.dc.html`: "Bought for another list" open, with one list stepped to 1.
3. `LongName.dc.html`: a list name long enough to be cut, with an ask by weight.
4. `Guest.dc.html`: a guest: no "Lists and amounts" and no "Bought for another list".
5. `Today.dc.html`: the sheet as it is on `dev`, for comparison.

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
6. A guest sees no "Bought for another list" and no "Lists and amounts".
7. With the row's answers as backend `0274` gives them: a list asking 3 stepped to 4 reads
   "· 3" and amber; a minus back to 3 reads "· 3" and green, and the list's ask on the zone
   list is still 3; a list made by a buy of 2 reads "· 0" and amber.
8. The snap point of the ask: an ask of 990 g with a product step of 25, the stepper at 975
   g; a plus lands on 990 (green), the next plus on 1000 (amber); from 1010 a minus lands on
   1000, the next on 990. The stepper of an entry receives `snaps` `[1000, ask]`, and the
   steppers of "Bought for another list" receive no `snaps` input, so only the default stop
   at 1000 applies.
9. The entry mapper reads `asked` from the wire: an entry with `asked: 3`, `left: 0`,
   `bought: 4` maps to `asked` 3; with no `asked` field it maps to `bought + left`.
10. After a settle answer: a list asking 3 is settled to 4, the write answer carries the
    entry with `asked: 3`, `left: 0`, `bought: 4`; the row sheet's label still reads "· 3",
    the number is amber, and the row's `asked` is 3.
11. After a socket patch: a `basket.linesChanged` patch of the same entry with `asked: 3`,
    `left: 0`, `bought: 4` leaves the entry's `asked` at 3 and the row's `asked` at 3
    (`basket-patch.spec.ts`); a patch with no `asked` is applied with `bought + left`.
12. `toRuleEntry` passes `applied` as `asked - left` (`basket-row-fold.spec.ts`): a row of
    two entries asking 3 and 1, the first with 4 bought, rebuilds to `asked` 4.

## 3. Acceptance criteria

- The steppers of the sheet record buys per list and never change an ask.
- A shopper sees when a list's ask is reached, and when it is passed.
- A list's ask does not move when the shopper buys more than it, or takes those units back.

## Not in this plan

- The detailed view, the change of an ask and of a product (velista `0200`).
- The reel in the compact view (velista `0204`).
