# 0153: a chosen shop prices only what it sells, and the picker names every chain

> Asked for by the owner on 2026-10-16: "create plans to fix the most important problems from
> the recent e2e report". Two findings of `docs/reports/2026-10-16-velista-e2e-slot1.md` on
> the basket's shop choice: F5.2 (major, at a shop that publishes no prices, Deza, the rows
> and the total carry other chains' prices under the Deza chip) and F5.3 (major, the shop
> picker leaves out a chain that quotes none of the basket's products, although the
> profile's codes hold its shops). Stage 2 needs backend `0213`.
>
> Every fact below was read on `dev` at `d73a36b8` on 2026-10-16.
>
> Prerequisite reading: plan `0124` (the shop picker), plan `0139` (a row is a product),
> `libs/velista/models/src/lib/compose-basket-view.ts` (`basketPricedAtShop`, `priceView`),
> `basket-view.ts:854-880` (`shownOffer`), `basket-total.ts:100-157`,
> `libs/velista/data-access/src/lib/baskets/basket-view-store.ts:439-470`,
> `libs/velista/feature-shopping-lists/src/lib/basket-row/basket-row.ts:836-880`,
> `settle-sheet.ts:462`, `:492`, `libs/velista/ui/src/lib/catalog/price-table.ts:52-68` (how
> the product page tells "stocked, no price" from "not sold"), `shop-picker-sheet.ts:346-404`,
> and backend `0213`.

## Brief for the agent

Load the `nx-portfolio-angular-developer` skill before you write code.

### Objective

With a shop chosen, a row draws the price of that shop or no price, the total counts only
what the shop prices, and a row with no price there may say what it costs elsewhere without
that amount entering the total. The picker lists every chain of the profile's codes, and a
chain that quotes nothing on this basket says so.

### Context

- **One flag turns every price off at a shop that prices nothing.** `basketPricedAtShop`
  (`compose-basket-view.ts:610-622`) is true only when at least one row has an `atShop.price`
  that is not null, and the comment at `:604-608` says that is deliberate: at such a shop
  every row draws as under "any of your shops". `shownOffer(product, atShop)`
  (`basket-view.ts:854-880`) returns `product.offer`, the cheapest anywhere with no chain
  name, when `atShop` is false. The same false value feeds the row price
  (`basket-row.ts:836`), the total (`basket-total.ts:127`) and the settle scope
  (`settle-sheet.ts:462`, `:492`). The chip still names the shop (`chosenShop`,
  `basket-view-store.ts:224` onward). `basket-view-store.ts:439-470` computes `pricedAtShop`,
  `readAtShop` and `total`.
- **The "x € en Mercadona" mark exists only while `priced` is true.** `priceView`
  (`compose-basket-view.ts:536-547`) writes no `unlisted` or `cheaper` mark when `priced` is
  false; at `:557-561` it writes `{ kind: 'unlisted', chain, elsewhere }`, which
  `basket-row.ts:850-880` draws as "notSoldHere · cheaperAt".
- **The product page already tells the two cases apart.** `price-table.ts:52-68` draws
  `catalog.product.notSold` for `notSold` and `catalog.row.noPrice` for `unpriced`
  (`catalog-browse.ts:276-280`). A Deza row with `atShop` present and `price: null` is the
  `unpriced` case.
- **The picker reads `basket.scopes` only** (`shop-picker-sheet.ts:346-372`, `:385-404`),
  and the gateway names only the scopes that quote a product of the basket
  (`basket-catalog.service.ts:653-709`). Backend `0213` makes the read name every scope of
  the profile with `quotesBasket` and `scopesIncomplete`. The client's `_offersShop`,
  `_named` and `restore()` refuse a shop outside `scopes`, so the chain must be in the read.
- The picker has a search field (`libs/velista/ui/src/lib/shops/shop-picker.html:159-176`)
  with no clear cross yet; PR #740 adds the cross to the list, basket and catalog fields and
  not to this one.

### Target state

Stage 1, no backend dependency:

1. `shownOffer` receives `readAtShop` instead of `pricedAtShop` wherever a row, the total
   or the settle sheet draws a price. A row with no price at the chosen shop draws no
   price. `basketPricedAtShop` stays, for the marks only.
2. `priceView`, when the read is at the shop and the row has no price there, writes a mark
   of a new kind, for example `noPriceHere`, with `elsewhere` when a cheaper offer exists.
   The row draws it as "No price here · 17,25 € en Mercadona" style, with the amount
   outside the price column. `basketTotal` ignores that amount, so `withPrice` is honest
   (0 at Deza) and the total line says how many rows have no price.
3. The settle sheet's scope follows the same rule.

Stage 2, after backend `0213`:

4. The picker lists every chain in `scopes`. A chain whose scopes all have
   `quotesBasket: false` is drawn with "No prices here yet" under its name and stays
   choosable. The shop count of a chain is the count the read gives, so it does not move
   between opens.
5. With `scopesIncomplete` true the picker draws "The shops could not be listed. Try
   again" above "Near me", and never an empty list with no word.

### Scope

- `libs/velista/models/src/lib/compose-basket-view.ts`, `basket-view.ts`, `basket-total.ts`
  and their specs (`compose-basket-view.spec.ts`, `basket-view.spec.ts`,
  `basket-total.spec.ts`).
- `libs/velista/data-access/src/lib/baskets/basket-view-store.ts` and its spec; the basket
  mapper in `mapping/mappers.ts` and the `BasketPriceScope` model for stage 2.
- `libs/velista/feature-shopping-lists/src/lib/basket-row/basket-row.ts`, `.html`,
  `basket-row-shop-price.spec.ts`; `basket-page.html` where `atShop` is passed;
  `settle-sheet/settle-sheet.ts` and its spec; `shop-picker-sheet.ts`, `.html` and spec.
- `libs/velista/ui/src/lib/shops/shop-picker.*` for the two new lines of stage 2.
- `libs/velista/ui/assets/i18n/en.json` and `es.json`.
- This plan file: "What the build decided" at the end and the `> **PR:**` line at the top.

### Constraints

- Rule D4: map the two new fields of `0213` from `unknown` into velista's own model, and
  treat a missing field as `quotesBasket: true` and `scopesIncomplete: false` so a mixed
  fleet draws as today.
- Prices follow the locale through `Intl`, and the "~" estimate caveat stays.
- Build stage 1 and stage 2 as two commits on one branch, so that stage 1 can land alone if
  `0213` is late.
- Do not use `@angular/core/rxjs-interop`.

### Action boundaries

- Edit only the files in Scope. Stop and ask before you change the price policy of a read
  (`readAtShop` in the data access store) or anything in the backend.
- If a spec of `basket-total` asserts that a shop with no prices totals the cheapest
  offers, that spec encodes the defect. Change it and say so in "What the build decided".

### Progress evidence

- New specs, each failing before the change:
  - a read at a shop where every `atShop.price` is null: each row's shown offer is null,
    the total is zero with every row counted as unpriced, and each row with a cheaper
    offer elsewhere carries the `noPriceHere` mark with that chain and amount;
  - a read at a shop where one row is priced: the other rows keep the `unlisted` mark as
    today;
  - stage 2: a scope with `quotesBasket: false` draws its chain with the "no prices" line
    and is choosable; `scopesIncomplete` draws the retry line.
- `npx nx run-many -t lint test -p velista/models velista/data-access velista/feature-shopping-lists velista/ui`
  passes.
- `npx nx build velista` passes.
- One walk on a slot with the report's data (slot 2 holds it): choose a Deza shop on the
  live basket and read "No price here" on each row and a zero total.

## 1. Not in this plan

- Freezing the amounts of a finished trip (F5.6). The settlements record `pricePaidCents`
  per unit (`line-settlement.entity.ts:195-225`) but no row view carries it. It needs a
  contract change and a product decision on what "left" means on a finished trip.
- The clear cross on the picker's search field. It belongs with PR #740's pattern, one
  attribute, and can ride on any later picker change.

## 2. Choices that are mine

- **No price rather than a borrowed price.** A borrowed amount under a shop's chip is a
  wrong fact about that shop. The elsewhere mark keeps the useful part.
- **A chain with no quotes stays choosable.** A person at that shop still wants the list
  and the ticks; only the prices are missing.
