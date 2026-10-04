> **PR:** [#617](https://github.com/IchirokuXVI/nx-portfolio/pull/617)

# 0185: a product has more than one barcode

> Found by the audit of the first catalog on local slot 1, 2026-10-03.
>
> **Needs plan `0184` first**, for `readGtin`. If it has not landed, stop and say so.
>
> Prerequisite reading: `catalog/src/app/entities/item.entity.ts`, the index `uq_items_ean`
> (migration `1756100000000`), `catalog/src/app/catalog/item.service.ts` (`findByEan`,
> `asEanConflict`, `refuseRepeatedEans`), `harvester/src/app/harvest/matching.ts`
> (`ItemMatchIndex`), `libs/luna-shopper/tools/curation/suggestions/src/decision.mjs`
> (`EAN_CONFLICT`), and backlog plan `0020` (a merged product stays), which moves one EAN.

A maker prints a new barcode when it changes a factory, a supplier or a label, and the
product on the shelf is the same. The catalog holds one EAN per product, so the second
barcode cannot be recorded, and its row stays in the queue for ever.

## Brief for the agent

### Objective

Let a product hold several barcodes, find it by any of them, and let a row whose EAN is
new bind to the product a curator names.

### Context

Read from slot 1 on 2026-10-03:

- 11 Mercadona rows stayed `CANDIDATE`. Among them are "Leche entera Hacendado" 1 L
  (row EAN `8402001047251`, product EAN `8402001002083`), "Leche semidesnatada Hacendado",
  "Refresco Coca-Cola" 2 L and two butters. The same brand, the same name, the same size,
  another barcode. Their prices were not written, so three Córdoba warehouses show no
  price for whole milk.
- The curation gate demotes such a link to REVIEW with `EAN_CONFLICT` (`decision.mjs`,
  lines 366 to 373). The backend itself does not refuse it: `accept` binds the row and the
  second EAN is then recorded nowhere.
- `items.ean` is one nullable column with a partial unique index.

### Target state

1. A catalog table `item_eans (itemId, ean, createdAt)`: `ean` is the primary key, and the
   item is a foreign key with cascade. Every barcode of every product is a row.
2. `items.ean` stays as the product's first barcode, the one a product page shows. It is
   always also a row of `item_eans`. One migration copies every non null `items.ean` into
   the table. The unique index on `items.ean` stays.
3. `ItemService` writes both in one transaction: a create or an update that sets `ean`
   adds the row, and a new admin operation adds or removes a further barcode.
   `findByEan`, the search by barcode and the batch lookups read `item_eans`.
4. The harvester's match index maps every barcode of a product to it, so the next run
   binds the second barcode's row by itself with `matchedBy: EAN`.
5. **Accepting a row teaches its barcode.** When a decision binds a row whose EAN is a
   real one (`readGtin`) to a product that does not hold it, and no other product holds
   it, the harvester asks catalog to add it. When another product holds it, the decision
   is refused with a named code. That is the case that is truly a conflict.
6. The curation gate: a LINK whose row EAN differs from the target's is allowed when brand
   and format agree, and the packet shows every barcode of a candidate. `EAN_CONFLICT`
   stays for a barcode that another product holds. `prompt.md` says so.
7. Admin API: `POST /v1/admin/catalog/items/:id/eans` with `{ ean }` and the matching
   `DELETE`. The item view carries `eans`. The screen is a later admin plan.
8. Regenerated `openapi.json` and `wire-types.ts`.

### Scope

Work only in the catalog (the entity, the migration, `item.service.ts`, the admin
controller), `libs/luna-shopper/contracts`, the harvester (`matching.ts`, the two decision
services, the catalog client), the gateway DTOs and
`libs/luna-shopper/tools/curation/suggestions`.

Do NOT touch: `source_catalog_entries.ean`, velista, the admin app, backlog plan `0020`.

### Constraints

- An in-store code is never a row of `item_eans` (plan `0184`).
- The migration only adds and copies. It deletes nothing.
- Backlog `0020` says a merge moves the merged product's EAN to the survivor when the
  survivor has none, and refuses two different EANs. After this plan a merge can move
  every barcode. Add one paragraph to `0020` that says so. Do not build the merge.
- Only make the changes this plan names.

### Acceptance criteria

- [x] An integration spec on real Postgres: after the migration every product with an EAN
      has one row in `item_eans`. Built for every product with a **real** barcode. See
      "The copy takes real barcodes only" below.
- [x] `findByEan` finds a product by its second barcode.
- [x] A harvester spec: accepting a row with a new real EAN onto a product adds the
      barcode, and a later ingest of a row with that EAN binds it with `matchedBy: EAN`.
      The later ingest is the first sight of a row. See "A queued row is not matched
      again" below.
- [x] A harvester spec: accepting a row whose EAN another product holds is refused with
      the named code, and nothing is written. The codes are `item_ean_held` on the one row
      route and `EAN_HELD` on the bulk route.
- [x] A curation spec: a LINK with a different EAN, the same brand and the same format
      passes. A LINK onto a product while another product holds the row's EAN is refused.
- [x] `openapi-document.spec.ts` and `wire-types.spec.ts` pass.

### Action boundaries

Proceed with code, the migration and specs. Stop and ask before dropping or changing the
`items.ean` column or its index.

### Progress evidence

Report each criterion with its spec output.

## What was built, and what the owner must decide

Every target state is built. The points below are the decisions the builder made, and the
consequences that only the owner can settle.

### The copy takes real barcodes only

The first acceptance criterion says that every product with an EAN has one row. The
constraints say that an in-store code is never a row of `item_eans`. Both cannot hold for
the 211 products that carry an in-store code. The constraint wins.

- If `items.ean` is a real barcode, the migration copies it. A real barcode is digits
  only, 8, 12, 13 or 14 of them, not 13 digits that start with 2, with a valid check digit.
- A product with an in-store code or an invalid code gets no row. Its `items.ean` stays
  exactly as it was. The migration deletes nothing and rewrites nothing.
- The exact rule in the spec is `productGtin(ean) === ean`. A code stored with spaces
  around it is not copied, because the row must equal the column.
- A check constraint on the table refuses an in-store code, whatever writes to it.

**For the owner:** the 211 in-store codes and the 11 invalid codes are still on
`items.ean`. Plan `0186` is the place to clear them.

### What `ean` means on a write

`items.ean` is the first barcode. The builder chose these rules, and the plan does not
state them:

- An update that changes `ean` replaces the first barcode. The old first barcode leaves
  the product. The further barcodes stay.
- An update that clears `ean` promotes the oldest further barcode. So `items.ean` is null
  only for a product with no barcode.
- A removal of the first barcode promotes the oldest further barcode in the same way.
- A product with no first barcode takes the first barcode that it is given.
- `findByEan` and the batch lookup read `item_eans` only. An old in-store code finds
  nothing there. The admin search still finds a product by an old code on `items.ean`.
- `catalog_audit` keys on a uuid, so a further barcode is not a row of the trail. A change
  of `items.ean` is still recorded.

### A queued row is not matched again

The match index maps every barcode of a product. When a run sees a row for the first
time, it binds the row with `matchedBy: EAN`. When a row learns a new EAN, the run does
the same. A row that is already in the queue with its EAN is only touched. So a
`CANDIDATE` row of another chain that already prints the taught barcode stays in the queue.
A person must decide it.

**For the owner:** to bind those rows too, `touch` in `source-ingest.ts` must match an
undecided row again. That file is outside the scope of this plan.

### One barcode on two products of one chain

Plan `0155` found chains that print one EAN on several products, for example five cuts of
one fish. Before this plan a person accepted each cut onto its own product. Now the first
accept gives the barcode to its product. The second accept is refused with `item_ean_held`:
another product holds the barcode.

**For the owner:** decide whether a row that shares its EAN inside its chain must be
exempt from the teaching and from the refusal. The curation tool already sends such a row
to `REVIEW` with `SHARED_EAN`.

### Two barcodes of one product in one chain

`unbindSharedEans` is unchanged. Two rows of one chain with two barcodes of one product do
not share an EAN, so both stay bound. If both rows state a price for the same scope in one
run, the existing rule for two rows of one product applies: no price is sent, and the run
counts a conflict. Rows that are sold in different scopes are not affected.

### A create does not teach

Only an `accept` teaches a barcode. A `createItem` writes the EAN that the operation or
the row gives, as before. If the operation names another EAN, the row's own barcode is not
added to the new product.
