# Deza, Folleto-Deza-Noviembre-26: two readings, one review

Date: 2026-10-27. Leaflet published 2026-10-23, valid 27 October to 9 November 2026,
46 pages (41 with products), Flipsnack collection `dtigl5nzhm`, PDF sha256
`f21ab64ac69ebfa566863a627f881142d6357b26f14fcc910a5ba975a410d1ea`. The working
material is in `.curation-runs/2026-11-deza/leaflet/` of the main checkout (not committed).

## The runs

Both through `luna-shopper/leaflet-cli` with `--engine api`, effort medium, no prompt caching,
one request at a time, the chain prompt as it stood before this record (rules 1 to 16).

| Run | Calls | Input tokens | Output tokens | Wall time | Cost |
| --- | --- | --- | --- | --- | --- |
| Opus 5.5 | 47 | 434,777 | 45,929 | 7 min 14 s | $2.66 |
| Sonnet 5.5 | 48 | 443,954 | 39,926 | 5 min 11 s | $1.29 |

A page costs about 9,300 input tokens, of which the 128 dpi page image is roughly 6,500, and
about 900 output tokens. Input is 80% of the bill on both models.

## The result

Both models read **210 offers** with identical counts per page: 193 priced, 17 with a unit price
only (the per kilo tiles), no promotion. A row by row diff found no disagreement on any price,
unit price, promotion or department across the 210 rows. Checked by eye on twelve pages and 59
rows, every price, unit price and size was right in both readings and nothing was invented.

The drift check refused both readings on the same facts of the leaflet: ten department headings
with no slug in `headings.mjs` (ADEREZOS, BAZAR, CERVEZAS, CONSERVAS, DULCES, DULCES
TRADICIONALES, MASCOTAS, PANADERÍA, REFRESCOS, VINOS), a per 100 g label pattern, and the
bazar pages that print a PVP table per size instead of a shield badge. Neither document was
validated or uploaded.

## The errors the owner found

Reviewed on the side by side page (`cli:review`, artifact 7XnG3qKeju3qurvq9efmBN), rows named
`page.item`. The owner's own words are the comments on that page; this is the summary.

| Row | What was wrong | Which reading | Decision |
| --- | --- | --- | --- |
| 4.3 | The format "Bandeja de 290 g" was appended to the name | Sonnet | A name carries no pack size |
| 6.4 | "COVAP" kept in the name | Opus | A name carries no brand |
| 10.1 | "Pan de chorizo o de salchichón" is two products at one price | both | Split "A o B" tiles (new rule) |
| 10.4 | Brand "TORREMILANO Covap" mixes the line and the maker | Sonnet | Torremilano is the brand: a line with its own wordmark |
| 15.1 to 15.6 | ARTIQ, DELFÍN, COCINARTE kept in the names | Opus | A name carries no brand |
| 23.1 | The separate red badge "EL LITRO A 3'59" was read as a number with no label | Opus | The builder dropped the comparison line; Sonnet kept the label |
| 26.4 | Tortillas, "20 cm 10 ud" read as basis pack | Opus | One container with several pieces inside is a unit |
| 33.1, 33.3, 33.4 | Doubt: unitPrice 0.37 is per 100 ml, not per unit | neither | Not a defect: the label travels with it and the builder stores 0.37 per 100 ml |
| 35.2 | "ácido hialurónico o vitamina C" is two products | both | Split "A o B" tiles |
| 35.4 | Brand "Age Perfect" (Opus) and "Loreal Age Perfect" (Sonnet) | both | L'Oréal Paris is the brand; Age Perfect is a range and stays in the name |
| 37.3 | "olor ropa limpia o bambú" is two products | both | Split "A o B" tiles |
| 44.1 to 44.12 | The size "90 cm" written into the name | Opus | The size stays in format; one row per size is right |
| 44.13 | "dinosaurios o estrellas" is two products | both | Split "A o B" tiles |

Opus made the name mistakes (brand or size inside the name, 19 rows of 65) and dropped one
label; Sonnet 5.5 appended a format once, kept `cl` as a size unit on four wines (pages 32,
caught by the builder) and mixed a line with its maker once. Neither split a tile that joins
two products with "o", because no prompt asked for it.

## What changed because of it

The chain prompts now say, in every chain: a name carries neither the price, the brand nor the
pack size; a tile that advertises several products at one price is one row per product, decided
first on the wording around "o" and then on the photograph. The Deza prompt also says that one
container with several pieces inside is a unit, and that a line with its own wordmark is a
brand while a range in the maker's typography stays in the name.

Still open for the owner: the ten headings with no slug (which `headings.mjs` slugs they map to),
and whether to accept one of the two documents as the new baseline after that.
