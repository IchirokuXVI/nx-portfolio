> **PR:** [#1099](https://github.com/IchirokuXVI/nx-portfolio/pull/1099) stage 1, [#1100](https://github.com/IchirokuXVI/nx-portfolio/pull/1100) stage 2, [#1101](https://github.com/IchirokuXVI/nx-portfolio/pull/1101) stage 3

# 0208: every raise asks about the extra, and the amount set stands

> Decided on 2026-11-23; the owner's final rulings of 2026-11-25 replace the design this
> plan held before. It amends velista `0207`, which is built (PR #1089) and merged into
> `dev`, and which no release carries. Its partner is backend `0276`.
>
> A list's line can have units that a shopper already bought above what the list asked
> for in an open shopping list (the list asked 3, Marta bought 4: 1 extra; backend `0274`).
> When a person raises that line, velista asks whether the extra counts: "Marta already
> bought 1 extra. Do you still need 3, or just 2?", with "Still need" and "Count the extra".
>
> **The owner's rule: after a raise, the extra always ends up inside the ask. Only the
> size of the ask differs.** His example, in a basket's "Lists and amounts": a list asks 3,
> 5 were bought (2 extra), and the person presses plus twice.
>
> - **"Count the extra":** ask 5, bought 5 of 5, left to buy 0. The extra covers the raise.
> - **"Still need"**, which is also what stands when the question gets no answer (closed,
>   page left, control gone, app closed): ask 7, bought 5 of 7, left to buy 2. The ask
>   rises by the extra plus what the person added.
>
> So in both outcomes no unit is left above the ask, "bought" and "asked" always add up,
> and nothing has to be remembered about an answer. The question comes back only when
> somebody later buys above the ask again.
>
> **What the person sees.** The backend's raise already writes the "Still need" outcome
> (backend `0276`). The question offers the one change: "Count the extra" lowers the line.
>
> - **On a control that shows the line** (the zone list's rows, the line sheet, the line
>   page, the catalog cards, the product page's table, the "Add or find" fields), the
>   number does not move after the default: that control shows what is left to buy, and
>   the default leaves it where the person set it. With the line set to 4 and 3 extra
>   bought, the control shows 4, and 1 after "Count the extra".
> - **In the basket's "Lists and amounts" and its catalog cards** the control shows the
>   list's whole ask, and that ask counts this shopping list's own buys. After the raise
>   it shows the larger number (7 in the owner's example), and after "Count the extra" the
>   smaller (5).
>
> **One text everywhere**, the existing one: "<Someone> already bought <X> extra. Do you
> still need <Y> or just <Z>?", with `0207`'s variants for several buyers and for units.
> **`Y` is the number the control shows after "Still need", `Z` the number it shows after
> "Count the extra".** In the owner's example that is 7 and 5; on a list page with the line
> set to 4 and 3 extra bought it is 4 and 1. `X` is the extra the raise took in. When `Z`
> is 0 the question uses `0207`'s "enough" variant ("Do you still need 2, or is that
> enough?", with "That's enough"). `Z` never equals `Y` while there is a question: a
> report that offers nothing to count (`countable: 0`) asks nothing.
>
> **Everything else ruled for the question stays** (velista `0207`, its opening blockquote
> and target states 4 to 6, 11 to 14): the words and their variants (never printing 0;
> units on the answer rows only for a count; the buyers' wording including "X, Y and
> others" and "Someone"; a buyer named only when a member of the list's group); the
> pointer that never covers what it points at (velista `0206`); it opens only after the
> control's quiet beat **and** the save's answer; the page in front (no sheet over it), or
> else the default; focus is never taken from a text field; the scroll to the row and the
> flash on the zone list; a reel asks only after its tape closed; a lowering never asks.
>
> **The owner's answers of 2026-11-25:**
>
> 1. **No exception for the same shopping list.** Every control asks about every open
>    shopping list's extra, the extra bought through this same shopping list included: the
>    person may have forgotten it, or another shopper on the same shopping list bought it.
>    If users complain later, the exception can be added then.
> 2. **A line that changed before the answer: refuse and say so.** "Count the extra" on a
>    line that no longer holds the amount the question was about is refused
>    (`stale_quantity`), nothing is counted, and the app says "The amount changed in the
>    meantime, so nothing was counted." in the popover's place, on the control, which shows
>    the line's current amount. The notice closes on the next touch (target state 4).
> 3. **The question scrolls its control into view.** When the answer arrives and the
>    control that raised the line still exists on the current page or sheet but is out of
>    sight, the app scrolls to it and shows the popover. When the page, the sheet or the
>    control is gone, the default stands and nothing is asked. The owner weighed one
>    alternative and may switch to it: ask only if some part of the control is still
>    visible, and otherwise take the default, because a scroll that nobody asked for,
>    seconds or minutes later, may feel invasive. The build leaves a code comment naming
>    that alternative at the place that scrolls (target state 10).
> 4. **Only "Count the extra" writes.** "Still need" sends nothing: the raise already wrote
>    it. Nothing about an answer is stored, on the server or in the app.
> 5. **A guest sees the question** like anyone who may change the ask, with "Someone" for
>    a buyer the guest's client cannot resolve (target state 20).
>
> **Focus starts on "Still need"**, the answer that changes nothing (the owner,
> 2026-11-22). `0207`'s line "Focus never starts on Still need" is replaced.
>
> **Dependencies and release rule.** It needs backend `0276` (the absorption on every
> raise, `reportExtra`, the two count routes, the removal of `countExtra`), velista `0206`
> (the pointer) and everything velista `0207` needs. **Release it together with backend
> `0276`.** Both replace behaviour that is in `dev` only: PRs #1087 and #1089 are on no tag
> and not on `main` (the newest velista tag is `velista-v0.19.0`).
>
> **Stage 1 merges together with backend `0276`.** It is the client half of the removal of
> `countExtra`. Until it merges, this velista code in `dev` is wrong against `0276`:
>
> - `list-page.ts` `_writeRun` sends `countExtra: true`, which the gateway refuses with a
>   400 once `0276` lands, so a raise on the zone list's row steppers and reel fails;
> - `LineStore.raiseCountingExtra`, the model `CountedExtra` and `toCountedExtra` read a
>   `counted` that no answer carries;
> - the zone list page draws `Y` over a store that holds `Z`, holds a row at `Z = 0`, and
>   its "Still need" sends a second raise, which would raise the line again;
> - `_stillNeeded` keeps a memory that no longer means anything.
>
> Stage 1 is therefore opened on top of backend `0276`'s branch and merged right after it,
> so `dev` never holds one without the other. Until stage 4, the basket's "Lists and
> amounts" and its catalog cards show the larger ask that the server answers after a raise
> over this shopping list's own extra, with no question beside it.
>
> **The mock comes first** (the owner's rule). The board `OverBoughtEverywhere.dc.html` in
> `apps/velista/plans/mocks/compact-reel/` (PR #1094) draws the question on every control;
> `OverBought.dc.html` stays as the record of the popover's look. Section 1 lists what the
> board must still change or add. No stage is built before its frames are approved.
>
> Code anchors, on `dev` at `6fa4f4b9c`, are in each control's row of section 3.

## Brief for the agent

Load the "Angular conventions" of CLAUDE.md and the `design-taste-frontend` skill.

### Objective

Flip the question of velista `0207` to the owner's rule (the raise takes the extra into
the ask and the amount set stands as left to buy; only "Count the extra" lowers the line;
"Still need" sends nothing), move it into one shared piece, and use that piece on every
control that raises a list line: the zone list's rows, the line sheet, the line page, the
catalog cards, the product page's table, the zone list's "Add or find" field, the basket's
"Lists and amounts", the basket's catalog cards and the basket's "Add or find" field.

### Context

- Backend `0276`: every raise of a list line moves every unit above an open basket's ask
  into that ask, and raises the line by the amount set. Five writes take `reportExtra:
  true` and, when they raised the line, answer `extra: { above, countable, buyers }`:
  `above` is the extra the raise took in, `countable` what "Count the extra" would take
  off the line (`min(above, raise)`). Two writes count: `POST /v1/lines/:id/extra` and
  `POST /v1/baskets/:id/rows/:rowKey/extra`, body `{ unit, amount, expect }` (the basket's
  adds `lineId`), answering `201` with the line or the row and `counted`. Both refuse
  with `stale_quantity` when the line no longer holds `expect`, and with a 400 when
  `amount` is above `expect`.
- On every control, the basket's included, the report covers every open shopping list,
  the reader's own included (the owner's answer 1).
- Velista `0207` as built, `libs/velista/feature-lists/src/lib/list-page/list-page.ts`:
  state `extraAsk` `:2703`, `extraFlashing` `:2706`, `extraWords` `:2718`, `_stillNeeded`
  `:2744`, `_rowRuns` `:2751`, `_waitingAsk` `:2768`; `quantityRuns` `:1943`, `_writeRun`
  `:2039` (`countExtra` at `:2047`), `changeQuantity` `:2291` (`raiseCountingExtra` at
  `:2310`), `_extraAnswered` `:2823`, `onReelOpened` `:2854`, `onSheetOpened` `:2878`,
  `_ask` `:2894` (scroll at `:2970`), `_flash` `:3027`, `stillNeedExtra` `:3044`,
  `keepExtra` `:3061`, `closeExtraAsk` `:3071`, the replay `resendDropped` `:1336`, the
  detach watch `:1407`; `list-page.html:585` to `:610` (the popover), `:354` to `:527` (the
  row bindings). `libs/velista/ui/src/lib/list/extra-ask.ts` (`lib-extra-ask`: `words`,
  `titleId`, `takeFocus`; outputs `stillNeed`, `kept`, `dismissed`), `extra-ask-words.ts`
  (`extraAskWords`, asked = `left + counted`), `extra-ask-place.ts`.
- Data: `libs/velista/data-access/src/lib/lines/line-store.ts` `addQuantity` `:934`,
  `raiseCountingExtra` `:952`, `_addQuantity` `:963`, the dropped write record `:1022`,
  `addLine` `:609`, `updateLine` `:808`; `line-service.ts:186`, `:196`; `line-api.ts:269`,
  `:285`, `addLineResult` `:130`, `updateLine` `:255`; `line-memory.ts:635`, `:672`;
  `mapping/counted-extra-mapper.ts`; `mutations.ts:45` (`DroppedWriteReplay.countExtra`
  `:60`); `libs/velista/models/src/lib/requests.ts:205` (`countExtra` `:217`), `:225`
  (`CountedExtra`). The basket: `libs/velista/data-access/src/lib/baskets/basket-api.ts`
  `setDemand` `:374`, `addLine` `:444`; `basket-store.ts:1322`.
- `libs/velista/feature-lists/src/lib/only-the-zone-list-counts-extra.spec.ts` asserts that
  only the zone list page names `raiseCountingExtra`.
- `apps/velista-luna-e2e/src/over-bought.spec.ts` walks `0207` against the real backend.

### Target state

#### Stage 1: the owner's rule on the zone list's rows

1. **The data layer.**
   - `CountedExtra` becomes `AbsorbedExtra` (`above`, `countable`, `buyers`) in
     `libs/velista/models`; `AddLineQuantityRequest.countExtra` and
     `DroppedWriteReplay.countExtra` become `reportExtra`.
   - `LineService`, `LineApi`, `LineMemory`, `LineStore` and the store double:
     `raiseCountingExtra` becomes `raiseReportingExtra(lineId, delta, options)` (sends
     `reportExtra: true`, answers the line and `extra`, null when absent or malformed). The
     mapper `toAbsorbedExtra` replaces `toCountedExtra` (rule D4): `above` and `countable`
     non negative whole numbers, `countable <= above`, buyers `{ userId: string | null }`;
     anything else maps to null and asks nothing. `LineMemory` follows backend `0276`
     target states 1 and 6, so a spec run against the memory sees the same numbers.
   - New `countExtra(lineId, amount, expect)` on the same four: `POST lines/:id/extra`,
     answers the line and `counted`. The store patches `quantity` to `expect - amount` at
     once (the overlay on `quantity`, as `addQuantity`), takes the answered line on
     success, takes the server's line on `stale_quantity`, and puts the line back on any
     other failure.
   - **The count is not a dropped write record** (velista `0159`), and it is never sent
     again by itself: a count replayed later would lower a line on numbers the person no
     longer sees.
2. **The raise.** `_writeRun` sends `reportExtra: true` where it sent `countExtra: true`
   (a row's run, a positive delta), and never at teardown (nobody is left to ask; the
   server takes the extra in anyway). The replay of a dropped write carries `reportExtra`
   when the dropped write did, and its answer may ask under the rules of target state 3.
   The due rows still never report and never ask.
3. **When it asks.** As `0207` target state 3, with `extra.countable > 0` in place of
   `counted > 0`. `Y` is the answered line's `quantity` (what the line holds, what the
   control shows, and what "Still need" leaves); `Z = Y - extra.countable` (what "Count the
   extra" leaves); `X = extra.above`. The words are `extraAskWords` with `{ extra, shown:
   Y, after: Z }` in place of `{ extra, left }`: the question uses `list.extra.ask` with
   `asked = Y` and `left = Z`, and `list.extra.askEnough` with "That's enough" when `Z` is
   0. Nothing else in it changes. Between the tap and the answer the control shows the
   number the person stepped to, which is `Y`: on these controls the number never jumps.
4. **The answers.** Only the two buttons are answers.
   - **"Still need"**: the popover closes. Nothing is sent: the raise already wrote this
     outcome. The line keeps `Y`.
   - **"Count the extra"** or **"That's enough"**: sends `countExtra(lineId,
     extra.countable, Y)`. The popover closes and the control shows `Z` at once. On a
     refusal `stale_quantity` nothing is counted, the control shows the line's current
     amount from the server, and the notice `list.extra.stale` takes the popover's place:
     the same anchored frame, its pointer on the control, no buttons, announced in the
     page's polite live region. It closes on the next touch anywhere, on Escape and on
     leaving. On any other failure the line goes back to `Y` and the notice
     `list.extra.countFailed` shows in the same way.
   - Escape, a press outside, the back gesture, leaving the page, a press on the row's own
     amount control, and another line's question replacing this one are **no answer**:
     nothing is sent, and the line keeps `Y`. A press on the control then steps from `Y`.
5. **Focus** moves to "Still need" when the popover opens, unless a text field holds focus
   (then focus stays where it is). It never starts on "Count the extra" or "That's enough".
6. **Asking again needs no memory.** After any raise the extra is inside the ask, so the
   next raise of the line reports `countable: 0` and asks nothing, on any control, for
   anybody, whatever the person answered or did not answer. When somebody buys above the
   ask again, the next raise reports the new extra and asks. The open popover holds its
   own request (`lineId`, `countable`, `Y`, the control) until it closes, and nothing
   outlives it.
7. **What is removed.** `_stillNeeded` and every check of it; the drawing of `Y` over a
   store holding `Z`; the hold of a row at `Z = 0` while the question is open (`_held` for
   the question; velista `0199`'s own hold stays); `stillNeedExtra`'s second raise.
8. **The rest of `0207`** stays: the scroll, the flash, the reel's tape wait, one question
   at a time, the words, the keys, the look, both views.
9. **New keys**, in `libs/velista/ui/assets/i18n/en.json` and `es.json` (**the owner reviews
   this wording after the build**):
   - `list.extra.stale`: "The amount changed in the meantime, so nothing was counted." /
     "La cantidad cambió mientras tanto, así que no se contó nada."
   - `list.extra.countFailed`: "Nothing was counted. Try again." / "No se contó nada.
     Inténtalo otra vez."
   Reused unchanged: every `list.extra.*` key `0207` built (`boughtBy`, `boughtByYou`,
   `boughtByTwo`, `boughtByYouAndOne`, `boughtByOneAndSomeone`, `boughtByYouAndSomeone`,
   `boughtByMany`, `boughtBySomeone`, `boughtByNamedAndOthers`, `ask`, `askEnough`,
   `stillNeed`, `count`, `enough`, `units_one`, `units_other`, `announce`). No key of its
   own for the basket: the owner rejected a separate "more" wording.

#### Stage 2: one shared piece, and the sheet, the line page and the catalog

10. **The piece**, in `libs/velista/ui/src/lib/list/`, free of `data-access` (the host
    passes the write in):
    - `ExtraAskHost` (`extra-ask-host.ts`), provided per page or sheet that shows the
      question: `ask(request)` and the state the popover reads. `request` holds `lineId`,
      `zoneId`, `unit`, `extra`, `shown` (`Y`), `origin()` (the control), `keepInSight()`
      (the row, the card or the table row), `count()` (the host's call of `countExtra`,
      answering `done`, `stale` or `failed`), and two answers of the host: `inFront()` (no
      sheet, dialog or other popover over it) and `atRest()` (a reel's tape is down).
    - **The "still there" rule** (the owner's answer 3): `origin()` is connected and
      `inFront()` is true. If `atRest()` is false the question waits for the rest, then
      checks again. If any check fails (the page, the sheet or the control is gone, or
      something is in front), the question is dropped and the default stands. When the
      origin is wholly or partly outside the host's visible area, the host scrolls
      `keepInSight()` into view inside its own scroll container (`block: 'nearest'`,
      smooth unless the person asked for reduced motion) and then opens the popover. The
      zone list keeps its own scroll (`0207` target state 11) and calls `ask` after it.
      The scroll carries a comment that names the owner's alternative: ask only when some
      part of the control is still visible, and otherwise take the default, because a
      scroll nobody asked for, seconds or minutes later, may feel invasive.
    - The rules of stage 1 (one question per host, a new one replaces, the answers, focus,
      the words, the notices of target state 4), and the flash of `0207` target state 12,
      move into it; the zone list page uses it in place of its own state.
    - `lib-extra-ask-popover` (`extra-ask-popover.ts`): `lib-anchored-popover` (frame
      `choice`, `pointer`, `align="end"`, side by the origin's place in the host's visible
      area, `accent` while flashing) around `lib-extra-ask` or the notice, reading the
      host. Each host puts one in its template.
11. **The line sheet**, `libs/velista/feature-lists/src/lib/line-detail-sheet/line-detail-sheet.ts`.
    Today Save (`_save` `:881`) sends `updateLine(id, { quantity, ... })`, a `PATCH` with
    the absolute amount from the stepper (`line-detail-sheet.html:110`,
    `onAmountChanged` `:749`); the sheet stays open after a save. Change: when the saved
    `quantity` is above the line's, the save carries `reportExtra: true`
    (`LineStore.updateLine` gains the option and answers `extra`). On an answer with
    `countable > 0` while the sheet is open and in front, the sheet's host asks, anchored
    on the amount stepper, scrolling the stepper's row into view if it is out of sight.
    After "Count the extra" the sheet's `amount` and `_shown` take the answered line. A
    save that merges (`confirmMerge`) and a unit change (`chooseUnit` `:819`) never report.
12. **The line page**, `libs/velista/feature-lists/src/lib/line-page/line-page.ts`. Today
    `quantityRuns` (`:403`) sends `addQuantity(lineId, run.to - run.from)` from the stepper
    (`step` `:427`, `line-page.html:128`). Change: a positive run sends
    `raiseReportingExtra`; the page's host asks on the stepper.
13. **The catalog cards**, `libs/velista/data-access/src/lib/catalog/catalog-add-store.ts`
    and `libs/velista/feature-catalog/src/lib/catalog-page/catalog-page.ts`. Today a card's
    stepper (`stepLine` `:1115`, store `step` `:481`) writes a quiet beat run through
    `_writeRun` (`:785`) with `addQuantity` (`:794`), and a card's add (`addProduct`
    `:1093`, store `add` `:443`, `_add` `:633`) sends `addLineResult` (`:649`), which can
    answer `RAISED`. Change: `step` and `add` take `reportExtra` and an `onExtra(report)`
    callback that the store calls when the answer carries `countable > 0`; the page passes
    `reportExtra`, and its host asks on the card's stepper (a raise) or the card's add
    control (an add that raised), scrolling the card into view if it is out of sight. A
    card that the results no longer draw (a new search, a filter) drops the question. The
    take back (`:970`) never reports.
14. **The product page's table**, `libs/velista/feature-catalog/src/lib/product-page/product-page.ts`
    (`stepListLine` `:556`, `addToList` `:538`, `stepLine` `:514`, `addProduct` `:490`) and
    `libs/velista/ui/src/lib/catalog/lists-table.ts` (outputs `added` `:228`, `lineStepped`
    `:231`). The same store calls as the catalog. Change: as target state 13, anchored on
    the table row's stepper or add control for that list, scrolling the table row into
    view if it is out of sight. `lists-table` exposes the element of each row's control for
    the anchor.

#### Stage 3: the zone list's "Add or find" field

15. Today `add` (`list-page.ts:2371`) and `_send` (`:2387`) send `addLine` (`:2409`, `POST
    /v1/lists/:id/lines`) for free text and for a catalog product; the answer `raised`
    (a line at zero or below met and raised, plan 0260 R2) is handled at `:2556` and marks
    the line; `chooseLine` (`:2646`) raises a chosen line with `intoLineId`. A card's
    stepper inside the composer (`changeHolding` `:1380`) steps through `_step` outside
    `_rowRuns`, so it sends a plain `addQuantity`.
16. Change: the field's adds carry `reportExtra: true` (`LineStore.addLine` gains the
    option and answers `extra`). On `raised` with `countable > 0`: when the raised line's
    row is drawn by the current search and filter, the page scrolls to it as `0207` target
    state 11 and asks on the row's amount control, with the flash; when it is not drawn,
    the control is gone and the default stands. The composer keeps its focus
    (`holdOnSend`): the question opens with no focus move. A composer card's stepper sends
    `raiseReportingExtra` for a positive run and asks on that card's stepper.

#### Stage 4: the basket

17. **"Lists and amounts"**, `libs/velista/feature-shopping-lists/src/lib/row-lists-sheet/row-lists-sheet.ts`
    (route `rows/:rowKey/lists`). Today the ask stepper (`row-lists-sheet.html:99`,
    `stepAsk` `:384`) runs `_demandRuns` (`:220`) and `_demand` (`:460`) sends
    `setDemand({ lineId, quantity: run.to, from })` (`:477`): the list's **whole** ask, with
    `from` the `left` seen. Change: a run whose ask rises carries `reportExtra: true`
    (`BasketStore.setDemand` gains it and answers `extra`). On `countable > 0` while the
    sheet is open and in front, its host asks on that list's ask stepper, scrolling it into
    view if it is out of sight. It asks about every shopping list's extra, this one's
    included (the owner's answer 1).
    - **The numbers.** This stepper shows the list's whole ask, `left` plus what this
      shopping list's buys met. `Y` is the answered entry's `asked` and `Z = Y -
      countable`. The extra of another shopping list moves that list's ask, not this one:
      the owner's frame 6 case (another shopping list's buyer, the ask raised to 3) asks
      "Do you still need 3, or just 2?". This shopping list's own extra moves this ask: in
      the owner's example (asks 3, bought 5, plus twice) the answer is ask 7, and the
      question is "You already bought 2 extra. Do you still need 7, or just 5?" (backend
      `0276`, cases 4 to 7).
    - **What the person sees between the tap and the answer.** The stepper draws the
      run's amount while the run and its write are open, as the basket's catalog cards do
      today (`_sending`, the write is not optimistic): 3, 4, 5. When the answer arrives
      the stepper shows the server's ask (7) in the same frame as the popover opens on it,
      so the one jump comes with the sentence that explains it. No animation of the
      number. When the question cannot open (the sheet was closed or something is in
      front), the stepper simply shows the server's ask when it is next drawn. The
      alternative, drawing this shopping list's own extra into the number at the first
      tap (the entry gives it: `bought - (asked - left)`), was rejected: it is a jump of
      several units under the finger on a single tap, before anything explains it.
    - The count is `BasketStore.countExtra(rowKey, lineId, countable, expect)`, with
      `expect` the answered entry's `left`. The store patches the entry's `left` and
      `asked` down by `countable` at once and takes the answered row on success. It
      follows target states 1 and 4. "Still need" sends nothing.
18. **The basket's catalog cards**, `libs/velista/feature-shopping-lists/src/lib/basket-page/basket-page.ts`
    (`_holdingRuns` `:2574`, `changeHolding` `:2583`, `_sendHolding` `:2598`, which sends
    `setDemand` at `:2618`). The card's stepper shows the whole ask too. Change: as target
    state 17, numbers and drawing included, anchored on the card's stepper.
19. **The basket's "Add or find" field, the removable piece.** Today `askWhere` (`:2279`),
    `pickList` (`:2292`) and `_addTo` (`:2775`) send `addLine` (`POST /v1/baskets/:id/lines`);
    a raise is handled at `:2942` to `:2967` (the page marks the row). Change: the add carries
    `reportExtra: true`. On a raise with `countable > 0` while the basket page is in front,
    the page puts one pending question in `ExtraAskHandoff` and navigates to the row's
    "Lists and amounts" (`sheetSegments('rows', rowKey, 'lists')`, the row the page marks
    today). `row-lists-sheet` takes the pending question when it opens, and its host asks on
    the ask stepper of the raised line's list once the sheet has finished opening,
    scrolling it into view if needed. The question's `Y` is that entry's `asked` as the
    sheet draws it, and `Z = Y - countable`. A line the sheet does not draw, or a pending
    question older than the navigation, drops it: the default stands.
    **This piece is built to be removed** (the owner: "likely to change and be removed"):
    one file, `libs/velista/feature-shopping-lists/src/lib/basket-page/extra-ask-handoff.ts`
    (a service provided by the basket page: `put`, `take`), one call in `basket-page.ts`
    and one read in `row-lists-sheet.ts`, each marked with a comment naming this plan and
    target state 19. A spec names exactly those three places, so a removal that misses one
    fails.
20. **Guests** (the owner's answer 5). A guest who may change the demand of a single entry
    row (plan 0130) is asked like anyone else. The words name buyers through the zone's
    members, which a guest is not served, so a guest's question names "Someone" for every
    buyer its client cannot resolve, by the rules of `0207` target state 6. The backend
    names a guest's own buy as the basket's owner (backend `0275`, `buyersOf`), so a guest
    who bought the extra reads the owner's name, or "Someone", never "You".

### Scope

- Work in `models`, `data-access` (lines, baskets, catalog add store, mappers, doubles),
  `ui` (the shared piece, `extraAskWords`'s input, `lists-table`'s anchors),
  `feature-lists`, `feature-catalog`, `feature-shopping-lists`, the i18n files and
  `apps/velista-luna-e2e`.
- Do NOT change `AnchoredPopover` (velista `0206`), the stepper or the reel, the words of
  `0207`, the due rows, the settle sheet's buy steppers, or any lowering.
- Do NOT add a question to a control the rulings do not name.

### Constraints

- Angular conventions of CLAUDE.md: standalone, `OnPush`, signals, zoneless; no
  `@angular/core/rxjs-interop` in services.
- Rule D4 for every answer; rule T1 and the hygiene and contrast specs for the flash.
- No dashes as punctuation in copy or comments.

### Action boundaries

- Stop and ask before building a stage whose frames (section 1) are not approved.
- Stop and ask if backend `0276` is not built or its answers differ from its plan.
- Stop and ask if the demand's answer does not carry the entry's new `asked`, so "Lists
  and amounts" cannot show `Y` from the server.
- Stop and ask if `row-lists-sheet` cannot find the raised line's list among its lists
  after the navigation of target state 19 for a line the add raised.
- Stop and ask before the line sheet asks over a save that changed the name and the amount
  together, if the merge question (plan 0112) can open on the same save.
- Stop and ask if a host's scroll of target state 10 would move a sheet or a page that
  holds a focused text field.

### Progress evidence

Per stage: the specs of section 2 for the stage; `npx nx affected -t lint test`;
`npx nx build velista`; the e2e of section 4 for the stage, run against a luna slot with
backend `0276` (the suite gates the staging deploy, and PR checks do not run it); a walk at
390 by 844, Day in Spanish and Night in English, of each control the stage adds.

### Staging and PRs

**Recommended: four PRs against `dev`, one per stage.** Stage 1 is opened on top of backend
`0276`'s branch and merges right after it, so `dev` never holds the backend without the
client half. A stacked PR gets no checks in this repository, so stages 2 to 4 are each cut
from `dev` after their predecessor lands. They can follow in the same release or a later
one; each needs only backend `0276`, and until each lands its controls take the default
without asking.

## 1. Frames the mock must have

The board `OverBoughtEverywhere.dc.html` in `apps/velista/plans/mocks/compact-reel/`, Day in
Spanish and Night in English, draws frames 1 to 11 with the board `OverBought`'s popover.
Its frames 1 to 5, 7, 9 and 11 hold under the owner's rule as drawn (each raises a line
over 1 extra to 3 and asks "3, or just 2"). Before the stage that needs it is built:

1. **Frame 10** (stage 1) says "La línea cambió antes de tu respuesta. No se ha contado lo
   comprado de más." / "The line changed before your answer. The extra was not counted."
   The decided words are `list.extra.stale` (target state 9); the frame is redrawn with
   them, and with the notice closing on the next touch.
2. **Frame 8** (stage 1) says the question "is not asked again for the same extra" as if
   an answer were remembered. The caption is corrected: a later raise asks nothing
   because the extra is already inside the ask, whatever was answered.
3. **A new frame for "Lists and amounts" over this shopping list's own extra** (stage 4):
   the owner's example, the stepper at 5 while the write is out, then at 7 with the
   question "You already bought 2 extra. Do you still need 7, or just 5?", then 5 after
   "Count the extra" and 7 after "Still need" or no answer. Frame 6 draws only another
   shopping list's extra, where the ask does not jump.
4. **A new frame for the "enough" variant** on a line control (`Z` = 0, backend `0276`
   case 8): "Marta already bought 3 extra. Do you still need 2, or is that enough?", with
   "That's enough".
5. **A new frame for the notice `list.extra.countFailed`**, in the place of frame 10.

## 2. Specs

Stage 1:

1. A row's positive run sends `reportExtra: true`; a negative one, the teardown write and a
   due row do not; a replay carries it when the dropped write did.
2. `toAbsorbedExtra` maps a well formed `extra` and maps a malformed one (a `countable`
   above `above`, a negative number, a bad buyer) to null with no question.
3. An answer with `countable: 0` opens nothing, also when `above` is above 0;
   `countable > 0` opens the popover with the words for `Y` (the answered quantity) and
   `Z = Y - countable`, and with `askEnough` when `Z` is 0; every case of `0207`'s spec 6
   and 17 still character for character.
4. "Still need" sends nothing and leaves `Y`.
5. "Count the extra" and "That's enough" send `countExtra(lineId, countable, Y)` and show
   `Z` at once; `stale_quantity` shows the server's amount and the notice
   `list.extra.stale` on the control, which closes on the next touch; a failure puts `Y`
   back and shows `list.extra.countFailed`.
6. Escape, a press outside, leaving, a press on the control and a replacing question send
   nothing and leave `Y`.
7. Focus is on "Still need" when the popover opens, and stays in a focused text field.
8. The control shows the store's quantity while the popover is open (no second number),
   and that quantity is the one the person stepped to.
9. `countExtra` is never a dropped write record, and nothing named `_stillNeeded` or
   `stillNeedExtra` is left in the scope.

Stage 2:

10. `ExtraAskHost` drops a question whose origin is disconnected or not in front; it
    scrolls an origin that is wholly or partly out of sight into view, then asks; it asks
    at once on an origin in sight; the scroll is instant under reduced motion; the comment
    naming the owner's alternative is at the scroll.
11. The line sheet reports only for a raised amount and asks only while open and in front;
    a sheet closed before the answer asks nothing and the line holds the amount saved.
12. The line page, a catalog card's stepper and add, and the product page's table rows
    report and ask on their own control; a card the results no longer draw asks nothing;
    the take back never reports.
13. A spec replaces `only-the-zone-list-counts-extra.spec.ts`: `countExtra` is called only
    through an `ExtraAskHost`'s `count`, and each control of target states 11 to 14 passes
    `reportExtra`.

Stage 3:

14. An add through the field that answers `raised` with `countable > 0` scrolls to the
    drawn row and asks on its control without moving focus from the field; a row the
    search hides asks nothing; `alreadyOnList` and `created` ask nothing.
15. A composer card's positive run reports and asks on the card.

Stage 4:

16. "Lists and amounts" reports a rising ask; it draws the run's amount until the answer,
    then the answered `asked` in the same change as the popover opens; it asks with `Y`
    the answered `asked` and `Z = Y - countable`, for another shopping list's extra (3 and
    2) and for this one's own (7 and 5); the count sends the basket route with `expect` the
    answered `left` and shows `Z`.
17. The basket's catalog card draws and asks as spec 16, on its stepper.
18. The basket's add that raises a line puts one pending question, navigates to
    `rows/:rowKey/lists`, and the sheet asks on that list's stepper; a sheet that does not
    draw the line asks nothing; the handoff's three places are the ones the spec names.
19. A guest on a single entry row is asked, with "Someone" for a buyer it cannot resolve.

## 3. The controls, in one table

| Control | File | Sends today | After this plan | `Y` / `Z` |
| --- | --- | --- | --- | --- |
| Zone list row stepper and reel | `feature-lists/.../list-page/list-page.ts:2039`, `:2291` | `POST lines/:id/quantity` with `countExtra` | `reportExtra`; the count on the answer (stage 1) | the line |
| Line sheet amount | `feature-lists/.../line-detail-sheet/line-detail-sheet.ts:881` | `PATCH lines/:id` with `quantity` | `reportExtra` on a raise (stage 2) | the line |
| Line page stepper | `feature-lists/.../line-page/line-page.ts:403` | `POST lines/:id/quantity` | `reportExtra` (stage 2) | the line |
| Catalog card stepper and add | `data-access/.../catalog/catalog-add-store.ts:785`, `:633`; `feature-catalog/.../catalog-page/catalog-page.ts:1093`, `:1115` | `POST lines/:id/quantity`; `POST lists/:id/lines` | `reportExtra` (stage 2) | the line |
| Product page table | `feature-catalog/.../product-page/product-page.ts:538`, `:556`; `ui/.../catalog/lists-table.ts:228`, `:231` | as the catalog | `reportExtra` (stage 2) | the line |
| Zone list "Add or find" and its cards | `list-page.ts:2387`, `:2646`, `:1380` | `POST lists/:id/lines`; `POST lines/:id/quantity` | `reportExtra`, scroll, ask (stage 3) | the line |
| Basket "Lists and amounts" | `feature-shopping-lists/.../row-lists-sheet/row-lists-sheet.ts:460` | `POST baskets/:id/rows/:rowKey/demand` | `reportExtra`, the basket count (stage 4) | the list's ask |
| Basket catalog cards | `feature-shopping-lists/.../basket-page/basket-page.ts:2598` | the demand route | `reportExtra` (stage 4) | the list's ask |
| Basket "Add or find" | `basket-page.ts:2775` | `POST baskets/:id/lines` | `reportExtra`, the handoff to "Lists and amounts" (stage 4) | the list's ask |
| Due rows | `list-page.ts:3521` | `POST lines/:id/quantity` | unchanged, never asks | |

## 4. e2e in `apps/velista-luna-e2e`

- Stage 1: rewrite `src/over-bought.spec.ts` for the owner's rule: the question opens with
  the line at the amount set; a reload before answering shows the amount set; "Count the
  extra" then a reload shows the smaller amount; "Still need" keeps the amount; after
  either answer, or after leaving the page with no answer, a second raise asks nothing,
  also after a reload and by another member in a second browser context; a further buy
  above the ask by Marta brings the question back; a count after another member lowered
  the line shows `list.extra.stale` and the current amount; Marta taking back the extra
  after the raise raises the line by what she took back (backend `0276`, case 14).
- Stage 2: a new `src/over-bought-controls.spec.ts`: the line sheet's Save asks on its
  stepper, and a sheet closed before a delayed answer (`page.route` holding the `PATCH`)
  asks nothing and keeps the amount; the line page; a catalog card scrolled out of sight
  before a delayed answer is scrolled back and asks; the product page's table.
- Stage 3: in the same file, an add through the zone list's field over a line at 0 with
  extra: the line returns, is scrolled to, asks, and "Count the extra" lowers it.
- Stage 4: in the same file, "Lists and amounts" with another member's shopping list
  holding the extra asks "3, or just 2" and counts; this shopping list's own extra shows
  the larger ask with the question (7, or just 5), and the count shows 5; the basket's
  field navigates to "Lists and amounts" and asks there.

## 5. Acceptance criteria

- Every control the owner named asks, on itself, when the answer comes while it still
  exists and is in front, scrolling it into view if it is out of sight; otherwise nothing
  is shown and the default stands.
- `Y` is always what the control shows after "Still need" and `Z` what it shows after
  "Count the extra", on every control.
- Nobody's answer, a closed popover, a left page and a late answer all leave the default,
  and send nothing.
- Only "Count the extra" writes. No later raise asks about extra that an earlier raise
  already took in; new extra asks.
- The basket asks about its own extra too, and shows the server's ask with the question.
- The basket's handoff to the sheet is one removable piece.

## Not in this plan

- The absorption, the report and the count (backend `0276`).
- The pointer (velista `0206`) and the popover's look (the board `OverBought`).
- A question on the due rows, on a lowering, or on the settle sheet's buys.
- An exception for the same shopping list (the owner: later, if users complain).
