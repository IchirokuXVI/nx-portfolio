> **PR:** [#886](https://github.com/IchirokuXVI/nx-portfolio/pull/886)

# 0239 A merged product stays, and names the one that replaced it

> Picked up on 2026-10-31 from backlog `0020`, because plan `0237` (section 3.1) needs it:
> the catalog audit of 2026-10-27 holds fourteen merges. Section 1.1 adds what that audit
> needs from a merge.

> Decided by the owner on 2026-10-03: a merge of two products is allowed, and it must be
> marked as a merge, so that nothing reads it as a delete. "For example by not deleting
> the old record." This plan is that mark. Backlog plan `0019` needs it, and so does any
> curation that happens in a cluster, where shoppers' lists already name the product that
> goes away.
>
> Prerequisite reading: `catalog/src/app/catalog/item.service.ts` (`delete`, `getMany`,
> `search`, `findByEan`), `catalog/src/app/entities/item.entity.ts`,
> `k8s/catalog-reset/cleanup-core-catalog-refs.sh` (every core column that names a product),
> plan `0086` (the queue), plan `0080` (prices side by side) and
> `apps/luna-shopper-backend/docs/initial-catalog-2026-10.md`, section "Stage 4".

## Brief for the agent

### Objective

Give the catalog one operation that merges a product into another. The merged row is kept,
names its survivor, and leaves every list and search. Whatever still asks for its id is
answered with the survivor.

### Context

- **There is no merge today.** The October curation merged six pairs by hand: the queue
  rows of one product were accepted onto the other, and the empty product was deleted
  (`initial-catalog-2026-10.md`, "Six pairs with the same brand and name were merged").
- **`ItemService.delete` is a hard delete.** The foreign keys cascade inside catalog. No
  event tells anybody.
- **Core names a product with no foreign key**: `list_line_items.itemId`,
  `list_line_group_removals.itemId`, `line_settlements.itemId`. `getMany` leaves a missing
  id out of its answer, so a line whose product was deleted loses its product and nobody
  sees an error. Phones cache ids too.
- **The harvester names a product** in `source_catalog_entries.itemId`.
- **Why a delete cannot be the mark.** A tool that compares two databases
  (backlog `0019`) sees a row that is gone and cannot tell a merge from a mistake. A person
  who reads the audit trail a year later cannot either.

### The alternatives, and the one this plan takes

| | How a merge is marked | A list line or a phone that holds the old id | Cost |
| --- | --- | --- | --- |
| **A. The row stays** (this plan) | `items.mergedIntoId` names the survivor | gets the survivor, with no change in core | one column, and every read of `items` must leave merged rows out |
| B. The row goes, a redirect stays | a row in a new table `item_merges (fromItemId, intoItemId)` | gets the survivor, if every read by id looks in the table first | one table, and the product's own name and audit history are gone |
| C. The row goes, every reference is rewritten | nothing in the database, only `catalog_audit` | works for core and the harvester, breaks for a phone's cache | no schema change, a write in three databases with no shared transaction |
| D. A flag with no target | `items.retiredAt` | finds nothing | the least work, and the line loses its product as it does today |

A is the owner's own example, and it is the only one in which the old record keeps its
name, its EAN history and its audit trail. B is the fallback if the filter on every read
turns out to be too wide a change. C and D do not mark a merge.

### Target state

1. `items.mergedIntoId` (uuid, nullable, a foreign key onto `items` with
   `ON DELETE RESTRICT`) and `items.mergedAt`. A check forbids a row that names itself.
2. `ItemService.merge({ itemId, intoItemId })`, admin only, in one transaction (section 1).
3. Every read that lists or searches products leaves merged rows out. Every read by id
   answers the survivor (section 2).
4. An event `catalog.itemMerged` with both ids, for the harvester and for core
   (section 3).
5. `ItemService.delete` refuses a product that another product was merged into, and a
   product that any price, queue row or list line still names is merged, not deleted
   (section 4).
6. The back office offers "Merge into…" on a product. That is admin work, and it is a
   plan of its own in `libs/luna-shopper-admin`.

### Scope

- Work only in: `apps/luna-shopper-backend/catalog/`, `apps/luna-shopper-backend/harvester/`
  (the event handler, and the count of queue rows of section 1.1), `apps/luna-shopper-backend/core/`
  (the event handler, and the count of list lines of section 4),
  `apps/luna-shopper-backend/gateway/` (the route and the OpenAPI document),
  `libs/luna-shopper/contracts`, the error codes in `libs/luna-shopper/platform`, and the
  generated admin wire types.
- Do NOT touch: velista, the admin app, the release tasks, any existing migration.

### Constraints

- A merge is one level. A survivor is never itself merged: merging B into C when A already
  points at B moves A to C in the same transaction. The brand links follow the same rule
  (plan `0124`).
- The migration only adds. It deletes nothing and rewrites nothing.
- Regenerate `openapi.json` and the admin wire types, as `CLAUDE.md` describes.
- Only make the changes this plan names.

### Action boundaries

- Proceed with code, specs and a local slot.
- Stop and ask if the filter of section 2 needs a change to a query that plan `0156`
  (search) or the basket series owns in a way this plan does not describe.

### Progress evidence

Report each acceptance criterion in section 5 with the command and its output.

## 1. What a merge does

In one transaction in catalog, for `itemId` (the merged product) and `intoItemId` (the
survivor):

1. Refuse when the two are the same, or when either is already merged (`item_merged`).
   Two different barcodes are not a refusal: under plan `0185` a product holds several,
   and step 4 moves them all. Refuse the two cases of section 1.1 unless the request
   allows them.
2. Move `item_prices` rows to the survivor. Plan `0080` keeps every source's price side by
   side, so nothing is overwritten. Recompute the effective prices of the survivor in the
   same write.
3. Move `supermarket_location_items` rows, and keep the survivor's row where both have one
   for the same shop. A row the survivor already holds stays on the merged row, as a
   record, and is not deleted. The pins of plan `0167` (`supermarket_item_sections`) do
   not move: nothing reads them since plan `0200`, and a release task removes them.
   The materialized `supermarket_items` row of a scope moves when the survivor has none
   there, because it carries `available`, which no price row holds. Where the survivor
   has one, the survivor's row stays and the merged row's copy is removed: it is derived,
   and step 2 recomputes the survivor's rows from the moved prices. The recompute never
   touches `available`, so before the copy goes the survivor's row takes `true` from it
   when the merged product was offered there (plan `0084`: a scope that any shop says
   true of is true). A row whose price a person set (`ADMIN`) is left as it is. The chain photo
   links (`item_linked_images`, plan `0198`) move too, and both products' `linkedImages`
   are refreshed in the same write.
4. Move every `item_eans` row of the merged product to the survivor (plan `0185`). The
   survivor keeps its own first barcode. If it has none, the merged product's first
   barcode becomes its first. Set the merged row's `items.ean` to null, because
   `uq_items_ean` holds one row per EAN.
5. Set `mergedIntoId` and `mergedAt`, and move every product that named the merged one
   onto the survivor (the one level rule). Write `catalog_audit` rows for both products.
   **Built as `UPDATE` rows, not a new action `MERGE`** (decision of 2026-10-31): the
   action is a Postgres enum, `catalog_audit_action`, and a new value is a schema change
   this plan was not given. The merged row's row shows `mergedIntoId` and `mergedAt`
   moving from null, which no delete and no other edit writes, and the survivor's row
   names what it received under `merged`. Adding `MERGE` later is one
   `ALTER TYPE ... ADD VALUE` and a change to these two rows, and it is the owner's call.
6. Publish `catalog.itemMerged` after the transaction commits, fire and forget, as the two
   group events are.

The merged row keeps its name, brand, size and categories as they were. It is a record of
what the product was called.

**Plan `0185` changes steps 1 and 4: a merge can move every barcode.** A product now
holds several barcodes. Each one is a row of `item_eans`, and `items.ean` is the first of
them. So a merge moves every barcode row of the merged product to the survivor. It does
not refuse two different EANs. The survivor keeps its own first barcode. If the survivor
has no barcode, the first barcode of the merged product becomes its first. The merge still
sets `items.ean` of the merged row to null, because `uq_items_ean` holds one row per EAN.
An old in-store code or invalid code on the merged row is in no row of `item_eans`, so it
does not move. This move replaced the acceptance criterion of section 5 that refused
two different EANs.

### 1.1 What the catalog audit needs (plan 0237, section 3.1)

**The route.** `POST /v1/admin/catalog/items/:id/merge`, behind `AdminJwtGuard`, on the
message `item.merge`, with the body:

```json
{
  "intoItemId": "<survivor>",
  "dryRun": false,
  "allowSecondArticle": false,
  "allowFormatDifference": false
}
```

Every flag is optional, false when absent, and a JSON boolean only. It answers 201 with
`MergeItemResult`, which names what moved: the price rows, the scope rows, the shop rows
(moved and kept on the merged row), the barcodes, the photo links, the products that
pointed at the merged one, and the `mergedIntoId` and `mergedAt` that were set.

**The queue rows are counted, not moved, by catalog.** They live in the harvester's
database. The answer states `queueRows`, the number of rows that named the merged product
when catalog asked the harvester just before the write, and the harvester rewrites them
when it hears `catalog.itemMerged`, after the answer. **The products already merged into
either side count as that side** (review of PR #886): catalog asks about them too, rule
R28 reads each side as the product with them, and `queueRows` counts their rows. An event
that was lost leaves their rows on their own ids, so catalog publishes
`catalog.itemMerged` again for each product the one level rule moves onto the survivor;
a service that already moved those rows finds nothing to move. So the answer never claims that the
queue already agrees. Core's lines are rewritten the same way and are not counted.

**A dry run answers the same and writes nothing**, as the settle route of plan `0191`
does. It runs the whole merge in its transaction and rolls it back, so the counts are the
counts a real merge writes, and it publishes no event. It evaluates every refusal.

**Two refusals, each the owner's to override, per pair.**

- `item_merge_two_articles_one_chain` (409) when both products hold an `ACTIVE` queue row
  of the same chain (rule R28 of the register), unless `allowSecondArticle: true`. The
  chains travel in `details.supermarketIds`. After such a merge the survivor holds two
  articles of one chain, which plan `0191` already handles (`scopeSharedWith`).
- `item_merge_format_differs` (409) when `unitSize` or `defaultUnit` differ, unless
  `allowFormatDifference: true`. Both formats travel in `details`.

**How catalog learns of the queue rows.** Catalog asks the harvester inside the merge,
before it writes, with a NATS request `sourceEntry.itemUsage` that carries the operator's
own credential. The harvester answers, per product, how many rows name it and which chains
it holds an `ACTIVE` row of. The alternative, the gateway asking first and passing the facts
in, would let any other caller of `item.merge` skip the rule. A harvester that does not
answer in five seconds fails the merge: catalog does not merge on a guess.

Only an operator merges. A service credential is refused, because the merge forwards the
operator's token to the harvester.

## 2. What a read answers

- **A list or a search** (`search`, `searchOffers`, the product group reads, the admin
  lists) never returns a merged row. One shared condition, `mergedIntoId IS NULL`, in the
  place where the service builds an item query, and a spec that scans the service for a
  query on `items` that does not go through it.
- **A read by id** (`get`, `getMany`) answers the survivor, under the id that was asked
  for, with a field `mergedInto` that names the survivor's id. A list line that holds the
  old id therefore shows the right product and the right price with no write in core.
- **`findByEan`** finds the survivor, because step 4 moved the EAN.
- The admin can list merged rows through a filter, to read the history.

As built:

- `mergedInto` is **optional** on `ItemView`, and present only on a view of a merged
  product. Every shopper client reads the view through its own model, so a field it does
  not know changes nothing for it.
- `get` and `getMany` answer the survivor's data, offers and barcodes under the asked id,
  with `mergedInto`. When both ids are asked for, both entries come back.
- The admin filter is `merged=true` on `GET /v1/admin/catalog/items`
  (`SearchItemsRequest.merged`). It lists the merged rows alone, each with its **own**
  name, brand and size and with `mergedInto`, because the history is what it is for.
- `findByEan` and `findByEans` find the survivor because the barcodes moved, and a
  barcode that a merged row still holds (written before the next point) answers its
  survivor too.
- **A write that names a merged product lands on its survivor** (review of PR #886). The
  event is fire and forget and a running harvest keeps the id it read, so writes to the
  merged id go on arriving. `survivorsOf` (`catalog/merged-items.ts`) resolves them for
  `writeItemPrices`, both availability writers, the photo link batch and `teachEans`. A
  withdraw of run written prices that names a merged product removes nothing. `addEan`
  on a merged row, and an update that changes its barcode or its group, are refused with
  `item_merged`; any other edit of a merged row is allowed (see the last point).
- The admin shop rows (`supermarketLocationItem.listByLocation`) leave out a row a merge
  kept on the merged product, and `supermarketLocationItem.get` by a merged id answers the
  survivor's row at that shop. The view's shape is unchanged.
- Reads outside `ItemService` that still count merged rows, each left on purpose:
  - The dashboard's product count. It counts the rows of the catalog, and a figure that
    drops by one at every merge needs a label in the back office that no plan gives it.
  - A brand's `itemCount` and `brand_in_use`, because the merged row keeps its brand as a
    record. A brand that only merged rows hold is refused until those rows are given no
    brand, which is why an update of a merged row is allowed.
  - `category_in_use` (`category.service.ts`), because the merged row keeps its categories
    for the same reason. A category that only merged rows hold is refused until those rows
    are moved to another category, through the same update.

## 3. Who hears about it

- **The harvester** rewrites `source_catalog_entries.itemId` from the merged id to the
  survivor. The next harvest of that chain then binds to the survivor by itself.
- **Core** rewrites `list_line_items.itemId`, `list_line_group_removals.itemId`,
  `line_settlements.itemId` and `list_lines.favoriteItemId`, and recomputes
  `list_lines.itemSetHash`. Two rows of one line that end on the same product become one
  (`list_line_items` is unique on line and product, and so is
  `list_line_group_removals`). When either row was the person's (`USER`), the row that
  stays is the person's. A line that ends holding the survivor keeps no removal of it,
  as every other write of a line's set clears the removal of a product the line holds
  (`rewriteItemSet`, `moveGroupRemovals`). The touched lines bump their version and are announced to their
  lists, as a group sync announces them. These are every core column that names a
  product: `favoriteItemId` (plan `0199`) was added after this plan was written, and
  `k8s/catalog-reset/cleanup-core-catalog-refs.sh` does not name it either.
- Core's handler runs through `runOnce` (`processed_events`), as the account deletion
  does, so a replayed event changes nothing.
- **The harvester's handler does not use `runOnce`.** The harvester has no
  `processed_events` table, and a new table there is a schema change this plan does not
  make. Its handler is one statement,
  `UPDATE source_catalog_entries SET "itemId" = <survivor> WHERE "itemId" = <merged>`,
  which a second delivery finds nothing to change in. That is the only column of the
  harvester that names a product.
- A phone that is offline keeps the old id. Section 2 answers it until it syncs.

## 4. What becomes of delete

A hard delete stays for a product that nothing names: no price, no queue row, no list
line. For everything else the answer is a merge, or a refusal that says what still names
the product. `delete` asks the harvester and core through NATS before it removes the row,
which closes the silent orphan that `reference-seed` and the catalog reset both had to
clean up after.

As built:

- One code, `item_in_use` (409), with the counts in `details`: `priceCount` (rows of
  `item_prices`), `mergedFromCount` (products merged into this one), `queueRowCount` (the
  harvester's rows, any status) and `listLineCount` (core's lines that hold the product).
  Catalog cannot choose a survivor, so the refusal names the merge route in its message.
- A merged row is not deleted either (`item_merged`): it is the mark.
- Catalog asks with the operator's credential: the harvester through
  `sourceEntry.itemUsage` and core through `adminItem.usage`. Each answers counts and no
  identities.
- **The harvester's own delete is not asked about.** The harvester deletes a product as a
  service when a decisions file must undo the products it created (plan `0100`). It is the
  one caller that knows those products are orphans, and asking it back would ask the caller.
  Catalog still checks its own prices and merges for it.

## 5. Acceptance criteria

- [x] An integration spec on real Postgres: after a merge, the survivor holds both
      products' prices, the merged row still exists, and its `mergedIntoId` is set.
- [x] `search` for the merged product's name returns the survivor once and the merged row
      never.
- [x] `getMany` with the merged id returns the survivor's data and `mergedInto`.
- [x] A merge of B into C, when A was merged into B, leaves A pointing at C.
- [x] A merge of two products with different EANs moves every barcode row of the merged
      product to the survivor; the survivor keeps its own first barcode, or takes the
      merged product's first barcode when it has none; the merged row's `items.ean` is
      null (plan `0185`).
- [x] A dry run answers what a merge writes and writes nothing.
- [x] Two `ACTIVE` rows of one chain refuse the merge with
      `item_merge_two_articles_one_chain`, and `allowSecondArticle` lets it through; a size
      or unit difference refuses it with `item_merge_format_differs`, and
      `allowFormatDifference` lets it through.
- [x] The harvester handler rewrites the queue rows, and a second delivery of the event
      changes nothing.
- [x] The core handler leaves one `list_line_items` row when both products were on one
      line.
- [x] `delete` of a product with a price is refused.
- [x] `openapi-document.spec.ts` and `wire-types.spec.ts` pass.

Each is proven by a spec: `catalog/src/app/catalog/item-merge.integration.spec.ts` and
`item-merged-reads.spec.ts`, `catalog/src/app/db/merged-items-migration.integration.spec.ts`,
`harvester/src/app/harvest/item-merge.integration.spec.ts`,
`core/src/app/lists/item-merged-sync.integration.spec.ts` and
`gateway/src/app/catalog/item-merge.http.spec.ts`.

## 6. What this plan leaves out

- **Undoing a merge.** The prices of two products cannot be told apart again after they
  moved. A wrong merge is corrected by creating the product again.
- **Merging product groups, brands or shops.** Brands have links (plan `0124`). The other
  two have no merge, and nobody asked for one.
- **The six pairs of October.** Their merged rows are already gone from the first
  catalog. Nothing in a cluster named them, so nothing is lost.
