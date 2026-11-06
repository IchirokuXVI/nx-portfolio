# 0181: cheaper means cheaper in the same measure

> Found on 2026-11-05. The "cheaper option" mark and the order of a product's siblings
> compare `unitPrice`, the chain's own figure, with no look at what it is a price per. A
> dozen eggs thus compares with one egg, and a LIDL product, whose chain prints no unit
> price, is never marked cheaper and always sorts last. Backend plan `0245` gives every offer
> a derived `comparablePrice` with its `comparableBasis`. This plan makes velista compare with
> that pair and nothing else.
>
> Needs backend plan `0245` first: the two fields come from it, and nothing here can be built
> against a gateway without them.
>
> Prerequisite reading: backend `0245` sections 0, 1, 4 and 5; velista `0101` rule 5 (the unit
> price line is drawn only when it says something the price does not); velista `0115`
> (similar products) and `0100` (the catalog tab, its `unitPrice` order);
> `libs/velista/models/src/lib/product-group.ts`, `catalog-browse.ts` (`unpricedStart`,
> `PriceUnitBasis`), `domain.ts` (`ProductOffer`), `libs/velista/data-access/src/lib/mapping/mappers.ts`
> (the offer mapper near line 667), `libs/velista/ui/src/lib/catalog/product-row-view.ts`
> (`unitPriceText`). Load the `nx-portfolio-angular-developer` skill before any code.

## Brief for the agent

### Objective

Compare offers in velista by the catalog's derived figure, only between figures of one basis,
and under the catalog tab's `unitPrice` order print the figure that placed the row. Keep the
chain's unit price as what the unit price line prints everywhere else.

### Context

Backend `0245` adds to every offer on the wire:

- `comparablePrice`: the price of a kilo, a litre or one unit of the product, derived by the
  catalog from the till price and the product's size. Null when the row has no price or the
  size is unknown.
- `comparableBasis`: `KILOGRAM`, `LITER` or `UNIT`. Null exactly when the price is.

`unitPrice`, `unitPriceLabel` and `unitBasis` stay the chain's figure and its label.

What velista does today:

- `compareGroupOffers` (`product-group.ts:25`) orders a product's siblings by a till price
  first, then `unitPrice`, then `price`. `isCheaper` (line 82) marks a sibling cheaper when its
  `unitPrice` is lower, and falls back to `price`. Neither reads a basis.
- `unpricedStart` (`catalog-browse.ts:65`) decides where the unpriced tail of the catalog tab
  starts: under `unitPrice` a row counts as priced when `offer.unitPrice` is set.
- The catalog tab under `unitPrice` draws each row's unit price line with the chain's figure
  (`unitPriceText`), which after backend `0245` is no longer the number that placed it. A
  LIDL row placed by its derived figure would print no unit price at all.

### Target state

1. `ProductOffer` carries `comparablePrice: number | null` and `comparableBasis:
   ComparableBasis | null`, mapped from `unknown` with the guards of `unitPrice` (a finite
   number above zero, else null; a basis outside the three values reads as null, and a figure
   with no basis reads as null too).
2. `compareGroupOffers` orders by a till price first, then by `comparablePrice` **between two
   offers of one basis**, then by `price`. Two offers of different bases are not ordered by
   either figure: they fall through to `price`, as two offers with no figure do today.
3. `isCheaper` answers true only when both offers carry the pair, their bases are equal and
   the candidate's `comparablePrice` is lower. With no pair on either side it keeps the `price`
   fallback. A difference of basis is never "cheaper".
4. Under the catalog tab's `unitPrice` order, a row's unit price line prints `comparablePrice`
   with its `comparableBasis` ("13,42 € / kg" through the existing `catalog.unit.*` keys),
   because that is the number that placed the row (backend `0196`, "the row shows the number
   that placed it"). `unpricedStart` under that order reads `comparablePrice`. Under every
   other order and on every other screen the unit price line keeps velista `0101` rule 5
   with the chain's figure.
5. The order's own copy does not change: it still reads "the lowest price per kilo or litre",
   which backend `0245` C5 keeps true (counted products come in a block after them).

### Scope

- Work in `libs/velista/models`, `libs/velista/data-access` (the mapper and the in memory
  catalog), `libs/velista/ui` (`product-row-view.ts`) and `libs/velista/feature-catalog`
  (the row under the `unitPrice` order).
- Do NOT touch the backend, the back office, the generated wire types, how an offer is
  chosen, or the unit price line outside the `unitPrice` order.

### Constraints

- velista never derives a comparable price. The pair is read off the wire or it is null.
- Rule D4: own models, mapped from `unknown`. `ComparableBasis` is velista's own union of
  three strings, beside `PriceUnitBasis`, not an import of the contracts type.
- No mock. Nothing new is drawn: the unit price line under one order prints another number
  of the same shape.

### Action boundaries

- Proceed with everything in sections 1 and 2.
- Stop and ask if backend `0245` is not merged, or if its wire shape differs from its section 5.

### Progress evidence

Each criterion of section 3 with its spec output, `npx nx build velista`, and one walk on a
slot with backend `0245`: the catalog tab under "price per kilo or litre" with a LIDL product
in the page shows its derived figure on the row, and a product with a sibling of another basis
(seed one) carries no "cheaper option" mark.

## 1. The model and the mapper

```ts
/** What `comparablePrice` is a price per, as the catalog derived it (backend 0245). */
export type ComparableBasis = 'KILOGRAM' | 'LITER' | 'UNIT';
export const COMPARABLE_BASES: readonly ComparableBasis[] = ['KILOGRAM', 'LITER', 'UNIT'];
```

`ProductOffer` gains the two readonly fields with a doc comment that names the rule: this
figure compares, `unitPrice` is what the chain printed. The mapper reads both; a pair where one
half fails its guard answers null for both. The in memory catalog of `data-access` gives its
fixtures the pair, derived by hand in the fixture file and never by code.

## 2. The comparisons

```ts
function sameBasisFigure(a: ProductOffer, b: ProductOffer): [number, number] | null {
  return a.comparableBasis !== null &&
    a.comparableBasis === b.comparableBasis &&
    a.comparablePrice !== null &&
    b.comparablePrice !== null
    ? [a.comparablePrice, b.comparablePrice]
    : null;
}
```

`compareGroupOffers` and `isCheaper` both go through it. The doc comment of
`compareGroupOffers`, which says the catalog orders by unit price, is rewritten to say the
catalog orders by the comparable figure within a basis block (backend `0245` section 4), and
that velista's copy of the order makes the same choice for the siblings it holds.

Under the `unitPrice` order, the catalog page hands the row a flag, or the row view takes the
order as an argument, so that `unitPriceText` prints the pair instead of the chain's figure.
Pick the one that keeps `product-row-view.ts` pure. Elsewhere the function is unchanged.

## 3. Acceptance criteria

1. Mapper specs: the pair is read from `unknown`; a string figure, a negative figure, an
   unknown basis, or a figure with no basis answers null for both.
2. `compareGroupOffers` specs: two offers per kilo order by `comparablePrice`; a per kilo
   offer and a per unit offer fall through to `price`; an offer with a till price still comes
   before one without; the existing specs keep passing with the pair added to their fixtures.
3. `isCheaper` and `cheaperInGroup` specs: a cheaper per kilo sibling marks; a per unit
   sibling with a lower figure does not; two siblings with no pair fall back to `price` as
   today; a tie does not mark.
4. Row specs: under the `unitPrice` order a LIDL offer with a pair and no `unitPrice` prints
   "0,99 € / kg" style text from the pair; under `relevance` the same offer prints no unit
   price line; a Mercadona offer under `unitPrice` prints the pair and not the label figure.
5. `unpricedStart` specs under `unitPrice` read the pair.
6. `npx nx affected -t lint test` is green, and `npx nx build velista` builds.

## Not in this plan

- **Drawing the derived figure outside the `unitPrice` order.** The unit price line keeps
  the chain's figure (velista `0101` rule 5). Whether velista should print the derived figure
  everywhere is a product decision, and plan `0179` already changes what a weighed product's
  line says.
- **The basket's choice between chains.** `BasketProductAtShop` compares `price` at one shop,
  which is one product and one basis. Nothing there crosses a basis.
