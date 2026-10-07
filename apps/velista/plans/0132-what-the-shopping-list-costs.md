# 0132: what the shopping list costs

> Asked for by the owner on 2026-10-07. The shopping list tab (the basket page) shows
> a price on each row and no total. The owner wants an estimated total of the lines on
> screen, a thin bar of how much of it is bought, and one place that says what is
> behind the number.
>
> **No backend plan is needed.** Every row of a basket and every price arrive in one
> read (`BasketApi.getBasket`, no cursor), so the total is a sum the client makes from
> what it already holds. The wire does not change.
>
> **The mock is the design, and the owner chose it.** Five alternatives were drawn and
> the owner picked the one in `mocks/basket-total/`. Do not bring the others back.
>
> Prerequisite reading: velista `0062` (a price on every product), `0075` (the filter
> sheet and its chips), `0078` and `0102` (prices from one shop), `0079` (the sticky
> tools bar), `0091` (the basket that is always there),
> `libs/velista/models/src/lib/basket-view.ts` (`BasketRow`, `basketRowProduct`,
> `shownOffer`, `basketShelfMark`), `compose-basket-view.ts`,
> `libs/velista/data-access/src/lib/baskets/basket-view-store.ts`, and the page in
> `libs/velista/feature-shopping-lists/src/lib/basket-page/`.

## Brief for the agent

### Objective

Show on the basket page an estimated total of the visible lines, a bar of the bought
part, a popover that explains the number, and one small row for a basket where no line
has a price.

Use the `nx-portfolio-angular-developer` skill, and the `design-taste-frontend` and
`antislop` skills for the template and the styles. Read the velista UI rules in
`CLAUDE.md` before you touch the template.

### Context

- **All rows are in the client.** `BasketStore.rows` holds the whole basket.
  `BasketViewStore.visibleRows` holds what the filter leaves. Nothing is paginated.
- **A row has no price of its own.** The row draws the price of one product:
  `basketRowProduct(row, products, chosenId)` picks the product, and
  `shownOffer(product, atShop)` picks its price. With `atShop` true the price is the
  chosen shop's (`product.atShop`). Without it, the price is the cheapest at the
  basket's scopes (`product.offer`).
- **A price is a number in major units** (`2.85`), with a nullable `currency`. It is
  the price of one unit of the product.
- **The quantities of a row** are `asked`, `bought`, `boughtElsewhere` and `left`.
  The state is `WANTED`, `PARTLY`, `DONE`, `NOT_AVAILABLE`, `SKIPPED` or `REMOVED`,
  and the server computes it.
- **The shop choice is the only filter the server sees.** `setShop` reads the basket
  again at that shop. Order, grouping, lists, the usual switch and the search are
  applied in the client.
- **No total exists today.** The only sum of money in velista is `PurchaseSpend` in
  the purchase history.
- **PR #658** changes the sticky rule of the tools bar in `basket-page.scss`. Build on
  top of it if it is merged, and do not undo it.

### Target state

1. **A pure function** in `libs/velista/models` computes the total from the visible
   rows (section 2). It has its own spec.
2. **`BasketViewStore`** exposes that result as one computed signal.
3. **The number** sits in the tools row, before the filter button (section 3).
4. **The bar** sits under the chips, inside the sticky tools bar (section 4).
5. **The popover** opens from the number (section 5).
6. **The small row** replaces the number and the bar when no visible line has a price
   (section 6).
7. **English and Spanish** strings exist for all of it (section 8).

### Scope

- `libs/velista/models`: a new `basket-total.ts` and its spec, exported from the
  barrel.
- `libs/velista/data-access`: `baskets/basket-view-store.ts` and its spec.
- `libs/velista/ui`: `list/list-tools.*` (one new slot), a new presentational
  component for the total, and `assets/i18n/en.json` and `es.json`.
- `libs/velista/feature-shopping-lists`: `basket-page/basket-page.html`, `.ts`,
  `.scss` and `.spec.ts`.
- `apps/velista/plans/mocks/README.md` only if the published link changes.

### Constraints

- **The total reads the price that the row draws.** Use `basketRowProduct` and
  `shownOffer` with the same `chosenId` and the same `atShop` flag that the page gives
  the row. A total that disagrees with the rows on screen is the defect to avoid.
- **Sum in integer cents.** Convert each price with `Math.round(price * 100)` before
  you multiply. Convert back for `formatMoney`.
- **Rule D4 is not in play**, because nothing new crosses the wire.
- **No new colour, no container, no icon.** Section 3 and section 4 name the tokens.
- **Do not use `@angular/core/rxjs-interop`.** Computed signals are enough.
- **Dates and money use `Intl`**, through `formatMoney` in
  `libs/velista/platform/src/lib/money.ts`.
- `token-hygiene.spec.ts` rejects raw pixels. Add a semantic token for the height of
  the bar if no existing token fits.

### Action boundaries

- Change no file under `apps/luna-shopper-backend` or `libs/luna-shopper`.
- Do not change the zone list page (`feature-lists`). It has no chain or shop filter,
  and the owner asked for the shopping list tab.
- Do not add a setting that hides the total.
- Stop and ask before you add a dependency or change `BasketRow`.

### Progress evidence

- `npx nx test velista-models` (or the project that owns `basket-total.spec.ts`)
  passes, with the cases of section 9.
- `npx nx test` passes for `data-access`, `ui` and `feature-shopping-lists` of the
  velista scope.
- `npx nx build velista` passes. Only the build type checks the templates.
- A browser walk on a slot, through the shell or on velista's own port, shows the four
  states of the mock. Report each state with what you saw.

## 1. The rules

- **T1. The total is about the lines on screen.** It counts the rows that the filter
  leaves, never the whole basket. The count at the start of the tools row keeps
  counting the whole basket, as today.
- **T2. Every visible line with a price counts**, bought or not. A line that the
  shopper marked not available counts. A skipped line counts.
- **T3. A line counts its price times the whole quantity asked for.**
- **T4. With a shop chosen, a line that the shop does not list adds nothing, and a
  line that the shop is known not to have adds nothing.** Both keep their marks on the
  row ("Not listed", and "Not available" in red).
- **T5. The number always starts with `~`.** No word and no glyph stand beside it on
  the page.
- **T6. The word "Estimated" appears only in the popover.**
- **T7. The number is a button, and it is the only way into the popover.**
- **T8. With no priced line there is no number and no bar.** One small row says so.

## 2. The sum

One function, pure, in `libs/velista/models/src/lib/basket-total.ts`:

```ts
export interface BasketTotal {
  /** Visible rows that can be counted (no `REMOVED` row). */
  readonly lines: number;
  /** Of those, rows whose product is known. */
  readonly withProduct: number;
  /** Of those, rows that add a price to the total. */
  readonly withPrice: number;
  readonly boughtCents: number;
  readonly leftCents: number;
  readonly totalCents: number;
  readonly currency: string | null;
}
```

The inputs are the visible rows, the product map, the chosen product of each row, and
the `atShop` flag. For each countable row:

1. **The product.** `basketRowProduct(row, products, chosenId)`. A row of free text
   has none. A row with several options and no choice has none. Such a row adds to
   `lines` only.
2. **The shelf.** With `atShop` true, read `basketShelfMark`. A row whose mark is
   `unavailable` adds to `withProduct` and adds no price (rule T4). A row whose mark
   is `instead` uses the product that the row draws in its place.
3. **The price.** `shownOffer(product, atShop)`. A null price adds to `withProduct`
   only. That is the "Not listed" case with a shop chosen.
4. **The currency.** The first priced row sets the currency of the total. A row with
   a different currency that is not null counts as a row with no price.
5. **The quantity.** `whole = max(asked, bought + boughtElsewhere)`.
   `done = min(whole, bought + boughtElsewhere)`.
6. **The amounts.** `total += cents * whole`. `bought += cents * done`.
   `left = total - bought`.

A row in state `NOT_AVAILABLE` or `SKIPPED` follows the same steps. What nobody bought
of it falls on the left side, because the owner asked for a total of all items.

The builder confirms in the spec that `asked` is the whole quantity of a row that is
partly bought. If it is not, `whole` is `bought + boughtElsewhere + left`, and the
rest of this section stands.

`BasketViewStore` exposes `total = computed(...)` over `visibleRows`, the products of
`BasketStore`, the chosen ids and `pricedAtShop`.

## 3. The number

- **Where.** In the tools row, at the trailing edge, before the filter button.
  `ListTools` gains one slot, `[listToolsTrail]`, between `.lead` and the filter
  button. The list page does not fill it.
- **What.** `~24,07 €`: the tilde, then `formatMoney(totalCents / 100, currency,
  locale)`. The tilde is in the translation string, so a language can move it.
- **How it looks.** A `<button type="button">` with no border and no background.
  Text in `--app-text-secondary`, 15px, weight 600, tabular numbers. The height is the
  touch target. That is the weight of the count at the other end of the row.
- **Its name.** "Estimated total, about 24,07 €. See what is behind it." The tilde is
  not read as a character.
- **No live region.** The number moves with each quantity that a thumb drags. The
  page's one polite region already says what a move came to.
- **When it is absent.** While the composer's field holds words (the tools bar is not
  drawn then), on an empty basket, and under rule T8.

## 4. The bar

- **Where.** Under the chip row, inside the sticky bar, through the existing
  `listToolsBelow` slot. With no chip it sits directly under the tools row.
- **What.** A track 4px high with a 2px radius, the full width of the column inside
  the 16px gutters. The track is `--app-border-subtle`. The bought part is
  `--app-action-bg`, as wide as `boughtCents / totalCents`.
- **Its two ends.** One line under the track, 12px, `--app-text-muted`, tabular
  numbers: `~11,60 € bought` at the leading end and `~12,47 € left` at the trailing
  end.
- **Its name.** The track is `role="img"` with "About 11,60 € bought of about
  24,07 €". The two captions are `aria-hidden`, because they repeat it.
- **No animation** on the first paint. A width transition on a change is allowed,
  and it is off under `prefers-reduced-motion`.
- This is the progress bar of the list page, thinner. It adds about 30px to the
  sticky bar.

## 5. The popover

`lib-anchored-popover`, with the number as its origin, `align="end"` and
`labelledBy` the title. It closes on Escape and on a press outside, and focus returns
to the number, as the "uncovered" popover of the same page does.

Top to bottom:

1. **The title:** "Estimated total".
2. **Three rows**, a label at the leading end and an amount at the trailing end:
   "Bought", "Still to buy", then "Total" over a hairline in the primary text colour.
3. **Two counts**, each a sentence:
   - "9 of 12 lines have a product."
   - "7 of those 9 have a price at Mercadona." With no shop chosen: "8 of those 9 have
     a price." The chain is the chosen shop's chain.
4. **The reason:** "These prices are not final. Shops change their prices, and some
   shops do not publish them or keep them up to date."

The second count is absent when `withProduct` is zero.

## 6. No line has a price

When `lines` is above zero and `withPrice` is zero:

- No number and no bar.
- **One small row** in the scroll, directly under the sticky bar and above the
  changes banner. An info icon (`lib-info-icon`), "No prices yet.", and a text button
  "See more". The row is 44px high and has a hairline above it. No background, no
  border radius.
- **See more opens the rest in place** and becomes "See less". The button carries
  `aria-expanded`. Nothing is remembered: the row is closed each time the page opens.
- **No close button.** The owner decided that the row is small enough to stay. It
  goes away by itself when the first line gets a price.

The opened text depends on the cause:

- **No visible line has a product** (`withProduct` is zero), as the mock draws:
  "A price comes from a product. These lines are only words, so there is nothing to
  add up." Then three steps: "Open a line." "Choose the product you buy." "Its price
  shows on the line and joins the total." Then: "With a shop chosen, only the prices
  of that shop count."
- **Lines have a product and none has a price** (not drawn): "We have no price for
  these products yet. Shops change what they publish, so a price can show later."
  With a shop chosen, add: "Choose another shop in the filter to see its prices."

A guest cannot open a line, so the three steps are an invitation that the guest
cannot accept. A guest gets the title row and the second text in both cases.

## 7. Where each part goes

| Part       | Component                                   | Slot or place                         |
| ---------- | ------------------------------------------- | ------------------------------------- |
| The number | new `lib-basket-total` in `velista/ui`      | `[listToolsTrail]` of `lib-list-tools` |
| The bar    | new `lib-basket-total-bar` in `velista/ui`  | `listToolsBelow`, after `lib-chip-row` |
| Popover    | `lib-anchored-popover`, inside the number   | origin is the number                  |
| Small row  | new `lib-no-prices-note` in `velista/ui`    | the scroll, first under the tools bar |

The three components are presentational. They take `BasketTotal`, the locale and the
chain name as inputs, and they inject no store. The page reads
`BasketViewStore.total` and passes it down.

## 8. The words

Keys under `basket.total` in `libs/velista/ui/assets/i18n/en.json` and `es.json`.

| Key              | English                                                                                                             | Spanish                                                                                                                   |
| ---------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `amount`         | `~{{amount}}`                                                                                                       | `~{{amount}}`                                                                                                             |
| `open`           | Estimated total, about {{amount}}. See what is behind it.                                                           | Total estimado, unos {{amount}}. Ver de dónde sale.                                                                       |
| `barLabel`       | About {{bought}} bought of about {{total}}                                                                          | Unos {{bought}} comprados de unos {{total}}                                                                               |
| `boughtEnd`      | {{amount}} bought                                                                                                   | {{amount}} comprado                                                                                                       |
| `leftEnd`        | {{amount}} left                                                                                                     | {{amount}} por comprar                                                                                                    |
| `title`          | Estimated total                                                                                                     | Total estimado                                                                                                            |
| `bought`         | Bought                                                                                                              | Comprado                                                                                                                  |
| `left`           | Still to buy                                                                                                        | Por comprar                                                                                                               |
| `total`          | Total                                                                                                               | Total                                                                                                                     |
| `withProduct`    | {{count}} of {{lines}} lines have a product.                                                                        | {{count}} de {{lines}} líneas tienen un producto.                                                                         |
| `withPrice`      | {{count}} of those {{products}} have a price.                                                                       | {{count}} de esas {{products}} tienen precio.                                                                             |
| `withPriceAt`    | {{count}} of those {{products}} have a price at {{chain}}.                                                          | {{count}} de esas {{products}} tienen precio en {{chain}}.                                                                |
| `why`            | These prices are not final. Shops change their prices, and some shops do not publish them or keep them up to date.  | Estos precios no son definitivos. Las tiendas cambian sus precios, y algunas no los publican o no los mantienen al día.   |
| `none.title`     | No prices yet.                                                                                                      | Aún no hay precios.                                                                                                       |
| `none.more`      | See more                                                                                                            | Ver más                                                                                                                   |
| `none.less`      | See less                                                                                                            | Ver menos                                                                                                                 |
| `none.words`     | A price comes from a product. These lines are only words, so there is nothing to add up.                            | Un precio viene de un producto. Estas líneas son solo palabras, así que no hay nada que sumar.                            |
| `none.step1`     | Open a line.                                                                                                        | Abre una línea.                                                                                                           |
| `none.step2`     | Choose the product you buy.                                                                                         | Elige el producto que compras.                                                                                            |
| `none.step3`     | Its price shows on the line and joins the total.                                                                    | Su precio aparece en la línea y se suma al total.                                                                         |
| `none.shop`      | With a shop chosen, only the prices of that shop count.                                                             | Con una tienda elegida, solo cuentan los precios de esa tienda.                                                           |
| `none.unpriced`  | We have no price for these products yet. Shops change what they publish, so a price can show later.                 | Aún no tenemos precio para estos productos. Las tiendas cambian lo que publican, así que puede aparecer más adelante.     |
| `none.otherShop` | Choose another shop in the filter to see its prices.                                                                | Elige otra tienda en el filtro para ver sus precios.                                                                      |

The amounts in the two end captions already carry the tilde, through `amount`.

## 9. The specs

`basket-total.spec.ts`, one case each:

- An empty set gives zeros and a null currency.
- A free text row adds to `lines` only.
- A row with several options and no choice adds to `lines` only.
- A row with a product and a null price adds to `lines` and `withProduct`.
- A wanted row of 2 at 1.35 adds 270 cents to the total and to the left side.
- A done row adds its whole amount to the bought side.
- A partly bought row splits between the two sides, and the two sides add up to the
  total.
- A row bought through another basket (`boughtElsewhere`) falls on the bought side.
- A `NOT_AVAILABLE` row and a `SKIPPED` row with a price count, on the left side.
- A `REMOVED` row counts nowhere.
- With `atShop` true, a row whose shelf mark is `unavailable` adds no price.
- With `atShop` true, a row with no price at the shop adds no price, even when
  `product.offer` has one.
- With `atShop` false, the same row adds the price of `product.offer`.
- A row in a second currency counts as a row with no price.
- Prices such as 0.1 and 0.2 sum to exact cents.

`basket-view-store.spec.ts`: the total follows a change of the kept lists and a change
of the search, and it reads `pricedAtShop`.

`basket-page.spec.ts`: the number and the bar are drawn with a priced line, the small
row is drawn with none, neither is drawn while the composer holds words, and the
number opens the popover.

## 10. The mocks

`apps/velista/plans/mocks/basket-total/`, published as a Design canvas at
https://claude.ai/artifact/2xBNfcsKtynfbxNLpcnAbt. Drawn on Day.

| Artboard               | What it shows                                                      |
| ---------------------- | ------------------------------------------------------------------ |
| `Main.dc.html`         | The number in the tools row and the bar with its two ends          |
| `Info.dc.html`         | The popover                                                        |
| `States.dc.html`       | No filter, one shop, and one shop with one list                    |
| `NoPrices.dc.html`     | The small row                                                      |
| `NoPricesMore.dc.html` | The small row after See more                                       |

Every artboard shows one basket: 12 lines, 9 with a product, 3 bought, 1 marked not
available by the shopper. With Mercadona chosen, 7 of the 9 have a price and the total
is `~24,07 €`.

The second text of section 6 and the guest's row are not drawn.

## 11. Build order

1. `basket-total.ts` and its spec.
2. The signal in `BasketViewStore` and its spec.
3. The slot in `ListTools`.
4. The three components and the strings.
5. The page: the number, the bar, the popover, the small row, and the page spec.
6. The browser walk of the four states.
