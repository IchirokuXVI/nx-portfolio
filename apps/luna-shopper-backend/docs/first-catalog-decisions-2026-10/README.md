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
(`../../plans/0192-the-owners-decisions-on-the-first-catalog-applied.md`) applied them on
slot 1 the same day, in three stages. Section 5 says what each stage did, and the files
`c01-…json` to `c13-…json` hold it row by row. The catalog of slot 1 holds every answer that
section 4 marks as applied.

**On 2026-10-07 the owner asked for two more changes and gave two more answers.** The
Deza shop code `T7` got its shop, and the three shoe creams got their category. Both are
applied on slot 1, and new dumps were taken after them. The owner also said that the
El Jamón row "kiwis" is fine on "Kiwi verde", and that the other loose fruit rows wait for
a later fix. Section 4 holds the four answers, section 5 holds the two changes, and
`loose-fruit-rows.md` is the report of the rows that wait.

**Later on 2026-10-07 the owner gave the coordinates of the shop of `T7`,** read from
Google Maps. They are stored on slot 1, and the dumps were taken once more. Section 4
holds that fifth answer, and section 5 holds the write.

**Two data stages followed on 2026-10-07, and neither is a plan.** The re-file moved
2,250 products onto the leaves that plan `0179` added. The second curation walk then
decided 2,586 queue rows that the first walk could not place: 2,430 new products, 14
rows bound to a product that exists, and 142 rows left. The owner approved the walk that
day. The dumps were taken after it, at 12:28 Madrid time, and those are the dumps that
ship. Section 1 holds the rules of both stages, section 6 says what each did, and section
7 holds the nine decisions that the walk left for the owner. The files `d01-…json` to
`d06-…json` hold the rows.

The folder holds four things:

- This file: the rules, the decisions of each step, the sixteen decisions that the
  repair left, each with the answer of the owner, what plan `0192` did with each, and
  the two stages of 2026-10-07.
- [`loose-fruit-rows.md`](loose-fruit-rows.md): the loose fruit rows that still sit on a
  product that is not the singular fruit, for the fix that the owner put off.
- Thirty-five data files and `gaps.json`. Sixteen are the steps of plan `0186`
  (`a01-…json` to `b05-…json`). Thirteen are the work of plan `0192` (`c01-…json` to
  `c13-…json`). Six are the re-file and the second walk (`d01-…json` to `d06-…json`).
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
The key kept its name from the time the rows were open. No row is open now.

**The `a` and `b` files stay as plan `0186` wrote them.** Their `status` says what the
repair did, so a row that the owner decided later still reads "left" there, and decision 9
still reads "held". The `c` files say what plan `0192` then did with the same rows. Read
the `c` file of a decision after the `a` or `b` file that section 4 names for it.

**A `c` file keys a product as it stood at the start of the stage that changed it.** A
product that a stage created is keyed as the create answered it, with its English name and
its categories. `ownerAnswerAfterTheRegister` is an answer that the owner gave on
2026-10-06 after the sixteen answers, to a row that a stage had left.
`ownerAnswerOf20261007` is an answer of the next day, and only `c05` and `c13` hold one.
A shop is keyed by its chain, its address, its postal code and its OpenStreetMap
reference. The shop of `T7` was created by hand and has no reference.

**A `d` file holds a stage of 2026-10-07, and not every entry is a product.**

- `d01` holds rules. An entry names the leaf that a product is in, a test on its Spanish
  name, and the leaf it goes to. Apply a rule to every product that it fits.
- `d03` holds printed brands. An entry is keyed by the text that the chain printed and by
  its normalized key.
- `d02` keys a product, and `d04`, `d05` and `d06` key a queue row, as the other files do.
- Three records are too large for this folder: the 2,250 moves of the re-file, the 2,430
  products that the walk created, and the 579 printed texts that are not a brand. The
  `d` files hold their rules and their counts. `fullRecord` in the header of a file names
  the file of the run folder that holds each row.

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
| R32 | A printed size wins over a size worked out from a unit price. The El Pozo burger "king" prints 240 g, so it is 240 g, and the unit price that implies 260 g changes nothing. | The owner, 2026-10-06 (decision 10): "If it's printed at 240g, the size is 240g." Later the same day the owner used the rule again: Fanta naranja stays 1,500 ml. |
| R33 | Where a chain lists one fruit under a singular and a plural name, the singular product is the loose fruit sold by the kilo, and the plural product is the bag of the chain. A loose row of another chain goes on the singular product. A fixed bag of another chain is a product of its own. | The owner, 2026-10-06, after the test of decision 11 told no pair apart. It replaces the exception of R24. |
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
| R24 | Singular and plural of one loose vegetable or fruit, with no brand and sold by the kilo, are one product. The exception is a chain that lists both under two codes: then a person decides. | An agent proposed it. The session applied it. For the exception the owner gave a test on 2026-10-06 (decision 11), and then rule R33. |
| R25 | In a merge, the kept product is the one that holds the barcode or the price. | An agent. It is the choice in every merge of this repair. |
| R26 | What the container is (botellín, lata) stays in a name, because it tells a bottle from a can. | An agent (step A10) |
| R27 | An English name carries no brand and no size. A line word, a shade code and a proper name stay as printed. | The rules of the curation prompt, used by an agent (step A1) |
| R28 | The same size at another price in the same shops is another article of the chain. Such a row is never accepted onto the product as a second barcode. It gets a product of its own. | An agent (step B4). The owner confirmed it on 2026-10-06 (decision 2). |
| R29 | A candidate that matches by name and size across two brands is not accepted. | An agent (step B4). The owner confirmed it on 2026-10-06 (decision 7). |
| R30 | For one product stored by weight and by count, keep the product in grams or millilitres and put the count in the pack count. Merge only when the two names are the same word for word. | An agent (step B5, the Bref pair). On 2026-10-06 the owner widened the last sentence (decision 6): merge when the rows of both agree on count and weight. |
| R31 | A size that only price over unit price gives is not proof. Do not write it without a row that prints it. | An agent (steps A5 and B1). On 2026-10-06 the owner made one exception, for the 22 frozen fish products (decision 3). R32 holds for every other case. |

### Rules of the re-file (2026-10-07)

The session of stage c6 set these, after it read the names that each one matches. The
owner can change each one. `d01-refile-rules.json` holds every rule as data.

| # | Rule |
| --- | --- |
| R34 | A product leaves the leaf that stood in for a missing one and takes the leaf that plan `0179` added. It keeps every other category, and the new leaf takes the position of the old one. |
| R35 | A product that held two leaves which both stood in for the missing one loses both: a pet accessory under dog care and cat care, a sherry under white wine and vermouth. |
| R36 | The shelf of Mercadona names the make-up leaf. The Deza shelf "Color" holds every kind of make-up, and the shelf paths of El Jamón do not describe the product, so there the curated name decides. |
| R37 | Setting sprays and primers are "Bases y correctores". Bronzers and highlighters are "Polvos y colorete". A tinted lip balm or a lip oil with a shade number is "Labios". An eyelash curler is "Brochas y accesorios". Lip care stays in facial care. |
| R38 | A product that two leaves fit is left where it is, for a person. No rule moves a product on a guess. |

### Rules of the second walk (2026-10-07)

The session that prepared stage c7 wrote these into the prompt of the deciders. Each one
follows what the catalog already held. The owner approved the walk on 2026-10-07 and can
change each one. The first walk had no rule for these kinds of product, because the tree
had no leaf for them. The merge rules of the first walk still hold: same brand plus same
format merges, and a name never carries its brand or its size.

| # | Rule |
| --- | --- |
| R39 | **A book** is "Libro" plus its title, in sentence case with its accents ("Libro El asesinato de Aristóteles"). The English name is "Book" plus the same title, never translated. It has no brand, no size, `UNIT`, leaf `books`. The printed brand of a book row is its title. A number of a series stays in the title. Two rows with one title are one book. |
| R40 | **A book of a licence that the registry holds** carries the licence as its brand, and the rest of the title is the name: "Libro Abuelitas", brand `Bluey`. |
| R41 | **A magazine** carries its masthead as the brand. The name is "Revista" plus the edition word ("Revista Easy", brand `Burda`), and a plain issue is named "Revista" alone. When the masthead is not a brand of the registry, the product has no brand and the masthead stays in the name. The issue of the week is not a product. A special edition with its own name is. |
| R42 | **A collectible** is "Coleccionable" plus the name of the collection, with no brand. A year or an issue word that the row prints stays. A licence that the registry holds is the brand and leaves the name. |
| R43 | **A garment** holds, in its name, the garment, its model or material, who it is for, the colour and "talla X": "Braguita de algodón camel talla XXL". Each size and each colour is its own product. |
| R44 | Deza prints a clothing size as `t/` plus letters or digits. `t/sm` is "talla S/M". Four digits are a range of two sizes: `t/3538` is "talla 35-38". A size that cannot be read for sure is a `REVIEW` (`SIZE_UNREADABLE`). |
| R45 | **A count is a size in `UNIT`:** 3 pairs of socks, 80 sheets, 12 crayons, 6 plates. `20 den` is a variant word and stays in the name. The weight of paper (80 g) is never the size of the pack. |
| R46 | **A measure or a capacity is never the size.** The product is `UNIT` with no size. The measure goes at the end of both names, as the row prints it, when it tells two products apart: "Sábana bajera rosa 90 cm". The content of a pack is a size: 20 litres of substrate is 20000 `MILLILITER`. |
| R47 | **An artificial flower or plant always holds its printed height** at the end of both names: "Ramo artificial atado de rosas blanco 35 cm". The session added it to the answers that lacked it. |
| R48 | **Deza's lone letter "G" is its mark for a product with no brand.** It is never a brand and never part of a name. |
| R49 | A season word (`HALLOWEEN`, `NAVIDAD`, `CARNAVAL`) is never a brand. It stays in the name when the object is made for the season. A licensed character on merchandise is a brand when the registry holds it, and then it leaves the name. |
| R50 | "Colores surtidos" on one article that the shop sells in whatever colour it has is one product, and the words stay in the name. Two or three exact alternatives ("gris, negra o blanca") are several products: `REVIEW` (`SEVERAL_PRODUCTS`). |
| R51 | A colour printed with a slash on a product to create is a `REVIEW` (`SEVERAL_PRODUCTS`), because it may be a choice. A set that prints the colours of its pieces is one product. |
| R52 | A printed word that the registry holds as a brand of another kind of goods is a `REVIEW` (`BRAND_HOMONYM`). A person registers the second meaning. No agent does. |
| R53 | A link that the decider itself doubted becomes a `REVIEW` (`AMBIGUOUS_CANDIDATE`). A wrong link writes a price onto a real product. A doubted link with no price may stay. |
| R54 | A create sends every field of the product, also a field that is null. The route fills an absent field from the row, and on a kiosk row that is the title as the brand. |

## 2. Decisions taken

The counts are those of the data files. "Applied" means that the write was sent and read back.
This section holds the steps of plan `0186`. Section 5 holds the work of plan `0192`, and
section 6 holds the two stages of 2026-10-07.

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
| `c01` | 4 | 4 | 0 | None. |
| `c02` | 22 | 22 | 22 | None. |
| `c03` | 1 | 1 | 0 | None. The queue row is text in `why`. |
| `c04` | 19 | 18 | 0 | None. A brand is keyed by its label and its key. |
| `c05` | 13 | 0 | 0 | None. 11 shop codes, 10 shops and 1 discovered place, each with its address or its printed name. The last entry is the shop that was created by hand on 2026-10-07, with the coordinates that the owner gave later that day. |
| `c06` | 14 | 21 | 14 | None. |
| `c07` | 15 | 25 | 11 | None. |
| `c08` | 47 | 94 | 132 | None. |
| `c09` | 1 | 2 | 1 | None. |
| `c10` | 9 | 14 | 8 | None. |
| `c11` | 4 | 8 | 5 | None. |
| `c12` | 1 | 1 | 0 | None. The 20 offers are a count, and their scopes are not keyed. |
| `c13` | 7 | 7 | 0 | None. A category is keyed by its slug. |
| `d01` | 50 | 0 | 0 | None. An entry is a rule. The 2,250 products that the rules moved are not in the file. |
| `d02` | 92 | 92 | 0 | None. |
| `d03` | 50 | 0 | 0 | None. A printed brand is keyed by its text and its key. The 579 texts that are not a brand are a count. |
| `d04` | 25 | 0 | 25 | None. The 160 rows that took a height are a count for each batch. |
| `d05` | 142 | 0 | 142 | None. The 1,496 queue rows outside the walk are counts for each group of reason codes. |
| `d06` | 14 | 14 | 14 | None. The 2,430 products that the walk created are counts for each leaf and each batch. |

No product in any file carries only its uuid. In the `c` files and the `d` files no queue
row lacks its chain, its source kind, its external id or its printed name.

The three large records of 2026-10-07 need no read of a dump. They stand as files in the
run folder: `stage-c6/proposal/`, `stage-c7/applied/created.jsonl` and
`stage-c7/brands/skipped.jsonl`.

What one read of the kept dumps would add:

- The chain and the external id of the 4 rows of `a06` and the 2 rows of `a07`.
- The chain and the source kind of the 14 sibling rows of `b04`.
- The English name of each product before its change. The files hold the new English name only.
- The 729 other candidates of step A6, if somebody wants the pairs that were read as two
  products.

## 4. The sixteen decisions, and the answer of the owner

**The owner answered all sixteen on 2026-10-06.** The owner said that the recommendations
"are on point" and accepted each one as written, with two exceptions: decision 9 was held,
and decision 10 takes the printed size. Each recommendation is the one of the directing
session of 2026-10-06. Where the answer says "decided", the recommendation is the answer.

Plan `0192` applied the answers on 2026-10-06. The last column says what happened. The
stages left some rows, and the owner answered those rows later the same day. The second
table holds those answers.

| # | Question | Recommendation of the session | Answer of the owner | What plan `0192` did |
| --- | --- | --- | --- | --- |
| 1 | Revert Deza leaflet run `794056b6` and import the document again, to price the 21 offers by the kilo? | No. The leaflet is valid only until 2026-10-08, and a second import collides with the 8 rows the website run took over. The next leaflet goes through the fixed code. | Decided, 2026-10-06: no revert and no second import. | **Left by decision.** The 21 offers keep no price. |
| 2 | The 11 Mercadona rows plan 0186 called second barcodes | Each gets a product of its own, created from its row. Two containers of one milk or butter at two prices in the same shops are two products, told apart by the container in the name. The Coca-Cola "2 L" at 5.60 is a multipack and takes a pack count once its detail is read. | Decided, 2026-10-06: as recommended. | **Applied, stage 1.** 11 products created, and 4 old products renamed with their container. |
| 3 | 22 frozen fish and seafood products that are `KILOGRAM` with no size while the chain sells a fixed pack | Set `GRAM` with the weight that price over unit price gives, when it lands within 1 percent of a round pack weight. Leave the rest for a person. | Decided, 2026-10-06: as recommended. | **Applied in part, stage 1.** 21 products took a weight. The paella mix is left, and the owner then said that it stays without a size. |
| 4 | Ten Deza shop codes with no shop | Map the ten by their street names to the Deza shops of the catalog. Never map `CONSULTAR`. First confirm in code that a mapping publishes the waiting claims. | Decided, 2026-10-06: as recommended. | **Applied.** 10 codes mapped: 5 in stage 1, 4 in stage 3 and `T7` on 2026-10-07, to a shop that was created for it. `CONSULTAR` ignored. No code is unmapped. |
| 5 | 58 Deza products the second run did not see | Leave them. No write. | Decided, 2026-10-06: left. | **Left by decision.** |
| 6 | 47 pairs of one product stored by weight and by count | One reading pass that merges a pair only when the rows of both agree on count and weight. Keep the product in grams or millilitres and put the count in the pack count, as done for the Bref pair. | Decided, 2026-10-06: as recommended. | **Applied.** All 47 read. 4 merged: 2 in stage 2 and 2 in stage 3. 41 are two products. 2 are left by the owner's later answers. |
| 7 | 14 El Jamón candidates that match another brand by name and size | Reject each candidate. Bind the row to the product of its own brand when one exists, else create one from the row. | Decided, 2026-10-06: as recommended. | **Applied.** 7 rows accepted and 7 products created: 11 rows in stage 1 and 3 in stage 3. No candidate is left. |
| 8 | 4 products with no English name (Alteza "Besitos", Hidalgo "Negrito", "Negrito gigante", El Cateto "Panales de cabello sin azúcar") | Keep the three proper names as they are in English. "Sugar free angel hair pastries" for the fourth. | Decided, 2026-10-06: as recommended, and not the names that step A1 proposed. | **Applied, stage 1.** |
| 9 | Probable duplicates: Johnnie Walker Black Label 700 ml, Dewar's White Label 700 ml and 1 L, ProActiv margarine 225 g | Merge all four pairs. Move `d38b02dd` from Flora to ProActiv first. | First held, 2026-10-06: "Leave this one for now, I wanna check if they are actually duplicates". Then decided the same day: each pair is one product. | **Applied, stage 3.** 4 merges. `d38b02dd` moved to ProActiv and is named "Margarina original". |
| 10 | El Pozo burger "king" bound to the regular burger product | Create a product from row `67a821e4`, remove the 2.95 price row from the old product, size 260 g (price over unit price), low sureness on the size. | Decided, 2026-10-06, with another size: **240 g, as printed**. "If it's printed at 240g, the size is 240g." (rule R32). | **Applied, stage 2.** The row has a product of its own, 240 g. |
| 11 | Singular and plural fruit pairs (Aguacate, Kiwi verde, Manzana Golden, Manzana roja dulce) | The product whose Mercadona row is sold by weight is the loose fruit and takes every loose row of the other chains. The other is the bag and stays its own product with a size. Move El Jamón row `a90598fb` and the 1.5 kg Golden bag accordingly. | Decided, 2026-10-06: as recommended. The test told no pair apart, and the owner then gave rule R33. | **Applied, stage 3,** under rule R33. 2 rows moved and 1 product created. 5 loose rows on other products are left. On 2026-10-07 the owner said that they wait for a later fix (`loose-fruit-rows.md`). |
| 12 | Brand lines left separate (Nike Ultra Blue, Vileda Turbo, Vileda Duactiva, Nescafé Farmers Origins, Neutrex Transpirex, Lenor Unstoppables, Puleva Max) and the brand Invictus | Link the first six to their house with the word in the product name, after pointing the blocking spellings at the house. Puleva Max stays, like Hero Baby. Point `INVICTUS P.RABANNE` at Paco Rabanne, then link Invictus. Keep the five Oral-B, Vanish and Norit links an agent made. | Decided, 2026-10-06: as recommended. | **Applied, stage 1.** 9 names, 3 spellings pointed at their house, 7 links. |
| 13 | Charcoal "10l" and cat litter "8 L" stored as `MILLILITER` | Keep. The pack states its content by volume, and base units are the rule. | Decided, 2026-10-06: kept. | **Left by decision.** |
| 14 | Incarlopsa "Jamón serrano pieza" at 7500 `GRAM` against about 6.8 kg implied | `KILOGRAM` with no size if its row is sold by weight, as for the three Covap pieces. Else leave. | Decided, 2026-10-06: as recommended. | **Applied, stage 1.** `KILOGRAM` with no size. |
| 15 | Fanta naranja 1500 ml against a unit price that says 1.25 L | Leave until the next Mercadona run prints the size again. | Decided, 2026-10-06: left. | **Left by decision.** The run of 2026-10-06 printed 1.5 L again, and the owner then said that it stays 1,500 ml. |
| 16 | The F1 figurine shown available with no price in 20 El Jamón scopes | Wait for the code fix (a row that moves takes its offers with it), no manual write. | Decided, 2026-10-06: wait for plan `0191`. | **Applied, stage 2.** The settle route of plan `0191` removed the 20 offers. |

### The answers that came after the register was written

Each line below was decided by the owner on 2026-10-06, after the sixteen answers and
after a stage of plan `0192` had left the row. `build/decisions.mjs` holds each one, and
the build writes it into the `c` files as `ownerAnswerAfterTheRegister`.

| Decision | Answer of the owner, 2026-10-06 | Where it stands |
| ---: | --- | --- |
| 9 | The four probable duplicates are each one product. Merge them, with the names of the pair as the product names. | `c11`, 4 merges |
| 4 | The Deza code `C1` is the shop at Imprenta de la Alborada 116, `Z1` the shop at José María Martorell, and `C2` the shop at Libertador Sucre 38. | `c05`, 3 mappings |
| 4 | A store discovery for `T2` and `T7`. | `c05`: the run, 1 shop imported, `T2` mapped, `T7` left |
| 4 | The 55,005 offers with no price that the mappings of stage 1 wrote stay. The mappings of stage 3 wrote more, and they stay too. | Section 5 |
| 7 | Pata Negra verdejo and Campofrío frankfurt each get a product of their own. | `c06`, 2 creates |
| 7 | The Coren row is accepted onto the Coren product, and that product is renamed "Albóndigas de pollo". | `c06`, 1 accept |
| 6 | The two Tassimo and Marcilla pairs merge, with "Marcilla" in the name. | `c08`, pairs 40 and 43 |
| 6 | The Nescafé vanilla pair stays two products. | `c08`, pair 37 |
| 6 | The Bref pair waits for a barcode. | `c08`, pair 3 |
| 11 | The singular fruit name is the loose fruit, and the plural is the bag (rule R33). The 1.5 kg Golden bag is a product of its own. | `c10` |
| 3 | The paella mix stays without a size. | `c02`, 1 entry left |
| 2 | The candle of 1 unit stays. | `c07` |
| 2 | The Coca-Cola packs stay as pack count 4. | `c07` |
| 15 | Fanta naranja stays 1,500 ml. A printed size wins (rule R32). | No write |

### The answers of 2026-10-07

Each line below was decided by the owner on 2026-10-07, after the final dumps of plan
`0192` were taken. `build/decisions.mjs` holds each one. The build writes the first two
into `c05` and `c13` as `ownerAnswerOf20261007`. The next two changed no data, so no data
file holds them. The last line came after the dumps of 00:33 of that day. The build writes
it into the entry of the shop in `c05`, under `coordinates`.

| Decision | Answer of the owner, 2026-10-07 | Where it stands |
| ---: | --- | --- |
| 4 | The shop of the Deza code `T7` "Fuente de la salud" is the one on the page of the chain, `https://www.dezacalidad.es/centros/avda-virgen-de-las-angustias/`. The page says "Tienda 7 - Supermercado Deza Calidad SA en Calle Acera Fuente de la Salud, 14006 - Córdoba". | `c05`: 1 shop created by hand, `T7` mapped to it. Applied on 2026-10-07 |
| None | The three Búfalo shoe creams go into the leaf "Cuidado del calzado" (`shoe-care`). No category is created. | `c13`, 3 entries. Applied on 2026-10-07 |
| 11 | The El Jamón row "kiwis" on "Kiwi verde" is fine. | `c10`, the second entry. No write |
| 11 | The loose fruit rows that sit on other products are left for now. They are fixed another time, and a small report of them is saved. | `loose-fruit-rows.md`. No write |
| 4 | The coordinates of the shop of `T7` are 37.89862387806124, -4.772603355414682. The owner read them from Google Maps. | `c05`, the last entry. Applied on 2026-10-07, in one write |

What was found when the recommendations were written, before plan `0192`:

- **Decision 4.** The condition is met. `SourceLocationService.map` publishes the stored
  claims of a shop in the same request (`PUT /v1/admin/harvest/shops/:id/location`), and
  `POST /v1/admin/harvest/shops/:id/ignore` dismisses `CONSULTAR`. Plan `0192` then
  confirmed the rest: each mapping answered 200 in 21 to 24 seconds.
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
- **Decision 11.** Both Mercadona rows of each of the four pairs are sold by weight. The
  test of the answer then tells no pair apart. The owner gave rule R33 in its place.

Where each one stands in the data, and in plan `0192`:

| # | Data of plan `0186` | Data of plan `0192` | Plan `0192` |
| --- | --- | --- | --- |
| 1 | `b01`, the 21 entries with `openDecision` 1 | None | Not done, section 6 |
| 2 | `b04`, the 11 Mercadona entries | `c07-mercadona-candidates.json` | Stage 1, section 2.7 |
| 3 | `b01`, the 22 entries with `gramsThatPriceOverUnitPriceGives` | `c02-frozen-fish.json` | Stage 1, section 2.2 |
| 4 | `b02`, the 11 `shopCode` entries | `c05-deza-shop-codes.json` | Stage 1, section 2.5, and stage 3. `T7` on 2026-10-07, after the plan |
| 5 | `b02`, the 58 product entries | None | Not done, section 6 |
| 6 | `b05`, the 47 entries with `decision` "no merge" | `c08-grams-and-units.json` | Stage 1, section 2.8, then stages 2 and 3 |
| 7 | `b04`, the 14 El Jamón entries | `c06-el-jamon-candidates.json` | Stage 1, section 2.6, and stage 3 |
| 8 | `a01`, the 4 entries marked low | `c01-english-names.json` | Stage 1, section 2.1 |
| 9 | `a11`, the 4 entries with `decision` "no merge" | `c11-probable-duplicates.json` | Stage 3, after the owner lifted the hold |
| 10 | `a05`, El Pozo "Burger de pavo con espinacas bienStar" | `c09-the-burger-king.json` | Stage 2, section 3.1 |
| 11 | `a06`, the 4 pairs left for a person, and `b01`, "Manzanas Golden" | `c10-fruit-pairs.json` | Stage 3, under rule R33 |
| 12 | `a11`: `linesLeftSeparate` in the header, the refused Invictus link, and the five links marked as agent judgement | `c04-brand-lines.json` | Stage 1, section 2.4 |
| 13 | `a03`, "Carbón vegetal" and "Lecho higiénico Vegetal Clean" | None | Not done, section 6 |
| 14 | `a03`, "Jamón serrano pieza" | `c03-the-ham-piece.json` | Stage 1, section 2.3 |
| 15 | `a05`, Fanta "Refresco de naranja" | None | Not done, section 6 |
| 16 | `a07`, the first entry | `c12-the-f1-figurine.json` | Stage 2 |

`c13-categories.json` belongs to no decision. It holds the categories of the products
that plan `0192` created with none, and the category that the owner named on 2026-10-07
for the three shoe creams.

## 5. Applied by plan 0192 (2026-10-06), and the two changes of 2026-10-07

Plan `0192` changed data on slot 1 only, through the gateway of slot 1 as
`admin@curation.local`. No SQL write was made. The work ran in four sessions on 2026-10-06,
each with a backup before its first write and dumps at its end. The files of each session
stand in the run folder, and each folder has a `summary.md`. A fifth session made the two
changes of 2026-10-07 the same way. Its folder has no `summary.md`. A sixth session, later
that day, stored the coordinates of the shop of `T7` and took the dumps that ship. Its
folder has no `summary.md` either.

| Session | Folder of the run folder | Writes through the gateway |
| --- | --- | ---: |
| The Mercadona run after plan `0189` | `after-0189/` | 2 |
| Stage 1 | `stage-c1/` | 43 |
| Stage 2 | `stage-c2/` | 6, and 4 dry runs of the settle route |
| The last decisions and the dumps of 2026-10-06 (stage 3) | `stage-c3/` | 32 |
| The two changes of 2026-10-07 | `stage-c4/` | 3 |
| The coordinates of the shop of `T7` and the dumps that ship | `stage-c5/` | 1 |

Three code plans landed before or between the sessions, and each changed the data:

- **Plan `0189`** (a unit price label names what the figure is) needed a new Mercadona run.
- **Plan `0190`** (a price keeps the kind of the source that stated it) added the harvester
  migration `SourceEntryPriceKind1759200000000`. It ran at the start of stage 1.
- **Plan `0191`** (a row that leaves a product takes its offers with it) gave the settle
  that stages 2 and 3 relied on.

### The Mercadona run after plan 0189

No decision of the owner, so no data file. The run is in `after-0189/summary.md`.

- Run `c6662e9c-b66d-4fad-aeff-5850989ed845`, a `CATALOG_DISCOVERY` of the three Córdoba
  scopes with `details: "ALL"`. It ran for 10 minutes and 16 seconds and ended `COMPLETED`
  with 0 failed.
- The Mercadona source now has 8 workers and 8 requests per second. It had 4 and 4.
- Current price rows with an old label fell from 1,595 to 87: `100 ml` 1,206 to 54,
  `100 g` 292 to 17, `lv` 70 to 16, `dc` 24 to 0, `dz` 3 to 0. History keeps the old rows.
- The run wrote 1,544 price rows. 1,508 rows on 509 products differ only in the label. 36
  rows on 12 products are real price changes.
- The 87 rows that stayed are on 33 products. 79 rows on 27 products were seen by the run,
  and their figure is not a price per litre or kilo (a nail polish at the bottle price,
  tablets per piece, washes). 8 rows on 6 products were not seen in that scope.
- It found 5 new queue rows, all `UNRESOLVED`. No product changed.
- The Fanta naranja row still prints 1.5 L at 1.55 and 1.24 per litre (decision 15).

### Stage 1

| Decision | Step | Applied | Left |
| ---: | --- | --- | --- |
| 8 | English names | 4 names | None |
| 3 | Frozen fish | 21 products to `GRAM` | The paella mix: 680 g and 690 g both fit 684.9 g |
| 14 | The Incarlopsa ham piece | `KILOGRAM` with no size | None |
| 12 | Brand lines | 9 names, 3 spellings pointed at their house, 7 links | None |
| 4 | Deza shop codes | `T1`, `T3`, `T4`, `T5` and `T6` mapped, `CONSULTAR` ignored | `T2`, `T7`, `C1`, `C2` and `Z1` |
| 7 | El Jamón candidates | 6 accepts and 5 creates | 3 rows: Pata Negra verdejo, Campofrío frankfurt, Coren albóndigas de pollo |
| 2 | Mercadona candidates | 11 creates, and 4 old products renamed | None |
| 6 | The 47 pairs | Read only. 2 merges proposed | 45 pairs, of which 4 were for a person |

- **The shops.** The catalog held eight Deza shops, not ten. Each mapping answered 200 in
  21 to 24 seconds and wrote 11,089 shop rows. `supermarket_location_items` went from 0 to
  55,445.
- **A side effect of a mapping.** The `STORE` scope of each mapped shop went from 108
  offers to 11,109. The five mappings wrote 55,005 offers with no price. The owner said
  later that they stay.
- **The Mercadona creates.** The container or the count was read from the stored link of
  each row, not from a product detail. The candle was created as 1 `UNIT` beside the
  product of 18. The two Coca Cola packs are 2000 ml with pack count 4, and their names
  hold no container.
- **16 products created:** 5 from El Jamón rows and 11 from Mercadona rows. 6 of them had
  no category at the end of the stage: the 5 El Jamón creates and the candle.
- **No merge, no delete, no reject and no settle call.** Stage 1 moved no bound row.

### Stage 2

- **Decision 10, the El Pozo burger "king".** Row `67a821e4` left the regular burger and
  got a product of its own: "Burger de pavo con espinacas King", 240 `GRAM`. The settle
  inside the create took the 2.95 price off the old product and wrote its 2.45 again.
- **Decision 6, two merges.** Nescafé "Café soluble cappuccino Gold" and its decaffeinated
  twin each took the El Jamón row of the product stored by count. The settle inside each
  accept emptied the old product (1 price, 20 offers), so each delete removed a bare
  product.
- **Decision 16, the F1 figurine.** A dry run of the settle route answered 20 El Jamón
  offers to remove and nothing else. The call then ran. A second dry run found nothing.

### The last decisions and the final dumps (stage 3)

- **Decision 9.** Four merges. Kept: Johnnie Walker "Whisky escocés Black Label", Dewar's
  "Whisky escocés White Label" at 700 ml and at 1 L, and the margarine `d38b02dd`, which
  moved from Flora to ProActiv and is named "Margarina original". No price cascaded.
- **Decision 4.** `C1`, `Z1` and `C2` mapped to the shops that the owner named. One
  `STORE_DISCOVERY` run (`c5696c38`, 10 km around postal code 14005) met 85 places and no
  new one. The Deza place at Carretera de Castro 42 was imported as a shop, and `T2` mapped
  to it. Each of the four mappings wrote 11,089 shop rows.
- **`T7` "Fuente de la salud" stays unmapped.** OpenStreetMap holds no Deza there.
  (Note of 2026-10-07: the code is mapped now. See "The two changes of 2026-10-07".)
- **Decision 7.** Pata Negra "Vino blanco verdejo D.O. Rueda" and Campofrío "Salchichas
  Frankfurt" (4 `UNIT`, pack 4) were created. The Coren row was accepted onto the Coren
  product, now named "Albóndigas de pollo". No row is `CANDIDATE`.
- **Decision 6.** The two Tassimo pairs merged. The kept products are named "Café en
  cápsulas Marcilla espresso" and "Café en cápsulas Marcilla con leche".
- **Decision 11.** The El Jamón rows "aguacates" and "kiwis" moved to the singular
  products. The 1.5 kg Golden bag got the product "Manzanas Golden en bolsa", 1500 `GRAM`.
  The red apple pair had no row to move.
- **Categories.** The Mahou pack, the Despecho wine, the candle and the burger "king" took
  the categories of a sibling. The three Búfalo shoe creams stay `uncategorised`. (Note
  of 2026-10-07: they are in the leaf `shoe-care` now.)
- **The dumps of stage 3** were taken at 2026-10-06T21:12:47Z, with every service that
  holds a database stopped. (Note of 2026-10-07: they no longer ship.
  `k8s/catalog-import/first-catalog.manifest` holds the values of the dumps of the last
  session.)

### The two changes of 2026-10-07

The owner asked for both on 2026-10-07. The files of the session stamp their times in
UTC, so they read 2026-10-06T22:24Z to 22:34Z, which is after midnight in Madrid.

- **The shop of `T7`.** The owner gave the page of the chain for the code "Fuente de la
  salud". Shop `dcb350bf-f135-4f2e-8ef2-bec9fd6044fd` was created through the gateway:
  address "Calle Acera Fuente de la Salud", postal code 14006, Córdoba. The postal code
  source is `MANUAL`. The shop has no external provider. It was created with no
  coordinates: Nominatim answered an empty list for the street in two queries. The owner
  gave them later that day, and the next part holds that write. The create made the
  `STORE` price scope of the shop, `d0311048`.
- **The mapping.** `T7` was then mapped to the shop. The call answered 200 in 23 seconds
  and wrote 11,089 shop rows, one for each product that a bound row with a claim names.
  7,435 of them say that the shop stocks the product.
- **The offers.** `supermarket_items` went from 294,109 to 305,218. The new scope held 108
  offers after the create, as each Deza `STORE` scope did before its mapping. The mapping
  wrote 11,001 more. Offers with no price went from 110,305 to 121,327. No price row
  changed: `item_prices` is 24,964 before and after.
- **The shoe creams.** Búfalo "Crema calzado color blanco" (`74bdc211`), "color marrón"
  (`e8f102a7`) and "color negro" (`c8ad0b91`) went from `uncategorised` to the leaf
  `shoe-care`, "Cuidado del calzado", in one batch. The leaf existed and held no product.
  No category was created: `categories` is 309 before and after.
- **The batch left no trace.** `catalog_audit` grew by 22,094 rows in the session, and all
  of them belong to the shop and its mapping. No row names `items`. The `updatedAt` of the
  three products is the same before and after the batch.
- **No product and no queue row changed.** The snapshots of the start and of the end of
  the session hold the same 19,773 products and the same 25,861 queue rows, field by
  field. A snapshot of a product holds no category, so the batch does not show there.
- **The dumps of this session** were taken at 2026-10-06T22:33:14Z (2026-10-07 00:33
  Madrid time), with every service that holds a database stopped. They no longer ship. The
  next part names the dumps that do.
- **The owner's check.** On 2026-10-07 the dumps of this session were restored onto the
  owner's own slot 0, so that the owner can check the data.

### The coordinates of the shop of `T7`, and the dumps that ship

> **Note of 2026-10-07, after the second walk.** The dumps of this part no longer ship.
> The dumps of 12:28 of that day do, and section 6 names them. The text below stays as it
> was written.

The owner gave the coordinates on 2026-10-07, after the dumps of 00:33: latitude
37.89862387806124 and longitude -4.772603355414682, read from Google Maps. The files of
the session read 2026-10-06T23:30Z to 23:35Z, which is 01:30 to 01:35 in Madrid.

- **The point was checked before the write.** It lies 672 m from the Deza shop at Avenida
  Ronda del Marrubial, 1,297 m from the one at Avenida Jesús Rescatado 15 and 1,617 m from
  the one at Avenida de Libia. The farthest of the nine other Deza shops is 4,516 m away.
- **One write.** `PATCH /v1/admin/catalog/locations/dcb350bf-f135-4f2e-8ef2-bec9fd6044fd`
  with the latitude and the longitude, and no other field. It answered 200. Both columns
  are `double precision`, and they hold the two values digit for digit.
- **Nothing else changed on the shop.** The address, the city, the postal code 14006 and
  its source `MANUAL` are as they were. The shop still has no external provider. Its
  stack is still the one `STORE` scope `d0311048`, and `T7` is still mapped to it.
- **Nothing else changed in the catalog.** `catalog_audit` grew by one row, from 292,079
  to 292,080: an `UPDATE` of `supermarket_locations` by the admin, from no coordinates to
  these. The other 41 shop rows are the same, field by field. The counts of shops, price
  scopes, offers, shop rows, price rows, products and queue rows are the same. All 42 shops
  hold coordinates now.
- **The dumps that ship** were taken at 2026-10-06T23:32:21Z (2026-10-07 01:32 Madrid
  time), with every service that holds a database stopped.
  `k8s/catalog-import/first-catalog.manifest` holds their values. Read as SQL, the catalog
  dump differs from the one of 00:33 in the row of the shop and in the one audit row. The
  harvester dump holds the same rows as the one of 00:33.
- **The owner has not said that slot 1 is final.** The copy on the owner's slot 0 is the
  restore of the dumps of 00:33. It holds no coordinates for this shop, and it lacks the
  audit row of the write. Nothing is uploaded.

### The counts, session by session

| | End of plan `0186` | After the Mercadona run | End of stage 1 | End of stage 2 | The dumps of 2026-10-06 | The dumps of 2026-10-07, which ship |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Products (`items`) | 19,761 | 19,761 | 19,777 | 19,776 | 19,773 | 19,773 |
| Brands | 2,782 | 2,782 | 2,782 | 2,782 | 2,782 | 2,782 |
| Brands that are a spelling | 499 | 499 | 506 | 506 | 506 | 506 |
| Price rows (`item_prices`) | 23,374 | 24,918 | 24,961 | 24,961 | 24,964 | 24,964 |
| Offers (`supermarket_items`) | 194,571 | 194,571 | 249,937 | 249,937 | 294,109 | 305,218 |
| Shop rows (`supermarket_location_items`) | 0 | 0 | 55,445 | 55,445 | 99,801 | 110,890 |
| Barcodes (`item_eans`) | 3,979 | 3,979 | 3,990 | 3,990 | 3,990 | 3,990 |
| Queue rows | 25,856 | 25,861 | 25,861 | 25,861 | 25,861 | 25,861 |
| Queue rows `ACTIVE` | 21,754 | 21,754 | 21,776 | 21,776 | 21,779 | 21,779 |
| Queue rows `CANDIDATE` | 25 | 25 | 3 | 3 | 0 | 0 |
| Queue rows `UNRESOLVED` | 4,077 | 4,082 | 4,082 | 4,082 | 4,082 | 4,082 |
| Deza shop codes mapped, ignored, unmapped | 0, 0, 11 | 0, 0, 11 | 5, 1, 5 | 5, 1, 5 | 9, 1, 1 | 10, 1, 0 |
| Harvest runs | 13 | 14 | 14 | 14 | 15 | 15 |

The products add up: 16 creates in stage 1, 1 create and 2 merges in stage 2, 3 creates
and 6 merges in stage 3. The two sessions of 2026-10-07 created and merged none.

The last column holds for both pairs of dumps of 2026-10-07. The coordinates of the shop
of `T7` changed no count of this table, so the dumps of 00:33 and the dumps of 01:32,
which ship, hold the same figures.

The shop of `T7` took the shops (`supermarket_locations`) from 41 to 42 and the price
scopes from 104 to 105. Ten of the 42 shops are Deza shops.

**Note of 2026-10-07, after the second walk:** the last column no longer holds the dumps
that ship. Section 6 holds the counts of the dumps of 12:28, under "The counts of both
stages".

### What stays left, and why

Two rows left this table on 2026-10-07: `T7` has its shop, and the three shoe creams have
their category. The shop of `T7` was created with no coordinates. The owner decided them
the same day, from Google Maps, and they are stored. No row stands here for them.

| What | Why | Data |
| --- | --- | --- |
| The paella mix is `KILOGRAM` with no size | Two round weights fit. The owner: it stays without a size | `c02` |
| The Nescafé vanilla pair | "latte" against "cappuccino". The owner: two products | `c08`, pair 37 |
| The Bref "Blue Activ" pair | The owner: it waits for a barcode | `c08`, pair 3 |
| 41 other pairs by weight and by count | Two products each | `c08` |
| 5 loose fruit rows on products that are not the singular fruit | Each names a variety, an origin or a size. The owner, 2026-10-07: they are left for now and fixed another time | `c10`, and `loose-fruit-rows.md` |
| The 21 Deza leaflet offers by the kilo | Decision 1: no revert, no second import | `b01` |
| The 58 Deza products the second run did not see | Decision 5 | `b02` |
| The charcoal and the cat litter in `MILLILITER` | Decision 13 | `a03` |
| Fanta naranja at 1,500 ml | Decision 15, and rule R32 | `a05` |

The report, `../initial-catalog-2026-10.md`, holds the full list of what stays wrong or
open, under "The owner's decisions applied (plan 0192, 2026-10-06)".

## 6. The re-file and the second walk (2026-10-07)

Both stages changed data on slot 1 only, through the gateway of slot 1 as
`admin@curation.local`. No SQL write was made. Each took a backup before its first
write. Their files stand in `stage-c6/` and `stage-c7/` of the run folder. The report,
`../initial-catalog-2026-10.md`, holds both under "The re-file and the second walk
(2026-10-07)".

### The re-file (stage c6)

Plan `0179` added 34 categories on 2026-10-05. The products that belong on them had
been filed on the nearest leaf that existed, or on `uncategorised`. The re-file moved
them.

- **2,250 products moved onto 23 leaves,** in four calls of
  `PATCH /v1/admin/catalog/items/batch`. Each answered 200 at the first try.
- **1,850 left `facial-care`** for the six make-up leaves, and 9 more reached those
  leaves from `dyes`, `parapharmacy` and `shower-gel-and-sponges`. `facial-care` went
  from 2,346 products to 496.
- **The 31 products of `uncategorised` all moved:** 10 books, 9 magazines and
  collectibles, 5 decoration products, 3 toys, 3 pencil cases and 1 graduation cap.
- **The other 360** are pet accessories (68), lighting and electrical (67), small
  appliances (52), sherry and sweet wines (50), party (34), car care (32), premixed
  drinks (16), DIY (15), hair accessories (12), shoe care (5), home textiles (4), storage
  (3) and decoration (2).
- **92 products were left for a person,** each with its reason. Nothing was sent for
  them.
- **Nothing else changed.** No name, brand, size or bound row of a product differs. Only
  `item_categories` changed: 21,707 rows to 21,660, because 47 products lost two leaves
  for one. The route writes no audit row, so `catalog_audit` is the same.
- Data: `d01-refile-rules.json` (rules R34 to R37, as 50 rules with their counts) and
  `d02-refile-left-for-a-person.json` (rule R38, 92 products).

### The second walk (stage c7)

The queue held 4,082 rows, all `UNRESOLVED`. 2,586 of them were in the walk:

| Group | Rows | What it is |
| ---: | ---: | --- |
| 1 | 1,072 | The driver of the first walk skipped the row with no model call, because its section had no category |
| 2 | 1,379 | A decider of the first walk left the row with `NO_CATEGORY` |
| 3 | 135 | The row was first seen on 2026-10-05 or 2026-10-06, after the first walk |

2,515 rows are of Deza, 42 of El Jamón and 29 of Mercadona. The other 1,496 queue rows
were not in the walk, because a new category does not answer their reason.

**The order of the work.** Blind brand deciders answered nine packets, which hold the 629
printed brands that the registry did not hold. Blind product deciders (Opus) then
answered 26 batches of about 100 rows each. A decider read its prompt, the category list
and its packet, and called no service. An offline check read every answer. The session
then corrected the answers, sent the brands, and sent one request for each batch. The
files of the stage do not name the model. "Opus" is the word of the session that directed
the walk.

**The brands** (`d03-second-walk-brands.json`).

- 26 answers `REGISTER` and 15 answers `SPELLING_OF` were sent, in 41 requests. All
  answered 201. The registry went from 2,782 rows to 2,830: 26 brands and 22 spellings.
  Seven registered brands print a text whose key is not the key of the label, so the
  printed text became a spelling too.
- 579 printed texts are not a brand. 303 of them are book titles.
- 9 answers are `REVIEW`. **The session changed seven of them from `REGISTER`** before
  anything was sent, each for a reason that stands in the file:
  - `AR`: two letters on unrelated goods, and the maker is not confirmed.
  - `MAS` and `PIN`: a fragment of a masthead ("Más y Más", "Pin y Pon"). So short a key
    would name many other rows.
  - `ARQUITECTURA`: a fragment of "Arquitectura y Diseño", and a generic word as the key.
  - `BRAINROT` and `COCHES`: the masthead is not confirmed.
  - `SABER VIVIR MUY`: the row may be a pack of two magazines.
- The answer of the decider stands beside each of the seven, as `answerOfTheDecider`.

**The corrections before the batches were sent** (`d04-second-walk-corrections.json`).
No answer file was edited. Each correction stands in a final file beside it.

| Correction | Rows | What was done |
| --- | ---: | --- |
| 1, an artificial flower or plant with no height in its name | 160 | The printed height was added to both names (R47). 173 other rows already held it |
| 1, a garbled measure (`1416 cm`, `1114 cm`) | 2 | `CREATE` became `REVIEW` `SIZE_UNREADABLE` |
| 2, a colour with a slash on a `CREATE` | 9 | `CREATE` became `REVIEW` `SEVERAL_PRODUCTS` (R51) |
| 2, a pen set that prints the colours it holds | 2 | Left |
| 3, a `LINK` that the decider itself doubted | 2 | `LINK` became `REVIEW` `AMBIGUOUS_CANDIDATE` (R53) |
| 3, a magazine promotion row with no price | 3 | Left: bound to the magazine that the same batch created |
| 4, the brand `Golden` on stationery and a mirror | 7 | `CREATE` became `REVIEW` `BRAND_HOMONYM` (R52). The registry brand holds one coaster |
| 5, a `CREATE` that the live catalog already held | 0 | Checked before each batch. None was found |
| Two `CREATE`s of two batches that are equal | 0 | Checked after the heights were added. None was found |
| 6, the lone letter "G" as a brand or in a name | 0 | No answer writes it (R48) |

The brand check of correction 4 read every `CREATE` that writes a brand which the
registry held before the walk: 200 brands. 57 are mastheads, and 50 of those hold no
product outside the kiosk. 28 other brands hold products only in leaves that the walk
does not write for them. Only `Golden` was changed. The other 27 were left, each for a
reason that the data shows: a licence on merchandise, a pet brand with a new kind of
animal, or a maker that sells across shelves.

**The result.**

- The answers held 2,448 `CREATE`, 16 `LINK` and 122 `REVIEW`. After the corrections
  they held 2,430, 14 and 142.
- 27 requests to `POST /v1/admin/harvest/entries/decisions`, one for each batch and one
  small first request of six rows. Each answered 201 at the first try.
- **2,430 products were created.** 1,325 carry a brand and 1,105 carry none. 87 sit in
  two leaves. Each created product was read back and compared with what was sent, and
  none differs. `d06-second-walk-links.json` holds the count for each leaf.
- **14 rows were accepted onto a product** (`d06`): 6 onto a product of their own batch,
  and 8 onto a product from before the walk.
- **142 rows stay in the queue** (`d05-second-walk-left-in-the-queue.json`): 122 by the
  answer of a decider and 20 by a correction.
- **One product from before the walk changed, in its barcode only.** Dove "Desodorante en
  crema original" now holds the barcode `80466468`, which the Mercadona row that was
  accepted onto it prints (plan `0185`).
- 110 price rows were written, on 72 products. Deza's website prints no price, so most
  products of the walk have an offer with no price.

### The counts of both stages

| | Before the re-file | After the re-file | The dumps of 12:28, which ship |
| --- | ---: | ---: | ---: |
| Products (`items`) | 19,773 | 19,773 | 22,203 |
| Brands | 2,782 | 2,782 | 2,830 |
| Brands that are a spelling | 506 | 506 | 528 |
| Rows of `item_categories` | 21,707 | 21,660 | 24,177 |
| Price rows (`item_prices`) | 24,964 | 24,964 | 25,074 |
| Offers (`supermarket_items`) | 305,218 | 305,218 | 330,733 |
| Shop rows (`supermarket_location_items`) | 110,890 | 110,890 | 132,890 |
| Barcodes (`item_eans`) | 3,990 | 3,990 | 4,013 |
| Queue rows | 25,861 | 25,861 | 25,861 |
| Queue rows `ACTIVE` | 21,779 | 21,779 | 24,223 |
| Queue rows `UNRESOLVED` | 4,082 | 4,082 | 1,638 |
| Products in `facial-care` | 2,346 | 496 | 497 |
| Products in `uncategorised` | 31 | 0 | 0 |
| Leaves with no product, `uncategorised` not counted | 29 | 7 | 0 |

The first column is the state of the dumps of 01:32 of 2026-10-07. The categories (309),
the price scopes (105), the shops (42) and the chains (5) are the same in all three.

### What stays in the queue

1,638 rows are `UNRESOLVED`, and none is `CANDIDATE`: 900 of Deza, 565 of El Jamón, 130
of Mercadona and 43 of Lidl.

**The 142 rows of the walk,** by reason code (`d05`):

| Code | Rows |
| --- | ---: |
| `PRODUCT_UNCLEAR` | 35 |
| `SEVERAL_PRODUCTS` | 23 |
| `BRAND_UNKNOWN` | 21 |
| `NO_CATEGORY` | 16 |
| `POSSIBLE_DUPLICATE` | 10 |
| `SIZE_UNREADABLE` | 10 |
| `BRAND_HOMONYM` | 9 |
| `OTHER` | 7 |
| `FORMAT_UNKNOWN` | 6 |
| `AMBIGUOUS_CANDIDATE` | 3 |
| `MULTIPACK_SIZE` | 2 |

**The 1,496 rows outside the walk.** Each kept the reason of the first walk. The first
walk wrote 129 different codes on them, so the build puts each code in one of five groups
by the words of the code. `OUTSIDE_GROUPS` in `build/stage-d.mjs` is the rule, and the header of
`d05` holds the largest codes of each group.

| Group | Rows | The largest codes |
| --- | ---: | --- |
| Unreadable size | 593 | `FORMAT_UNKNOWN` 224, `MULTIPACK_SIZE` 114 |
| Unknown brand | 432 | `BRAND_UNREGISTERED` 243, `BRAND_UNKNOWN` 45, `BRAND_UNCLEAR` 43 |
| Unsure match | 253 | `POSSIBLE_DUPLICATE` 84, `SHARED_EAN` 48, `AMBIGUOUS` 30 |
| Unclear | 142 | `PRODUCT_UNCLEAR` 45, `VARIANT_UNKNOWN` 17 |
| Several products | 76 | `SEVERAL_PRODUCTS` 46, `GIFT_SET` 17 |

A new walk does not help these rows. Each needs a person, a brand in the registry, or a
source that prints the size.

## 7. The decisions that the second walk left

Nobody has answered these. The session of stage c7 wrote them for the owner. A repeat of
the curation meets each of them again.

| # | Question | Where it stands |
| ---: | --- | --- |
| 1 | **Golden.** The registry brand holds one coaster. Seven rows print the word on drawing blocks, coloured paper, a note block and a mirror. Register a second brand for the printed key (`POST /v1/admin/catalog/brands/:id/homonyms`), or say that both are one brand and create the rows under it? | `d04`, the 7 entries of `C4_BRAND_HOMONYM`. In the queue |
| 2 | **Eden.** 16 shoe care products "EDEN Natural Comfort" were created under the brand that held one product, "Discos de gel para WC". Deza prints both on one shelf, so they were read as one supplier. If they are two businesses, the 16 need a brand of their own. | Applied. Not in a data file: the 16 are among the 44 creates of `shoe-care` |
| 3 | **Two tones, or a choice.** The buddha head "blanco/oro" and the two ficus leaves "verde/amarilla" and "verde/blanca" are probably one article each. The six slippers with two colours can be either. | `d04`, the 9 entries of `C2_SEVERAL_PRODUCTS`. In the queue |
| 4 | **Brands that wait for a person.** The magazine `Pronto` and the lantern `RAM` are homonyms of a registered brand. Seven mastheads have no brand: Arquitectura y Diseño, Brainrot, Coches, Cocina cada día con alma, Más y Más, Pin y Pon and Saber Vivir. The mark `AR` stands on six rows (rugs, doormats, shoe trees and an umbrella). Each needs a brand or a homonym in the registry. | `d03`, the 9 entries of `REVIEW`. `d05`, the rows with `BRAND_UNKNOWN` and `BRAND_HOMONYM` |
| 5 | **The rows marked "G"** that the deciders could not name: "Globos fiesta G surtidos", "Inflador de globos G manual" and "Regla de aluminio G". | `d05`. They wait for a later walk |
| 6 | **The Dove deodorant** holds the Mercadona barcode `80466468` since the walk. An accept teaches the barcode of its row to the product, and the link had a confidence of 0.95. Is the barcode right on that product? | `d06`, the entry with `barcodeTaughtToTheProduct` |
| 7 | **Names are not uniform across batches.** The English name of an artificial bouquet puts the colour first in two batches ("White artificial ... bouquet 43 cm") and last in one ("Artificial ... bouquet white 46 cm"). The tea colour is "color té" in three batches and "té" in one. No rule of the walk makes them one. | Applied as the deciders wrote them |
| 8 | **The 92 products that the re-file left.** Each fits two leaves, or its name does not say what it is. | `d02` |
| 9 | **The queue:** the 142 rows of the walk and the 1,496 rows outside it. | `d05` |

Two more points are not questions, and a person should know them:

- **Nobody read the 2,430 names one by one.** They are the answers of the deciders,
  checked by rule and not by eye, apart from the rows that a correction touched and the
  two magazine batches.
- **Rule R43 makes many products.** A garment in five sizes and three colours is fifteen
  products. The preparation counted about 110 products for the 110 Pompea rows. The other
  way is one product for each model. The owner can change the rule before a repeat.

## 8. How to build the data files again

The scripts read files only. They open no database and call no service.

```sh
node build/build.mjs <path to .curation-runs/2026-10-audit-repair>
# or
CURATION_RUN_DIR=<that path> node build/build.mjs
```

The run folder is git ignored and stands in the checkout that did the repair. Its
`README.md`, `stage-a-summary.md` and `stage-b-summary.md` describe each source file of
plan `0186`. The files of plan `0192` stand in four folders of the same run folder:
`after-0189/`, `stage-c1/`, `stage-c2/` and `stage-c3/`. Each has a `summary.md`. The
files of the two changes of 2026-10-07 stand in `stage-c4/`, which has none. The files of
the coordinates of the shop of `T7` stand in `stage-c5/`, which has none either. The
files of the re-file stand in `stage-c6/`, with a `README.md`. The files of the second
walk stand in `stage-c7/`, with a `README.md` for the preparation and a `RESULT.md` for
the apply.

A build writes all thirty-five files again. The sixteen files of plan `0186` come out byte
for byte as they are committed, which was checked on 2026-10-06 after `stage-c.mjs` was
added. `gaps.json` is the one older file that changed: it gained the thirteen new rows.

On 2026-10-07 `stage-c.mjs` learned to read `stage-c4/`. A build then changed three
files: `c05` (the entry of `T7`, and one new entry for the shop), `c13` (the three shoe
creams) and `gaps.json` (the count of `c05`, 12 to 13). The other twenty-seven data files
came out byte for byte as they are committed.

Later that day `stage-c.mjs` learned to read `stage-c5/`, for the coordinates of the
shop of `T7`. A build then changed one file, `c05`: its header, and the entry of the shop,
which gained its coordinates. The other twenty-nine files came out byte for byte as
they are committed.

After the second walk, `stage-d.mjs` was added for `stage-c6/` and `stage-c7/`. A build
then wrote six new files, `d01` to `d06`, and changed one, `gaps.json`, which gained six
rows. The twenty-nine data files of plans `0186` and `0192` came out byte for byte as
they are committed. The build also counts its own rules: the header of `d01` says how
many moved products no rule of the file explains, and the answer is 0.

| Script | What it does |
| --- | --- |
| `build/lib.mjs` | Reads the source files, shapes a product and a queue row by their natural keys, counts the keys that are absent, writes one entry on one line. |
| `build/state.mjs` | Holds each product at the start of stage B, replays each product before stage A, and checks the replay. |
| `build/stage-a.mjs` | Steps A1 to A11. |
| `build/stage-b.mjs` | Steps B1 to B5. |
| `build/stage-c.mjs` | The thirteen files of plan `0192`, from `stage-c1/`, `stage-c2/` and `stage-c3/`. For `c05` and `c13` it also reads `stage-c4/`, and for `c05` it reads `stage-c5/` too. |
| `build/stage-d.mjs` | The six files of the re-file and the second walk, from `stage-c6/` and `stage-c7/`. It holds the rules of the re-file as data, and the rule that groups the reason codes of the rows outside the walk. |
| `build/decisions.mjs` | The answer of the owner to each of the sixteen decisions. `lib.mjs` writes it as `ownerDecision` beside every `openDecision`. It also holds the answers that came after the register was written, and the five answers of 2026-10-07. |
| `build/build.mjs` | Runs all of it and writes `gaps.json`. |

Some text in the data files is written in the scripts and not read from a source file: the
reasons of the two A5 cases that were not applied, the reasons of the lines left separate, the
four probable duplicates and the numbers of the sixteen decisions. Each of them is taken from
`stage-a-summary.md` or `stage-b-summary.md`. The answers of the owner are the one text that
no file of the repair holds. They are the owner's word of 2026-10-06 and of 2026-10-07,
and they stand in `build/decisions.mjs`.

`stage-c.mjs` also writes some text itself: the reason of each shop mapping, the ids of
the eight fruit products (from plan `0192`, section 3.2) and the five loose fruit rows
that `stage-c3/d6.reading.md` names. The reasons of the candidate rows and of the 47
pairs are the words of the agent that read them, copied from the files of stage 1. For
the shop of `T7` it writes the address of the page of the chain, which the owner gave, and
the kind `STORE` of the price scope, which the create answers by its id only.

`stage-d.mjs` writes three kinds of text itself. The rules of the re-file are copied
from `stage-c6/propose.mjs`, and the build checks them against the moved products. The
sentence that explains each class of correction is taken from `stage-c7/RESULT.md`. The
five groups of the rows outside the walk are a reading of the code names, made for this
register: no file of the stage holds them.
