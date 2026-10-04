> **PR:** [#609](https://github.com/IchirokuXVI/nx-portfolio/pull/609)

# 0177: a source size states its own unit

> Found by the curation of the October 2026 harvest (Mercadona, LIDL, Deza, El Jamón and
> the Deza October leaflet, on local slot 1). The evidence is in the git ignored handoff
> `.curation-runs/2026-10-deza-staging/` on the developer's machine: `README.md`, section
> "Tool defects found", and the `work/review.jsonl` logs under `harvest-curation/curate*/`.
>
> Prerequisite reading: plan `0162` (how many are in the pack), curation suggestions plan
> `0006` (a gate that reads units), `libs/luna-shopper/tools/curation/suggestions/src/rules.mjs`
> (`PRINTED_UNITS`, `printedUnit`, `toBaseSize`), `decision.mjs` (`sameFormat`), and the
> size parsers of every chain library.

A queue row carries a size as two fields: `unitSize`, a number, and `sizeFormat`, the text
the chain printed. Nothing says which unit the number is in. The curation gate guesses it
from the last word of the printed text. The guess is wrong for every source that already
converted the number, so the gate refuses correct links. It also cannot tell that "16 ud"
and "160 g" can be one box of 16 capsules.

## Brief for the agent

### Objective

Make every source row state the unit its `unitSize` is in, make every adapter write it
the same way, and make the curation gate compare sizes through that unit and through the
pack count.

### Context

What each source writes today, read from the slot 1 queue on 2026-10-03:

| Source | `unitSize` | `sizeFormat` | Unit of the number |
| --- | --- | --- | --- |
| Mercadona | `0.4636` | `kg` | the printed unit |
| LIDL | `750` | `75cl` | millilitres, converted from cl |
| LIDL | `1.28` | `1,28 l` | the printed unit |
| El Jamón | `198` | `6x33cl` | centilitres, the printed unit |
| Deza web | always `null` | `75 cl`, `16 ud` | none: the runner never sets it |
| Leaflet file import | `750` | `75 cl` | millilitres, from the document's `size.unit` |

- `rules.mjs` multiplies every `cl` size by 10. LIDL and the leaflet already did, so a
  correct link reads as 7,500 ml against 750 ml and is refused as `FORMAT_MISMATCH`. Six
  leaflet links were refused this way (Burn 50 cl, San Miguel, Mahou Maestra, Sureña,
  a verdejo 75 cl and a vinegar "37,5 cl").
- `file-import.runner.ts` stores `size.quantity` and drops `size.unit`. The leaflet
  document said `{ "label": "75 cl", "quantity": 750, "unit": "ml" }`.
- `deza-catalog.runner.ts` writes `unitSize: null` although `libs/luna-shopper/deza`
  has a size parser. The format gate therefore never runs for a Deza row.
- `packCount` exists on source rows and on items (plan 0162), but the curation library
  never reads it. Mercadona's `readPackCount` answers a count only when `is_pack` is true.
  Mercadona product 11801 (Dolce Gusto café con leche) prints "Caja 16 cápsulas (160 g)"
  and is priced per box. Deza and El Jamón print the same box as "16 ud". So one product
  became two products, one sized 160 g and one sized 16 units.

### Target state

- `source_catalog_entries.sizeUnit`: the catalog unit `unitSize` is in (`GRAM`,
  `KILOGRAM`, `MILLILITER`, `LITER`, `UNIT`), or null when `unitSize` is null. It is
  carried on the observation contract, the snapshot and the entry view.
- Every adapter writes `unitSize` and `sizeUnit` together: Mercadona, LIDL, Deza, El Jamón,
  DIA, Carrefour and the file import. Centilitres are written as millilitres. `sizeFormat`
  stays the printed text, unchanged, because it is part of the alias key (plan 0081) and of
  the leaflet `externalId`.
- The Deza runner writes the size its own parser reads.
- The file import writes `size.quantity` with `size.unit` mapped to the catalog unit.
- `sameFormat` reads `entry.sizeUnit` first and falls back to `printedUnit` only for a row
  with no `sizeUnit` (rows written before this plan).
- `sameFormat` treats a count and a weight or volume as one format when both sides state
  the same pack count. "16 ud" against 160 g with `packCount` 16 is one format. "16 ud"
  against 160 g with no pack count is not.
- The curation packet shows `packCount` and `sizeUnit` on the entry, and `packCount` on
  each candidate. A CREATE can carry `packCount`, and the bulk route writes it.
- Mercadona: a product priced per box whose `total_units` states the capsules or pieces
  carries that count. Decide the rule from a captured fixture of product 11801, not from
  this paragraph.

### Scope

Work only in the harvester (`file-import.runner.ts`, the catalog runners, `source-ingest.ts`,
the entry entity, its migration and mappers), the chain libraries' size and normalize
files, `libs/luna-shopper/contracts`, `libs/luna-shopper/tools/curation/suggestions`, the
gateway DTOs and the regenerated `openapi.json` and `wire-types.ts`.

Do NOT touch: the alias key, `externalId` computation, `bulk_price` handling, catalog's
item table, velista.

### Constraints

- `sizeFormat` and `externalId` must not change for any row. A changed key detaches
  every leaflet alias and every replay of a curation export.
- Refresh chain fixtures with each library's `capture-fixtures` target, never by hand.
- Only make changes directly requested. Do not add features beyond this plan.

### Acceptance criteria

- [ ] A spec per adapter asserts `unitSize` and `sizeUnit` for a cl, an l, a kg and a
      count product.
- [ ] A curation spec links "75 cl" (750 ml) onto a 750 ml product, and refuses it onto a
      500 ml product.
- [ ] A curation spec links "16 ud" onto 160 g with `packCount` 16, and refuses it onto
      160 g with no pack count.
- [ ] A migration spec shows existing rows keep `sizeFormat` and `externalId`.
- [ ] `npx nx run luna-shopper-backend-gateway:openapi` and the wire types are regenerated.

### Action boundaries

Proceed with reversible, in-scope edits and tests. Stop and ask before changing the alias
key, `externalId`, or any catalog item column.

### Progress evidence

Report each adapter as done only with its spec output.

## Why a column and not a better guess

The printed text cannot say which unit the number is in, because the sources disagree
about it. LIDL converts `75cl` to 750 and leaves `1,28 l` at 1.28. El Jamón keeps `6x33cl`
at 198. Any rule read from the text alone is right for one source and wrong for another.
The adapter is the only place that knows, so the adapter must say it.

## What this does not fix

Products already created twice (the Dolce Gusto boxes in grams and in units) stay two
products. Merging them is a data task for a person, after this plan lands.
