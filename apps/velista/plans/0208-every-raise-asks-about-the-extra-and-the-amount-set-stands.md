# 0208: every raise asks about the extra, and the amount set stands

> Decided on 2026-11-23. It amends velista `0207`, which is built (PR #1089) and merged
> into `dev`, and which no release carries. Its partner is backend `0276`.
>
> A list's line can have units that a shopper already bought above what the list asked
> for in an open shopping list (the list asked 3, Marta bought 4: 1 extra; backend `0274`).
> When a person raises that line, velista asks whether the extra counts: "Marta already
> bought 1 extra. Do you still need 3, or just 2?", with "Still need" and "Count the extra".
> The owner's corrected rulings of 2026-11-23:
>
> 1. **The default is the amount the person set.** "If the user sets 4, it will be 4 unless
>    he answers that he is ok with it going down to 1." A raise is written in full. Not
>    answering, closing the question, leaving, or an answer that arrives too late all leave
>    the amount set. Only "Count the extra" lowers the line, by the extra it counts, and
>    records those units as meeting the ask (backend `0276`, the count write).
> 2. **The question appears wherever a list line's amount is raised**, anchored to the
>    control that raised it, when the save's answer arrives while that control is still on
>    screen; otherwise the default stands. The controls: the zone list's rows (stepper and
>    reel); the zone list's line sheet and the line page; the catalog tab's cards; the
>    product page's table of lists; the basket's "Lists and amounts" ("In the shopping list
>    line sheet, updating the requested amount will show the same popover"); the "Add or
>    find" field of the zone list (scroll to the line, then ask) and of the basket ("for
>    now, navigate to the sheet and show the popover, but that is likely to change and be
>    removed").
> 3. **Everything else ruled for the question stays** (velista `0207`, its opening
>    blockquote and target states 4 to 6, 11 to 14): the words and their variants (never
>    printing 0; units on the answer rows only for a count; the buyers' wording including
>    "X, Y and others" and "Someone"; a buyer named only when a member of the list's group);
>    the pointer that never covers what it points at (velista `0206`); it opens only after
>    the control's quiet beat **and** the save's answer; the page in front (no sheet over
>    it), or else the default; focus is never taken from a text field; the scroll to the row
>    and the flash on the zone list; a reel asks only after its tape closed; a lowering never
>    asks; after an answer the line does not ask again while the person stays there unless
>    extra units remain that nobody counted.
>
> **What the flip changes, stated plainly:**
>
> - **Focus starts on "Still need".** The owner put focus on the answer that changes
>   nothing (2026-11-22). With the default flipped, that answer is "Still need": it sends
>   nothing. "Count the extra" now writes. So the rule is kept and its result flips;
>   `0207`'s line "Focus never starts on Still need" is replaced.
> - **The control shows the amount set, which is also what the line holds.** `0207` drew
>   `Y` on the control while the store held `Z`, so the number changed under the finger
>   when the question closed. Now the line holds `Y` until "Count the extra". That problem
>   is gone, and so is the code that drew a number the store did not hold.
> - **A row the extra covers no longer needs holding.** The line holds `Y > 0` while the
>   question is open, so it is drawn as any line. After "Count the extra" to 0 it follows
>   velista `0192` (hidden as any line at 0).
> - **"Asking again" after "Still need".** The extra is still uncounted after "Still need",
>   so the server reports it on every later raise. The earlier ruling decides: the line
>   does not ask again while the person stays in the same place (target state 6). After
>   "Count the extra", a later raise asks again only if units remain above the ask.
>
> **Dependencies and release rule.** It needs backend `0276` (the report, `reportExtra`, the
> two count routes, the removal of `countExtra`), velista `0206` (the pointer) and everything
> velista `0207` needs. **Release it together with backend `0276`.** Both replace behaviour
> that is in `dev` only: PRs #1087 and #1089 are on no tag and not on `main` (the newest
> velista tag is `velista-v0.19.0`). Stage 1 is the client half of `0276`'s removal of
> `countExtra`, so **stage 1 merges right after backend `0276`**; between the two merges the
> zone list's raise answers 400 on `dev`.
>
> **The mock comes first** (the owner's rule). The board `OverBought.dc.html` in
> `apps/velista/plans/mocks/compact-reel/` stays as the record of the popover's look. The
> new frames are listed in section 1. No stage is built before its frames are approved.
>
> Code anchors, on `dev` at `6fa4f4b9c`, are in each control's row of section 3.

## Questions for the owner (open)

1. **What extra the basket's "Lists and amounts" asks about.** Backend `0276`, question 1,
   has both readings and their numbers. In short: (a) this shopping list's own units bought
   above the ask stay folded into a raised ask, as backend `0274` built it, and the question
   asks only about units that **other** open shopping lists bought; (b) this shopping list's
   own extra waits for the answer too, but "Count the extra" then leaves the ask where the
   person set it (the ask counts the shopping list's own buys), so the words "or just 4?"
   would not be true and need wording the owner has not ruled. **Recommendation: (a).**
   Stage 4 is written for (a). It also applies to the basket's "Add or find" field and to
   the basket's catalog cards: under (a) no basket control asks about the shopping list's
   own extra.
2. **A count whose line moved meanwhile** (backend `0276`, question 2). (a) The count is
   refused and the amount stands, with the words of target state 9; (b) it counts anyway,
   capped by what the line holds. **Recommendation: (a)**, because a lowering by somebody
   else can itself have been a count by hand.
3. **What "still on screen" means for a control that does not scroll the page** (the line
   sheet, the line page, a catalog card, the product page's table, "Lists and amounts").
   (a) Any part of the control is inside the visible area of its page or sheet: it asks,
   and the popover keeps the control in sight (`keepInSight`); wholly outside: the
   default. (b) Like the zone list: the page scrolls the control back into view and asks.
   **Recommendation: (a).** The owner ruled a scroll for the zone list alone ("the page
   scrolls to the line if it can"), and on the catalog a scroll would move the results the
   person is reading. The plan is written for (a).

## Brief for the agent

Load the "Angular conventions" of CLAUDE.md and the `design-taste-frontend` skill.

### Objective

Flip the question of velista `0207` to the default the owner ruled (the amount set stands,
only "Count the extra" writes), move it into one shared piece, and use that piece on every
control that raises a list line: the zone list's rows, the line sheet, the line page, the
catalog cards, the product page's table, the zone list's "Add or find" field, the basket's
"Lists and amounts", the basket's catalog cards and the basket's "Add or find" field.

### Context

- Backend `0276`: five writes take `reportExtra: true` and, when they raised the line,
  answer `extra: { above, countable, buyers }` with nothing counted. `countable` is what
  "Count the extra" would take off. Two writes count: `POST /v1/lines/:id/extra` and
  `POST /v1/baskets/:id/rows/:rowKey/extra`, body `{ unit, amount, expect }` (the basket's
  adds `lineId`), refused with `stale_quantity` when the line no longer holds `expect`, and
  answering `counted` (0 when the extra is gone).
- In a basket, under question 1 reading (a), the report leaves the shopping list's own buys
  out; on every list control it counts every open shopping list, the reader's own included.
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

#### Stage 1: the flipped default on the zone list's rows

1. **The data layer.**
   - `CountedExtra` becomes `ExtraAboveAsk` (`above`, `countable`, `buyers`) in
     `libs/velista/models`; `AddLineQuantityRequest.countExtra` and
     `DroppedWriteReplay.countExtra` become `reportExtra`.
   - `LineService`, `LineApi`, `LineMemory`, `LineStore` and the store double:
     `raiseCountingExtra` becomes `raiseReportingExtra(lineId, delta, options)` (sends
     `reportExtra: true`, answers the line and `extra`, null when absent or malformed). The
     mapper `toExtraAboveAsk` replaces `toCountedExtra` (rule D4): `above` and `countable`
     non negative whole numbers, `countable <= above`, buyers `{ userId: string | null }`;
     anything else maps to null and asks nothing.
   - New `countExtra(lineId, amount, expect)` on the same four: `POST lines/:id/extra`,
     answers the line and `counted`. The store patches `quantity` to `expect - amount` at
     once (the overlay on `quantity`, as `addQuantity`), takes the answered line on
     success, and puts the line back on a refusal or a failure. A count is never a dropped
     write record (velista `0159`): replayed later, it would lower a line on numbers the
     person no longer sees.
2. **The raise.** `_writeRun` sends `reportExtra: true` where it sent `countExtra: true`
   (a row's run, a positive delta, the line not in the memory of target state 6), and never
   at teardown (nobody is left to ask). The replay of a dropped write carries `reportExtra`
   when the dropped write did. The due rows still never report and never ask.
3. **When it asks.** As `0207` target state 3, with `extra.countable > 0` in place of
   `counted > 0`. `Y` is the answered line's `quantity` (what the line holds and what the
   control shows); `Z = Y - extra.countable`; `X = extra.above`. The words are
   `extraAskWords` with `asked = Y` and `left = Z` (its input changes from `{ extra, left }`
   to `{ extra, shown }`, nothing else in it).
4. **The answers.**
   - **"Still need"**: sends nothing. The popover closes, the line keeps `Y`, and the line
     joins the memory (target state 6).
   - **"Count the extra"** or **"That's enough"**: sends `countExtra(lineId,
     extra.countable, Y)`. The popover closes and the control shows `Z` at once. On
     `counted` below `countable` (the extra shrank meanwhile) the control shows the
     answered line, with nothing said. On a refusal `stale_quantity` the line keeps the
     server's amount and the page says `list.extra.stale`; on any other failure the line
     goes back to `Y` and the page says `list.extra.countFailed` (target state 9).
   - Escape, a press outside, the back gesture, leaving the page, a press on the row's own
     amount control, and another line's question replacing this one: nothing is sent, the
     line keeps `Y`. A press on the control then steps from `Y`.
5. **Focus** moves to "Still need" when the popover opens, unless a text field holds focus
   (then focus stays where it is). It never starts on "Count the extra" or "That's enough".
6. **The memory.** `_stillNeeded` stays a set of line ids that lives as long as the zone
   list page component. A line in it sends no `reportExtra`, so it never asks again while
   the person stays. "Count the extra" does not put the line in it.
7. **What is removed.** The drawing of `Y` over a store holding `Z`; the hold of a row at
   `Z = 0` while the question is open (`_held` for the question; velista `0199`'s own hold
   stays); `stillNeedExtra`'s second raise.
8. **The rest of `0207`** stays: the scroll, the flash, the reel's tape wait, one question
   at a time, the words, the keys, the look, both views.
9. **New keys**, in `libs/velista/ui/assets/i18n/en.json` and `es.json` (**the owner reviews
   this wording after the build**):
   - `list.extra.stale`: "The amount changed in the meantime, so nothing was counted." /
     "La cantidad cambió mientras tanto, así que no se contó nada."
   - `list.extra.countFailed`: "Nothing was counted. Try again." / "No se contó nada.
     Inténtalo otra vez."
   They are said where the page says a dropped write today (the page's polite live region).
   Reused unchanged: every `list.extra.*` key `0207` built (`boughtBy`, `boughtByYou`,
   `boughtByTwo`, `boughtByYouAndOne`, `boughtByOneAndSomeone`, `boughtByYouAndSomeone`,
   `boughtByMany`, `boughtBySomeone`, `boughtByNamedAndOthers`, `ask`, `askEnough`,
   `stillNeed`, `count`, `enough`, `units_one`, `units_other`, `announce`).

#### Stage 2: one shared piece, and the sheet, the line page and the catalog

10. **The piece**, in `libs/velista/ui/src/lib/list/`, free of `data-access` (the host
    passes the count in):
    - `ExtraAskMemory` (`extra-ask-memory.ts`): the set of target state 6, one per place.
      A place provides it in its component `providers`: the zone list page (its line sheet,
      a routed child below its outlet, injects the page's), the line page, the catalog page,
      the product page, the basket page (its sheets inject the page's). `has(lineId)`,
      `remember(lineId)`.
    - `ExtraAskHost` (`extra-ask-host.ts`), provided per page or sheet that shows the
      question: `ask(request)` and the state the popover reads. `request` holds `lineId`,
      `zoneId`, `unit`, `extra`, `shown` (`Y`), `origin()` (the control), `keepInSight()`
      (the row, the card or the table row), `count()` (the host's call of `countExtra`,
      answering `counted`, `stale` or `failed`), and two answers of the host: `inFront()`
      (no sheet, dialog or other popover over it) and `atRest()` (a reel's tape is down).
    - **The "still on screen" rule** (question 3, reading (a)): `origin()` is connected,
      `inFront()` is true, and any part of the origin is inside the host's visible area. If
      `atRest()` is false the question waits for the rest, then checks again. If any check
      fails, the question is dropped and the default stands. The zone list keeps its own
      scroll (`0207` target state 11) and calls `ask` after it.
    - The rules of stage 1 (one question per host, a new one replaces, answers, focus,
      memory, words), and the flash of `0207` target state 12, move into it; the zone list
      page uses it in place of its own state.
    - `lib-extra-ask-popover` (`extra-ask-popover.ts`): `lib-anchored-popover` (frame
      `choice`, `pointer`, `align="end"`, side by the origin's place in the host's visible
      area, `accent` while flashing) around `lib-extra-ask`, reading the host. Each host
      puts one in its template.
11. **The line sheet**, `libs/velista/feature-lists/src/lib/line-detail-sheet/line-detail-sheet.ts`.
    Today Save (`_save` `:881`) sends `updateLine(id, { quantity, ... })`, a `PATCH` with
    the absolute amount from the stepper (`line-detail-sheet.html:110`,
    `onAmountChanged` `:749`); the sheet stays open after a save. Change: when the saved
    `quantity` is above the line's and the line is not in the memory, the save carries
    `reportExtra: true` (`LineStore.updateLine` gains the option and answers `extra`). On
    an answer with `countable > 0` while the sheet is open and in front, the sheet's host
    asks, anchored on the amount stepper, keeping the stepper's row in sight. After "Count
    the extra" the sheet's `amount` and `_shown` take the answered line. A save that merges
    (`confirmMerge`) and a unit change (`chooseUnit` `:819`) never report.
12. **The line page**, `libs/velista/feature-lists/src/lib/line-page/line-page.ts`. Today
    `quantityRuns` (`:403`) sends `addQuantity(lineId, run.to - run.from)` from the stepper
    (`step` `:427`, `line-page.html:128`). Change: a positive run of a line not in the
    memory sends `raiseReportingExtra`; the page's host asks on the stepper.
13. **The catalog cards**, `libs/velista/data-access/src/lib/catalog/catalog-add-store.ts`
    and `libs/velista/feature-catalog/src/lib/catalog-page/catalog-page.ts`. Today a card's
    stepper (`stepLine` `:1115`, store `step` `:481`) writes a quiet beat run through
    `_writeRun` (`:785`) with `addQuantity` (`:794`), and a card's add (`addProduct`
    `:1093`, store `add` `:443`, `_add` `:633`) sends `addLineResult` (`:649`), which can
    answer `RAISED`. Change: `step` and `add` take `reportExtra` and an `onExtra(report)`
    callback that the store calls when the answer carries `countable > 0`; the page passes
    `reportExtra` for a line not in its memory, and its host asks on the card's stepper (a
    raise) or the card's add control (an add that raised), keeping the card in sight. The
    take back (`:970`) never reports.
14. **The product page's table**, `libs/velista/feature-catalog/src/lib/product-page/product-page.ts`
    (`stepListLine` `:556`, `addToList` `:538`, `stepLine` `:514`, `addProduct` `:490`) and
    `libs/velista/ui/src/lib/catalog/lists-table.ts` (outputs `added` `:228`, `lineStepped`
    `:231`). The same store calls as the catalog. Change: as target state 13, anchored on
    the table row's stepper or add control for that list, keeping the table row in sight.
    `lists-table` exposes the element of each row's control for the anchor.

#### Stage 3: the zone list's "Add or find" field

15. Today `add` (`list-page.ts:2371`) and `_send` (`:2387`) send `addLine` (`:2409`, `POST
    /v1/lists/:id/lines`) for free text and for a catalog product; the answer `raised`
    (a line at zero or below met and raised, plan 0260 R2) is handled at `:2556` and marks
    the line; `chooseLine` (`:2646`) raises a chosen line with `intoLineId`. A card's
    stepper inside the composer (`changeHolding` `:1380`) steps through `_step` outside
    `_rowRuns`, so it sends a plain `addQuantity`.
16. Change: the field's adds carry `reportExtra: true` for a line not in the memory
    (`LineStore.addLine` gains the option and answers `extra`). On `raised` with
    `countable > 0`: when the raised line's row is drawn by the current search and filter,
    the page scrolls to it as `0207` target state 11 and asks on the row's amount control,
    with the flash; when it is not drawn, the default stands. The composer keeps its focus
    (`holdOnSend`): the question opens with no focus move. A composer card's stepper sends
    `raiseReportingExtra` for a positive run and asks on that card's stepper.

#### Stage 4: the basket

17. **"Lists and amounts"**, `libs/velista/feature-shopping-lists/src/lib/row-lists-sheet/row-lists-sheet.ts`
    (route `rows/:rowKey/lists`). Today the ask stepper (`row-lists-sheet.html:99`,
    `stepAsk` `:384`) runs `_demandRuns` (`:220`) and `_demand` (`:460`) sends
    `setDemand({ lineId, quantity: run.to, from })` (`:477`): the list's **whole** ask, with
    `from` the `left` seen. Change: a run whose ask rises, on a line not in the memory,
    carries `reportExtra: true` (`BasketStore.setDemand` gains it and answers `extra`). On
    `countable > 0` while the sheet is open and in front, its host asks on that list's ask
    stepper. Here `Y` is the list's ask the control shows (the entry's `asked` in the
    answer), `Z = Y - countable`, and the count is `BasketStore.countExtra(rowKey, lineId,
    countable, expect)` with `expect` the answered entry's `left`. Under reading (a) the
    shopping list's own extra never asks here.
18. **The basket's catalog cards**, `libs/velista/feature-shopping-lists/src/lib/basket-page/basket-page.ts`
    (`_holdingRuns` `:2574`, `changeHolding` `:2583`, `_sendHolding` `:2598`, which sends
    `setDemand` at `:2618`). Change: as target state 17, anchored on the card's stepper.
19. **The basket's "Add or find" field, the removable piece.** Today `askWhere` (`:2279`),
    `pickList` (`:2292`) and `_addTo` (`:2775`) send `addLine` (`POST /v1/baskets/:id/lines`);
    a raise is handled at `:2942` to `:2967` (the page marks the row). Change: the add carries
    `reportExtra: true`. On a raise with `countable > 0` while the basket page is in front,
    the page puts one pending question in `ExtraAskHandoff` and navigates to the row's
    "Lists and amounts" (`sheetSegments('rows', rowKey, 'lists')`, the row the page marks
    today). `row-lists-sheet` takes the pending question when it opens, and its host asks on
    the ask stepper of the raised line's list once the sheet has finished opening. A line
    the sheet does not draw, or a pending question older than the navigation, drops it:
    the default stands.
    **This piece is built to be removed** (the owner: "likely to change and be removed"):
    one file, `libs/velista/feature-shopping-lists/src/lib/basket-page/extra-ask-handoff.ts`
    (a service provided by the basket page: `put`, `take`), one call in `basket-page.ts`
    and one read in `row-lists-sheet.ts`, each marked with a comment naming this plan and
    target state 19. A spec names exactly those three places, so a removal that misses one
    fails.
20. **Guests.** A guest can change the demand of a single entry row (plan 0130). The words
    name buyers through the zone's members, which a guest is not served. A guest's
    question therefore names "Someone" for every buyer it cannot resolve, by the rules of
    `0207` target state 6. See Action boundaries.

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

- Stop and ask if the owner has not answered questions 1, 2 and 3: stage 4 depends on 1,
  stage 1 on 2, stages 2 to 4 on 3.
- Stop and ask before building a stage whose frames (section 1) are not approved.
- Stop and ask if backend `0276` is not built or its answers differ from its plan.
- Stop and ask whether a guest reader is shown the question at all (target state 20). The
  owner ruled who is named for a guest **buyer**, not for a guest **reader**.
- Stop and ask whether "Still need" on one place also silences the same line on another
  place in the same visit (the zone list page and the catalog page, for example). This plan
  keeps one memory per place, as "while the person stays on the page" reads.
- Stop and ask if `row-lists-sheet` cannot find the raised line's list among its lists
  after the navigation of target state 19 for a line the add raised.
- Stop and ask before the line sheet asks over a save that changed the name and the amount
  together, if the merge question (plan 0112) can open on the same save.

### Progress evidence

Per stage: the specs of section 2 for the stage; `npx nx affected -t lint test`;
`npx nx build velista`; the e2e of section 4 for the stage, run against a luna slot with
backend `0276` (the suite gates the staging deploy, and PR checks do not run it); a walk at
390 by 844, Day in Spanish and Night in English, of each control the stage adds.

### Staging and PRs

**Recommended: four PRs against `dev`, one per stage, each opened after the previous one
merges.** A stacked PR gets no checks in this repository, so each stage is cut from `dev`
after its predecessor lands. Stage 1 is opened on top of backend `0276`'s branch and merges
right after it. Stages 2 to 4 can follow in the same release or a later one; each needs only
backend `0276`, and stage 4 also needs the owner's answer to question 1.

## 1. Frames the mock must have

New artboards beside `OverBought.dc.html` in `apps/velista/plans/mocks/compact-reel/`, Day
in Spanish and Night in English, with the board's popover as drawn:

1. The line sheet: the question on the sheet's amount stepper after Save, the sheet's
   Save showing its saved state.
2. A catalog card: the question on the card's stepper, the card in sight, the results
   around it.
3. The product page's table of lists: the question on one list's row stepper.
4. The zone list after an add through "Add or find": the field still holding focus, the
   raised line scrolled into view and flashing, the question on its amount control.
5. The basket's "Lists and amounts": the question on one list's ask stepper, with the
   numbers of reading (a) (another shopping list's buyer named).
6. The two answers' results with the flipped default: "Still need" leaves the control at
   the amount set; "Count the extra" moves it to the smaller amount; and the row when
   nobody answers (the amount set).
7. Focus on "Still need" when the popover opens.

## 2. Specs

Stage 1:

1. A row's positive run sends `reportExtra: true`; a negative one, a line in the memory,
   the teardown write and a due row do not; a replay carries it when the dropped write did.
2. `toExtraAboveAsk` maps a well formed `extra` and maps a malformed one (a `countable`
   above `above`, a negative number, a bad buyer) to null with no question.
3. An answer with `countable: 0` opens nothing; `countable > 0` opens the popover with the
   words for `Y` (the answered quantity) and `Z = Y - countable`, every case of `0207`'s
   spec 6 and 17 still character for character.
4. "Still need" sends nothing and puts the line in the memory; a later raise sends no
   `reportExtra` and asks nothing.
5. "Count the extra" and "That's enough" send `countExtra(lineId, countable, Y)` and show
   `Z` at once; a `counted` below `countable` shows the answered line; `stale_quantity`
   keeps the server's amount and says `list.extra.stale`; a failure puts `Y` back and says
   `list.extra.countFailed`.
6. Escape, a press outside, leaving, a press on the control and a replacing question send
   nothing and leave `Y`.
7. Focus is on "Still need" when the popover opens, and stays in a focused text field.
8. The control shows the store's quantity while the popover is open (no second number).

Stage 2:

9. `ExtraAskHost` drops a question whose origin is disconnected, wholly outside the
   visible area or not in front, and keeps one whose origin is partly visible.
10. The line sheet reports only for a raised amount and asks only while open and in front;
    a sheet closed before the answer asks nothing and the line holds the amount saved.
11. The line page, a catalog card's stepper and add, and the product page's table rows
    report and ask on their own control; the take back never reports.
12. A spec replaces `only-the-zone-list-counts-extra.spec.ts`: `countExtra` is called only
    through an `ExtraAskHost`'s `count`, and each control of target states 11 to 14 passes
    `reportExtra`.

Stage 3:

13. An add through the field that answers `raised` with `countable > 0` scrolls to the
    drawn row and asks on its control without moving focus from the field; a row the
    search hides asks nothing; `alreadyOnList` and `created` ask nothing.
14. A composer card's positive run reports and asks on the card.

Stage 4:

15. "Lists and amounts" reports a rising ask and asks with `Y` the answered `asked`; the
    count sends the basket route with `expect` the answered `left`.
16. The basket's catalog card asks on its stepper.
17. The basket's add that raises a line puts one pending question, navigates to
    `rows/:rowKey/lists`, and the sheet asks on that list's stepper; a sheet that does not
    draw the line asks nothing; the handoff's three places are the ones the spec names.

## 3. The controls, in one table

| Control | File | Sends today | After this plan |
| --- | --- | --- | --- |
| Zone list row stepper and reel | `feature-lists/.../list-page/list-page.ts:2039`, `:2291` | `POST lines/:id/quantity` with `countExtra` | `reportExtra`; count on "Count the extra" (stage 1) |
| Line sheet amount | `feature-lists/.../line-detail-sheet/line-detail-sheet.ts:881` | `PATCH lines/:id` with `quantity` | `reportExtra` on a raise (stage 2) |
| Line page stepper | `feature-lists/.../line-page/line-page.ts:403` | `POST lines/:id/quantity` | `reportExtra` (stage 2) |
| Catalog card stepper and add | `data-access/.../catalog/catalog-add-store.ts:785`, `:633`; `feature-catalog/.../catalog-page/catalog-page.ts:1093`, `:1115` | `POST lines/:id/quantity`; `POST lists/:id/lines` | `reportExtra` (stage 2) |
| Product page table | `feature-catalog/.../product-page/product-page.ts:538`, `:556`; `ui/.../catalog/lists-table.ts:228`, `:231` | as the catalog | `reportExtra` (stage 2) |
| Zone list "Add or find" and its cards | `list-page.ts:2387`, `:2646`, `:1380` | `POST lists/:id/lines`; `POST lines/:id/quantity` | `reportExtra`, scroll, ask (stage 3) |
| Basket "Lists and amounts" | `feature-shopping-lists/.../row-lists-sheet/row-lists-sheet.ts:460` | `POST baskets/:id/rows/:rowKey/demand` | `reportExtra`, basket count (stage 4) |
| Basket catalog cards | `feature-shopping-lists/.../basket-page/basket-page.ts:2598` | the demand route | `reportExtra` (stage 4) |
| Basket "Add or find" | `basket-page.ts:2775` | `POST baskets/:id/lines` | `reportExtra`, the handoff to "Lists and amounts" (stage 4) |
| Due rows | `list-page.ts:3521` | `POST lines/:id/quantity` | unchanged, never asks |

## 4. e2e in `apps/velista-luna-e2e`

- Stage 1: rewrite `src/over-bought.spec.ts` for the flipped default: the question opens
  with the line at the amount set; a reload before answering shows the amount set; "Count
  the extra" then a reload shows the smaller amount; "Still need" sends nothing and a second
  raise asks nothing; leaving the page before the answer leaves the amount set.
- Stage 2: a new `src/over-bought-controls.spec.ts`: the line sheet's Save asks on its
  stepper, and a sheet closed before a delayed answer (`page.route` holding the `PATCH`)
  asks nothing and keeps the amount; the line page; a catalog card; the product page's
  table.
- Stage 3: in the same file, an add through the zone list's field over a line at 0 with
  extra: the line returns, is scrolled to, asks, and "Count the extra" lowers it.
- Stage 4: in the same file, "Lists and amounts" with another member's shopping list
  holding the extra asks and counts; the shopping list's own extra asks nothing (reading
  (a)); the basket's field navigates to "Lists and amounts" and asks there.

## 5. Acceptance criteria

- Every control the owner named asks, on itself, when the answer comes while it is on
  screen and in front; otherwise nothing is shown and the amount set stands.
- Nobody's answer, a closed popover, a left page and a late answer all leave the amount set.
- Only "Count the extra" lowers the line, and the line does not ask again in that place
  after "Still need".
- The basket's handoff to the sheet is one removable piece.

## Not in this plan

- The report and the count (backend `0276`).
- The pointer (velista `0206`) and the popover's look (the board `OverBought`).
- A question on the due rows, on a lowering, or on the settle sheet's buys.
