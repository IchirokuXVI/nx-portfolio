# 0139: a row of the shopping list is a product

> Asked for by the owner on 2026-10-11: "I think it would be way better to merge all lines
> with the same product, and only show products on the basket. You can click on the
> shopping list product line to see which exact zone list lines requested it."
>
> His later points, in his words:
>
> - "It's important to show which lists requested each product. If a line doesn't have
>   products, the line name will be used instead."
> - "In the basket line sheet, you need to be able to edit the quantity of zone list lines.
>   Also, you need to be able to add that same product to other lists, even if it's not
>   even created there. Lists that haven't asked for the product or don't even have it
>   created will appear last, in a collapsable container (collapsed by default)."
> - "The quantity stepper should sit after the change button."
> - "Change it for the X lists should be on the same row as Asked for on X lists, and it
>   should say something like Change for all lists. No need for a big button."
>
> **The mock is the design.** It is `apps/velista/plans/mocks/basket-by-product/`
> (`Main.dc.html`, `AtShop.dc.html`, `RowSheet.dc.html`, `RowLists.dc.html`), published at
> https://claude.ai/artifact/TNn8WVuoznc9Zsabozn9c7. The owner reviewed it in four rounds.
>
> **Build backend plan `0201` first.** If its contract is not on your base branch, say so
> and stop. Nothing of this plan works on the rows of today.
>
> Prerequisite reading: backend `0201`, velista `0090` to `0092` (rows of lists, the live
> basket, nothing is removed), `0078` (the pick of a row), `0115` (similar products and the
> change sheet), `0117` (one field finds and adds), `0132` (the total), `0137` (the
> favourite, then the cheapest), `0138` (parent headings),
> `libs/velista/models/src/lib/basket-view.ts`, `compose-basket-view.ts`,
> `basket-search.ts`, `libs/velista/data-access/src/lib/baskets/` and
> `libs/velista/feature-shopping-lists/src/lib/basket-page/`, `basket-row/`,
> `settle-sheet/`, `row-entries/`.

## Review of 2026-10-11: settle this before you build

A review of pull request #693 checked this plan against the code on `dev`. It found one
defect.

**"Add it to another list" in section 3 fails for a list that holds the product at
zero.** The page raises such a line with the demand route. `coveredLinesSql` in
`core/src/app/baskets/basket-read.sql.ts` covers a line only when its quantity is above
zero or it has a purchase in scope, and backend `0201` section 4 answers "Row not found"
for a line that the basket does not cover. The same point is in the review section of
backend `0201`. Do not build this flow until that plan says how such a line is raised.

## Brief for the agent

### Objective

Draw each row of the shopping list as one product with the lists that ask for it, and
rebuild the sheet of a row around those lists: the quantity of each, and the other lists
that can take the product.

Use the `nx-portfolio-angular-developer`, `design-taste-frontend`, `antislop`,
`antislop-ui` and `antislop-human` skills. Read the velista UI rules in `CLAUDE.md` before
you touch a template.

### Context

Every statement below was read on `dev` at `6cced1bd`.

- **`BasketRow`** (`basket-view.ts`) is mapped from the wire in `basket-mappers.ts`. It
  holds `optionIds`. `basketRowPick` takes the first, and `basketRowProduct` prices a row
  only when it has one option or the shopper chose one.
- **The row** (`basket-row/`) draws the name of the row, then captions: the product and
  its price, the cheaper mark, the shelf mark, who touched it, bought through another
  basket, the usual shop, pending approval, skipped.
- **The sheet of a row** is `SettleSheet` at `sheet/rows/:rowKey/settle`. Its panes are
  settle, product ("Which did you get?"), history and merge. `row-entries` draws the
  "Asks for" and "Got" reels of each list.
- **The page settles a row from its circle and its reel** (`basket-page.ts`: `settle`,
  `revertRow`, `setRowLeft`), through `BasketStore` and `basket-api.ts`.
- **The field at the foot** searches the rows by name (`basket-search.ts`) and the catalog,
  and its catalog cards step the lines that hold a product (`holdingsOf`,
  `changeHolding`).
- **After backend `0201`**: a row has `productId` and no `optionIds`. Each entry has
  `content`, `itemIds`, `favoriteItemId`, `listName`, `zoneId`, `zoneName` and `canWrite`.
  Every write names `lineIds`. A write answers `entries`, `progress` and `skippedCount`,
  with no row. `GET /v1/baskets/:id/products/:itemId/lists` answers the lists that can
  still take a product.

### Target state

1. A row with a product is named by the product. Its caption is the price, then the names
   of the lists that ask for it (section 1).
2. A row with no product is named by its line, as today (section 2).
3. The sheet of a product row shows the lists that ask, each with its quantity, and a
   closed "Add it to another list" (section 3).
4. Every write of the page and the sheet sends the lines of the row (section 4).
5. The field at the foot finds a row by the name of its product and by the names of its
   lines (section 5).

### Scope

- `libs/velista/models`: `basket-view.ts`, `compose-basket-view.ts`, `basket-search.ts`,
  the request models, their specs.
- `libs/velista/data-access`: the basket mappers, API client, store, memory twin and their
  specs.
- `libs/velista/feature-shopping-lists`: the row, the page, the sheet of a row,
  `row-entries`, their specs.
- `libs/velista/ui/assets/i18n/en.json` and `es.json`.
- `apps/velista-luna-e2e`: the specs that name a row.

### Constraints

- **The mock decides the look.** No tinted container, no new colour role. The headings of
  the sheet are the secondary text colour on a hairline.
- **Lists lead.** In the sheet an entry is the name of its list, then "zone, line" under
  it. The owner chose this.
- **The order in an entry is name, Change, quantity.** The Change control belongs to plan
  `0140`. Until that plan is built, draw the quantity alone and no placeholder.
- **The quantity is the control the list page uses** (`QuantityStepper` or the reel the
  row already has). Do not write a third one.
- **Rule D4 holds**: the wire is mapped into the models of velista. No backend type passes
  through.
- **Copy is for people not at home with apps.** The page never says "basket", "row" or
  "line". It says "shopping list" and "list".
- **A guest sees the lists and the quantities and can change nothing** but what a guest
  can today.

### Action boundaries

- Do not build plan `0140` (Change, the catalog to choose) or `0141` (the first buy).
- Do not remove `SwapSheet`. It keeps working on the product of a row until plan `0140`
  replaces it.
- Do not change the backend. If the contract lacks something, say what and stop.
- Do not change the list page, the line page or the catalog tab.

### Progress evidence

- `npx nx build velista` and
  `npx nx run-many -t lint test -p velista/models velista/data-access velista/feature-shopping-lists`
  pass.
- `npx nx e2e velista-luna-e2e` passes on a slot.
- A browser walk at 390 pixels, in English and Spanish, with three lists that ask for one
  product: one row with the sum, the three list names in its caption, the sheet with three
  entries, a quantity changed from the sheet, the product added to a fourth list, and a
  line with no product under its own name.

## 1. A product row

- **The name is the product**: its name, brand and size as the catalog cards print them.
  One line, cut with an ellipsis.
- **The caption** is the price, then the names of the lists that ask, joined with commas.
  A list not served to the reader counts in the words "and 1 more list". The caption is
  one line and is cut at its end.
- **The quantity** is the sum over its lists. The reel and the circle act on the whole row,
  as today.
- The other captions keep their rules and their place after the lists: cheaper option, not
  sold here, not available, who touched it, bought through another basket, usual, pending
  approval, skipped.
- **"Not sold here"** is the mark of a row whose product has no price at the shop of the
  read. It replaces the "Not listed" sink for product rows: the row stays in its group.

## 2. A row with no product

It is named by its line, and its caption is the names of the lists. It has no price and
adds nothing to the total. Its sheet keeps the rename of today, and nothing of section 3
about other lists, because there is no product to add.

## 3. The sheet of a product row

Artboards `RowSheet.dc.html` and `RowLists.dc.html`. The route stays
`sheet/rows/:rowKey/settle`.

- **Title**: the product. Under it: the price of one, and how many are left to get.
- **What was got today**, when the trip has a buy of these lines: how many, at what price,
  and where. One quiet line, with no container.
- **"Asked for on N lists"**, a small heading on a hairline. The text action "Change for
  all lists" on the same row belongs to plan `0140`.
- **One entry for each list**: the name of the list, then "zone, line name". The quantity
  the list asks for is a button that opens the quantity control. It is disabled when
  `demandEditable` is false. An entry on a list not served to the reader reads "Another
  list" with its quantity and no control.
- **"Add it to another list"**, last and closed. It is a disclosure, and it is not drawn
  for a guest or when the read of section 5 of backend `0201` answers no list.
  - Open, it reads the lists once and shows a loading row, then the lists, or a failed
    row with a retry.
  - A list that holds the product at zero shows "zone, line name" and a quantity of 0.
  - A list that does not hold it shows the zone alone and a quantity of 0.
  - Setting a quantity above zero raises the line that exists (the demand route), or adds
    a line (`POST /v1/baskets/:id/lines` with the name of the product and its id). The
    list then moves up among the lists that ask.
- **The buttons**: "Got the other N" (or "Got all N"), and "They had none". The skip keeps
  its place in the sheet as today.
- **Removed from the sheet**: the product pane ("Which did you get?"). A row is one
  product, so there is nothing to ask.
- The history pane stays.

## 4. Writes

- Settle, revert, skip and "they had none" send `lineIds`: every entry of the row the page
  holds that is on a list served to the reader.
- A settle sends `itemId` as the product of the row.
- A demand sends the one `lineId`.
- The page patches its entries from the answer, then refetches as it does today. It no
  longer expects a row or `replacedRowKey` back.
- A refused `from` (someone else changed the row) is handled as today: refetch and say so.

## 5. Search and adding

- `basket-search.ts` matches the name of the product, its brand, and the name of each
  line of the row. A search for "leche" finds the row of a milk whose line is called
  "Leche para el café".
- The catalog cards of the field keep their steppers. `holdingsOf` reads the entries of
  the row whose `productId` is the product of the card.

## 6. Strings and tests

**Strings.** New keys under `basket.row` and `basket.sheet` in both files: the caption of
lists and "and N more", "Asked for on N lists", "Another list", "Add it to another list",
its loading, failed and retry rows, "Not sold here".

**Tests.**

- Models: the caption of one, two and four lists and of a list that is not served, the
  product of a row, the search by product and by line name, the total over product rows.
- Mappers: a row with a product, a row with none, an entry with no list.
- The row: the name, the caption, "Not sold here", a row with no product.
- The sheet: the entries, a quantity that cannot be edited, the disclosure closed, open,
  loading, failed, a list raised from zero, a line added, a guest.
- The page: every write sends the lines of the row.
- The twin serves the new shapes, so the specs run with no backend.

## 7. Not in this plan

Change, Change for all lists and the catalog to choose (plan `0140`). The first buy (plan
`0141`). A buy made through another basket and the speed of the sync, which another
session plans after this redesign.
