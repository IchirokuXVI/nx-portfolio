# 0179: a piece sold by the kilo shows its weight and its price

> Found on 2026-11-03: velista shows Mercadona's 1.56 kg cheese piece as "1560 g" for
> "13,42 €", and a basket line of one piece adds 13,42 €. The piece costs 20,94 €, and 13,42 €
> is the price of a kilo. Evidence: `apps/luna-shopper-backend/docs/kilo-pieces-2026-11/`,
> section 4.
>
> Needs backend plan `0244` first: it adds `approxWeight` to the product and `piecePrice` to
> every offer. Nothing in this plan can be built against a gateway without them.
>
> Prerequisite reading: backend plan `0244` sections 1, 3.3 and 8; velista plan `0101`
> (rule 5, the unit price line); `libs/velista/ui/src/lib/catalog/product-row-view.ts`;
> `libs/velista/ui/src/lib/catalog/product-size.ts`; `libs/velista/models/src/lib/domain.ts`
> (`ProductOffer`, `CatalogItem`); `libs/velista/models/src/lib/basket-total.ts`;
> `libs/velista/models/src/lib/line-products.ts`. Load the `nx-portfolio-angular-developer`
> and `design-taste-frontend` skills before any code.

## Brief for the agent

### Objective

Show a piece sold by the kilo as what it is: about its weight, its piece price, and its price
per kilo. Count its piece price in every list and basket total. Make a product sold by the
kilo always say that its price is the price of a kilo.

### Context

Backend plan `0244` gives the catalog three kinds of product:

| Kind | On the wire | Example |
| --- | --- | --- |
| Fixed pack | `unitSize` + a base unit | 1 L of milk, 250 g of butter |
| Sold by the kilo | `KILOGRAM`, `unitSize` null, `approxWeight` null | loose apples, the deli counter |
| A piece sold by the kilo | `KILOGRAM`, `unitSize` null, `approxWeight` in grams | a 1.56 kg cheese piece, a meat tray |

For both kinds sold by the kilo, `price` and `unitPrice` are the price of a kilo, label `kg`.
For a piece, every offer also carries `piecePrice`, which the server derives
(`round(approxWeight / 1000 × price, 2)`). velista never computes it.

What velista draws today (backend `0244` evidence, section 4):

- `productSizeText` (`product-size.ts:26`) prints `unitSize` with its unit, and nothing for
  `KILOGRAM` with no size.
- `priceText` prints `offer.price`. `unitPriceText` (`product-row-view.ts:196`) hides the unit
  price when it equals the price. A product sold by the kilo thus shows a bare "13,42 €" with
  nothing that says "a kilo".
- `basket-total.ts:142` to `144` adds `price × (bought + left)`, and `line-products.ts:356`
  adds `quantity × price`.

### Target state

1. The domain model carries the weight and the piece price, mapped from `unknown` (rule D4):
   `CatalogItem.approxWeight: number | null` (grams) and `ProductOffer.piecePrice: number | null`.
2. A piece shows, in every place that draws a product row or a basket row:
   - the weight as "aprox. 1,56 kg" (`es`) and "approx. 1.56 kg" (`en`), from `approxWeight`
     through `Intl.NumberFormat`, in kilos with at most two decimals, or in grams under 1 kg
     ("aprox. 395 g");
   - the piece price as the headline price ("20,94 €");
   - the price per kilo as the unit price line ("13,42 € / kg"), always.
3. A product sold by the kilo with no weight shows its price with the unit, "13,42 € / kg", as
   the headline, and no second unit price line.
4. A list total and a basket total add `piecePrice` for a piece. For every other product they
   add `price`, as today. A piece whose offer has a price and no `piecePrice` adds nothing and
   counts as unpriced, as an offer with no price does.
5. Copy in `es.json` and `en.json` of `libs/velista/ui/assets/i18n/` (not `src/assets`).

### Scope

- Work in `libs/velista/models`, `libs/velista/data-access` (the mappers), `libs/velista/ui`
  (the row views, the size text, the translations) and the feature libraries that draw a row
  (`feature-shopping-lists`, the catalog tab, the product sheet), and `apps/velista/plans/mocks/`.
- Do NOT touch the backend, the back office, the generated wire types, or how an offer is
  chosen. Do NOT change what a quantity means for a product sold by the kilo with no weight
  (see "Not in this plan").

### Constraints

- Mock first. Draw the three kinds in the product row, the basket row and the product sheet,
  Night and Day, in `apps/velista/plans/mocks/kilo-pieces/` (`*.dc.html`, `canvas.json`, then
  `build-index.mjs`), and stop for the owner's approval before any code. Follow the owner's
  taste notes: quiet and integrated, no tinted container, no new colour role.
- The weight is an estimate. Every place that prints it says "aprox." and every piece price
  that is shown beside it is the server's `piecePrice`, never a number computed here.
- Numbers through `Intl.NumberFormat`, never a pipe that needs `LOCALE_ID`.
- No raw pixels (`token-hygiene.spec.ts`).

### Action boundaries

- Proceed with the mock, then stop and ask the owner to approve it.
- After approval, proceed with the models, mappers, views, totals, copy and specs.
- Stop and ask if backend `0244` is not merged, or if its wire shape differs from section 3.3
  of that plan.

### Progress evidence

The mock link and the owner's answer. Then each criterion of section 4 with its spec output,
and one walk on a slot with backend `0244`: the cheese of the evidence folder (or a seeded
product of 1560 g at 13.42 € per kilo) shows "aprox. 1,56 kg", "20,94 €" and "13,42 € / kg",
and a basket with two of it totals 41,88 €.

## 1. The model

`ProductOffer` gains:

```ts
/**
 * The price of one piece of a product sold by the kilo with an approximate
 * weight (backend 0244). The server derives it from the weight and the price
 * per kilo; it is never computed here. Null for every other product.
 */
readonly piecePrice: number | null;
```

`CatalogItem` (and every model that copies its size fields, such as the basket's product)
gains `approxWeight: number | null`, in grams. The mappers read both from `unknown` with the
same guards as `unitPrice` and `unitSize`: a number, finite, above 0, else null.

A pure helper in `libs/velista/models` names the kind, so no view tests the fields by hand:

```ts
export type SoldAs = 'PACK' | 'BY_THE_KILO' | 'KILO_PIECE';
export function soldAs(unit: string | null, size: number | null, approxWeight: number | null): SoldAs;
```

`KILO_PIECE` is `KILOGRAM` with a null size and a weight. `BY_THE_KILO` is `KILOGRAM` with a
null size and no weight. Everything else is `PACK`.

## 2. The views

- **The size text** (`productSizeText`): a `KILO_PIECE` answers the "aprox." text of target
  state 2. A `BY_THE_KILO` product answers null, as today.
- **The price text** (`priceText`): a `KILO_PIECE` answers `piecePrice`. A `BY_THE_KILO`
  product answers the price with the unit ("13,42 € / kg", through the existing
  `catalog.unit.KILOGRAM` key). A `PACK` answers `price`, as today.
- **The unit price line** (`unitPriceText`): a `KILO_PIECE` always answers the price per kilo,
  also when it equals the piece price (a piece of exactly 1 kg). A `BY_THE_KILO` product
  answers null, because the headline already says "/ kg". A `PACK` keeps the rule of velista
  `0101`, rule 5.
- **The basket row** (`basket-row.ts`, `productPrice`): the same three rules. Today the basket
  row draws no unit price line. Add it for a `KILO_PIECE` only, as the mock shows.
- **The cheaper mark and the chain comparison** keep comparing `price` (a price per kilo for
  both kinds sold by the kilo), so a 395 g piece and a 1.56 kg piece compare by the kilo.

## 3. The totals

- `basket-total.ts`: for each row, the amount is `piecePrice` for a `KILO_PIECE`, `price` for
  every other product. The rest of the function (bought, left, currency, unpriced count) does
  not change.
- `line-products.ts:356`: the same rule for `quantity × amount`.
- A spec per total: two cheese pieces at a weight of 1560 and a price of 13.42 with a
  `piecePrice` of 20.94 total 41.88. A `KILO_PIECE` with a price and a null `piecePrice` counts
  as unpriced.

## 4. Acceptance criteria

1. The mock is published and approved by the owner before any code lands.
2. Mapper specs: `approxWeight` and `piecePrice` are read from `unknown`, a string or a
   negative number answers null.
3. `soldAs` specs for the three kinds and for a unit that is not `KILOGRAM`.
4. View specs: the cheese answers "aprox. 1,56 kg", "20,94 €" and "13,42 € / kg" in `es`, and
   the same in `en` with its own separators. A 395 g piece answers "aprox. 395 g". A loose
   product answers "13,42 € / kg" and no unit price line. A 1 kg milk carton is unchanged.
5. Total specs of section 3.
6. `npx nx affected -t lint test` is green, and `npx nx build velista` builds.

## Not in this plan

- **What a quantity means for a product sold by the kilo with no weight.** A list or basket
  line of 3 loose apples still adds 3 × the price per kilo. The owner set this aside on
  2026-11-03 (backend `0244`, D4).
- **Weighing at the till.** The total of a piece is an estimate, as the weight is. velista does
  not ask for the weight that was charged.
