# 0140: a line takes another product from the shopping list

> Asked for by the owner on 2026-10-11: "Each zone list line will be displayed with a
> Change button that lets you select a different product for it. When you click on change,
> you will see all related products (the products assigned to that line and other products
> in his same group/s, there will also be a button to open the catalog and search for a
> different item. If you open the catalog this way, the page must be different enough that
> you can differentiate between having the actual catalog open or just searching to select
> one product for a line). You can also change the product for all lines at the same
> time."
>
> His later points, in his words:
>
> - "On these lines and Similar products will be merged, even if they come from different
>   sources. The user only needs to know those are other products he can choose quickly. No
>   info message needed."
> - "One checkbox with Keep it for next time is perfect."
> - On a change for this trip only: "it will be recorded later on if needed but for now
>   just on the device is perfect."
> - "The catalog needs way more detail, more like the current catalog page or the product
>   search that is available in zone lists and basket list."
> - "I don't like the checkboxes, make them more stylized and a bit smaller."
>
> **The mock is the design.** It is `apps/velista/plans/mocks/basket-by-product/`
> (`RowSheet.dc.html`, `Change.dc.html`, `ChangeAll.dc.html`, `CatalogPick.dc.html`),
> published at https://claude.ai/artifact/TNn8WVuoznc9Zsabozn9c7.
>
> **Build velista plan `0139` and backend plan `0202` first.** If either is not on your
> base branch, say so and stop.
>
> Prerequisite reading: velista `0139`, backend `0201` section 1 and `0202` section 3,
> velista `0115` (similar products and `SwapSheet`), `0134` (the catalog tools and its
> cards), `0137` (the order of the cards of a line), `0130` (one header), the sheet rule
> and the back rule in `CLAUDE.md`,
> `libs/velista/feature-shopping-lists/src/lib/swap-sheet/`,
> `libs/velista/feature-catalog/src/lib/catalog-page/`,
> `libs/velista/models/src/lib/product-group.ts`, `catalog-tools.ts`,
> `libs/velista/data-access/src/lib/catalog/group-members.ts` and
> `libs/velista/feature-shell/src/lib/routes.ts`.

## Brief for the agent

### Objective

Add Change to each list of a product row and "Change for all lists" to the sheet, with one
sheet that offers other products and a catalog page opened only to choose one.

Use the `nx-portfolio-angular-developer`, `design-taste-frontend`, `antislop`,
`antislop-ui` and `antislop-human` skills.

### Context

Every statement below was read on `dev` at `6cced1bd`.

- **`SwapSheet`** is at `sheet/rows/:rowKey/swap`. It shows the other members of the group
  of the product of the row, priced at the scopes of the basket, cheapest first. A pick
  sends `PATCH /v1/lines/:id` with `itemIds` on every line of the row. It is offered only
  when the reader may write every list of the row.
- **The cheaper mark** on a row (`groupCheaper`) says a member of the group costs less.
- **`BasketStore.choose(rowKey, itemId)`** holds a choice for the visit only, and sends it
  as `itemId` on the settle.
- **The catalog page** (`catalog-page/`) has a search field, a supermarket selector, a
  category selector, an order, and product cards with a quick add. A bar at its foot names
  the list it adds to. It takes no line as a target, and no page opens it to choose.
- **A sheet is a child route** declared with `sheet()`, under the `sheet` segment. A back
  control names a fallback URL.
- **After backend `0202`**: `POST /v1/baskets/:id/lines/product` takes `lineIds`, `itemId`
  and `keep`. It rewrites the buys of the trip for those lines. With `keep` it adds the
  product to each line and makes it the favourite. A guest is refused.
- **After backend `0201`**: a line follows the product of its latest buy until the trip
  ends, and an entry carries `itemIds`, `favoriteItemId` and `canWrite`.

### Target state

1. Each entry of the row sheet has Change, before its quantity. The heading row has
   "Change for all lists" (section 1).
2. The change sheet offers one list of products, a link to the catalog, the checkbox and
   one button (section 2).
3. The catalog opens to choose one product, and looks different from the catalog tab
   (section 3).
4. A change is kept, or holds for this trip (section 4).
5. `SwapSheet` and its route are removed, and the cheaper mark opens the change sheet.

### Scope

- `libs/velista/feature-shopping-lists`: the row sheet, a new change sheet, the removal of
  `swap-sheet/`, the page (`canSwap`, `openSwap`, the cheaper mark).
- `libs/velista/feature-catalog`: the catalog page in its mode to choose. Share the tools
  and the cards of the page. Do not copy them.
- `libs/velista/data-access`: the client of the new route, the choice held on the device.
- `libs/velista/models`: the list of products to offer, as a pure function with a spec.
- `libs/velista/feature-shell`: the sheet routes.
- `libs/velista/ui`: the small checkbox, when no checkbox of that look exists yet.
- `libs/velista/ui/assets/i18n/en.json` and `es.json`.

### Constraints

- **The mock decides the look.** One list with no headings and no info text. The checkbox
  is 18 pixels with a 14 pixel label in the secondary colour, and it is not the native
  control. Its touch target is the full row.
- **Change is not drawn for a guest**, for an entry on a list that is not served, or for
  a row with no product.
- **"Change for all lists" covers the lists the reader may change.** When that is not all
  of them, the sheet says for how many lists the change is, in its title.
- **A buy already made today takes the new product.** The page says nothing about it. The
  owner removed that message.
- **The catalog to choose is the catalog page, not a second page.** One component with a
  mode, or shared parts. A rule of the catalog tab that changes later must reach both.
- **The header rule and the back rule hold.** The page to choose has one `PageHeader` with
  `leading="close"`, and its close names the change sheet as its fallback.

### Action boundaries

- Do not change the backend. If the contract lacks something, say what and stop.
- Do not change the line page or its products page. A change made there touches no buy.
- Do not store a choice for this trip on the server.
- Do not change what the quick add of the catalog tab does.

### Progress evidence

- `npx nx build velista` and
  `npx nx run-many -t lint test -p velista/models velista/data-access velista/feature-shopping-lists velista/feature-catalog velista/feature-shell`
  pass. `routes.spec.ts` and `no-unguarded-history-back.spec.ts` pass.
- `npx nx e2e velista-luna-e2e` passes on a slot.
- A browser walk at 390 pixels, in English and Spanish: change one list with the checkbox
  on and see the favourite on the line page, change one list with it off and see the line
  page unchanged, buy it and reload and see the row still under the new product, change
  all lists, and choose a product from the catalog.

## 1. Where Change is

- In the row sheet (`RowSheet.dc.html`), each entry reads: the list, Change, the quantity.
  Change is drawn when `canWrite` is true for that entry and the reader is not a guest.
- "Change for all lists" is a text action at the end of the heading row "Asked for on N
  lists". It is drawn when Change is drawn on two or more entries.
- The cheaper mark of a row opens the change sheet for all lists.

## 2. The change sheet

Artboards `Change.dc.html` and `ChangeAll.dc.html`. Routes
`sheet/rows/:rowKey/change/:lineId` and `sheet/rows/:rowKey/change`.

- **Title**: "Change the product", or "Change the product for N lists". Under it: "list,
  line name" for one, or the names of the lists.
- **One list of products**, each a radio row with its name and its price:
  1. The product chosen now, marked "Chosen now".
  2. The other products of the line (of every line, for all lists) and the members of
     their groups, with no heading between them and each product once. The order is the
     order of velista plan `0137`: the price for each kilo or litre, then the price.
  3. The products the shop of the read does not sell, marked "Not sold here", last. They
     can still be chosen.
  A member that costs less than the chosen one keeps the words "cheaper option".
- **"Look for another one in the catalog"**, a link row after the list.
- **The checkbox "Keep it for next time"**, on when the sheet opens.
- **The button**: "Use this product", or "Use it for the N lists". It is disabled until
  another product is chosen.
- Loading shows rows of the same height. A failed read shows one row with a retry. With no
  other product the list holds the chosen one and the link to the catalog.
- Close, Escape and the scrim go back to the row sheet.

## 3. The catalog, to choose

Artboard `CatalogPick.dc.html`. It is a child route under the change sheet route.

- **The same tools as the catalog tab**: the search field, the supermarket selector (set
  to the chain of the shop of the read when there is one), the category selector and the
  order.
- **The same cards**, with the price, the price for each kilo or litre, the brand and the
  size. A card has a radio in place of the quick add. A press on a card chooses it and
  does not open the product page.
- **Four differences from the tab**, so that nobody takes one for the other:
  1. The header has a close control and the title "Choose a product".
  2. The bar of tabs is not drawn.
  3. A bar at the foot names the list and the line the product is for, with the button
     "Use this product".
  4. Nothing on the page adds to a list.
- "Use this product" goes back to the change sheet with that product chosen in the list.
  The checkbox and the final button stay in the change sheet. Close goes back and changes
  nothing.
- Loading, no result and a failed read use the states of the catalog tab.

## 4. What a change does

- **Checkbox on**: `POST /v1/baskets/:id/lines/product` with `keep: true`. The product is
  now the favourite of each line. The page refetches.
- **Checkbox off, and the lines have a buy today**: the same route with `keep: false`. The
  buys take the new product, and the lines follow it until the trip ends.
- **Checkbox off, and no buy yet**: nothing is sent. The choice is held on the device, for
  each line, in the store that `choose` uses today. The row is drawn under the chosen
  product on this device only. The next buy sends it as `itemId`, and from then on the
  backend answers it. A reload before that buy forgets the choice. The owner accepted
  this.
- A refused change (a list the reader may not edit, a guest) shows the error copy the page
  already has and changes nothing.

## 5. Strings and tests

**Strings.** New keys under `basket.change` in both files: the two titles, "Chosen now",
"Not sold here", "Look for another one in the catalog", "Keep it for next time", the two
buttons, "Change", "Change for all lists", and for the catalog to choose: its title, the
bar at the foot and its button.

**Tests.**

- The list of products as a pure function: the chosen one first, each product once, the
  order by price, not sold last, the union over several lines.
- The change sheet: one list and all lists, the button disabled, the three paths of
  section 4, the checkbox, a failed read, a guest who reaches the URL.
- The catalog to choose: its four differences, a card chooses and does not navigate, the
  way back with and without a choice.
- The row sheet: Change on the entries that allow it, "Change for all lists" with one and
  with two such entries.
- `routes.spec.ts`: the new sheets under the marker, the swap route gone, the count.

## 6. Not in this plan

A choice for this trip that survives a reload before its first buy, and a change of the
product of a row with no product (its line takes products on the line page).
