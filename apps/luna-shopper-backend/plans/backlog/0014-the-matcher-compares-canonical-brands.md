# 0014 (backlog) The matcher compares canonical brands

> **Status: backlog. Not scheduled for development.**
> Plans in `plans/backlog/` are designed and agreed but are not part of the build order, and
> nothing in them has been built. They carry their own numbering starting at `0001`, separate
> from the sequence in `plans/`. When one is picked up it moves into `plans/` and takes the next
> free number there, so parking a design never burns a number in the build sequence.

> **Priority: medium.** Plan `0124` lets a brand point at the brand it spells, and a link rewrites
> `items.brand` to the canonical label. Two readers still compare the label as text. The cost was
> found while `0124` was built (PR #409), the user chose to ship `0124` as written, and this file
> records the follow up. It grows with every link a person makes.

## The cost today

**The harvester's name matcher.** `ItemMatchIndex` (`harvester/src/app/harvest/matching.ts`)
builds its rung 3 key with `itemNameKey(name, brand, unitSize)`, and the brand half is
`normalizeName(item.brand)`, the stored label. `normalizeName` keeps words, so `Deborah` and
`DEBORAH 48H` make two keys. After a link:

- A product printed `DEBORAH 48H` reads `Deborah` in the catalog. The next source row for it,
  from a chain that has no EAN and no source reference for it yet, still prints `DEBORAH 48H`.
  The two keys differ, rung 3 finds nothing, and the row arrives `UNRESOLVED` and not as a
  `CANDIDATE`. No error, and no line in the run report.
- Two products that differed only in the printed brand now share one key. `match` answers only
  for a bucket of exactly one, so both stop matching by name. That second case is arguably right,
  because the two rows are probably one product, but nothing tells a person so.

Rung 1 (source reference) and rung 2 (EAN) are not affected.

**Catalog search.** `tg_items_search` indexes `items.brand` at weight B, and the brand filter
compares `lower(brand)`. A moved product is no longer found by typing the printed spelling.

## The idea

Compare brands as the registry does, by key and through the link, and never as text.

1. **The matcher.** Both sides of rung 3 name a brand by its canonical identity:
   - an item by `brandId` when it has one, else by `brandKey(item.brand)`;
   - a source row by the canonical brand id of `brandKey(row.brand)` when that key is registered,
     else by the key itself.

   The harvester does not hold the registry today. `brand.keys` already answers every registered
   key to the gateway, so the cheapest route is to let it answer each key with its canonical brand
   id, and to load that once per run beside `loadCatalogItems`. Check first whether `ItemView`
   carries `brandId`, because the index is built from `ItemView` rows.

2. **The shared bucket.** When a key holds two items that sit on one canonical brand, the run
   report names the pair as a likely duplicate. It stays unmatched. No automated merge, by the
   rule plan `0081` set.

3. **Search.** The search document of an item gains the labels of the brands linked to its
   brand, at the weight the brand has today, so `DEBORAH 48H` still finds the product. The trigger
   reads `brands`, so a link, an unlink and a delete must refresh the documents of the products
   they move. The brand filter compares keys through the link and not lowered labels.

## What this plan does not do

- It changes no rule of plan `0124`. `items.brand` keeps the canonical label, and
  `items.brandKey` keeps the key of the printed text.
- It adds no automated link and no automated merge.

## Open questions for the day it is picked up

- Whether the curation tool's candidate search (`curation-suggestions`, the packet candidates)
  has the same text comparison. It was not checked.
- Whether the search refresh is a trigger on `brands` or a statement inside `BrandService`. The
  second is simpler to reason about, because every write that moves products is already there.
