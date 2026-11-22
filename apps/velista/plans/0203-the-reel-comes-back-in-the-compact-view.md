# 0203: the reel comes back in the compact view

> Decided on 2026-11-22. The reel (velista `0043`), the narrow drag control that velista
> `0188` replaced with the button stepper and velista `0190` deleted, comes back as the
> control of the compact view of velista `0202`. The owner chose the places that need the
> room most: the zone list rows (and the due rows on the same page, which follow the same
> design), the product page's table of lists, and the basket row sheet (velista `0204`).
> Measured on staging on 2026-11-22 at 375 px: the button stepper (155 px) leaves a zone list
> row about six letters of its name; the reel is 52 px.
>
> Little new work goes into it: it gets the step rule of today (the product's step of velista
> `0186`, 50 from 1000 and the stop at 1000 of velista `0195`, the ceiling of 99 999) and
> nothing else, apart from the size, the layout and the snap points of the amendment that
> follows. It has no hold, no acceleration and no trash: the owner ruled that a reel dragged
> to 0 hides the line with no warning.
>
> Amended on 2026-11-22 after the owner approved the mock: every reel is one size, 52 by 44
> px, whatever the amount, so all reels sit in one column; the number is on top and the unit
> under it, on the pill and on the open tape; the tape runs sideways over its own row, as the
> old reel did; the reel takes the snap points of velista `0195` as an input; and the due
> row's button in the compact view says only "Add" / "Añadir".
>
> Amended again on 2026-11-22: the owner extended that ruling to the default view. The due
> row's button says "Add" / "Añadir" with no amount in both views, because the amount is on
> the control beside it (the stepper or the reel). Its accessible name keeps naming the
> amount and the product.
>
> **The mock is approved, and it shows the reel is viable**: `apps/velista/plans/mocks/compact-reel/`,
> published at https://claude.ai/artifact/U74Z1MyvcxEK6PN3CRn8N6. Take every look and word
> from its boards (section 1 lists them) and the notes in its `canvas.json`, the `ReelUnit`
> board and its note above all.
>
> Linked plans: velista `0202` (the view picker and the swap of the layouts). **Release
> `0202` and `0203` together.** Velista `0195` is built first, because the reel takes its
> `snaps` input and steps through `stepFrom`. Velista `0204` builds on this plan.
>
> Code anchors:
> - The reel as it was deleted, at `d8daa824c^`:
>   `libs/velista/ui/src/lib/list/quantity-reel.{ts,html,scss,spec.ts}` and
>   `quantity-reel-gesture.{ts,spec.ts}`; its constants in
>   `libs/velista/models/src/lib/limits.ts:182` to `:229` (`QUANTITY_REEL_PX_PER_UNIT`,
>   `QUANTITY_REEL_IDLE_MS`, `QUANTITY_REEL_PAGE_STEP`, `QUANTITY_REEL_TAP_SLOP_PX`,
>   `QUANTITY_REEL_TAP_MAX_MS`, `QUANTITY_REEL_CLICK_SHIELD_MS`); its tokens
>   `--app-quantity-width` (52 px) and `--app-quantity-height` (40 px) in `_semantic.scss`.
>   Its template printed the unit beside the number, as one string: `{{ words() }}` in the
>   pill, the current number of the overlay, and `wordsFor(...)` in each neighbour.
> - The row as it drew the reel, at `4005ad496^`: `libs/velista/ui/src/lib/list/line-row.html:267`
>   to `:279` (`committed`, `autoClosed`) and `line-row.ts:101` to `:115`, `:258` to `:330`
>   (the row is deaf while the reel is open and for the click shield after it closes).
> - On `dev` at `e06813139`: `libs/velista/models/src/lib/line-unit.ts:211` to `:261`
>   (`stepAt`, `stepFrom`, `canStepUp`); `libs/velista/ui/src/lib/list/line-row.html:403` to
>   `:414` (the stepper); `libs/velista/ui/src/lib/list/due-line-row.ts:56` to `:63` (the
>   stepper) and `:65` to `:74` (the Add button, which says the amount today: "Add 3",
>   `list.due.add` with `amountWords()`, in both views);
>   `libs/velista/ui/src/lib/catalog/lists-table.ts:88` to `:130` and `:225` to `:245`
>   (`stepMain`, which emits `added` for a list with no line);
>   `libs/velista/feature-lists/src/lib/list-page/list-page.ts:1823` (`quantityRuns`) and
>   `changeQuantity`.

## Brief for the agent

### Objective

Restore the reel component from git, make it step by today's rule, and draw it in place of
the button stepper in the compact view on the zone list rows, the due rows and the product
page's table of lists.

### Context

- The reel follows the finger: 40 px per step, a tap on a neighbour number goes to it, the
  overlay stays up `QUANTITY_REEL_IDLE_MS` after release and its close emits one change.
  Vertical moves scroll the list (`touch-action: pan-y`).
- Its own step rule (250 g from a kilo, velista `0182`) is gone from the models. Today the
  rule is `stepFrom(value, unit, direction, step)`.
- While it is open, its overlay (the tape) runs sideways over its own row, growing left from
  the reel, and covers the row's name and price; only its shadow reaches the rows above and
  below. So the row was made deaf to clicks until the click shield after it closed.
- The restored pill had a minimum width of 52 px and grew with its words, so "1,5 kg" drew a
  wider reel than "6" and the reels of a list did not line up.
- Pages save a stepper's presses through `quantityRuns`; the reel's idle close already is a
  quiet beat, so a reel's change is written at once.

### Target state

1. **The component.** `QuantityReel` (`lib-quantity-reel`) is back in
   `libs/velista/ui/src/lib/list/`, with its gesture helper and specs, restored from
   `d8daa824c^` and kept as it was except:
   - every move of the tape is one `stepFrom` from the number before it, with inputs `step`
     (the product's step), `min` and `max` (99 999); the numbers of the tape are those
     steps, so it shows 975, 1000, 1050 for a kilo;
   - it takes an input `snaps: readonly number[]`, default `QUANTITY_SNAP_POINTS` (the
     1000 point only), and passes it to every `stepFrom` and `canStepUp` call through
     `snapPointsWithin` with its `min` and `max`, as the stepper does (velista `0195`), so a
     tape can land exactly on an amount the step grid would skip. No caller of this plan
     passes it; velista `0204` does;
   - its output is `stepped: QuantityStep` once, when the overlay closes, from the value it
     opened on to the value it closed on (nothing when equal); `committed` and
     `committedTo` go;
   - no hold, no trash, no `typed`.
   Its constants go back to `limits.ts` and its tokens to `_semantic.scss`.
2. **One size, the number over its unit.** The pill is a fixed box of 52 by 44 px on every
   row, whatever the amount: `--app-quantity-width` 52 px and `--app-quantity-height` 44 px
   (not the old 40). It fills the 44 px tap box the reel already had, so the compact row
   stays 68 px, and every reel of a list sits in one column. The number is on top, 15 px
   bold in the primary text colour, and the unit under it, 11 px in the secondary text
   colour. A count has no unit, and its number is centred in the same box. The widest
   values fit inside the pill: "99,95" over "kg", and the ceiling 99 999 as "100" over "K".
   Everything else is the old stylesheet: the subtle border, the 12 px radius, the zero
   style with no fill.
3. **The open tape** is stacked the same way: previous, current and next in a row, each
   number over its unit, 56 px tall, growing left from the reel over its own row. The current
   number is 19 px bold with an 11 px unit; each neighbour is 14 px with an 11 px unit (the
   app's floor). A count's numbers sit centred on one line. The current number is the quiet
   amber and the neighbours muted, as the old reel drew them. Take the remaining sizes and
   gaps from the `ReelUnit` board and its note.
4. **What changes in the restored files.** In `quantity-reel.html` the pill, the overlay's
   current number and each neighbour draw two elements, the number and the unit, in place
   of the one string of `words()` and `wordsFor()`; the component gives the number and the
   unit apart (from the same short form the words come from, so "1,5 kg" is "1,5" over
   "kg"). In `quantity-reel.scss` the pill becomes a fixed 52 by 44 column box with no
   minimum width that grows, and the tape's numbers become columns at the sizes above. The
   accessible value of the spinbutton keeps the whole words ("1,5 kg").
5. **The zone list rows.** In the compact view `LineRow` draws the reel where the two line row
   drew the stepper, with the row's deaf rule of `4005ad496^` back. The page writes a reel's
   step at once (`quantityRuns.step` then `flush`), so the run and the row's saving behave as
   for a press.
6. **The due rows.** In the compact view the due row draws the reel with `min` 1, the same
   52 by 44 as the rows above, in one column.
7. **The due row's button, in both views.** It says only "Add" / "Añadir", with no amount on
   it, in the compact view and in the default view: the amount is on the control beside it,
   the reel or the stepper. Today the button says the amount ("Add 3", `list.due.add` with
   `amountWords()`, `due-line-row.ts:73`). The visible words become a key with no amount,
   and `list.due.add` with its count goes if nothing else reads it. Its accessible name
   (`list.due.addLabel`, "Add 3 of <name> to the list", `due-line-row.ts:67` to `:69`) keeps
   naming the amount and the product, in both views, so a screen reader still hears what
   the press adds.
8. **The product page's table.** In the compact view each stepper of `lists-table` is a reel.
   A reel closed above 0 on a list with no line makes the line at the reel's amount: `added`
   carries the amount, and the product page's add writes it. A reel on a line steps it as a
   press does.
9. The default view is unchanged everywhere, apart from the words of the due row's button
   (target state 7).
10. Velista `0193`, `0194` and `0199` do not apply to the reel; it has no hold and no trash.

### Scope

- Work in `models` (constants), `ui` (the reel, the row, the due row, the table, the tokens),
  `feature-lists` (the page's write of a reel step), the catalog feature that hosts the
  product page (the add with an amount).
- Do NOT draw the reel in any sheet with typing, in the catalog search rows, or on the line
  page.
- Do NOT change the button stepper.

### Constraints

- Angular conventions of CLAUDE.md, zoneless, `OnPush`.
- Rule T1, the hygiene and contrast specs, at 390 by 844 and 360 by 800, Day and Night.
- No dashes as punctuation in copy or comments.

### Action boundaries

- Stop if velista `0195` is not built (the reel needs its `snaps` and `snapPointsWithin`).
- Stop and ask if the mock shows something on a row, the tape or the due row that this plan
  does not list.
- Stop and ask if the product page's add cannot take an amount without a backend change.

### Progress evidence

The specs of section 2; `npx nx affected -t lint test`; `npx nx build velista`; a walk on a
slot in the compact view with touch emulation: drag a count from 2 to 5 and a kilo from
950 g to 1100 g (through 975, 1000, 1050), tap a neighbour number, scroll the list by a drag
that starts on a reel, add a product from the product page by dragging a list's reel to 3;
see a "6" and a "1,5 kg" in reels of one size in one column, and a due row's "Add".

## 1. The mock's boards

The boards of `apps/velista/plans/mocks/compact-reel/` for this plan, at 390 by 844, Day in
Spanish and Night in English:

1. `Compact.dc.html`: a zone list in the compact view, ten rows, a 52 by 44 reel at rest on
   each.
2. `ReelOpen.dc.html`: the same list with one reel open mid drag, the tape sideways over its
   own row, and the step rule as the tape draws it (950 g, 975 g, 1 kg).
3. `Due.dc.html`: due rows in the compact view, the reel with a floor of 1 and the button
   "Add" / "Añadir".
4. `Product.dc.html`: the product page's table of lists in the compact view.
5. `Default.dc.html`: the default view of the same list, for comparison.
6. `ReelUnit.dc.html`: the reel, final: the pill with the number over its unit, the open
   tape, the worst cases ("12,5 kg", "99,95 kg", "100 K") and a whole list.

## 2. Specs

1. The restored reel specs pass, rewritten where they asserted the old step rule or the old
   outputs.
2. The tape of a kilo at 950 g reads 925, 950, 975, 1000, 1050; at 1025 g the number below
   is 1000.
3. One drag emits one `stepped` on close, from the opening value to the closing one.
4. A row in the compact view draws `lib-quantity-reel` and no `lib-quantity-stepper`; in the
   default view the reverse.
5. A click on the row while its reel is open, or within the click shield, does not open the
   line sheet.
6. On the product page, a reel closed at 3 on a list with no line emits `added` with 3.
7. The pill draws the number and the unit as two elements: "1,5" over "kg" for 1500 g,
   "99,95" over "kg" for 99 950 g, and "6" alone for a count of 6. The tape's current number
   and each neighbour do the same.
8. The reel's box is the same size for "6" and for "99,95 kg": the host reads
   `--app-quantity-width` and `--app-quantity-height`, and the tokens are 52 px and 44 px.
9. With no `snaps` input the reel stops at 1000; with `snaps` `[990, 1000]` a step up from
   975 g lands on 990.
10. The due row's button reads "Add" / "Añadir" with no amount in the compact view and in
    the default view, with an amount of 3 and of 1,5 kg.
11. In both views the due row's button keeps its accessible name with the amount and the
    product: "Add 3 of <name> to the list" (`list.due.addLabel`).

## 3. Acceptance criteria

- In the compact view the reel is the control on the zone list, the due rows and the product
  page's table, and steps by the rule of today.
- Every reel is 52 by 44 with the number over its unit, so the reels of a list line up.
- Nothing changes in the default view but the due row's button, which says "Add" in both
  views and names the amount only in its accessible name.

## Not in this plan

- The basket row sheet's reels (velista `0204`).
- The view picker (velista `0202`).
