# 0013 (backlog) Brands a chain vouches for

> **Status: backlog. Not scheduled for development.**
> Plans in `plans/backlog/` are designed and agreed but are not part of the build order, and
> nothing in them has been built. They carry their own numbering starting at `0001`, separate
> from the sequence in `plans/`. When one is picked up it moves into `plans/` and takes the next
> free number there, so parking a design never burns a number in the build sequence.

> **Priority: low.** Plan `0115` makes a person register every brand, from the suggested brands
> list in the back office (admin plan `0027`). That works while the queue is a few thousand rows.
> This file records a design for the registry to fill itself from the chains' own brand fields, which
> was designed alongside `0115` and deliberately taken out of it.

## The idea

A harvest run already stores the brand a chain answers, verbatim, on
`source_catalog_entries.brand`. Some chains answer it from a structured field rather than
printed text. The design registers a brand one of those fields names with no person involved, and
only the rest would wait in the suggestions list.

## Which fields are trusted

Read from the adapters and their fixtures on 2026-09-16:

| Source    | Where the brand comes from                                                    | Trusted |
| --------- | ----------------------------------------------------------------------------- | ------- |
| Mercadona | The detail endpoint's `brand`. The listing has none. `""` on some products, read as null. | Yes |
| Carrefour | The listing card's brand, on 24 of 24 sampled cards, in capitals (`MAHOU`, `BEZOYA`). The product page's `brand.description` is not read today. | Yes, for the key only |
| LIDL      | The page's `info.brand.name`, else the index row. `-` and `---` appear, and plan `0115`'s key already makes both null. Lines and brands mix: `ALESTO` and `Alesto Selection`. | Yes, after cleanup |
| DEZA      | `extractBrand`, the longest run of capitalised words in the name (`PLUS MAX` from a detergent). Its own comment says it is stored "with no pretence of certainty". | No |
| Leaflets  | Read by a model from the page.                                                | No |
| Curator   | Written by a model per row.                                                   | No |

## The design

1. A run's ingest computes the key of every trusted field it stores, as `0115` already does.
2. For a key no brand holds, the harvester emits one event per run naming the key, the chain and
   the most common spelling.
3. Catalog registers the brand with that spelling as its label, unless the chain is Carrefour,
   whose capitals are no label. A Carrefour key is registered only when another trusted chain
   supplies a spelling for it, or it stays a suggestion.
4. A brand registered this way records how: a `registeredBy` column, `PERSON` or the chain's
   adapter key, shown in the back office so a person can review the ones no person chose.

## Why it was taken out

- **A trusted field is still wrong sometimes.** The field names what the chain decided, and the
  chain's idea of a brand is not the catalog's rules. Rule 5 wants the line (`Elvive`), and a
  chain can answer the maker.
- **The label casing is a decision.** Mercadona's casing is usable, Carrefour's is not, LIDL's
  varies. A person reading the suggestion decides it in a second.
- **The volume does not need it yet.** The suggestions list ranks keys by how many queued products
  carry them, so the few brands that cover most rows are registered first, by hand, in minutes.

## Also considered: Open Food Facts

Measured on 2026-09-16 and set aside by the owner for now, recorded here so it is not measured
again from nothing:

- The curated brand taxonomy has 1,356 brands worldwide and misses most Spanish ones (Gallo,
  ElPozo, Campofrío, Gullón, Pascual). It covers 18.5% of brand mentions on Spanish products.
- The brands typed on Spanish products are 34,507 distinct tags, of which 5,342 appear on five
  or more products, with many spellings of one brand (`elpozo`, `el-pozo`, `Elpozo`).
- By EAN, 2,075 of 4,196 seeded Mercadona items were found (49%): 84% of Hacendado, 4% of
  Deliplus, 3% of Bosque Verde, because non food lives in Open Beauty Facts and Open Products
  Facts. Where both had a brand, 84% agreed. The rest named the owner (`Mercadona`), the factory
  (`Pescanova`, `Dolis`) or a typo (`Hacenado`).
- The live search and facet endpoints answered 503 during the measurement, and the Hugging Face
  dump answered 429 to ranged reads. A per EAN product read worked.
- The data is ODbL: attribution, and share alike for a published derived database.

## When to pick it up

When the suggestions list stays long after the top of it is registered, or when a new chain
brings thousands of products at once.
