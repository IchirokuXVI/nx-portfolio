# 0172 Where the measurement series stands on 2026-09-29

> **This plan builds nothing.** It is a status report on the postponed product quantity work,
> written on 2026-09-29 against `dev` at `2983c75a`. It says what exists in the code, what moved
> under the old plans since they were parked, what of each plan survives, and what the product
> owner still has to decide. It does not decide what happens next. The general backend status is
> [0171](./0171-plan-status-2026-09-29.md), and the status of every project is in
> [`docs/plans/0001`](../../../docs/plans/0001-plan-status-2026-09-29.md).

## Brief for the agent

- **Objective:** rewrite the measurement series against the code as it stands, starting from
  this report and the owner's decisions in section 2.
- **Context:** the series is backend [0095](./0095-a-price-says-what-it-is-per.md),
  [0096](./0096-a-product-is-measured-in-one-unit.md),
  [0101](./0101-a-line-counts-in-the-unit-the-shopper-chose.md) and
  [0102](./0102-one-unit-of-a-product-equals-so-many-of-another.md), with the client half in
  velista [0070](../../velista/plans/0070-a-weighed-product-has-a-till-line.md) and
  [backlog 0012](./backlog/0012-what-a-piece-weighs.md) behind it. It was written on
  2026-09-06 and 2026-09-09 (PR #250 and PR #305). On 2026-09-17 the owner decided that none of
  it is built as written, in [0121](./0121-plan-status-2026-09-17.md) section 1. Nothing of it
  is built today.
- **Target state:** new plans in `plans/` (next free numbers) that restate each surviving need,
  and a status header on each old file that names its replacement or says the need is gone.
- **Scope:** plans only. Read code anywhere.
- **Do not touch:** application code, on the strength of this file.
- **Constraints:** the facts below were true on 2026-09-29. Check each one again before you rely
  on it. Never reuse a migration timestamp an old plan names (section 8).
- **Stop and ask before:** writing the core half (what a line counts in) before the questions of
  section 7 have answers, and before folding two old plans into one new plan that changes what
  either promised the client.
- **Progress evidence:** each old plan with its replacement number or its decision.

## 0. How this was found

The four backend plans, velista 0070, backlog 0012 and both status reports of 2026-09-17 were
read in full. The code was then searched for every identifier the series introduces, and for
every column that already holds a size, a unit or a price per something. The plans built since
2026-09-17 were read where they touch sizes, prices, lines or purchases. Claims that were not
checked say so.

## 1. In one paragraph

Nothing of the series exists: there is no `MeasurementUnit`, no `comparablePrice`, no unit on a
line and no equivalence table. The ground under it moved a lot. The basket became a view of the
list lines (0130 to 0144), so the basket line the series put a unit on is gone. A price basis
now exists, read from the label on every read (0157), which reverses a rule of 0095. Items
learned how many are in a pack (0162). Purchases record a price paid per unit (0143) and sum
quantities into what was spent (0142). The need is intact, and it is visible in the app: a
product sold by weight has no till price, so velista draws it blank on the suggestion card, the
product row and the product sheet, and a settle records no price for it.

## 2. What the owner already decided

These come from the 2026-09-17 re-evaluation. No later plan contradicts them.

- **`soldBy` is dead as a product field.** What a shopper counts (the line) and what a shop
  measures (the item) are separate facts. They are joined only by an equivalence row, when one
  exists. Piece weights and slices were refused as too much manual work (backlog 0012).
  Learning from receipts is backlog 0008.
- **`MeasurementUnit` is `UNIT`, `GRAM` and `MILLILITER` only.** Never store kilograms or
  litres. Prices stay per kilogram and per litre.
- **Steps are 25 g and 50 ml below 1000, and 250 from 1000**, overridable by the item, then by
  the group.
- **One unit per item, several per group**, with an explicit default column on the group.
- **Any unit is selectable on a line.** An unsupported unit prices nothing, and every amount
  that is not a count of packs carries the estimate mark.
- **Backlog 0011 was retired into 0095**, and its number stays unused on purpose.

Two traps a rewrite must know:

- **The name `soldBy` is taken.** Plan 0146 made it a chain filter on the catalog read
  (`GetItemsRequest.soldBy`, `catalog.messages.ts` line 2106). A new field must not reuse it.
- **0095 forbade parsing the label, and 0157 (#459) now does it.** A rewrite either keeps the
  label table as the source of the basis or replaces it. It cannot ignore it.

## 3. What exists in the code today

### 3.1 The catalog

| Where | What it holds | Written by | Read by |
| ----- | ------------- | ---------- | ------- |
| `items.unitSize`, `numeric(12,4)` | the size, stated in `defaultUnit` | item creation from a harvest entry, the admin item form, curation | the search card, velista `CatalogItem.size`, the curation `FORMAT_MISMATCH` check |
| `items.defaultUnit`, enum `UnitOfMeasure` | `UNIT`, `GRAM`, `KILOGRAM`, `MILLILITER`, `LITER` or `PACK`. It names what the size is stated in. It is not a counting unit | same | same, and the groups decider |
| `items.packCount`, `smallint`, 2 to 1000 | how many are in the pack (0162, #476) | item creation, `fillPackCounts`, `UpdateItemRequest` | velista's "Pack 6" on the card |
| `product_groups.referenceUnit` | what the members compare in, default `UNIT` | admin, the groups decider | the groups decider only. No price ordering reads it |
| `item_prices.unitPrice` and `unitPriceLabel` | the source's comparison figure and its label, verbatim | `item-price-writer.ts` | `effective-price.service.ts` |
| `supermarket_items.price`, `unitPrice`, `unitPriceLabel` | the effective row a shopper sees | `applyEffective` | every offer read |

- **The basis is computed on read.** `catalog/unit-basis.ts` (0157) maps a lowercased label to
  `UnitBasis`: `KILOGRAM`, `LITER`, `UNIT`, `DOZEN` or `WASH`. `100 g` maps to `KILOGRAM` and
  `100 ml` to `LITER`, because Mercadona prints the shelf size beside a per kilogram or per litre
  amount. A label the table does not know reads as null. The basis rides on `ItemOfferView`,
  `SupermarketItemView` and `ItemPriceView`.
- **A row with no till price is not an offer (0157).** Offer ordering puts `price IS NULL` last,
  and the search's `cheapest` key reads only rows with a price. A product sold by weight whose
  only row is a price per kilogram therefore sinks in every ordering.

### 3.2 The harvester and the harvest document

- `source_catalog_entries` has `unitSize`, the verbatim `sizeFormat` and `packCount`.
  `source_entry_prices` has `unitPrice` and `unitPriceLabel`.
- Harvest document versions 1 and 2 exist. `HarvestDocumentUnitPrice` is `amount`, `label` and
  an optional `currency`, with no `per`. `HarvestDocumentSize` is `label`, `quantity` and `unit`,
  with no `measured_in`.

### 3.3 The sources

| Source | What it writes today |
| ------ | -------------------- |
| Mercadona | `unitPrice` from `bulk_price`, the label from `reference_format`, `packCount` from the pack fields. `selling_method` is in a fixture and is not read. Whether it marks products sold by weight is not verified |
| Carrefour | checks `measure_unit` and builds the labels `€/kg` and `€/l`. `packCount` from the pack phrase |
| LIDL | no unit price at all. Size and pack count parsed from the format text |
| DEZA | no price. Size parsing only |
| Leaflet CLI | `to-harvest-document.mjs` knows the basis (`MEASURED_BASES` is `kg` and `l`) and writes such a tile as `price: null` with a `unit_price`. **The basis is dropped at the document boundary**, and only the label survives |
| El Jamón (0169, plan only) | will write the labels `Kilo`, `Litro` and `Unidad`, which the basis table knows. The plan does not say what `price` holds on a row sold by weight |
| The reference seed | a `perKilo` flag writes the label `kg`, else `ud` |

### 3.4 Core: lines, baskets and purchases

- `list_lines.quantity` is an `int`, default 1, with no unit. The limits are 0 and 100000
  (`LINE_QUANTITY_MIN`, `LINE_QUANTITY_MAX`, mirrored in velista `limits.ts`).
- Every quantity in the list, basket and purchase schemas is an integer, so the gateway refuses
  a fraction with a 400. No rounding code exists.
- `line_settlements.quantity` is an `int`. `pricePaidCents` is the catalog `price` of **one
  unit** (0143, #433). The gateway records null when the offer has no `price`, which is every
  product sold by weight. 0143 says so on purpose, "until the measurement series exists".
- `basket_trip_rows.asked` and the change rows' `quantityBefore` and `quantityAfter` are
  integers.
- `purchases.sql.ts` sums `pricePaidCents * quantity` for what was spent, and sums `quantity`
  for what was bought.
- A quantity delta already carries an optional `expect` and is refused with `stale_quantity`
  (0136). A unit mismatch refusal can copy that pattern.

### 3.5 Velista

- `money.ts` exports `formatMoney` only. `QuantityReel` steps by 1.
- `PriceUnitBasis` in `catalog-browse.ts` mirrors the five basis values.
- **A product sold by weight is blank in three places:** the suggestion card's unit price
  (`suggestion-card-view.ts`) and the product row (`product-row-view.ts`) return nothing when
  `offer.price` is null, and `productShopPrices` marks such a chain unpriced.
- `BasketProduct.unit` is still the item's `defaultUnit` passed through with `nullableStr`,
  which is the rule D4 gap 0070 section 1 named.

### 3.6 The back office and the curation tools

- The admin item form edits `defaultUnit` and `unitSize`. It has no `packCount` field.
- `price-proposal.ts` (admin 0033, #468) proposes a price divided by the size, with the labels
  `1 kg`, `1 L` and `1 ud`.
- The curation suggestions gate (curation plan 0006, #467) already converts sizes to grams,
  millilitres and units (`toBaseSize`, `sameBaseSize`). The groups tool has
  `deriveUnitFamilies`.

## 4. What moved since 2026-09-17

| Change | What it does to the series |
| ------ | -------------------------- |
| 0157 (#459), the best offer has a till price, and a basis from the label | reverses 0095's rule against parsing labels. Its basis set has `DOZEN`, and no hundred gram or metre basis. Its "no till price is no offer" rule hides every product sold by weight, and a rewrite of 0096 has to lift it for those items |
| 0162 (#476), how many are in the pack | makes 0102 easier: a pack is now a count and a size. Carrefour already multiplies the count into `unitSize` |
| 0130 to 0144, the basket becomes a view | makes 0101 section 4 obsolete. `generated_list_lines` is dropped, so there is no basket line to copy a unit onto. Rows are `list_lines` grouped by merge key. Trip rows, change rows and settlements are the new places a unit has to reach |
| 0143 (#433), the price paid | a price of one unit in cents cannot hold a price per gram. It needs a rule |
| 0142 (#432) and velista 0095 (#447), purchases without a basket | what was spent and what was bought multiply and sum `quantity`, which is wrong for grams |
| 0091, 0112 and 0113, one line per name, merges on add and rename | "two lines of one product in two units" (0101 section 4, velista 0070 section 7) cannot exist in one list any more. Both merges sum quantities |
| 0136 (#426), `expect` and `stale_quantity` | makes 0101 easier: the optimistic check already exists |
| 0109, 0163 and velista 0102, prices at every shop and at one shop | 0095's ranking premise is stale, because the basket no longer picks one cheapest row. `BasketProductAtShop` carries `price` only |
| 0156 (#458), search rebuilt | 0095's line references are stale. The rank keys still end in the smallest `unitPrice` |
| 0115 (#501), similar products | the comparison with no basis check now exists in velista too (`product-group.ts`) |
| The product group rule of 2026-09-25 | a group never splits on package size or pack count, one group per item, backlog 0010 dropped. It fits "several units per group" |
| 0166 and 0167, the category tree | unrelated, but a possible source of a default unit (question 7 in section 7) |
| 0126 to 0128, Open Food Facts (not built) | a later source of a net weight. 0127 keeps facts in their own table, never on the item |
| 0103, 0116 to 0118, harvest document version 2 and the effective price | 0095's `per` and 0096's `measured_in` assumed a version 2 that was cut without them. They need an optional field or version 3 |
| El Jamón (0169, plan only) | the first storefront with rows sold by weight. It must state their unit and what `price` holds |

## 5. What survives of each plan

| Plan | Survives | Already covered | Obsolete |
| ---- | -------- | --------------- | -------- |
| 0095 a price says what it is per | a basis on every row that a machine can read, a comparable figure per kilogram or per litre, and ordering that never compares two bases | a basis on read (0157), fed by the Carrefour and leaflet labels | `per` in document version 2, stored hundred gram bases, the cheapest pick in `getMany`, "nothing reads `referenceUnit`" |
| 0096 a product is measured in one unit | all of it, and it matches the owner's decisions: the unit triple, `items.measurementUnit`, the group units and default, the steps, the membership refusals, `measured_in` from sources, the admin and curation fields | nothing | its line references and its migration timestamp |
| 0101 a line counts in the unit the shopper chose | the unit on `list_lines`, the unit on add, update and delta, a mismatch refusal, the client floor | the optimistic check (0136) | all of section 4 and `GeneratedListLineOriginView` |
| 0102 one unit equals so many of another | equivalences and `convertQuantity`, as the only join between what a shopper counts and what a shop measures | `packCount`, and the curation size conversion on the tool side | the `comparableSource` target and the timestamp. Its only concrete payoff today is LIDL, which prints no unit price |
| velista 0070 a weighed product has a till line | `formatQuantity`, cents arithmetic, `lineAmount`, the estimate mark, reel steps and a unit chip, the unit on a delta, a price per kilogram drawn for products sold by weight | `PriceUnitBasis`, `packCount` on the card | its component names: `basket-line-row` is now `basket-row`, the units sheet and line edit sheet are now `line-detail-sheet` and `row-entries`, and the typeahead card is `suggestion-card-view.ts` |
| backlog 0012 what a piece weighs | stays in the backlog | nothing | nothing. It depends on the rewritten 0096 and 0102. One cheap lead: Mercadona's `selling_method`, which the adapter does not read |

New work that 0101 never covered, and a rewrite of it must: the add and rename merges across
units, rows that group lines of two units, the unit on trip rows and change rows, settlements
and reverts in the line's unit (0104), what was spent and bought (0142), what `pricePaidCents`
means (0143), and the assistant's `line.addMany`.

## 6. Gaps visible today

- **Products sold by weight are blank** on the suggestion card, the product row and the product
  sheet, and their settles record a null price. This is the gap 0070 describes.
- **Offers of different bases are compared.** The group ordering in `item.service.ts` (the
  lateral near line 770) and the search `cheapest` key order by `unitPrice` with no check of
  the basis. Velista's `compareGroupOffers` and `isCheaper` in `product-group.ts` do the same,
  and they draw the "cheaper option" mark. It is wrong only when two members of one group state
  different bases, which the product group rule makes rare but does not forbid.
- **The admin price proposal writes labels the basis table does not know.** `1 kg`, `1 L` and
  `1 ud` read as a null basis. The path from the proposal to the stored row was not traced end
  to end.
- **Two labels are known to be wrong at the source and are mapped anyway:** `dz` and `dc` sit on
  a price per egg, and `lv` sits on a price per litre of detergent. `unit-basis.ts` documents
  both.
- **Fractions are refused, not rounded**, by every quantity schema.
- There is no `TODO` or `FIXME` about quantities or units in the backend or the libraries.

## 7. A shape for the rewrite, and what the owner decides first

A proposal, not a decision. The order puts the catalog first, because it is additive, touches no
core table and unblocks the most visible gap.

1. **A product is measured in one unit** (catalog and contracts). `MeasurementUnit`,
   `items.measurementUnit`, the group units and default column, the steps, the membership
   refusals, and sources that state the unit: the leaflet producer passes on the basis it drops
   today, the seed uses `perKilo`, El Jamón uses "sold by weight". It also carries the offer
   rule: for a `GRAM` or `MILLILITER` item, a row priced per kilogram or per litre with no till
   price is an offer. The admin fields, the OpenAPI document and the wire types go with it, and
   one admin plan beside it holds the item and group forms.
2. **Ordering compares like with like.** The group ordering, the `cheapest` key and velista's
   "cheaper option" compare only figures of one basis. It is small, and it can fold into the
   first plan.
3. **Velista draws a product sold by weight.** A price per kilogram on the card, the row, the
   sheet and the basket row, with the estimate mark. It needs only the first plan, so it can
   ship before any core work. It also fixes `BasketProduct.unit` under rule D4.
4. **A line counts in a unit** (core). The column, the unit on add, update and delta with the
   `expect` pattern, the merges, the basket rows, trip rows, change rows, settlements, purchase
   sums and the client floor. It is the largest part, and most of section 7's questions are
   about it. Velista's unit chip and reel steps follow it as their own plan.
5. **Equivalences** (0102) with an editor, or a backlog file until LIDL comparability is
   wanted.

Questions for the owner, in the order the plans need them:

1. **The basis.** Keep 0157's label table as the one source of the basis, or also store a basis
   where a source states one (Carrefour, the leaflets, El Jamón)?
2. **Offers sold by weight.** Should a row with no till price count as the offer of a `GRAM` or
   `MILLILITER` item in search and in the basket, and where does such an item rank in search?
3. **The recorded price.** What does `pricePaidCents` mean on a line in grams: cents per
   kilogram with the unit beside it, or a new total column?
4. **Estimates in history.** Is an estimated amount ever recorded, or only shown? Does what was
   spent (0142, and velista's "Bought" tab) include estimates, and are they marked?
5. **Merging across units.** How does a list merge "cheese, 2" with "cheese, 300 g": refuse,
   keep the existing unit, or allow two lines of one name, which breaks 0091?
6. **Basket rows.** When one row covers two lists in two units, is it one row or two?
7. **The default unit.** Only item then group, or can a category of the tree suggest one?
8. **El Jamón.** What does `price` hold on a row sold by weight? This one is needed before 0169
   is built, not before the series.
9. **The old files.** Do 0095, 0101 and 0102 get a "replaced by" header each, and is 0102
   rewritten now or parked in the backlog?

## 8. Migration timestamps

The latest migration in each database, and the timestamps the old plans name:

| Database | Latest |
| -------- | ------ |
| auth | `1772500000000-AuthAudit` |
| core | `1756003500000-SettlementChain` (0165) |
| catalog | `1758200000000-ShopSections` (0167) |
| harvester | `1757700000000-SourceEntryPackCount` (0162) |

| Old plan | Named | Now |
| -------- | ----- | --- |
| 0095 | `1757100000000` | taken in catalog (`StricterCatalogSearch`) and in the harvester (`AutoImportPlaces`) |
| 0096 | `1757200000000` | taken in catalog (`PriceScopePriority`) |
| 0101 | core `1757300000000` | free in core, but it breaks core's `17560...` sequence. The next core timestamp in sequence is `1756003600000` |
| 0102 | catalog `1757400000000` | taken (`PriceScopeLocalAreaRename`) |
