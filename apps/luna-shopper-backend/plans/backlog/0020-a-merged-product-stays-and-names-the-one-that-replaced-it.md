# 0020 (backlog) A merged product stays, and names the one that replaced it

> **Status: backlog. Not scheduled for development.**
> Plans in `plans/backlog/` are designed and agreed but are not part of the build order, and
> nothing in them has been built. They carry their own numbering starting at `0001`, separate
> from the sequence in `plans/`. When one is picked up it moves into `plans/` and takes the next
> free number there, so parking a design never burns a number in the build sequence.

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
4. An event `catalog.item.merged` with both ids, for the harvester and for core
   (section 3).
5. `ItemService.delete` refuses a product that another product was merged into, and a
   product that any price, queue row or list line still names is merged, not deleted
   (section 4).
6. The back office offers "Merge into…" on a product. That is admin work, and it is a
   plan of its own in `libs/luna-shopper-admin`.

### Scope

- Work only in: `apps/luna-shopper-backend/catalog/`, `apps/luna-shopper-backend/harvester/`
  (the event handler), `apps/luna-shopper-backend/core/` (the event handler),
  `apps/luna-shopper-backend/gateway/` (the route and the OpenAPI document),
  `libs/luna-shopper/contracts`.
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

1. Refuse when the two are the same, when either is already merged, or when both hold an
   EAN and the EANs differ. Two EANs are two products for the database (`uq_items_ean`),
   and the owner decides which one the survivor keeps before the merge.
2. Move `item_prices` rows to the survivor. Plan `0080` keeps every source's price side by
   side, so nothing is overwritten. Recompute the effective prices of the survivor in the
   same write.
3. Move `supermarket_location_items` rows, and keep the survivor's row where both have one
   for the same shop.
4. Give the survivor the merged product's EAN when it has none. Set the merged row's EAN
   to null, because the unique index holds one row per EAN.
5. Set `mergedIntoId` and `mergedAt`. Write `catalog_audit` rows for both products, with a
   new action `MERGE`.
6. Publish `catalog.item.merged`.

The merged row keeps its name, brand, size and categories as they were. It is a record of
what the product was called.

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

## 3. Who hears about it

- **The harvester** rewrites `source_catalog_entries.itemId` from the merged id to the
  survivor. The next harvest of that chain then binds to the survivor by itself.
- **Core** rewrites `list_line_items.itemId`, `list_line_group_removals.itemId` and
  `line_settlements.itemId`, and recomputes `list_lines.itemSetHash`. Two rows of one line
  that end on the same product become one (`list_line_items` is unique on line and
  product).
- Both handlers run through `runOnce` (`processed_events`), as the account deletion does,
  so a replayed event changes nothing.
- A phone that is offline keeps the old id. Section 2 answers it until it syncs.

## 4. What becomes of delete

A hard delete stays for a product that nothing names: no price, no queue row, no list
line. For everything else the answer is a merge, or a refusal that says what still names
the product. `delete` asks the harvester and core through NATS before it removes the row,
which closes the silent orphan that `reference-seed` and the catalog reset both had to
clean up after.

## 5. Acceptance criteria

- [ ] An integration spec on real Postgres: after a merge, the survivor holds both
      products' prices, the merged row still exists, and its `mergedIntoId` is set.
- [ ] `search` for the merged product's name returns the survivor once and the merged row
      never.
- [ ] `getMany` with the merged id returns the survivor's data and `mergedInto`.
- [ ] A merge of B into C, when A was merged into B, leaves A pointing at C.
- [ ] A merge of two products with different EANs is refused with a named error code.
- [ ] The harvester handler rewrites the queue rows, and a second delivery of the event
      changes nothing.
- [ ] The core handler leaves one `list_line_items` row when both products were on one
      line.
- [ ] `delete` of a product with a price is refused.
- [ ] `openapi-document.spec.ts` and `wire-types.spec.ts` pass.

## 6. What this plan leaves out

- **Undoing a merge.** The prices of two products cannot be told apart again after they
  moved. A wrong merge is corrected by creating the product again.
- **Merging product groups, brands or shops.** Brands have links (plan `0124`). The other
  two have no merge, and nobody asked for one.
- **The six pairs of October.** Their merged rows are already gone from the first
  catalog. Nothing in a cluster named them, so nothing is lost.
