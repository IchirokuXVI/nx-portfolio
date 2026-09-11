# 0078: prices from one shop

> Last of the five basket finding plans (`0074` to `0078`). Server half: backend `0109`,
> which makes the basket read carry every shop's price for every product rather than the
> cheapest one. Nothing in this plan works without it, and the plan says where that shows.
>
> A basket is priced at the cheapest of the shopper's shops, product by product, and that
> is right for planning and wrong in an aisle. Standing in a Mercadona, the question is
> what Mercadona charges, whether something on the list is cheaper across the road, and
> which lines this shop does not stock at all. This plan answers the three, from one radio
> on the filter sheet.
>
> This plan supersedes `backlog/0001`, which recorded why the obvious version was wrong, and
> that file goes with it.
>
> Prerequisite reading: `0075` (the sheet and the pipeline), `0076` (the shop is remembered
> for two hours), `0062` sections 2 to 5 (how a price and a place are drawn, and the one
> offer the read carries today), `0059` sections 3.1 to 3.3 (the search, the franchise
> buttons and the shop list this plan reuses) and backend `0109` in full.

## 1. What is being built

| Piece                                                                 | Where                                                  |
| --------------------------------------------------------------------- | ------------------------------------------------------ |
| Every scope's offer on the client model                               | `BasketProduct.offers`, `basket-mappers.ts`            |
| The "Prices from" section of the sheet                                | `filter-sheet`                                         |
| The shop picker, a sheet of its own at `sheet/filter/shop`            | a new `shop-picker-sheet`, `routes.ts`, `index.ts`     |
| `FranchiseButtons` and `ShopList`, moved where two features can reach them | `libs/velista/ui/src/lib/shops/`                  |
| A pick mode on `ShopList`                                             | `shop-list`                                            |
| The marks on the row and the sink in the pipeline                     | `compose-basket-view.ts`, `basket-line-row`            |
| `backlog/0001` deleted                                                | `apps/velista/plans/backlog/`                          |
| The copy                                                              | `en.json`, `es.json`                                   |

## 2. The offers reach the client

`BasketProduct` keeps `offer`, the cheapest, which `0062` drew and which "Any of your shops"
still draws, and gains:

```ts
/** One per scope the run is priced at that lists this product. Empty is unlisted everywhere. */
readonly offers: readonly ProductOffer[];
```

mapped from `ItemView.offers`, which backend `0109` fills when the basket read asks for
every scope. `offerAt(product, scopeId)` in `models` is the one place the lookup lives and
answers null for a scope that does not list the product.

## 3. The sheet's section

**PRICES FROM**, between "Group by" and "Lists", two radios:

- "Any of your shops", with "the cheapest" at its trailing edge. The default, and what the
  row has always drawn.
- The chosen shop: the chain's name, with the shop's own name under it when the reader was
  sent one (`BasketPriceScope.locations`, empty for a guest), and **Change** at its
  trailing edge, a text button. Before a shop was ever chosen the row reads "One shop" in
  the muted colour, its radio is disabled, and the button reads **Choose**.

Choosing a shop in the picker selects the second radio. The radio itself, once a shop is
known, switches between the two without opening the picker.

**The section is absent for a basket with no scopes** (`BasketView.scopes` empty): a run
scoped by hand, a profile since deleted, a backend that failed to price. The rest of the
sheet is unchanged. `0062` section 2's rule, that no layout depends on a price existing,
holds for the sheet as it holds for the row.

## 4. The picker

A profile can hold fifty shops, so the shop is chosen in a sheet of its own,
`ShopPickerSheet` at `sheet/filter/shop`, declared with `sheet()`, exported, and one more
row in the dismissal table. Change navigates to it with `leaveTo`, and picking a shop
navigates back to `sheet/filter` the same way, so the filter sheet is not pushed and the
back gesture from the picker lands on the filter sheet exactly once (`0031`).

It is built from the supermarkets page's pieces, in this order top to bottom, which is that
page's order (`0059`):

- **The search, across every chain**, matching shop name, chain name, address, city and
  postal code, the five fields `0059` section 3.1 names. In memory, over the basket's
  scopes and their locations, folded as `0074`'s matcher folds. While a query is typed the
  chain buttons stay and the list below is the flat matches, as the supermarkets page does.
- **The franchise buttons**, one per chain among the basket's scopes, with the count of
  shops the reader can see under it. No OTHER button: a basket's scopes all belong to a
  chain. Tapping one opens it, and the search is cleared, which is `ShopStore.select`'s
  rule and holds here.
- **The open chain's shops**, grouped by postal code. The basket's `ScopeLocation` carries a
  postal code and not the profile's label for it, so the heading is the code, which is the
  fallback `0059` section 3.3 already names. One radio per shop. Two shops in one scope
  are two rows, and picking either picks the scope, since the price is the scope's.
- For a reader sent no locations, a guest, the chain buttons are the whole picker: tapping
  one picks that chain's scope. A chain with two scopes and no locations to tell them apart
  is drawn as two buttons with the same name, which is honest and rare.

`FranchiseButtons` and `ShopList` move from `feature-account` to
`libs/velista/ui/src/lib/shops/`, exported from `@portfolio/velista/ui`, because
`feature-shopping-lists` cannot import a lazy loaded feature. Their templates and styles
move unchanged. `ShopList` gains `mode: 'exclude' | 'pick'`, default `exclude`, and under
`pick` its row is a `<label>` around a radio, with a `pickedId` input and a `pick` output.
`FranchiseButtons` needs nothing: its rows already take a name and a count, and the two
exclusion states are never set here.

The picker holds no state of its own. It reads `BasketViewStore.shop` and writes it, so the
chosen shop survives leaving and returning, and `0076` remembers it for two hours.

## 5. What the row shows

With a shop chosen, every row's price is `offerAt(pick, shop)`, drawn where `0062` draws
it, after the product name. Then one of two marks, or none:

- **Cheaper elsewhere.** When another of the basket's scopes lists the product for less,
  the caption continues: "· 1.99 € at Dia", in the attention colour. It is a decision the
  shopper faces, a cheaper price, not an error, and `0002` section 4.4 names attention as
  the role for exactly that. The chain is named, and the shop is not: `0062` section 5.1's
  rule for a place with several locations.
- **Not listed.** When the chosen scope has no offer for the pick, the caption reads "not
  listed at Mercadona", muted, followed by the cheapest other price and its chain when one
  exists. And the line **sinks**: ungrouped, to the end of the list under the heading "Not
  listed at Mercadona" with the hint "still yours to get", and grouped, to the end of its
  group, keeping its relative order with the others that sank. Both are the pipeline's
  second step (`0075` section 3), before grouping, so a category keeps its own sunk lines.

A line with no pick has no price, no mark, and never sinks: there is nothing to be unlisted.

**The settle controls never leave a row.** A line the shop does not list is still a line
the shopper is standing in the shop with, and "they had none" is one of its answers.

### 5.1 A shop with no prices at all

Staging and production carry no prices today, and a profile's shops exist whether or not
the harvester has priced them. A shop none of whose scopes list any product on the basket
is not a shop that stocks nothing: it is a shop nobody has priced. So the marks and the sink
are drawn only when the chosen scope lists **at least one** product on the basket.
Otherwise every row draws as under "Any of your shops", the chip still names the shop, and
nothing claims a line is unlisted. The rule lives in `composeBasketView` and has a test.

## 6. Copy

| Key                            | en                                |
| ------------------------------ | --------------------------------- |
| `basket.view.shop.legend`      | Prices from                       |
| `basket.view.shop.any`         | Any of your shops                 |
| `basket.view.shop.anyGuest`    | Any of the shops                  |
| `basket.view.shop.anyHint`     | the cheapest                      |
| `basket.view.shop.none`        | One shop                          |
| `basket.view.shop.choose`      | Choose                            |
| `basket.view.shop.change`      | Change                            |
| `basket.view.shop.title`       | Prices from                       |
| `basket.view.shop.search`      | Shop, chain or street             |
| `basket.view.shop.count_one`   | {{count}} shop                    |
| `basket.view.shop.count_other` | {{count}} shops                   |
| `basket.price.cheaperAt`       | {{price}} at {{chain}}            |
| `basket.price.notListedAt`     | not listed at {{chain}}           |
| `basket.group.notListed`       | Not listed at {{chain}}           |
| `basket.group.notListedHint`   | still yours to get                |

Spanish beside each. `shops.search.label` and `shops.search.results` are reused for the
picker's field and its count.

## 7. Accessibility

- The "Prices from" radios are a `fieldset` like the others. The disabled "One shop" radio
  is disabled, not hidden, so the group reads as two choices with one not yet available.
- Change and Choose are buttons whose names include the section: "Change the shop prices
  are from".
- The picker's search has its label and its announced count, both reused from the
  supermarkets page.
- A mark is words beside a number. The attention colour is never the only carrier: "1.99 €
  at Dia" says it, and a screen reader hears the sentence.
- A sunk line keeps its accessible name and gains the heading above it, or the caption on
  it, so why it moved is read.

## 8. Tests

1. `toBasketProduct` reads `offers` into a list and `offerAt` answers null for a scope that
   does not list the product.
2. The section is absent with no scopes, draws "One shop" disabled with Choose before a
   pick, and the chosen shop with Change after.
3. Change navigates to `sheet/filter/shop` with `leaveTo`, and picking navigates back with
   `leaveTo`, asserted on which `SheetNavigation` method the sheet called.
4. The picker groups the basket's scopes by chain with a count each, opens a chain's shops
   grouped by postal code, and clears the search on a chain tap.
5. The picker's search matches the five fields, folded, and lists the flat matches.
6. A guest's picker draws chain buttons only, and tapping one picks the scope.
7. `ShopList` under `pick` draws radios, marks `pickedId`, and emits `pick`.
8. With a shop chosen, a row draws that scope's price, the cheaper elsewhere caption with
   the cheapest other chain, or the not listed caption.
9. Unlisted lines sink to the end ungrouped under `basket.group.notListed`, and to the end
   of their group grouped, keeping their relative order.
10. A line with no pick draws no mark and never sinks.
11. A chosen scope that lists no product on the basket draws no marks and sinks nothing.
12. The chip for the shop is the chain's name alone.
13. `routes.spec.ts` sees both new sheets under the marker, and the dismissal table has
    both rows.

## 9. Acceptance criteria

- The filter sheet offers any of the shopper's shops or one of them, and the one is chosen
  chain first, then shop, or by search, in a picker built from the supermarkets page.
- With a shop chosen, every row shows that shop's price, says when another shop is cheaper
  and where, and lines the shop does not list are last and marked, in the list or in their
  group.
- Every line can still be settled, listed or not.
- A shop nobody has priced marks nothing.
- A guest picks a chain and never sees a shop's name.
- `backlog/0001` no longer exists, and nothing it recorded is lost: its finding is section
  2 of this plan and section 2 of backend `0109`.
