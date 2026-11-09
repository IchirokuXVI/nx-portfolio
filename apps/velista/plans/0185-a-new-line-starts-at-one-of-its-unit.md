# 0185: a new line starts at one of its unit

> Decided on 2026-11-09. The composer at the foot of the list page and of the basket carries
> a quantity stepper. Since velista `0182` a count of 3 there means 3 kilos for a loose
> product and 3 pieces for anything else, and the person cannot tell which until the line is
> drawn. The owner decided on 2026-11-09 that the composer has no quantity picker at all
> (U3): typing and pressing add creates a line at one of its unit, or adds one of its unit to
> the line that already holds the name or the product, and the amount is then stepped on the
> list. A product add that meets only a line of another unit is an error and creates nothing
> (U2).
>
> Amends velista `0182` (the composer's count multiplied by `defaultQuantity`, PR #960
> builder decision 3) and velista `0170` (the duplicate popover, alternative D). Needs PRs
> #959, #960 and #961 merged into `dev`, and backend `0260` on the gateway. That plan makes a
> typed name an **open add** (no `unit`, no `quantity`) that raises the product line it lands
> on by one default of that line's unit, asks about every candidate with its unit when there
> are several, and refuses with `line_unit_differs` only an add that states a unit and meets
> only lines of another unit (backend `0260` R5, R6, section 1 steps 1 and 3). Velista
> `0186` and `0187` do not depend on this plan, nor this plan on them.
>
> Prerequisite reading: backend `0260` sections 0 (R1 to R6), 1 and 2 (its wire shape wins
> over sections 2 and 3 here); backend `0246` section 0 (W1, M5, M8) and section 9; velista
> `0170` targets 3 and 5; velista `0116` (the basket asks which list); velista `0117` (the
> field is the page's search); velista `0182` section 2.
>
> Code anchors, on `origin/feat/velista-0183-line-unit-chip` as of 2026-11-09:
> `libs/velista/ui/src/lib/list/line-composer.ts:43` (the `QuantityStepper` import), `:49` to
> `:71` (`LineComposerSubmit`), `:162` (in `imports`), `:291` (`readonly quantity =
> signal(1)`), `:589` and `:605` (the reset rule in the comments of `restore` and `sent`),
> `:627` (`clear` resets it), `:719` to `:754` (`_send`, which multiplies by
> `defaultQuantity(unit)`, caps at `LINE_QUANTITY_MAX` and defaults `unit` to `'UNIT'` for
> typed text); `line-composer.html:128` (`<lib-quantity-stepper [(value)]="quantity" ...>`);
> `line-composer.scss` (`.composer` is a flex row and `.field-wrap` has `flex: 1`);
> `libs/velista/models/src/lib/add-choice.ts:55` to `:69` (`AddChoiceRow`), `:86`
> (`addChoiceRows`, whose `to` is null for a line of another unit at `:110`);
> `libs/velista/ui/src/lib/list/add-choice.ts:94`; `libs/velista/ui/assets/i18n/en.json:860`
> and `:861` (`rowHolds`, `rowHoldsNoProduct`); `libs/velista/feature-lists/src/lib/list-error-copy.ts:93`
> and `libs/velista/feature-shopping-lists/src/lib/basket-error-copy.ts:236` (both map
> `line_unit_differs` to the rename sentence `list.error.unitDiffers`);
> `libs/velista/feature-lists/src/lib/list-page/list-page.html:443` (`composer-dock`), `:499`
> (the composer) and `:532` (`[added]="asked.entry.quantity"`);
> `libs/velista/feature-shopping-lists/src/lib/basket-page/basket-page.html:723` and `:733`,
> `basket-page.ts:2228`; `libs/velista/data-access/src/lib/baskets/basket-api.ts:448`;
> `libs/velista/data-access/src/lib/lines/line-memory.ts:142` and `:270`,
> `basket-memory.ts:1564` and `:1665` (the fakes' duplicate question);
> `libs/velista/data-access/src/lib/catalog/catalog-add-store.ts:426` (the catalog add, which
> sends `defaultQuantity(unit)` and never had a count).
>
> Read "Angular conventions" in `CLAUDE.md` before any code, and load `design-taste-frontend`
> before the template, the styles or the copy.

## Brief for the agent

### Objective

Take the quantity stepper out of the line composer on both pages, send a typed name as an
open add with no amount and no unit, send a chosen product at one of its unit, draw the
duplicate question with what one default adds to each line in that line's own unit, and draw
a refused product add as one readable sentence above the plus while the words stay in the
field.

### Context

- One component, `LineComposer`, serves the list page and the basket. Its own comment
  (`line-composer.ts:236` to `:240`) says the field, the run behaviour, the counter and the
  stepper are the same on both screens on purpose.
- `_send` emits `quantity: min(count, LINE_QUANTITY_MAX / defaultQuantity(unit)) *
  defaultQuantity(unit)` and `unit`, `'UNIT'` for typed text, so a count of 3 on a loose
  product is 3000 g (PR #960 review round 1, item 5), and every typed name states `UNIT`.
  Under backend `0260` a free text add that states a `quantity` or a `unit` is checked as a
  stated unit (R5, `0246` M8), so a typed name sent as today would be refused against a
  weighed product line of its name.
- Both pages bind `[holdOnSend]="true"` (`list-page.html:507`, `basket-page.html:739`): the
  words stay in the field until the page calls `sent()`. So a refusal can leave them there
  without any new mechanism.
- PR #960 "Builder decisions" records that the add question offers a line of another unit as
  "1 kg" with no arrow (`addChoiceRows`, `to: null`), and that choosing it ends in a
  `line_unit_differs` drawn with the rename sentence. Under backend `0260` step 1, an open
  add's `intoLineId` raises the chosen line by one default of its unit, whatever that unit,
  so every row can now say what it becomes.
- The e2e suites never touch the composer's stepper. `apps/velista-luna-e2e/src/support/app.ts:190`
  (`composerField`) and `:221` (`addInTheAisle`) use only the field and the Add button; a
  `git grep` for the stepper's names ("How many", "One more", "One fewer") in
  `apps/velista-luna-e2e` and `apps/velista-e2e` finds them only on the catalog's steppers
  (`catalog.spec.ts:211`, `:237`, `:292`).

### Target state

1. `LineComposer` has no `quantity` signal, no `QuantityStepper` and no count in its row.
   The field takes the width the stepper used.
2. A typed name is submitted with no `quantity` and no `unit`, and the pages send the add with
   neither field: backend `0260` calls it an open add. The server fills the amount. A line it
   creates counts one piece (U1), and a product line it lands on is raised by
   `defaultQuantity` of that line's unit (one piece, one kilo, one litre). A chosen product
   (a typeahead card) is submitted with `unit: lineUnitOf(product)` and
   `quantity: defaultQuantity(unit)`, as today minus the multiplier.
3. The duplicate question of an open add draws every line the server names, of any unit, each
   with its amount now and what one default of its own unit takes it to ("750 g → 1,75 kg",
   "2 → 3").
4. A product add refused with `line_unit_differs` creates nothing, keeps the words in the field
   and the keyboard up, and draws one sentence on the composer's surface directly above the
   row: "This list already counts bananas by weight. Change the amount on that line instead."
   in `en` and `es`, chosen by the unit of the line it met, with no number in any key. A typed
   name never meets it (backend `0260` section 2).
5. The basket's composer and the list's composer change together, and the catalog's adds
   (the catalog tab, the product page) are unchanged.

### Scope

- Work in `libs/velista/ui` (the composer, the add question, the assets), `libs/velista/models`
  (`add-choice.ts`), `libs/velista/data-access` (the add writes, the fakes, the refusal's
  mapper), `libs/velista/feature-lists` and `libs/velista/feature-shopping-lists` (the two
  pages and their error copy), and `apps/velista-luna-e2e`.
- Do NOT touch the reel, the stepper component itself, the steps (velista `0186`), the
  product page (velista `0187`), the catalog add store, or any backend project.
- Do NOT add a unit picker, a conversion, or any way to choose a unit at the composer.

### Constraints

- Rule D4: the refusal's details are mapped from `unknown` into velista's own model. No
  import from `@portfolio/luna-shopper/contracts` or `basket-rules`.
- An open add omits `quantity` and `unit` on the wire; it never sends `quantity: 1` "to be
  safe", which backend `0260` R5 reads as a stated `UNIT`.
- Copy through RokuTranslator keys in `en` and `es`; the line's name goes in as an argument.
  No dashes as punctuation in copy or comments.
- The composer keeps every property of velista `0038` and `0170`: focus across a submit,
  the microphone on an empty field, the counter past 350 characters, the held send.

### Action boundaries

- Proceed with sections 1 to 6 once PRs #959 to #961 are in `dev`.
- Stop and ask if backend `0260` is not on the gateway of the slot, if an add with neither
  `quantity` nor `unit` is refused by the gateway's DTO, or if its refusal does not carry
  `details.line` as its section 2 states.
- Stop and ask if the owner answers backend `0260` question 1 with "refuse a typed name
  instead": target 2 and section 3 then change, and the refusal reaches typed names too.
- Stop and ask before giving the composer any new control.

### Progress evidence

Each criterion of section 7 with its spec output, `npx nx build velista`, and one walk on a
slot with backend `0260`: a typed "Walk bananas" onto a list whose only line of that name holds
the product at 750 g raises it to 1,75 kg and draws no new row; a typed "Bread" onto a list
that holds it adds one; a loose product from the typeahead lands at 1 kg; the same card onto a
list whose line of the product counts pieces (a line with several products set to `UNIT` by
velista `0183`) draws the sentence and creates nothing.

## 0. Decisions

### The owner's, 2026-11-09, fixed

- **U1. A free text line counts pieces.** To count in another unit a line needs a product
  set. This closes the first bullet of backend `0246` section 9. W1 stands. A typed name that
  creates a line creates one piece.
- **U2. A conversion between units is wanted at an add and at a merge, and not now.** Until
  a conversion plan is built, an add or a merge that meets a line of another unit is an
  error, never a choice and never a silent new line. The conversion is backend backlog
  `0024`, as backend `0260` names it (not read for this plan).
- **U3. The composer has no quantity picker.** A person types and presses add. That creates
  a free text line, or adds one default unit (`defaultQuantity(unit)`: one piece, one kilo,
  one litre) to the line that already holds that name or product. A line of another unit is
  an error (U2). The amount is then stepped on the list, never in the composer.
- **The owner's reading of U3 (backend `0260` R5):** "add 1 unit (kg, L...) by default to a
  line with the same name". A typed name states no unit and takes the unit of the product
  line it lands on, so "plátanos" onto "plátanos" at 750 g makes it 1750 g. Only an add that
  states a unit is refused. Backend `0260` question 1 asks whether that should change.

### The writer's, open to the owner

- **A. The field takes the stepper's width, and nothing else is added to the row.** The row
  is a flex row whose field already has `flex: 1` (`line-composer.scss`, `.field-wrap`), so
  removing the stepper gives its width to the field with no layout change. A longer product
  name stays readable while it is typed, which is the one thing the row is for. A spacer, a
  hint or a unit word in that place would be a control that does nothing.
- **B. Both composers change together.** They are one component on purpose (its comment at
  `line-composer.ts:236`), and the basket's held send (velista `0116`) reads the same
  submit. Two behaviours would need an input whose only job is to keep a stepper on one
  screen, which U3 forbids on both.
- **C. The catalog's adds are unchanged.** `CatalogAddStore.add` sends one of the unit
  (`catalog-add-store.ts:433` to `:435`) and never had a count. It states a unit, so it keeps
  the check of backend `0260`. The product page's plus on a line that exists is velista
  `0187`.
- **D. `LineComposerSubmit.quantity` and `unit` become optional, and absent on a typed
  name.** The submit carries both only for a chosen product. The pages pass what they get to
  `LineService.addLine` and `BasketStore.addLine`, which omit both fields on the wire when
  absent, so the server applies R5. Nothing in velista computes what an open add will raise
  a line by: the server's answer says it, and the page draws that answer (velista `0170`
  target 3 already replaces a drawn row with the line the server raised).
- **E. The refusal is a sentence on the composer's surface, not a popover.**
  `AnchoredPopover` is a `role="dialog"` that closes on a press outside it
  (`anchored-popover.ts:110`), so the person's next tap in the field would take it away, and
  a dialog is the wrong role for a statement. The list page already draws what the
  assistant heard as a strip on the same dock directly above the row (`list-page.html:443`
  to `:488`), so the sentence takes the same place, in the same polite region, on both
  pages. Focus stays in the field and the keyboard stays up, which is the run property of
  velista `0038`.
- **F. Every row of the question says what it becomes, in its own unit.** Backend `0260` R6
  serves each candidate's `unit`, and step 1 raises a chosen line by one default of that unit.
  So `addChoiceRows` computes `to` per line from `defaultQuantity(line.unit)` and never
  answers null. The "counted in another unit" wording (`rowHolds`, `rowHoldsNoProduct`) is
  replaced by the row's own arrow in its unit ("750 g → 1,75 kg"), which says the same fact
  and also what the press does. Those two keys and the `to: null` branch go.
- **G. The line the add met is not marked on the list.** Velista `0170` marks a raised row's
  quantity for 2.5 s. Marking the line of another unit after a refusal would point at where
  to step, but it is a second behaviour for one refusal and the basket has no such mark. Left
  as a question.

## 1. The composer

- Remove `QuantityStepper` from `imports`, the `<lib-quantity-stepper>` element from
  `line-composer.html`, and the `quantity` signal. `clear()`, `sent()` and `_clear()` stop
  resetting it.
- `LineComposerSubmit.quantity` and `unit` become optional. `_send` emits them only when
  `itemIds` is set: `unit` from the chosen card and `quantity: defaultQuantity(unit)`. A typed
  name emits `content`, and `anchor` when held, and neither field. The `LINE_QUANTITY_MAX`
  cap goes, since a default amount cannot reach it.
- Rewrite the comments that name the stepper or the count: the class comment's "Adding
  happens in runs" (no count to reset), "One slot, two jobs" (the row no longer "carries a
  stepper"), `restore` (the quantity paragraph goes), the `voice` input's "An input and not
  a second component" (three things are shared, not four), the template comment at
  `line-composer.html:130` to `:141`, and the doc of `LineComposerSubmit.unit` ("typed text
  included" becomes "absent for typed text, which the server resolves").
- The clear cross no longer says "the quantity stays": `clearTyped` keeps its behaviour and
  loses that sentence.
- A new input, `notice = input<string | null>(null)`, the translated sentence to draw above
  the row, and a new output, `noticeDismissed`, for its cross. The composer never clears it
  by itself; the page owns it (section 4).

## 2. The writes

- `LineService.addLine` / `addLineResult`, `LineApi` and `BasketStore.addLine` /
  `basket-api.ts` take `quantity` and `unit` as optional and leave both out of the request
  body when absent. The `intoLineId` answer of the question and `newLine: true` are sent the
  same way, with neither field, since they answer an open add.
- The list page's optimistic row for a typed name that is not predicted to meet a line
  (velista `0170` target 3, `addMayMeetLine`) is drawn at one piece, which is what the server
  creates (U1); the answer replaces it as today. A typed name predicted to meet a line draws
  nothing until the answer, as today, and the raised line arrives in it.
- The in memory fakes (`line-memory.ts:142` and `:270`, `basket-memory.ts:1564` and `:1665`)
  follow backend `0260` section 1: an open add raises one candidate by `defaultQuantity` of
  its unit, asks about two or more of any unit, and creates a `UNIT` line otherwise; an add
  that states a unit and meets only another unit refuses with `line_unit_differs` and
  `details.line`.

## 3. The add question

- `addChoiceRows(choice, facts)` loses `added` and `addedUnit`. Each row's `to` is
  `min(LINE_QUANTITY_MAX, line.quantity + defaultQuantity(line.unit))`, a plain `number`, and
  the row keeps its `unit` so the ui draws both amounts through `formatQuantity`.
- `list-page.html:532` and the basket's picker stop passing `[added]`.
- `libs/velista/ui/src/lib/list/add-choice.ts` loses its branch for a row of another unit
  (`:94`). Every row draws "from → to" in its unit, and its accessible name uses the existing
  `addChoice.row` and `addChoice.rowNoProduct` ("Add {{added}} to {{name}}: {{from}} to
  {{to}}", `en.json:858` and `:859`), with `added` now the row's own default formatted in its
  unit ("1 kg", "1"). `rowHolds` and
  `rowHoldsNoProduct` are removed from `en.json` and `es.json` (decision F).
- The question is only ever asked of an open add (backend `0228`: none on an add that carries
  products), so no row can now end in a refusal.

## 4. The refusal

- **When.** Only a product add: a typeahead card chosen in the composer on either page, which
  states its unit. A typed name never meets it (backend `0260` section 2).
- **The model.** `AddUnitRefusal { lineId: string | null; name: string; unit: LineUnit |
  null }` in `libs/velista/models/src/lib/add-choice.ts`, mapped in
  `libs/velista/data-access/src/lib/mapping/add-choice-mappers.ts` from the refusal's
  `details` as backend `0260` section 2 defines them: `details.line` (`lineId`, `content`,
  `unit`, `quantity`) is the line the add met, `details.unit` what the add counted in, and
  `details.index` a batch item's position or null. Velista reads `line.lineId`,
  `line.content` and `line.unit`, the last with `oneOf(LINE_UNITS, null)`. `name` is
  `line.content` when present, else the product's name the card carried. A merge's
  `line_unit_differs` carries no details (backend `0260` section 2) and keeps the rename
  sentence.
- **The pages.** On a product add refused with `line_unit_differs`, each page does not call
  `sent()`, so the words stay; it removes the optimistic row if it drew one; it sets its
  `addNotice` signal to the sentence and passes it to `[notice]`. It sets the signal to null
  on the next `queryChanged`, on the next submit, and on `noticeDismissed`.
- **The copy.** `list-error-copy.ts` and `basket-error-copy.ts` keep `list.error.unitDiffers`
  for a rename and answer the keys below when the refusal carries `details.line` (the builder
  reads which operation name each file uses for an add; unverified). The basket names the list
  it picked when the refusal says which, as `basket.error.mergeNeedsApproval` does.

| key | `en` | `es` |
| --- | --- | --- |
| `list.error.addUnitDiffers.UNIT` | This list already counts {{name}} in pieces. Change the amount on that line instead. | Esta lista ya cuenta {{name}} por unidades. Cambia la cantidad en esa línea. |
| `list.error.addUnitDiffers.GRAM` | This list already counts {{name}} by weight. Change the amount on that line instead. | Esta lista ya cuenta {{name}} por peso. Cambia la cantidad en esa línea. |
| `list.error.addUnitDiffers.MILLILITER` | This list already counts {{name}} by volume. Change the amount on that line instead. | Esta lista ya cuenta {{name}} por volumen. Cambia la cantidad en esa línea. |
| `list.error.addUnitDiffers.unknown` | This list already has {{name}} in another unit. Change the amount on that line instead. | Esta lista ya tiene {{name}} en otra unidad. Cambia la cantidad en esa línea. |
| `basket.error.addUnitDiffers.UNIT` | {{list}} already counts {{name}} in pieces. Change the amount on that line instead. | {{list}} ya cuenta {{name}} por unidades. Cambia la cantidad en esa línea. |
| `basket.error.addUnitDiffers.GRAM` | {{list}} already counts {{name}} by weight. Change the amount on that line instead. | {{list}} ya cuenta {{name}} por peso. Cambia la cantidad en esa línea. |
| `basket.error.addUnitDiffers.MILLILITER` | {{list}} already counts {{name}} by volume. Change the amount on that line instead. | {{list}} ya cuenta {{name}} por volumen. Cambia la cantidad en esa línea. |
| `list.add.dismissNotice` | Dismiss | Cerrar |

  "By weight" and not "in kilos": a line of 750 g counts grams and is drawn as "750 g", so
  "kilos" would contradict the row the person is about to look at. The basket falls back to
  the `list.*` sentence when the refusal names no list.

## 5. The drawing

- The sentence sits in the composer, above `.composer`, on the same surface and with the
  same padding and hairline as the row (the rule `line-composer.scss` already states for
  the listening row), inside `aria-live="polite"`. Body text, `--app-text-primary`, start
  aligned with the field, at most two lines on a 360 px phone in both locales (the longest
  `es` sentence is the builder's to check in the walk). No glyph and no colour fill: it is a
  statement, not an alarm, and velista draws no tinted containers.
- A close cross at its end, the same `lib-close-icon` and size the voice strip uses
  (`list-page.html:479` to `:486`), labelled `list.add.dismissNotice`. It returns focus to
  the field.
- The list page's voice strip and this sentence never show together: a recording clears
  the notice, and a notice clears a finished voice strip. One message above the row at a
  time.

## 6. Specs and e2e

- `line-composer.spec.ts`: the specs that set `quantity` (around `:271` to `:297`, `:399`
  to `:415`, `:436` to `:443`, `:751` to `:757`, `:780` to `:794` on the branch) become: a
  typed name emits no `quantity` and no `unit`; a chosen card emits its unit and
  `defaultQuantity(unit)` for `UNIT`, `GRAM` and `MILLILITER`; no stepper is rendered; and
  `notice` draws, announces and emits `noticeDismissed` from its cross. The held send spec
  keeps "keeps the words" and loses "and the quantity".
- `composer-submit.spec.ts` is unchanged (it asserts the form's submit event).
- `add-choice.spec.ts` (models): `to` is `from` plus one default of the row's own unit for a
  `UNIT`, a `GRAM` and a `MILLILITER` line in one question, capped at `LINE_QUANTITY_MAX`. The
  ui `add-choice.spec.ts`: a `GRAM` row draws "750 g" and "1,75 kg"; the "counted in another
  unit" case is removed.
- Data access specs (`line-api`, `basket-api`, the stores): an open add's body has neither
  `quantity` nor `unit`, nor do its `intoLineId` and `newLine` answers; a product add's body
  has both. The fakes' specs follow section 2.
- `add-choice-mappers.spec.ts`: the refusal mapped from `unknown`, with a missing line, a
  missing unit and an unknown unit.
- `list-error-copy.spec.ts` and `basket-error-copy.spec.ts`: the add keys per unit, the
  fallback, the rename key unchanged for a refusal with no details.
- `list-page.spec.ts` and `basket-page.spec.ts`: a typed name onto one weighed product line
  draws the raised line from the answer and no new row; a product card refused with
  `line_unit_differs` keeps the words, draws the sentence, clears it on a keystroke and on
  the cross, and writes nothing more; a question with a `UNIT` and a `GRAM` row draws both
  with their arrows, and choosing the `GRAM` one sends `intoLineId` with no amount.
- `apps/velista-luna-e2e`: no existing step uses the composer's stepper (Context), so none
  needs a change for target 1. The weighted `describe` of `shop.spec.ts` (around `:407` to
  `:475`, whose line holds the loose product at 1000 g in `GRAM`) gains a test of the open
  add: on the Groceries list page the composer types the product's name and presses add, and
  the test expects that line to read "2 kg" (`aria-valuenow` 2000), no new row of that name,
  and over the API one line of that name, `GRAM`, 2000. It runs on a line of its own made in
  the test, so the existing test's numbers do not move. The refusal of a product add needs a
  line with several products set to `UNIT` (velista `0183`), which the suite cannot make
  cheaply, so it is covered by the page specs and the walk.

## 7. Acceptance criteria

- [ ] The composer renders no stepper on the list page and on the basket, and the field
      fills the row (a spec on both pages' templates, and the walk's screenshots).
- [ ] A typed name is sent with neither `quantity` nor `unit`, including its `intoLineId`
      and `newLine` answers; a chosen product is sent with its unit and
      `defaultQuantity(unit)`.
- [ ] A typed name onto one product line of another unit raises it by one default of that
      line's unit and draws no new row.
- [ ] The add question draws every row with its amount now and after one default of its own
      unit, and the two "another unit" keys are gone from `en.json` and `es.json`.
- [ ] A product add refused with `line_unit_differs` draws the sentence for the line's unit,
      keeps the words and focus, and creates nothing; on a rename the old sentence is
      unchanged.
- [ ] The sentence clears on a keystroke, a submit and its cross, and never shows beside
      the voice strip.
- [ ] Every new key exists in `en` and `es`, with no number inside a key.
- [ ] `npx nx affected -t lint test` is green, `npx nx build velista` builds, and the e2e
      test of section 6 passes on a slot with backend `0260`.

## Not in this plan

- **A conversion between units** at an add or a merge (U2). Backend backlog `0024`.
- **The steps of a weight or a volume.** Velista `0186`.
- **The product page's plus on a line that exists.** Velista `0187`.
- **A unit on a free text line.** U1 closes it.
- **Marking the line a refused add met.** Decision G.

## Questions for the owner

1. Backend `0260` question 1, mirrored: typing the name of a weighed product line adds one
   kilo to it. Should a typed name be refused there instead, so that a free text add never
   means a kilo? Then every typed name would send `UNIT`, the question would list only
   `UNIT` lines, and the sentence of section 4 would reach typed names too.
2. Should a refused product add also mark the line of another unit on the list page, as
   velista `0170` marks a raised row for 2.5 s, so the person sees which line to step
   (decision G)?
3. "By weight" and "by volume" rather than "in kilos" and "in litres" (section 4): is that
   the wording you want, given that a line under a kilo reads in grams?
