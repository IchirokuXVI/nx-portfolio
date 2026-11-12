> **PR:** [#989](https://github.com/IchirokuXVI/nx-portfolio/pull/989)

# 0185: an add starts a line at one step, and a line already on the list is shown

> **Note of 2026-11-12**, from the owner's rulings on backend `0260` (PR #984). Backend `0263` is
> **withdrawn**: no write deletes a line because it reached 0. A line at 0 stays on its list,
> hidden outside a search, and only a delete from the line's sheet or page removes it. Every line
> at 0 is therefore a kept line, and an add that meets only lines at 0 raises one. A press of
> minus that reaches 0 draws the stepper's trash (velista `0188`); on a line the visit made, the
> catalog's own take back still deletes the line it made. Second: a product add lands on a line
> of **its own unit** when one holds the product, even when an earlier line of another unit
> holds it too, and is refused with `line_unit_differs` only when no line of its unit does. That
> refusal now carries its own server sentence; `code` and `details` are unchanged, so section 4
> stands. The sentences below that say otherwise are amended in place.

> **Amended on 2026-11-11** from the owner's decisions of 2026-11-10 and 2026-11-11 (section 0).
> The plan of 2026-11-09 sent a typed name as an open add that raised the line it met by one
> default of that line's unit (one kilo, one litre), and drew the duplicate question with what one
> default adds. That is replaced: an add that meets a line already on the list **adds nothing**,
> and the page shows that line, scrolled into view and marked for a moment, on the zone list and
> on the shopping list (A1). A chosen product is added at **one step of its unit**, 25 g, 25 ml or
> 1 piece (A2). The composer still has no quantity stepper (U3), and the refusal sentence for a
> product of another unit stays. This amendment also **adds the catalog tab's rule** (C1): a
> product already on the selected list has its round plus switched off, with real text under the
> card and a link that opens the list at that line. Decision C of 2026-11-09 ("the catalog's adds
> are unchanged") is replaced. The title changed with it; the file name is the old one.
>
> Amends velista `0182` (the composer's count multiplied by `defaultQuantity`, PR #960 builder
> decision 3), velista `0170` (the duplicate popover and the mark of a raised row) and velista
> `0134` (the catalog plus). Needs PRs #959, #960 and #961 merged into `dev`, and backend `0260`
> (amended the same day) on the gateway: it defines the answer `outcome: 'ALREADY_ON_LIST'` with
> `alreadyOnList`, the basket's `addOutcome`, and the refusal `line_unit_differs` with
> `details.line`.
>
> Other plans of this batch touch the same screens, and each can be built before or after this
> one: velista `0188` (the stepper with buttons, which replaces the reel that carries today's mark),
> velista `0189` (the search field at the top of a list, which moves the composer), velista `0187`
> (the product page's lists table), velista `0186` (the per product step), backend `0262` (the
> limit of 999 999). Velista `0192` and backend `0263` (a line with nothing to keep deleted at
> zero) were withdrawn on 2026-11-12. This plan names their surfaces only where they meet its
> own.
>
> Prerequisite reading: backend `0260` in full (its wire shape wins over sections 3 and 6 here);
> backend `0246` section 0 (W1, M8); velista `0170` targets 3 to 6 and its section 6; velista
> `0134` section 4 (the catalog plus, the lines under a card, the visit record); velista `0116`
> (the basket asks which list); plan `0032` section 8 (`?line=`); the approved mock
> `apps/velista/plans/mocks/stepper/index.html` (frame "catalog D3").
>
> Code anchors, on `origin/feat/velista-0183-line-unit-chip` as of 2026-11-11:
> `libs/velista/ui/src/lib/list/line-composer.ts:43` (the `QuantityStepper` import), `:49` to `:71`
> (`LineComposerSubmit`), `:291` (`quantity = signal(1)`), `:425` to `:445` (a chosen card and its
> unit), `:625` to `:629` (`clear` resets the count), `:725` to `:753` (`_send`, which multiplies by
> `defaultQuantity(unit)`); `line-composer.html:128` (`<lib-quantity-stepper>`);
> `libs/velista/models/src/lib/line-unit.ts:105` to `:107` (`defaultQuantity`, 1 or 1000);
> `libs/velista/models/src/lib/add-choice.ts:53` to `:69` (`AddChoiceRow`, `to: number | null`),
> `:86` to `:117` (`addChoiceRows`), `:139` to `:151` (`addMayMeetLine`);
> `libs/velista/models/src/lib/catalog-visit.ts:152` to `:159` (`visitFloor`), `:234` to `:242`
> (`AddTargetList`, which carries `zoneId`);
> `libs/velista/data-access/src/lib/lines/line-api.ts:123` to `:170` (`addLineResult`, which maps
> `merged`); `line-store.ts:576` to `:678` (`addLine`, the optimistic row, `_settleRaise`), `:689`
> to `:702` (`drawsBeforeAnswer`, true for every product add);
> `libs/velista/data-access/src/lib/baskets/basket-api.ts:444` to `:479` (the basket add);
> `libs/velista/data-access/src/lib/catalog/catalog-add-store.ts:312` to `:323` (`add`), `:391` to
> `:418` (`_drawAdd`), `:426` to `:505` (`_add`, `defaultQuantity` at `:435`);
> `libs/velista/feature-catalog/src/lib/row-adds.ts:30` to `:68` (`rowAdds`, shared by the catalog
> page and the product page's similar products);
> `libs/velista/ui/src/lib/catalog/product-row.ts:117` to `:129` (`ProductRowAdd`), `:548` to
> `:562` (the plus), `:580` to `:625` (the lines under a card, `catalog.held.title`);
> `libs/velista/feature-catalog/src/lib/catalog-page/catalog-page.ts:682` to `:684`, `:811` to
> `:817` (`addOf`), `:1063` to `:1073` (`addProduct`);
> `libs/velista/feature-catalog/src/lib/added-sheet/added-sheet.ts:147` to `:162` (how the catalog
> opens a list today: `appPath(locale, basePath, 'zones', zoneId, 'lists', listId)`);
> `libs/velista/platform/src/lib/route-params.ts:164` to `:172` (`lineQueryOf`, the `?line=`
> parameter); `libs/velista/feature-lists/src/lib/list-page/list-page.ts:520` to `:532`, `:1607`
> to `:1655` (a `?line=` row scrolled to the centre and marked for `MARK_DURATION_MS`, 4000,
> `:2713`), `:1843` to `:1973` (`add`, `_send`, the merged answer at `:1949`), `:2072` to `:2108`
> (`tookLine`, `_markTook`); `libs/velista/ui/src/lib/list/quantity-reel.ts:33`
> (`TOOK_DURATION_MS`, 2500);
> `libs/velista/feature-shopping-lists/src/lib/basket-page/basket-page.ts:2392` to `:2402`
> (`_markTook`, no scroll), `:2619` to `:2742` (`_addTo`, which detects a raise by a line it
> already showed); `basket-page.html:275` and `:684` area (the two row lists, rows tracked by
> `row.key`, no line id in the DOM);
> `libs/velista/feature-lists/src/lib/list-error-copy.ts:93` and
> `libs/velista/feature-shopping-lists/src/lib/basket-error-copy.ts:236` (both map
> `line_unit_differs` to the rename sentence); `libs/velista/ui/src/lib/icons/icons.ts:341`
> (`lib-info-icon`); `libs/velista/ui/assets/i18n/es.json:457` to `:473` (`catalog.add`,
> `catalog.held`, `catalog.adding`);
> `apps/velista-luna-e2e/src/shop.spec.ts:407` (the weighted `describe`),
> `apps/velista-luna-e2e/src/catalog.spec.ts:196` to `:248` (the plus, the line under the row, the
> take back) and `:281` to `:304` (the product page's table, by the litre).
>
> Read "Angular conventions" in `CLAUDE.md` before any code, and load `design-taste-frontend`
> and `antislop` before the template, the styles or the copy.

## Brief for the agent

### Objective

Take the quantity stepper out of the line composer; send a typed name with no amount and no
unit and a chosen product at one step of its unit; when the server answers that the add met a
line already on the list, add nothing, scroll that line into view and mark it on the zone list
and on the shopping list; keep the one sentence for a product of another unit; and on the
catalog tab switch the plus off for a product already on the selected list, with a sentence and a
link that opens the list at that line.

### Context

- One component, `LineComposer`, serves the zone list and the shopping list (the basket page).
  Its `_send` emits `count × defaultQuantity(unit)` and `unit`, `UNIT` for typed text
  (`line-composer.ts:741` to `:744`).
- Backend `0260` answers an add that met a wanted line with 201, `merged: true`, `outcome:
  'ALREADY_ON_LIST'` and `alreadyOnList` (the lines, unchanged, same `version`). It raises a line
  kept at 0 by the add's amount (`RAISED`), creates at one step when nothing is met (`CREATED`),
  and asks `line_add_needs_choice` only when a typed name meets two or more lines all at 0. A
  free text add is never refused for a unit; a product add that meets only lines of another unit
  is `line_unit_differs` with `details.line`. A line of the add's own unit that holds the product
  takes the add even when an earlier line of another unit holds it too (2026-11-12).
- The list page already marks a raised row: `_markTook` scrolls it to the centre when it is out of
  view and gives its quantity an amber edge for `TOOK_DURATION_MS` (`list-page.ts:2081` to
  `:2108`). The edge is an input of `QuantityReel` (`quantity-reel.ts:33`), which velista `0188`
  replaces. The basket page marks a row but cannot scroll to it: its rows carry no line id.
- `?line=<lineId>` already opens a list scrolled to a line and marks it for 4 s
  (`list-page.ts:1607` to `:1655`, `route-params.ts:164`). Nothing builds such a link today: the
  assistant's links stopped carrying it (`assistant-page.spec.ts:241`).
- The catalog's plus calls `CatalogAddStore.add`, which draws one default on the line that holds
  the product, or on a stand in line, before the answer (`catalog-add-store.ts:391` to `:418`).
  `rowAdds` gives a card its plus and the lines of the selected list that hold its product
  (`row-adds.ts:30` to `:68`); the product page's similar products use it too.

### Target state

1. `LineComposer` has no stepper and no `quantity` signal; the field takes the width.
2. A typed name is submitted with no `quantity` and no `unit`. A chosen product is submitted with
   `unit: lineUnitOf(product)` and `quantity: addAmount(unit)` (25, 25 or 1).
3. An answer `ALREADY_ON_LIST` on the zone list: the field clears, the search closes, no row is
   added, every met line is scrolled to (the first) and marked, and the live region says
   "{name} is already on the list". On the shopping list the same, through `addOutcome`, with the
   rows found by a new `data-line-ids` attribute. A met line the page does not draw is said as a
   sentence on the composer instead.
4. The duplicate question, now asked only about lines at 0, draws each row as "0 → 25 g" in the
   row's own unit.
5. A product add refused with `line_unit_differs` draws one sentence above the composer row, keeps
   the words and focus, and creates nothing.
6. The catalog tab (and the product page's similar products, which share `rowAdds`): a product
   that the selected list holds on a wanted line has its plus switched off, with "Ya está en
   {list}." and the link "Ver en la lista" under the card in place of the heading of its lines;
   the lines keep their steppers. The catalog's own add starts a line at one step.

### Scope

- `libs/velista/models` (`line-unit.ts`: `addAmount`; `add-choice.ts`; `catalog-visit.ts`).
- `libs/velista/data-access` (the add writes and their answers, `line-store.ts`, the basket store
  and mapper, the fakes `line-memory.ts` and `basket-memory.ts`, `catalog-add-store.ts`, the
  refusal mapper).
- `libs/velista/ui` (the composer, the add question, `product-row.ts`, the assets).
- `libs/velista/feature-lists` (`list-page`), `libs/velista/feature-shopping-lists`
  (`basket-page`), `libs/velista/feature-catalog` (`row-adds.ts`, `catalog-page`, `product-page`
  where it passes `rowAdds` its inputs), and the two error copy files.
- `apps/velista-luna-e2e` (`shop.spec.ts`, `catalog.spec.ts`).
- Do NOT touch the reel or the new stepper component (velista `0188`), the steps (velista `0186`),
  the product page's lists table (velista `0187`), the composer's position (velista `0189`), or
  any backend project.
- Do NOT add a unit picker, a conversion, or a way to choose an amount at the composer.

### Constraints

- Rule D4: the answer's `outcome`, `alreadyOnList`, `addOutcome` and the refusal's `details` are
  mapped from `unknown` into velista's own model. No import from
  `@portfolio/luna-shopper/contracts`. An answer with no `outcome` (a gateway of before backend
  `0260`) is read from `merged` as today.
- A typed name omits `quantity` and `unit` on the wire, also in its `intoLineId` and `newLine`
  answers.
- Copy through RokuTranslator keys in `en` and `es`, names as arguments, no number inside a key.
  No dashes as punctuation in copy or comments.
- The composer keeps every property of velista `0038` and `0170`: focus across a submit, the
  microphone on an empty field, the counter past 350 characters, the held send.
- Tokens only (`token-hygiene.spec.ts`), and the info glyph is `lib-info-icon`; no inline `<svg>`.
- `prefers-reduced-motion`: the scroll is instant and the mark has no transition, as today.

### Action boundaries

- Proceed with sections 1 to 7 once PRs #959 to #961 are in `dev`.
- Stop and ask if backend `0260` is not on the gateway of the slot, or if its answer or refusal
  differs from section 0's context.
- Stop and ask before giving the composer any new control, before adding a dependency, before
  deleting a file this plan does not name, and before raising `MIN_CLIENT_VERSION`.
- Stop and ask if the owner answers a question of section 9 differently from the writer's choice.

### Progress evidence

Each criterion of section 8 with its spec output, `npx nx build velista`, and one walk on a slot
with backend `0260`, with screenshots at 390 px: a typed "Walk bananas" onto a list whose line of
that product holds 750 g leaves it at 750 g, scrolls to it and marks it; the same on the shopping
list; a loose product from the typeahead lands at 25 g; on the catalog tab that product's plus is
off with the sentence and the link, and the link opens the list with the line centred and marked;
a product card onto a line of several products set to `UNIT` draws the refusal sentence.

## 0. Decisions

### The owner's, fixed

- **U1. A free text line counts pieces** (2026-11-09). A typed name that creates a line creates
  one piece.
- **U2. Until a conversion exists, an add that meets a line of another unit is an error**,
  never a choice and never a silent new line (2026-11-09). Backend backlog `0024`.
- **U3. The composer has no quantity picker** (2026-11-09, stands). The amount is changed on the
  list.
- **A1. A product, or a typed name, that is already on the list adds nothing** (2026-11-10 and
  2026-11-11). "The line is shown so the person can find it and change its amount there
  (scrolled into view and marked for a moment)." On zone lists and on the shopping list. The usual
  amount (a median) is backend backlog `0025`, not built.
- **A2. A product that is not on the list is added at one step of its unit**: 25 g, 25 ml or 1
  piece. Once velista `0186` serves a product's own step, a chosen product is added at that step.
- **C1. The catalog tab** (2026-11-11): a product on no line of the selected list keeps the round
  plus. A product already on the list has that plus switched off, with a line under the card that
  says why and a link: "Ya está en Compra semanal." and "Ver en la lista", which opens the list
  scrolled to that line. The message is real text with the app's info icon. The list's lines of
  that product stay under the card, each with its own stepper, and those steppers work.

### The writer's, open to the owner

- **A. The field takes the stepper's width.** The row is a flex row whose field has `flex: 1`, so
  removing the stepper gives its width to the field.
- **B. Both composers change together.** They are one component on purpose.
- **C. "On the list" means a wanted line**, quantity above 0, of the selected list that holds the
  product, whether the line holds it alone or with others. That is the server's rule (backend
  `0260` R2, R5). A product whose only lines are at 0 keeps its plus on: a press raises the kept
  line to one step, as the line's own stepper would.
- **D. The link opens the list with `?line=`**, the mechanism plan `0032` already built and the
  list page still reads. Its target is the first wanted line of the product in the order the card
  draws them (list position). The URL is `appPath(locale, basePath, 'zones', zoneId, 'lists',
  listId)` with the query `{ line: lineId }`, drawn as a real link (`routerLink` and
  `queryParams`), so it can be opened in a new tab and a screen reader says "link". Back from the
  list returns to the catalog by history. The list marks it with its existing link mark for 4 s.
- **E. The add's mark is `_markTook`, extended to several lines**, on both pages. One mark per
  occasion: the link uses the link mark (D), an add the took edge. `tookLine` becomes a set of ids
  and the first met line is the one scrolled to. When velista `0188` replaces the reel, its stepper
  carries the edge; whichever of the two plans lands second moves the input.
- **F. A met line the page does not draw is said, not hunted.** If, after the next render, no row
  of a met line is in the page (a filter, a collapsed section, a line past the loaded pages), the
  composer draws "{name} is already on the list." (shopping list: "…on {list}.") above its row, as
  the refusal of section 4 is drawn. The page never changes a filter by itself.
- **G. The switched off plus stays a button with `disabled`**, its accessible name unchanged and
  `aria-describedby` pointing at the sentence, because a disabled button is not announced by
  itself and the sentence is the reason. The sentence is plain text in the card, not a tooltip,
  so it reads without a press.
  > **Amended 2026-11-12, the owner's choice:** the plus is switched off with
  > `aria-disabled="true"`, not `disabled`. It stays in the Tab order, a click, Enter or Space
  > does nothing, it keeps `aria-describedby` on the sentence, and it is drawn switched off as
  > before (the mock's frame "catalog D3" does the same, and so do the stepper's ends). The
  > reason: the first add of a product switches its plus off under the focus that pressed it,
  > and a `disabled` button drops that focus to the page, on every first add from a keyboard.
- **H. The composer's cards on the zone list and the shopping list keep their plus on.** C1 names
  the catalog tab. A card's plus that meets a wanted line is answered `ALREADY_ON_LIST` and the
  page shows the line (target 3). Asked in section 9.
- **I. No optimistic row for a product a loaded wanted line holds.** `drawsBeforeAnswer` answers
  true for every product add today; it now answers false when a loaded wanted line of the list
  holds every product of the add, so a row that would vanish is never drawn.

## 1. The composer

- Remove `QuantityStepper` from `imports`, `<lib-quantity-stepper>` from `line-composer.html:128`,
  and the `quantity` signal; `clear()`, `sent()` and `_clear()` stop resetting it.
- `LineComposerSubmit.quantity` and `unit` become optional. `_send` emits them only when
  `itemIds` is set: `unit` from the chosen card and `quantity: addAmount(unit)`. A typed name emits
  `content`, `anchor` when held, and neither field. The `LINE_QUANTITY_MAX` cap goes.
- `addAmount(unit: LineUnit): number` in `libs/velista/models/src/lib/line-unit.ts`, beside
  `defaultQuantity`: 1 for `UNIT`, 25 for `GRAM` and `MILLILITER`. It is "one step at the first
  add", not the stepper's step: velista `0188` steps a count by 10 from 1000, which an add never
  reaches. `defaultQuantity` stays for a unit change (`line-detail-sheet.ts:784`,
  `line-page.ts:421`, `line-store.ts:1870`), which this plan does not touch.
- Rewrite the comments that name the stepper or the count (the class comment's "Adding happens in
  runs" and "One slot, two jobs", `restore`, `sent`, `clear`, `clearTyped`, the template comment
  near the stepper, and the doc of `LineComposerSubmit.unit`).
- A new input `notice = input<string | null>(null)` (the translated sentence above the row) and an
  output `noticeDismissed` for its cross. The page owns the sentence; the composer never clears it.

## 2. The writes and their answers

- `LineService.addLine` / `addLineResult`, `LineApi` and `BasketStore.addLine` / `basket-api.ts`
  take `quantity` and `unit` as optional and leave both out of the body when absent, also in the
  `intoLineId` and `newLine` answers.
- `LineAddResult` (`line-service.ts:36`) gains `outcome: 'created' | 'raised' | 'alreadyOnList'`
  and `alreadyOnList: readonly Line[]`, mapped from `unknown` in `line-api.ts` (an unknown or absent
  `outcome` reads as `merged ? 'raised' : 'created'`; an entry of `alreadyOnList` that does not map
  is dropped). `LineStore.addLine` passes both on in its `added` state and, on `alreadyOnList`,
  removes its placeholder if it drew one and reconciles each met line in place
  (`_settleRaise`), which is a no op at the same version.
- `BasketRowResult` in velista gains `addOutcome` with the same three values, mapped in
  `basket-mappers.ts`, absent on every other write.
- `drawsBeforeAnswer` (decision I): `addMayMeetLine` gains a product twin,
  `addMayMeetProduct(lines, itemIds)`, true when a loaded line, not rejected, with quantity above 0,
  holds every id.
- The in memory fakes follow backend `0260` section 1: a wanted line met answers `alreadyOnList`
  and writes nothing; a kept line met is raised by the add's amount; two or more kept candidates of
  a typed name with `askIfAmbiguous` refuse with `line_add_needs_choice`; a product add meets the
  lines of its own unit first, wherever a line of another unit stands, and refuses with
  `line_unit_differs` and `details.line` only when no line of its unit holds it; a create starts
  at `addAmount`. No fake deletes a line that reaches 0 (backend `0263` withdrawn).

## 3. The pages after an add

### 3.1 The zone list (`list-page.ts`, `_send`)

- `alreadyOnList`: call `sent()`, clear the query (the search closes, as after any add), draw no
  row, call `_markTook` with every met line id, and set the announcement
  `list.add.alreadyOn` with the first line's name as the row draws it (`_lineName`). After the next
  render, if no `[data-line-id]` of a met line is in the column, set the composer's notice to the
  same sentence (decision F).
- `raised` and `created`: unchanged.

### 3.2 The shopping list (`basket-page.ts`, `_addTo`)

- Each row's `<li>` gets `[attr.data-line-ids]` with the ids of its entries, space separated.
- `addOutcome === 'ALREADY_ON_LIST'`: clear the words as on any landed add, `_markTook` every entry
  line of the answer, scroll the first marked row to the centre when it is out of view (the same
  rule as the list page), and announce `basket.add.alreadyOn` with the row's name and the list's
  name. A row not drawn: the composer's notice (decision F).
- With no `addOutcome` (an older gateway) the page keeps today's detection by a line it already
  showed.

### 3.3 The question

- `addChoiceRows(choice, facts)` loses `added` and `addedUnit`. Each row's `to` is
  `min(LINE_QUANTITY_MAX, from + addAmount(line.unit))`, a plain number; `from` is 0 in every
  question the server now asks.
- `list-page.html:532` and the basket's picker stop passing `[added]`.
- `libs/velista/ui/src/lib/list/add-choice.ts` loses its branch for a row of another unit; every
  row draws "from → to" in its unit, its accessible name `list.addChoice.row` with `added` the
  row's own `addAmount` formatted ("25 g", "1"). `rowHolds` and `rowHoldsNoProduct` are removed
  from `en.json` and `es.json`.

## 4. The refusal

- **When.** Only a product add (a card chosen in the composer, a catalog plus): backend `0260` R4
  never refuses a typed name.
- **The model.** `AddUnitRefusal { lineId: string | null; name: string; unit: LineUnit | null }`
  in `add-choice.ts`, mapped in `mapping/add-choice-mappers.ts` from `details.line` (`lineId`,
  `content`, `unit` with `oneOf(LINE_UNITS, null)`). `name` is `line.content`, else the product's
  name the card carried. A merge's `line_unit_differs` carries no details and keeps the rename
  sentence.
- **The pages.** They do not call `sent()`, remove an optimistic row if one was drawn, and set the
  notice. The notice clears on the next `queryChanged`, the next submit, and `noticeDismissed`.
- **The catalog.** A refused catalog plus takes back what it drew and reports through
  `catalog.add.failed` with the sentence of the table below in its place.

| key | `en` | `es` |
| --- | --- | --- |
| `list.error.addUnitDiffers.UNIT` | This list already counts {{name}} in pieces. Change the amount on that line instead. | Esta lista ya cuenta {{name}} por unidades. Cambia la cantidad en esa línea. |
| `list.error.addUnitDiffers.GRAM` | This list already counts {{name}} by weight. Change the amount on that line instead. | Esta lista ya cuenta {{name}} por peso. Cambia la cantidad en esa línea. |
| `list.error.addUnitDiffers.MILLILITER` | This list already counts {{name}} by volume. Change the amount on that line instead. | Esta lista ya cuenta {{name}} por volumen. Cambia la cantidad en esa línea. |
| `list.error.addUnitDiffers.unknown` | This list already has {{name}} in another unit. Change the amount on that line instead. | Esta lista ya tiene {{name}} en otra unidad. Cambia la cantidad en esa línea. |
| `basket.error.addUnitDiffers.UNIT` | {{list}} already counts {{name}} in pieces. Change the amount on that line instead. | {{list}} ya cuenta {{name}} por unidades. Cambia la cantidad en esa línea. |
| `basket.error.addUnitDiffers.GRAM` | {{list}} already counts {{name}} by weight. Change the amount on that line instead. | {{list}} ya cuenta {{name}} por peso. Cambia la cantidad en esa línea. |
| `basket.error.addUnitDiffers.MILLILITER` | {{list}} already counts {{name}} by volume. Change the amount on that line instead. | {{list}} ya cuenta {{name}} por volumen. Cambia la cantidad en esa línea. |
| `list.add.alreadyOn` | {{name}} is already on the list. | {{name}} ya está en la lista. |
| `basket.add.alreadyOn` | {{name}} is already on {{list}}. | {{name}} ya está en {{list}}. |
| `list.add.dismissNotice` | Dismiss | Cerrar |
| `catalog.held.alreadyOn` | Already on {{list}}. | Ya está en {{list}}. |
| `catalog.held.openLine` | See it on the list | Ver en la lista |

## 5. The catalog tab

- **The model.** `ProductRowAdd` (`product-row.ts:117`) gains `onList?: { readonly lineId: string;
  readonly path: string }`. Present means the plus is off. `rowAdds(target, held, pathOf)` sets it
  when a held line of the target list with quantity above 0 holds the product: `lineId` the first
  such line by the order the card draws, `path` from `pathOf(target)`, which the catalog page and
  the product page pass as `appPath(locale, basePath, 'zones', target.zoneId, 'lists',
  target.listId)` (decision D). `held` lines at 0 do not set it (decision C).
- **The card.** With `onList`, the plus (`:550` to `:561`) renders `aria-disabled="true"` (decision G as amended), with
  `aria-describedby` the sentence's id; it keeps its size and place. Under the card, in place of
  the heading of the lines (`catalog.held.title`, `:583` to `:586`), one line: `lib-info-icon`
  (decorative, `aria-hidden`), the text `catalog.held.alreadyOn`, and a link
  `catalog.held.openLine` with `[routerLink]="onList.path"` and `[queryParams]="{ line:
  onList.lineId }"`. The lines and their steppers below are unchanged and work. Without `onList`
  the card is as today.
- **The look**, from the mock's frame "catalog D3": the switched off plus has the same outline in
  the disabled tokens; the sentence is body text in the secondary colour, the link in the app's
  link style, underlined. The sentence wraps; the link never breaks inside itself. Token names are
  the builder's, from `_semantic.scss`.
- **The store.** `CatalogAddStore._drawAdd` and `_add` use `addAmount` in place of
  `defaultQuantity` (`:401`, `:411`, `:435`), and so does `visitFloor` (`catalog-visit.ts:157`) and
  the correction of adds still on their way (`:883`). `_correctUnit` (`:586`) is a unit change and
  stays. An answer `alreadyOnList` (a race: another device made the line) takes back what was
  drawn, records nothing in the visit, and lets the held line read the server's quantity.
- **The product page** passes `pathOf` the same way for its similar products. Its own lists table
  is velista `0187`; this plan does not touch it.

## 6. Specs and e2e

- `line-composer.spec.ts`: a typed name emits no `quantity` and no `unit`; a chosen card emits its
  unit and `addAmount(unit)` for the three units; no stepper renders; `notice` draws, announces and
  emits `noticeDismissed`. The held send spec loses "and the quantity".
- `line-unit.spec.ts` (models): `addAmount` answers 1, 25, 25.
- `add-choice.spec.ts` (models and ui): `to` is `from + addAmount(row.unit)` per row, capped; a
  `GRAM` row draws "0 g" and "25 g"; the "another unit" case is removed.
- Data access: an open add's body has neither field, nor do its answers; a product add's body has
  both; `outcome` and `alreadyOnList` map from `unknown`, an answer without `outcome` reads from
  `merged`; `addOutcome` maps; `addMayMeetProduct`; the fakes follow section 2.
- `add-choice-mappers.spec.ts`: the refusal from `unknown`, with a missing line, a missing unit and
  an unknown unit.
- `list-page.spec.ts` and `basket-page.spec.ts`: an `alreadyOnList` answer draws no row, marks
  every met line, scrolls to the first, announces the sentence, and draws the notice when the line
  is not drawn; a refusal keeps the words and draws the sentence; the question draws "0 → 25 g".
- `row-adds.spec.ts`, `product-row.spec.ts`, `catalog-page.spec.ts`: a product held on a wanted
  line has the plus disabled with `aria-describedby`, the sentence, the link with `line` in its
  query, and its lines' steppers enabled; a product held only at 0 keeps its plus; a product held
  on a line of several products counts.
- `catalog-add-store.spec.ts`: a new line is drawn and answered at 25 g; `visitFloor` of a weight
  line the visit made is 25; an `alreadyOnList` answer takes the drawn amount back.
- `list-page.spec.ts`: a `?line=` link from the catalog marks and centres the row (the test of plan
  `0032` stands; add one with a line past the first frame).
- `apps/velista-luna-e2e`:
  - `shop.spec.ts`, the weighted `describe` (`:407`): a test on a line of its own at 1000 g; the
    composer types the product's name and presses add; the line still reads 1000
    (`aria-valuenow`), no new row of that name, and over the API one line, `GRAM`, 1000.
  - `catalog.spec.ts`: after step 2 (`:196`), Bread's `button.add` is disabled, the card shows
    "Already on" and the list's name and the link "See it on the list"; a new step follows the link
    and expects the list URL with `?line=` and the Bread row visible; after step 5 (`:231`) the
    plus is enabled again. Step 8 (`:281`, the product page's table) reads 25 then 50 on the way
    up only if velista `0187` has made the table's plus step the line; the builder of whichever of
    `0185` and `0187` lands second sets those numbers.

## 7. Not in this plan

- A conversion between units (backend backlog `0024`).
- The usual amount at a repeat add (backend backlog `0025`).
- The stepper with buttons and its steps (velista `0188`, `0186`).
- The search field at the top (velista `0189`).
- The product page's lists table (velista `0187`).
- The deletion of a line at zero (velista `0192`, backend `0263`), withdrawn by the owner on
  2026-11-12: no write deletes a line at 0.

## 8. Acceptance criteria

- [ ] The composer renders no stepper on either page, and the field fills the row.
- [ ] A typed name is sent with neither `quantity` nor `unit`, also in its answers; a chosen
      product with its unit and `addAmount(unit)`.
- [ ] An `alreadyOnList` answer adds no row, marks and scrolls to the met line on the zone list and
      on the shopping list, and announces it; a met line not drawn is said on the composer.
- [ ] The question draws each row from 0 to one step of its own unit, and the two "another unit"
      keys are gone.
- [ ] A product add refused with `line_unit_differs` draws the sentence for the line's unit, keeps
      the words and focus, and creates nothing; a rename keeps its old sentence.
- [ ] On the catalog tab a product on a wanted line of the selected list has its plus off, the
      sentence with the info icon, and a link that opens the list at that line, marked; its lines'
      steppers work. A product on no wanted line keeps its plus, which adds at one step.
- [ ] Every new key exists in `en` and `es`, with no number inside a key.
- [ ] `npx nx affected -t lint test` is green, `npx nx build velista` builds, and the e2e tests of
      section 6 pass on a slot with backend `0260`.

## 9. Questions for the owner

1. **Decision C.** A product whose only line on the list is at 0 (bought and kept) keeps its plus,
   and a press raises that line to one step. Should it count as "already on the list" instead?
2. **Decision H.** The cards under the composer on the zone list and on the shopping list keep their
   plus: a press on a product already on the list scrolls to its line and marks it. Do you want the
   switched off plus and the sentence there too?
3. **Decision D.** "Ver en la lista" opens the first line of the product when several lines hold it.
   Is that right, or should it open the list with all of them marked?
4. **The similar products of the product page** share the catalog's card, so they switch the plus
   off too. Is that what you want?
5. "By weight" and "by volume" rather than "in kilos" and "in litres" in the refusal: is that the
   wording you want?
