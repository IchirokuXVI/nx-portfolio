# 0146: the catalog chooses the products of a line

> Asked for by the owner on 2026-10-11: "In order to pick a product for an existing line,
> the catalog will open. There was a recent mock created that uses the current catalog to
> select products. That catalog should be the one used. Same for picking new products in
> the line detail page."
>
> His later choices, in his words:
>
> - "Let's go with P1 [but] P3 is also needed for the detail page." P1 chooses one product
>   and confirms at the foot. P3 chooses several.
> - "It's better to have all previously selected products also pre-selected in the
>   catalog. Change the orange button to 'Save' and show a 'X products removed' and 'X
>   products added'. When opening the catalog, the already selected products appear at the
>   top. Once you are searching, they only show if the filter found them."
> - "Remove the long-press selection."
> - On the action of the heading of the line page: "'Change' is better."
> - "Save won't be disabled, you can press it to close if no changes were done. The button
>   will be the same independent of changes."
> - He accepted that the last product of a line may be removed, that the line page always
>   opens the catalog that chooses several, and that leaving with changes asks first.
>
> **The mock is the design.** It is `apps/velista/plans/mocks/list-lines/`
> (`PickOne.dc.html`, `PickMany.dc.html`, `PickManySearch.dc.html`, `LineHeading.dc.html`,
> `LineEmpty.dc.html`), published at https://claude.ai/artifact/Jg7JBG2LdNNj4FFaM1w6Ve.
>
> **Velista plan `0140` section 3 describes the same page that chooses one product**, for
> the shopping list (pull request #693, not built). Section 1 says how the two plans share
> it. Neither plan waits for the other.
>
> **This plan removes the products page of a line** (velista `0135` section 3.2). Section 6
> lists what goes with it. The owner did not speak about those parts.
>
> Prerequisite reading: velista `0134` (the catalog tools and its cards), `0135` sections
> 3, 3.1 and 3.2, `0137`, `0140` section 3, `0119` and `0124` (the two pickers of the
> catalog), `0130` (one header), `0145` section 5, the page rule and the back rule in
> `CLAUDE.md`, `libs/velista/feature-catalog/src/lib/catalog-page/`,
> `libs/velista/feature-catalog/src/lib/supermarket-choice.ts`,
> `libs/velista/ui/src/lib/catalog/product-row.ts`, `adding-bar.ts`,
> `libs/velista/data-access/src/lib/catalog/catalog-add-store.ts`,
> `libs/velista/feature-lists/src/lib/line-products-page/`,
> `libs/velista/feature-lists/src/lib/line-page/` and
> `libs/velista/feature-shell/src/lib/routes.ts`.

## Brief for the agent

### Objective

Open the catalog page in a mode that chooses products for one line: one product from a row
of the list, and the whole set of products from the line page.

Use the `nx-portfolio-angular-developer`, `design-taste-frontend`, `antislop`,
`antislop-ui` and `antislop-human` skills.

### Context

Every statement below was read on `dev` at `6cced1bd`.

- **`CatalogPage`** has no input. Its state is the URL (`q`, `chain`, `category`, `order`)
  and injected stores. Its read is `browse(...)`, 30 products for each page, on a sentinel.
- **Its two selectors open picker pages** (`catalog/supermarket`, `catalog/categories`),
  and the links back are built from the four known parameters only
  (`catalog-page.ts:543`, `:704`). They return to the catalog tab.
- **A card is `lib-product-row`.** A press on it opens the product page. Its plus adds to
  the list `CatalogAddStore` holds. Under a card sit the lines of that list that hold the
  product, each with a stepper.
- **The bar at the foot is `lib-adding-bar`**: the list the plus adds to, and how many
  this visit added.
- **Nothing opens the catalog for a line.** No route, no parameter and no store names one.
- **The products page of a line** is `…/lines/:lineId/products`
  (`line-products-page/`). It has a search field, the products of the line by source, with
  Keep, a star and a cross for each, and "similar products" for each group. Every change is
  one `LineStore.updateLine`: `{ itemIds }` for an add or a remove, `{ adoptItemIds }` for
  Keep, `{ favoriteItemId }` for the star.
- **The line page** draws the cards of a line with `lib-line-product-rail`, a star on each.
  "Change" on the heading opens the products page when the line has cards, and "Add a
  product" does on an empty line (`line-page.html:117`, `:145`).
- **A line holds no more than `LINE_ITEM_SET_MAX` products**, and the products page checks
  it before it sends.
- **A page is a route.** A back control names a fallback URL (`PageNavigation.back`), and
  no page path holds the `sheet` segment.
- **After velista `0145`**: a row with no product has a plus and "Choose a product".

### Target state

1. The catalog page has a mode that chooses for a line, with the two kinds of section 1.
2. From a row of the list it chooses one product (section 2).
3. From the line page it chooses the whole set (section 3).
4. Leaving with a change asks first (section 4).
5. The line page opens it from "Change" and from "Choose a product" (section 5).
6. The products page and its route are removed (section 6).

### Scope

- `libs/velista/feature-catalog`: the catalog page in its mode to choose, and the pure
  functions of the set.
- `libs/velista/ui/src/lib/catalog`: the card with a radio or a tick in place of the plus,
  the bar at the foot, the small checkbox when none of that look exists.
- `libs/velista/feature-lists`: the line page, the removal of `line-products-page/`, the
  plus of the row.
- `libs/velista/feature-shell`: the routes.
- `libs/velista/models`: the difference between two sets of products, with a spec.
- `libs/velista/ui/assets/i18n/en.json` and `es.json`.

### Constraints

- **The mock decides the look.**
- **It is the catalog page, not a second page.** One component with a mode, or shared
  parts. A rule of the catalog tab that changes later must reach both.
- **The two pickers return to the page that opened them**, with the mode and the line
  intact. Today they return to the tab.
- **Nothing on the page adds to a list.** No plus, no stepper under a card, no adding bar.
- **A press on a card chooses it.** It does not open the product page.
- **The bar of tabs is not drawn**, and the header has a close control (`leading="close"`).
- **Save is one button.** It looks the same with and without a change.
- **One write saves the whole set**: one `updateLine` with `itemIds`. A failed save keeps
  the page open with the ticks as they were, and says so with a retry.
- **The right to edit** is the rule of the products page today. A reader without it who
  reaches the URL is sent to the line page.
- **The header rule and the back rule hold.**

### Action boundaries

- Do not change the backend. If the contract lacks something, say what and stop.
- Do not change the catalog tab: its tools, its cards, its plus and its bar behave as they
  do today.
- Do not build velista plan `0140`. Build the page so that plan can open it (section 1).
- Do not change the cards of the line page or the star on them.

### Progress evidence

- `npx nx build velista` and
  `npx nx run-many -t lint test -p velista/models velista/ui velista/feature-catalog velista/feature-lists velista/feature-shell`
  pass. `routes.spec.ts` and `no-unguarded-history-back.spec.ts` pass.
- `npx nx e2e velista-luna-e2e` passes on a slot.
- A browser walk at 390 pixels, in English and Spanish: choose a product from the plus of
  a row, open Change on a line with three products, remove one and add two and save, open
  it again and press Save with no change, change a tick and close and answer both ways,
  use both pickers and come back to the same page, remove the last product of a line, and
  reach the page as a reader who may not edit.

## 1. One page, two kinds

The catalog to choose is the catalog page with:

- the same tools: the search field, the supermarket selector, the category selector and
  the order,
- the same cards, with the photo, the name, the brand, the size, the price and the price
  for each kilo or litre,
- a header with a close control and its own title,
- no bar of tabs, and nothing that adds to a list,
- a bar at the foot that names what the choice is for, with one button.

It has two kinds:

- **One**: a radio on each card, and the button "Use this product".
- **A set**: a tick on each card, and the button "Save".

A caller gives the page a title, the two lines of the bar, the kind, the products that
arrive chosen, and what to do with the answer. Velista `0140` section 3 is the kind "one"
with the shopping list as its caller. When that plan is built after this one, it opens this
page. When it is built first, this plan adds the kind "a set" to its page.

## 2. From a row: one product

Artboard `PickOne.dc.html`. Route `…/lists/:listId/lines/:lineId/product`, a page.

- It opens from the plus and from "Choose a product" on a row with no product (velista
  `0145` section 5).
- **Title**: "Choose a product". **Bar**: "For <the name of the line>", and the name of
  the list.
- **The search field starts with the name of the line**, so the first results are for the
  thing the line asks for. The supermarket selector starts on the supermarket of the line
  when it has one.
- "Use this product" sends `updateLine(line.id, { itemIds: [itemId] })` and goes back to
  the list. With no card chosen the button says why: it is `aria-disabled`, and a press
  answers "Choose a product first" in a polite region.
- Close goes back to the list and changes nothing. Its fallback URL is the list.
- A line that has a product by the time the page opens is sent to the page of section 3.

## 3. From the line page: the whole set

Artboards `PickMany.dc.html` and `PickManySearch.dc.html`. Route
`…/lists/:listId/lines/:lineId/products`, the path the products page has today.

- **Title**: "Choose products".
- **The products of the line arrive ticked**: its own and those of its group.
- **With an empty search**, they come first, under the heading "On this line". The
  products of the catalog follow under "All products", and a product of the line is not
  drawn twice.
- **With text in the search**, or a supermarket or a category chosen, there are no
  headings. A product of the line is drawn only where the read finds it, in the order of
  the results, with its tick.
- **A tick on a card adds the product. A press on a ticked card removes it.** A product of
  the line that was removed and is not in the results keeps its place in what will be
  saved: the page holds the set, not the cards.
- **The bar**:
  - With no change: "For <the name of the line>", and the name of the list.
  - With a change: "2 products added" and "1 product removed". Only the line that is not
    zero is drawn when one of them is zero. The singular reads "1 product added".
- **Save**:
  - With a change: one `updateLine(line.id, { itemIds })` with the whole set, then back to
    the line page.
  - With no change: back to the line page, and nothing is sent.
- **The cap**: a tick that would pass `LINE_ITEM_SET_MAX` is refused, with the sentence
  the products page has today.
- **An empty set is allowed.** The line then has no product, and velista `0144` and
  backend `0207` make it a named line.
- **The favourite**: a set that no longer holds the favourite of the line sends
  `favoriteItemId: null` in the same write.
- Loading, no result and a failed read use the states of the catalog tab.

## 4. Leaving with a change

Close, the back of the browser and Escape leave the page. With a change in the set, the
page asks first: "Leave without saving?", with "Leave" and "Keep choosing". With no
change it leaves at once.

The fallback URL of close is the line page.

## 5. The line page

- **A line with products** (`LineHeading.dc.html`): the heading "Any of these will do"
  keeps its text action, and it reads "Change". It opens the page of section 3. The cards,
  their order (velista `0137`) and the star do not change.
- **A line with no product** (`LineEmpty.dc.html`): the heading reads "No product yet",
  the text action reads "Choose a product", and one sentence follows: "With a product, the
  list shows what it costs and where it is sold." The action opens the page of section 3.
- A reader who may not edit sees neither action.

## 6. What goes with the products page

`line-products-page/` and its specs are removed, and its route now serves section 3. Three
things it did have no place in the mock:

- **"Keep"**, which made a product of a group a product of the line (`adoptItemIds`). A
  save of section 3 writes the whole set as products of the line, which is what Keep did
  for each of them. Check on a slot what a save does to a line that follows a group, and
  state it in the pull request.
- **"Similar products"** for each group. The catalog search and the category selector find
  them.
- **The products by source** (yours, of the group). The page of section 3 has one list.

The star stays on the cards of the line page.

## 7. Strings and tests

**Strings.** New keys in both files: the two titles, "For <name>", "On this line", "All
products", "Use this product", "Choose a product first", "Save", the two counts in the
singular and the plural, the question of section 4 and its two answers, "No product yet",
"Choose a product", the sentence of the empty line, and "Change". Remove the keys of the
products page that nothing reads.

**Tests.**

- The difference between two sets, as a pure function: added, removed, both, none, a
  product removed and ticked again.
- The page in the kind "one": a card chooses and does not navigate, the button with and
  without a choice, the write, the search that starts with the name of the line, close.
- The page in the kind "a set": the products of the line first with an empty search, no
  product drawn twice, a search that finds one and a search that does not, the bar in each
  state, Save with and without a change, the cap, an empty set, the favourite removed, a
  failed save.
- Both pickers return to the page with the mode, the line and the ticks intact.
- The question of section 4, both answers, and no question with no change.
- The line page: "Change" and "Choose a product", present and absent.
- `routes.spec.ts`: the two pages, neither under the marker, the count.
- The catalog tab: its specs pass with no change to them.

## 8. Not in this plan

- The page opened from the shopping list (velista `0140`).
- A favourite chosen in the catalog. The star is on the line page.
- A line that follows a product group and takes its new members. The page of section 3
  shows what the group holds today.
