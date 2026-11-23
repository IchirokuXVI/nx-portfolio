> **PR:** [#1070](https://github.com/IchirokuXVI/nx-portfolio/pull/1070)

# 0198: a price of one reads "/ u"

> Decided on 2026-11-22. A zone list row of a pack or a piece shows its price with no
> basis ("1,20 €"), and the total of the line beside it is often the same number, so the
> owner sees the same price twice and fears it confuses. A product sold by the kilo already
> reads "2,50 € / kg". The owner's ruling: the price of one reads "1,20 € / u", like the
> kilo.
>
> Amended on 2026-11-23: a line that counts grams or millilitres of a pack or a piece reads
> / u too, since the price drawn is the price of one.
>
> Independent of every other plan of this round; it can be built and released alone. Both
> row layouts read the same builder, so the change shows in both, and in the layouts of
> velista `0202` with no further work.
>
> Code anchors, on `dev` at `e06813139`: `libs/velista/ui/src/lib/catalog/product-row-view.ts:245`
> to `:279` (`priceWords`: `per` is null for `KILO_PIECE` and `PACK`);
> `libs/velista/feature-lists/src/lib/select-list-state.ts:362` to `:410` (`rowProduct`,
> the one builder of a row's product, `price:` at `:401`);
> `libs/velista/models/src/lib/list-view.ts:221` to `:228` (`lineRowFacts`, the compact
> row's second fact is `product.price`); `libs/velista/models/src/lib/sold-as.ts:86` to `:97`
> (`PriceWords`, `priceWordsText`); `libs/velista/ui/src/lib/list/line-row.html` (the price
> of line 1 of the row of today, `price.per`); `libs/velista/ui/assets/i18n/en.json` and
> `es.json` (`catalog.per`: "/ kg", "/ L", "/ unit", "/ unidad").

## Brief for the agent

### Objective

Make the price a zone list row shows for a pack or a piece carry the basis "/ u", in both
row layouts and in the row's accessible name, without changing how the catalog words a
price.

### Context

- `priceWords` is shared by the catalog cards, the product page and the rows. The catalog
  draws "1,20 €" for a pack, and that stays.
- `catalog.per.UNIT` reads "/ unit" and "/ unidad", which is too long for a row; the owner
  asked for "/ u".

### Target state

1. A new key `list.row.perUnit`: "/ u" in `en` and `es`.
2. `rowProduct` sets `per` to that key's words when `priceWords` answers a price with
   `per: null`. Nothing else in the builder changes.
3. The row of today draws "1,20 € / u" on line 1; the compact row draws it as its second
   fact; both accessible names read it.
4. A product sold by the kilo or the litre is unchanged ("/ kg", "/ L").

### Scope

- Work in `select-list-state.ts`, the two i18n files and the specs.
- Do NOT change `priceWords`, the catalog, the product page, the basket rows or the line
  sheet.

### Constraints

- Strings through RokuTranslator keys in `en` and `es`.

### Action boundaries

- Stop and ask if a row draws "/ u" for anything that is not the price of one pack or one
  piece, whatever unit the line counts in.

### Progress evidence

`npx nx affected -t lint test`; a screenshot on a slot of a pack, a kilo piece and a
product by the kilo in both layouts.

## 1. Specs

1. `rowProduct` of a pack answers `price.per` "/ u"; of a product by the kilo "/ kg"; of a
   kilo piece with a piece price "/ u"; with no price, null.
2. The row of today draws "/ u" after the price; the compact row's second fact reads
   "1,20 € / u".
3. The catalog's `priceWords` spec is unchanged.

## 2. Acceptance criteria

- No zone list row shows a bare price of one.

## Not in this plan

- The basket rows and the catalog, which keep their words.
