# The decisions of the first catalog repair (October 2026)

Backend plan `0186` repaired the first Luna Shopper catalog on a local database (Luna slot 1)
on 2026-10-06. Model agents read about 1,500 products, pairs and queue rows one by one and decided
each of them. Staging and production are still empty, so the same work may be done again on a
new harvest. This folder keeps what was decided, so that a second run applies the decisions
and does not pay to take them again.

The report of the repair is `../initial-catalog-2026-10.md`, section "Repairs after the audit".
It says what happened. This folder says what was decided, row by row.

**The owner answered the sixteen decisions that the repair left, on 2026-10-06.** Section 4
holds each answer. Backend plan `0192`
(`../../plans/0192-the-owners-decisions-on-the-first-catalog-applied.md`) applies them on
slot 1. Until that plan is built, the data files say what the owner decided and the catalog
does not hold it yet.

The folder holds three things:

- This file: the rules, the decisions of each step, and the sixteen decisions that the
  repair left, each with the answer of the owner.
- Sixteen data files, one for each step (`a01-…json` to `b05-…json`), and `gaps.json`.
- `build/`: the scripts that wrote the data files from the files of the repair.

## How to read a data file

Each file opens with a header (`step`, `sources`, `keys`, `decidedBy`, `naturalKeys`) and then
holds `entries`, one entry on one line.

**A product or a queue row is named by its natural keys, not by its id.** A new curation gives
each product a new uuid, so a uuid of slot 1 finds nothing in another database.

- A product: `brand`, `nameEs` (the Spanish name), `size`, `unit`, `packCount`, `barcode`.
- A queue row: `chain`, `sourceKind`, `externalId`, `printedName`, `printedBrand`,
  `sizeFormat`, `barcode`.
- `localId` is the uuid on slot 1. It is of use only against the dumps of slot 1.
- `null` means that the source held no value: a loose fruit has no brand and no barcode. A key
  that the source files do not print at all is counted in section 3.

**The keys of a product are the keys before the change.** Stage A files key a product as it
stood in the catalog of 2026-10-03, before any repair. Stage B files key it as it stood at the
start of stage B, or as the read of the step printed it. The header of each file says which.

**To apply a file to another database**, find each product by brand, Spanish name, size, unit
and pack count, and by barcode when it has one. Find each queue row by chain, source kind and
external id. The external id of a Deza row is a hash of its printed name and format. Then
apply `decision`. An entry whose `status` starts with "left" or "not applied" changed nothing:
it records that somebody looked and why nothing was done. `openDecision` names a row of the
table in section 4, and `ownerDecision` beside it is the answer of the owner to that row.
The key kept its name from the time the rows were open. No row is open now: fifteen are
decided and one is held by the owner. `status` still says what the repair did, so a row
that the owner decided on 2026-10-06 reads "left" until plan `0192` applies the answer.

A new harvest and a new curation will not give every product the same name. An entry that
finds no product is not an error. Read its `why` and decide again.

## 1. Rules

Each rule applies to any product, not only to the rows of this repair. "The session" is the
directing session of the repair. On 2026-10-06 the owner answered its report of the first pass
with two decisions and the words "Decide for yourself on the rest, they seem fine." What the
session then decided is marked as such, and the owner can change each of those rules.
Later on 2026-10-06 the owner read the sixteen decisions of section 4, said that the
recommendations "are on point", and answered each one. Rule R32 comes from those answers.

### Rules the owner decided

| # | Rule | Decided |
| --- | --- | --- |
| R1 | A merge may delete a product that still holds price rows, when the kept product already holds each of those rows with the same source kind, scope, price, unit price and validity. The delete then cascades duplicates only. Read both products before each delete. | The owner, 2026-10-06 |
| R2 | When only a capacity tells two household products apart (a 4 litre and an 8 litre basin), the capacity goes in the name in both languages. The product becomes `UNIT` with no size. | The owner, 2026-10-06, for the two pairs of step A3 |
| R3 | A weight that is not the same on every pack is not a format. A piece sold by weight is one product, `KILOGRAM` with no size. A fixed weight stays a format. | The owner, 2026-10-03 (the report, "Weighed products are one product") |
| R4 | Nike Man is Nike, and Nivea Men is Nivea. The range joins its house and is not a brand. | The owner, 2026-10-03 (the report, "Brands") |
| R5 | A product name is not a brand. Pantera Rosa is a product of Bimbo. | The owner, 2026-10-03 (the report, "Brands") |
| R6 | A line with its own shelf identity stays a brand: Hero Baby, YoPro, Ristorante. | The owner, 2026-10-03 (the report, "Brands") |
| R32 | A printed size wins over a size worked out from a unit price. The El Pozo burger "king" prints 240 g, so it is 240 g, and the unit price that implies 260 g changes nothing. | The owner, 2026-10-06 (decision 10): "If it's printed at 240g, the size is 240g." |
| R7 | A revert of a harvest run and a delete of prices that are not duplicates are decisions of the owner. No agent takes them. | Plan `0186` (action boundaries), which the owner started on 2026-10-06. Both agents of stage B held to it. |

### Rules of plan 0186

The owner gave the go ahead for the plan on 2026-10-06 ("merge the PRs, then start 0186").
The plan states these rules in its target table.

| # | Rule | Step |
| --- | --- | --- |
| R8 | Every change goes through the admin API, so the audit trail holds it. SQL is for reading. | Constraints |
| R9 | `LITER` and a sized `KILOGRAM` are not stored. A weight or a volume becomes `GRAM` or `MILLILITER`, times 1000. | A3 |
| R10 | A capacity is not a size. A bin, a box or a bucket printed in litres becomes `UNIT` with no size. | A3 |
| R11 | A code that starts with 2 is an in-store code and not a barcode. The product holds no barcode. | A4 |
| R12 | A code of 11 digits takes a leading zero only when the result has a valid check digit. Else the product holds no barcode. | A4 |
| R13 | A pack count that is the first number of a dimension ("25x34 cm") is not a pack count. | A2 |
| R14 | The word "pack" leaves a name when the pack count or the size already says it. | A10 |
| R15 | A merge is two steps: the queue rows of one product are accepted onto the other, then the empty product is deleted. A product is deleted only when no queue row names it (and see R1 for its prices). | Constraints |
| R16 | A product sized `1 UNIT` takes the size that its queue rows agree on. | B3 |

### Rules the session or an agent set (the owner can change each one)

| # | Rule | Set by |
| --- | --- | --- |
| R17 | **A name patch sends both languages.** A patch replaces the whole name, so a patch with only the Spanish name deletes the English one. | An agent, after it lost one English name for a minute (step A6) |
| R18 | A product name registered as a brand (Black Label, White Label, Boss Bottled, Invictus) moves into the product name first. The brand is then linked to its house as a spelling. | The proposal of section 1 of the plan, applied by the session |
| R19 | **The line rule.** A word that names who the product is for, or a variant (Man, Woman, Men, Homme, Total, Gold, Q10), is a range and joins its house as a spelling. The product names do not take the range word, unless two products of the house would then be equal in name, size, unit and pack count. | The proposal of section 1 of the plan, applied by the session |
| R20 | These lines stay brands: Kinder Bueno, Kinder Joy, Hero Baby, YoPro. | The proposal of section 1 of the plan, applied by the session. Hero Baby and YoPro are also R6. |
| R21 | A brand that another spelling points at cannot become a spelling itself (`brand_link_too_deep`). Do not change a link to force it. Move the products through their own brand field. | An agent (the Invictus case) |
| R22 | The brand of a product is the line that the chain prints, not the maker: Nestlé "Chocolate KitKat" belongs to `KitKat`. The maker leaves the name. | Plan `0186`, step A9, and rule 5 of the curation prompt |
| R23 | The children's line of a house, with its own name on the bottle, is not a spelling of the house (Gotitas de Oro and Gotas de Oro). | An agent read both brands. The session kept it. |
| R24 | Singular and plural of one loose vegetable or fruit, with no brand and sold by the kilo, are one product. The exception is a chain that lists both under two codes: then a person decides. | An agent proposed it. The session applied it. For the exception the owner gave a test on 2026-10-06 (decision 11). |
| R25 | In a merge, the kept product is the one that holds the barcode or the price. | An agent. It is the choice in every merge of this repair. |
| R26 | What the container is (botellín, lata) stays in a name, because it tells a bottle from a can. | An agent (step A10) |
| R27 | An English name carries no brand and no size. A line word, a shade code and a proper name stay as printed. | The rules of the curation prompt, used by an agent (step A1) |
| R28 | The same size at another price in the same shops is another article of the chain. Such a row is never accepted onto the product as a second barcode. It gets a product of its own. | An agent (step B4). The owner confirmed it on 2026-10-06 (decision 2). |
| R29 | A candidate that matches by name and size across two brands is not accepted. | An agent (step B4). The owner confirmed it on 2026-10-06 (decision 7). |
| R30 | For one product stored by weight and by count, keep the product in grams or millilitres and put the count in the pack count. Merge only when the two names are the same word for word. | An agent (step B5, the Bref pair). On 2026-10-06 the owner widened the last sentence (decision 6): merge when the rows of both agree on count and weight. |
| R31 | A size that only price over unit price gives is not proof. Do not write it without a row that prints it. | An agent (steps A5 and B1). On 2026-10-06 the owner made one exception, for the 22 frozen fish products (decision 3). R32 holds for every other case. |

## 2. Decisions taken

The counts are those of the data files. "Applied" means that the write was sent and read back.

### A1, an English name for each product that had none

- 100 products. 96 names applied. 4 left for a person, with the name that was proposed.
- Data: `a01-english-names.json`.
- An agent wrote the names with no model call and no fetch. The session applied every name
  marked high or medium.

### A2, a pack count read from a dimension

- 9 products. The pack count was cleared on all 9.
- Data: `a02-pack-counts-from-a-dimension.json`.

### A3, a sized `KILOGRAM` and every `LITER`

- 199 products.
- 192 applied in the first pass: 22 to `GRAM`, 148 to `MILLILITER`, 22 capacities to `UNIT`
  with no size.
- 4 applied in the second pass: the two pairs of R2 (Plastiken "Barreño ecru" 4 L and 8 L,
  Great Plastic "Caja de ordenación" 52 L and 70 L).
- 3 applied in stage B: the three Mercadona pieces became `KILOGRAM` with no size (R3), after
  the new run said that they are sold by weight.
- Data: `a03-units.json`. The reading of each product is in `why`.
- Three conversions were looked at again (decisions 13 and 14).

### A4, a code that is not a barcode

- 216 products. 211 in-store codes cleared. 2 codes of 11 digits padded. 3 codes of 12 digits
  left for a person, because the plan has no rule for them.
- Data: `a04-codes-that-are-not-a-barcode.json`.

### A5, a size that the unit price contradicts

- 146 products, on 238 price rows.
- 1 applied: Hacendado "Postre lácteo Lemon Cake" from 1600 to 160 `GRAM`.
- 2 proposed and not applied: the Fanta naranja row (decision 15) and the El Pozo burger "king"
  row (decision 10).
- 143 left. For most of them the size is right and the unit price of the chain is wrong.
- Data: `a05-sizes-against-unit-prices.json`. `group` says which kind of case each one is.

### A6, the same product twice

- 27 merges applied: 7 exact pairs in the first pass, 14 exact pairs and 6 near pairs in the
  second. The second pass cascaded 18 duplicate price rows (R1).
- 1 rename applied, on the kept YoPro product.
- 12 pairs not merged: 8 that are two products (the Nivea roll-on pair among them) and 4 fruit
  pairs for a person (decision 11).
- Data: `a06-the-same-product-twice.json`. Each merge names the kept product, the deleted
  product and each queue row that moved.
- The near read found 729 other candidates, all read as two products. They are not in the data
  file.

### A7, a row bound to the wrong product

- 3 cases.
- The El Jamón row "chocolatinas pk-3" moved from the KitKat F1 figurine to the KitKat bars.
  Its stale price row on the figurine was then deleted through the API.
- The BBQ skewers became two products, 20 cm and 32.5 cm, with the length in the name.
- The Pepsi can and bottle of 330 ml stay one product.
- Data: `a07-rows-bound-to-the-wrong-product.json`.

### A8, one brand registered twice

- 5 links applied: 3 Brujas to Las 3 Brujas, Sierra de Montoro to Sierra Montoro, Liviana to
  Fuente Liviana, One to Purina One, CH Carolina Herrera to Carolina Herrera.
- 1 not linked: Gotitas de Oro (R23).
- Data: `a08-one-brand-registered-twice.json`.

### A9, a wrong brand on a product

- 8 renames applied: three tonics to `Nordic Mist`, one dog snack to `San Dimas`, three
  products to `KitKat`, and one cheese that lost its maker from the name.
- 1 merge applied: the Gourmet salmon mousse onto the product of `Gourmet Revelations`.
- 1 no change: the Fiesta mini pizzas carry the brand their chain prints.
- Data: `a09-a-wrong-brand-on-a-product.json`.

### A10, a name that says "pack"

- 103 products. 78 names lost the word. 25 left out: the product has no pack count, or "pack"
  is part of what the product is.
- Data: `a10-names-that-say-pack.json`.

### A11, the brand questions of section 1 of the plan

- 19 brand calls: 16 links applied, 1 link refused (Invictus to Paco Rabanne), 2 brand renames
  (`Nordic` to `Nordic Blonde`, and the label `Loreal` to `L'Oréal` with the key unchanged).
- 9 product renames in two batches. They were sent before the links (R18).
- 7 lines left separate, 4 lines that stay by R20, and the brands held or kept. They are in the
  header of the data file.
- 4 probable duplicates that the links made visible, not merged (decision 9).
- Data: `a11-brand-decisions.json`. Each link lists every product that moved.
- **The owner did not answer the rows of section 1 one by one.** The session applied the
  proposal column of the plan on the owner's word of 2026-10-06. Five links are the reading of
  an agent of "and the like": Oral-B 3D White, Oral-B Pro-Expert, Oral-B Pro-Flex, Vanish Oxi
  Action and Norit Complet. An unlink brings the products back, because each product keeps the
  key of the brand it was printed with.

### B1, products sold by the kilo

- The Mercadona run `b3a3f87d` wrote 526 price rows on 178 products at the per kilo price. It
  was a run, not a decision, so its rows are not in a data file.
- 3 products applied: the three pieces of A3.
- 44 products left: 22 frozen fish and seafood products (decision 3), 21 Deza leaflet offers
  with no price (decision 1), and "Manzanas Golden" (decision 11).
- The second import of the Deza leaflet was refused with 409. Nobody reverted run `794056b6`.
- Data: `b01-prices-by-the-kilo.json`.

### B2, the Deza run

- The Deza run `960a32c5` wrote 10,989 offers with no price and stored 155,067 availability
  claims. No decision was taken on a row.
- 58 products left without an offer, because the run did not see their only row (decision 5).
- 11 shop codes left unmapped: ten shops and `CONSULTAR`, which is not a shop (decision 4).
- Data: `b02-deza-run.json`.

### B3, products sized 1 `UNIT`

- 417 products read. 131 took the size that their rows agree on. 286 left: 269 because the row
  itself says 1 unit, 15 because no row states a size, 2 because the size could not be read
  with confidence.
- 2 merges applied after the sizes: the two Evax Liberty pads.
- 16 near pairs left: 14 read as two products, and 2 for a person (Tampax Pearl regular,
  Oral-B Precision).
- Data: `b03-sizes-of-one-unit.json`.

### B4, rows left as `CANDIDATE`

- 28 rows read. 3 accepted: the Mercadona "Melón piel de sapo" row and two Deza leaflet rows
  with the same brand, name and size as their product.
- 25 left: the 11 Mercadona rows that the plan said to accept (R28, decision 2) and 14 El Jamón
  rows (R29, decision 7).
- Data: `b04-candidate-rows.json`.
- This step went against the plan. The plan said to accept the 11 rows. An agent accepted none
  and gave the reason on each row.

### B5, one product stored by weight and by count

- 1 merge applied: Bref "Colgador WC Power Activ limón" (R30).
- 47 pairs left for a person (decision 6). The Dolce Gusto boxes that the plan names are among
  them.
- Data: `b05-grams-and-units.json`.

## 3. What the data files lack

`gaps.json` holds these counts. The build wrote them, nobody typed them.

**The keys of stage A are replayed, not read.** No file of the repair holds every product as it
stood before stage A. The build starts from the snapshot of the end of stage A and takes back
each write, from the "was" value that its answers file kept. The result holds 19,791 products,
which is the count of the catalog of 2026-10-03. It was checked against the two reads that the
first pass made after its own writes, and no product differs. A field that no answers file
names (the category, the image) is not in the keys at all.

| File | Entries | Products | Queue rows | Keys that are missing |
| --- | ---: | ---: | ---: | --- |
| `a01` | 100 | 100 | 0 | None. The queue rows are text in `evidence`, with no key. |
| `a02` | 9 | 9 | 0 | None. The queue rows are text in `printedRows`. |
| `a03` | 199 | 199 | 0 | None. The queue rows of the last 7 entries are text. |
| `a04` | 216 | 216 | 0 | None. The codes of the queue rows are listed, the rows are not keyed. |
| `a05` | 146 | 146 | 0 | None on the products. The queue rows and the price rows are text. `a5.read.json` of the run folder keys them. |
| `a06` | 40 | 79 | 30 | 4 of 30 queue rows carry no chain and no external id. They are the El Jamón rows of four near merges (Berenjena, Tomates pera, Chuletas aguja de cerdo, Fuente Liviana). Each has its printed name and its source kind. The `why` of the merge names the chain in words. |
| `a07` | 3 | 4 | 7 | 2 of 7 queue rows carry no chain, no source kind and no external id: "chocolatinas" (KitKat, pk-3) and "refresco cola lata" (330ml). The text of the step says that the first is an El Jamón row. |
| `a08` | 6 | 5 | 0 | None. A brand is keyed by its label. |
| `a09` | 10 | 11 | 1 | None. |
| `a10` | 103 | 103 | 0 | None. The queue rows of the 25 left out are text. |
| `a11` | 32 | 84 | 0 | None. The spellings that block a link (`INVICTUS P.RABANNE`, `VILEDA TURBO SMART`, `FARMERS ORIGINS NESCAFÉ`) are named in text only. |
| `b01` | 47 | 47 | 67 | None. A price scope is not keyed: the Mercadona rows name the three warehouses in the header. |
| `b02` | 69 | 58 | 58 | None. The 11 shop codes carry the code and the printed name. |
| `b03` | 435 | 453 | 430 | None. |
| `b04` | 28 | 22 | 53 | 14 of 53 queue rows carry no chain and no source kind. They are the siblings of the 14 El Jamón candidates. Each has its external id, printed name and printed brand. |
| `b05` | 48 | 96 | 117 | None. |

No product in any file carries only its uuid.

What one read of the kept dumps would add:

- The chain and the external id of the 4 rows of `a06` and the 2 rows of `a07`.
- The chain and the source kind of the 14 sibling rows of `b04`.
- The English name of each product before its change. The files hold the new English name only.
- The 729 other candidates of step A6, if somebody wants the pairs that were read as two
  products.

## 4. The sixteen decisions, and the answer of the owner

**The owner answered all sixteen on 2026-10-06.** The owner said that the recommendations
"are on point" and accepted each one as written, with two exceptions: decision 9 is held,
and decision 10 takes the printed size. Each recommendation is the one of the directing
session of 2026-10-06. Where the status says "decided", the recommendation is the answer.

Plan `0192` applies the answers. Its sections are named in the last table.

| # | Question | Recommendation of the session, which is the answer unless the status says otherwise | Status |
| --- | --- | --- | --- |
| 1 | Revert Deza leaflet run `794056b6` and import the document again, to price the 21 offers by the kilo? | No. The leaflet is valid only until 2026-10-08, and a second import collides with the 8 rows the website run took over. The next leaflet goes through the fixed code. | Decided by the owner, 2026-10-06: no revert and no second import. |
| 2 | The 11 Mercadona rows plan 0186 called second barcodes | Each gets a product of its own, created from its row. Two containers of one milk or butter at two prices in the same shops are two products, told apart by the container in the name. The Coca-Cola "2 L" at 5.60 is a multipack and takes a pack count once its detail is read. | Decided by the owner, 2026-10-06: as recommended. |
| 3 | 22 frozen fish and seafood products that are `KILOGRAM` with no size while the chain sells a fixed pack | Set `GRAM` with the weight that price over unit price gives, when it lands within 1 percent of a round pack weight. Leave the rest for a person. | Decided by the owner, 2026-10-06: as recommended. |
| 4 | Ten Deza shop codes with no shop | Map the ten by their street names to the Deza shops of the catalog. Never map `CONSULTAR`. First confirm in code that a mapping publishes the waiting claims. | Decided by the owner, 2026-10-06: as recommended. The condition is met, see below. |
| 5 | 58 Deza products the second run did not see | Leave them. No write. | Decided by the owner, 2026-10-06: left. |
| 6 | 47 pairs of one product stored by weight and by count | One reading pass that merges a pair only when the rows of both agree on count and weight. Keep the product in grams or millilitres and put the count in the pack count, as done for the Bref pair. | Decided by the owner, 2026-10-06: as recommended. |
| 7 | 14 El Jamón candidates that match another brand by name and size | Reject each candidate. Bind the row to the product of its own brand when one exists, else create one from the row. | Decided by the owner, 2026-10-06: as recommended. |
| 8 | 4 products with no English name (Alteza "Besitos", Hidalgo "Negrito", "Negrito gigante", El Cateto "Panales de cabello sin azúcar") | Keep the three proper names as they are in English. "Sugar free angel hair pastries" for the fourth. | Decided by the owner, 2026-10-06: as recommended, and not the names that step A1 proposed. |
| 9 | Probable duplicates: Johnnie Walker Black Label 700 ml, Dewar's White Label 700 ml and 1 L, ProActiv margarine 225 g | Merge all four pairs. Move `d38b02dd` from Flora to ProActiv first. | **Held by the owner, 2026-10-06.** The recommendation is not taken: "Leave this one for now, I wanna check if they are actually duplicates". No merge, and `d38b02dd` stays under Flora. |
| 10 | El Pozo burger "king" bound to the regular burger product | Create a product from row `67a821e4`, remove the 2.95 price row from the old product, size 260 g (price over unit price), low sureness on the size. | Decided by the owner, 2026-10-06, with another size: the row gets a product of its own, and that product is **240 g, as printed**. "If it's printed at 240g, the size is 240g." The unit price that implies 260 g is the figure of the chain and changes nothing (rule R32). |
| 11 | Singular and plural fruit pairs (Aguacate, Kiwi verde, Manzana Golden, Manzana roja dulce) | The product whose Mercadona row is sold by weight is the loose fruit and takes every loose row of the other chains. The other is the bag and stays its own product with a size. Move El Jamón row `a90598fb` and the 1.5 kg Golden bag accordingly. | Decided by the owner, 2026-10-06: as recommended. |
| 12 | Brand lines left separate (Nike Ultra Blue, Vileda Turbo, Vileda Duactiva, Nescafé Farmers Origins, Neutrex Transpirex, Lenor Unstoppables, Puleva Max) and the brand Invictus | Link the first six to their house with the word in the product name, after pointing the blocking spellings at the house. Puleva Max stays, like Hero Baby. Point `INVICTUS P.RABANNE` at Paco Rabanne, then link Invictus. Keep the five Oral-B, Vanish and Norit links an agent made. | Decided by the owner, 2026-10-06: as recommended. |
| 13 | Charcoal "10l" and cat litter "8 L" stored as `MILLILITER` | Keep. The pack states its content by volume, and base units are the rule. | Decided by the owner, 2026-10-06: kept. |
| 14 | Incarlopsa "Jamón serrano pieza" at 7500 `GRAM` against about 6.8 kg implied | `KILOGRAM` with no size if its row is sold by weight, as for the three Covap pieces. Else leave. | Decided by the owner, 2026-10-06: as recommended. |
| 15 | Fanta naranja 1500 ml against a unit price that says 1.25 L | Leave until the next Mercadona run prints the size again. | Decided by the owner, 2026-10-06: left. |
| 16 | The F1 figurine shown available with no price in 20 El Jamón scopes | Wait for the code fix (a row that moves takes its offers with it), no manual write. | Decided by the owner, 2026-10-06: wait for plan `0191`. |

What was found after the recommendations were written:

- **Decision 4.** The condition is met. `SourceLocationService.map` publishes the stored
  claims of a shop in the same request (`PUT /v1/admin/harvest/shops/:id/location`), and
  `POST /v1/admin/harvest/shops/:id/ignore` dismisses `CONSULTAR`. Not confirmed: that
  one mapping, about 11,000 claims in batches of 200, finishes inside the request timeout.
  If it fails, the shop stays mapped, and mapping it again sends the same claims.
- **Decision 12.** The recommendation first said "the six Oral-B, Vanish and Norit links".
  The files of the repair hold five: three Oral-B, one Vanish and one Norit. The table
  above says five.
- **Decision 3.** The words do not say what a round pack weight is. Plan `0192` reads it
  as a multiple of 10 g or of 25 g, with exactly one such weight within 1 percent. 21 of
  the 22 products pass.
- **Decision 6.** No row of a product stored by count prints a weight, so no pair agrees
  on a weight as the words say. Plan `0192` reads "agree" as "do not contradict" and asks
  for the same variant in both names. Most of the 47 pairs are two products.
- **Decision 7.** The reject route of the queue rejects the row and not the proposal. The
  row is bound to another product, which drops the proposal.
- **Decision 11.** Both Mercadona rows of each of the four pairs are sold by weight in the
  snapshot of the end of the repair. The test of the answer then tells no pair apart.
  Plan `0192` moves no fruit row unless a new read differs, and reports the pairs.

Where each one stands in the data, and in plan `0192`:

| # | Data | Plan `0192` |
| --- | --- | --- |
| 1 | `b01`, the 21 entries with `openDecision` 1 | Not done, section 6 |
| 2 | `b04`, the 11 Mercadona entries | Stage 1, section 2.7 |
| 3 | `b01`, the 22 entries with `gramsThatPriceOverUnitPriceGives` | Stage 1, section 2.2 |
| 4 | `b02`, the 11 `shopCode` entries | Stage 1, section 2.5 |
| 5 | `b02`, the 58 product entries | Not done, section 6 |
| 6 | `b05`, the 47 entries with `decision` "no merge" | Stage 1, section 2.8 |
| 7 | `b04`, the 14 El Jamón entries | Stage 1, section 2.6 |
| 8 | `a01`, the 4 entries marked low | Stage 1, section 2.1 |
| 9 | `a11`, the 4 entries with `decision` "no merge" | Not done, held, section 6 |
| 10 | `a05`, El Pozo "Burger de pavo con espinacas bienStar" | Stage 2, section 3.1 |
| 11 | `a06`, the 4 pairs left for a person, and `b01`, "Manzanas Golden" | Stage 2, section 3.2 |
| 12 | `a11`: `linesLeftSeparate` in the header, the refused Invictus link, and the five links marked as agent judgement | Stage 1, section 2.4 |
| 13 | `a03`, "Carbón vegetal" and "Lecho higiénico Vegetal Clean" | Not done, section 6 |
| 14 | `a03`, "Jamón serrano pieza" | Stage 1, section 2.3 |
| 15 | `a05`, Fanta "Refresco de naranja" | Not done, section 6 |
| 16 | `a07`, the first entry | Not done, section 6 |

Stage 1 of the plan needs no code. Stage 2 runs after plan `0191` is merged, because a
bound row that moves to another product leaves its offers and its barcode behind until
then. Stage 3 takes the dumps that ship.

## 5. How to build the data files again

The scripts read files only. They open no database and call no service.

```sh
node build/build.mjs <path to .curation-runs/2026-10-audit-repair>
# or
CURATION_RUN_DIR=<that path> node build/build.mjs
```

The run folder is git ignored and stands in the checkout that did the repair. Its
`README.md`, `stage-a-summary.md` and `stage-b-summary.md` describe each source file.

| Script | What it does |
| --- | --- |
| `build/lib.mjs` | Reads the source files, shapes a product and a queue row by their natural keys, counts the keys that are absent, writes one entry on one line. |
| `build/state.mjs` | Holds each product at the start of stage B, replays each product before stage A, and checks the replay. |
| `build/stage-a.mjs` | Steps A1 to A11. |
| `build/stage-b.mjs` | Steps B1 to B5. |
| `build/decisions.mjs` | The answer of the owner to each of the sixteen decisions. `lib.mjs` writes it as `ownerDecision` beside every `openDecision`. |
| `build/build.mjs` | Runs all of it and writes `gaps.json`. |

Some text in the data files is written in the scripts and not read from a source file: the
reasons of the two A5 cases that were not applied, the reasons of the lines left separate, the
four probable duplicates and the numbers of the sixteen decisions. Each of them is taken from
`stage-a-summary.md` or `stage-b-summary.md`. The answers of the owner are the one text that
no file of the repair holds. They are the owner's word of 2026-10-06 and stand in
`build/decisions.mjs`.
