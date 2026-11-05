# 0244: a piece sold by the kilo states its approximate weight

> Found on 2026-11-03 in production: Mercadona's 1.56 kg piece of "Queso viejo tostado mezcla"
> (product `eb09e84e`) is stored as 1560 g for 13.42 €, the price of a kilo. The evidence, the
> cause and the classified list are in `apps/luna-shopper-backend/docs/kilo-pieces-2026-11/`.
>
> **Reviewed and rewritten on 2026-11-04** (section 6 of the evidence README). The first draft
> would have shipped two new defects and left three old ones in place. What changed:
>
> 1. Seven Mercadona products answer `approx_size: true` with a comparison **per piece**
>    (`reference_format: "ud"`). Their `bulk_price` is the price of the piece, not of a kilo.
>    The adapter flags them as sold by weight since plan `0181`, and the first draft's release
>    task would have turned a 6.50 € salad into 6.50 € a kilo. The flag now also needs a
>    comparison per kilo (5.1), and such a piece is its own kind (section 1).
> 2. The matcher, the sibling index and the merge refusal treat two pieces of one name as one
>    product, because neither has a size. That is how the six merged products were made, and
>    two unresolved twins in the queue would be proposed onto the other piece today. The
>    weight is now part of a product's identity (3.5, 5.8).
> 3. A basket settle records the offer's price as the price paid. For a kilo piece that is the
>    price of a kilo (section 4).
> 4. LIDL prints "Aprox. 350 g" and the adapter stores a fixed 350 g pack. DIA's parser reads
>    "800 g aprox." and the runner drops the flag. Both are the stale size defect waiting for
>    the next run (5.2, 5.3).
> 5. The weight was allowed on `KILOGRAM` only, which cannot hold a piece priced as one. The
>    harvest document had no field for a weight, so a leaflet could never state one (5.5).
>
> Prerequisite reading: that folder; plan `0181` (a product sold by weight is priced by the
> kilo); plan `0183` (base units); plan `0237` section 3.3 (`item_kilogram_has_size`); plan
> `0162` (`fillPackCounts`, the pattern of a fill from a run); plan `0080` (prices side by
> side, decided on read); plan `0239` (the merge refusals); plan `0155` and
> `harvester/src/app/harvest/matching.ts` (the rungs and their keys); k8s plan `0011` and
> `k8s/release-tasks/README.md`.
>
> Followed by velista plan `0179` and back office plan `0068`, which read the contract this
> plan adds.

## Brief for the agent

### Objective

Give the catalog the weight of a piece whose weight is approximate. Store it beside the
product, derive the piece price from it on every read when the product is priced by the kilo,
keep it current from the runs, make it part of what tells two pieces apart, and correct the
products that production holds today.

### Context

The owner's model (2026-11-03) has two kinds of product sold by the kilo:

1. **Sold by the kilo with no set weight** (loose fruit, the deli counter): no size, a price
   per kilo. This is what plan `0181` built, and it stays as it is.
2. **Sold by the kilo with a set approximate weight** (a tray, a cheese piece): it shows
   "about 1.56 kg". Its piece price comes from that weight and its price per kilo. Two pieces
   of one product at different weights are two products, because the price per kilo differs.

The review of 2026-11-04 found a third shape in the same data, and the model has to hold it:

3. **A piece priced as one, whose weight is approximate** (a salad tub, a fuet, a tray of
   fish): the chain prints "about 580 g" and one price for the piece. Mercadona has 7 such
   products in production (`approx_size: true`, `reference_format: "ud"`, `unit_price` equal to
   `bulk_price`, read live on 2026-11-04). LIDL has 9 rows ("Aprox. 350 g", one price, no price
   per kilo). El Jamón has 5 whose weight is only in the name ("lubina 350grs aprox", "Unidad").

The catalog can store only kind 1 today. A product sold by the kilo is `KILOGRAM` with a null
`unitSize`, and `requireBaseUnit` (`catalog/src/app/catalog/item.service.ts:3729`) refuses a
size on it. So the October curation stored Mercadona pieces in one of two wrong ways:

- **As a sized GRAM pack** (138 products): the weight looks like a fixed size. For 131 of them
  the price is the price of a kilo and reads as the price of the pack. For the 7 priced as one
  the price is right and only the size is a lie.
- **As `KILOGRAM` with no size** (183 products on 2026-11-04): the price per kilo is right, but
  the weight is lost, so velista shows the price of a kilo as the price of the piece.

Facts that bound the design, all from the evidence folder:

- Mercadona states the weight in the listing and in the detail: `approx_size: true`,
  `size_format: "kg"`, `unit_size` in kilos. `reference_format` says what the chain compares
  by: `kg` on a piece sold by the kilo, `ud` on a piece priced as one. `unit_price` is the
  piece price. For 121 of 122 live pieces sold by the kilo it equals
  `round(bulk_price × unit_size, 2)`.
- The weight of one Mercadona product differs a little between warehouses and between weeks
  (plan `0108` section 5.1, and 18 of the 122 pieces moved since October).
- The harvester never changes the size or the unit of a product after it is created
  (`harvester/src/app/harvest/catalog-client.service.ts`). That is why the cheese is stale.
- `itemNameKey` (`matching.ts:493`, rung 3) and `siblingKey` (`matching.ts:201`, rung 4) key a
  product or a row by name, brand or format, and `unitSize`. A piece has no size, so two
  pieces of one cheese share a key. Production holds 10 Mercadona name pairs among the rows
  sold by weight: the six merged products, two pairs that are rightly two products, and two
  pairs with an `UNRESOLVED` twin (24700 beside 24701, 83490 beside 87292) that rung 4 would
  propose onto the other piece. `item_merge_format_differs` (`item.service.ts:2560`) compares
  `unitSize` and `defaultUnit` only, so two pieces merge with no refusal.
- `settle-price.service.ts:336` records `pricePaidCents` from the offer's `price`, and
  `snapshotOf` (line 505) keeps the size and unit of the product bought, not a weight.

The owner decided on 2026-11-03:

- **D1. The piece price is derived on read.** Prices stay the price of a kilo, as plan `0181`
  writes them. The product stores its approximate weight. A read computes
  `piecePrice = round(approxWeight / 1000 × price, 2)`. No price row changes.
- **D2. The latest read wins.** A run rewrites the approximate weight of a product bound to
  the row it read, as it rewrites a price. A weight that a person typed is protected and a run
  does not overwrite it.
- **D3. The six merged products are split** by the release task of this plan.
- **D4. The total of a kind 1 line is out of scope.** A list or basket line of a loose product
  still adds `quantity × price per kilo`. This plan records it in section 8 and changes
  nothing about it.

The review of 2026-11-04 decided these, and **the owner accepted all six on 2026-11-05**. They are
settled, as D1 to D4 are, and a builder does not reopen them:

- **R1. The weight belongs to any product with no size, not only to a `KILOGRAM` one.** What
  `price` means is still decided by `defaultUnit` alone, as today. A `KILOGRAM` product with a
  weight is a kilo piece and its piece price is derived. A `UNIT` product with a weight is a
  piece priced as one, its `price` is the piece price, and the weight is information.
- **R2. The weight is part of a product's format.** Two pieces of one name at different weights
  are two products (the owner's rule). So the weight stands where the size stands in the
  match keys and in the merge refusal. Exact equality, as for a size: the drift of a piece
  between weeks is caught by rung 1 and rung 2, which do not read the key.
- **R3. The adapter rule of plan `0181` is narrowed.** "Sold by weight" needs a comparison per
  kilo. `approx_size` with a comparison per piece is a piece priced as one.
- **R4. LIDL and DIA report the weight too**, in this plan. Both parsers already read the
  word. The change is in how the runner writes it, and it is small.
- **R5. The harvest document gains an optional weight.** The leaflet CLI does not fill it yet.
- **R6. The error code is `item_approx_weight_beside_size`.** It names the one rule: a weight
  and a size never coexist. The draft's `item_approx_weight_needs_kilogram` stated a rule
  that R1 made false.

### Target state

1. `items.approxWeight` (numeric 12,4, grams, nullable) states the approximate weight of a
   piece. It is not null only when `unitSize` is null.
2. The catalog refuses a write that breaks that rule with a new error code, and plan `0237`'s
   `item_kilogram_has_size` keeps its meaning.
3. `ItemView` carries `approxWeight`, and every offer view carries a derived `piecePrice`,
   set only for a `KILOGRAM` product with a weight.
4. The weight is part of the match keys of the harvester and of the merge refusal of catalog.
5. Mercadona, LIDL and DIA report the weight, the harvester stores it on the queue row, a
   product created from such a row is born with it, and a run writes it onto the bound product
   through one new catalog message.
6. A basket settle records the piece price of a kilo piece and keeps the weight in the
   snapshot of what was bought.
7. Release task `0006` corrects the products that production holds today and splits the six
   merged products.
8. `openapi.json` and `wire-types.ts` are regenerated.

### Scope

- Work in `apps/luna-shopper-backend/catalog/`, `apps/luna-shopper-backend/harvester/`,
  `apps/luna-shopper-backend/gateway/` (DTOs, the settle, the document),
  `libs/luna-shopper/contracts/`, `libs/luna-shopper/platform/` (the error code),
  `libs/luna-shopper/mercadona/`, `libs/luna-shopper/lidl/`, `libs/luna-shopper/dia/`,
  `k8s/release-tasks/tasks/0006-*`, and the two generated files.
- Do NOT touch: velista, the back office, any existing migration, `eljamon`, `deza`,
  `carrefour`, `osm-places`, the leaflet CLI under `libs/luna-shopper/tools/leaflet`, `core`.

### Constraints

- `bulk_price` is stored verbatim and never recomputed (CLAUDE.md). The piece price is a value
  of a read and never a column.
- Never write a price to `supermarket_items` directly (plan `0080`). This plan writes no price.
- A change that rewrites rows that a person or a harvest wrote is a release task (k8s plan
  `0011`), not a migration. The migration of this plan only adds the columns and the checks.
- The three adapter libraries stay framework free, and their tests run on fixtures in the
  repository. Refresh or add a fixture only through the `capture-fixtures` target.
- Regenerate `openapi.json` and the wire types as CLAUDE.md says. Never edit either by hand.

### Action boundaries

- Proceed with sections 3 to 6, their specs, the migrations and the regeneration.
- Stop and ask the owner for the release task's dates, `PRODUCTION_RELEASE` and row ceilings
  (section 7.5). Never pick those values.
- Stop and ask before any change to a shopper read other than the added fields of section 3.3,
  and before any change to how a price is chosen (plan `0080`) or which offer a basket picks.
- If a DIA fixture shows no row with "aprox." and a price per kilo, say so in the PR, leave
  DIA's price rule as it is, and still carry the weight (5.3).

### Progress evidence

Report each criterion of section 9 with its command and output. Walk one ephemeral slot: a
Mercadona run over fixtures writes the weight of a piece onto its product, `GET` of the product
answers `approxWeight` and an offer with `piecePrice`, an edit by a person survives the next
run, a settle of one piece records its piece price, and the release task's `check.sh` and
`post.sh` against a restored copy of the production catalog print the counts of section 7.

## 1. The rule in one paragraph

A product is a fixed pack, a product sold by the kilo, a kilo piece, or a piece priced as one.
`unitSize` is a size that is the same on every pack. `approxWeight` is the weight of one piece
when the chain says it varies, in grams, and a product has one or the other, never both. What
`price` means is decided by `defaultUnit`: a kilo for `KILOGRAM`, the pack or the piece for
every other unit. The price of one kilo piece is derived on every read and stored nowhere.

| Kind | `defaultUnit` | `unitSize` | `approxWeight` | `price` is | `piecePrice` |
| --- | --- | --- | --- | --- | --- |
| Fixed pack | a base unit | set | null | the pack | null |
| Sold by the kilo | `KILOGRAM` | null | null | a kilo | null |
| Kilo piece | `KILOGRAM` | null | set | a kilo | derived |
| Piece priced as one | `UNIT` | null | set | the piece | null |

## 2. Why not a size on `KILOGRAM`, and why the weight is not only for `KILOGRAM`

`unitSize` means "every pack holds this much" everywhere: in matching (`createdSize`, the
merge key of plan `0239`, the duplicate check of plan `0186` A6), in the comparison price, and
in the owner's rule that two sizes are two products. A weight that changes per warehouse and
per week is not that. To store it in `unitSize` would make each warehouse's weight a new
product, and it would make the base unit rule of plan `0237` section 3.3 false. A separate
column keeps every reader of `unitSize` correct and gives the weight its own write rule (D2).

The same weight varies on a fuet priced at 2.50 € the piece. Stored as 240 `GRAM` it is a
format that no run can correct, which is the defect of this plan again. Stored as `UNIT` with
a weight of 240, the price means what it says, the next run moves the weight, and the row
reads "aprox. 240 g". The column is therefore about the weight, and the unit stays about the
price.

## 3. Catalog

### 3.1 The columns

Migration `<timestamp>-ItemApproxWeight` (the next timestamp in `catalog/src/app/db/migrations`):

```sql
ALTER TABLE items ADD COLUMN "approxWeight" numeric(12,4) NULL;
ALTER TABLE items ADD COLUMN "approxWeightSetBy" varchar(16) NULL;  -- 'SOURCE' | 'ADMIN'
ALTER TABLE items ADD CONSTRAINT item_approx_weight_beside_no_size CHECK (
  "approxWeight" IS NULL OR ("unitSize" IS NULL AND "approxWeight" > 0)
);
ALTER TABLE items ADD CONSTRAINT item_approx_weight_has_a_writer CHECK (
  ("approxWeight" IS NULL) = ("approxWeightSetBy" IS NULL)
);
```

The migration writes no row. Every existing product passes both checks, because every existing
`approxWeight` is null.

`approxWeightSetBy` is the protection of D2. `SOURCE` means a run wrote it, and the next run
may change it. `ADMIN` means a person typed it, and no run changes it. A person may hand it
back to the source by sending `approxWeight: null` (the next run fills it again).

### 3.2 The write rule

`requireBaseUnit` gets a sibling, `requireWeightBesideNoSize`, called at the same places
(create, create many, update, update batch, the bulk create of the harvester):

- `approxWeight` set and `unitSize` not null: refused with `item_approx_weight_beside_size`
  (new, 400). Details: `itemId` or `index`, `approxWeight`, `unitSize`, `defaultUnit`.
  `requireBaseUnit` runs first, so a `KILOGRAM` with a size still answers
  `item_kilogram_has_size`.
- `approxWeight` set and at most zero: the same code.
- An edit that sets a `unitSize` on a product that holds a weight: refused with the same code,
  unless the same edit sends `approxWeight: null`. The rule reads the row as it will be saved,
  as `requireBaseUnit` does. A person who says the pack is fixed after all sends both.
- An edit that changes `defaultUnit` on a product that holds a weight is allowed: `KILOGRAM`
  to `UNIT` turns a kilo piece into a piece priced as one, which is a correction a person
  makes when the chain's comparison was per piece. The prices of the product do not change,
  and the back office says what the price will then mean (admin plan `0068`).

`item_kilogram_has_size` keeps its message and its details. Its gateway description
(`gateway/src/app/catalog/catalog.dto.ts:443`) gains one sentence: "A piece with an approximate
weight sends `approxWeight` instead."

### 3.3 The contract

In `libs/luna-shopper/contracts/src/lib/messages/catalog.messages.ts`:

- `ItemView` gains `approxWeight: number | null` (grams). Null for every product with a size
  and for a product sold by the kilo with no stated weight.
- The admin item view gains `approxWeightSetBy: 'SOURCE' | 'ADMIN' | null`. The shopper
  `ItemView` does not carry it.
- The create and update requests (line 2323 and line 2383 areas) gain
  `approxWeight?: number | null`. An admin write sets `approxWeightSetBy` to `ADMIN`, or to null
  with a null weight.
- `ItemOfferView` (line 1146) gains `piecePrice: number | null`. It is
  `round(approxWeight / 1000 × price, 2)`, rounded half up to the cent, when the product is
  `KILOGRAM` with a weight and the offer has a price, and null otherwise. A `UNIT` product with
  a weight answers null: its `price` is already the piece. It is computed in the catalog read
  mapper, at the one place each offer view is built (`toItemOfferView`, `rawOfferView` and the
  group member mapper in `catalog.mappers.ts` and `item.service.ts`), so the formula lives
  once. A spec names the cheese: 1560 g and 13.42 answer 20.94. `ProductGroupOfferView`
  (line 1512) carries an `ItemOfferView`, so it needs no field of its own.
- The `expect` guard of an audited operation (`item.service.ts:3623`) compares `approxWeight`
  when the operation names it, as it compares `unitSize`.
- Every read that carries an offer also carries `piecePrice` for the basket read (`offers`,
  cheapest first). The order of offers does not change: it compares `price`, which for a
  product sold by the kilo is already a price per kilo.

### 3.4 The fill message

`ITEM_PATTERNS.setApproxWeights` (`item.setApproxWeights`), in the shape of
`fillPackCounts` (`item.service.ts:1114`):

- Request: `{ userId, entries: { itemId, approxWeight }[] }`, at most the same maximum as a
  pack count fill.
- For each entry, one statement:

  ```sql
  UPDATE items SET "approxWeight" = $2, "approxWeightSetBy" = 'SOURCE'
   WHERE id = $1 AND "unitSize" IS NULL
     AND ("approxWeightSetBy" IS NULL OR "approxWeightSetBy" = 'SOURCE')
     AND "approxWeight" IS DISTINCT FROM $2
  ```

  It never writes a product that has a size, whatever its unit, and it never overwrites a
  person. That is the rule, not a detail of it. It does not change `defaultUnit`: a product
  that is `GRAM` with a size is skipped and counted, which is how a run shows a product that
  the release task did not reach.
- Each changed product writes a `catalog_audit` row (`UPDATE`, actor `SERVICE`, before and
  after `approxWeight`).
- Result: `{ written, skippedHasSize, skippedSetByAdmin }`, counted.
- A product named twice in one call refuses the whole call, as `fillPackCounts` does.

### 3.5 The weight is part of the format

- `item_merge_format_differs` (plan `0239`, `item.service.ts:2560`) also refuses when the two
  products differ in `approxWeight`: one null and one set, or two values. `allowFormatDifference`
  lets it through as it does for a size, and the survivor keeps its own weight and its own
  `approxWeightSetBy`. Both weights travel in `details`.
- The merged row keeps its weight, as it keeps its size (plan `0239`, the record of a merge).

No other catalog read changes. The search, the groups and the price history read `price`,
which is a kilo for both kinds sold by the kilo, and that is what they compare.

## 4. Gateway

- The admin product routes accept `approxWeight` on create, update and the batch update, and
  answer it with `approxWeightSetBy`.
- The shopper routes answer `approxWeight` on the product and `piecePrice` on every offer.
- The new error code reaches `api-problem-responses.decorator.ts` beside
  `ITEM_KILOGRAM_HAS_SIZE` (line 305) and `error-catalog.ts`.
- **The settle records what one piece costs.** `settle-price.service.ts` writes
  `pricePaidCents` from the offer's `piecePrice` when the product is a kilo piece, and from
  `price` otherwise, at both places that record a price (the shop lookup at line 336 and the
  cheapest offer at line 375). A kilo piece whose offer has a price and no `piecePrice` is
  recorded with no price, as a product with no offer is: the per kilo figure is never written
  as a price paid. `snapshotOf` (line 505) gains `approxWeight`, so the purchase remembers
  "about 1.56 kg" after the product moves. Core stores the snapshot as JSON and needs no
  change; confirm that against the snapshot's column before you rely on it.
- The basket picks (`basket-picks.ts`) keep comparing `price`. A 395 g piece and a 1.56 kg
  piece of one cheese compare by the kilo, which is the comparison a shopper makes.
- Regenerate `openapi.json` and `wire-types.ts`.

## 5. The adapters and the harvester

### 5.1 Mercadona

`libs/luna-shopper/mercadona/src/lib/normalize.ts`. `approx_size` has three outcomes, and the
comparison format tells them apart:

| `approx_size` | `size_format` | `reference_format` | Sold by weight | `price` | `unitSize` | `approxWeight` |
| --- | --- | --- | --- | --- | --- | --- |
| true | `kg` | `kg` | yes | `bulk_price` (a kilo) | null | `unit_size × 1000` |
| true | `kg` | `ud` | no | `unit_price` (the piece) | null | `unit_size × 1000` |
| false | any | any | no | `unit_price` | as today | null |

- `readSoldByWeight` (line 177) also requires `reference_format` to map to `kg`. Today it reads
  `approx_size` and `size_format` only, and the 7 products of the second row carry a piece
  price under the flag.
- The listing record and the detail record gain `approxWeight: number | null`: `unit_size` in
  grams, rounded to four decimals, exactly when `approx_size` is true and `size_format` is
  `kg`. Null otherwise.
- `unitSize` is null for both approximate rows (today only for the first).
- `price` and `unitPrice` do not change for the first row (both `bulk_price`, lines 89 to 91).
  For the second row `price` is `unit_price` and `unitPrice` stays `bulk_price` with the label
  `readUnitPriceLabel` gives (`ud`).
- Fixtures: `product-approximate-weight.json` (50946) proves 1540 and sold by weight. Capture
  60226 ("Ensaladilla rusa mediana", 0.58 kg, 6.50 € the piece, `reference_format: "ud"`) as
  `product-approximate-weight-per-piece.json` through `capture-fixtures`. It proves 580, not
  sold by weight, `price` 6.50. A fixed pack fixture proves a null weight.
- The runner (`mercadona-catalog.runner.ts:280` and the comment at 290) reports the weight from
  the detail, and the listing path reports it from the listing of the first warehouse in the
  order of the run's price scopes. Name that order in a comment, so a reader can predict the
  result.

### 5.2 LIDL

`libs/luna-shopper/lidl/src/lib/size.ts` already answers `approximate` for "Aprox. 350 g"
("the chain sells by weight and does not promise the number"), and the runner
(`lidl-catalog.runner.ts:255`) writes the number as a size. LIDL prints one price for the tray
and no price per kilo, so such a row is a piece priced as one:

- `approximate` true: `unitSize` null, `sizeUnit` null, `approxWeight` the parsed grams,
  `soldByWeight` false. The price does not change.
- A printed range ("Aprox. 360-460g") parses to nothing today and keeps parsing to nothing:
  no size and no weight.
- A fixture of the week's assortment with an "Aprox." row proves it. If none of the checked in
  fixtures has one, capture one through `capture-fixtures`.

Production holds 9 LIDL rows of this shape, 6 of them `ACTIVE` on sized products (release
task 7.2).

### 5.3 DIA

`libs/luna-shopper/dia/src/lib/size.ts` answers `approximate` for "800 g aprox.", and
`dia-catalog.runner.ts:687` reads only the number. DIA prints a price for the piece and a
`price_per_unit` with a `measure_unit`:

- `approximate` true and `measure_unit` `KILO`: sold by weight. `price` is the per kilo
  figure (`pricePerUnit`), `unitSize` null, `approxWeight` the parsed grams. The piece price
  DIA prints is not written (D1), as Mercadona's is not.
- `approximate` true and any other `measure_unit`: a piece priced as one, as for LIDL.
- The club price rule of plan `0174` (D2) scales `pricePerUnit` on a club row; apply the
  scaled figure.

A fixture proves each. DIA is provisioned in neither cluster on 2026-11-04 (production's
`supermarket_sources` holds deza, eljamon, lidl and mercadona), so no release task row exists
for it. The change is the adapter, the runner and their specs.

### 5.4 El Jamón and DEZA stay as they are

- El Jamón prints the weight only inside the name ("dorada unidad 350grs aprox", "acelgas
  manojo 1,5kg aprox", 5 rows) with the label `Unidad`. Those products are `UNIT` with no size
  and a piece price, which is kind 4 with no weight stated. Correct, and not touched.
- DEZA's site prints "750 g aprox." in 42 names and no price (plan `0085`). Whether such a
  product is sold by the kilo or priced as one cannot be told without a price, so nothing is
  written for it. The leaflet is DEZA's price source, and 5.5 gives the leaflet a field.

### 5.5 The observation, the queue row and the document

- The observation contract (`harvest.messages.ts`, near `soldByWeight` at line 968) gains
  `approxWeight?: number | null`, in grams. It is independent of `soldByWeight`: a kind 4 row
  has a weight and is not sold by weight. Partial observations carry it too, because the
  listing has it, like `soldByWeight` (plan `0181`).
- `source_catalog_entries` gains `approxWeight numeric(12,4) NULL` (harvester migration). It is
  null whenever `unitSize` is not null. `fieldsOf` (`source-ingest.ts:1616`) and `see`
  (`source-ingest.ts:1050`) write it beside `soldByWeight`. A partial observation that carries
  no weight leaves the stored one alone, and one that carries null clears it.
- The entry view gains `approxWeight`, so the queue shows it.
- The harvest document (`harvest-document.reader.ts`, `file-import.runner.ts`) accepts an
  optional `approx_weight` in grams on a product, and passes it to the observation. The reader
  refuses it beside a size. The leaflet CLI does not write it yet: a tile that prints "pieza
  1,5 kg aprox" needs a reading rule of its own (section 8). The field exists so that rule has
  somewhere to land.

### 5.6 A product created from a row

`createdSize` (`source-entry-size.ts:54`) answers, when the operation names neither a size nor
a unit:

- A row sold by weight: `KILOGRAM` with no size (plan `0181`), and the row's weight.
- A row not sold by weight, with no size and a weight: `UNIT` with no size, and the row's
  weight. Today such a row with `sizeFormat` `kg` falls through `toBaseUnit(null, KILOGRAM)`
  into a product sold by the kilo, which is wrong for the 7 Mercadona products.
- Any other row: as today, and no weight.

The create request sends the weight with `approxWeightSetBy: 'SOURCE'`. An operation that names
a size or a unit (a person saying the pack is fixed after all) sends no weight. Both creation
paths (`source-entry.service.ts:625`, `source-entry-batch.service.ts:861`) go through this
function, so they cannot disagree.

### 5.7 The write onto the product after a run

After the price writes of a run, the run report sink (`run-report.sink.ts`, beside
`fillPackCounts` at line 517) collects, for each `ACTIVE` row of this run with a weight, the
pair `{ itemId, approxWeight }`, and sends `setApproxWeights` in chunks.

- **Rows that disagree write nothing.** When two or more `ACTIVE` rows of one chain with
  different weights are bound to one product, that product is left out, and the run warns
  `APPROX_WEIGHT_ROWS_DISAGREE` (new `HarvestWarningCode`) with the product and the rows. This
  is the case of the six merged products before the release task splits them.
- The run report gains `approxWeightsWritten`, `approxWeightsSkippedSetByAdmin` and
  `approxWeightsSkippedHasSize`. A product that is still a sized pack is counted in the last.
- The weight of the latest run wins (D2).
- The refresh of plan `0216` writes prices only and does not write a weight. Its constraint
  "a refresh creates nothing and writes a price only through the two named methods" stands.

### 5.8 The weight is part of the match keys

`matching.ts`:

- `itemNameKey` (rung 3, line 493) and `siblingKey` (rung 4, line 201) take the weight as the
  size token when the size is null: `name|brand|1560` for the cheese piece, `name|brand|` for
  loose cheese. `MatchCandidate` gains `approxWeight`, read from the observation. `ItemView`
  already carries it after 3.3.
- Two rows of one name at different weights thus never share a key, and a row with a weight
  never proposes a product with none. The two `UNRESOLVED` twins named in the context are the
  spec: 24700 at its weight does not propose 24701's product.
- `entryNameKey` does not change. Hashed, it is the row identity of a source with no id of its
  own (plan `0086` D2), and a weight that moves between weeks must not move a row's identity.

### 5.9 Plan 0181 rule 7

Rule 7 (the lowest price per kilo among several rows of one product,
`source-entry-write.ts:209`) stays. After the split of section 7.4 it no longer applies to any
Mercadona piece in production. Its comment gains one sentence: two pieces of different weight
are two products (owner, 2026-11-03), so two rows on one piece product are a curation error
that the run warns about (5.7).

## 6. What plan 0181 says now

Plan `0181`'s rule "the estimated piece price is not written at all" stays true for a piece
sold by the kilo: the piece price is never written. What changes is that the weight it came
from is kept, so the piece price can be derived. The comment of `pricesOf`
(`mercadona-catalog.runner.ts:434` to `438`) gains: "The weight is kept on the product as
`approxWeight` (plan 0244), and every read derives the piece price from it." The comment of the
detail's `unitSize` (line 280) says the same.

Plan `0181`'s Mercadona rule 2 was too wide. "`approx_size` on a product sized in `kg`" also
matched 7 products whose comparison is per piece, and for those `bulk_price` is the piece. The
rule now reads the comparison format too (5.1). The price written for those 7 was the right
number under the wrong flag, so no price row changes for them either.

## 7. Release task 0006: the products already written

`k8s/release-tasks/tasks/0006-kilo-pieces-state-their-weight/`, with `task.env`, `check.sh`
and `post.sh`, in the shape of task `0005`. It runs after the rollout of the release that adds
the columns (so `post.sh`), as a node script in the harvester pod, because every group below is
decided by a queue row and the harvester already speaks to catalog over NATS. Each group is one
transaction per product in catalog, and the task is safe to run again: a product it already
converted no longer matches its selection.

The selection reads the harvester database for each `ACTIVE` row and asks catalog for the
bound product. Every write below is an admin update through the ordinary item update message,
with the task's actor, so it is audited as any edit and refused by the same rules. No raw SQL
into catalog.

### 7.1 Sized Mercadona pieces sold by the kilo become kilo pieces

Every product that has an `ACTIVE` Mercadona queue row with `soldByWeight` true whose latest
`source_entry_prices` row carries the label `kg`, and whose `defaultUnit` is `GRAM` with a
`unitSize`:

- `defaultUnit` becomes `KILOGRAM`, `unitSize` becomes null, `approxWeight` becomes the old
  `unitSize`, `approxWeightSetBy` becomes `SOURCE`.
- No price row changes: each already holds the price per kilo.

On 2026-11-04 this is 131 products in production (the 130 and 58488 of 1000 g). The next
Mercadona run then rewrites the weight of each piece from the live value (5.7). That run
corrects the 18 whose weight moved.

### 7.2 Sized pieces priced as one keep their price and lose their size

- **Mercadona**: every product with an `ACTIVE` row with `soldByWeight` true whose latest
  price label is `ud`, `GRAM` with a size. 7 on 2026-11-04 (54105, 60226, 60212, 55108,
  55125, 55028, 86445). `defaultUnit` becomes `UNIT`, `unitSize` null, `approxWeight` the old
  size, `SOURCE`. No price changes: the stored price is the piece price. The row's
  `soldByWeight` becomes false in the harvester, so that the next run agrees with the product
  before the adapter of 5.1 has read the row again.
- **LIDL**: every product whose only `ACTIVE` row prints an approximate size (`sizeFormat`
  matching the parser's `APPROXIMATE` prefix) and that is `GRAM` with a size. 6 on
  2026-11-04. The same change. The row's `unitSize` becomes null and its `approxWeight` the
  number.

### 7.3 Pieces with no weight

The 183 Mercadona products that are already `KILOGRAM` with no size need no task. The next
Mercadona run fills their weight (5.7). The task's `post.sh` prints how many `KILOGRAM`
products with an `ACTIVE` Mercadona row sold by weight still have no weight, so the operator can
see the run do it.

### 7.4 The six merged products are split

For each product that has two or more `ACTIVE` Mercadona rows sold by weight (six on
2026-11-04, listed in the evidence folder, section 2.1):

- The product keeps the row whose price it shows now: the row with the lowest price per kilo
  in the latest run (rule 7). On a tie, the lower external id.
- Each other row gets a new product: the same name, brand, categories, pack count and images
  as the product it leaves, `KILOGRAM` with no size, and the row's EAN when it has one and no
  product holds it. The new product has no price until the next run writes one. The row's
  `itemId` moves to the new product.
- Lists and baskets that hold the old product keep it. Nothing in core changes.
- **The create and the rebind are two writes in two databases, and the task is safe between
  them.** The task creates the new product with the row's external id in the audit row's
  `after` (`createdFromEntry`), and before it creates, it asks catalog for a product created
  by this task for that row. One exists only if an earlier run failed before the rebind, and
  then the row is bound to it instead. So a re-run creates nothing twice, and `post.sh` prints
  the products it bound this way.

The weights come from the run that follows, not from the task: when the task runs, no queue
row holds a weight yet. The kept product and the new one are created with a null weight, and
`post.sh` names them among the products that wait for the run (7.3). Only the split itself is
the task's job.

### 7.5 The window and the guards

`check.sh` refuses to run when the counts are far from the ones it was written for: more than
200 sized pieces sold by the kilo (7.1), more than 20 sized pieces priced as one (7.2), or more
than 10 merged products (7.4). It changes nothing.

`RUN_UNTIL_STAGING`, `RUN_UNTIL_PRODUCTION` and `PRODUCTION_RELEASE`: ask the owner. A window is
at most 14 days after the commit that writes it (k8s plan `0011`).

Staging held the same counts as production on 2026-11-04 (130 sized pieces, 842 `KILOGRAM`
products, 9 `UNIT` products with a kilo label), because it is the production copy of
2026-11-03. It runs the same task on the same data first.

## 8. Known and not changed

- **A kind 1 line totals `quantity × price per kilo`** in velista (`basket-total.ts:142`,
  `line-products.ts:356`). A quantity of 3 loose apples reads as 3 kg. The owner set this
  aside on 2026-11-03 (D4).
- **The two Bosque Verde dehumidifier products** (72514, 72515) carry the label `kg` on a price
  per unit. A label defect, not this one.
- **The 21 DEZA leaflet products sold by the kilo still have a null price** in production.
  Plan `0181` expected a second import of the leaflet document to fix them.
- **El Jamón's queue rows all say `soldByWeight: false`**, because its last run is older than
  plan `0181`. Its products are correct (kind 1). The next El Jamón run sets the flag.
- **A weight printed inside a name is not read.** El Jamón's "350grs aprox" and DEZA's "750 g
  aprox." stay in the name. A reading rule for them is its own plan, and 5.5 gives it a field.
- **The leaflet CLI writes no weight.** A DEZA or El Jamón tile that prints "pieza 1,5 kg
  aprox" stays kind 1 until the CLI's reading rule fills `approx_weight`.
- **58154 "Paleta de cebo ibérica 50%"** prints a piece price of 75.00 € where its weight and
  price per kilo give 93.75 €. The derived piece price will show 93.75 €. If the owner wants
  the chain's own piece price on such products, that is a change to D1.
- **Mercadona's `unit_price` of a kilo piece is not stored anywhere.** D1 derives it. If a
  later audit wants to compare the derivation against the chain, the run would have to keep
  the figure in the row's `extra`, which this plan does not do.
- **The catalog audit of 2026-10-27** held 13 `KILOGRAM` size fixes and the owner's rule that a
  piece may show its weight (`item_kilogram_has_size`). After this plan, those fixes are
  `approxWeight` edits.
- **The register of the October decisions** (`docs/first-catalog-decisions-2026-10/README.md`,
  rule R3) is a dated record and is not edited. This plan is the refinement of R3.

## 9. Acceptance criteria

1. Mercadona specs on `normalize.ts`: `product-approximate-weight.json` answers `approxWeight`
   1540, `soldByWeight` true, `unitSize` null, `price` 9.41, `unitPrice` 9.41.
   `product-approximate-weight-per-piece.json` answers `approxWeight` 580, `soldByWeight` false,
   `unitSize` null, `price` 6.50. A fixed pack fixture answers a null weight.
2. LIDL and DIA specs: an "Aprox." row answers a weight and no size; a printed range answers
   neither; a DIA row with `KILO` is sold by weight with the per kilo price.
3. Catalog specs: a create of `KILOGRAM` with `approxWeight` 1560 saves. A create of `UNIT`
   with `approxWeight` 580 and no size saves. A create of GRAM 1560 with `approxWeight` answers
   `item_approx_weight_beside_size`. `KILOGRAM` with a size still answers
   `item_kilogram_has_size`. An edit that sets a size on a piece without `approxWeight: null`
   is refused. An edit of `defaultUnit` from `KILOGRAM` to `UNIT` on a piece saves.
4. A catalog spec on the offer mapper: `KILOGRAM`, weight 1560 and price 13.42 answer
   `piecePrice` 20.94. `UNIT` with a weight answers null. No weight answers null. A null price
   answers null.
5. `setApproxWeights` specs: it writes a `SOURCE` or empty weight on a product with no size of
   either unit, skips an `ADMIN` weight, skips a sized product, writes one audit row per
   change, refuses a product named twice.
6. A merge spec: two kilo pieces of different weights answer `item_merge_format_differs`, and
   `allowFormatDifference` merges them with the survivor's weight kept.
7. Harvester specs: two rows with different weights on one product write nothing and warn
   `APPROX_WEIGHT_ROWS_DISAGREE`. One row writes its weight. A partial observation carries it.
   `createdSize` answers `KILOGRAM` plus the weight for a row sold by weight, `UNIT` plus the
   weight for a row with a weight not sold by weight. Rung 3 and rung 4 do not propose a
   product or a sibling of another weight.
8. A gateway spec: a settle of a kilo piece records its `piecePrice`, a settle of a pack its
   `price`, and the snapshot carries the weight.
9. The migrations run up and down on an ephemeral slot, and the check refuses a sized product
   with a weight in raw SQL.
10. `npx nx run luna-shopper-backend-gateway:openapi` and
    `npx nx run luna-shopper-admin/models:wire-types` leave no diff after the commit.
11. Release task `0006` on a restore of the production catalog and harvester of the day
    reports 131 pieces converted (7.1), 7 plus 6 pieces priced as one (7.2) and 6 products
    split (7.4), or the counts of that day, and a second run changes nothing.
12. `npx nx affected -t lint test` is green, and `npx nx build luna-shopper-admin` builds.
