> **PR:** [#459](https://github.com/IchirokuXVI/nx-portfolio/pull/459)

# 0157: the best offer is one with a price

> Found by `0150` (report finding 4, shopper F3, F7 and F8). Prerequisite reading: `0080`
> (side by side prices), `0081` (why a leaflet row can carry a unit price and no till price),
> and in the code `offersFor` and `allOffersFor` in catalog's `item.service.ts` and
> `scope-resolver.service.ts`.

Search showed an El Jamón leaflet row with `price: null` as the best offer for Heineken,
Fabada and Cruzcampo, while the same products had real Mercadona prices in the shopper's
area. The basket picked the Mercadona price for the same products, so search and basket
disagreed. Seven of the twelve shops in the shopper's area had no prices at all, yet the
catalog scope answer marked every one of them `quoted: true`. Unit price labels read "el
litro le sale a", "dz" on a price per egg, and "lv" on a price per litre.

## Brief for the agent

### Objective

Make every read that names a best offer prefer an offer with a till price, make the scope
answer say whether a shop has any price, and give each offer a unit basis a client can
display without parsing the printed label.

### Context

- **Search, items.** `item.service.ts:490` calls `offersFor` with the default
  `rank='unitPrice'` (`:769`), which sorts unit price ascending with nulls last, then price
  (`:775-789`). A leaflet row with no price and a unit price of 2 beats a Mercadona row at
  0,69 € with no unit price.
- **Search, groups.** The lateral join at `:551-553` does the same.
- **Search, ranking.** The `cheapest` key uses `min(si."unitPrice")` (`:926`).
- **Basket.** `basket-catalog.service.ts:86` asks `getMany` with `offers: 'all'`, which uses
  `allOffersFor`, sorted by price first (`:836-837`), and `bestOffer = offers[0]` (`:425`).
- **Why the leaflet row has no price.** The leaflet builder writes a unit price with no till
  price for per kilo tiles and conditional promotions, on purpose
  (`libs/luna-shopper/tools/leaflet/cli/src/to-harvest-document.mjs:146-185`), and the
  import keeps it (`file-import.runner.ts:297-302`). Such a row is information, not an offer
  a shopper can pay.
- **quoted.** `scope-resolver.service.ts:217` sets `quoted: index === 0`, the head of the
  shop's scope stack (`location-scopes.ts:38-80`). The fallback rungs hard code `quoted: true`
  (`:310, 326`). Nothing checks for rows. An imported location's own empty `STORE` scope is
  therefore `quoted`.
- **Labels.** `unitPriceLabel` is free text on `supermarket_items` and `item_prices`
  (`supermarket-item.entity.ts:67-75`), shown as is (`catalog.mappers.ts:280, 298, 318`).
  "dz", "dc", "lv" are Mercadona's `reference_format`, copied verbatim
  (`libs/luna-shopper/mercadona/src/lib/normalize.ts:87, 136`). CLAUDE.md: `bulk_price` is
  stored verbatim and never recomputed. The label stays verbatim too.
- The shopper answer already carries `ean`, `brand`, `unitSize` and `defaultUnit`
  (`catalog.mappers.ts:211-224`). Telling "Leche entera" 0,96 € from "Leche entera" 1,15 €
  (F1, F2), and showing "Refresco" with its brand (F10), is a velista display choice. It
  needs a mock first, and no velista plan is written here.

### Target state

- `offersFor`, the group lateral and the `cheapest` key order `price IS NULL` last before
  any other key. `bestOffer` in search is never a row with no price while a row with a price
  exists. Search and basket name the same best offer for the same item and scopes.
- The scope answer carries `priced: boolean` per scope, true when at least one available
  `supermarket_items` row exists for it. `quoted` keeps its meaning.
- Every offer carries `unitBasis`, one of `KILOGRAM`, `LITER`, `UNIT`, `DOZEN`, `WASH` or
  null, read from the verbatim label by a fixed table. The label and the amount do not change.
- A table test covers every label value found in the seed dump.

### Scope

Work only in:

- `apps/luna-shopper-backend/catalog/src/app/catalog/item.service.ts` (offer ordering only),
  `scope-resolver.service.ts`, `catalog.mappers.ts`, a new `unit-basis.ts`, and their specs
- `libs/luna-shopper/contracts` for `priced` and `unitBasis`, plus the regenerated
  `openapi.json` and `wire-types.ts`

Do not touch: search matching (plan `0156`), the leaflet tool (its plans under
`libs/luna-shopper/tools/leaflet/cli/plans`), stored labels or amounts, price policies, or
any velista code.

### Constraints

- **Nothing stored is rewritten.** `unitBasis` is computed on read from the label.
- A label the table does not know gives `unitBasis: null`, never a guess.
- "dz" on a price that is clearly per egg is a data defect in the source. Do not correct the
  amount. List such rows in the PR as a count.
- Only make changes directly requested.

### Action boundaries

Stop and ask before: changing `effective-price.ts`, dropping `quoted`, or storing a derived
unit price.

### Progress evidence

- Specs: an item with a priceless leaflet row and a priced API row names the API row as
  best, in `offersFor`, the group lateral and the `cheapest` key.
- A spec: basket and search agree on the best offer for the `0150` Heineken case.
- Scope resolver specs for `priced` on an empty `STORE` scope, a priced warehouse scope and a
  fallback rung.
- The `unitBasis` table spec.
- `npx nx test luna-shopper-backend-catalog` and `npx nx test luna-shopper-backend-gateway`
  pass, and the OpenAPI and wire types are regenerated.

## 1. The label table

| Verbatim label, after lowercasing and trimming | `unitBasis` |
| --- | --- |
| kg, kilo, el kilo le sale a | KILOGRAM |
| l, litro, el litro le sale a | LITER |
| ud, unidad | UNIT |
| dz, dc, docena | DOZEN |
| lv, lavado | WASH |

Extend the table only from values found in the seed dump, and list the values it leaves null
in the PR.
