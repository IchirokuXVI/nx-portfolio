# 0145: a row of a list shows its name and its product

> Asked for by the owner on 2026-10-11: "List lines will show always two lines: user
> assigned label, [and] product name, brand, format, price and any other mandatory info
> that is usually shown with products. [...] Lines can have more than one product, but they
> will show the cheapest or favourite product."
>
> His later choices, in his words:
>
> - "Let's go with B + product images with the '+' icon in the square." B is the design in
>   which the name of the product stands in for a missing name, and only a missing product
>   asks.
> - "Move the price to the top, with the user label."
>
> **The mock is the design.** It is `apps/velista/plans/mocks/list-lines/`
> (`Main.dc.html`, `States.dc.html`), published at
> https://claude.ai/artifact/Jg7JBG2LdNNj4FFaM1w6Ve.
>
> **Build velista plan `0144` and backend plan `0207` section 2 first.** If `Line` has no
> `named`, or the lookup accepts no `prices`, on your base branch, say so and stop.
>
> **Four points of this plan are mine and wait for the owner**: the rows lose their card
> surface for the due rows and the trip rows too (section 1), one status word on a row
> (section 4), the number in the header (section 6), and the size of the target of "Choose
> a product" (section 5).
>
> Prerequisite reading: velista `0144`, backend `0207` section 2, velista `0043` (the line
> is a quantity: the reel and the indicators), `0082` (the filter and the search of a
> list), `0088` and `0089` (trips and due rows), `0130` (one header), `0137` section 2 (the
> order of the cards of a line), `0132` (what the shopping list costs), backend `0201`
> section 1 (the product a line counts as in the basket),
> `libs/velista/ui/src/lib/list/line-row.html`, `line-row.scss`, `line-row.ts`,
> `list-header.html`, `libs/velista/feature-lists/src/lib/select-list-state.ts`,
> `libs/velista/models/src/lib/list-view.ts`, `line-products.ts`, `compose-list-view.ts`,
> `libs/velista/data-access/src/lib/catalog/item-names.ts` and
> `libs/velista/ui/src/lib/styles/_semantic.scss`.

## Brief for the agent

### Objective

Draw each row of a list as a picture, a name with a price, and a product with its brand and
its size, for the one product the line shows.

Use the `nx-portfolio-angular-developer`, `design-taste-frontend`, `antislop`,
`antislop-ui`, `antislop-human` and `antislop-layoutmobile` skills.

### Context

Every statement below was read on `dev` at `6cced1bd`.

- **The row is a card** with a border and a radius (`line-row.scss:6`). Its body is a
  column: the name, then a detail line, then the indicators, then a caption. It grows with
  each of them. `--app-line-row-height` is 56 pixels, and nine other components use that
  token.
- **The detail line** is "size · brand", and only for a line with exactly one product
  (`select-list-state.ts:266`). `ListPage._detailOf` reads the product from `ItemNames`.
- **`ItemNames.ensure`** asks `POST /v1/catalog/items/lookup` for every product of every
  line, in chunks of `ITEM_LOOKUP_MAX_IDS` (`item-names.ts:101`).
- **The list page has no price.** `LineRowVm` has no price field. Only the line page reads
  prices, one request for each product (`line-product-prices.ts`).
- **A line carries `itemIds`, `groupItemIds`, `favoriteItemId` and
  `preferredSupermarketId`.**
- **`lineProductPrices`** (`line-products.ts:57`) marks the cheapest of the products of a
  line with `compareGroupOffers`: the price for each kilo or litre, then the price.
  `favoriteFirst` puts the favourite first. No function answers one product for a line.
- **The indicators** (bought, not available, claimed) are a row of words under the name,
  and the caption of an approval is one more line (`line-row.html:107`, `:147`).
- **No picture component exists.** Three places draw a picture with the same markup: the
  product row of the catalog (`product-row.ts:110`), the cards of the line page
  (`line-product-rail.ts:46`) and the products page. Each falls back to `lib-product-icon`.
- **The header of a list** says "7 of 12 pending" over a bar (`list-header.html`).
- **The accessible name of a row** is its name, its detail and its quantity
  (`line-row.ts:275`).
- **After backend `0207`**: the lookup accepts `prices: true` and answers the best offer
  of each product and its price at each chain, at the scopes of the reader.
- **After velista `0144`**: one function answers the name to draw for a line, and says
  whether a person named it.

### Target state

1. One pure function answers the product a line shows (section 2).
2. A row is a picture, two lines of text and the quantity (section 3), in every state of
   `States.dc.html`.
3. One status word ends line 2, and a row has no third line (section 4).
4. A row with no product asks for one (section 5).
5. The header says what the pending lines cost (section 6).
6. The list page reads prices in the read it already makes for names (section 7).

### Scope

- `libs/velista/models`: the product a line shows, the new fields of `LineRowVm`, the cost
  of a list, the order by name, and their specs.
- `libs/velista/data-access`: `ItemNames` (or a store beside it) reads prices, and the
  client of the lookup sends `prices`.
- `libs/velista/ui/src/lib/list`: `line-row`, `line-list`, `list-header`, the skeleton of
  a row, and one new picture component.
- `libs/velista/ui/src/lib/styles`: the tokens of the new row.
- `libs/velista/feature-lists`: `select-list-state.ts`, the list page.
- `libs/velista/ui/assets/i18n/en.json` and `es.json`.

### Constraints

- **The mock decides the look.** A row is flat on a hairline. It is not a card.
- **Two lines, always.** Nothing adds a third line to a row. What is under a row today
  (the approve and reject buttons, a failed write, an overwritten write) stays under it.
- **The row is still one button that opens its sheet**, with the reel inside it. The reel,
  the reorder mode, the editor mark and the comment count do not change.
- **One product for each line, from one function.** The line page uses the same function
  for its first card. The row and the card never disagree.
- **The size and the brand are never cut before the name of the product is.** On line 2
  only the name of the product gives way.
- **Every size is a token.** `token-hygiene.spec.ts` refuses a raw pixel value. Do not
  change `--app-line-row-height`. Add the tokens the row needs.
- **A price is formatted with `Intl`**, in the language of the reader.
- **Colour is never the only carrier of a meaning.** The star has an accessible name, and
  a status is a word.
- **One list of 100 lines makes no more than the requests of today plus the prices**: the
  lookup, in the chunks it has now.

### Action boundaries

- Do not change the backend. If the lookup lacks something, say what and stop.
- Do not change what a press on a row opens, the sheet of a row, or the reel.
- Do not build the catalog that chooses a product. Plan `0146` owns it. Until it is built,
  the plus and "Choose a product" open the products page of the line
  (`…/lines/:lineId/products`).
- Do not change the rows of the shopping list.
- Do not replace the picture markup of the catalog or of the line page with the new
  component. That is a later cleanup.

### Progress evidence

- `npx nx build velista` and
  `npx nx run-many -t lint test -p velista/models velista/data-access velista/ui velista/feature-lists`
  pass.
- `npx nx e2e velista-luna-e2e` passes on a slot.
- A browser walk at 390 pixels and at 320 pixels, in English and Spanish, on a slot with
  the demo seed and prices: each state of `States.dc.html`, the search with a painted
  match, the order A to Z, the reorder mode, a list of 100 lines, and a list with no price
  at all. The pull request holds a screenshot of the list and states the count of requests
  the list page makes.

## 1. The surface of a row

A row is 68 pixels high, flat, with a hairline under it and no card around it
(`Main.dc.html`). The list has a hairline over its first row.

The due rows and the trip rows of the same page take the same surface, so one list does
not hold two kinds of row. Their content does not change. This is my reading: the mock
draws neither.

## 2. The product a line shows

One pure function in `velista/models`. It takes the line and the prices of its products,
and answers one product or none. The products of a line are its own and those of its group.

1. **The favourite**, when the line holds it. It wins also when it has no price.
2. **The cheapest product with a price.** With a supermarket on the line
   (`preferredSupermarketId`), only the prices at that chain count. With none, the lowest
   price near the reader counts. The comparison is `compareGroupOffers`: the price for each
   kilo or litre, then the price. A tie keeps the order of the line.
3. **The first product of the line**, when none has a price.
4. **Nothing**, for a line with no product.

The price of the row is the price that made the choice: the price at the chain of the line,
or the lowest near the reader. A favourite is priced the same way.

This is the rule of backend plan `0201` section 1 for the basket, without the buy of a
trip. When that plan is built, both give the same product for a line that was not bought
today.

The function of velista `0144` section 1 now takes this product for the name of a line
that is not named.

## 3. The two lines

**The picture**, a square of 44 pixels: the photo of the product the row shows, or the
product icon when it has none or the photo fails. It is decoration and has no accessible
name. Build it once, as a component of `velista/ui`.

**Line 1** is the name, then the price.

- A named line: its name, in the heavier weight.
- A line that is not named: the name of the product, in the regular weight.
- The match of a search is painted on this name, as it is today.
- The price of one unit ends the line. A product with no price reads "No price", smaller
  and in the muted colour. A line with no product has nothing there.
- The name is cut with an ellipsis. The price is never cut.

**Line 2** is the product.

- A named line: the name of the product, then its brand and its size.
- A line that is not named: its brand and its size only. The name is already on line 1.
- A star before the product when it is the favourite. Its accessible name is "Favourite".
- "+2" after the size when two more products of the line will do. Its accessible name
  says so in words.
- A product with no brand shows its size, and a product with neither leaves the place
  empty.
- The name of the product is cut first, to no less than a few letters. The brand and the
  size are cut only on a row that also carries a status word.

**A settled line** (at zero, with a buy behind it) draws its name in the muted colour and
its quantity with no box, as it does today.

**The accessible name of the row**: the name, the product with its brand and its size when
the line is named, the price, the quantity. The status stays in `aria-describedby`.

## 4. One status word

The words a row shows under its name today move to the end of line 2, and a row shows one
of them:

1. "Waiting for approval", or the word of a line that was turned down.
2. "<name> is buying this".
3. "Not available".
4. "Bought".

The first that applies is drawn. All that apply are still in the description of the row
for a screen reader. The violet edge of a line that waits stays.

A status word takes room from the product on line 2 (`States.dc.html`, "Waiting for
approval"). The owner saw that row and did not ask for a change.

## 5. A row with no product

- The square is a dashed square with a plus. It is a button of 44 pixels, with the
  accessible name "Choose a product for <name>".
- Line 2 reads "Choose a product", in the amber text colour. It is a second button for the
  same action. Its target is the height of line 2, which is under 44 pixels. The square is
  the full size target for the same action. This is my reading of the mock.
- Both open the catalog to choose one product (plan `0146` section 2).
- A reader who may not edit the line sees the product icon in a plain square, and "No
  product" in the muted colour. Neither is a button.
- The right to edit is the rule the products page has today: the reader may manage the
  list, or may write and the line is not approved.

## 6. What the list costs

At the end of the line "6 of 7 pending" the header shows "~14,29 €".

- It is the sum, over the lines with a quantity above zero, of the quantity times the
  price of the product the row shows.
- A line with no product or no price adds nothing.
- With no priced line, nothing is drawn.
- It is text in this plan, with an accessible name that says it is an estimate for the
  lines that have a price. It opens nothing. Velista `0132` has a popover for the same
  number on the shopping list, and joining the two is a later plan.

The owner chose design B, which draws this number, and did not speak about it.

## 7. Where the prices come from

- The read that fetches the products of the lines (`ItemNames.ensure`) asks the lookup
  with `prices: true`. One read gives the name, the brand, the size, the photo and the
  prices.
- A product not yet loaded leaves the name of a named line in place, and draws the picture
  and line 2 as a skeleton of the same size. The row does not change height when the read
  answers.
- A failed read leaves the rows with their names and no product. The page says so once,
  the way it says a failed read of the trips, with a retry.
- A line that changes its products, or a line that arrives over the socket, asks for the
  products it lacks.

## 8. The order by name

The order A to Z of the filter (`compose-list-view.ts:286`) sorts on the name the row
draws. The search still matches the name of the line, the names of its products and the
names of their categories.

## 9. Strings and tests

**Strings.** New keys in both files: "No price", "Choose a product", "No product", the
accessible names of the plus, of the star and of "+N", the accessible name of the cost, and
the sentence of a failed read of the products.

**Tests.**

- The product a line shows: the favourite with and without a price, the cheapest by the
  price for each kilo, a tie, a supermarket on the line, no price at all, a group, no
  product.
- The cost of a list: quantities, a line at zero, a line with no price, no priced line.
- `selectListState`: each state of `States.dc.html` as a view model.
- The row: the two lines of a named line and of a line that is not named, the price and
  "No price", the star, "+N", one status word by the order of section 4, the plus and its
  two buttons, the row of a reader who may not edit, the skeleton, the accessible name.
- The header: the cost present and absent.
- `ItemNames`: the lookup asks for prices, in chunks, and a failed read.
- The order A to Z with a line that is not named.
- `line-row.spec.ts` has tests that name the old detail line ("draws the format and the
  brand under the name"). Rewrite them for line 2. Do not delete a test of the reel, the
  tap or the reorder mode.

## 10. Not in this plan

- The catalog that chooses a product (plan `0146`).
- The supermarket of the line drawn on its row. The owner wants it while shopping, and has
  said he will come back to it.
- A press on the cost.
- One picture component for the catalog and the line page.
