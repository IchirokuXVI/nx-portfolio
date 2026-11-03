# 0244: a piece sold by the kilo states its approximate weight

> Found on 2026-11-03 in production: Mercadona's 1.56 kg piece of "Queso viejo tostado mezcla"
> (product `eb09e84e`) is stored as 1560 g for 13.42 €, the price of a kilo. The evidence, the
> cause and the classified list are in `apps/luna-shopper-backend/docs/kilo-pieces-2026-11/`.
>
> Prerequisite reading: that folder; plan `0181` (a product sold by weight is priced by the
> kilo); plan `0183` (base units); plan `0237` section 3.3 (`item_kilogram_has_size`); plan
> `0162` (`fillPackCounts`, the pattern of a fill from a run); plan `0080` (prices side by
> side, decided on read); k8s plan `0011` and `k8s/release-tasks/README.md`.
>
> Followed by velista plan `0179` and back office plan `0068`, which read the contract this
> plan adds.

## Brief for the agent

### Objective

Give the catalog a second kind of product sold by the kilo: a piece with an approximate
weight. Store that weight, derive the piece price from it on every read, keep it current from
Mercadona's runs, and correct the products that production holds today.

### Context

The owner's model (2026-11-03) has two kinds of product sold by the kilo:

1. **Sold by the kilo with no set weight** (loose fruit, the deli counter): no size, a price
   per kilo. This is what plan `0181` built, and it stays as it is.
2. **Sold by the kilo with a set approximate weight** (a tray, a cheese piece): it shows
   "about 1.56 kg". Its piece price comes from that weight and its price per kilo. Two pieces
   of one product at different weights are two products, because the price per kilo differs.

The catalog can store only kind 1 today. A product sold by the kilo is `KILOGRAM` with a null
`unitSize`, and `requireBaseUnit` (`catalog/src/app/catalog/item.service.ts:3729`) refuses a
size on it. So the October curation stored Mercadona pieces in one of two wrong ways:

- **As a sized GRAM pack** (130 products, plus one of 1000 g): the weight looks like a fixed
  size, and the price per kilo looks like the price of the pack.
- **As `KILOGRAM` with no size** (185 products): the price per kilo is right, but the weight is
  lost, so velista shows the price of a kilo as the price of the piece.

Facts that bound the design, all from the evidence folder:

- Mercadona states the weight in the listing and in the detail: `approx_size: true`,
  `size_format: "kg"`, `unit_size` in kilos. `unit_price` is the piece price, and for 121 of
  122 live pieces it equals `round(bulk_price × unit_size, 2)`.
- The weight of one Mercadona product differs a little between warehouses and between weeks
  (plan `0108` section 5.1, and 18 of the 122 pieces moved since October).
- No other chain prints a piece weight. El Jamón, DEZA, LIDL and the leaflet stay kind 1.
- The harvester never changes the size or the unit of a product after it is created
  (`harvester/src/app/harvest/catalog-client.service.ts`). That is why the cheese is stale.

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

### Target state

1. `items.approxWeight` (numeric 12,4, grams, nullable) states the approximate weight of a
   piece. It is not null only when `defaultUnit` is `KILOGRAM` and `unitSize` is null.
2. The catalog refuses a write that breaks that rule with a new error code, and plan `0237`'s
   `item_kilogram_has_size` keeps its meaning.
3. `ItemView` carries `approxWeight`, and every offer view carries a derived `piecePrice`.
4. Mercadona's adapter reports the weight, the harvester stores it on the queue row, and a run
   writes it onto the bound product through one new catalog message.
5. Release task `0006` corrects the products that production holds today and splits the six
   merged products.
6. `openapi.json` and `wire-types.ts` are regenerated.

### Scope

- Work in `apps/luna-shopper-backend/catalog/`, `apps/luna-shopper-backend/harvester/`,
  `apps/luna-shopper-backend/gateway/` (DTOs and the document), `libs/luna-shopper/contracts/`,
  `libs/luna-shopper/platform/` (the error code), `libs/luna-shopper/mercadona/`,
  `k8s/release-tasks/tasks/0006-*`, and the two generated files.
- Do NOT touch: velista, the back office, any existing migration, the other adapters
  (`eljamon`, `deza`, `lidl`, `carrefour`, `osm-places`), the leaflet tools, `core`.

### Constraints

- `bulk_price` is stored verbatim and never recomputed (CLAUDE.md). The piece price is a value
  of a read and never a column.
- Never write a price to `supermarket_items` directly (plan `0080`). This plan writes no price.
- A change that rewrites rows that a person or a harvest wrote is a release task (k8s plan
  `0011`), not a migration. The migration of this plan only adds the column and the check.
- `@portfolio/luna-shopper/mercadona` stays framework free, and its tests run on fixtures in
  the repository. Refresh a fixture only through the `capture-fixtures` target.
- Regenerate `openapi.json` and the wire types as CLAUDE.md says. Never edit either by hand.

### Action boundaries

- Proceed with sections 3 to 6, their specs, the migration and the regeneration.
- Stop and ask the owner for the release task's dates, `PRODUCTION_RELEASE` and row ceilings
  (section 7.4). Never pick those values.
- Stop and ask before any change to a shopper read other than the added fields of section 4,
  and before any change to how a price is chosen (plan `0080`).

### Progress evidence

Report each criterion of section 9 with its command and output. Walk one ephemeral slot: a
Mercadona run over fixtures writes the weight of a piece onto its product, `GET` of the product
answers `approxWeight` and an offer with `piecePrice`, an edit by a person survives the next
run, and the release task's `check.sh` and `post.sh` against a restored copy of the production
catalog print the counts of section 7.

## 1. The rule in one paragraph

A product is a fixed pack, a product sold by the kilo, or a piece sold by the kilo. A fixed
pack has a `unitSize` in a base unit. A product sold by the kilo is `KILOGRAM` with no
`unitSize`. A piece sold by the kilo is a product sold by the kilo that also states
`approxWeight`, in grams. Every price of a product sold by the kilo, a piece or not, is the
price of a kilo. The price of one piece is derived on every read and stored nowhere.

## 2. Why not a size on `KILOGRAM`

`unitSize` means "every pack holds this much" everywhere: in matching (`createdSize`, the
merge key of plan `0239`, the duplicate check of plan `0186` A6), in the comparison price, and
in the owner's rule that two sizes are two products. A weight that changes per warehouse and
per week is not that. To store it in `unitSize` would make each warehouse's weight a new
product, and it would make the base unit rule of plan `0237` section 3.3 false. A separate
column keeps every reader of `unitSize` correct and gives the weight its own write rule (D2).

## 3. Catalog

### 3.1 The column

Migration `<timestamp>-ItemApproxWeight` (the next timestamp in `catalog/src/app/db/migrations`):

```sql
ALTER TABLE items ADD COLUMN "approxWeight" numeric(12,4) NULL;
ALTER TABLE items ADD COLUMN "approxWeightSetBy" varchar(16) NULL;  -- 'SOURCE' | 'ADMIN'
ALTER TABLE items ADD CONSTRAINT item_approx_weight_is_a_kilo_piece CHECK (
  "approxWeight" IS NULL OR ("defaultUnit" = 'KILOGRAM' AND "unitSize" IS NULL AND "approxWeight" > 0)
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

`requireBaseUnit` gets a sibling, `requireApproxWeightOnAKiloPiece`, called at the same places
(create, create many, update, update batch, the bulk create of the harvester):

- `approxWeight` set and `defaultUnit` not `KILOGRAM`: refused with
  `item_approx_weight_needs_kilogram` (new, 400). Details: `itemId` or `index`, `approxWeight`,
  `defaultUnit`.
- `approxWeight` set and `unitSize` not null: refused with the same code. `requireBaseUnit`
  runs first, so a `KILOGRAM` with a size still answers `item_kilogram_has_size`.
- An edit that changes `defaultUnit` away from `KILOGRAM`, or sets a `unitSize`, on a product
  that holds a weight: refused with the same code, unless the same edit sends
  `approxWeight: null`. The rule reads the row as it will be saved, as `requireBaseUnit` does.

`item_kilogram_has_size` keeps its message and its details. Its gateway description
(`gateway/src/app/catalog/catalog.dto.ts:443`) gains one sentence: "A piece with an approximate
weight sends `approxWeight` instead."

### 3.3 The contract

In `libs/luna-shopper/contracts/src/lib/messages/catalog.messages.ts`:

- `ItemView` gains `approxWeight: number | null` (grams). Null for every product that is not a
  piece sold by the kilo.
- The admin item view gains `approxWeightSetBy: 'SOURCE' | 'ADMIN' | null`. The shopper
  `ItemView` does not carry it.
- The create and update requests (line 2323 and line 2383 areas) gain
  `approxWeight?: number | null`. An admin write sets `approxWeightSetBy` to `ADMIN`, or to null
  with a null weight.
- `ItemOfferView` (line 1146) and `ProductGroupOfferView` (line 1512) gain
  `piecePrice: number | null`. It is `round(approxWeight / 1000 × price, 2)` when the product has
  a weight and the offer has a price, and null otherwise. It is computed in the catalog read
  mapper, at the one place each offer view is built, so the formula lives once. A spec names
  the cheese: 1560 g and 13.42 answer 20.94.
- Every read that carries an offer also carries it for the basket read (`offers`, cheapest
  first). The order of offers does not change: it compares `price`, which for a product sold
  by the kilo is already a price per kilo.

### 3.4 The fill message

`ITEM_PATTERNS.setApproxWeights` (`item.setApproxWeights`), in the shape of
`fillPackCounts` (`item.service.ts:1114`):

- Request: `{ userId, entries: { itemId, approxWeight }[] }`, at most the same maximum as a
  pack count fill.
- For each entry, one statement:

  ```sql
  UPDATE items SET "approxWeight" = $2, "approxWeightSetBy" = 'SOURCE'
   WHERE id = $1 AND "defaultUnit" = 'KILOGRAM' AND "unitSize" IS NULL
     AND ("approxWeightSetBy" IS NULL OR "approxWeightSetBy" = 'SOURCE')
     AND "approxWeight" IS DISTINCT FROM $2
  ```

  It never writes a product that is not `KILOGRAM` with no size, and it never overwrites a
  person. That is the rule, not a detail of it.
- Each changed product writes a `catalog_audit` row (`UPDATE`, actor `SERVICE`, before and
  after `approxWeight`).
- Result: `{ written, skippedNotAKiloProduct, skippedSetByAdmin }`, counted.
- A product named twice in one call refuses the whole call, as `fillPackCounts` does.

## 4. Gateway

- The admin product routes accept `approxWeight` on create, update and the batch update, and
  answer it with `approxWeightSetBy`.
- The shopper routes answer `approxWeight` on the product and `piecePrice` on every offer.
- The new error code reaches `api-problem-responses.decorator.ts` beside
  `ITEM_KILOGRAM_HAS_SIZE` (line 305) and `error-catalog.ts`.
- Regenerate `openapi.json` and `wire-types.ts`.

## 5. Mercadona adapter and the harvester

### 5.1 The adapter

`libs/luna-shopper/mercadona/src/lib/normalize.ts`:

- The listing record and the detail record gain `approxWeight: number | null`. It is
  `unit_size × 1000`, in grams, rounded to four decimals, exactly when `readSoldByWeight` is
  true (line 177). It is null otherwise, and `unitSize` stays null for such a product (lines 85
  and 136). `price` and `unitPrice` do not change: both are `bulk_price` (lines 89 to 91).
- `product-approximate-weight.json` (50946) proves 1540. A fixed pack fixture proves null.

### 5.2 The observation and the queue row

- The observation contract (`harvest.messages.ts`, near `soldByWeight` at line 968) gains
  `approxWeight?: number | null`. Partial observations carry it too, because the listing has
  it, like `soldByWeight` (plan `0181`).
- `source_catalog_entries` gains `approxWeight numeric(12,4) NULL` (harvester migration). It is
  not null only when `soldByWeight` is true. `fieldsOf` (`source-ingest.ts:1616`) and `see`
  (`source-ingest.ts:1050`) write it beside `soldByWeight`.
- The entry view gains `approxWeight`.

### 5.3 The write onto the product

After the price writes of a run, the run report sink (`run-report.sink.ts`, beside
`fillPackCounts` at line 517) collects, for each ACTIVE row of this run with a weight, the pair
`{ itemId, approxWeight }`, and sends `setApproxWeights` in chunks.

- **Rows that disagree write nothing.** When two or more ACTIVE rows of one chain with
  different weights are bound to one product, that product is left out, and the run warns
  `APPROX_WEIGHT_ROWS_DISAGREE` (new `HarvestWarningCode`) with the product and both rows. This
  is the case of the six merged products before the release task splits them.
- The run report gains `approxWeightsWritten`, `approxWeightsSkippedSetByAdmin` and
  `approxWeightsSkippedNotAKiloProduct`. A product that is still GRAM is counted in the last,
  which is how a run shows a product that the release task did not reach.
- The weight of the latest run wins (D2). A run that walks several warehouses takes the weight
  of the detail it fetched, or for a known product the listing of the first warehouse in the
  order of its price scopes. Name that order in a comment, so a reader can predict the result.

### 5.4 A product created from a row sold by weight

`createdSize` (`source-entry-size.ts:54`) answers `KILOGRAM` with no size for such a row (plan
`0181`). The create request also sends the row's `approxWeight`, so a new piece is born with
its weight (`approxWeightSetBy: 'SOURCE'`). An operation that names a size or a unit (a person
saying the pack is fixed after all) sends no weight.

### 5.5 Plan 0181 rule 7

Rule 7 (the lowest price per kilo among several rows of one product) stays. After the split of
section 7.3 it no longer applies to any Mercadona piece in production. Its comment in
`source-entry-write.ts` gains one sentence: two pieces of different weight are two products
(owner, 2026-11-03), so two rows on one piece product are a curation error that the run warns
about (5.3).

## 6. What plan 0181 says now

Plan `0181`'s rule "the estimated piece price is not written at all" stays true: the piece
price is never written. What changes is that the weight it came from is kept, so the piece
price can be derived. The comment of `pricesOf` (`mercadona-catalog.runner.ts:434` to `438`)
gains: "The weight is kept on the product as `approxWeight` (plan 0244), and every read derives
the piece price from it." The comment of the detail's `unitSize` (line 280) says the same.

## 7. Release task 0006: the products already written

`k8s/release-tasks/tasks/0006-kilo-pieces-state-their-weight/`, with `task.env`, `check.sh`
and `post.sh`, in the shape of task `0005`. It runs after the rollout of the release that adds
the column (so `post.sh`), in the catalog pod and then the harvester pod, with node scripts in
the shape of `reconcile-deletions.js`.

### 7.1 Sized pieces become pieces

Every product that has an ACTIVE Mercadona queue row with `soldByWeight` true, and whose
`defaultUnit` is GRAM with a `unitSize`:

- `defaultUnit` becomes `KILOGRAM`, `unitSize` becomes null, `approxWeight` becomes the old
  `unitSize`, `approxWeightSetBy` becomes `SOURCE`.
- No price row changes: each already holds the price per kilo.
- Each change writes a `catalog_audit` row with actor kind `SERVICE` and the task id in the
  row.

On 2026-11-03 this is 131 products in production (the 130 and 58488 of 1000 g). The next
Mercadona run then rewrites the weight of each piece from the live value (5.3). That run
corrects the 18 whose weight moved.

### 7.2 Pieces with no weight

The 185 Mercadona products that are already `KILOGRAM` with no size need no task. The next
Mercadona run fills their weight (5.3). The task's `post.sh` prints how many `KILOGRAM`
products with an ACTIVE Mercadona row sold by weight still have no weight, so the operator can
see the run do it.

### 7.3 The six merged products are split

For each product that has two or more ACTIVE Mercadona rows sold by weight (six on
2026-11-03, listed in the evidence folder, section 2.1):

- The product keeps the row whose price it shows now: the row with the lowest price per kilo
  in the latest run (rule 7). On a tie, the lower external id.
- Each other row gets a new product: the same name, brand, categories, pack count and images,
  `KILOGRAM` with no size, the row's own weight, and the row's EAN when it has one and no
  product holds it. The row's `itemId` moves to the new product in the harvester database. The
  new product has no price until the next run writes one.
- Lists and baskets that hold the old product keep it. Nothing in core changes.

The split runs in the catalog first (create the products, record the pairs in the task's
output), then in the harvester (move the rows). A failure between the two leaves new products
with no row, which the re-run of the task finds and binds. Write that recovery into `post.sh`
and test it.

### 7.4 The window and the guards

`check.sh` refuses to run when the counts are far from the ones it was written for: more than
200 sized pieces (7.1) or more than 10 merged products (7.3). It changes nothing.

`RUN_UNTIL_STAGING`, `RUN_UNTIL_PRODUCTION` and `PRODUCTION_RELEASE`: ask the owner. A window is
at most 14 days after the commit that writes it (k8s plan `0011`).

Staging holds a production copy of 2026-11-03, so it runs the same task on the same data first.

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
- **The leaflet document has no field for a piece weight.** A DEZA or El Jamón tile that prints
  "pieza 1,5 kg aprox" stays kind 1 until a plan adds one.
- **58154 "Paleta de cebo ibérica 50%"** prints a piece price of 75.00 € where its weight and
  price per kilo give 93.75 €. The derived piece price will show 93.75 €. If the owner wants
  the chain's own piece price on such products, that is a change to D1.
- **The catalog audit of 2026-10-27** held 13 `KILOGRAM` size fixes and the owner's rule that a
  piece may show its weight (`item_kilogram_has_size`). After this plan, those fixes are
  `approxWeight` edits.

## 9. Acceptance criteria

1. A spec on `normalize.ts` with `product-approximate-weight.json` answers `approxWeight` 1540,
   `unitSize` null, `price` 9.41, `unitPrice` 9.41. A fixed pack fixture answers a null weight.
2. Catalog specs: a create of `KILOGRAM` with `approxWeight` 1560 saves. A create of GRAM 1560
   with `approxWeight` answers `item_approx_weight_needs_kilogram`. `KILOGRAM` with a size
   still answers `item_kilogram_has_size`. An edit of `defaultUnit` to GRAM on a piece without
   `approxWeight: null` is refused.
3. A catalog spec on the offer mapper: weight 1560 and price 13.42 answer `piecePrice` 20.94.
   No weight answers null. A null price answers null.
4. `setApproxWeights` specs: it writes a `SOURCE` or empty weight, skips an `ADMIN` weight,
   skips a GRAM product, writes one audit row per change, refuses a product named twice.
5. A harvester spec: two rows with different weights on one product write nothing and warn
   `APPROX_WEIGHT_ROWS_DISAGREE`. One row writes its weight. A partial observation carries it.
6. The migrations run up and down on an ephemeral slot, and the check refuses a GRAM product
   with a weight in raw SQL.
7. `npx nx run luna-shopper-backend-gateway:openapi` and
   `npx nx run luna-shopper-admin/models:wire-types` leave no diff after the commit.
8. Release task `0006` on a restore of the production catalog and harvester of the day
   reports 131 sized pieces converted and 6 products split (or the counts of that day), and a
   second run changes nothing.
9. `npx nx affected -t lint test` is green, and `npx nx build luna-shopper-admin` builds.
