> **PR:** [#978](https://github.com/IchirokuXVI/nx-portfolio/pull/978)

# 0188: an amount is stepped with two buttons

> Decided on 2026-11-10 and 2026-11-11. The owner finds the quantity reel "confusing for most
> users". A stepper with buttons replaces it on every screen: a minus, the amount written as a
> number over its unit, and a plus, in one outlined capsule (the look the owner approved as
> "D3 Outline" on 2026-11-11, `apps/velista/plans/mocks/stepper/index.html`). The step is the
> unit's step, 25 g, 25 ml or 1, never less than one hundredth of the name the row shows, so a
> press always changes what the row reads: in practice a count steps by 1 below 1000 and by 10
> from 1000. Holding a button repeats, from slower to faster, and never reaches 0.
> The amount can be typed only in the two line sheets. The component emits every step and
> saves nothing; the logic layer of each feature waits for the presses to stop before it
> writes.
>
> Replaces the reel of velista `0043` section 4, `0054`, `0073` section 5 and `0079` section 8.
> Amends velista `0182` section 3 and target 5 (the steps: the 50 ml step and the 250 step
> are gone), velista `0186` (its default steps, amended on 2026-11-11) and velista `0187`
> (amended on 2026-11-11 to draw this stepper). Needs PRs #959, #960 and #961 merged into
> `dev`. Does not need backend `0262`: the component reads `LINE_QUANTITY_MAX` and follows it
> when that plan raises it to 999 999.
>
> Used by, without knowing its insides: velista `0187` (the product page's lists table),
> `0190` (the shopping list's read only cell uses the short form formatter, its sheet uses the
> narrow typed control, and it deletes the reel's last files), `0191` (the compact row draws
> the row stepper) and `0192` (a line at zero). Velista `0185` removes the composer's stepper;
> until it does, the composer draws this one.
>
> Prerequisite reading: the owner's decisions of 2026-11-10 and 2026-11-11, as section 0 below
> restates them; velista `0182` section 3 (the step rule this plan replaces); velista
> `0134` sections 4.1 and 7 (the catalog's held lines and the lists table); velista `0170`
> target 4 (the amber edge of a raised number); velista `0089` section 2 (the due rows);
> velista `0159` (a dropped quantity write); the mock at
> `apps/velista/plans/mocks/stepper/index.html` (D3, the gallery, the accessibility table).
>
> Code anchors, on `origin/feat/velista-0183-line-unit-chip` as of 2026-11-11:
> `libs/velista/ui/src/lib/list/quantity-stepper.ts:38` to `:169` (today's stepper: `value`
> is a `model`, `controlled`, `accent`, `compact`, `stepped` emits a signed delta),
> `quantity-stepper.scss:1` to `:64` (the sunken pill and the orange `is-accent` tint);
> `libs/velista/ui/src/lib/list/quantity-reel.ts:33` (`TOOK_DURATION_MS`), `:117` to `:151`,
> `:227` (`committed`), `:256` (`committedTo`), `:743` to `:761` (`_flush`, the reel's own
> idle commit), `quantity-reel.html`, `quantity-reel.scss:115` (the took edge),
> `quantity-reel-gesture.ts`; `libs/velista/ui/src/index.ts:86` and `:87`;
> `libs/velista/models/src/lib/limits.ts:118` and `:119` (`LINE_QUANTITY_MIN`,
> `LINE_QUANTITY_MAX = 100000`), `:163` (`QUANTITY_REEL_PX_PER_UNIT`), `:174`
> (`QUANTITY_REEL_IDLE_MS`), `:177` (`QUANTITY_REEL_PAGE_STEP`), `:188`, `:197`, `:210` (the
> tap slop, the tap time, the click shield); `libs/velista/models/src/lib/due-lines.ts:68`
> (`DUE_LINE_STEP_QUIET_MS = QUANTITY_REEL_IDLE_MS`); `libs/velista/models/src/lib/line-unit.ts:105`
> (`defaultQuantity`), `:121` (`QUANTITY_COARSE_FROM`), `:124` and `:131` (the two step
> tables), `:142` (`stepAt`), `:162` (`stepFrom`, which snaps to a grid), `:179` (`stepsFrom`);
> `libs/velista/platform/src/lib/quantity.ts:39` to `:70` (`formatAmount`, one string through
> `Intl` with up to three decimals); `libs/velista/ui/src/lib/list/line-row.html:267` to
> `:278` (the row's reel), `line-row.ts:191` (`quantityChanged`), `:254` to `:331` (the
> capture listeners and the deaf beat that exist only for the reel's overlay);
> `libs/velista/ui/src/lib/list/line-list.ts:90`, `:97`, `:160`;
> `libs/velista/feature-lists/src/lib/list-page/list-page.html:210`, `:304`, `:343`, `:357`;
> `list-page.ts:441` (`announcement`), `:1754` to `:1794` (`changeQuantity`), `:2277` to
> `:2282` (`changeHolding`), `:2429` (`addDueLine`);
> `libs/velista/feature-lists/src/lib/select-list-state.ts:320` (`quantity: line.quantity`)
> and `:345` (`adjustable`); `libs/velista/feature-lists/src/lib/line-page/line-page.html:128`
> to `:135`, `line-page.ts:397` to `:404` (a write per press);
> `libs/velista/feature-lists/src/lib/line-detail-sheet/line-detail-sheet.html:110` to `:117`
> (the asked for reel) and `:413` to `:418` (the how many stepper), `line-detail-sheet.ts:209`
> (`amount`), `:252` (`howMany`), `:258` (`howManyFloor`), `:722` and `:733` (preview and
> commit); `libs/velista/ui/src/lib/list/due-line-row.ts:56` to `:62`;
> `libs/velista/ui/src/lib/list/line-composer.html:128`;
> `libs/velista/ui/src/lib/catalog/lists-table.ts:14` to `:19` (`ListsTableStep`), `:77` to
> `:87`, `:101` to `:119`, `:148` to `:170`; `libs/velista/ui/src/lib/catalog/product-row.ts:144`
> to `:153` (`ProductRowStepper`), `:194` to `:197` (`ProductRowLineStep`), `:565` to `:576`,
> `:601` to `:618`, `:720`, `:723`; `libs/velista/ui/src/lib/catalog/visit-added.ts:80` to
> `:100` (`min: row.floor - 1`); `libs/velista/ui/src/lib/list/suggestion-list.ts:362` to
> `:383` (`stepHolding`, which calls `stepFrom`) and `:414` (`stepperLabel`);
> `libs/velista/feature-shopping-lists/src/lib/basket-page/basket-page.ts:2487` to `:2494`
> (`changeHolding`, an absolute `setDemand` with `from`);
> `libs/velista/data-access/src/lib/catalog/catalog-add-store.ts:333` to `:337` (`step`),
> `:507` to `:567` (`_step`: `stepFrom`, the take back, one write per press);
> `libs/velista/feature-catalog/src/lib/catalog-page/catalog-page.ts:1076`,
> `product-page/product-page.ts:445` and `:480`, `added-sheet/added-sheet.ts:126`;
> `libs/velista/data-access/src/lib/lines/line-store.ts:881` (`addQuantity`, optimistic, a
> delta); `libs/velista/feature-shopping-lists/src/lib/basket-row/basket-row.html:354`,
> `basket-row.ts:23`, `:608`, `:685` to `:690`, `row-entries/row-entries.html:47` and `:111`
> (the reel's uses that velista `0190` replaces); `libs/velista/ui/src/lib/styles/_semantic.scss:117`
> and `:118` (`--app-space-9` 40 px, `--app-space-10` 48 px), `:151` (`--app-touch-target`
> 44 px); `token-hygiene.spec.ts:59` (no raw pixels outside the token files);
> `apps/velista-luna-e2e/src/support/app.ts:102` to `:118` (`reel`, `nudge`),
> `apps/velista-luna-e2e/src/catalog.spec.ts:201` to `:243` and `:286` to `:302`.
>
> Read "Angular conventions" in `CLAUDE.md` before any code. Load `design-taste-frontend` and
> `antislop` (with `antislop-human` for the accessibility contract) before the template, the
> styles or the copy.

## Brief for the agent

### Objective

Rewrite `QuantityStepper` in `libs/velista/ui` as the D3 stepper of this plan (a row form and
two typed sheet forms), give velista one step size per unit and two formatters for the words
of an amount, put the stepper on every screen of the zone list, the line page, the list's line
sheet, the catalog tab and the product page, move the wait before a save into each feature's
logic, and take out every use of the reel except the two on the shopping list that velista
`0190` replaces.

### Context

- Two controls draw an amount today. The reel (`quantity-reel.ts`) is a drag control with an
  overlay, its own idle commit of 1600 ms and one signed delta per run (`:743` to `:761`).
  The old stepper (`quantity-stepper.ts`) is a sunken pill of two 44 px buttons whose
  `stepped` sends a delta per press, with an orange tint for a product on a list
  (`is-accent`, `quantity-stepper.scss:46` to `:58`).
- Where the reel is drawn: the zone list row (`line-row.html:267`), the list's line sheet
  (`line-detail-sheet.html:110`), the shopping list row (`basket-row.html:354`) and its
  sheet's entries (`row-entries.html:47`, `:111`). The last two are velista `0190`'s.
- Where the old stepper is drawn: the line page (`line-page.html:128`), the line sheet's how
  many step (`line-detail-sheet.html:413`), the due rows (`due-line-row.ts:56`), the composer
  (`line-composer.html:128`, removed by velista `0185`), the lists table (`lists-table.ts:77`,
  `:101`), and `ProductRow`'s two slots (`product-row.ts:565`, `:601`). `ProductRow` is drawn
  by the catalog tab, the product page's Similar products, the added sheet (`visit-added.ts`)
  and the typeahead of the list page and of the shopping list page (`suggestion-list`).
- The step lives in `line-unit.ts`: `stepAt` answers 25 or 50 below 1000 and 250 from it, and
  `stepFrom` snaps a value off the grid onto it (`:142` to `:174`). Callers outside the two
  controls: `catalog-add-store.ts:524`, `suggestion-list.ts:379`, `line-detail-sheet.ts:258`.
- Writes per press today: the line page (`line-page.ts:398`), every catalog surface through
  `CatalogAddStore.step` (`:333`), the list page's holdings (`list-page.ts:2277`) and the
  shopping list page's holdings (`basket-page.ts:2487`). With a hold that repeats ten times a
  second each would become ten requests a second.
- `token-hygiene.spec.ts` refuses a raw pixel length outside the token files, so every size of
  this plan is a component token in `_semantic.scss`.

### Target state

1. `QuantityStepper` (`lib-quantity-stepper`) is the D3 control of section 3 in three variants:
   `row` (155 by 48, the amount an output), `sheet` (191 by 48, typed) and `sheet-narrow`
   (168 by 48, typed). It never changes size, whatever amount it holds.
2. The step of section 1: 25 for `GRAM` and `MILLILITER` at every amount, 1 for `UNIT` below
   1000 and 10 from 1000. No grid and no snapping. Plus then minus always returns to the same
   amount; minus then plus returns except for a typed count of 1001 to 1009 and under one step
   from 0.
3. A hold repeats after 400 ms, from one step per 300 ms to one per 100 ms, and never takes an
   amount to 0.
4. The amount is written as a number over its unit symbol: the short form in a row, a card and
   a table, the exact form in the two sheets (section 2).
5. The component emits every step. The list page, the line page and the shopping list page
   wait `QUANTITY_STEP_QUIET_MS` after the last step of a line before they write one change;
   `CatalogAddStore` does the same for every catalog surface.
6. The reel is gone from every screen this plan names. Its files stay only while the shopping
   list row and its sheet use them, and velista `0190` deletes them (section 6).

### Scope

- Work in `libs/velista/models` (the step, the hold constants), `libs/velista/platform` (the
  formatters, the parser, `QuantityRuns`), `libs/velista/ui` (the stepper, the figure, the
  row, the lists, the catalog rows, the tokens, the assets), `libs/velista/data-access`
  (`CatalogAddStore`), `libs/velista/feature-lists` (the list page, the line page, the line
  sheet), `libs/velista/feature-catalog` (the step handlers), `libs/velista/feature-shopping-lists`
  (only `changeHolding` of the basket page), and `apps/velista-luna-e2e`.
- Do NOT touch the shopping list row, its line sheet or `row-entries` (velista `0190`), the
  search field, the progress bar or the reorder mode (velista `0189`), the compact row
  (velista `0191`), the amount a new line starts at (velista `0185`), the deletion of a line
  at zero (velista `0192`, backend `0263`), the product's own step (velista `0186`), or any
  backend project.

### Constraints

- Rule D5 and the conventions of `CLAUDE.md`: standalone, `OnPush`, signals, `input()` and
  `output()`, zoneless specs with Jest fake timers, `provideRokuTranslatorTesting()`.
- Every size is a token; every colour an existing semantic token (no new colour, so
  `contrast.spec.ts` needs no new pair). No raw `<svg>`: the two glyphs are drawn with CSS bars
  as the mock draws them, or with existing icon components if the builder prefers; no new icon
  file.
- Numbers through `Intl.NumberFormat`, never inside a translation key. Copy in `en` and `es`.
  No dashes as punctuation in copy or comments.
- The component holds no timer that saves and no store. It holds two timers of its own: the
  hold, and the quiet beat after which it announces the amount.
- A repeat never emits 0. A take back or a deletion is never the result of a repeat step.

### Action boundaries

- Proceed with sections 1 to 7 once PRs #959 to #961 are in `dev`.
- Removing `QUANTITY_REEL_PX_PER_UNIT`, `QUANTITY_REEL_PAGE_STEP` and the reel's other
  constants is decided by this plan (the owner replaced the reel on 2026-11-11). The stop that
  velista `0182` and `0186` put on changing `QUANTITY_REEL_PX_PER_UNIT` does not apply to its
  removal.
- Stop and ask before adding a dependency, before deleting a file that section 6 does not
  name, and before raising `MIN_CLIENT_VERSION` in any cluster.
- Stop and ask if velista `0190` is already merged when this plan is built: then the reel has
  no use left and section 6's deletions move into this plan.
- Stop and ask before any behaviour this plan does not settle, in particular before letting a
  repeat reach 0, before typing in a row, or before a save from inside the component.

### Progress evidence

Each criterion of section 8 with its spec output, `npx nx build velista`, the fit test of
section 7 in a browser, and one walk on a slot (velista browser check recipe) at 390 by 844:
a zone list row of loose bananas at 750 g pressed plus once (775 g, one request after the
quiet beat), held on minus for two seconds (the steps speed up, stop at 25 g, one request),
pressed minus once more (0); the line sheet typed "1,5" under "g" (reads 1,5 kg, saved by
Save); the catalog tab's held line and the product page's table stepping with one request per
run; a screen reader (TalkBack or VoiceOver) reading a row's group name, both button names and
the amount once after a run.

## 0. Decisions

### The owner's, 2026-11-10 and 2026-11-11, fixed

- **S1. The reel goes, on every screen.** "Confusing for most users." Buttons replace it.
- **S2. One look, D3 Outline, one size in rows:** minus, amount, plus in one outlined capsule,
  155 by 48 CSS px, each button 48 by 48, the amount cell 59 px. Raised surface, a 1 px
  outline in `--app-border-strong` (4.10 to 1 against the page). No tint, also for a product
  that is on a list: today's orange pill goes.
- **S3. A number over its unit symbol**, the symbol smaller and in the secondary colour. A
  symbol may have up to four letters ("uds."), and a test proves four always fit.
- **S4. The short form** in a row, a card, a table and the shopping list: at most three whole
  digits and two decimals, rounded half up for the display only. Below 1000 base units it
  reads in the base unit; from 1000 it moves up one name (K in Spanish and k in English for a
  count, kg, l). Six characters draw one step smaller. It never reads 1000 of the top name:
  999 995 to 999 999 read "999,99".
- **S5. The exact form** in the two line sheets only: up to three decimals ("1,275 kg"); a
  count is plain under 100 000 and reads in K from there.
- **S6. The most is 999 999 base units.** Raising `LINE_QUANTITY_MAX` is backend `0262`.
- **S7. One step per unit:** 25 g, 25 ml, 1. No larger step above 1000 for a weight or a
  volume. "Different steps on one line confuse; the hold accelerates; the exact amount can be
  typed in the sheet."
- **S7b. A press always changes what the row reads (the owner, 2026-11-11 03:00).** "If the
  line is at 1000, it will go to 1010 in the next step (1.01k) unless the step amount was
  already bigger than that. It is also a way to increase the amount faster at high amounts".
  So the step is the unit's step but never less than one hundredth of the name the row shows:
  a count steps by 1 below 1000 and by 10 from 1000; grams and millilitres stay at 25
  everywhere, because 25 is already more than the 10 that "1,25 kg" needs. Going down, minus
  takes away the step that plus uses at the amount one base step lower, so 1000 minus one
  press is 999 and plus then minus always returns. Minus then plus does not return for a
  typed count of 1001 to 1009 (1005 minus is 995, plus is 996) and under one step from 0.
- **S8. The ends:** minus is off at 0; a minus from under one step goes to 0; plus is off when
  one more step would pass the most, and never clamps to it. A count's plus is also off where
  a press would not change the short reading (999 985 to 999 989, which read "999,99" before
  and after).
- **S8b. A hold never takes an amount to 0 (the owner, 2026-11-11 03:00: "Perfect").** A repeat
  stops at the last amount above 0, and a separate press goes to 0, because at 0 a line with
  nothing to keep is deleted (backend `0263`), and a deletion must not come from a finger held
  a moment too long.
- **S9. Typing only in the two line sheets.** In a row, a card, the product page table and the
  line page the amount cannot be focused or typed into. "The buttons are needed in the line
  page, it's fine."
- **S10. In a sheet** the control is 191 by 48 (the list's line sheet, cell 95 px) or 168 by
  48 (the shopping list's line sheet, cell 72 px), measured for "999,999" at 17 px 700 with
  tabular figures. A text input with `inputmode="decimal"`, 16 px or more when focused,
  `role="spinbutton"` with its four ARIA values; Arrow Up and Down step, Home and End go to the
  ends; a focus selects the whole number. A number typed with a decimal into the base unit is
  read one name up ("1,5" into "500 ml" is 1,5 l). A typed amount is rounded to a whole base
  unit and held to 0 to 999 999.
- **S11. Holding repeats,** "from slower to faster as you hold it", up to ten steps a second. A
  single press steps once, on release.
- **S12. Saving is not the component's job.** "It will be done from outside the component, by
  the logic layer in a feature library."
- **S13. Accessibility is a must**, with the contract that section 3.6 states.
- **S14 (2026-11-12). Minus becomes a red trash where its next press reaches 0.** "When
  lowering from 1 to 0, the icon will be a trash, in red. That way the user knows the line will
  disappear. The trash will always appear going from 1 to 0, even if the line has buys and isn't
  actually deleted." Read as: on every `lib-quantity-stepper`, in all three variants, while the
  value is above 0 and `max(min, stepFrom(value, unit, -1)) === 0` (1 for a count, 25 g or
  anything under one step for a weight; never with `min` above 0, as on a due row or the how
  many step), minus draws `lib-trash-icon` at the glyph size in `--app-status-danger-fg` in
  place of its bar. At 0 minus is at its end with the plain bar. The accessible name stays the
  true step ("Remove 1 from Milk"), because nothing is deleted; the hold is unchanged, so a
  hold ends on the trash and a separate press goes to 0. The glyph swaps with no animation.
- **S15 (2026-11-12). Presses faster than the caller redraws each take their own step.** "Fix
  it." A press builds on the amount the last press emitted until the caller redraws; the
  caller's `value` wins as soon as it moves or any render runs (section 3.3).

### The numbers of the hold, proposed with the mock and open to the owner

- **The hold's numbers:** the repeat starts after 400 ms; the first interval is 300 ms, each
  next one 0.85 of the one before, never under 100 ms. Lifting the finger, sliding off the
  button, a pointer cancel or the page scrolling stops it. `prefers-reduced-motion` changes
  nothing about the repeat.

### The writer's, open to the owner

- **A. One component, rewritten in place.** `QuantityStepper` keeps its file, its class name and
  its selector, so every import stays valid and the composer keeps compiling until velista
  `0185` removes its use. Its inputs and outputs change (section 3.1); every caller is in this
  plan, except the composer, which binds `[(value)]` and keeps working.
- **B. No grid.** `stepFrom` adds or takes away the step of S7b with no snapping. A snap would
  break "plus then minus returns": a typed 1010 g would go up to 1025 and down to 1000. The
  owner's sentence is the rule, so the step is a plain sum.
- **C. A repeat that cannot go on stops; it does not clamp.** Plus stops before passing the
  most (S8). Minus stops at the last amount above 0, or at `min` when `min` is above 0 (a due
  row starts at one, the how many step at one step).
- **D. Both buttons stay focusable at an end.** An end is drawn with `aria-disabled="true"` and
  ignores presses, never with the `disabled` attribute, so a keyboard user who pressed minus
  down to 0 keeps focus on the button instead of losing it to the page, and both buttons stay
  in the tab order, as the owner decided on 2026-11-10.
- **E. The component announces the amount, once.** A polite live region inside the control is
  filled with "<name>, <amount in words>" `QUANTITY_STEP_QUIET_MS` after the last press of a
  button. The list page's own announcement after a quantity write (`list-page.ts:1772` to
  `:1792`) goes, so nothing is said twice. A step made with the arrow keys on the sheet's
  field is not announced by the region: the spinbutton's own value is.
- **F. The quiet beat is 800 ms.** Longer than the hold's slowest interval (300 ms) and its
  start (400 ms), so a hold and a run of taps stay one run; shorter than the reel's 1600 ms,
  so a write is not held back as long as the reel held it. One constant,
  `QUANTITY_STEP_QUIET_MS`, used by every feature's wait and by the component's announcement.
- **G. The catalog's wait lives in `CatalogAddStore`.** The catalog tab, the product page's two
  tables and the added sheet all step through `CatalogAddStore.step`, whose per product queue
  and visit record decide the take back press by press. A wait in each of the three pages
  would be three copies racing over one queue. The store is the catalog's logic layer even
  though it sits in `data-access`; the owner's "feature library" is honoured in role, not in
  folder. The list page, the line page and the shopping list page wait in the page, through
  one shared helper (section 4).
- **H. A page draws the amount of an open run, not the store's.** While a run is open the
  control shows the run's last amount; the store's line, its sections and its sort keep the
  stored amount until the run is written. A run to 0 therefore does not move a row out of its
  section under the finger.
- **I. A reader sees the amount alone.** The `readonly` input draws the figure in the
  control's box with no buttons and no outline, so the rows of a list a person may only read
  keep their alignment. Today the reel draws `aria-readonly`; the line page already draws
  text (`line-page.html:136` to `:144`) and keeps it.
- **J. The amber edge stays.** `took` draws a 2 px inset ring in `--app-action-bg` around the
  amount cell and the number in `--app-action-quiet-fg`, as the mock draws `.mk-took`.
  `TOOK_DURATION_MS` moves to `quantity-stepper.ts`.
- **K. Typing reads in the name on screen.** A typed number with no decimal is read in the name
  shown under the field when the typing started ("750" under "kg" is 750 kg). With a decimal
  typed under the base name it is read one name up (S10). The symbol under the field changes
  as the separator is typed, so the person sees the unit before they leave the field. Both
  "," and "." are read as the decimal separator, because the field draws no grouping.
- **L. A tests' attribute.** The host carries `data-value` with the amount in base units, so the
  e2e suites read a row's amount without a spinbutton, which a row no longer has.
- **M. The step follows the short form, also in a sheet.** S7b is stated for the row's reading.
  The sheet's exact form shows more digits, but one rule in one function is simpler than two,
  and the sheet's arrows and buttons then move exactly as the row's do. The step is read from
  the short form's name at the amount, never from the variant.

## 1. The step and the limits (`libs/velista/models`)

In `line-unit.ts`:

```ts
/** The base step of each unit (the owner, 2026-11-11): 25 g, 25 ml, one piece. */
export const QUANTITY_STEP: Readonly<Record<LineUnit, number>> = {
  UNIT: 1,
  GRAM: 25,
  MILLILITER: 25,
};

/**
 * How far plus moves an amount at `value` (S7b): the base step, but never less than
 * one hundredth of the name the short form shows there. A count: 1 below 1000, 10
 * from 1000. A weight or a volume: 25 everywhere.
 */
export function stepAt(value: number, unit: LineUnit): number;

/**
 * One press from `value`. Up: `value + stepAt(value)`. Down: `max(0, value -
 * stepAt(max(0, value - QUANTITY_STEP[unit])))`, the step plus uses one base step
 * lower, so 1000 minus is 999 and plus then minus returns. No grid (decision B).
 */
export function stepFrom(value: number, unit: LineUnit, direction: 1 | -1): number;

/** Whether a plus at `value` would change the short reading and stay within `max` (S8). */
export function canStepUp(value: number, unit: LineUnit, max: number): boolean;

/** One press or one repeat of a stepper, as the stepper drew it. */
export interface QuantityStep {
  readonly from: number;
  readonly to: number;
  /** True for a step the hold made, false for a press, a key or a typed amount. */
  readonly repeat: boolean;
}
```

- The hundredth rule lives in `stepAt` and reads `QUANTITY_COARSE_FROM` (1000): from there the
  short form names thousands, and its hundredth is 10 base units, so the step is
  `max(QUANTITY_STEP[unit], 10)`; below it the step is `QUANTITY_STEP[unit]`. Nothing else in
  the code knows the rule. `canStepUp` is false when `value + stepAt(value) > max`, and for a
  count also when the short form of the next amount reads the same as now (999 985 to
  999 989); it compares the integer hundredths of section 2, not strings.
- `QUANTITY_FINE_STEP` and `QUANTITY_COARSE_STEP` are removed; `stepAt` is rewritten as
  above. `stepsFrom` stays,
  rewritten over the new `stepFrom`, only for the reel's last two uses, and goes with the reel
  in velista `0190`.
- `QUANTITY_COARSE_FROM` stays as the amount where words move up one name (it is no longer a
  change of step); its comment says so.
- `defaultQuantity` is not changed here (velista `0185` owns the amount of an add).
- The callers of `stepFrom` change: `line-detail-sheet.ts:258` becomes `QUANTITY_STEP[this.unit()]`;
  `suggestion-list.ts:379` and `catalog-add-store.ts:524` stop calling it and take the
  stepper's `to` (section 5).

In `limits.ts`, beside `LINE_QUANTITY_MAX`:

```ts
/** How long a held button waits before it repeats (velista 0188). */
export const QUANTITY_HOLD_DELAY_MS = 400;
/** The first interval of the repeat, each next one this factor of the last, never under the fastest. */
export const QUANTITY_HOLD_FIRST_MS = 300;
export const QUANTITY_HOLD_FACTOR = 0.85;
export const QUANTITY_HOLD_FASTEST_MS = 100;
/** How long after the last step a feature writes the run, and the stepper announces it. */
export const QUANTITY_STEP_QUIET_MS = 800;
```

The intervals are 300, 255, 217, 184, 157, 133, 113, then 100 ms. The fastest interval starts
about 1.36 s after the first repeat, which is 1.76 s after the press. `DUE_LINE_STEP_QUIET_MS` (`due-lines.ts:68`) is
bound to `QUANTITY_STEP_QUIET_MS`.

## 2. The words of an amount (`libs/velista/platform`)

In `quantity.ts`, beside `formatAmount`, exported from `@portfolio/velista/platform`. This is
the surface other plans use without knowing the component.

```ts
/** An amount as a figure draws it: the number, and the symbol under it. */
export interface AmountWords {
  /** "750", "1,25", "999,99", "2". */
  readonly figure: string;
  /** "g", "kg", "ml", "l", "K" or "k", or "" for a count under a thousand. */
  readonly symbol: string;
  /** True when the figure has six characters, which draw one step smaller (S4). */
  readonly long: boolean;
  /** The exact amount for a screen reader: "750 gramos", "1,275 kilogramos", "12". */
  readonly spoken: string;
}

/** The short form (S4): rows, cards, tables, the shopping list's cell. */
export function shortAmount(quantity: number, unit: LineUnit, locale: string): AmountWords;

/** The exact form (S5): the two line sheets. */
export function exactAmount(quantity: number, unit: LineUnit, locale: string): AmountWords;

/**
 * What a person typed into a sheet's field, in base units, or null for text that is
 * not a number. Rounded half up to a whole base unit and held to [min, max].
 */
export function parseTypedAmount(
  text: string,
  shown: AmountWords,
  unit: LineUnit,
  min: number,
  max: number
): number | null;

/** The symbol a typed text will be read in, for the field's live symbol (decision K). */
export function typedSymbol(text: string, shown: AmountWords, unit: LineUnit, locale: string): string;
```

The rules, in integers so no floating point rounding can move a digit:

- **Short form.** Under 1000: the base unit, `figure` the integer, `symbol` "g", "ml" or "" for
  a count. From 1000: hundredths of the top name are `min(99_999, floor((quantity + 5) / 10))`,
  which is half up on the integer and never reads 1000 of the top name; the figure is that
  number over 100 formatted with `maximumFractionDigits: 2`, `useGrouping: false` (1250 g
  "1,25", 1275 g "1,28", 2000 g "2", 1500 g "1,5", 2010 pieces "2,01", 999 999 "999,99").
- **Exact form.** Under 1000: the base unit. From 1000 for a weight or a volume: the amount over
  1000 with `maximumFractionDigits: 3`, `useGrouping: false` ("1,275", "999,999"). A count
  stays plain under 100 000 ("99999") and reads in K from there with three decimals
  ("123,456").
- **Symbols** are a fixed table, the same in both languages: `g`, `kg`, `ml`, `l`; the thousand
  of a count is `K` in Spanish and `k` in English, chosen by the locale's language with `k` as
  the fallback. Not `Intl`'s unit names: `Intl` writes "L" for a litre in English, and the
  owner asked for "l".
- **Spoken** is `Intl.NumberFormat(locale, { style: 'unit', unit, unitDisplay: 'long' })` over
  the exact amount for a weight or a volume ("750 gramos", "1,275 kilogramos"), and the plain
  integer for a count.
- **Parsing.** Spaces are dropped. One separator at most, "," or "."; anything else is null.
  With no separator the number is read in the name of `shown`. With a separator under the
  base name it is read in the top name (S10, decision K). The result is rounded half up to a
  whole base unit and held to `[min, max]`.

`formatAmount` and `formatQuantity` keep their callers (captions, sentences, the dropped
write note) and are not changed.

## 3. The component (`libs/velista/ui`)

### 3.1 The public surface

```ts
export type QuantityStepperVariant = 'row' | 'sheet' | 'sheet-narrow';

@Component({ selector: 'lib-quantity-stepper', ... })
export class QuantityStepper {
  /** The amount drawn, in base units. The caller owns it; a press never changes it here. */
  readonly value = input.required<number>();
  readonly unit = input<LineUnit>('UNIT');
  /** What the amount is of, translated: "Plátano de Canarias IGP", or with its list. */
  readonly name = input.required<string>();
  readonly variant = input<QuantityStepperVariant>('row');
  readonly min = input(LINE_QUANTITY_MIN);
  readonly max = input(LINE_QUANTITY_MAX);
  /** A write is in flight: both buttons and the field ignore input, and say so. */
  readonly disabled = input(false);
  /** A reader: the amount alone, no buttons (decision I). */
  readonly readonly = input(false);
  /** An add just raised this amount (velista 0170, decision J). */
  readonly took = input(false);
  /** The next amount, on every press, every repeat, every key and every typed commit. */
  readonly valueChange = output<number>();
  /** The same change with where it came from and whether the hold made it. */
  readonly stepped = output<QuantityStep>();
}
export const TOOK_DURATION_MS = 2500;
```

`value` plus `valueChange` lets a local signal bind `[(value)]` (the line sheet, the due row,
the composer), and a page bind `[value]` and `(stepped)`. The component never sets its own
value: the caller draws what it decided. `controlled`, `accent`, `compact` and the `model`
are removed. Every step goes through `stepFrom` and `canStepUp` of section 1, so velista `0186`
adds a product's `step` input by passing it to those two functions.

The figure is its own component, for velista `0190`'s read only cell and for this control:

```ts
@Component({ selector: 'lib-amount-figure', ... })
export class AmountFigure {
  readonly quantity = input.required<number>();
  readonly unit = input<LineUnit>('UNIT');
  readonly form = input<'short' | 'exact'>('short');
  /** Whether it carries its own visually hidden spoken words. Off inside a control that names it. */
  readonly speak = input(true);
}
```

It draws `figure` over `symbol`, `aria-hidden`, and the spoken words in a `.visually-hidden`
span when `speak` is on. Both are exported from `libs/velista/ui/src/index.ts`.

### 3.2 The look (D3)

From the mock's `.mk-D3`, `.mk-D`, `.mk-btn`, `.mk-val` and `.mk-u` rules:

- A grid of three columns: the button, the cell, the button; height 48. The cell is 59 px in
  `row`, 95 in `sheet`, 72 in `sheet-narrow`. The host is `inline-grid`, `flex: none`, and
  never grows or shrinks.
- `border-radius: var(--app-radius-full)`, `background: var(--app-surface-raised)`, the
  outline as `box-shadow: inset 0 0 0 1px var(--app-border-strong)`.
- Buttons 48 by 48, round, transparent; on `:active` the sunken surface and a 0.96 scale,
  both off under `prefers-reduced-motion`. An end draws at 0.35 opacity. `user-select: none`,
  `-webkit-touch-callout: none`, `touch-action: manipulation`, and `contextmenu` prevented on
  the buttons, so a long press opens no menu. The focus ring is drawn inside the shape.
- Glyphs: two bars 14 by 2 with round caps, in `--app-text-primary`.
- The cell: a column, centred, 2 px between number and symbol, 4 px of side padding (6 in the
  sheets). Number 17 px 700 with tabular figures, 18 px for a count with no symbol, 14 px for
  a six character short form. Symbol 12 px, 400, `--app-text-secondary`. An amount of 0 draws
  its number in `--app-text-secondary` and its minus at an end, so 0 is never told by colour
  alone.
- The sheets' field: the number is an `<input>` laid over a hidden copy of its text, so the
  field takes the width of what it holds, 17 px when focused (never under 16), its focus ring
  around the whole cell.
- New component tokens in `_semantic.scss`: `--app-stepper-button` (`var(--app-space-10)`),
  `--app-stepper-cell-row` (59px), `--app-stepper-cell-sheet` (95px),
  `--app-stepper-cell-sheet-narrow` (72px), `--app-stepper-figure` (17px),
  `--app-stepper-figure-count` (`var(--app-text-lg)`), `--app-stepper-figure-long`
  (`var(--app-text-sm)`), `--app-stepper-symbol` (`var(--app-text-xs)`), `--app-stepper-glyph`
  (14px), `--app-stepper-glyph-bar` (2px), `--app-stepper-figure-gap` (2px),
  `--app-stepper-cell-pad-sheet` (6px). 48 + 59 + 48 is 155, 48 + 95 + 48 is 191, 48 + 72 + 48
  is 168.

### 3.3 A press, the ends and the hold

- **A press** steps once, on release, through the button's `click`, so Enter and Space on a
  focused button step too. Minus: `max(min, stepFrom(value, unit, -1))`; plus:
  `stepFrom(value, unit, 1)`.
- **The ends.** Minus is at an end when `value <= min`; plus when `!canStepUp(value, unit,
  max)`. At an end the button carries `aria-disabled="true"` and ignores the press
  (decision D).
- **The base of a press** (S15). `value` is drawn and is the base, except that a press,
  repeat, key or typed commit that comes before the caller has redrawn builds on the amount the
  last one emitted. That amount is never drawn; it is dropped when `value` moves away from the
  amount it was built over, or after any render, so a refused, clamped or realtime amount wins
  at once.
- **The hold.** A primary pointer down on a button that is not at an end starts a timer of
  `QUANTITY_HOLD_DELAY_MS`. When it fires the button steps with `repeat: true` and schedules
  the next step after `QUANTITY_HOLD_FIRST_MS`, each later interval multiplied by
  `QUANTITY_HOLD_FACTOR` and never under `QUANTITY_HOLD_FASTEST_MS`. Each repeat computes from
  the current `value()`, so the caller's answer to the last step is the base of the next.
- **The repeat stops** on `pointerup`, `pointercancel`, `pointerleave` of the button, a `scroll`
  of the page (a capture listener on `window` while the hold lasts), the button reaching an
  end, `disabled` turning true, and the component's destruction. The `click` that ends a hold
  that repeated at least once is ignored, so the release adds no extra step. A hold released
  before the first repeat is an ordinary press.
- **A repeat never emits 0** (S8b). Plus stops before passing `max`.
  Minus stops at the last amount above 0, or at `min` when `min` is above 0 (decision C). A
  separate press is the only way to 0.
- `prefers-reduced-motion` changes nothing about the repeat; it only turns off the press scale.

### 3.4 The row variant

- The host is `role="group"` with `aria-label` from `amount.group` ("Amount of {{name}}",
  "Cantidad de {{name}}").
- Minus is named `amount.less` ("Remove {{step}} from {{name}}", "Quitar {{step}} de
  {{name}}"), plus `amount.more` ("Add {{step}} to {{name}}", "Añadir {{step}} a {{name}}"),
  where `step` is what that button moves at the current amount, in short form words ("25 g",
  "1", "10"), so the names change at 1000 for a count.
- The cell is `lib-amount-figure` with `form="short"`; it cannot be focused or typed into. Its
  spoken words sit inside the group, so the group is read with its amount ("Cantidad de
  Plátano de Canarias IGP, 750 gramos").
- A visually hidden `aria-live="polite"` span is emptied on each press and filled with
  `amount.settled` ("{{name}}, {{amount}}") `QUANTITY_STEP_QUIET_MS` after the last one
  (decision E).

### 3.5 The two sheet variants

- The same buttons and the same names. The cell is an `<input type="text" inputmode="decimal"
  autocomplete="off" enterkeyhint="done">` with `role="spinbutton"`, `aria-label` from
  `amount.group`, `aria-valuenow` (the integer in base units), `aria-valuemin`,
  `aria-valuemax` and `aria-valuetext` (the spoken words). The symbol under it is
  `aria-hidden`.
- It shows `exactAmount` while it is not being typed into. A focus selects the whole number.
- Arrow Up and Arrow Down step by one step (`repeat: false`), held to the ends; Home goes to
  `min`, End to the most a plus can reach (`max` rounded down to a whole step from the current
  amount is not needed: End goes to `max`). The live region is not filled for these (decision
  E).
- While typing, the symbol under the field follows `typedSymbol` (decision K).
- Enter and a blur commit: `parseTypedAmount` answers the amount, which is emitted when it
  differs from `value()`; null puts the shown text back and emits nothing. Escape with typed
  text puts the shown text back and stops the event, so the sheet stays open; Escape with
  nothing typed is left to the sheet, which closes.
- A `value()` that changes while the field holds typed text does not overwrite the text.

### 3.6 Accessibility, and what the guidelines were read to say

- **Target size.** WCAG 2.2 SC 2.5.8 (AA) asks 24 by 24 CSS px; SC 2.5.5 (AAA) 44 by 44;
  Android's guidance is 48 by 48 dp. Every button is 48 by 48, so all three hold. Apple's 44 pt
  is commonly cited and was not checked at a source.
- **Dragging.** SC 2.5.7 (AA) asks that anything done by dragging can be done with single
  presses. Buttons and a typed number need no drag; the reel needed one.
- **Pointer cancellation, our reading.** SC 2.5.2 (A) asks that the down event does not
  execute the function, or that it completes on the up event with a way to abort or undo, or
  that the up event reverses it, or that the down event is essential. Its page names no hold
  to repeat example. We read it this way: a single press completes on release; the repeat
  steps do run while the finger is down, and they are covered by abort and undo, because
  sliding off the button stops the repeat, nothing is saved until the presses stop, and minus
  undoes each plus exactly (S7b: plus then minus always returns). This is a
  reading, not a certified pass.
- **Timing.** No W3C page read (Understanding 2.5.1, 2.5.2, 2.5.7, 2.2.1, 4.1.3, the ARIA APG
  spinbutton pattern, WCAG2ICT 2.5.2) gives a number for repeat speed, acceleration or the
  delay before a repeat, and none requires or forbids a hold to repeat. Every amount stays
  reachable with single presses and with the keyboard.
- **Status messages.** SC 4.1.3 and its page warn against a "chatty" application and give no
  rate, so a screen reader hears the amount once when the presses stop (decision E), not on
  every repeat. SC 4.1.2: the group, the buttons and the spinbutton carry name, role and value.
- **Contrast.** SC 1.4.3 and 1.4.11: amount and glyphs 18.36 to 1, unit symbol 6.79 to 1, the
  outline 4.10 to 1 in a row and 4.35 to 1 in a sheet, as the mock measured them. A control at
  an end is exempt.
- **The field.** The ARIA APG spinbutton pattern for the two sheets. A focused field under 16 px
  makes iOS zoom the page: commonly cited, not checked at a source; the field is 17 px.

## 4. Saving: where each feature waits

One helper in `libs/velista/platform/src/lib/quantity-runs.ts`, exported from the barrel:

```ts
export interface QuantityRun {
  /** The amount the run started from, as the control drew it. */
  readonly from: number;
  /** The amount the last step reached. */
  readonly to: number;
}

/** Collect the steps of each key into one run, and send it after the quiet beat. */
export interface QuantityRuns<K> {
  /** The amount to draw for each key with an open run. */
  readonly pending: Signal<ReadonlyMap<K, number>>;
  /** What to draw for a key: the open run's amount, or the stored one. */
  shown(key: K, stored: number): number;
  step(key: K, step: QuantityStep): void;
  /** Send a key's open run now (a unit change, a sheet that opens). */
  flush(key: K): void;
}

/** Call in an injection context. Flushes every run on destroy and when the page is hidden. */
export function quantityRuns<K>(
  send: (key: K, run: QuantityRun) => void,
  quietMs?: number
): QuantityRuns<K>;
```

- The first step of a key records `from`; each step sets `to` and restarts that key's timer of
  `QUANTITY_STEP_QUIET_MS`. At the timer, or a flush, the run is removed from `pending` and
  `send` is called in the same task, so the store's optimistic write and the end of the run
  land in one render. A run whose `to` equals its `from` sends nothing.
- `DestroyRef` flushes every open run, as the reel did on destroy (`quantity-reel.ts:388` to
  `:395`): a number the person watched move is written. A `visibilitychange` to hidden flushes
  too, because an Android app in the background may never run the timer.

Where each feature waits, and what it sends:

| Surface | Library | The wait | The write |
| --- | --- | --- | --- |
| Zone list row, typeahead holdings on the list page | `feature-lists` (list page) | `quantityRuns` keyed by line id | `LineStore.addQuantity(lineId, to - from, { reportDropped: true })`, then `_afterWrite` as today |
| Line page | `feature-lists` (line page) | `quantityRuns` keyed by line id; `chooseUnit` flushes first | `LineStore.addQuantity(lineId, to - from)` |
| List's line sheet (asked for, how many) | `feature-lists` (sheet) | none: the amount is a form value | Save and "I bought this", as today |
| Due rows | `feature-lists` via `lib-due-line-row` | none: the Add button writes | `addDueLine` as today |
| Typeahead holdings on the shopping list page | `feature-shopping-lists` (basket page) | `quantityRuns` keyed by line id | `setDemand({ lineId, quantity: to, from })` with the run's `from` |
| Catalog tab, product page tables, added sheet | `CatalogAddStore` (decision G) | the store's own runs, keyed by line id | one `addQuantity` per run |

## 5. The surfaces

### 5.1 The zone list row (`lib-line-row`)

- `<lib-quantity-reel>` (`line-row.html:267`) becomes `<lib-quantity-stepper variant="row">`
  with `[value]="pending() ?? line().quantity"`, `[unit]`, `[name]` (the row's display name,
  as the label of `list.line.quantityFor` used it), `[readonly]="!line().adjustable"`,
  `[took]`, `(stepped)`, and the same `(click)` and `(pointerdown)` stop propagation, so a
  press never opens the line sheet. The `@if (!reordering())` stays until velista `0189`.
- `LineRow` gains `pending = input<number | null>(null)` and replaces `quantityChanged`
  (`:191`) with `quantityStepped = output<{ lineId: string; step: QuantityStep }>()`. Every
  piece that exists for the reel's overlay goes: the capture listeners, `_notePress`,
  `_swallowReelDismissal`, `_withinReel`, `onReelAutoClosed`, `_deafUntil`, `_swallowClick`,
  `_reel`, `_reelEl` (`:254` to `:331`), and the class comment's sections about the reel and
  the deaf beat, rewritten for a stepper that has no overlay.
- `lib-line-list` (`line-list.ts:90`, `:160`) forwards `quantityStepped` and takes
  `pending = input<ReadonlyMap<string, number>>(new Map())`, which it passes per row.
- The list page binds the four `lib-line-list` (`list-page.html:210`, `:304`, `:343`, `:357`)
  to `runs.pending()` and `(quantityStepped)`. `changeQuantity` becomes the runs' `send`; its
  guard on `canDecide` and its `_afterWrite` stay; its success announcement goes (decision E).
  `select-list-state.ts:320` keeps the stored quantity (decision H).
- `changeHolding` (`:2277`) feeds the same runs from the holding's `from` and `to`; the list
  page's `holdingsOf` draws `runs.shown(lineId, quantity)` for each holding.

### 5.2 The line page

`line-page.html:128` draws the `row` variant with `[value]="runs.shown(line.id, line.quantity)"`,
`[disabled]="unitPending()"` and `[name]` (the line's name). The text beside it takes the rest
of the row (191 px at 390, where it had 215). `step` (`line-page.ts:398`) becomes a call to
`runs.step`; the runs' `send` calls `addQuantity` and clears `_unitError` on success, as
`step` does today. `chooseUnit` flushes the line's run before it writes the unit. The reader
branch (`:136` to `:144`) is unchanged.

### 5.3 The list's line sheet

- The asked for reel (`line-detail-sheet.html:110`) becomes the `sheet` variant (191 by 48)
  with `[value]="amount()"`, `(valueChange)="onAmountChanged($event)"`, `[disabled]="saving()
  || unitPending()"`, `[unit]`, `[name]`. `onAmountPreview` and `onAmountCommitted` (`:722`,
  `:733`) become one `onAmountChanged` that calls `startEditing`, sets `amount` and clears
  `saved`. A press on Save moves focus out of the field first, so a typed amount is committed
  before the save reads `amount()`; a spec proves it.
- The how many stepper (`:413`) becomes the `sheet` variant with `[(value)]="howMany"`,
  `[min]="howManyFloor()"`, `[disabled]="line.busy"`. `howManyFloor` is `stepOf(unit)`.
- The reader branch (`<p class="shown">`) keeps its text.

### 5.4 The due rows

`due-line-row.ts:56` keeps its binding (`[value]="amount()"`, `(valueChange)="step($event)"`,
`[min]="1"`) with `[name]="vm.name"` in place of `[label]`, in the `row` variant. Its
`quietMs` defaults to `QUANTITY_STEP_QUIET_MS`.

### 5.5 The catalog: `ProductRow`, the lists table, the added sheet, `CatalogAddStore`

- `ProductRow`'s two steppers (`product-row.ts:565`, `:601`) are the `row` variant with no
  `accent` and no `compact`. `ProductRowStepper.label` and `ProductRowHeldLine.stepperLabel`
  become `name` and `stepperName`, the subject of the amount ("{{name}} on {{list}}" through
  `amount.inList` where a list is named). `ProductRowLineStep` (`:194`) becomes `{ lineId;
  step: QuantityStep }` and `stepped` (`:723`) emits a `QuantityStep`. The held lines sit
  12 px apart, as the mock draws them.
- `suggestion-list.ts:362` emits `holdingChanged` with the step's `from` and `to`; it no longer
  calls `stepFrom`. `SuggestionHoldingChange` gains `repeat`. `:414` passes the holding's text
  as the name.
- `ListsTable` (`lists-table.ts:77`, `:101`) draws the `row` variant for each list and each
  other line; `[accent]`, `[compact]` and `[controlled]` go. `ListsTableStep` (`:14`) becomes
  `{ listId; lineId; step: QuantityStep }`; `stepMain` keeps today's rule, emitting `added` for
  a plus where the list allows adds. The rule of what a plus does on a list that holds the
  product is velista `0187`'s (U5), which builds on this event shape.
- `VisitAdded` (`visit-added.ts:80`) passes the step through `VisitAddedStep.step`, and keeps
  `min: row.floor - 1` so the minus at the floor stays pressable.
- `CatalogAddStore.step(product, lineId, step: QuantityStep)` replaces `by: 1 | -1`:
  - A press (`repeat: false`) going down on a line the visit created that meets today's take
    back rule (`catalog-add-store.ts:531` to `:541`: `step.to === 0`, or a measured line
    pressed from exactly `visitFloor`) first sends the line's open run, then takes the product
    back. A repeat that meets the rule is dropped, so a hold never takes back.
  - Any other step draws `step.to` at once (`_move` by the difference from the drawn
    quantity) and joins the line's run; after `QUANTITY_STEP_QUIET_MS` with no step the run is
    written through `_queued` as one `addQuantity(lineId, to - from, unit)`, and the visit is
    recorded with `before` the amount the run started from. A failure moves the drawn amount
    back to the run's `from`.
  - The legacy unit correction (`_correctUnit`) is unchanged and runs on the first step of a
    run, before the run starts.
- The four handlers (`catalog-page.ts:1076`, `product-page.ts:445`, `:480`,
  `added-sheet.ts:126`) pass the step through.

### 5.6 The shopping list page's typeahead

`basket-page.ts:2487` becomes the `send` of a `quantityRuns` keyed by line id, which writes
`setDemand` with the run's `from` and `to`; the page's holdings draw `runs.shown`. The row, its
cell and its sheet are velista `0190`'s and are not touched.

### 5.7 The composer, until velista `0185`

`line-composer.html:128` binds `[(value)]="quantity"`, `[disabled]="busy()"` and `[name]` from a
new key `amount.newLine` ("the new line", "la nueva línea"), in the `row` variant. Velista
`0185` removes the element and the key.

### 5.8 The copy

| key | `en` | `es` |
| --- | --- | --- |
| `amount.group` | Amount of {{name}} | Cantidad de {{name}} |
| `amount.less` | Remove {{step}} from {{name}} | Quitar {{step}} de {{name}} |
| `amount.more` | Add {{step}} to {{name}} | Añadir {{step}} a {{name}} |
| `amount.settled` | {{name}}, {{amount}} | {{name}}, {{amount}} |
| `amount.inList` | {{name}} on {{list}} | {{name}} en {{list}} |
| `amount.newLine` | the new line | la nueva línea |

The keys that named the old controls and lose their last use are removed from both files: the
builder checks each of `list.line.quantityFor`, `list.page.quantityLabel`,
`list.due.quantityLabel`, `catalog.inLists.stepper`, `catalog.held.stepper`,
`catalog.added.stepper`, `list.add.card.alreadyQuantity`, `list.add.fewer`, `list.add.more`,
`list.line.quantityChanged` with a search and removes only the unused ones.

## 6. What the reel leaves behind

| File or symbol | What happens |
| --- | --- |
| `libs/velista/ui/src/lib/list/quantity-reel.ts`, `.html`, `.scss`, `.spec.ts` | Kept by this plan for `basket-row.html:354` and `row-entries.html:47`, `:111`; deleted by velista `0190` |
| `libs/velista/ui/src/lib/list/quantity-reel-gesture.ts`, `.spec.ts` | The same |
| `libs/velista/ui/src/index.ts:86` (`quantity-reel` export) | Removed by velista `0190` |
| `TOOK_DURATION_MS` (`quantity-reel.ts:33`) | Moves to `quantity-stepper.ts` now; the list page and the basket page import it from there |
| `QUANTITY_REEL_PX_PER_UNIT`, `QUANTITY_REEL_PAGE_STEP`, `QUANTITY_REEL_TAP_SLOP_PX`, `QUANTITY_REEL_TAP_MAX_MS` | Used only by the reel; removed by velista `0190` with it |
| `QUANTITY_REEL_IDLE_MS` | `DUE_LINE_STEP_QUIET_MS` and `line-row.spec.ts` stop using it now; the reel and the basket specs keep it until velista `0190` removes it |
| `QUANTITY_REEL_CLICK_SHIELD_MS` | `line-row.ts` stops using it now; `basket-row.ts:23`, `:685` keep it; velista `0190` keeps it for `_holdIfRemote` (the status control), renamed `STATUS_FLIP_SHIELD_MS`, value 250 |
| `QUANTITY_FINE_STEP`, `QUANTITY_COARSE_STEP` | Removed now; `stepAt` rewritten (section 1) |
| `stepsFrom` | Rewritten over the one step now; removed by velista `0190` |
| `line-row.ts:254` to `:331` and its class comment on the deaf beat | Removed now (section 5.1) |
| `quantity-stepper.scss` `.is-accent` and `.is-compact` rules | Removed now |

If velista `0190` is merged before this plan, the first, second, third, fifth, sixth and
eighth rows are this plan's, and the builder stops to say so (Action boundaries).

## 7. Specs and e2e

- `line-unit.spec.ts`, naming S7b: `stepAt` for the three units below and from 1000; `stepFrom`
  for a count 999 up (1000), 1000 up (1010), 1000 down (999), 1010 down (1000), 1005 down
  (995) then up (996), 0 down (0); for grams 10 down (0), 1000 down (975), 1010 up (1035) then
  down (1010); plus then minus returns from every amount from 0 to 1100 and around 999 990
  for all three units (a loop); `canStepUp` false from 999 985 to 999 999 for a count and from
  999 975 for grams; the removed tables have no spec left.
- `quantity.spec.ts` (platform): `shortAmount` for 999 g, 1000 g ("1", "kg"), 1250, 1275
  ("1,28"), 2010 pieces ("2,01", "K" in `es`, "k" in `en`), 125 250 g ("125,25", `long`),
  999 995 and 999 999 ("999,99"), 950 ml, 1500 ml ("1,5", "l"); `exactAmount` for 1275 g,
  999 999 g, 99 999 pieces, 123 456 pieces; `spoken` in both locales; `parseTypedAmount` for
  "1,5" under "ml" (1500), "1,5" under a count of 2 (1500), "750" under "kg" (750 000), "0,5"
  under "kg" (500), "1.5" (both separators), "1,2,3" and "abc" (null), "1000000" (held to
  999 999), a value under `min` (held to `min`).
- `quantity-runs.spec.ts`: one send per run with the first `from` and the last `to`; separate
  runs per key; a run back to its start sends nothing; flush; destroy flushes; a hidden page
  flushes; `pending` and `shown`.
- `quantity-stepper.spec.ts`, rewritten with fake timers: a press emits on `click` and not on
  `pointerdown`; the ends with `aria-disabled` and focus kept; a minus under one step goes to
  `min`; plus off one step before `max`; the hold's first repeat at 400 ms and the intervals
  300, 255, 217 and down to 100; a hold released before 400 ms steps once; the click after a
  repeating hold steps nothing; `pointerleave`, `pointercancel`, a scroll and `disabled` stop
  it; a minus hold from 100 g stops at 25 g and never emits 0; a minus hold with `min` 1 stops
  at 1; the row's group name, button names with "25 g" and "1", no focusable cell; the live
  region filled once 800 ms after the last press and not after arrow keys in a sheet; the
  sheet's spinbutton values, select on focus, Arrow keys, Home, End, Enter, blur, Escape with
  and without typed text, the live symbol while typing "1,5" under "ml"; `took`; `readonly`
  draws no button; `data-value`.
- `amount-figure.spec.ts`: short and exact forms, `speak`.
- `line-row.spec.ts`, `line-list.spec.ts`, `list-page.spec.ts`: a press emits
  `quantityStepped`; a press does not open the sheet; three presses send one `addQuantity` of
  75 after the quiet beat; the row draws the run's amount while the stored line has not moved;
  no announcement from the page on success; a destroyed page writes its open run.
- `line-page.spec.ts`: one write per run; `chooseUnit` flushes first.
- `line-detail-sheet.spec.ts`: a typed amount then Save saves the typed amount; the how many
  floor is one step.
- `due-line-row.spec.ts`, `lists-table.spec.ts`, `product-row.spec.ts`, `visit-added.spec.ts`,
  `suggestion-list` specs: the new event shapes; no `accent` class.
- `catalog-add-store.spec.ts`: three presses write once; a press to 0 on a line the visit made
  takes back after sending the open run; a repeat that meets the take back is dropped; a
  failed run moves the drawn amount back.
- `basket-page.spec.ts`: three presses on a holding send one `setDemand` with the first `from`.
- `apps/velista-luna-e2e`: `catalog.spec.ts` steps 2, 3 and 5 read a held line's amount from
  `data-value` of `lib-quantity-stepper` and press buttons by their new names ("Add 1 to …",
  "Remove 1 from …"); step 8 is rewritten by velista `0187`. A new `stepper-fit.spec.ts`, after
  the pattern of `apps/velista-e2e/src/landing-fit.spec.ts`, opens a zone list and one line
  sheet on the slot, writes "uds." into a stepper's symbol and "999,999" and "125,25" into its
  figure through `locator.evaluate`, and asserts that no figure or symbol overflows its cell in
  the `row` and `sheet` variants (velista `0190` adds `sheet-narrow`). The basket's `reel` and
  `nudge` steps are velista `0190`'s.

## 8. Acceptance criteria

- [ ] `QuantityStepper` draws D3 at 155, 191 and 168 by 48 for every amount from 0 to 999 999,
      and the fit test proves a four letter symbol and the longest figures fit.
- [ ] Every surface of section 5 draws it, with no orange tint, and no zone list, line page,
      line sheet or catalog surface draws the reel.
- [ ] The step follows S7b (a count by 10 from 1000), plus then minus always returns, and the
      ends behave as S8.
- [ ] A hold repeats with the numbers of section 1, stops on every event of section 3.3, and
      never emits 0.
- [ ] The short and the exact forms read as section 2 in `en` and `es`.
- [ ] Typing works only in the two sheets, with the parse rules of section 2.
- [ ] Each surface of section 4 writes one change per run, and a page that goes away writes its
      open run.
- [ ] The screen reader contract of sections 3.4 to 3.6 holds in a spec and in the walk.
- [ ] Section 6's "now" rows are done, and nothing of the reel is left except what velista
      `0190` deletes.
- [ ] `npx nx affected -t lint test` is green, `npx nx build velista` builds, and
      `catalog.spec.ts` and `stepper-fit.spec.ts` pass on a slot.

## Not in this plan

- **The shopping list row, its sheet and its swap icon.** Velista `0190`, which uses
  `shortAmount`, `AmountFigure` and the `sheet-narrow` variant, and deletes the reel.
- **The search at the top, the progress bar, the reorder mode.** Velista `0189`.
- **The compact row.** Velista `0191`, which draws the `row` variant.
- **What an add puts on a line, and the catalog's switched off plus.** Velista `0185` and
  backend `0260`.
- **The most of 999 999 on the server.** Backend `0262`; velista's `LINE_QUANTITY_MAX` follows it.
- **Deleting a line at 0.** Backend `0263` and velista `0192`. This plan only makes sure a hold
  never reaches 0.
- **A product's own step.** Velista `0186`, which adds a `step` input.
- **What a plus does on the product page's table for a list that holds the product.** Velista
  `0187` U5.

## Questions for the owner

Answered on 2026-11-12:

- A press while the field holds typed text commits the text and takes no step. Kept.
- A run is written 800 ms after the last step, even while the finger is still down. Kept.
- No `MIN_CLIENT_VERSION` raise for builds that still have the reel.

Open:

1. The hold's numbers (400 ms, then 300 ms down to 100 ms by a factor of 0.85): do they feel
   right on the phone?
2. In a sheet the step follows the short form too, so a count of 1000 steps by 10 there even
   though the field shows "1000" (decision M). Is that right, or should the sheet step by 1?
3. The writes wait 800 ms after the last press (decision F). Shorter feels faster on a slow
   list; longer sends fewer requests. Is 800 ms right?
4. A typed "750" under "kg" means 750 kg (decision K). Should a whole number typed into a field
   that shows kilos be read in grams instead?
5. A person who may only read a list sees the amount with no buttons and no outline
   (decision I). Do you want the outline kept, with no buttons, so rows look the same?
6. The catalog waits in its store and not in the pages (decision G). Is that an acceptable
   reading of "the logic layer in a feature library"?
