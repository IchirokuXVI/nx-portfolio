# 0179: a piece sold by the kilo shows its weight and its price

> Found on 2026-11-03: velista shows Mercadona's 1.56 kg cheese piece as "1560 g" for
> "13,42 €", and a basket line of one piece adds 13,42 €. The piece costs 20,94 €, and 13,42 €
> is the price of a kilo. Evidence: `apps/luna-shopper-backend/docs/kilo-pieces-2026-11/`,
> section 4 and section 6.
>
> **Reviewed on 2026-11-04** with backend plan `0244`. The catalog now has four kinds of product
> and not three: a piece priced as one with an approximate weight is the fourth (a 580 g salad
> tub at 6,50 €). It is drawn as a pack with a weight line, and its price does not change
> meaning. The totals, the mapper and the kind helper below say so.
>
> Needs backend plan `0244` first: it adds `approxWeight` to the product and `piecePrice` to
> every offer. Nothing in this plan can be built against a gateway without them.
>
> **Mock approved on 2026-11-05** (`apps/velista/plans/mocks/kilo-pieces/`,
> https://claude.ai/artifact/L4Gjz8b5FVDDuVHTxzDZ6E) with three choices of the owner, which
> this text now carries: the weight starts with a tilde and not with "aprox."; every "/ kg" and
> "/ L" is drawn smaller than its number, in the muted colour, close after it; and the headline
> of a product sold by the kilo is the number at the price's weight with "/ kg" small after it
> (option B of the mock), so the number lines up with the other prices.
>
> Prerequisite reading: backend plan `0244` sections 1, 3.3, 4 and 8; velista plan `0101`
> (rule 5, the unit price line); `libs/velista/ui/src/lib/catalog/product-row-view.ts`;
> `libs/velista/ui/src/lib/catalog/product-size.ts`; `libs/velista/models/src/lib/domain.ts`
> (`ProductOffer`, `CatalogItem`); `libs/velista/data-access/src/lib/mapping/mappers.ts`
> (the offer mapper at line 667); `libs/velista/models/src/lib/basket-total.ts`;
> `libs/velista/models/src/lib/line-products.ts`. Load the `nx-portfolio-angular-developer`
> and `design-taste-frontend` skills before any code.

## Brief for the agent

### Objective

Show a piece whose weight is approximate as what it is: about its weight, its own price, and,
when it is sold by the kilo, its price per kilo. Count the piece price of a kilo piece in every
list and basket total. Make a product sold by the kilo always say that its price is the price
of a kilo.

### Context

Backend plan `0244` gives the catalog four kinds of product:

| Kind | On the wire | `price` is | Example |
| --- | --- | --- | --- |
| Fixed pack | `unitSize` + a base unit, `approxWeight` null | the pack | 1 L of milk, 250 g of butter |
| Sold by the kilo | `KILOGRAM`, `unitSize` null, `approxWeight` null | a kilo | loose apples, the deli counter |
| Kilo piece | `KILOGRAM`, `unitSize` null, `approxWeight` in grams | a kilo | a 1.56 kg cheese piece, a meat tray |
| Piece priced as one | `UNIT`, `unitSize` null, `approxWeight` in grams | the piece | a 580 g salad tub, a fuet, a LIDL fish tray |

For both kinds sold by the kilo, `price` and `unitPrice` are the price of a kilo, label `kg`.
For a kilo piece, every offer also carries `piecePrice`, which the server derives
(`round(approxWeight / 1000 × price, 2)`). velista never computes it. For a piece priced as
one, `piecePrice` is null and `price` is what one piece costs, as for a pack.

What velista draws today (backend `0244` evidence, section 4):

- `productSizeText` (`product-size.ts:26`) prints `unitSize` with its unit, and nothing for
  `KILOGRAM` with no size.
- `priceText` prints `offer.price`. `unitPriceText` (`product-row-view.ts:196`) hides the unit
  price when it equals the price. A product sold by the kilo thus shows a bare "13,42 €" with
  nothing that says "a kilo".
- `basket-total.ts:142` to `144` adds `price × (bought + left)`, and `line-products.ts:356`
  adds `quantity × price`.
- A settled purchase shows the price the server recorded (`pricePaidCents`). Backend `0244`
  section 4 makes that the piece price for a kilo piece, so the Bought history needs no change
  of its own.

### Target state

1. The domain model carries the weight and the piece price, mapped from `unknown` (rule D4):
   `CatalogItem.approxWeight: number | null` (grams) and `ProductOffer.piecePrice: number | null`.
2. Every product with a weight shows it, in every place that draws a product row, a basket
   row or a product sheet: "~1,56 kg" (`es`) and "~1.56 kg" (`en`), from `approxWeight`
   through `Intl.NumberFormat`, in kilos with at most two decimals, or in grams under 1 kg
   ("~395 g"). The tilde is the sign the basket total already uses for an estimate (velista
   `0132`, rule T5), and it is in the translation, so a language can move it. This holds for a
   kilo piece and for a piece priced as one.
3. A kilo piece shows the piece price as the headline price ("20,94 €") and the price per
   kilo as the unit price line ("13,42 € / kg"), always.
4. A product sold by the kilo with no weight shows its price with the unit, "13,42 € / kg", as
   the headline, and no second unit price line. The "/ kg" is drawn smaller than the number,
   in the muted colour, close after it, so the number stays in line with the other prices.
   Every "/ kg" and "/ L" the app draws takes that form, on the unit line too.
5. A piece priced as one shows its price as a pack does ("6,50 €"), with the weight line of
   target state 2 and the unit price rule of velista `0101` rule 5.
6. A list total and a basket total add `piecePrice` for a kilo piece. For every other product
   they add `price`, as today. A kilo piece whose offer has a price and no `piecePrice` adds
   nothing and counts as unpriced, as an offer with no price does.
7. Copy in `es.json` and `en.json` of `libs/velista/ui/assets/i18n/` (not `src/assets`).

### Scope

- Work in `libs/velista/models`, `libs/velista/data-access` (the mappers), `libs/velista/ui`
  (the row views, the size text, the translations) and the feature libraries that draw a row
  (`feature-shopping-lists`, the catalog tab, the product sheet, the line page), and
  `apps/velista/plans/mocks/`.
- Do NOT touch the backend, the back office, the generated wire types, or how an offer is
  chosen. Do NOT change what a quantity means for a product sold by the kilo with no weight
  (see "Not in this plan").

### Constraints

- Mock first. Draw the four kinds in the product row, the basket row and the product sheet,
  Night and Day, in `apps/velista/plans/mocks/kilo-pieces/` (`*.dc.html`, `canvas.json`, then
  `build-index.mjs`), and stop for the owner's approval before any code. Follow the owner's
  taste notes: quiet and integrated, no tinted container, no new colour role.
- The weight is an estimate. Every place that prints it starts with "~" and every piece price
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
product of 1560 g at 13.42 € per kilo) shows "~1,56 kg", "20,94 €" and "13,42 € / kg",
a basket with two of it totals 41,88 €, and a seeded `UNIT` piece of 580 g at 6,50 € shows
"~580 g" and "6,50 €".

## 1. The model

`ProductOffer` gains:

```ts
/**
 * The price of one piece of a product sold by the kilo with an approximate
 * weight (backend 0244). The server derives it from the weight and the price
 * per kilo; it is never computed here. Null for every other product, also for
 * a piece priced as one, whose `price` is already the piece.
 */
readonly piecePrice: number | null;
```

`CatalogItem` (and every model that copies its size fields, such as the basket's product and
the purchase snapshot) gains `approxWeight: number | null`, in grams. The mappers read both
from `unknown` with the same guards as `unitPrice` and `unitSize`: a number, finite, above 0,
else null.

A pure helper in `libs/velista/models` names how a product is priced, so no view tests the
fields by hand:

```ts
export type SoldAs = 'PACK' | 'BY_THE_KILO' | 'KILO_PIECE';
export function soldAs(unit: string | null, size: number | null, approxWeight: number | null): SoldAs;
```

`KILO_PIECE` is `KILOGRAM` with a null size and a weight. `BY_THE_KILO` is `KILOGRAM` with a
null size and no weight. Everything else is `PACK`, a piece priced as one included: its price
is one piece, which is what a pack's price is. The weight line is not a kind. It is drawn
whenever `approxWeight` is set, whatever `soldAs` answers.

## 2. The views

- **The size text** (`productSizeText`): a product with a weight answers the "~" text of
  target state 2, whatever its unit. A `BY_THE_KILO` product answers null, as today. A fixed
  pack answers its size, as today. The two never meet: the server refuses a weight beside a
  size.
- **The price text** (`priceText`): a `KILO_PIECE` answers `piecePrice`. A `BY_THE_KILO`
  product answers the price with the unit ("13,42 € / kg"). A `PACK` answers `price`, as
  today.
- **A price is two words, not one string.** Every price a view answers is a
  `PriceWords { amount, per }`: the number, and what it is per ("/ kg", "/ L") or null. The
  template draws `per` smaller, in the muted colour, close after the number; the accessible
  name and every sentence join the two with a space (`priceWordsText`). The suffixes are the
  keys `catalog.per.<basis>`, which replace `catalog.unit.<basis>` ("{{price}} / kg"): one
  sentence pattern cannot be drawn in two sizes. Both languages write the unit after the
  number, so the join is a space.
- **The detail wraps at its separator** when it has no room beside a two line price, so the
  weight is never cut to "~1,…": the brand gives way to a second line, the number does not.
  Each size and weight text holds its number and its unit with a no-break space, so "750 ml"
  and "~1,56 kg" are never split either.
- **The unit price line** (`unitPriceText`): a `KILO_PIECE` always answers the price per kilo,
  also when it equals the piece price (a piece of exactly 1 kg). A `BY_THE_KILO` product
  answers null, because the headline already says "/ kg". A `PACK` keeps the rule of velista
  `0101`, rule 5, which for a piece priced as one shows the chain's unit price when it differs
  from the price (Mercadona compares such a piece per piece, so it is usually hidden).
- **The basket row** (`basket-row.ts`, `productPrice`): the same rules. Today the basket row
  draws no unit price line. Add it for a `KILO_PIECE` only, as the mock shows, after the price
  and before the lists on the caption line. At a shop the row's price comes from `atShop`,
  which carries no `piecePrice`: `shownOffer` reads it from the offer of `offers` whose scope
  is the one `atShop` names, and a kilo piece with no such figure is unpriced there.
- **The cheaper mark and the chain comparison** keep comparing `price` (a price per kilo for
  both kinds sold by the kilo), so a 395 g piece and a 1.56 kg piece compare by the kilo.

## 3. The totals

- `basket-total.ts`: for each row, the amount is `piecePrice` for a `KILO_PIECE`, `price` for
  every other product. The rest of the function (bought, left, currency, unpriced count) does
  not change.
- `line-products.ts:356`: the same rule for `quantity × amount`.
- A spec per total: two cheese pieces at a weight of 1560 and a price of 13.42 with a
  `piecePrice` of 20.94 total 41.88. A `KILO_PIECE` with a price and a null `piecePrice` counts
  as unpriced. A `UNIT` piece of 580 g at 6.50 totals 6.50 per unit of quantity.

## 4. Acceptance criteria

1. The mock is published and approved by the owner before any code lands.
2. Mapper specs: `approxWeight` and `piecePrice` are read from `unknown`, a string or a
   negative number answers null.
3. `soldAs` specs for the three answers, for a `UNIT` product with a weight (`PACK`), and for a
   unit that is not `KILOGRAM`.
4. View specs: the cheese answers "~1,56 kg", "20,94 €" and "13,42 € / kg" in `es`, and
   the same in `en` with its own separators. A 395 g piece answers "~395 g". A loose
   product answers "13,42 €" with "/ kg" as its `per` and no unit price line. A 580 g `UNIT`
   piece answers "~580 g" and "6,50 €". A 1 kg milk carton is unchanged.
5. Total specs of section 3.
6. `npx nx affected -t lint test` is green, and `npx nx build velista` builds.

## Not in this plan

- **What a quantity means for a product sold by the kilo with no weight.** A list or basket
  line of 3 loose apples still adds 3 × the price per kilo. The owner set this aside on
  2026-11-03 (backend `0244`, D4).
- **Weighing at the till.** The total of a piece is an estimate, as the weight is. velista does
  not ask for the weight that was charged.
- **The Bought history.** It shows the price the server recorded at the settle. Backend `0244`
  section 4 records the piece price of a kilo piece there, and the snapshot it keeps carries
  the weight, so the history draws the weight line through the same `productSizeText` and
  needs no rule of its own.
