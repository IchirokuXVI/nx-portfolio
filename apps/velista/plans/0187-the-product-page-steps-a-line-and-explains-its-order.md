# 0187: the product page steps a line and explains its order

> Amended on 2026-11-11: the lists table draws the stepper of velista `0188` (D3, the amount
> with its unit) and builds on its event shape, so this plan now needs `0188`; a plus on a
> list that holds the product steps that line by one step of `0188` section 1; a first add puts
> one step on, not a kilo (the owner, 2026-11-10; velista `0185` as amended); the product
> page draws no switched off plus and no message (the owner, "Fine"); every example is redone
> with the one step; a line that reaches 0 with nothing to keep can be deleted by backend
> `0263`. U6 is unchanged.
>
> Decided on 2026-11-09. Two things on a product's page disagree with the rest of velista
> since the measurement series. Its lists table sends a plus as an add, so a list that
> already holds a weight line of the product gets another kilo where the list page would
> step it (PR #960 "Left out"; `catalog.spec.ts` step 8 asserts it as current behaviour). And its Similar products are sorted by the price per kilo or litre of backend
> `0245` and velista `0181`, while a line marks the cheapest product by what the line's
> amount costs (backend `0246` W3, velista `0183`), so the two can name different winners
> with no word about why. The owner decided both on 2026-11-09 (U5, U6).
>
> Amends velista `0134` section 7 (the lists table: "one more goes through an add") and
> velista `0182` (PR #960 left the table's plus as it was). Needs PRs #959, #960 and #961
> merged into `dev`, and velista `0188` (the stepper, `ListsTableStep` with a `QuantityStep`,
> and the catalog's wait in `CatalogAddStore`). Independent of velista `0186`: this plan steps
> by `stepFrom`, and once `0186` is built that step is the product's own; nothing here changes
> when it lands. The amount of a first add is velista `0185`'s; this plan only sends the add.
>
> Prerequisite reading: velista `0134` sections 4.4 (the record of a visit) and 7 (the lists
> table); velista `0182` section 3 and PR #960 review round 2, item E (the take back at the
> floor); velista `0181` (the comparable order); velista `0183` section 1 (the cost of the
> amount, W3); velista `0137` section 3 (the info button beside "Any of these will do", the
> one precedent for this plan's button); `CLAUDE.md` "Sheets are addressed under a `sheet`
> segment" and "Going back never leaves the app".
>
> Code anchors, on `origin/feat/velista-0183-line-unit-chip` as of 2026-11-09:
> `libs/velista/ui/src/lib/catalog/lists-table.ts:77` to `:87` (the list's own stepper),
> `:133` (`added`), `:152` (`floorOf`), `:161` to `:170` (`stepMain`, which emits `added` for
> every plus where the person may add); `libs/velista/feature-catalog/src/lib/product-page/product-page.html:179`
> (`<lib-lists-table>`), `:196` to `:212` (the Similar products heading and its
> `lib-adding-bar`); `product-page.ts:360` (`similar`, sorted by `similarProducts`), `:464`
> (`addToList`), `:480` (`stepListLine`), `:513` (`openLists`, the sheet URL pattern);
> `libs/velista/data-access/src/lib/catalog/catalog-add-store.ts:312` (`add`), `:332`
> (`step`), `:391` (`_drawAdd`, which raises a held line by `defaultQuantity`), `:507` to
> `:567` (`_step`: `stepFrom`, the take back at `visitFloor`, the legacy correction);
> `libs/velista/models/src/lib/catalog-visit.ts:74` (`visitAfterAdd`), `:107`
> (`visitAfterStep`), `:152` (`visitFloor`); `libs/velista/models/src/lib/product-group.ts:29`
> (`compareGroupOffers`) and `:53` (`similarProducts`);
> `libs/velista/feature-catalog/src/lib/catalog-page/catalog-page.ts:660` to `:666` (the
> catalog tab prints the comparable figure under the unit price order);
> `libs/velista/models/src/lib/line-products.ts:42` (`lineMemberCost`, W3);
> `libs/velista/feature-lists/src/lib/line-products-info-sheet/line-products-info-sheet.ts`
> and `libs/velista/feature-lists/src/lib/line-page/line-page.html:177` to `:185` (the info
> button and its sheet); `libs/velista/feature-shell/src/lib/routes.ts:1009` to `:1016`
> (`about-products`) and `:1402` to `:1408` (the product page's route and its children);
> `libs/velista/platform/src/lib/catalog-paths.ts` (`CATALOG_PATHS`);
> `libs/velista/ui/src/lib/icons/icons.ts` (`InfoIcon`); `apps/velista-luna-e2e/src/catalog.spec.ts:281`
> to `:304` (step 8).
>
> Read "Angular conventions" in `CLAUDE.md` before any code, and load `design-taste-frontend`
> before the template, the styles or the copy.

## Brief for the agent

### Objective

Make a plus or a minus on the product page's lists table step a line that already holds the
product, as the list page steps it, and give the Similar products heading an info button that
opens a short sheet saying why that order and a line's cheapest mark can differ.

### Context

- `ListsTable.stepMain` (`lists-table.ts:161`) sends every plus as `added` when the list
  allows adds, and only a minus, or a plus without the right to add, as `lineStepped`. Its
  comment gives the reason: "an add asks for less than a change of quantity does".
- `CatalogAddStore._drawAdd` raises a held line by `defaultQuantity(own.unit)`
  (`catalog-add-store.ts:401`), so a plus on a list holding 1 l of Milk reads 2000 ml today.
- `productListGroups` (`libs/velista/models/src/lib/catalog-holdings.ts:202`) puts in `main`
  only a line of exactly the product's name that is above 0 (`addedToLine`, `:154`); a stocked
  line and a line under another name are in `others`, each with its own stepper.
- The stepper mock's capture of this page (2026-11-10) draws "750" with no unit in the table. On the branch the table
  passes the line's unit (`lists-table.ts:85`, `:117`) and `HoldingRow` carries it
  (`catalog-holdings.ts:94`); the writer did not reproduce the gap. With velista `0188` the
  unit is drawn under the number by the figure, and a spec asserts it.
  `CatalogAddStore._step` already steps by `stepFrom`, applies the take back at the floor
  and corrects a legacy line (`:507` to `:567`); only the plus never reaches it.
- `visitAfterStep` records a line the visit had not touched when it goes up, with `before`
  the value it had and `created: false` (`catalog-visit.ts:107` to `:134`), which is what
  `visitAfterAdd` records for a merged add. The take back of either lowers the line by what
  the visit added and never deletes it.
- The Similar products list is `similarProducts`, sorted by `compareGroupOffers`: priced
  first, then the comparable figure within one basis, then the pack price
  (`product-group.ts:17` to `:61`). A line orders its products by `lineMemberCost`, the cost
  of the line's amount (`line-products.ts:28` to `:42`).
- Velista has one info button already: beside "Any of these will do" on the line page, a
  `lib-info-icon` in a plain button that opens `LineProductsInfoSheet`, a child route
  `about-products` under the `sheet` marker (velista `0137` section 3).

### Target state

1. **U5.** The table draws the D3 row stepper of velista `0188` on every row that steps, with
   the amount over its unit ("750" over "g") and no tint. A plus on a list's own row steps its
   `main` line by one step (`0188` section 1) when the person may edit it. A list with no line
   of the product draws the same stepper at 0 whose plus is an add, which puts one step on
   (the amount is velista `0185`'s). A list whose only lines of the product are in `others`
   draws no stepper of its own: its other rows step those lines (decision B).
2. The minus steps, and on a line this visit made, a press at the floor takes the product back
   (PR #960 review round 2, item E), restated in section 1. A hold never takes back
   (`0188`).
3. **The product page draws no switched off plus and no message** (the owner, 2026-11-11: "No
   need to show the '+' icon on the product page in that case. Since it's a single product,
   it is already intuitive", confirmed "Fine"). The table keeps one row per list with a
   working stepper.
4. **U6.** An info button with `lib-info-icon` sits at the end of the Similar products
   heading's text and opens a sheet, `…/products/:itemId/sheet/about-order`, of a title and
   two short paragraphs in `en` and `es`, with one close control.
5. `catalog.spec.ts` step 8 asserts a plus that steps, and a new step opens and closes the
   sheet.

### Scope

- Work in `libs/velista/ui` (`lists-table.ts`, the assets), `libs/velista/feature-catalog`
  (the product page, the new sheet), `libs/velista/platform` (`CATALOG_PATHS`),
  `libs/velista/feature-shell` (one route), and `apps/velista-luna-e2e`.
- Do NOT change `CatalogAddStore`'s step, add or take back logic beyond velista `0188`, the
  amount of an add (velista `0185`), the catalog tab's rows or their plus, the order of any
  list, or the cheapest rule of a line.
- Do NOT put the info button on the catalog tab or the price table in this plan.

### Constraints

- The sheet is a child route through `sheet()`, never a hand written `sheet` segment; callers
  open it with `sheetSegments()`. It dismisses through `SheetNavigation.dismiss(fallbackUrl)`
  with the product page as the fallback, never a bare `back()`.
- The icon is `InfoIcon` from `libs/velista/ui/src/lib/icons/icons.ts`. No raw `<svg>`.
- Copy through RokuTranslator keys in `en` and `es`, no number inside a key, no dashes as
  punctuation.

### Action boundaries

- Proceed with sections 1 to 4 once PRs #959 to #961 are in `dev`.
- Stop and ask if the step changes what the record of a visit says about a line (its
  `before` or `created`) in a way section 1 does not describe.
- Stop and ask before adding the info button anywhere other than the Similar products
  heading.

### Progress evidence

Each criterion of section 5 with its spec output, `npx nx build velista`, and one walk on a
slot: Milk's page, a list with no Milk, plus reads 25 ml (an add, once velista `0185` sends one
step) then 50 ml, minus 25 ml then nothing (the take back); a list holding Milk at 2 l, plus
reads 2,03 l (2025 ml), one write after the quiet beat; the info button opens the sheet,
Escape closes it, a reload of the sheet's URL draws it over the product page, and its close
returns to the page.

## 0. Decisions

### The owner's, 2026-11-09, fixed

- **U5. The lists table of the product page steps an existing weight or volume line.** Today
  a plus there is an add and puts another kilo on the line. It must step the line like the
  list does. Since 2026-11-11 the step is velista `0188`'s, and a first add puts one step on.
- **The product page reading (2026-11-11, "Fine").** The product page draws no switched off
  plus and no "already on" message; its lists table keeps one row per list; a list that holds
  the product draws the D3 stepper with both buttons working (it steps that line); a list that
  does not hold it keeps its add control (the stepper at 0 whose plus adds).
- **U6. The product page explains why two orders differ.** The catalog tab and the product
  page order by the comparable price of `0245` (per kilo or litre); a line and the basket
  mark CHEAPEST by the cost of the line's amount (`0246` W3). A small info icon on the product
  page explains that in a sentence or two.

### The writer's, open to the owner

- **A. The rule is one for every unit, not for weights only.** A plus on a `main` line that is
  editable steps it, a count as much as a weight. `visitAfterStep` records the same `before`
  and `created: false` that `visitAfterAdd` records for a merged add (Context). One rule is one
  sentence in `stepMain` and no test per unit.
- **B. A list whose lines of the product are all in `others` draws no stepper of its own.**
  A stocked line at 0 and a line under another name are drawn as other rows, each with a
  working stepper, so a plus at 0 on such a row steps it to one step. An own stepper at 0 on
  that list would be an add, and an add of a product that is already on the list adds nothing
  (velista `0185` and backend `0260`, as amended), so it would be a button that does nothing.
- **C. A person who may add and may not edit sees the amount, not a plus.** On a list that
  holds the product their plus would be an add, which adds nothing there (velista `0185` and
  backend `0260`, as amended), so the row draws the amount with the `readonly` stepper of velista `0188`.
  On a list that does not hold it they keep the add control. `floorOf`
  (`lists-table.ts:148` to `:154`) goes: every stepper's floor is 0.
- **D. A sheet, not a popover.** Velista's one existing info button (velista `0137`) opens a
  sheet, so the same glyph in the same place on a heading behaves the same way on both pages.
  A sheet is a child route, which gives the explanation a URL that survives a reload and a
  back button that closes it, by the rules of `CLAUDE.md`. The basket total's popover
  (`basket-total.ts`) explains a number in place, but it hangs from the number it explains;
  this explanation is about two screens, and a popover over a list of rows would cover the
  rows it talks about.
- **E. The button sits on the Similar products heading.** That list is the product page's one
  ordered list, sorted by `compareGroupOffers` (`product-page.ts:360`). The price table above
  it shows one product at each chain, where the price per kilo and the pack price agree, so
  an explanation there would have nothing to explain. It is drawn whenever the section is.
- **F. The copy names no chain and no number from the catalog.** The 300 g example is the
  owner's own case, a fixed sentence, so it cannot go stale.

## 1. The lists table

`stepMain` becomes:

```ts
protected stepMain(list: ProductListRow, step: QuantityStep): void {
  const main = list.main;
  if (main !== null) {
    if (main.editable) {
      this.lineStepped.emit({ listId: list.listId, lineId: main.lineId, step });
    }
    return;
  }
  if (step.to > step.from && !step.repeat && list.canAdd && list.others.length === 0) {
    this.added.emit(list.listId);
  }
}
```

The template draws the list's own stepper only when `main` is set or `others` is empty
(decision B), the `readonly` stepper where `main` is not editable (decision C), and every
stepper in the `row` variant of velista `0188`. An add is never a repeat: a hold on the plus
at 0 adds once. The class comment's "From zero the plus makes that line. After that it moves
it." stays true and gains why: a plus that moves a line moves it by one step, as the list page
does. The comment on `stepMain` loses "one more goes through an add wherever the person may
add" and states decisions A to C.

Nothing changes in `CatalogAddStore` beyond velista `0188` section 5.5. Its `step` does what
U5 asks once the plus reaches it, writes one change per run, and keeps the take back rule PR
#960 built:

- A press of minus on a line this visit made takes the product back when it would reach
  nothing, or, for a weight or a volume line, when the line stands exactly at the amount it
  started at (`visitFloor`, `catalog-visit.ts:152`). Once velista `0185` makes an add one step,
  one minus from 25 ml removes the Milk the visit added. A repeat never takes back.
- A line that was there before the visit is not taken back: a minus lowers it, and taking it
  back lowers it to what it held before. A minus that takes such a line to 0 can remove it,
  by backend `0263`, when it has nothing to keep; velista `0192` says what the page does then.

After velista `0186` is built, `_step` reads the product's own step through `lineStepOf` and
this table steps by it with no change here.

The rows under another name (`list.others`) already emit `lineStepped` for both buttons and
are unchanged.

## 2. The info button and the sheet

- **The path.** `CATALOG_PATHS.orderInfoSheet = 'about-order'`, with a comment in the style
  of `addListSheet`. The product page's route (`routes.ts:1402`) gains
  `sheet({ path: CATALOG_PATHS.orderInfoSheet, loadComponent: () => import('@portfolio/velista/feature-catalog').then((m) => m.OrderInfoSheet) })`
  beside `addListSheetRoutes()`. `routes.spec.ts` then checks it carries the fall guard and
  sits under the marker.
- **The button.** In `.similar-head` (`product-page.html:197`), inside the `<h2>` after its
  text, as the line page draws its button (`line-page.html:177` to `:185`): a
  `<button type="button" class="info">` with `<lib-info-icon />`, `aria-label` from
  `catalog.similar.aboutLabel`. Its size, colour and focus ring are the line page's `.info`
  rules; the builder copies them rather than inventing a second look. `openOrderInfo()`
  navigates to the product page's URL plus `sheetSegments(CATALOG_PATHS.orderInfoSheet)`,
  as `openLists()` does (`product-page.ts:513`).
- **The sheet.** `OrderInfoSheet` in `libs/velista/feature-catalog/src/lib/order-info-sheet/`,
  built on `SheetShell` as `LineProductsInfoSheet` is: a title, two paragraphs, one close
  button. It holds no state and reads nothing but the translator and the route. Dismiss
  (close, scrim, Escape) calls `SheetNavigation.dismiss(productPagePath(...))`.
- **The copy.**

| key | `en` | `es` |
| --- | --- | --- |
| `catalog.similar.aboutLabel` | How these are sorted | Cómo se ordenan |
| `catalog.similar.about.title` | How these are sorted | Cómo se ordenan |
| `catalog.similar.about.order` | Similar products are sorted by price per kilo or litre, so a big pack and a small one are compared fairly. | Los productos parecidos se ordenan por precio por kilo o litro, para comparar bien un paquete grande con uno pequeño. |
| `catalog.similar.about.line` | On a list, the product marked cheapest is the one that costs least for the amount you asked for. For 300 g, a small pack can cost less than a big pack that is cheaper per kilo. | En una lista, el producto marcado como el más barato es el que menos cuesta para la cantidad que pides. Para 300 g, un paquete pequeño puede costar menos que uno grande que sale más barato por kilo. |
| `catalog.similar.about.close` | Close | Cerrar |

  "300 g" is part of the sentence and not an argument: it is an example, not a value, and a
  number formatted by `Intl` would change nothing in either locale. The word "cheapest" is in
  lower case because the card's mark is drawn in capitals by its own key, and the sentence
  names the mark, it does not draw it.

## 3. Specs

- `lists-table.spec.ts`: a plus on an editable main line emits `lineStepped` with the step; a
  plus at 0 on a list with no line of the product emits `added` once, and a repeat emits
  nothing; a list whose only line is in `others` draws no own stepper; a main line the person
  may not edit draws the `readonly` amount; a minus emits `lineStepped`; "750" is drawn over
  "g"; no row carries a tint.
- `catalog-add-store.spec.ts`: no new behaviour, but one case that a step on a held Milk
  line the visit did not make records `before` and `created: false`, and its take back lowers
  it, so section 1's claim about the record has a spec.
- `product-page.spec.ts`: the plus of the table on a list holding the product calls
  `step`, not `add`; the info button is drawn with the Similar section, absent without it,
  and navigates to `…/sheet/about-order`.
- `order-info-sheet.spec.ts`: the title and both paragraphs through
  `provideRokuTranslatorTesting()`, the close button and Escape call `dismiss` with the
  product page as the fallback.
- `routes.spec.ts`: passes with the new sheet (it asserts every fall guarded route sits under
  the marker).
- The key parity of `en.json` and `es.json`, by whatever spec checks it today (unverified
  which).

## 4. The e2e

`apps/velista-luna-e2e/src/catalog.spec.ts`:

- **Step 8** is renamed "the stepper of a list adds the product once, then steps it" and reads
  the amount from `data-value` of `lib-quantity-stepper` (velista `0188`): from 0, plus reads
  25 (an add of one step, once velista `0185` sends it), plus 50, plus 75 (steps of 25 ml);
  minus 50, minus 25, minus 0 (the take back at the amount the visit started at). The comment
  above it drops "The list's plus is an add, so each press puts one more litre on the line"
  and says the plus steps a line that exists. If velista `0185` is not built yet, the first
  add still puts 1000 on, and the builder asserts 1000, 1025, 1050, then 1025, 1000, 0.
- **A new step 9**, "the order of similar products says why it differs", runs only if the
  demo world's Milk has similar products drawn (unverified; the builder checks the seed and
  otherwise covers U6 in the specs alone): the button opens the sheet with the title "How
  these are sorted", the URL ends in `/sheet/about-order`, and Close returns to the product
  page. Today's step 9 becomes step 10.

## 5. Acceptance criteria

- [ ] The lists table draws the D3 stepper of velista `0188` with the unit under the amount
      and no tint, and the product page draws no switched off plus and no message.
- [ ] A plus on the lists table steps an editable `main` line by one step in every unit, adds
      on a list with no line of the product, and follows decisions B and C otherwise.
- [ ] A minus takes back exactly at the floor of a line the visit made, and lowers a line
      that was there before, as PR #960 built it.
- [ ] The info button uses `InfoIcon`, sits in the Similar products heading, and opens
      `…/sheet/about-order` through `sheet()` and `sheetSegments()`.
- [ ] The sheet's close, scrim and Escape dismiss through `SheetNavigation` with the product
      page as the fallback, and a reload of its URL draws it over the product page.
- [ ] Every new key exists in `en` and `es`, with no number inside a key.
- [ ] `npx nx affected -t lint test` is green, `npx nx build velista` builds, and
      `catalog.spec.ts` passes on a slot.

## Not in this plan

- **The product's own step.** Velista `0186`; this table reads it through `_step` once built.
- **The catalog tab's rows and their plus.** A row's plus on the tab is still an add; its held
  lines already step.
- **The same explanation on the catalog tab's order menu.** U6 names the product page.
- **Changing either order.** Both stay as `0245` and W3 decided.

## Questions for the owner

1. The Similar products on the product page are catalog rows with a plus. Should the catalog's
   switched off plus and its "already on" message (velista `0185`) reach them, or does "no
   switched off plus on the product page" cover them too?
2. A list whose only lines of the product are under another name, or stocked at 0, draws no
   stepper of its own, only those lines' rows (decision B). Is that clear enough on the page?
3. Should the same info button appear beside the catalog tab's "cheapest per kilo or litre"
   order, where the same difference shows?
