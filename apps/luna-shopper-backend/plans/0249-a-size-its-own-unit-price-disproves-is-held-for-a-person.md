# 0249: a size its own unit price disproves is held for a person

> Found on 2026-11-06 by a scheduled walk of every chain on Luna slot 4 (locked with
> `--keep-data`; the runs are named in the Context). Every priced chain prints a comparison price
> beside the price: a price per kilo, per litre or per unit. Divide the price by it and you get
> the size the chain itself is pricing. Only El Jamón compares the two, and only to withhold a
> unit price ten times off; no adapter doubts the size, so a size that is ten or a hundred times
> wrong is stored, shown and used
> for matching: a cat food of 2.8 kg stored as 2.8 g, a 1.75 l bottle stored as 17.5 ml, a box of
> polvorones stored as 582.8 kg. Plan `0245` (unbuilt) will derive the catalog's own comparison
> figure from price and size, so after it a wrong size also becomes a wrong comparison for
> shoppers.
>
> Prerequisite reading: plan `0038` section 2.4 (`bulk_price` verbatim), plan `0157` (the basis
> read from a label), plan `0177` (a source size states its own unit), plan `0183` (a size counts
> what is inside), plan `0189` (a label that is true of its figure), plan `0244` (the four kinds
> of product, sold by weight and approximate pieces), plan `0245` (a comparable price says what
> it compares in), `libs/luna-shopper/contracts/src/lib/units/unit-basis.ts` (`unitBasisOf`),
> `libs/luna-shopper/contracts/src/lib/units/source-size.ts` (`toBaseUnit`),
> `apps/luna-shopper-backend/harvester/src/app/harvest/source-ingest.ts`
> (`SourceObservation`, `SourceObservationPrice`), `harvest/source-entry-size.ts`
> (`createdSize`), `harvest/matching.ts` (`siblingKey`) and `harvest/run-report.sink.ts`.

## Brief for the agent

### Objective

Compare, at ingest, every observation's stated size with the size its own price and comparison
price imply. A row where the two disagree beyond the tolerance of section 2 keeps the size it
read, carries a recorded doubt with the implied size, is named on the run's report, and no
automated step uses its size: creating a product from it needs the size stated by the person.
Nothing is corrected by itself.

### Context

- An observation carries `unitSize`, `sizeUnit` (plan `0177`), `packCount`, `soldByWeight`,
  `approxWeight` and, per price, `price`, `unitPrice` and `unitPriceLabel`, all verbatim.
- The labels the six walks of 2026-11-06 wrote, by chain (`source_entry_prices`, slot 4):

  | Chain | Labels (count of prices) |
  | --- | --- |
  | Mercadona | `kg` 2,368, `L` 1,204, `ud` 733, `100 ml` 16, `100 g` 5, `lv` 3, `m` 2 |
  | Carrefour | `€/kg` 8,318, `€/ud` 3,206, `€/l` 2,279, `€/100ml` 1,606, `€/lavado` 227, `€/100g` 203, `€/m` 28, `€/docena` 13, `€/g` 3 |
  | El Jamón | `Kilo` 3,268, `Litro` 1,249, `Unidad` 1,107, `100gr` 546, `100ml` 507, `Lavados` 83, blank 27, `Docena` 7, `Metro` 4 |
  | DIA | `KILO` 2,983, `LITRO` 1,117, `UNIDAD` 435, `100 ML.` 330, `LAVADO` 39, `100 GR.` 23, `DOCENA` 9, `METRO` 3 |
  | LIDL | none (7,113 prices, every one with no unit price) |

  `unitBasisOf` (contracts) knows none of the Carrefour labels, nor `100gr`, `100ml`, `Lavados`,
  `100 ML.` and `100 GR.`. So `unitBasis` is null today on every Carrefour offer and on about
  1,500 more. That gap is in scope for plan `0245`, which owns the basis; this plan reads labels
  with its own table (section 1) and does not change `unitBasisOf`.
- The comparison over the four priced chains with a label, sold by weight rows left out, a
  figure per 100 read as a tenth of the figure per kilo or litre:

  | Chain | Compared | Off by over 10% | Over 50% | Ten times or more |
  | --- | --- | --- | --- | --- |
  | Mercadona | 3,738 | 39 | 23 | 14 |
  | Carrefour | 13,039 | 478 | 294 | 29 |
  | El Jamón | 5,134 | 73 | 12 | 1 |
  | DIA | 4,403 | 39 | 11 | 0 |

- Rows that show what this catches (the stated size, then what the chain prices):

  | Chain | Row | Stated | Price, comparison price | Implied |
  | --- | --- | --- | --- | --- |
  | Carrefour | Pienso de salmón y trigo para gatos esterilizados Purina One, `2,8 g` | 2.8 g | 18.45, 6.59 €/kg | 2.8 kg |
  | Carrefour | Pepsi zero azúcar lima botella, `1,75 cl.` (16 rows print `cl`) | 17.5 ml | 1.69, 0.97 €/l | 1.74 l |
  | Carrefour | Polvorones de almendra artesanos, `1880 estuche de 310 g.` | 582.8 kg | 7.59, 24.48 €/kg | 0.31 kg |
  | Carrefour | Cerveza Amstel 100% Malta pack 28 latas, `33 cl.` | 330 ml | 20.72, 2.24 €/l | 9.25 l (28 × 330 ml) |
  | Mercadona | Postre Caramel Cake Hacendado (18382) | 1.6 kg | 1.70, 10.63 €/kg | 0.16 kg |
  | El Jamón | limpiahogar concentrado amoniacal, `1.625ml` | 1.625 ml | 2.35, 1.45 €/Litro | 1.62 l |
  | DIA | Cerveza Heineken, `pack 24 x 1 L` | 24 l | 19.92, 2.52 €/LITRO | 7.9 l |

- **The chain's comparison price is wrong too, sometimes.** Mercadona prints 3.50 "per 100 ml"
  for an 11 ml nail polish that costs 3.50, and 0.03 €/kg for a 0.16 kg box of tablets at 1.60.
  This plan cannot tell which of the two figures is wrong, and it must not guess: it records a
  doubt, and a person decides.
- Plan `0248` fixes the Mercadona pack count, and plan `0250` fixes the Carrefour polvorones
  and beer pack rows: after `0250` both agree with their comparison price. This plan is the net
  that catches what any parser misses, including a typo the chain itself printed. Its criteria
  name the rows expected whatever lands first.
- **One adapter already checks a pair.** El Jamón's `contradictsItsSizeTenfold`
  (`libs/luna-shopper/eljamon/src/lib/price.ts`, near line 106, plan `0189`) withholds a unit
  price that is ten times off its size, so those rows reach ingest with no unit price and this
  check never sees them. Its `LABEL_QUANTITIES` table reads El Jamón's labels; reuse it, or move
  it to the shared module, rather than keep two tables for one chain.
- **Accepting a row onto an existing product takes no size.** `AcceptSourceEntryRequest` is
  `{ entryId, itemId }` (`harvest.messages.ts`, near line 1823) and `accept` reads no size. Only
  `createItem` and the bulk create go through `createdSize`, so only they can be refused.

### Target state

Every acceptance criterion holds, the specs of the Tests section pass, `openapi.json` and the
admin wire types are regenerated if a view field is added (D2), and a walk on a slot names the
rows of the Context table on its report.

### Scope

- A pure module in the harvester, `harvest/size-check.ts`, with its spec.
- `source-ingest.ts`, where the check runs for each observation and its result is written.
- `source-entry-size.ts` (`createdSize`), `matching.ts` (rung 4), `run-report.sink.ts`, and the
  view mapper if D2 adds a field.
- A harvester migration only if D1 picks a column.

### Constraints

- The stored size, price, comparison price and label stay what the source sent. No figure is
  derived and written over another (CLAUDE.md, `bulk_price`).
- A label the table of section 1 does not know means no check, never a guess.
- Sold by weight rows and approximate pieces (plan `0244`) are not checked: their comparison
  price is the price itself or per piece.
- The check costs no request.

### Action boundaries

Stop and ask before changing `unitBasisOf` or any catalog code, before writing any field of an
item, and before changing what an existing `ACTIVE` row is bound to.

### Progress evidence

`npx nx test luna-shopper-backend-harvester`, the size check spec with every row of the Context
table as a case, and the report of one walk per priced chain on an ephemeral slot, quoted in the
PR with the counts of section 3.

## 1. Reading a label

A table in `size-check.ts`, keyed on the label lowercased, trimmed, with a leading `€/` and a
trailing full stop removed and inner spaces collapsed. Each entry names the dimension (`mass`,
`volume`, `count`) and the amount the figure is per, in base units:

| Keys | Dimension | Per |
| --- | --- | --- |
| `kg`, `kilo` | mass | 1,000 g |
| `100 g`, `100g`, `100gr`, `100 gr` | mass | 100 g |
| `g` | mass | 1 g |
| `l`, `litro` | volume | 1,000 ml |
| `100 ml`, `100ml` | volume | 100 ml |
| `ud`, `unidad` | count | 1 |
| `docena` | count | 12 |

`lv`, `lavado`, `lavados`, `m`, `metro`, a blank label and anything else answer no check.
After plan `0189` the Mercadona normalizer relabels a figure per litre or per kilo as `L` or
`kg` (`readUnitPriceLabel`, `normalize.ts`, near line 400), so a stored Mercadona `100 ml` or
`100 g` is a figure the normalizer could not prove: read it as per 100, as the table says, and
let the spec prove the plan `0189` fixtures still agree. `unitBasisOf` maps `100 ml` to `LITER`;
this table does not follow it, because this one states the amount and not a basis.

## 2. The comparison

For an observation with a stated size, a known label whose dimension matches `sizeUnit`, a price
and a comparison price above zero:

- `stated` is the size in base units (`toBaseUnit`), for the whole pack as plan `0162` states it.
- `implied` is `price / unitPrice × per`.
- `ratio` is `implied / stated`.

The row **agrees** when `ratio` is within 0.85 and 1.18. It **disagrees** otherwise. A row whose
`ratio` is within 2% of a whole number from 2 to 48, with no `packCount`, also records that
whole number as a probable count (the Carrefour beer packs). A count dimension compares only
when `sizeUnit` is `UNIT`.

## 3. What a disagreement does

- The row keeps its stated size. The doubt is recorded with `implied`, `ratio`, the label and
  the run id (D1 decides where). A later observation that agrees clears it.
- `createdSize`, and so `createItem` and the bulk create, refuse to take the size from a row
  with a doubt: the operation must name `unitSize`. The refusal names the stated and the implied
  size. An accept onto an existing product is not touched: it writes no size.
- Rung 4 proposes nothing from a row with a doubt and proposes no row with a doubt (its key
  holds the size).
- The report gains `sizesDisproved` (count), `sizesDisprovedExamples` (the first 20, each with
  name, stated, implied, label) and `probablePackCounts` (count).

## Tests

- `size-check.spec.ts`: every row of the Context table, a row that agrees from each chain's
  fixtures, every label of section 1 and one unknown label, a sold by weight row, an approximate
  piece, and the 2% count rule on the beer pack.
- An ingest spec that a disagreeing observation keeps its size, records the doubt, and that the
  next agreeing observation clears it.
- A `createdSize` spec that a row with a doubt and no named size is refused, and an accept spec
  that a doubted row is still accepted onto an existing product.

## Acceptance criteria

- [ ] After a walk, the Carrefour cat food, the Pepsi `1,75 cl.` rows, Mercadona 18382 and DIA's
  Heineken pack each carry a doubt with the implied size shown. The El Jamón limpiahogar carries
  one: its ratio is a thousand, and on slot 4 its unit price reached ingest. Polvorones and the Amstel pack
  carry one only if plan `0250` has not landed; with `0250` they agree.
- [ ] No stored size, price, comparison price or label changes.
- [ ] Creating a product from a doubted row without a named size is refused with both sizes in
  the message.
- [ ] The report of each priced walk states `sizesDisproved`.
- [ ] A walk of LIDL, which prints no comparison price, checks nothing and reports 0.

## Verification

On an ephemeral slot with the four priced chains walked, read the count of doubted rows per
chain and compare it with the "Off by over 10%" and "Over 50%" columns of the Context table;
quote both in the PR. The doubted count lands between the two.

## Decisions

- **D1 (owner): where the doubt lives.** (a) three nullable columns on `source_catalog_entries`
  (`sizeDoubtImplied`, `sizeDoubtRatio`, `sizeDoubtRunId`), a migration; (b) one object under
  `extra`. Recommended: (a), so the queue can filter on it.
- **D2 (owner): does the queue show it.** (a) yes, a field on `SourceCatalogEntryView` and a
  follow up admin plan for the chip; (b) the report only. Recommended: (a).
- **D3 (owner): the tolerance.** 0.85 to 1.18 is about 15%, wide enough for the chain's rounding
  on small packs (0.16 kg at two decimals). Measured above: 39 of 3,738 Mercadona rows are past
  10%. Recommended: keep 15% and revisit after one week of walks.
