> **PR:** [#679](https://github.com/IchirokuXVI/nx-portfolio/pull/679) (stage 1. Stage 2 waits for the backend plan of section 9.)

# 0134: the catalog tools, adding from the catalog, and the product page

> Asked for by the owner on 2026-10-07. The catalog tab works, but its tools take a third
> of the screen, it has no price order, a product opens a small sheet, and nothing in the
> catalog adds a product to a list. The owner wants compact tools, an order by price, a
> quick way to add from a row, and a full page for a product.
>
> **The mock is the design, and the owner chose it.** It is
> `apps/velista/plans/mocks/catalog-and-product/`, published at
> https://claude.ai/artifact/XifkX8eYvVZow3Hb31U2s3. Three layouts of the tools and three
> ways to add were drawn. The owner picked layout A and the line above the tab bar. Do
> not bring the others back.
>
> **Stage 2 needs a backend plan that does not exist yet.** Section 9 states what that
> plan has to serve: a price order, a price history that a shopper can read, and the
> lines that hold a product. Stage 1 needs nothing new from the backend. If the backend
> contract is not on your base branch, build stage 1, say plainly that stage 2 is left
> out, and stop.
>
> Prerequisite reading: velista `0100` (the catalog tab), `0107` (the product sheet over
> the list), `0115` (similar products), `0119` (the category picker), `0124` (the
> Supermarket button and the shop picker), `0130` (one header), `0097` and `0106` (the
> bar at the bottom), `0116` (the basket plus asks which list), backend `0080` (every
> price a source gave), `libs/velista/feature-catalog/src/lib/catalog-page/`,
> `product-sheet/`, `libs/velista/feature-shell/src/lib/routes.ts`,
> `libs/velista/models/src/lib/catalog-browse.ts`,
> `libs/velista/data-access/src/lib/lines/line-service.ts` and `line-store.ts`.

## Brief for the agent

### Objective

Rebuild the tools of the catalog page as the search field and one row, add a line above
the tab bar that says which list the plus on a product row adds to, and replace the
product sheet with a product page.

Use the `nx-portfolio-angular-developer`, `design-taste-frontend`, `antislop`,
`antislop-ui` and `antislop-human` skills. Use the `dataviz` skill for the price history.
Read the velista UI rules in `CLAUDE.md` before you touch a template.

### Context

Every statement below was read on `dev` at `765c32df`.

- **The tools are four stacked rows today**, about 250 pixels: the search field, the
  Supermarket button (60 pixels), the category row, and the order pills with the "near"
  text. They are in `.tools` of `catalog-page.html`.
- **The choices live in the address**: `?chain=`, `?shop=` and `?category=`. The pickers
  are pages (`catalog/supermarket`, `catalog/categories`). This plan keeps both facts.
- **The order type is `CatalogOrder = 'relevance' | 'name' | 'created'`**. The gateway
  accepts `relevance`, `name`, `created` and `updated`. Prices are attached after the
  page of products is cut, so no order by price exists (section 9).
- **A product opens a sheet**, `ProductSheet`, at `<covered page>/sheet/products/:itemId`.
  It is registered in four places and opened from five (section 8). It shows the name,
  one line for each chain, a "Seen" note and similar products. Its own comment says a
  full page replaces it later.
- **Nothing in the catalog adds to a list.** `ProductRow` has one press target.
- **A line is added with `POST /v1/lists/:id/lines`.** `content` is required also with an
  item id. A list holds one line for each name and product identity, so an add that
  matches raises that line and answers `merged: true`. `LineServiceI.addLine` drops
  `merged` today.
- **`LineStore` patches only lines that it already holds.** Outside a loaded list page it
  answers `failed`. The catalog cannot use it.
- **Approval can make a new line `PENDING`.** That happens when the person holds `WRITE`
  without `DECIDE` and the list has `autoApproveLines` off.
- **`myPermissions` and `autoApproveLines` come only on `ListView`**, from
  `GET /v1/zones/:zoneId/lists`. No route lists the lists of every zone in one call.
- **`StorageKeys.lastList` has one writer and no reader.** The list page writes
  `zoneId/listId` on each open.
- **A price history exists in the database and not on the wire.** `item_prices` holds one
  row for each interval of a price, and nothing prunes it. Only admin routes read it.
- **A product is in one group** (`productGroupId`). Its members come from
  `CatalogServiceI.groupMembers`.
- **The UI word for a zone is "group".**

### Target state

Stage 1, with no backend change:

1. The tools are the search field and one row of two selectors (section 2).
2. The line that heads the list holds the "near" text and the order control, with the
   orders that exist today (section 3).
3. Each product row has a plus. A line above the tab bar names the list that the plus
   adds to (section 4).
4. The name on that line opens the sheet of lists. The count opens the sheet of what
   this visit added (section 4).
5. A product opens the page `catalog/products/:itemId`, with the header, the prices and
   similar products. The product sheet and its four registrations are gone (sections 5
   and 8).

Stage 2, after the backend plan of section 9:

6. The order menu offers Catalog order, Lowest price and Lowest price per kilo or litre,
   with products that have no price last (section 3).
7. The product page shows the price history (section 6).
8. The product page shows the table of lists (section 7).

### Scope

- `libs/velista/models`: the order type, the view of the selectors, the record of what a
  visit added, the view of the price history and of the table of lists. Each one is a
  pure function with its own spec.
- `libs/velista/data-access`: a store for the list that the plus adds to and for the
  record of the visit, the reads of section 9 behind the existing service interfaces, and
  their in memory doubles.
- `libs/velista/ui`: the selector row, the plus and the count on a product row, the line
  above the tab bar, the two sheets, the price table, the price history, the table of
  lists. Chart colours join the tokens in `libs/velista/ui/src/lib/styles`.
- `libs/velista/feature-catalog`: the catalog page, a new product page, and the removal
  of the product sheet.
- `libs/velista/feature-shell/src/lib/routes.ts` and its spec.
- `libs/velista/feature-lists` and `libs/velista/feature-shopping-lists`: only the links
  that opened the product sheet.
- `libs/velista/ui/assets/i18n/en.json` and `es.json`.

### Constraints

- **Map each response to a frontend model** (rule D4). Never pass a DTO to a template.
- **Do not use `@angular/core/rxjs-interop` in a service** that more than one app can
  provide. `CLAUDE.md` explains the `NG0203` that follows.
- **Tokens only.** `token-hygiene.spec.ts` rejects a raw pixel value other than `0px` and
  `1px`. Add a semantic token for a new size. The mock uses literal values that the
  tokens already name.
- **Icons are components in `libs/shared/ui`.** The chevron that points down is not
  there today. Look in the directory before you add it.
- **A back control names a fallback.** The product page uses
  `PageNavigation.back(<the catalog URL>)`. The sheets use `SheetNavigation.dismiss`.
- **A sheet is addressed under the `sheet` segment** and is declared with `sheet()`.
- **Copy is for people who are not at home with apps.** Short sentences, ordinary words.
- **No text names the product "Velista" in a key, a class or a route** (rule N1).

### Action boundaries

- Do not change the backend, the gateway, a contract or `openapi.json` under this plan.
- Do not change the category picker pages or the shop picker page.
- Do not change how the basket page or a list page adds a line.
- Stop and ask before you delete a file outside `product-sheet/`, add a dependency, or
  add a chart library. The history is drawn as inline SVG by a component.

### Progress evidence

- `npx nx affected -t lint test build` is green. Only `nx build` checks the types of a
  template.
- A walk in a browser at 390 by 844 through the shell, on a slot with the demo seed:
  choose and clear a chain and a category, add three products, change the list, open the
  count sheet and take one product back, open a product, go back.
- Report each claim with the command or the screenshot that shows it. Say which stage
  you built and which parts you left out.

This plan is for an agent with real system access. Check the paths and the scope above
against the repository before you start.

## 1. What the owner decided

| Question | Decision |
| --- | --- |
| Where the filters sit | One row of two selectors under the search (layout A) |
| The orders | Catalog order, Lowest price, Lowest price per kilo or litre. A to Z and Newest are removed |
| A product with several prices | It is ordered by its lowest price |
| A product with no price | It goes last in each price order |
| How a row adds to a list | A line above the tab bar names the list. The plus adds one |
| The first add | The line opens on the last used list, so no choice comes before the first plus |
| When a quantity saves | On each press |
| The product detail | A full page. Its header carries the product name |
| The list selector on the product page | In the heading of Similar products. It is the same sheet as in the catalog |
| The record of what was added | It survives a visit to a product page. It is erased when the person leaves the catalog |

## 2. The tools: the search and one row

The mock artboards are `Main` and `CatalogChosen`.

- **The search field does not change.** Its placeholder still says where it searches.
- **Under it sits one row of two selectors.** The Supermarket selector takes a little
  more width than the Category selector, because "All supermarkets" is the longer text.
- **A selector with no choice** names what the list shows: "All supermarkets", "All
  categories". It has the store glyph or the list glyph, and a chevron that points down.
  It is one button and it opens the picker page that exists today.
- **A selector with a choice** takes the amber edge, the quiet amber fill and the amber
  text. It is two controls. The body opens the picker to change the choice. The cross is
  its own button of 40 by 44 pixels behind a hairline, and it clears that choice alone.
- **The Supermarket selector shows the chain logo and the chain name.** With a shop
  chosen, the line that heads the list names the shop ("Prices at Calle Mayor 3").
- **The Category selector shows the leaf alone**, or the root when the root is the
  choice. Its accessible name says both, as the chip does today.
- `SupermarketButton` and the category chip leave the catalog page. Keep
  `SupermarketButton` if the basket still uses it, and delete it if nothing does.

The note lines under the old tools move to the left end of the line that heads the list
(section 3). Only one shows, in this order: the shop, the chain, the "near" text.

## 3. The order

The mock artboards are `CatalogOrder` and `CatalogChosen`.

- **The line that heads the list** is 44 pixels tall. The left end is the note of
  section 2. The right end is the order control: "Order: Catalog" and a chevron.
- **The control opens an anchored popover** with one radio row for each order. Each row
  has a name and one short line that says what the order does.
- **Stage 1** offers the orders that the read has. Best match shows only while the field
  has text. The other row is the order that the tab opens on today. Do not draw a price
  order that the read cannot serve.
- **Stage 2** offers three orders, and Best match as a fourth while the field has text:

| Order | What it does | Value on the wire |
| --- | --- | --- |
| Catalog order | By aisle: the position of the category, then the name. This is the default | Section 9 |
| Lowest price | The lowest price of the product at the scopes of the read | Section 9 |
| Lowest price per kilo or litre | The lowest unit price | Section 9 |

- **Products with no price go last** in both price orders. A small line "Without a
  price" stands before the first of them. The client draws that line where the first row
  without a price follows a row with one.
- **The order is in the address** (`?order=`), like the other choices, so that a product
  page returns to the same list.
- `OrderPills` leaves the catalog page. Delete it if nothing else uses it.

## 4. Adding from the catalog

The mock artboards are `CatalogAdding`, `CatalogLists` and `CatalogAdded`.

### 4.1 The plus on a row

- A product row gains a second control at its end, 44 by 44 pixels: a plus in a circle.
  The row stays one button for the product, and the plus is a sibling of it, not a child.
- **A press adds one** of the product to the chosen list. The plus then shows the count
  for that list, in quiet amber.
- **A press on the count opens a stepper in the row.** The price moves into the detail
  line while the stepper is open. One stepper is open at a time.
- **Every press saves.** An add is `addLine(listId, name, 1, [itemId])`. A later press is
  a quantity change on the line that the add answered.
- **The name of the line is the name of the product in the reader's language**, from
  `catalogName`.
- **A failed write** puts the count back and says so once, in the live region of the
  page.
- A guest and a person with no list that they can write to see no plus and no line.

### 4.2 The line above the tab bar

- It reads "Adding to **Weekly shop**" with a chevron. It sits between the page and the
  tab bar, on the raised surface with a hairline above it. It is 52 pixels tall.
- **It opens on the last used list.** Read `StorageKeys.lastList`. If that list is gone
  or the person cannot write to it, take the first list that they can write to.
- **The right end counts the products added in this visit**: "3 products added". It
  shows nothing before the first add.
- The line shows on the catalog page and not on the picker pages or the product page.

### 4.3 The sheet of lists

- The name opens a sheet: "Add to which list?". It shows each list that the person can
  write to, under the name of its group, with a radio mark and "14 to buy".
- **A press chooses and closes.** The choice is written to `StorageKeys.lastList`.
- **The same sheet opens from the product page** (section 5). The choice is one value.
- The lists come from `GET /v1/zones` and one `GET /v1/zones/:zoneId/lists` for each
  group, read once for the visit. Keep the lists that hold `WRITE`.

### 4.4 The sheet of what this visit added

- The count opens a sheet: "Added to Weekly shop". It has one row for each product added
  since the person came to the catalog: the name, the detail, and a stepper.
- **The minus at one takes the product back.** One quiet button takes all of them back.
  A link opens the list.
- **Taking back undoes what the visit did, and no more.** If the add made a new line,
  the line is deleted. If the add merged into a line that was there before, that line
  goes back to the quantity it had.
- Products added to two lists show under two headings, one for each list.
- A line that came back `PENDING` says "Waiting for approval" under its name.

### 4.5 The record of the visit

- One store holds the chosen list and the record. Provide it once for the app, not on
  the catalog route, because a route provider is never destroyed.
- **The record starts empty** when the person enters `catalog` from another tab.
- **It survives** every route under `catalog`, the product page included. What the
  product page adds joins it.
- **It is erased** when a navigation ends outside `catalog`. A reload also erases it.
  The lines stay on their lists. Only the record goes.

## 5. The product page

The mock artboard is `Product`.

The page is `catalog/products/:itemId`. It keeps the tab bar, with Catalog active. From
top to bottom:

1. **The header.** A back control and the product name on one line.
2. **The product.** The photograph at 96 pixels, or the carton glyph. Beside it, the
   whole name, the brand and the size, and a link to its category that opens the catalog
   at that category.
3. **Price at your supermarkets.** One row for each chain of the shopping profile,
   cheapest first, from `productShopPrices`. A row has the logo tile, the chain, the
   price and the unit price under it. The first priced row has the word "CHEAPEST". A
   chain that does not sell the product says "not sold here". The "Seen" note follows.
   This table is on screen when the page opens on a phone.
4. **How the price has moved** (section 6, stage 2).
5. **In your lists** (section 7, stage 2).
6. **Similar products.** The members of the product's group, as product rows with the
   plus of section 4.1. The heading has, at its right end, "Adding to **Weekly shop**"
   with a chevron. It opens the sheet of section 4.3. A press on a similar product opens
   its page.

The states: a loading page draws skeleton bones in the shape of sections 2 and 3. A
failed read says so and offers Try again. A product that is gone says so and offers the
catalog. With no shopping place, section 3 is the existing note with its action.

## 6. The price history (stage 2)

The mock artboards are `Product` and `ProductHidden`.

- **One stepped line for each chain** of the shopping profile that has a history. A
  price holds until it changes, so the line is steps and not a slope.
- **The legend is above the chart**, two entries in a row. An entry is a button with the
  colour, the chain and the price on the day that the chart is read at. Pressed off, its
  name is struck through, and its line and its value leave the chart.
- **A colour belongs to a chain, not to a position.** Hiding one chain does not repaint
  the others. Assign the colours by a stable order of the chains.
- **The colours** are new tokens, five for each theme. They pass the checks of the
  `dataviz` skill for colour blindness on both surfaces:

| Series | Day | Night |
| --- | --- | --- |
| 1 | `#2a78d6` | `#3987e5` |
| 2 | `#eb6834` | `#d95926` |
| 3 | `#1baf7a` | `#199e70` |
| 4 | `#eda100` | `#c98500` |
| 5 | `#e87ba4` | `#d55181` |

- Three Day colours are under 3 to 1 against white. So each line ends in its value in
  the text colour, and the price table stays above the chart.
- **A shopping profile with more than five chains** draws the five with the lowest
  price today. The table still lists all of them.
- **The chart is read by a press or a drag along it.** A dashed line marks the day, and
  the legend shows the prices of that day. It opens on the newest day.
- **Three ranges** under the chart: 1 month, 3 months, 1 year. It opens on 3 months.
- A product with fewer than two prices in the range shows one sentence and no chart.
- The chart has a text alternative: its accessible name says the product and the range,
  and the price table is the table view.

## 7. The table of lists (stage 2)

The mock artboard is `Product`.

- **Every list of every group** that the person can read, under the name of its group.
  The group of the last used list comes first, and that list comes first in it, with the
  words "LAST USED".
- **Each list has a stepper.** It starts at the quantity of the line that has this
  product and exactly the product's name. With no such line it starts at zero.
- **A line that holds the product under another name** sits on its own inset row under
  its list: the name of the line, "Already on this list, with this product", and a
  stepper with the quantity of that line. A list can have several such rows.
- **Every press saves.** From zero, the first plus adds a line as section 4.1 does. A
  minus to zero on a line that this page made deletes it. A minus to zero on a line that
  was there before sets its quantity to zero, which is what a list calls stocked.
- A list that the person only reads has no stepper and says who can add to it.
- What this table adds joins the record of section 4.5.

## 8. The routes, and what opened the sheet

- Add `catalog/products/:itemId` as a page under the `catalog` route.
- Remove `productSheetRoutes()` and its four registrations: under `catalog`, in
  `listSheetRoutes()`, in `basketSheetRoutes()` and under the line page.
- Point the five callers at the page:

| Caller | Where |
| --- | --- |
| The catalog page | `catalog-page.ts`, `open(itemId)` |
| The list page | `list-page.ts`, `productLink` |
| The basket page | `basket-page.ts`, `productLink` (still nothing for a guest) |
| The line page | `line-page.ts`, `pickSimilar` for a reader who cannot edit |
| The sheet itself | removed with the sheet |

- A person who arrives from a list or a basket goes back to it with the back control,
  because the pop is safe. On a cold load the fallback is the catalog.
- Update `routes.spec.ts`. No page path contains the `sheet` segment, and the two new
  sheets of section 4 are declared with `sheet()` under `catalog`.

## 9. What the backend has to serve

No backend plan covers this yet. The next free backend number on `dev` is `0196`. That
plan decides the names and the shapes. This section states the needs.

1. **Three orders on `GET /v1/catalog/items`.** An order by the lowest price at the
   scopes of the read, an order by the lowest unit price, and an order by category
   position and then name. Rows with no price come last in the two price orders. The
   cursor has to work with a price that can be null. Today the prices are attached after
   the page is cut, so the price has to join the listing query.
2. **A price history that a shopper can read.** For one product and the scopes of the
   caller's shopping profile, the intervals of `item_prices` for a range of time, with
   the chain of each scope. It answers the price that a shopper saw, by the policy of
   backend `0080`, not each raw source row. Today only `GET /v1/admin/catalog/item-prices`
   reads this table.
3. **The lists and the lines that hold a product.** For one product, every list that the
   caller can read in every group, with the group, `myPermissions`, `autoApproveLines`,
   and each line of that list that holds the product: its id, its name, its quantity and
   its approval state. `GET /v1/items/:id/lists` answers one row for each list with the
   largest quantity, no line id and no name, only approved lines above zero, and at most
   20 lists. That is not enough for a stepper.

Stage 1 does not wait for any of them.

## 10. Strings

Add English and Spanish for each text in the mock. Remove the keys that no template uses
after the change: `catalog.order.name`, `catalog.order.created`, `catalog.product.close`
and the keys of the Supermarket button that the selector does not use. The Spanish text
is written for the same reader as the English text, not translated word for word.

## 11. Tests

- A spec for each pure function: the selector view, the order list for a query, the
  place of the "Without a price" line, the record of a visit and what taking back does
  in the two cases of section 4.4, the stepped path of a history, the colour of a chain
  after another one is hidden, the start value of each stepper in section 7.
- A spec for the store: the first list it chooses, the record across a product page, and
  the erase on a navigation outside `catalog`.
- Component specs for the row with the plus, the line, both sheets and the product page
  in its four states.
- `routes.spec.ts` for section 8.
- `velista-luna-e2e` gates the staging deploy. Update each step that opened the product
  sheet.

## 12. Not in this plan

- An offer or a discount on a price.
- A product in more than one group (backend backlog `0010`).
- A Night drawing. The page uses colour roles that Night already proves, and the chart
  colours for Night are in section 6.
- A change to the pickers, the basket page or the list page beyond their product links.
- A count of products in the line that heads the list. The read has no total.

## 13. Open questions for the owner

1. **Aisle order as the default.** The owner asked for the order of the database unless
   a better one exists. This plan proposes category position and then name. Say so if
   the order of the database is wanted.
2. **The order by unit price** was added by the designer. Drop its row if it is not
   wanted.
3. **The count on the product page.** The record survives a product page, but that page
   shows no count, because it has no line above the tab bar. Say so if it has to show.
