# 0190: a shopping list row shows its amount and its sheet changes it

> Decided on 2026-11-11. The owner finds the reel "confusing for most users", and velista
> `0188` replaces it with a stepper with buttons on every screen. On the shopping list the
> owner went one step further: a row only shows its amount, in one plain cell of one size,
> with no minus and no plus. Pressing the amount opens the sheet with the amount details,
> "just like it does right now". The amount is changed in that sheet, with the typed
> control of velista `0188` (168 by 48), one per list that holds the row. The sheet changes
> a product with the swap icon in place of the word "Cambiar".
>
> Amends velista `0054` and `0073` (the row's number is a reel bound to what is still to
> get, and moving it down buys), velista `0139` section 3 and `0092` section 6 (each list's
> ask in the sheet is a reel), velista `0140` section 1 (Change is a word). Needs velista
> `0188` built first: this plan uses its `lib-quantity-stepper` at `variant="sheet-narrow"`,
> its `lib-amount-figure`, its `shortAmount` and `exactAmount`, and its `quantityRuns`, and
> specifies none of them. After this plan no reel exists in velista: the shopping list row and
> `row-entries` are the reel's last users, so this plan deletes it (section 7). Needs PRs #959,
> #960 and #961 in `dev`. Velista `0189` (the search field at the top, the progress bar removed) touches
> the same page and not the same lines; either can land first.
>
> Prerequisite reading: the decisions of 2026-11-10 and 2026-11-11, sections 1 and 3 as
> velista `0188` records them; velista `0188` in full; velista `0139` section 3 (the sheet's
> lists); velista `0140` section 1 (Change on an entry); velista `0092` section 6 (a demand
> is its own write); velista `0073` (the row's reel buys and takes back); velista `0170`
> target 4 (the `took` mark); the approved mock, `apps/velista/plans/mocks/stepper/index.html`,
> sections "Shopping list" and "Line sheet, from the shopping list".
>
> Code anchors, on `origin/feat/velista-0183-line-unit-chip` as of 2026-11-11, all under
> `libs/velista/feature-shopping-lists/src/lib/` unless the path says otherwise:
> `basket-row/basket-row.html:140` to `:145` (the body button, `(click)="onBody()"`),
> `:303` to `:313` (the cheaper mark's `lib-swap-icon` button), `:334` to `:398` (`.numbers`:
> the `settled-count` span, `<lib-quantity-reel>` with `(committedTo)`, `(preview)`,
> `(autoClosed)` and `[took]`, the `.preview` and `.progress` captions, the busy text);
> `basket-row/basket-row.ts:219` (`QuantityReel` in `imports`), `:427` (`open`), `:492`
> (`left`), `:521` (`stillToGet`), `:544` to `:548` (`_sent`, `shownOutstanding`), `:558`
> (`ceiling`), `:575` (`reelLabel`), `:589` to `:606` (`_preview`, `caption`), `:608`
> (`_reel`), `:617` (`_deafUntil`), `:689` to `:732` (`onReelAutoClosed`, `onPreview`,
> `onCommitted`, `onBody`), `:850` (`showsReel`), `:1134` (`progressCaption`), `:1178`
> (`label`); `basket-row/basket-row.scss:428` (`.numbers`), `:443` (`.settled-count`),
> `:458` (`.preview`, `.progress`); `basket-page/basket-page.html:279` and `:663`
> (`(left)="setRowLeft(row, $event)"`), `:280` and `:664` (`(open)="openRow(row.row)"`),
> `:707` (the page's polite region `outstandingSaid`); `basket-page/basket-page.ts:113`
> (imports `outstandingCaption`), `:1273` (`openRow`, which navigates to
> `sheetSegments('rows', row.rowKey, 'settle')`), `:1431` to `:1480` (`setRowLeft`,
> `_writeRowLeft`), `:1559` (`_reportLeft`); `libs/velista/feature-shell/src/lib/routes.ts:352`
> (`rows/:rowKey/settle`, the `SettleSheet`); `settle-sheet/settle-sheet.html:139` to `:153`
> (`<lib-row-entries>` with `(demanded)` and `(raised)`), `:180` to `:215` (the settle
> targets); `settle-sheet/settle-sheet.ts:125` to `:130` (the class comment that still names a
> "got" reel), `:803` (`raise`), `:860` (`settleAll`), `:1315` (`demand`), `:1397` (`close`),
> `:1653` (`_run`); `row-entries/row-entries.html:9` (the section is `aria-live="polite"`
> `role="status"`), `:34` to `:44` (Change, a word: `'basket.change.one' | rokuT`), `:46` to
> `:67` (the ask reel, or the number), `:111` to `:119` (the reel of a list that does not
> ask); `row-entries/row-entries.ts:22` (`QuantityReel`), `:109` (`wordsOf`), `:141`
> (`demanded`), `:148` (`raised`), `:217` (`onAsked`), `:226` (`onRaised`), `:235`
> (`_mayDemand`); `row-entries/row-entries.scss:79` (`.ask-reel`), `:111` (`.change`),
> `:137` (`.row-number`); `basket-labels.ts:271` (`quantityCaption`), `:447`
> (`outstandingCaption`); `libs/velista/data-access/src/lib/baskets/basket-store.ts:1170`
> (`setLeft`), `:1267` (`setDemand`); `libs/velista/ui/src/lib/icons/icons.ts:1125` to
> `:1138` (`SwapIcon`, "Two arrows passing each other", which already exists);
> `libs/velista/ui/assets/i18n/es.json` and `en.json` `:1655` and `:1658`
> (`basket.outstanding.label`, `listLabel`), `:1991` (`basket.demand.askLabel`), `:2087`
> and `:2088` (`basket.change.one`, `oneLabel`); `apps/velista-luna-e2e/src/support/app.ts:102`
> (`reel`), `:110` (`nudge`), `:150` (`openSettleSheet`), `:164` (`askReel`).
>
> Read "Angular conventions" in `CLAUDE.md` before any code, and load `design-taste-frontend`
> and `antislop` before the template, the styles or the copy.

## Brief for the agent

### Objective

On the shopping list (the basket page), replace each row's reel with one plain amount cell
that is a button opening the row's settle sheet. In that sheet, replace each list's reel with
`lib-quantity-stepper` of velista `0188` at `variant="sheet-narrow"`, save its changes after
the presses stop, and replace the word "Cambiar" on each list's row with the swap icon. Then
delete the reel, which has no user left.

### Context

- Velista `0188` builds the stepper (its look, its step, its hold, its typed field, its short
  and exact forms). This plan only consumes it, by the names `0188` sections 2 to 4 give:
  - the read only cell is `lib-amount-figure` (`AmountFigure`, inputs `quantity`, `unit`,
    `form` (`'short'` or `'exact'`) and `speak`), exported from `@portfolio/velista/ui`;
  - the sheet's typed control is `lib-quantity-stepper` with `variant="sheet-narrow"`, 168 by
    48 (48 + 72 + 48), with `value`, `unit`, `name`, `disabled`, `readonly` and the outputs
    `valueChange` and `stepped` (a `QuantityStep`: `from`, `to`, `repeat`);
  - the formatters are `shortAmount` and `exactAmount` from `@portfolio/velista/platform`,
    each answering `AmountWords` (`figure`, `symbol`, `long`, `spoken`);
  - the wait before a save is `QUANTITY_STEP_QUIET_MS` (800 ms), and the helper that holds it
    is `quantityRuns` from `@portfolio/velista/platform`;
  - the stepper says the amount once when the presses stop (`0188` decision E), so this plan
    adds no announcement of its own.
- Velista `0188` also takes the typeahead's held lines on this page (`basket-page.ts`
  `changeHolding`, a `quantityRuns` that writes `setDemand`, `0188` section 5.6). They are
  not this plan's.
- Today a row's number is `<lib-quantity-reel>` bound to what is still to get
  (`basket-row.html:354`). Moving it down records a buy and up takes one back, through
  `BasketPage.setRowLeft` and `BasketStore.setLeft` (`basket-page.ts:1431`,
  `basket-store.ts:1170`). A press on the words opens the settle sheet (`onBody`,
  `basket-row.ts:718`, emits `open`; `openRow`, `basket-page.ts:1273`). The settle sheet is
  the sheet "with the amount details": its `RowEntries` draws one row per list that asks,
  each with an ask reel that sends `BasketStore.setDemand` on release
  (`settle-sheet.ts:1315`).
- `SwapIcon` exists in `libs/velista/ui/src/lib/icons/icons.ts:1125`, and the row already
  draws it for the cheaper mark (`basket-row.html:311`). No new icon is needed.
- The row's reel is today the only way to buy part of a row. The sheet has "Ya lo tengo
  todo", "No había" and "Hoy no", and no "got some" (`settle-sheet.html:180` to `:215`;
  `apps/velista-luna-e2e/src/guest.spec.ts:93` says so in a comment). Question 1 asks the
  owner about this before the build.

### Target state

1. A basket row draws, at its trailing edge, one amount cell, 59 by 48 CSS px, the same size
   on every row, no fill and no border, centred: the number over its unit symbol, in the
   short form, drawn by `lib-amount-figure`. It is a `<button>` that opens the row's settle
   sheet, the same navigation as the body.
2. The row has no reel, no minus, no plus, no preview caption and no progress caption under
   the number. Its text column gets the width the reel used (195 px against 111 in the mock
   at 390 px).
3. In the settle sheet each list that holds the row and whose ask the reader may change draws
   `lib-quantity-stepper variant="sheet-narrow"`, 168 by 48. Its steps and typed values are
   saved `QUANTITY_STEP_QUIET_MS` after the presses stop, by `SettleSheet` through
   `quantityRuns`, with `BasketStore.setDemand`.
4. Each list's row in the sheet changes its product with a 44 by 44 button that draws
   `SwapIcon` and no word, named "Cambiar el producto en <list>".
5. No reel is left in velista: its component, its gesture, its export, its constants and
   `stepsFrom` are deleted (section 7).

### Scope

- Work in `libs/velista/feature-shopping-lists` (`basket-row`, `basket-page`, `settle-sheet`,
  `row-entries`, `basket-labels.ts`), `libs/velista/ui/assets/i18n/en.json` and `es.json`,
  `apps/velista-luna-e2e`, and the reel's deletion of section 7 (in `libs/velista/ui`,
  `libs/velista/models` and `basket-row.ts`).
- Do NOT touch the stepper component, its formatters, `quantityRuns` or its styles (velista
  `0188`), the typeahead's held lines on the basket page (`changeHolding`, velista `0188`
  section 5.6), the search field or the progress bar (velista `0189`), the add rules
  (velista `0185`, backend `0260`), the deletion of a line at zero (backend `0263`, velista
  `0192`), the list page, the line row, the list's line sheet, or any backend project.

### Constraints

- The amount is never typed or focused as a field on the basket page. Only the settle sheet
  takes a typed amount.
- The component emits on every step; the save waits in `SettleSheet` (section 4). No write
  per step.
- Every amount drawn on the row uses `shortAmount`, every amount in the sheet `exactAmount`,
  both from `@portfolio/velista/platform`. No local formatter.
- No announcement of an amount is added: the stepper says it once (`0188` decision E).
- Copy through RokuTranslator keys in `en` and `es`. No dashes as punctuation in copy or
  comments.
- Zoneless, `OnPush`, signals, `input()` and `output()`, as the files already are.

### Action boundaries

- Proceed with sections 1 to 8 once velista `0188` and PRs #959 to #961 are in `dev` and the
  owner has answered question 1 in this file.
- Stop and ask if question 1 has no answer here: removing the row's reel removes the only
  way to buy part of a row, and the build must not decide that alone.
- Stop and ask if velista `0188` is not in `dev`: this plan builds on `lib-amount-figure`,
  `lib-quantity-stepper` at `sheet-narrow`, `shortAmount`, `exactAmount`, `quantityRuns` and
  `QUANTITY_STEP_QUIET_MS`, and specifies none of them.
- The deletions of section 7 are named by this plan: delete those files, the export, the
  constants, `stepsFrom` and their specs without stopping. The reel is replaced by the
  owner's decision of 2026-11-10 (velista `0188`). Before each deletion, search the
  workspace; if a user that section 7 does not name is found, stop and ask.
- Stop and ask before deleting a file this plan does not name, before adding a dependency,
  and before removing `BasketStore.setLeft` (decision F keeps it).
- Stop and ask before any change that alters behaviour this plan does not settle.

### Progress evidence

Each criterion of section 9 with its spec output, `npx nx build velista`, and a walk on a
slot at 390 by 844: screenshots of the basket with eight rows (compare the mock's "Amount in
one fixed cell"), the measured width of a row's text column, the settle sheet of a row two
lists ask for (compare "D3 Outline"), a step that saves once after the presses stop (one
`PATCH` in the network log for three presses), and Tab through one row.

## 0. Decisions

### The owner's, 2026-11-11, fixed

- **A row only shows its amount.** No minus, no plus. One plain cell of one size in every
  row: 59 by 48, the number over its unit, no fill and no border, centred. The row's text
  gets 195 px where it gets 111 today.
- **Pressing the amount opens the sheet with the amount details, "just like it does right
  now".** The cell is a button whose press opens the row's sheet. It is not a typed field.
- **The amount is changed in the sheet**, with the typed control of velista `0188` at 168 by
  48, one per list that holds the row.
- **The sheet changes a product with a swap icon** (two arrows) in place of the word
  "Cambiar". A 44 by 44 target, named "Cambiar el producto en <list>".
- **Saving is not the component's job.** "It will be done from outside the component, by the
  logic layer in a feature library."
- **A screen reader hears the amount once when the presses stop**, not on every step.

### The writer's, open to the owner

- **A. The sheet that opens is the settle sheet.** "The sheet with the amount details" today
  is `SettleSheet` at `sheet/rows/:rowKey/settle` (`basket-page.ts:1273`,
  `routes.ts:352`), which the body already opens. The cell emits the row's existing `open`
  output, so both presses reach `openRow` and one route.
- **B. The cell shows what is still to get, and a finished row shows what was asked.** The
  reel showed `stillToGet` (`basket-row.ts:521`), the entry's `left` under a list heading.
  The cell keeps that on a wanted, partly settled or skipped row. On `DONE` and
  `NOT_AVAILABLE` it shows `asked` (the entry's under a heading), because a tick beside "0"
  says nothing and the mock shows only wanted rows. The glyph at the leading edge already
  says the state.
- **C. The progress caption under the number goes, and stays in the row's name.** "2 of 6"
  and "250 g of 1 kg" were drawn under the reel (`basket-row.html:381` to `:393`). The cell
  has room for nothing under it at 48 px. The half circle glyph says "partly", the body's
  accessible name keeps `progressCaption` (`basket-row.ts:1187`), and the sheet's
  `gotToday` line says what was got. `quantityCaption` stays in `basket-labels.ts` for that
  name.
- **D. The cell is a real button in the tab order.** Its name is "Cantidad de <name>:
  <amount>", with the amount in the exact form (a screen reader is told "1,275 kg", not the
  rounded "1,28 kg"). Under a list heading the list leads: "<list>, cantidad de <name>:
  <amount>". Enter and Space open the sheet, as on any button. The row's tab stops stay
  three or four: status, body, the cheaper mark's swap when drawn, then the cell where the
  reel was. A second control with the same press is kept on purpose: it is the one the owner
  named, and a person who reaches for the number expects to land on it. `aria-haspopup` is
  not set, as the body sets none.
- **E. The cell is the same on a finished trip.** The body still opens the sheet there
  (`basket-row.ts:369`, "The row still opens the sheet"), so the cell does too; the sheet
  already draws no control on a finished trip. A crossed out row draws no cell, as it drew no
  reel.
- **F. `BasketStore.setLeft` stays, with no caller.** It is the write a partial buy needs. If
  the owner answers question 1 with a "got some" amount in the sheet, it is the write that
  amount uses. `BasketPage.setRowLeft`, `_writeRowLeft`, `_reportLeft` and the row's `left`
  output go.
- **G. The wait is in `SettleSheet`, per line.** The sheet is the logic layer of this
  feature for the amount, as it already owns `demand` and `raise`. `RowEntries` stays a
  drawing component that emits every step.
- **H. The lists that do not ask yet get the same typed variant.** "Add it to another list"
  (`row-entries.html:72` to `:132`) draws a reel per list today, and velista `0188` takes the
  reel off every screen. They are in the same sheet and the same column, so they take the
  same control at 168 by 48, starting at 0. Their first saved step adds the line or raises it,
  as `raise` does today (`settle-sheet.ts:803`).
- **I. A number that cannot be changed is drawn in the exact form, in the same 168 px
  column.** An unserved list or a demand the server does not allow (`_mayDemand`,
  `row-entries.ts:235`) keeps a number with no control. It is end aligned in a box of the
  control's width, so the numbers of one sheet line up with the controls above them.
- **J. A settle button sends the waiting changes first.** "Ya lo tengo todo (1,25 kg)" names
  the amount still to get. A person who steps 750 to 1000 and presses it at once must buy
  what the sheet now shows. So `settleAll`, `settleNone` and `skip` first send every waiting
  save and wait for it; a refused save stops the settle and shows its sentence.

## 1. The row

`basket-row.html`:

- Replace the whole `<span class="numbers">` block (`:334` to `:398`) with:
  - `@if (!crossed())` is already the outer branch, so inside it: a
    `<button type="button" class="amount" (click)="onAmount()" [attr.aria-label]="amountLabel()">`
    holding `<lib-amount-figure [quantity]="shownAmount()" [unit]="unit()" form="short"
    [speak]="false" />`. `speak` is off because the button's name says the amount; the
    figure is `aria-hidden` by itself (`0188` section 3.1).
  - `[class.took]="took()"` on the button, so the mark of velista `0170` target 4 stays
    (`basket-row.ts:348`). Copy the edge rule the reel draws for `took` from the reel's
    stylesheet into `.amount.took`; do not import the reel's styles.
  - The busy text (`:395` to `:397`) moves after the button, unchanged.
- Remove the `.preview` and `.progress` spans and the comments that describe the reel, the
  gesture and the caption under the thumb (`:315` to `:333`, `:336` to `:349`, `:370` to
  `:394`). Write one comment above the button that says what it is: the amount, short form,
  a press opens the settle sheet (velista `0190`, decisions A and D).
- Keep the `notice` paragraph (`:411` to `:413`): the status control's refusals still use
  it (`basket-page.ts:1579`).

`basket-row.ts`:

- Remove `QuantityReel` from `imports` and its import, the `left` output (`:483` to `:492`),
  `_sent` and `shownOutstanding` (`:533` to `:548`), `ceiling` (`:550` to `:560`), `_preview`
  and `caption` (`:588` to `:606`), `_reel` (`:608`), `_deafUntil` (`:610` to `:617`),
  `onReelAutoClosed`, `onPreview` and `onCommitted` (`:689` to `:708`), `showsReel`
  (`:835` to `:852`), `reelLabel` (`:562` to `:586`) and the import of
  `outstandingCaption`. `_holdIfRemote` (`:679` to `:687`) keeps its 250 ms shield for the
  status control, under the new name `STATUS_FLIP_SHIELD_MS` (section 7).
- `onBody` (`:718`) loses its reel branch and its deaf window and only emits `open`.
- New `onAmount()` emits `open`.
- New `shownAmount = computed(...)`: `asked` (the entry's, else the row's) when `state()` is
  `DONE` or `NOT_AVAILABLE`, else `stillToGet()` (decision B).
- New `amountLabel = computed(...)`: `basket.amount.label` or, under a list heading with a
  named list, `basket.amount.listLabel`, with `name`, `list` and `amount` the `spoken` of
  `exactAmount`.
- Rewrite the class comment's "The number is the control" section (`:169` to `:185`): the
  number is an amount cell that opens the sheet, and buying part of a row is whatever
  question 1 decides. Rewrite the `finished` input's comment (`:358` to `:363`), which says
  the reel goes back to a readout.

`basket-row.scss`:

- Replace `.numbers`, `.settled-count`, `.preview` and `.progress` (`:425` to `:470`) with
  `.amount`: `flex: none`, `inline-size: var(--app-stepper-cell-row)` (59 px) and
  `block-size: var(--app-stepper-button)` (48 px), the tokens of `0188` section 3.2,
  `display: flex`, centred both ways, no border, transparent background, no padding, the
  focus ring of `.body` (`:160`), `cursor: pointer`. The number and symbol sizes and colours
  are `lib-amount-figure`'s own; the row sets none.
- The row keeps `align-items: flex-start` (`:13`). The cell sits at the top of the row
  beside the name line, as in the mock.
- `.row:has(.body:hover)` (`:168`) also matches `.amount:hover`, so the row lights the same
  way from either press.

## 2. The page

`basket-page.html`: remove `(left)="setRowLeft(row, $event)"` at `:279` and `:663`. Nothing
else in the template changes.

`basket-page.ts`: remove `setRowLeft`, `_writeRowLeft` and `_reportLeft` (`:1416` to
`:1480`, `:1549` to `:1569`) and the import of `outstandingCaption` (`:113`). `_notice`,
`noticeFor`, `_reportSettle` and `outstandingSaid` stay; the status control and the sheets
still use them.

`basket-labels.ts`: remove `outstandingCaption` (`:420` to the end of the function) once
nothing imports it. Keep `quantityCaption` (decision C).

## 3. The sheet's lists

`row-entries.html`:

- Remove `aria-live="polite"` and `role="status"` from the section (`:9`): with a control
  that changes its value on every step, the region would read each step. The stepper says the
  amount once by itself (section 5).
- Change (`:34` to `:44`): the button keeps its place before the amount, keeps
  `[attr.aria-label]="entry.changeLabel"`, and draws `<lib-swap-icon class="change-glyph" />`
  in place of `{{ 'basket.change.one' | rokuT }}`.
- The ask reel (`:47` to `:55`): `<lib-quantity-stepper variant="sheet-narrow">` with
  `[value]="entry.asks"` (the sheet passes `runs.shown(lineId, asks)`), `[unit]="unit()"`,
  `[name]="entry.label"`, `[disabled]="busy()"`, and `(stepped)` bound to
  `onAsked(entry.lineId, $event)`.
- The number with no control (`:57` to `:66`): `<lib-amount-figure form="exact">` in place of
  `wordsOf`, in a span of class `row-number` (decision I).
- The reel of a list that does not ask (`:111` to `:119`): the same stepper at value
  `other.list.quantity ?? 0`, `(stepped)` bound to `onRaised(other.list, $event)`
  (decision H).

`row-entries.ts`:

- Swap `QuantityReel` for `QuantityStepper` and `AmountFigure` and add `SwapIcon` to
  `imports`.
- `demanded` becomes `{ lineId; step: QuantityStep }` and is emitted on every step:
  `onAsked` passes the stepper's `QuantityStep` through. The waiting and the first `from` of
  a run are the sheet's `quantityRuns` (section 4).
- `raised` becomes `{ list; step: QuantityStep }` and is emitted on every step.
- `wordsOf` goes; any text that still needs the words reads `exactAmount(...).spoken`.
- Rewrite the class comment's "The quantity is the reel the list page uses" and "Change"
  sections to say: the typed control of `0188`, one per list that holds the row; Change is
  the swap icon.

`row-entries.scss`:

- `.ask-reel` stays `flex: none`, renamed `.ask-amount`. The stepper sizes itself at 168 px
  (`0188` section 3.2); the class sets no width.
- `.change`: `inline-size` and `block-size` `var(--app-touch-target)` (44 px), padding 0,
  `display: flex`, centred; the border, radius and raised surface it has stay, as the mock
  draws them. New `.change-glyph` at the size `.change-product-glyph` uses on the row
  (`basket-row.scss:363`).
- `.row-number`: `inline-size` 168 px, `text-align: end`.

## 4. The save, in `SettleSheet`

- `SettleSheet` builds two runs in its field initializers (an injection context):
  `demandRuns = quantityRuns<string>((lineId, run) => this.demand(lineId, run))` keyed by
  line id, and `raiseRuns = quantityRuns<string>((listId, run) => this.raise(listId, run))`
  keyed by list id, both from `@portfolio/velista/platform` with the default wait,
  `QUANTITY_STEP_QUIET_MS` (800 ms). No wait constant and no run class are written here.
  `(demanded)` calls `demandRuns.step(lineId, step)`, `(raised)` calls `raiseRuns.step`.
  The sheet passes `demandRuns.shown(lineId, asks)` to each control, so the drawn amount is
  the run's while it is open.
- A typed value committed by Enter or blur is a step with `repeat: false` like a press, and
  the sheet calls `flush(key)` right after it, so a typed amount is sent at once; only
  presses wait.
- One write per line at a time, in the sheet. It keeps a map of the write in flight per key
  (a promise). A run that `quantityRuns` sends while a write of the same key is out waits
  for that write, then sends with `from` equal to the line's asks after the answer.
- The sheet's `flushAll()` calls `flush` for every key in `demandRuns.pending()` and
  `raiseRuns.pending()`, then returns a promise of every write in flight.
- `SettleSheet.demand` (`:1315`) becomes the callback: it keeps its three endings (stays
  open, the row left the basket and the page is handed `basket.demand.nothingLeft`, refused
  with the store's re-read count). It no longer sets `_settling` for the whole sheet: the
  stepper of the line stays live while its save is out. The settle targets read a new
  `saving` signal (true while any run waits or any demand write is out) beside `busy()`.
- `SettleSheet.raise` (`:803`) is the `send` of `raiseRuns` and keeps its two writes
  (`addLine` for a list with no line, `setDemand` for one at zero). A run that ends at 0
  sends nothing.
- `settleAll`, `settleNone` and `skip` call `flushAll()` and await it first (decision J). If
  a save was refused they stop, and its sentence is drawn.
- `close()` (`:1397`) calls `flushAll()` without awaiting it and closes: nothing a person
  stepped is dropped. `quantityRuns` also flushes on destroy and on a hidden page. A refusal after the sheet closed shows on the row through the store's
  re-read, as a refused write does today.
- Rewrite the class comment (`:125` to `:130`), which names a "got" reel that no longer
  exists, and the comment of `demand` (`:1295` to `:1314`), which says the reel commits on
  release.

## 5. What a screen reader and the keyboard meet

- **On the row.** The cell is a button: Tab reaches it after the body (and the cheaper mark's
  swap when drawn), Enter and Space open the sheet, and it is announced as "Cantidad de
  Plátano de Canarias IGP: 1,25 kg, botón" (decision D). The drawn number is hidden from the
  accessibility tree, so it is not read twice. Nothing on the row announces by itself.
- **In the sheet.** Each list's control is the `spinbutton` of `lib-quantity-stepper`
  (`0188` section 3.5), its `name` the existing `basket.demand.askLabel` ("Compra semanal,
  pide"), with its value text, Arrow Up and Down, Home and End as `0188` defines them. A
  focused spinbutton's value is announced by the screen reader as it changes. For steps made
  with the minus and plus buttons the stepper says the amount once when the presses stop
  (`0188` decision E). The sheet adds no live region and no sentence of its own.
- **Swap.** A button with no visible word, named `basket.change.oneLabel` ("Cambiar el
  producto en Compra semanal"), 44 by 44, in the tab order before the list's control.

## 6. Copy

| key | `en` | `es` |
| --- | --- | --- |
| `basket.amount.label` (new) | Amount of {{name}}: {{amount}} | Cantidad de {{name}}: {{amount}} |
| `basket.amount.listLabel` (new) | {{list}}, amount of {{name}}: {{amount}} | {{list}}, cantidad de {{name}}: {{amount}} |
| `basket.change.oneLabel` (changed) | Change the product on {{name}} | Cambiar el producto en {{name}} |

Remove `basket.change.one`, `basket.outstanding.label`, `basket.outstanding.listLabel`,
`basket.outstanding.bought`, `basket.outstanding.boughtAmount`, `basket.line.takenBack` and
`basket.line.takenBackAmount` from both files after a search finds no other user of each.
Keep any key that is still read.

## 7. Deleting the reel

The owner replaced the reel with the stepper on 2026-11-10 (velista `0188`). Once `0188` is
built, the shopping list row (`basket-row`) and `row-entries` are the reel's last users
(`0188` section 6), so after sections 1 and 3 nothing renders it. This plan deletes it.
Checked on `feat/velista-0183-line-unit-chip` on 2026-11-11; the builder searches again
before each deletion (Action boundaries).

| File, export or symbol | Users once `0188` and this plan are built | What happens |
| --- | --- | --- |
| `libs/velista/ui/src/lib/list/quantity-reel.ts`, `.html`, `.scss`, `.spec.ts` | none | Deleted |
| `libs/velista/ui/src/lib/list/quantity-reel-gesture.ts`, `.spec.ts` | the reel only | Deleted |
| `libs/velista/ui/src/index.ts:86` (`export * from './lib/list/quantity-reel'`) | none | Removed |
| `QUANTITY_REEL_PX_PER_UNIT`, `QUANTITY_REEL_PAGE_STEP`, `QUANTITY_REEL_TAP_SLOP_PX`, `QUANTITY_REEL_TAP_MAX_MS` (`libs/velista/models/src/lib/limits.ts:163`, `:177`, `:188`, `:197`) | the reel and its gesture only | Removed with their comments |
| `QUANTITY_REEL_IDLE_MS` (`limits.ts:174`) | the reel and the basket specs; `0188` moves `DUE_LINE_STEP_QUIET_MS` (`due-lines.ts:68`) and `line-row.spec.ts` off it | Removed; each basket spec that read it advances `QUANTITY_STEP_QUIET_MS` instead |
| `QUANTITY_REEL_CLICK_SHIELD_MS` (`limits.ts:210`) | `basket-row.ts:23`, `:685` (`_holdIfRemote`, the status control's shield after another person's flip) and `:690` (`onReelAutoClosed`, removed in section 1) | Kept, renamed `STATUS_FLIP_SHIELD_MS`, value 250 unchanged. Its comment is rewritten: how long the status control ignores a press after another person flipped the row, so a press aimed at the old state does not undo theirs. It no longer speaks of a reel |
| `stepsFrom` (`libs/velista/models/src/lib/line-unit.ts:179`) and its describe in `line-unit.spec.ts:144` | the reel only (`quantity-reel.ts:771`) | Removed |
| `basket-labels.ts:426` comment on the row's reel | goes with `outstandingCaption` (section 2) | Removed |

`TOOK_DURATION_MS` is not this plan's: `0188` moves it to `quantity-stepper.ts`.

## 8. Specs and e2e

Unit specs (`npx nx test velista-feature-shopping-lists`, the builder confirms the project
name):

- `basket-row.spec.ts`: delete the describes "the number as a control" (`:539`) and "the tap
  and the gesture stay apart" (`:672`), and the test "turns the reel back into the number it
  was before plan 0054" (`:434`). Add: the cell is a button that emits `open`; it draws the
  short form of `stillToGet` on a wanted and a partly settled row and of `asked` on a `DONE`
  and a `NOT_AVAILABLE` row; its name is `basket.amount.label` with the exact form, and
  `basket.amount.listLabel` under a list heading; it carries `took`; it is drawn on a
  finished trip; a crossed out row draws none; no `lib-quantity-reel` and no `.progress`
  anywhere; the body's name still holds the progress caption on a partly settled row; the
  cell is 59 by 48 on a row with a four letter unit (layout asserted through the computed
  style of `.amount`). The test at `:310` that asserts no reel on a removed row asserts no
  `.amount`.
- `basket-row-price.spec.ts`, `basket-row-shop-price.spec.ts`, `basket-row-swap.spec.ts`:
  replace any query of the reel with `.amount`; nothing else changes.
- `basket-page.spec.ts`: delete the describe "the number on a row" (`:1209`) and the test
  "holds the reel when it buys, and never when it takes units back" (`:5335`). Add: a press
  on a row's `.amount` navigates to `sheet/rows/<rowKey>/settle` with the kept search query,
  as the body does.
- `row-entries.spec.ts`: the describe "who may change what a list asks for" (`:293`) asserts
  `lib-quantity-stepper` where it asserted the reel; "sends one demand" (`:368`) asserts one
  `demanded` per step; "raises a list" (`:466`) asserts `raised` per step; Change (`:229`)
  asserts a button with `lib-swap-icon`, no text, and the name `basket.change.oneLabel`; the
  section has no `aria-live`.
- `settle-sheet.spec.ts`, with Jest fake timers: the tests at `:1140`, `:1154` and `:1164`
  step the control and advance `QUANTITY_STEP_QUIET_MS` before they expect `setDemand`;
  `:948` and `:1255` assert no control on a finished trip; `:2461` asserts the control where
  `demandEditable` is true. Add: three presses send one `setDemand` with the first `from` and
  the last `to`; a run back to its start sends nothing; a typed amount sends at once; a run
  that ends while a write of the line is out sends after it, with the answer's `from`; "Ya lo
  tengo todo" pressed during a wait sends the demand first and settles after it; a refused
  demand stops the settle; closing during a wait still sends. `quantityRuns` itself is
  `0188`'s and its spec is not repeated here.
- The specs of section 7 go with their files: `quantity-reel.spec.ts`,
  `quantity-reel-gesture.spec.ts`, and the `stepsFrom` describe of `line-unit.spec.ts`.

`apps/velista-luna-e2e` is this plan's to change: the helpers in `support/app.ts` and the
basket specs `shop`, `guest`, `member` and `sync` (`0188` section 7 leaves them here). The
helpers first, then the steps; every step below depends on question 1, and the text says the
version for "no partial buy from the row":

- `support/app.ts`: `reel` (`:102`) is renamed `amountField` (the sheet's spinbutton by its
  label) and its comment says "the typed amount of a sheet's stepper". `nudge` (`:110`) is
  renamed `stepAmount`, keeps its Arrow keys and its blur, and waits for the save (it polls
  the API, since a run of arrow steps is sent `QUANTITY_STEP_QUIET_MS` after the last one).
  `askReel` (`:164`) is renamed `askAmount` and finds the stepper's spinbutton by the same
  label. New `amountCell(row)`: `row.getByRole('button', { name: /^Amount of / })`. No
  helper name or comment left in the file says "reel".
- `stepper-fit.spec.ts` (written by `0188`): add the `sheet-narrow` variant, on a settle
  sheet of the slot, to the variants whose figure and symbol must not overflow.
- `shop.spec.ts` step 6 (`:233`): keep the sheet assertions; `askAmount(dialog, 'Groceries')`
  has `aria-valuenow` 2. Drop "Part of a row is bought with the row's own reel" and assert
  instead that `amountCell(row(page, 'Milk'))` reads "2" and opens the settle sheet.
- `shop.spec.ts` step 7 (`:266`): settle Milk with its status control ("Mark Milk as got"),
  then revert it with "Milk is got. Undo it", and the zone line asks for 2 again through the
  API. Plan 0073 test 13 (a raise walks settlements back) has no gesture left and is dropped
  with a comment naming this plan.
- `shop.spec.ts` the weighted describe (`:407`): the row's cell reads "1" over "kg"; in the
  sheet, type "750" into Groceries' field and press Enter; the cell reads "750" over "g";
  over the API the line is `GRAM` 750 and has no settlement. The title becomes "is added at a
  kilo and typed down to 750 g in the sheet".
- `guest.spec.ts` step 3 (`:92`): the guest buys Milk with its status control, and Alice sees
  it bought without a reload (`.touched` names Guest 1). The title says "buys Milk".
- `sync.spec.ts` (`:66`): `amountCell(row(page, 'Eggs'))` has the name "Amount of Eggs: 11".
- `member.spec.ts` (`:208`): `askAmount` in place of `reel`; (`:312`) asserts no
  `amountCell` on the crossed out row, in place of `lib-quantity-reel`.
- Every other call of `reel`, `nudge` or `askReel` in the four specs takes the new name.

## 9. Acceptance criteria

- [ ] No reel exists in velista: a search of `libs` and `apps` finds no `lib-quantity-reel`,
      `QuantityReel`, `quantity-reel`, `QUANTITY_REEL_` or `stepsFrom`, and the files of
      section 7 are gone.
- [ ] `STATUS_FLIP_SHIELD_MS` is 250 and `_holdIfRemote` reads it.
- [ ] Every basket row that is not crossed out draws one `.amount` button of 59 by 48, the
      short form number over its unit, and a press on it opens `sheet/rows/<rowKey>/settle`.
- [ ] The row's text column measures 195 px at 390 px in the walk, or the measured number is
      recorded with the reason it differs.
- [ ] The cell's accessible name carries the exact form, and it sits in the tab order after
      the body.
- [ ] In the settle sheet each list that may change its ask draws `lib-quantity-stepper` at
      `sheet-narrow`, 168 by 48, and three presses send one `setDemand`
      `QUANTITY_STEP_QUIET_MS` after the presses stop.
- [ ] A settle button pressed during a wait settles after the waiting demand lands.
- [ ] Each list's Change is a 44 by 44 swap icon with no word, named "Cambiar el producto en
      <list>".
- [ ] The keys of section 6 exist in `en` and `es`, and the removed keys have no reader.
- [ ] `npx nx affected -t lint test` is green, `npx nx build velista` builds, and the e2e
      steps of section 8 pass on a slot.

## Not in this plan

- **The stepper itself**, its look, its step, its hold, its typed field, its formatters and
  `quantityRuns`. Velista `0188`.
- **The typeahead's held lines on the shopping list page** (`changeHolding`). Velista `0188`
  section 5.6.
- **The search field at the top and the removal of the progress bar.** Velista `0189`.
- **The amount a new line starts at, and an add onto a line that exists.** Velista `0185`,
  backend `0260`.
- **Deleting a line that reaches 0 with nothing to keep.** Backend `0263`, velista `0192`.
  The sheet's "the row left the basket" ending stays as it is.
- **A way to buy part of a row.** Question 1.
- **The list page's rows and the list's line sheet.** Velista `0188` and `0191`.

## Questions for the owner

1. **The row's reel is today the only way to buy part of a row.** Moving it from 6 to 4
   records "got 2" with who got it and at which shop, and the other 4 stay wanted (velista
   `0073`). The sheet has "Ya lo tengo todo", "No había" and "Hoy no", and no "got some".
   With the reel gone, a person who finds 2 of 6 can only lower what the list asks for
   (which records no buy and no price) or buy all 6. Is that what you want, or should the
   sheet gain a "got" amount beside the lists (a second plan, using `BasketStore.setLeft`,
   which this plan keeps)? The build waits for this answer.

   Answered by the owner on 2026-11-11: build as written. No partial buy from the row for
   now: a person lowers what the list asks for, or buys all. `BasketStore.setLeft` stays
   with no caller (decision F), and a "got some" amount in the sheet is a later plan.
2. On a bought or "No había" row the cell shows what was asked, not 0 (decision B). Is that
   the number you want there?
3. The cell is a second button beside the row's text, both opening the same sheet, so a
   keyboard or screen reader user meets one more stop per row than the text alone would give
   (the same count as today, where the reel was that stop). Keep it, or make the cell a
   pointer target only and leave the text as the one stop?
4. The lists that do not ask yet, under "Añadir a otra lista", get the same typed control
   starting at 0 (decision H). Is that right, or should they keep a single "Añadir" action?
5. A step waits `QUANTITY_STEP_QUIET_MS`, 800 ms, after the last press before it is saved,
   the wait velista `0188` gives every surface. Is that the feel you want in the sheet too?
