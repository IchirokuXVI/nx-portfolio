# 0209: a size names its units and its pieces

> Asked for by the owner on 2026-11-26 (decision 153a). A product that is a pack has the
> weight of the whole pack and the weight of one unit, and the shopper wants both: a tray of 4
> burgers is "360 g (4 x 90 g)". A bag of candies is sold by weight, and the shopper also wants
> to know how many candies it holds: "70 g, 100 pieces". The owner chose one separate piece
> count next to the pack count, the pack count on the catalog tab too, and the size printed with
> the units.
>
> **The look is approved before any code** (the owner's rule: mocks before a visible velista
> change). Stage 1 of this plan is the mock and stops for the owner's answer. Stage 2 needs that
> answer and backend plan `0278` merged.
>
> Every anchor below was read on `origin/dev` at `e56cf9b51` on 2026-11-26. Line numbers are of
> that commit.
>
> Prerequisite reading: backend plan `0278` sections 1 and 2 (what the two counts mean and when
> each may be set), backend plan `0162` (the pack count), velista plans `0101` (the card),
> `0162` (one product card), `0179` (a weight starts with a tilde) and `0191` (the compact
> row's first fact), `apps/velista/plans/mocks/README.md`, and the "Angular conventions"
> section of `CLAUDE.md`. Load the `design-taste-frontend` skill before the mock and before any
> code.

## Brief for the agent

### Objective

Make every place in velista that prints the size of a product print its counts with it: the
total first, then the units of the pack, then the pieces. Carry `packCount` and `pieceCount` on
every product model velista maps, from every read that answers a product. Draw it first as a
mock, and build it only after the owner approves.

### Context

- **The size text is one function.** `productSizeText(size, unit, locale, translate,
  approxWeight)` (`libs/velista/ui/src/lib/catalog/product-size.ts` lines 32 to 60) prints
  `unitSize` with its unit ("360 g", "1000 ml", "12 uds"), or the weight of a piece first
  ("~1,56 kg", lines 39 to 41). `productDetailText` (lines 94 to 115) and
  `productBrandSizeText` (lines 122 to 143) join it with the brand.
- **The pack is a separate word today.** `productRowView` adds "Pack 4" after the size
  (`libs/velista/ui/src/lib/catalog/product-row-view.ts` lines 101 to 105), and so does the
  suggestion card (`libs/velista/ui/src/lib/list/suggestion-card-view.ts` lines 100 to 102,
  and its pick label at lines 115 to 130). The key is `list.add.card.pack`: "Pack {{count}}",
  "Pack de {{count}}".
- **Only one model carries the pack.** `CatalogItem.packCount` (`libs/velista/models/src/lib/domain.ts`
  lines 611 to 616), mapped by `toCatalogItem` (`libs/velista/data-access/src/lib/mapping/mappers.ts`
  line 766, `toPackCount` at line 821). `CatalogProduct`
  (`libs/velista/models/src/lib/catalog-browse.ts` line 127, mapped by `toCatalogProduct` in
  `catalog-browse-mappers.ts` line 49) and `BasketProduct`
  (`libs/velista/models/src/lib/basket-view.ts` line 322, mapped by `toBasketProduct` in
  `basket-mappers.ts` line 613) have none, although their wire answers carry it: the catalog
  tab's `GET /v1/catalog/items` answers `ItemView`, and the basket's product spreads the same
  fields (backend plan `0278`, Context). So the catalog tab and the shopping list cannot say
  "Pack 4" today.
- **Every caller of the size text:**

  | Where | File and line | Product model |
  | --- | --- | --- |
  | Card of the catalog tab, search, Choose a product, similar products, product page | `ui/src/lib/catalog/product-row-view.ts` line 94 | `CatalogProduct` or `CatalogItem` |
  | Suggestion card and its pick label | `ui/src/lib/list/suggestion-card-view.ts` lines 100 to 130 | `CatalogItem` |
  | Zone list row, second line | `feature-lists/src/lib/list-page/list-page.ts` line 644 | `CatalogItem` |
  | Zone list compact row, first fact | `feature-lists/src/lib/list-page/list-page.ts` lines 645 to 652 | `CatalogItem` |
  | Line page | `feature-lists/src/lib/line-page/select-line-page.ts` line 170 | `CatalogItem` |
  | Line sheet | `feature-lists/src/lib/line-detail-sheet/select-line-detail.ts` line 198 | `CatalogItem` |
  | Rename line sheet | `feature-lists/src/lib/rename-line-sheet/rename-line-sheet.ts` line 129 | `CatalogItem` |
  | Shopping list row | `feature-shopping-lists/src/lib/basket-page/basket-page.ts` line 2287 | `BasketProduct` |
  | Row lists sheet | `feature-shopping-lists/src/lib/row-lists-sheet/row-lists-sheet.ts` line 332 | `BasketProduct` |
  | Shopping list labels | `feature-shopping-lists/src/lib/basket-labels.ts` line 373 | `BasketProduct` |
  | Amount caption ("2 × ~700 g") | `ui/src/lib/catalog/line-amount-words.ts` line 69 | the line's product |

  All paths are under `libs/velista/`.
- **Copy** is in `libs/velista/ui/assets/i18n/en.json` and `es.json`: `list.add.size.*`
  ("{{size}} g", "{{size}} ml", "{{size}} uds"), `list.add.weight.*` ("~{{size}} g") and
  `list.add.card.pack`.

### Target state

1. Stage 1: a mock in `apps/velista/plans/mocks/pack-and-pieces/`, published as an Artifact,
   and the owner's answer to it.
2. `CatalogItem`, `CatalogProduct` and `BasketProduct` each carry `packCount: number | null` and
   `pieceCount: number | null`, required, mapped from `unknown` (rule D4): a whole number from 2,
   anything else null.
3. Every place in the table above prints the size by the rules of section 2, through one
   function, and the separate "Pack N" word is gone wherever the size can carry the count.
4. The memory fakes and the specs hold a product of each case of section 2.
5. Copy in `en.json` and `es.json` of `libs/velista/ui/assets/i18n/`.

### Scope

- Stage 1: `apps/velista/plans/mocks/pack-and-pieces/` and one row in
  `apps/velista/plans/mocks/README.md`.
- Stage 2: `libs/velista/models`, `libs/velista/data-access` (the three mappers and the memory
  fakes), `libs/velista/ui` (the size text, the row and card views, the translations), and the
  callers in `feature-lists`, `feature-catalog` and `feature-shopping-lists` that the table
  names.
- Do not touch the backend, the back office, prices, totals, the stepper, or what a line amount
  means.

### Constraints

- **Mock first.** Draw section 2's cases in the product card, the zone list row and its compact
  row, the shopping list row, the line page and the line sheet, Day in Spanish and Night in
  English, as `*.dc.html` artboards with a `canvas.json`, then run
  `node apps/velista/plans/mocks/build-index.mjs pack-and-pieces`. Put O1, O2 and O3 on the
  canvas as lettered choices. Follow the owner's taste: quiet and integrated, no tinted
  container, no new colour role. Then stop.
- The total is always the product's `unitSize`, as the server holds it. The weight of one unit
  is derived on read and never stored or sent.
- Numbers through `Intl.NumberFormat`, never a pipe that needs `LOCALE_ID`. Every word and sign
  is in the translation, so a language can move it.
- No raw pixels (`token-hygiene.spec.ts`).
- Only make changes directly requested.

### Action boundaries

- Proceed with stage 1, then stop and give the owner the mock link and the lettered choices.
- After the owner approves, and only once backend plan `0278` is merged, proceed with stage 2.
- Stop and ask if `ItemView` on the gateway has no `pieceCount`, or if the owner's answer
  changes a rule of section 2.

### Progress evidence

Stage 1: the mock link and the owner's answer. Stage 2: `npx nx test` and `npx nx lint` of
`velista/models`, `velista/data-access`, `velista/ui`, `velista/feature-lists`,
`velista/feature-catalog` and `velista/feature-shopping-lists`, `npx nx build velista`, and one
walk on an Angular slot against a Luna slot with backend `0278`, with a screenshot of the
catalog tab and the shopping list showing a 360 g pack of 4 and a 70 g pack of 2 with 100
pieces.

## 1. The models and the mappers

Each of the three models gains, beside the fields it has:

```ts
/**
 * How many units the pack holds, a whole number from 2, or null for a product
 * that is not a pack (backend 0162). The size is the whole pack.
 */
readonly packCount: number | null;
/**
 * How many pieces the whole product holds, across its pack, a whole number
 * from 2, or null (backend 0278). Only beside a size in grams or millilitres.
 */
readonly pieceCount: number | null;
```

Required, so a conversion from one product shape to another cannot drop them unseen, as
`quantityStep` is. `toCatalogItem`, `toCatalogProduct` and `toBasketProduct` read
`raw['packCount']` and `raw['pieceCount']` through one helper each (`toPackCount` exists; add
`toPieceCount` beside it, or one `toCount`), so a value that is not a whole number from 2 is
null. An older gateway that sends no `pieceCount` reads as null. `ProductRowSource` in
`product-row-view.ts` loses its optional `packCount` and takes both from `CatalogProduct`.

## 2. How a size is printed

`productSizeText` gains a last parameter, `counts: { packCount: number | null; pieceCount:
number | null }`, required, so no caller forgets it. `productDetailText` and
`productBrandSizeText` read both from the product they are given. A caller that prints a total
only (O3) passes `NO_COUNTS`, a named constant.

The rules, in this order:

1. **A weight still answers first.** A product with `approxWeight` prints "~1,56 kg" as today
   (velista `0179`). The server never sets a piece count beside a weight. A pack count beside a
   weight prints as today: "~1,56 kg · Pack 2".
2. **No size: the pack as today.** A pack count with no size prints "Pack 4" / "Pack de 4",
   joined after the brand as today.
3. **The total first**, as today: "360 g", "1000 ml", "12 uds".
4. **Then the units of the pack**, when `packCount` is set: "(4 × 90 g)". One unit is
   `unitSize / packCount`, in the same unit word as the total. When it is whole at the precision
   the unit prints (no decimals for g and ml, up to three for L and kg, as today), it is plain;
   when it is not, O1 decides.
5. **Then the pieces**, when `pieceCount` is set: ", 100 pieces" / ", 100 piezas" (O2 decides the
   word).
6. **A counted size** (`UNIT` or `PACK`) with a pack count prints its units only when the
   division is whole: "30 uds (3 × 10 uds)". Otherwise the total and "Pack 3" as today. The
   server refuses a piece count beside a counted size.

Examples, English and Spanish:

| Product | `unitSize` | Unit | Pack | Pieces | en | es |
| --- | --- | --- | --- | --- | --- | --- |
| Burger tray | 360 | `GRAM` | 4 | null | 360 g (4 × 90 g) | 360 g (4 × 90 g) |
| Candy bag | 35 | `GRAM` | null | 50 | 35 g, 50 pieces | 35 g, 50 piezas |
| SMINT, 2 bags | 70 | `GRAM` | 2 | 100 | 70 g (2 × 35 g), 100 pieces | 70 g (2 × 35 g), 100 piezas |
| Cheese slices | 185 | `GRAM` | 7 | null | 185 g (7 × ~26 g) under O1 A | 185 g (7 × ~26 g) |
| Milk, 6 cartons | 6000 | `MILLILITER` | 6 | null | 6000 ml (6 × 1000 ml) | 6000 ml (6 × 1000 ml) |
| Pack with no size | null | `UNIT` | 4 | null | Pack 4 | Pack de 4 |
| Kilo piece | null | `KILOGRAM` | null | null | ~1.56 kg | ~1,56 kg |
| Sold by the kilo | null | `KILOGRAM` | null | null | nothing, as today | nothing, as today |

The sign between the count and one unit is "×", the sign velista's amount caption already
uses ("2 × ~700 g"). The owner wrote "x" in decision 153a; the mock shows "×", and the owner's
answer to the mock settles it. Volumes keep the stored unit, as the total does today
("6000 ml", not "6 L"): scaling a size to a larger unit is not this plan.

Copy, a sketch; the builder keeps the file's key style:

| Key | en | es |
| --- | --- | --- |
| `list.add.size.packOf` | `{{total}} ({{count}} × {{each}})` | `{{total}} ({{count}} × {{each}})` |
| `list.add.size.pieces` | `{{size}}, {{count}} pieces` | `{{size}}, {{count}} piezas` |

The accessible label of a card says the same text, so a screen reader hears the counts too.
Check how the screen reader of the walk reads "×"; if it reads nothing, the label uses the
word ("4 times 90 g" / "4 por 90 g") through its own key.

## 3. Where the long form prints

O3 decides. Under its recommendation:

- **The long form** in the product card (catalog tab, search, Choose a product, similar
  products, the product page's detail), the suggestion card and its pick label, the zone list
  row's second line, the line page, the line sheet, the rename sheet, the shopping list row, the
  row lists sheet and the shopping list labels.
- **The total only** in the compact row's first fact (velista `0191`) and in the amount caption
  (`line-amount-words.ts`), which already multiplies a count by the size ("2 × 360 g").
- The separate "Pack N" of `productRowView` and the suggestion card is printed only in rule 2's
  case, where the size cannot carry it.

## 4. Specs

- `product-size.spec.ts`: every row of the table in section 2 in both languages, a not whole
  unit, a counted size whole and not whole, a pack count of 1 and a piece count of 1 read as
  nothing.
- `product-row.spec.ts` and `suggestion-card-view.spec.ts`: the detail line and the label carry the
  counts, and "Pack N" shows only with no size.
- The three mapper specs: both counts read, a string, 1, 2.5 and a missing field read as null.
- The specs of each caller in section 3 that asserts a detail text, updated to the new text.
- The memory fakes (`catalog-memory.ts` line 226 and the browse and basket fakes) hold the
  burger tray and the SMINT product.

## 5. Acceptance criteria

- [ ] The mock is published and the owner approved it before any code.
- [ ] `CatalogItem`, `CatalogProduct` and `BasketProduct` carry both counts, mapped from
      `unknown`.
- [ ] The catalog tab and the shopping list say the pack, which they could not before.
- [ ] Every place of section 3 prints the size by the rules of section 2, in both languages.
- [ ] Specs, lint and `npx nx build velista` pass.

## Not in this plan

- Any backend change (backend plan `0278`) and the back office (admin plan `0075`).
- A price per unit or per piece. Prices and the comparable price are unchanged.
- A line counted in pieces, or a stepper that steps by them.
- Scaling a size to a larger unit ("6000 ml" to "6 L").
- The Bought history, which prints a buy's snapshot (backend `0278`, O2).

## Open decisions for the owner

**O1. What prints when one unit is not a whole number?**

- **A. Rounded to the unit, with a tilde (recommended).** The tilde already means "about" in
  velista (velista `0179`). Example: 185 g in 7 slices prints "185 g (7 × ~26 g)".
- **B. One decimal, no tilde.** Example: "185 g (7 × 26,4 g)".
- **C. No weight of one unit, the count alone.** Example: "185 g, pack of 7" /
  "185 g, pack de 7".

**O2. Which word counts the pieces?**

- **A. "pieces" and "piezas" (recommended).** It cannot be read as the size of a counted
  product, which already prints "12 uds". Example: "70 g, 100 piezas".
- **B. "units" and "uds".** Shorter, and the word a Spanish shelf label uses, but "70 g, 100
  uds" reads like the size "12 uds" of a counted product.
- **C. "pcs" and "pzs".** Shortest. Example: "70 g, 100 pzs".

**O3. Where does the long form print?**

- **A. Everywhere a size names a product, except the compact row and the amount caption
  (recommended).** Those two are short on purpose, and the caption already multiplies.
  Example: the compact row says "360 g", the full row "Hacendado · 360 g (4 × 90 g)".
- **B. Everywhere, the compact row and the caption too.** Example: the caption "2 × 360 g (4 ×
  90 g)".
- **C. Only on the product card and the product page.** Example: the shopping list row says
  "Hacendado · 360 g" with no count.
