# The loose fruit rows that wait for a fix (October 2026)

On 2026-10-07 the owner said that the loose fruit rows that sit on other products are left
for now, that they are fixed another time, and that a small report of them is saved. This
is that report. It describes slot 1 as the dumps of 2026-10-07 hold it.

Every detail was read from files of the run folder `.curation-runs/2026-10-audit-repair/`:
`stage-c3/d6.reading.md`, `stage-c3/d6.other-chain-rows.json`, the snapshots of the end of
`stage-c4/` and `stage-c4/stats.json`. An id is the first eight characters of the uuid on
slot 1. `c10-fruit-pairs.json` holds the full ids and the natural keys of the first table.

## The rule

Rule R33 of the register (the owner, 2026-10-06). Where a chain lists one fruit under a
singular and a plural name, the product with the **singular** name is the loose fruit sold
by the kilo. The product with the **plural** name is the bag of the chain. A loose row of
another chain goes on the singular product. A fixed bag of another chain is a product of
its own.

## What was moved under it

Stage 3 of plan `0192` moved three El Jamón rows on 2026-10-06. All three are still where
it put them.

| Row | Printed | It left | It is on now |
| --- | --- | --- | --- |
| `a90598fb` | "aguacates", format `kg`, 4.95 per kilo | "Aguacates" `e4caee7e` | "Aguacate" `4797568b`, `KILOGRAM` with no size |
| `c5cb8d82` | "kiwis", format `kg`, 3.89 per kilo | "Kiwis verdes" `b0d8331d` | "Kiwi verde" `db60d97b`, `KILOGRAM` with no size |
| `95380a0e` | "manzanas golden bolsa", format `1.5kg`, 2.39 at 1.59 per kilo | "Manzanas Golden" `7c039a16` | "Manzanas Golden en bolsa" `f27f595f`, 1500 `GRAM`, created from the row |

The row "kiwis" does not print "verdes". On 2026-10-07 the owner said that it is fine on
"Kiwi verde".

## The rows that still sit on another product

Five rows sell one of these fruits loose and are bound to a product that is not the
singular fruit. Stage 3 did not touch them, because each names a variety, an origin, a
size or a brand that the singular product does not. No row of the five is sold by weight
in its own record (`soldByWeight` is false on all five). The last column but one is a
proposal and not a decision.

| Chain | Printed name | Row | Bound to now | Probably belongs on | Why it was left |
| --- | --- | --- | --- | --- | --- |
| Deza | "MANZANA GOLDEN M GRANEL". Printed brand "MANZANA GOLDEN". No format, no price | `a7ff8698` | `1095b7f5`, no brand, "Manzana Golden mediana a granel", no size, `KILOGRAM` | "Manzana Golden" `35b3cfa6`, no brand, no size, `KILOGRAM` | It names a size, "M". The singular product names none |
| Deza | "AGUACATE HASS GRANEL". Printed brand is the same text. No format, no price | `060509fc` | `b797e92a`, no brand, "Aguacate Hass a granel", no size, `KILOGRAM` | "Aguacate" `4797568b`, no brand, no size, `KILOGRAM` | It names a variety, Hass. No file says which variety the singular product is |
| Deza | "KIWI HAYWARD". Printed brand is the same text. No format, no price | `c8e56f0c` | `6ad65578`, no brand, "Kiwi Hayward", no size, `KILOGRAM` | "Kiwi verde" `db60d97b`, no brand, no size, `KILOGRAM` | It names a variety, Hayward, and does not print "granel". The Deza tray is another row, "KIWI HAYWARD BANDEJA" |
| El Jamón | "manzanas golden nacional". Printed brand is the text "null". Format `kg`, 1.79 per kilo | `8cbcbadd` | `fb3cd1d9`, no brand, "Manzana Golden nacional", no size, `KILOGRAM` | "Manzana Golden" `35b3cfa6`, no brand, no size, `KILOGRAM` | It names an origin. El Jamón sells a second loose Golden, the row below, at another price |
| El Jamón | "manzanas golden extra". Printed brand "VAL VENOSTA". Format `kg`, 2.49 per kilo | `946ab4c6` | `c07e5f64`, brand Val Venosta, "Manzanas golden extra", no size, `KILOGRAM` | Probably its own product, because it prints a brand. If the owner reads it as the plain fruit: "Manzana Golden" `35b3cfa6` | It names a brand and a grade. Its product has a plural name and is not a bag |

The two El Jamón prices were read in stage 3, on 2026-10-06. The Deza website prints no
price, so the files hold none for the three Deza rows.

The read of stage 3 covered avocados, kiwis, Golden apples and red apples only. No file
holds the same read for another fruit. That read also printed these rows, which stage 3
did not name and nobody judged:

- Deza "MANZANA GOLDEN DE LOS ALPES" (`c51ec404`) is on "Manzana Golden de los Alpes"
  `0e83b5e1`, no brand, `UNIT` with no size.
- Deza "KIWI ZESPRI GREEN" (`a2b47a26`) is on Zespri "Kiwi Green" `8766efb8`. El Jamón
  "kiwis verdes zespri" (`9bbdcbae`, format `kg`) is on Zespri "Kiwi verde" `f92a2436`.
  Both products are `KILOGRAM` with no size. They may be one product.

## The same family: one product stored by the piece and by the kilo

`stage-c4/stats.json` reports four produce products that are stored twice, with the same
name and no brand: once as `UNIT` and once as `KILOGRAM`, both with no size. In each pair
the Deza row is on the `UNIT` product. The Deza website prints no format, so no file says
whether Deza sells the piece or the kilo.

| Name | Stored by the piece (`UNIT`) | Stored by the kilo (`KILOGRAM`) |
| --- | --- | --- |
| "Col" | `0d5d7017`. Deza row "COL" (`d1c553c2`) | `890c4ef5`. El Jamón row "col", format `kg` (`c49d17c7`) |
| "Col lombarda" | `00315e61`. Deza row "COL LOMBARDA" (`475b2b22`) | `634a7434`. El Jamón row "col lombarda", format `kilo` (`36dc97a9`) |
| "Coliflor" | `16383033`. Deza row "COLIFLOR" (`5ef5ad93`) | `57235bb8`. El Jamón row "coliflor", format `kg` (`2eac9772`) |
| "Manzana Granny Smith" | `c1cfd0b3`. Deza row "MANZANA GRANNY SMITH" (`146e8fc1`) | `f81038f0`. El Jamón row "manzanas granny smith", format `kg` (`2edbfedd`), and Mercadona row "Manzana Granny Smith", sold by weight (`d528d6d5`) |

The prices of these rows are not in the files that this report read.

## What a fix needs

1. **A decision for each row.** The owner says which rows are the plain fruit. The
   proposals above are a start.
2. **One accept for each row that moves.** The row is accepted onto its new product
   through the gateway, as stage 3 did for "aguacates" and "kiwis". Under
   plan `0191` the accept settles the old product: the price and the offers that the row
   stated leave it.
3. **A delete of each product that no row names any more.** A merge is two steps (rule
   R15). For the four pairs of the second table that is one accept and one delete each.
4. **One check before the Deza rows move.** A Deza row also states the shops that stock
   the product. No file says whether the settle moves those shop rows. Move one row and
   read the result before the others.
5. **New dumps.** Any write to slot 1 makes the dumps of 2026-10-07 old. Take both dumps
   again and write their values into `k8s/catalog-import/first-catalog.manifest`
   (`k8s/catalog-import/README.md`, "When slot 1 is final").
