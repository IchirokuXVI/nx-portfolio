> **PR:** [#692](https://github.com/IchirokuXVI/nx-portfolio/pull/692)

# 0137: the favourite goes in the basket, and the cards say so

> Asked for by the owner on 2026-10-11, after plan `0135` was built (PR #690): "Add an
> info icon to the 'Any of these will do' section, explaining that favorite makes that
> product the selected one on the basket always, independent of price. If no product is
> set as favorite, the cheapest product will be set instead." And: "the favorite product
> automatically moves to the first position, if no product is set as favorite, the
> cheapest one will be shown first (i think it's already ordered by price)".
>
> **Two things the owner assumed are not true today.** Section 1 states them. One of them
> is in the backend, and this plan does not build it.
>
> The mock is `apps/velista/plans/mocks/line-and-parent-lines/`: `Main.dc.html` has the
> info button, and `ProductsInfo.dc.html` is the sheet.
>
> Prerequisite reading: velista `0135` sections 3, 3.1 and 3.2, backend `0199`, velista
> `0078` (the pick of a basket row), `libs/velista/models/src/lib/line-products.ts`,
> `libs/velista/feature-lists/src/lib/line-page/`, and
> `libs/velista/models/src/lib/basket-view.ts` (`BasketProduct`).

## Brief for the agent

### Objective

Put the cards of a line in the order the basket will choose from (the favourite, then
the cheapest), and add an info button beside "Any of these will do" that says so.

Use the `nx-portfolio-angular-developer`, `design-taste-frontend`, `antislop`,
`antislop-ui` and `antislop-human` skills.

### Context

Every statement below was read on `dev` at `78aaabf6`.

- **The cards are not in price order.** `selectLinePage` orders them with
  `favoriteFirst`: the favourite, then the products as the line holds them, which is the
  order they were added in. The card with the lowest price takes the word CHEAPEST and
  stays where it is.
- **The prices of a line are read a few at a time.** `LinePage` reads the cards on
  screen and the next two (`CARDS_ON_ARRIVAL` plus `CARDS_READ_AHEAD`), and more as the
  rail scrolls. An order by price needs every price it compares.
- **The supermarket sheet already reads the first 20 products**
  (`LINE_PRICED_PRODUCTS_MAX`).
- **The basket does not read the favourite.** Backend `0199` rule 9 keeps
  `favoriteItemId` off basket rows on purpose.
- **The basket does not take the cheapest product either.** The pick of a basket row is
  the first product that was added to the line (`BasketProduct`: "The pick is still the
  first option added and not the cheapest", backend `0050` and `0066` section 6). The
  pick sheet only marks which option is the cheapest.
- **A sheet is a child route** declared with `sheet()`, and its path holds the `sheet`
  segment (CLAUDE.md).
- **`InfoIcon` exists** in `libs/velista/ui/src/lib/icons/icons.ts`.

### Target state

1. The cards of a line are ordered: the favourite first, then the other products from
   the cheapest up, then the products with no price (section 2).
2. An info button sits beside the heading "Any of these will do". It opens a sheet with
   four sentences (section 3).
3. The plan states what the backend has to do for those sentences to be true (section 4).

### Scope

- `libs/velista/models`: the order of the cards, as a pure function with a spec.
- `libs/velista/feature-lists`: the selector, the reads of the line page, the info
  button and the info sheet.
- `libs/velista/feature-shell`: one sheet route.
- `libs/velista/ui/assets/i18n/en.json` and `es.json`.
- The mock folder and its `canvas.json`.

### Constraints

- **The mock decides the look.** The info button is the info glyph in the secondary text
  colour, with a full touch target, directly after the words of the heading.
- **The cards move once, not once for each price.** Section 2 says how.
- **No new colour role and no tinted container.**
- **Copy is for people not at home with apps.** Short sentences, ordinary words.
- **Component styles use tokens.**

### Action boundaries

- Do not change the backend, the contracts or `openapi.json`.
- Do not change the basket or the pick sheet. The owner starts a session of his own
  about the basket.
- Do not change the word CHEAPEST or which card takes it.

### Progress evidence

- `npx nx build velista` and `npx nx run-many -t lint test -p velista/models
  velista/feature-lists velista/feature-shell` pass.
- A browser walk at 390 pixels in English and Spanish: a line with no favourite draws
  the cheapest card first, a star moves that card to the front, and the info button
  opens the sheet and Close returns to the line page.

## 1. What is true today, and what is not

| The owner's sentence | Today |
| --- | --- |
| The favourite moves to the first position | True since plan `0135` |
| With no favourite, the cheapest is first | **Not true.** The cards keep the order the products were added in |
| "I think it's already ordered by price" | **Not true**, for the same reason |
| The basket always shows the favourite | **Not true.** The basket does not read the favourite |
| With no favourite, the basket shows the cheapest | **Not true.** The basket shows the first product that was added |

The first three are the front end, and this plan fixes them. The last two are the
backend. Section 4 states what it has to do. Until it does, the sheet of section 3 says
something the basket does not do yet.

## 2. The order of the cards

- **The favourite is first.**
- **Then the products with a price, from the cheapest up.** The comparison is the one
  that gives the word CHEAPEST: the price for each kilo or litre first, then the price.
  Two products with the same price keep the order the line holds them in.
- **Then the products with no price**, and with a supermarket chosen for the line, the
  products it does not sell, in the order the line holds them.
- With a supermarket chosen (plan `0135` section 3.2) the prices compared are the prices
  at that supermarket, as for the word CHEAPEST.
- **The page reads the prices of the first 20 products when it opens**, and not three
  cards at a time, because an order by price needs every price it compares. Products
  after the twentieth keep the order of the line after the sorted ones, and their prices
  are read as the rail reaches them, as today.
- **The cards move once.** While a price among those 20 is still being read, the cards
  stay as plan `0135` draws them: the favourite, then the order of the line. When the
  last of them is read, the cards take the order above. Sorting as each price arrives
  moves a card under a thumb several times in one second.
- A press on a star moves the cards at once, because every price is already read.

## 3. The info button and its sheet

Artboards `Main.dc.html` and `ProductsInfo.dc.html`. Route `sheet/about-products`.

- **The button** is directly after the words "Any of these will do", before "Change".
  Its accessible name is "Which one you get when you shop". It is drawn on every line that
  has at least one product, also for a reader who may not edit.
- **The sheet** has a title, "Which one you get when you shop", four sentences and Close:
  1. "Any of these products will do for {line}. Your shopping list shows one of them."
  2. "If you mark a favourite with the star, your shopping list always shows the
     favourite. It does so even when another product costs less."
  3. "With no favourite, it shows the cheapest one."
  4. "The products here are in the same order: the favourite first, then the cheapest."
- **The sheet never says "basket".** The app calls that screen "Shopping list" ("Lista de
  la compra"), in the bar at the foot and in its own title, so the sentences use that
  word.
- Close, Escape, the scrim and back all dismiss it onto the line page.
- A line with no products has no button, because it has nothing to choose from.

## 4. What the backend has to do

No backend plan for this exists. The owner said on 2026-10-11 that he will start a
session of his own about the basket. This section is the need, not the design.

1. **The pick of a basket row is the favourite of its line**, when the line has one and
   the row still offers that product.
2. **With no favourite, the pick is the cheapest product** at the scopes of the read.
   The comparison of section 2 is the one the cards use. With no price at all, the pick
   stays the first product that was added, as today.
3. **A pick that a shopper changed by hand** in the pick sheet has to win over both, or
   the sheet stops working. The plan has to say for how long.
4. **A row that merges lines of several lists** can hold two favourites. The plan has to
   say which one the row shows.

Sentences 2 and 3 of the sheet are true only after points 1 and 2. **Merge this plan's
pull request together with that backend change, or change the two sentences first.**

## 5. Strings and tests

**Strings.** New keys under `list.page.about` in both files, and
`list.page.aboutLabel` for the name of the button.

**Tests.**

- The order, as a pure function: the favourite first, the rest by price, a tie keeps the
  order of the line, products with no price last, the prices of one supermarket, nothing
  moves while a price is loading, products after the twentieth keep their place.
- The selector: the cards come out in that order, and CHEAPEST stays on the lowest
  price.
- The line page: the info button is there with products and absent with none, it opens
  the sheet, and the page asks for the prices of every product of a short line.
- The sheet: it names the line and closes onto the line page.
- `routes.spec.ts`: the new sheet, and the count of sheets.

## 6. Not in this plan

The basket and its pick sheet, the estimate of plan `0132`, and the order of the rows of
the products page, which stays the order of the line under its two headings.
