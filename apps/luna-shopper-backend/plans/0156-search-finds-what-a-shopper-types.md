# 0156: search finds what a shopper types

> Found by `0150` (report finding 14, shopper F4 and F11). Prerequisite reading: `0115`
> (why there is no `unaccent`), the plan behind PR #319 (the literal recheck), and in the
> code `search-term.ts`, `item.service.ts` around line 933, and migration
> `1757100000000-StricterCatalogSearch.ts` in catalog.

A shopper typed what people type on a phone and did not find the product:

| Typed | Found | Wanted |
| --- | --- | --- |
| lejia | nothing | the 12 products "lejía" finds |
| pina | "Piadina" | the 16 products "piña" finds |
| pan rustico | burger buns and sliced loaves | "Barra de pan rústica" |
| aove | nothing | extra virgin olive oil |
| ginebra seagrams | Black Elephant first | Seagram's first |
| cerveza cruzcampo lata | Steinburg first | the Cruzcampo can first |

"platano" and "cafe molido" worked both ways, which is why this went unnoticed.

## Brief for the agent

### Objective

Make catalog search treat accents and ñ the same on the indexed side and the typed side,
accept the other gender or number of a typed word, rank a typed brand above a product that
only shares the category, and find extra virgin olive oil by "aove".

### Context

- Search is `to_tsquery('spanish', 'w1:* & w2:*')` on `search_es`, built by the trigger in
  `catalog/src/migrations/1757100000000-StricterCatalogSearch.ts:73-80`: name at weight A,
  brand at B, group name at C, and no synonyms. It is ANDed with a literal recheck,
  `catalog_norm(text) ~ '\m' || catalog_norm(word)` (`search-term.ts:172, 199-212`), and ORed
  with a trigram branch, `similarity > 0.4` on words of 4 letters or more
  (`search-term.ts:25, 36`).
- `catalog_norm` uses `translate` and strips accents and ñ, but not apostrophes (migration
  `:44-52`). There is no `unaccent` extension anywhere.
- **lejia.** The Spanish stemmer turns "lejía" into `lej` and "lejia" into `leji`, so the
  prefix `leji:*` misses the index. Trigram is 0.33. "plátano" and "platano" both stem to
  `platan`, which is why they work.
- **pina.** The stemmer keeps ñ (`piñ`), so `pin:*` never matches. "Piadina" comes from
  trigram at 0.444.
- **pan rustico.** The index matches (`rustic`), then the recheck needs `\mrustico`, which
  "rústica" does not contain. Trigram is 0.27.
- **pechuga pollo.** No item holds both words, because the catalog has no raw chicken breast.
  The hits for "pechuga de pollo" are trigram false positives. This row is data, not search.
- **aove.** Not a word in any document. Synonyms left item documents in migration
  `1757100000000`. There is no olive oil group in `db/reference/groups.ts`.
- **Ranking.** Both beers enter through trigram and are then ordered by `ts_rank`
  (`item.service.ts:954-962`). Steinburg scores 0.381 (cerveza twice, lata), Cruzcampo 0.311.
  "Seagram's" is indexed as `seagram` and `s`, the query is `seagrams:*`, so `ts_rank` is
  about 0 for both gins and the tie falls to the cheapest unit price (`:968`).
- Measure relevance changes on the seed dump in `D:/Projects/catalog-seed`, not on a slot's
  seed of a few hundred items.

### Target state

- `search_es` is built from `catalog_norm(...)` of name, brand and group, and every typed
  word passes through `catalog_norm` before `to_tsquery`. "lejia" equals "lejía" and "pina"
  equals "piña" on both sides.
- `catalog_norm` strips apostrophes, so "seagrams" and "Seagram's" agree.
- The literal recheck accepts a typed word of 5 letters or more with its final `o`, `a`,
  `os` or `as` removed, so "rustico" finds "rústica".
- A rank key "every word the brand holds was typed" comes before `ts_rank`.
- An olive oil group exists in the reference groups with the synonym `aove`, and the reference
  seed places extra virgin olive oils in it.
- The six rows of the table above find the wanted product first on the seed dump.

### Scope

Work only in:

- `apps/luna-shopper-backend/catalog/src/app/catalog/search-term.ts`, `item.service.ts`
  (search only) and their specs
- one new catalog migration that replaces the trigger function and `catalog_norm`, and
  rebuilds `search_es`
- `apps/luna-shopper-backend/catalog/src/app/db/reference/groups.ts` and the seed spec
- `catalog-search.integration.spec.ts`

Do not touch: offer ordering (plan `0157`), the trigram threshold, the stemmer
configuration beyond feeding it normalized text, or any client.

### Constraints

- **No new extension.** `0115` recorded why `unaccent` is not used. `catalog_norm` is the
  one normalizer on both sides.
- The migration rebuilds `search_es` for every item in one statement and is safe to run twice.
- Every change keeps the tests at `catalog-search.integration.spec.ts:405, 410, 949-994`
  green, or the plan says why one changed.
- Only make changes directly requested.

### Action boundaries

Stop and ask before: lowering the trigram threshold, adding synonyms to item documents, or a
change that makes any existing search integration test fail.

### Progress evidence

- Integration specs, one per row of the table, on an ephemeral slot.
- A before and after count on the seed dump for the six queries and for 20 queries from
  `catalog-search.integration.spec.ts`, pasted in the PR.
- `npx nx test luna-shopper-backend-catalog` passes.

## 1. Why the recheck keeps its job

The literal recheck exists because the stemmer conflates ("salado" into "sal"). Dropping one
final vowel or plural ending from a word of 5 letters or more keeps that protection: "sal" is
too short to be cut, and "salado" cut to "salad" still does not match "sal".

## 2. Pechuga de pollo

Leave it. Search did its job. The catalog has no raw chicken breast, and that is a data gap
for a walk or a leaflet to fill.
