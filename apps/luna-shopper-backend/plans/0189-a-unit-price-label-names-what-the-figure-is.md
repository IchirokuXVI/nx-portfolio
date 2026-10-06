> **PR:** [#651](https://github.com/IchirokuXVI/nx-portfolio/pull/651)

# 0189: a unit price label names what the figure is

> Found by the repair of the first catalog on local slot 1 (plan `0186`, stage A, step A5,
> 2026-10-06). The evidence is in `.curation-runs/2026-10-audit-repair/` of the main
> checkout: `proposals/A5-sizes-against-unit-prices.md` and `a5.read.json`.
>
> Prerequisite reading: plan `0038` section 2.4 (the price fields of Mercadona), plan `0157`
> (the unit basis, read from the label), plan `0080` (insert on change), plan `0181`,
> `libs/luna-shopper/mercadona/src/lib/normalize.ts` (`toListProduct`, `normalizeProduct`,
> `comparedOver`), the fixtures README beside it,
> `catalog/src/app/catalog/unit-basis.ts` (`unitBasisOf`),
> `catalog/src/app/catalog/item-price-writer.ts` (`sameValues`) and
> `libs/luna-shopper/eljamon/src/lib/price.ts` (`parseUnitPrice`).

A unit price is two columns: a figure and a label. On 1,497 Mercadona price rows the label
says "100 ml" or "100 g" and the figure is the price of a litre or of a kilo. A body oil of
200 ml at 3.40 € is stored as 17 with the label "100 ml". Each column is what the chain
sent. The pair is false.

## Brief for the agent

### Objective

Make the Mercadona adapter write a label that is true of the figure it stores, without
changing the figure, and make the back office stop printing a pair that the catalog already
knows how to read.

### Context

What the code does today. Every statement below was read in the file it names.

- **The adapter pairs two fields that the chain does not pair.** `toListProduct` and
  `normalizeProduct` in `normalize.ts` both set `unitPrice` from `bulk_price` and
  `unitPriceLabel` from `reference_format`. Plan `0038` section 2.4 knew this: it calls
  `reference_format` "a display label, not a machine unit", and `normalize.spec.ts` has a
  test named "keeps reference_format as the source wrote it, label and number disagreeing".
  So this is a decision that the repair has now shown to be wrong, not an accident.
- **The payload holds a third field, `reference_price`.** `comparedOver` in `normalize.ts`
  reads it as evidence for a size. In every captured fixture it equals `bulk_price` with
  one more decimal, and in every captured fixture `reference_format` is `kg`, `L` or `ud`.
  **Not confirmed:** what `reference_price` holds when `reference_format` is `100 ml`,
  `100 g`, `dz`, `dc` or `lv`. The only fixture of that kind,
  `product-reference-format-100ml.json`, is one of five files that the README says are
  "kept by hand", and it was written from the counts of plan `0038` and not captured. The
  likely answer is that `reference_format` labels `reference_price` (4.50 € a litre shown
  as 0.450 € per 100 ml), and that `bulk_price` is always per kilo, litre or piece. Target
  state 1 settles it.
- **The eggs are the same pairing.** 9 Mercadona egg products carry the label `dz` or `dc`
  beside the price of one egg (12 eggs at 3.35 € stored as 0.28 per `dc`). Plan `0038`
  lists both labels and says they "sit on per egg numbers".
- **The shopper is already protected for litres and kilos, and not for eggs.**
  `unitBasisOf` in `unit-basis.ts` maps `100 ml` to `LITER` and `100 g` to `KILOGRAM`, and
  its comment says why. velista draws the unit from `unitBasis` and never from the label
  (`libs/velista/ui/src/lib/catalog/product-row-view.ts`,
  `libs/velista/ui/src/lib/list/suggestion-card-view.ts`). The same table maps `dz` and
  `dc` to `DOZEN`, so velista shows the price of one egg as the price of a dozen.
- **The back office prints the raw pair** in three places: `formatUnitPrice` called from
  `libs/luna-shopper-admin/feature-catalog/src/lib/products/product-prices-tab.ts`,
  the template string in `libs/luna-shopper-admin/feature-harvest/src/lib/run-prices-tab.ts`
  and `libs/luna-shopper-admin/feature-harvest/src/lib/entry-view.ts`. A curator reads
  "17 / 100 ml". The audit scripts read the two columns from SQL and were misled the same
  way.
- **The table is keyed on the label alone, for every chain.** El Jamón prints `100gr`,
  which the table does not name, so its rows read as no basis. A chain that prints a true
  "100 g" would be multiplied by ten by the same key that corrects Mercadona.
- **El Jamón is another cause.** 23 El Jamón rows are ten times off for their own label,
  in both directions (2.89 € for 70 g stored as 41.29 per `100gr`, 1.50 € for 100 g
  stored as 1.50 per `Kilo`). `parseUnitPrice` in `price.ts` splits the printed text at the slash and
  does no arithmetic, so the stored pair is the printed pair. The defect is on the page of
  the chain. **Not confirmed:** nobody opened the 23 product pages to see the text.

### Target state

1. **Fixtures first.** Add four products to `tools/capture-fixtures.ts` of the Mercadona
   library and capture them: one with `reference_format` `100 ml`, one with `100 g`, one
   egg product with `dz` or `dc`, and one detergent with `lv`. Take the ids from the
   Mercadona rows of `a5.read.json`. Replace the fixture that is kept by hand with the
   capture. Quote `unit_price`, `unit_size`, `size_format`, `bulk_price`, `reference_price`
   and `reference_format` of each in the pull request.
2. **One function decides the label**, beside `comparedOver`, used by both `toListProduct`
   and `normalizeProduct`. `unitPrice` stays `bulk_price`, read verbatim. The label is:
   - `reference_format` as sent, when `reference_price` equals `bulk_price` within one
     step of the last decimal. That is every `kg`, `L` and `ud` product today.
   - The base label (`L` for `100 ml`, `kg` for `100 g`, `ud` for `dz` and `dc`), when
     `reference_price` equals `bulk_price` scaled by what the label names (one tenth, or
     twelve). The figure is then per litre, kilo or piece, and the label says so in the
     spelling the chain uses for it.
   - `reference_format` as sent, in every other case. A product whose three numbers agree
     with nothing keeps what the chain sent, as the 110 products of plan `0038` do.
3. **If the captures refute the reading of target 2** (`reference_price` equals
   `bulk_price` on a `100 ml` product), stop and report. The second rule then has no
   evidence in the payload. The owner decided for the adapter (section 2, B) on the
   reading of target 2, so the owner then decides again, between option 2D and a rule
   that reads `unit_price` over `unit_size`.
4. **`lv` is decided from its capture and not before.** If the figure is per litre and
   `reference_price` is per wash, the label written is `L`. If nothing in the payload
   says, the label stays `lv` and the pull request says so.
5. **The back office shows the basis.** The three places of the context print the unit
   from `unitBasis` when the answer carries one, and the raw label only when it is null.
   Where a view has no `unitBasis` on the wire today, add it to the contract schema the
   same way `catalog.mappers.ts` does, and regenerate `openapi.json` and `wire-types.ts`.
6. **`unitBasisOf` does not change.** Old rows keep their old labels, and the table is
   what reads them. Section 3 says when its four Mercadona keys can go.
7. **El Jamón, one rule, decided by the owner (section 2, option 2A).** The El Jamón
   adapter writes no unit price and no label for a row whose printed unit price is ten
   times, or one tenth of, the figure that its own price and its own parsed size give.
   Nothing is computed and written in its place.

### Scope

- In: `libs/luna-shopper/mercadona` (`normalize.ts`, its spec, its fixtures through the
  capture tool, the README), `libs/luna-shopper/eljamon` (`listing.ts` or `price.ts`, only
  for target 7), the three admin files of the context and their specs,
  `libs/luna-shopper/contracts` and the two generated files if target 5 needs a field.
- Out: `unit-basis.ts`, the catalog price writer, the effective price recompute, velista,
  the DIA, Carrefour and LIDL adapters, any stored row.

### Constraints

- `bulk_price` is stored verbatim and never recomputed (CLAUDE.md). This plan changes the
  label only. No figure is multiplied, divided or rounded on the way in.
- `reference_price` is read as evidence, as `comparedOver` already reads it. It is not
  stored.
- Refresh Mercadona fixtures with `npx nx run luna-shopper/mercadona:capture-fixtures`,
  never by hand. The opt in live test stays green.
- No release task. Staging and production hold no products, and the first catalog arrives
  by a restore (k8s plan `0012`).

### Action boundaries

- Proceed with code, fixtures and specs. One capture run against the live API is allowed.
- Do not run a harvest on a slot that holds curated data. Section 3 is for the owner.
- Stop and ask in the case of target 3.

### Progress evidence

- A Mercadona spec on each captured fixture: the `100 ml` product answers `unitPrice`
  equal to `bulk_price` and the label `L`; the egg product answers the label `ud`; the
  olive oil of `product-detail-es.json` still answers `L`; the inconsistent product still
  answers its label as sent.
- From one captured listing, the count of products by rule (as sent, relabelled, no rule
  agrees), in the pull request.
- An admin spec per place: a row with `unitBasis: 'LITER'` and the label `100 ml` prints
  the litre and not "100 ml".
- `npx nx test luna-shopper/mercadona`, the admin projects touched, and
  `npx nx build luna-shopper-admin` pass.

## 1. Not in this plan

- The search ranks offers by `unitPrice` whatever the label is (plan `0157`, context). A
  figure per 100 g of one chain is compared with a figure per kilo of another. That is a
  defect of its own and needs its own plan.
- A label of DIA, Carrefour or LIDL. None of the 1,497 rows is theirs.
- The rows whose `100 ml` or `100 g` figure is not a price per litre or kilo. The comment
  of `unit-basis.ts` counts 54 of 615 and 12 of 57 in an earlier catalog, and a nail
  polish of 11 ml carries its own pack price as the figure. They fall under the third
  rule of target 2 and keep what the chain sent.

## 2. Decisions, decided by the owner, 2026-10-06

Both are closed. The builder builds them and asks about neither.

**A. El Jamón rows that contradict themselves by a factor of ten.**

- 2A, decided by the owner, 2026-10-06: the adapter withholds the unit price of such a
  row (target 7). The price of the pack is still written. A wrong figure per kilo makes a
  product look ten times cheaper in a comparison, and no figure is better than that one.
- 2B, rejected: store it verbatim, as today, and list the rows for a person. The wrong
  figure stays in each comparison until a person reads the list.

**B. Where the Mercadona label is corrected.**

- 2C, decided by the owner, 2026-10-06: in the adapter, as target 2 says. The adapter is
  the only code that knows which field of this chain the label belongs to, and every
  reader after it gets a true pair, SQL included.
- 2D, rejected: nowhere in storage, with `dz` and `dc` mapped to `UNIT` and the raw pair
  hidden in the back office. Smaller, and the two columns stay false for whoever reads
  them without the table.

## 3. The data already written

Only local slot 1 holds the wrong rows.

- **A new Mercadona run rewrites them.** The price of a known product is read from the
  listing on every run (`pricesOf` in `mercadona-catalog.runner.ts`). `sameValues` in
  `item-price-writer.ts` compares `unitPriceLabel`, so a row whose label changed is not a
  confirmation: catalog inserts a new row, and the recompute moves the new label onto
  `supermarket_items` in the same write. `replaceScopePrices` in `source-ingest.ts`
  replaces the label on the harvester's own price row.
- **The run must walk the same scopes.** The rows are in the three Córdoba warehouses that
  the run of stage B walked. A scope that the run does not walk keeps its old rows.
- **The old rows stay as history.** Insert on change never updates a row. A count over
  every row of `item_prices` therefore never reaches zero. Count the current row of each
  product, scope and source kind, as `checks.mjs` of stage B does for check B1.
- **A product that Mercadona stopped listing keeps its old label**, and `unitBasisOf`
  still reads it correctly for litres and kilos.
- After that run, the four keys `100 ml`, `100 g`, `dz` and `dc` of `unitBasisOf` are
  needed for history only. Removing them is a later change, and it is safe once no current
  Mercadona row carries one.
- **The 23 El Jamón rows** change under option 2A, which the owner took. The next El
  Jamón run writes each of them with no unit price, as a new row.
