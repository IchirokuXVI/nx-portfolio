> **PR:** [#476](https://github.com/IchirokuXVI/nx-portfolio/pull/476)

# 0162: how many are in the pack

> Frontend half: velista `0101`, the product suggestion card, which draws "Pack 6" beside the
> brand and the size (`Main`, `Expanded` and `Group` in `apps/velista/plans/mocks/typeahead/`).
>
> Prerequisite reading: `0038` section 5.7 (why `packaging` was not ingested), `0085` section
> 7 (DEZA's trailing size), `0086` (source entries and the queue), `0090` section 3 (a
> Carrefour name carries the pack count), and backlog `0001` section 3.3 (the `attributes`
> jsonb that was meant to carry packaging). The catalog merge rules say a pack size makes a
> new product.

A card has to say that a product is a pack of six. Catalog cannot say it. `ItemView` carries
`unitSize` and `defaultUnit`, so a six pack of litre cartons reads "6 L", which is also what a
six litre jug reads. The words a chain prints are no better as a field:

| Source    | Where the count is                                             | Example                        |
| --------- | -------------------------------------------------------------- | ------------------------------ |
| Mercadona | `price_instructions.is_pack`, `pack_size`, `total_units`, never read today | `is_pack: true`, `pack_size: 20` |
| Carrefour | the pack phrase in the card name, parsed and then only multiplied into `unitSize` | `pack de 9 unidades de 1 l.` |
| LIDL      | `sizeFormat`                                                   | `3x200 ml`, `4x1 / l`          |
| DEZA      | the trailing size of the description                          | `pack de 8 latas de 52 g.`     |

Mercadona's own `packaging` field is a container (`Brik`, `Garrafa`, `Sobre`), in Spanish
only, which is what `0038` section 5.7 declined to store and this plan still does not.
Backlog `0001` parked packaging in an `attributes` jsonb that nothing schedules.

What the card needs is not a word. It is a number: how many units the pack holds. A number
has no language, every source above states one, and the client renders "Pack 6" or
"Pack de 6" itself.

## Brief for the agent

### Objective

Give every catalog item an optional `packCount`, the number of units in its pack, read from
each source by the source's own adapter, carried through the source entry, written onto the
item when one is created from an entry or while the item has none, and answered on every
`ItemView`.

### Context

- **Adapters** are framework free by hard constraint and tested against checked in fixtures:
  `libs/luna-shopper/mercadona/src/lib/normalize.ts` (`toListProduct` around line 70 and
  `normalizeProduct` around line 110 both read `price_instructions`),
  `libs/luna-shopper/carrefour/src/lib/listing.ts` (`splitCardName` and `sizeAsNumber`
  around line 180, where `packCount` already exists as a local),
  `libs/luna-shopper/lidl/src/lib/normalize.ts` (`sizeFormat`), and
  `libs/luna-shopper/deza/src/lib/size.ts`.
- **The harvester** carries a source's facts on `CatalogRunnerProduct`
  (`apps/luna-shopper-backend/harvester/src/app/harvest/catalog-runner.ts`) into
  `source_catalog_entries` (`entities/source-catalog-entry.entity.ts`), which already holds
  `unitSize` and `sizeFormat` beside the `itemId` an accepted entry is bound to.
- **An item is created from an entry** in two places: `itemFrom` in
  `source-entry-batch.service.ts` (around line 462), and `createItem` in
  `source-entry.service.ts` (around line 387). Both copy `unitSize` from the entry unless the
  operation overrides it.
- **Catalog** stores items in `apps/luna-shopper-backend/catalog/src/app/entities/item.entity.ts`.
  `CreateItemRequest`, `UpdateItemRequest` and `ItemView` are in
  `libs/luna-shopper/contracts/src/lib/messages/catalog.messages.ts`.
- **Matching keys are not this plan's.** `entryKey` and `siblingKey` in `matching.ts` are
  built from name and `sizeFormat`, and changing them re-keys every entry.
- The measurement unit plans (`0095`, `0096`, `0101`, `0102`) are paused for re-evaluation.
  `0102` talks about packs as a conversion. This plan converts nothing.

### Target state

- `packCount: number | null` on `ItemView`, `CreateItemRequest` and `UpdateItemRequest`, and
  a nullable `smallint` column `items."packCount"` with a check that it is between 2 and 1000.
- Each of the four adapters returns `packCount` from its own field, by the rules in section 1,
  with a fixture test per rule.
- `source_catalog_entries."packCount"` holds what the last run that saw the entry read.
- An item created from an entry takes the entry's `packCount` unless the operation names one.
- A run that sees an entry bound to an item whose `packCount` is null fills it, and never
  overwrites a value that is set.
- The OpenAPI document and the admin wire types are regenerated.

### Scope

Work only in:

- the four adapter libraries named above, their specs and their fixtures
- the harvester: `catalog-runner.ts`, the four catalog runners, the source entry entity and a
  migration, the two item creation paths, and the fill of section 3
- catalog: `item.entity.ts`, a migration, the item mappers and service, and one new message
  for the fill
- `libs/luna-shopper/contracts` for the fields and the new message
- the gateway's admin item DTOs, so that the admin API can set and clear `packCount`
- the regenerated `openapi.json` and `wire-types.ts`

Do not touch: matching keys, `unitSize`, `defaultUnit`, `sizeFormat`, the leaflet import
(`file-import.runner.ts`), price rows, the admin app's screens, or any velista code.

### Constraints

- **A count is read, never guessed.** Anything a rule in section 1 does not cover is null. A
  bonus pack (`28+16 lavados`) is null. A count of 1 is null, because a single unit is not a
  pack and the card draws nothing for it.
- **Nothing overwrites a set value automatically.** Only `UpdateItemRequest` changes a
  `packCount` that is not null. A person who corrected one keeps the correction.
- **Two sources that disagree write nothing.** When the entries bound to one item carry two
  different counts, the fill leaves the item alone and the run report names the item. Under
  the merge rules a pack size makes a new product, so a disagreement is a bad merge for a
  person to look at, not a tie to break.
- **Refresh fixtures with each library's `capture-fixtures` target, never by hand.** If the
  fixtures on disk already carry the fields a rule needs, use them and capture nothing.
- Only make changes directly requested.

### Action boundaries

Stop and ask before:

- storing the container word (`Brik`, `Garrafa`) or any other printed packaging text
- changing a matching key
- writing a one-off backfill that updates items outside a run
- running any crawl against a live storefront

### Progress evidence

After each step, state what was built and paste the output of the target that proves it:

- Adapter specs, one per rule of section 1, including the null cases.
- A harvester spec: an entry created from a Carrefour six pack creates an item with
  `packCount: 6`, and an operation that names 4 creates one with 4.
- Harvester specs for the fill: null filled, set value kept, disagreement reported.
- A catalog spec for the column check, and a migration run against an ephemeral Luna slot.
- The regenerated OpenAPI document and wire types.

## 1. Reading the count

| Source    | Rule                                                                                           |
| --------- | ---------------------------------------------------------------------------------------------- |
| Mercadona | When `is_pack` is true: `pack_size` if set, else `total_units`. If both are set and differ, null. When `is_pack` is false or absent, null. |
| Carrefour | The count in the pack phrase `splitCardName` already matches (`pack de 9 unidades ...`), and the `N` of `NxQ`. |
| LIDL      | The `N` of `NxQ` in `sizeFormat` (`3x200 ml` is 3, `4x1 / l` is 4).                              |
| DEZA      | The count of a trailing `pack de N ...`, and the `N` of a trailing `NxQ`.                       |

`N` is a whole number from 2 to 1000, and anything else is null. Each adapter documents its
rule beside the code that applies it and states which fixture proves it. Where Mercadona's
fixtures show what `pack_size` and `total_units` mean on the same product, say so in the
PR, because the rule above assumes they agree.

## 2. Where the count lives

`source_catalog_entries."packCount"` is the source's word, updated by every run that sees the
entry, exactly as `sizeFormat` is.

`items."packCount"` is catalog's. It is written in three ways only:

1. on creation from an entry, from the entry or from the operation,
2. by the fill of section 3, only where it is null,
3. by `UpdateItemRequest`, which a person sends, and which can also set it back to null.

`ItemView.packCount` answers it on every read, because every catalog read answers
`ItemView`. No read adds a filter or an order on it.

## 3. Items that exist already

An item created before this plan has no count. It gets one the next time a run sees an entry
bound to it. After a catalog discovery run, the harvester sends catalog one new message,
`item.fillPackCounts`, with `{ itemId, packCount }` for every entry the run saw that is bound
to an item and carries a count. Catalog writes each value only where `packCount` is null, in
one statement, and answers how many rows it wrote.

The harvester groups the pairs by item first. An item with two different counts is left out
of the message and named in `harvest_runs.report`.

The consequence is stated plainly: an item whose sources no run sees again keeps null, and
the card draws no pack line for it. That is the honest state, and the admin API can set the
value by hand. A one-off backfill is an action boundary above rather than part of this plan.

## 4. Not in this plan

- The container word, and any printed packaging text.
- A conversion between a pack and its units (`0102`, paused).
- The admin app's item form. The API accepts the field, and the screen is an admin plan.
- The leaflet import. A leaflet label is free text written by a model, and a count read from
  it is the guess the first constraint refuses.
- velista's mapping and drawing of the count, which is velista `0101`.

## 5. Acceptance criteria

- [ ] `ItemView.packCount` is present on every catalog read, null or a whole number from 2
      to 1000.
- [ ] Each adapter's fixture specs cover every rule and every null case of section 1.
- [ ] An item created from an entry carries the entry's count unless the operation names one.
- [ ] A discovery run fills a null count on a bound item, keeps a set one, and reports an
      item whose sources disagree.
- [ ] Nothing changes `unitSize`, `defaultUnit`, `sizeFormat` or any matching key.
- [ ] The OpenAPI document and the wire types are regenerated and committed.

## 6. Verification

```sh
npx nx test luna-shopper/mercadona
npx nx test luna-shopper/carrefour
npx nx test luna-shopper/lidl
npx nx test luna-shopper/deza
npx nx test luna-shopper-backend-harvester
npx nx test luna-shopper-backend-catalog
npx nx test luna-shopper-backend-gateway
npx nx run luna-shopper-backend-gateway:openapi
npx nx run luna-shopper-admin/models:wire-types
npx nx test luna-shopper-admin/models
```

Then run both migrations and one DEZA or LIDL catalog discovery run against an ephemeral Luna
slot. DEZA and LIDL are the cheapest to walk. Report how many entries and how many items got a
count, and how many items the run reported as disagreeing.
