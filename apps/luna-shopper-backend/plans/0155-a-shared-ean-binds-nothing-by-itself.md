> **PR:** [#456](https://github.com/IchirokuXVI/nx-portfolio/pull/456)

# 0155: a shared EAN binds nothing by itself

> Found by `0150` (report finding 5, `part3/rerun.md`, and the `NAME_SIZE` half of finding
> 11). Prerequisite reading: `0080` (side by side prices), `0081` (only a person or an EAN
> makes an entry `ACTIVE`), and in the code `source-ingest.ts` and `matching.ts` in the
> harvester and `item-price-writer.ts` in catalog.

Mercadona gives one EAN to five "Dorada" cuts: whole, cleaned, fillets and two more. The
seeded product "Dorada" holds that EAN, so every cut binds to it as `ACTIVE`. Each walk then
writes all five cuts' prices onto the same product, scope and source kind, and each price
that differs from the one before it inserts a row. The rerun in `0150` inserted four rows for
Dorada (5,28, 4,65, 4,56, 5,28) with no change on the storefront. A shopper sees whichever
cut was written last. In the same walk, 20 EANs were shared by 56 Mercadona products.

The same walk showed a second binding defect. The chain's own sibling match (`NAME_SIZE`)
keys on name and unit and not on size, so 260 of 273 Mercadona candidates pointed at another
size of the same product: a 0.33 l can at a 1 l bottle.

## Brief for the agent

### Objective

Stop an EAN that several products of one chain share from binding any of them by itself,
repair the entries already bound that way, and make the sibling match compare size.

### Context

- **Binding.** Rung 2 makes any row whose EAN is in the catalog index `ACTIVE` with
  `matchedBy: EAN`, and never checks whether other rows share the EAN. The index is
  `harvester/src/app/harvest/matching.ts:95-96, 121-130` (one map entry per EAN, first
  wins). A new row binds at `source-ingest.ts:651-664`, and a row that learns an EAN later
  binds at `:592-609`.
- `source_catalog_entries` is unique on `(supermarketId, externalId)`, so the five cuts are
  five rows, all pointing at one `itemId`. `source_entry_prices` is unique on
  `(entryId, priceScopeId)` and holds one price per cut correctly.
- **The price write.** Step 4 groups owed prices by scope and never removes duplicates by
  `itemId` (`source-ingest.ts:407-425`). In catalog, `item-price-writer.ts:125-183` compares
  each entry with the current row for (item, scope, kind), and lines 181 to 183 make each
  inserted entry the current one for the next entry in the batch. `item_prices` has no
  source product column (`item-price.entity.ts:38-45`).
- Accepting several entries onto one item has the same flip
  (`source-entry-write.ts:63-98`).
- Availability is one value per item, so it has the same many to one problem.
- **The sibling key.** `source-ingest.ts:667` calls `siblings.match(name, sizeFormat)`, and
  the key is `name|sizeFormat` (`matching.ts:61-63`). For Mercadona, `sizeFormat` holds only
  the unit (`"l"`). Evidence: `responses/06-p1-step7/mercadona-entries-before.json` in the
  `0150` report, where entry `fd485114` (0.33 l) points at `d70c2300` (1 l).
- `entryKey` and `externalId` are also the row identity for sources without their own id. Do
  not change them.
- CLAUDE.md: "No automated match ever binds a printed name to a product." An EAN is the one
  automated rung allowed to make an entry `ACTIVE`. This plan narrows that rung. It does not
  add a new one.

### Target state

- Rung 2 binds by EAN only when exactly one entry of that chain carries the EAN. When more
  than one does, every entry with that EAN becomes a `CANDIDATE` with the reason
  `SHARED_EAN`, and writes no price until a person accepts it.
- The count covers the entries the session already loaded plus every entry this run creates
  or updates, so the first cut of a walk cannot bind before its siblings arrive.
- A one time repair demotes every `ACTIVE` entry with `matchedBy = EAN` whose EAN is shared
  inside its chain to `CANDIDATE` with `SHARED_EAN`. The repair writes no price and deletes
  no price row.
- Step 4 sends at most one price per (item, scope) per batch. When two entries of one item
  meet in a batch, it keeps none, logs a warning with both entry ids, and counts them in the
  run report as `pricesConflicted`.
- The sibling key includes `unitSize`. A 0.33 l entry never proposes a 1 l product.

### Scope

Work only in:

- `apps/luna-shopper-backend/harvester/src/app/harvest/` (`source-ingest.ts`, `matching.ts`,
  `source-entry-write.ts`, the run report, specs) and one harvester migration for the repair
- `libs/luna-shopper/contracts` for the `SHARED_EAN` reason and the run report counter, plus
  the regenerated `openapi.json` and `wire-types.ts`

Do not touch: `item-price-writer.ts`, `effective-price.ts`, `item_prices`'s columns, the
Mercadona library, or `entryKey`.

### Constraints

- **Refuse, do not choose.** No rule picks one cut's price for a product that several cuts
  share. A person accepts one entry or creates separate products.
- The repair is idempotent and touches only harvester tables.
- Only make changes directly requested.

### Action boundaries

Stop and ask before: adding a source product column to `item_prices`, deleting any
`item_prices` row, or unbinding an entry a person accepted (`matchedBy` other than `EAN`).

### Progress evidence

- A spec in `source-ingest.spec.ts`: five entries with one EAN in one chain end
  `CANDIDATE`, and no price is sent for them.
- A spec: the same EAN in two chains still binds in each chain.
- A spec: a batch with two entries of one item sends no price for it and counts one conflict.
- A spec: the sibling key with size keeps 0.33 l and 1 l apart.
- A migration spec, or an integration spec on an ephemeral slot, for the repair.
- `npx nx test luna-shopper-backend-harvester` passes, and the OpenAPI and wire types are
  regenerated.

## 1. Why not a row per source product

Adding the source product to `item_prices` and to the current row key keeps all five
prices. It needs a contract change, a migration, a rule in `effective-price.ts` for choosing
among rows of one kind, and a recompute of `supermarket_items`. That is a price policy
decision, which `0150` said not to make, and the product is still wrong: five cuts are not
one product. Refusing the binding sends the question to the curation queue, where a person
creates the cuts as products.

## 2. After the repair

The seeded "Dorada" keeps its current shown price until its rows expire, because nothing
deletes them. Say so in the PR, with the count of entries the repair demoted on a slot
loaded from the seed dump (`D:/Projects/catalog-seed`) or the `0150` slot.
