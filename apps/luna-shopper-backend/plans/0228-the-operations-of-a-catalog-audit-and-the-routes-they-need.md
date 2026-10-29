> **PR:** [#863](https://github.com/IchirokuXVI/nx-portfolio/pull/863)

# 0228: the operations of a catalog audit, and the routes they need

> The catalog audit of 2026-10-27 read the 22,203 products of production and kept 879
> proposals over 1,097 of them: new names, brands, sizes, units, pack counts, category
> lists, fourteen splits and fourteen duplicate merges. Its findings are the artifact
> "Velista Catalog Audit"; the analysis of how they reach production is the artifact
> "Velista Audit Import". The owner decided on 2026-10-29 that this is not a tool: an audit
> like this one is applied by the owner, by hand, when earlier curation was wrong, and
> what it needs is clear instructions, the endpoints that carry each operation, and the
> few changes that make an operation possible or safe where it is not today.
>
> This plan is in two halves. Sections 1 and 2 are the instructions, and they need no
> code: they describe the gateway as it stands. Section 3 names each operation that
> cannot be carried out today or is unsafe, and the change that follows for each.
> Section 4 is the order and the acceptance criteria of those changes.
>
> Prerequisite reading: plans `0186` and `0192` (how every curated change so far was
> written, and the rules each check comes from), `0191` (what an accept does to the
> product a row leaves), `0183` (the unit rules the service left to the tools), `0184`
> (what a created product must carry), `0166` (categories are rows, a product has
> several), `0075` (the audit trail), `0115` and `0124` (brands and links), backlog
> `0020` (a merge that keeps the merged row), the register
> `apps/luna-shopper-backend/docs/first-catalog-decisions-2026-10/README.md` (rules R1 to
> R33), `gateway/src/app/catalog/catalog.dto.ts` (`UpdateItemDto`, `CreateItemDto`,
> `UpdateItemsDto`), `gateway/src/app/catalog/catalog-admin.controller.ts`,
> `gateway/src/app/harvest/harvest.dto.ts` (`SourceEntryExpectationDto`, the pattern
> section 3.2 copies) and `catalog/src/app/catalog/item.service.ts` (`applyUpdates`,
> `applyEdits`, `applyBrand`).

## Brief for the agent

### Objective

Make every operation of a catalog audit either possible through the admin API or
refused by it with a named reason, so that an operator can apply such an audit from
these instructions alone, with the service enforcing the rules the register wrote down
rather than the operator remembering them.

### Context

- **What the audit file holds.** One proposal per finding, with `kind` (`RENAME`,
  `RECATEGORIZE`, `SIZE`, `BRAND`, `SPLIT`, `DUPLICATE`, `OTHER`), `verdict` (`ACCEPT`,
  `AMEND`, `UNVERIFIED`), a `change` object, prose, and the rows as the audit read them:
  `id`, `nameEs`, `nameEn`, `brand`, `size`, `unit`, `pack`, `categories` (slugs) and one
  price per chain. The ids are production ids, so a write by id is possible. The audit
  itself is not in the repository, and this plan does not put it there.
- **What exists.** `PATCH /v1/admin/catalog/items/batch` carries every field edit, at most
  1,000 entries and 2 MB in one call, all or nothing. `POST /v1/admin/catalog/items/batch`
  creates products the same way. `DELETE /v1/admin/catalog/items/:id` is a hard delete.
  `POST /v1/admin/harvest/entries/:id/accept` moves a queue row to another product and
  settles the one it left (plan `0191`). The reads an operator needs exist one product at
  a time. Section 2 lists each route.
- **What does not exist, or is unsafe.** There is no merge (backlog `0020`). A batch entry
  cannot say what state it expects, so a product that a harvest rewrote after the audit
  is overwritten without a word. The service accepts a sized `KILOGRAM`, a `LITER` and a
  `PACK`, which plan `0183` left to the tools; the audit asked for twenty such writes and
  nothing would have refused them. An item route takes category ids only, derived from
  slugs by `uuidv5`. A category change is not written to `catalog_audit`. A brand the
  registry does not hold is stored as free text with `brandId` null and nothing says so.
  An admin token has no bulk read: `POST /v1/catalog/items/lookup` is behind the
  shopper guard.
- **What the rules say.** R8: every change goes through the admin API, SQL is for
  reading. R9: no `LITER`, no sized `KILOGRAM`. R17: a name patch sends both languages.
  R1, R15, R25: a merge is accept then delete, the kept product holds the barcode or the
  price, a delete cascades duplicates only. R31, R32: a size worked out from a price is
  not proof; a printed size wins. R52, R60: a brand the registry lacks is a person's
  decision.

### Target state

| Operation | Today | After this plan |
| --- | --- | --- |
| Rename, brand, size, unit, pack count | One batch entry each; nothing checks the product is still what the audit saw | The same entry, with an `expect` that the service compares before it writes (3.2) |
| Replace categories | Ids only, derived from slugs by hand; the change is not audited | `categorySlugs` accepted beside `categoryIds` (3.4); before and after in `catalog_audit` (3.5) |
| A unit the rules forbid | Accepted | `LITER`, `PACK` and a sized `KILOGRAM` refused with a named code (3.3) |
| A brand the registry lacks | Stored silently as text | Refused when the batch says `requireRegisteredBrands` (3.6) |
| Read many products | One request per product, 120 a minute | `POST /v1/admin/catalog/items/lookup`, up to 1,000 ids, read through (3.7) |
| Split | A create batch and a rename; nothing to build | The same, in the instructions (2.6) |
| Merge | None. Accept each row, then delete, by hand | Backlog `0020`, picked up as its own plan; this plan states what the audit needs from it (3.1) |

### Scope

- Work only in `apps/luna-shopper-backend/catalog/`, `apps/luna-shopper-backend/gateway/`,
  `libs/luna-shopper/contracts/`, the generated `gateway/docs/openapi.json` and
  `libs/luna-shopper-admin/models/src/lib/wire/wire-types.ts` (both regenerated, never
  edited).
- Do NOT touch: the harvester, core, the back office, the release tasks, `k8s/`, any
  existing migration, backlog plan `0020` (it moves into `plans/` as its own plan, with
  the next free number, when the owner schedules it), the register and its data files.

### Constraints

- Only make the changes section 3 names. Each one is small, and each has a spec.
- The harvester's writes do not change in behaviour. It creates products from rows
  through `sourceEntry.createItem`, which already normalizes units (`toBaseUnit`) and
  stores a printed brand the registry lacks on purpose. 3.3 must not refuse what the
  harvester sends today, and 3.6 is opt in.
- Regenerate `openapi.json` and the wire types, as `CLAUDE.md` describes. A new error
  code is added where the others are (`libs/luna-shopper/contracts`) and reaches the
  document.
- The instructions of sections 1 and 2 describe the gateway as it is. Where section 3
  changes a route, section 2 says "after 3.x" beside the new form.

### Action boundaries

- Proceed with sections 3.2 to 3.7, their specs and the regeneration.
- Stop and ask before any change to the harvester's own create path, to the public
  `ItemView`, or to any read a shopper uses.
- Section 3.1 builds nothing. If the owner wants merges in this round, backlog `0020`
  is picked up as a plan of its own first.

### Progress evidence

Report each acceptance criterion of section 4 with the command and its output, and one
walk of section 1 against a local slot: a batch with a wrong `expect` refused, a batch
with a right one applied, a sized `KILOGRAM` refused, a `categorySlugs` edit applied and
its `catalog_audit` row read back.

## 1. How an operator writes an audit to a cluster

This section is the procedure. It is the one plans `0186` and `0192` followed, written
once so that it does not live in a git ignored folder again.

### 1.1 Before the first write

1. **Back up.** `kubectl create job --from=cronjob/luna-shopper-backend-catalog-db-backup`
   on the VPS as `deploy`, and the same for the harvester. The nightly dumps are kept 14
   days; this one is the state before the audit.
2. **Staging first.** Staging was restored from the same dumps as production on
   2026-10-07, so every product that neither cluster created since has the same id in
   both. Apply the whole audit to staging, read the checks of 1.5, then production.
3. **Sign in as a named operator.** `POST /v1/admin/auth/login` with the operator's own
   username, so that `catalog_audit` names who wrote. The token lasts 15 minutes;
   `POST /v1/admin/auth/refresh` with the current token answers a new one. Sign in at
   most once per 15 seconds (the login bucket is 5 a minute), and stay under 100
   requests a minute (the bucket is 120). The password is typed at a prompt or read from
   an environment variable, never written on a command line.
4. **Prepare the entries from the audit**, one per product. Rules 2.1 to 2.5 say what
   each kind becomes. A product that is in two proposals gets one entry with both
   changes, because the batch refuses a product named twice. A product whose proposals
   disagree on one field (the audit has ten, all category lists) is left for the owner.
5. **Keep a log.** One file per step, one line per call, with the body sent and the
   answer, in a folder of the operator's own (`.curation-runs/` is git ignored). The
   register of the first catalog is built from such logs.

### 1.2 Read before every write

- `GET /v1/admin/catalog/items/:id`: the product as it stands (`name`, `brand`,
  `unitSize`, `defaultUnit`, `packCount`, `ean`, `eans`, `categories[].slug`). After 3.7,
  `POST /v1/admin/catalog/items/lookup` reads up to 1,000 at once.
- `GET /v1/admin/catalog/items/:id/prices`: its price rows, for a merge.
- `GET /v1/admin/harvest/items/:itemId/entries`: the queue rows bound to it, with
  `soldByWeight`, `sizeFormat`, `packCount` and the chain. Read them before any change
  to a unit (R31, R32) and before any merge.
- `GET /v1/catalog/categories`: the tree, once. A product attaches to a leaf only.
- `GET /v1/admin/catalog/brands?query=<label>`: whether a label is registered, and
  whether it is a spelling of another brand (`canonicalBrandId`).

A product whose read differs from the audit's row in any field the entry does not
change has moved on since the audit. Leave it, and write down why. After 3.2 the
service makes this check itself from the `expect` of the entry.

### 1.3 Write in this order

1. **Field edits**, in `PATCH /v1/admin/catalog/items/batch` calls of at most 1,000
   entries and under 2 MB. One refused batch writes nothing; fix the entry it names and
   send the batch again.
2. **Splits**, one at a time (2.6).
3. **Merges**, one pair at a time (2.7), only when the owner has accepted what a delete
   costs, or after backlog `0020` is built.

### 1.4 After the last write

Read every product of the audit again and compare with the entries. Count `items`,
the products whose name changed, and the products whose categories changed, through the
gateway. Write the counts, the entries left and the reason for each into the register
folder as the next data file, in the format its README describes, with the proposal ids
of the audit as `from`.

### 1.5 The checks

Read only, on the catalog database, as `deploy` on the VPS:
`kubectl -n luna-shopper exec -i luna-shopper-backend-catalog-db-0 -- psql -U luna_catalog -d luna_catalog`.
The first four are the checks of plan `0186`; the last two are the two script counted
patterns of the audit that are mechanical.

```sql
-- A1: no English name
select count(*) from items where coalesce(name->>'en','') = '';
-- A3: units the rules forbid
select "defaultUnit", count(*) from items
 where "defaultUnit" in ('LITER','PACK') or ("defaultUnit" = 'KILOGRAM' and "unitSize" is not null)
 group by 1;
-- A6: the same brand, name, size, unit and pack count twice
select count(*) from (select 1 from items
  group by "brandId", lower(name->>'es'), "unitSize", "defaultUnit", "packCount"
  having count(*) > 1) t;
-- B1: a product sold by the kilo whose price is not its per kilo price
select count(*) from item_prices p join items i on i.id = p."itemId"
 where i."defaultUnit" = 'KILOGRAM' and i."unitSize" is null
   and (p.price is null or p.price <> round(p."unitPrice", 2));
-- The audit's nameEnLower: an English name that starts in lower case
select id, name->>'en' from items where name->>'en' ~ '^[a-z]';
-- The audit's exactDuplicates: equal in brand, both names, size, unit and pack count
select count(*) from (select 1 from items
  group by "brandId", lower(name->>'es'), lower(name->>'en'), "unitSize", "defaultUnit", "packCount"
  having count(*) > 1) t;
```

The other five patterns the audit counted (291 products sized `1 UNIT`, 279 names that
carry a size, 289 English names equal to the Spanish, 122 whose size equals the pack
count, 11,794 with no price) are not lists in the audit and are not mechanical: rule R16
takes a size from the queue rows, rules R45 and R46 keep a measure in a name that tells
two products apart, and a perfume's name is the same in both languages by rule R27. Each
needs a read and a person.

## 2. Each operation, as the gateway carries it today

Every route is behind `AdminJwtGuard`. Field names are those of `UpdateItemDto`. The
examples are proposals of the audit, with their production ids.

### 2.1 Rename

**Supported.** `PATCH /v1/admin/catalog/items/batch`, field `name: { es, en }`.

```json
{ "items": [
  { "itemId": "4e01712e-7879-4d63-9217-ac10d937374b",
    "name": { "es": "Yogur 0% con trozos de melocotón", "en": "0% yoghurt with peach pieces" } }
] }
```

- **Send both languages.** `applyEdits` assigns the whole `name` (`item.service.ts:2377`),
  and the DTO refuses `null` for a locale. A proposal that changes one language (the
  audit has 199) is completed from the audit's own row. Rule R17.
- Each half is at most 200 characters and non blank.
- Eighteen proposals give one name to several rows. Before the batch, check A6 in
  memory: no two products may end equal in brand, Spanish name, size, unit and pack
  count.

### 2.2 Brand

**Supported.** The same batch, field `brand`, a label string or `null`. No route takes a
`brandId` on a product.

```json
{ "items": [ { "itemId": "063628a4-ff9b-4165-967a-04d67cb7f6bb", "brand": "Pierrot" } ] }
```

- Catalog keys the text with `brandKey`. A registered key stores the registry's label and
  `brandId`; a spelling resolves to its canonical brand. **An unregistered label is
  stored as free text with `brandId` null, and nothing says so** (`applyBrand`,
  `item.service.ts:2487`). Read `GET /v1/admin/catalog/brands?query=` first. After 3.6,
  send `requireRegisteredBrands: true` and the batch refuses such a label itself.
- `"(none)"` in the audit means no brand: send `null`.
- A label the registry lacks is a brand decision (R52, R60):
  `POST /v1/admin/catalog/brands/register-many` registers up to 200, or the products are
  left. When the finding is "X is a spelling of Y" (Pierrot Piwy, Obrador Deza), the
  right write is `PATCH /v1/admin/catalog/brands/:id { "canonicalBrandId": "<Y>" }`: it
  moves every product of X at once (`movedItems`) and the next harvest resolves the same
  way. A link is one level deep (`brand_link_too_deep`, R21).

### 2.3 Size, unit and pack count

**Supported, and the rules are the operator's until 3.3.** The same batch, fields
`unitSize` (number or null), `defaultUnit`, `packCount` (2 to 1000, or null).

```json
{ "items": [
  { "itemId": "e5713f5e-ca25-43eb-a341-052c2c06f429", "defaultUnit": "KILOGRAM", "unitSize": null }
] }
```

- A `KILOGRAM` product has no size (R9, `toBaseUnit` of plan `0183`). The audit's twenty
  `unit: "KILOGRAM"` proposals keep the row's size; the entry sets `unitSize: null`. A
  `5 KILOGRAM` is `5000 GRAM`. `LITER` and `PACK` are never written.
- `pack: 0` in the audit means no pack count: send `null`. The DTO refuses 0 and 1.
- Nineteen of the twenty `KILOGRAM` proposals infer "sold by weight" from a price that
  looks like a per kilo price. Read the queue rows first: a bound row that says
  `soldByWeight` false and prints a fixed `sizeFormat` contradicts the proposal, and the
  product is left (R31, R32).
- No price is recomputed on an item update. A product that becomes `KILOGRAM` keeps the
  pack price it had, which check B1 counts until the next run of the chain writes the
  per kilo price (plan `0181`).

### 2.4 Categories

**Supported, with an id lookup.** The same batch, field `categoryIds`: 1 to 10 leaf
uuids, the whole set replaced in the order given.

```json
{ "items": [
  { "itemId": "3ec4a7fe-bfaa-40fa-a5e0-ffe246a3e727",
    "categoryIds": ["9aa24ae9-19c9-5583-a093-b97cb81771c4"] }
] }
```

- The id of a slug is `uuidv5("category:" + slug, "6f9d2c41-3b7a-4e58-9c2d-8a1f5b0e7d34")`
  (`catalog/src/app/db/taxonomy/ids.ts`), or read once from `GET /v1/catalog/categories`.
  `small-appliances` is `9aa24ae9-19c9-5583-a093-b97cb81771c4`. After 3.4 the entry sends
  `categorySlugs: ["small-appliances"]` instead.
- A category change is not written to `catalog_audit` today (3.5). The operator's log
  is the only record of it until then.
- The back office does this one in bulk already: "Set categories" on ticked rows sends
  exactly this batch, for the rows on screen.

### 2.5 Entries that fold several proposals

One product, one entry, every field it changes. The order of fields does not matter;
the entry is one object.

```json
{ "itemId": "...", "name": { "es": "...", "en": "..." }, "brand": "Bugles",
  "unitSize": 85, "defaultUnit": "GRAM", "packCount": null, "categoryIds": ["..."] }
```

### 2.6 Split

**Composed from two calls. Nothing to build.**

1. `POST /v1/admin/catalog/items/batch` creates the new variants. A create needs `name`,
   `categoryIds` (or `categorySlugs` after 3.4) and `defaultUnit`; copy `brand`,
   `unitSize` and `packCount` from the original. The answer lists the created products
   in order; log their ids.
2. `PATCH /v1/admin/catalog/items/batch` renames the original to the variant it keeps.

The chain lists one article. Its queue row, its price and its availability stay on the
original; the new variants have no source and no price, and no harvest binds one. The
register's rules agree that "gris, negra o blanca" is several products (R50, R51) and
leave the choice to a person. Which variant keeps the row is the owner's, per split.

### 2.7 Merge

**No operation exists.** Until backlog `0020` is built, a merge is the procedure of plan
`0192` (R1, R15, R25), one pair at a time:

1. `GET /v1/admin/harvest/items/:loser/entries`. For each bound row,
   `POST /v1/admin/harvest/entries/:id/accept { "itemId": "<survivor>" }`. The accept
   rebinds the row, writes its open prices on the survivor, moves the barcode the row
   taught, and settles the loser (plan `0191`).
2. Read both products' prices. Each price row of the loser must now be on the survivor
   with the same source kind, scope, price, unit price and validity (R1). If one is not,
   stop: the loser is not deleted.
3. A barcode still on the loser and not on the survivor:
   `DELETE /v1/admin/catalog/items/:loser/eans/:ean`, then
   `POST /v1/admin/catalog/items/:survivor/eans { "ean": "..." }`.
4. `DELETE /v1/admin/catalog/items/:loser`.
5. Read again: the loser answers 404 and holds no queue row.

**What the delete costs in a cluster with shoppers.** `ItemService.delete` is a hard
delete with no event. Core names a product in `list_line_items.itemId`,
`list_lines.favoriteItemId`, `list_line_group_removals.itemId` and
`line_settlements.itemId` with no foreign key, and `getMany` leaves a missing id out of
its answer, so a shopper's line loses its product and nobody is told. On slot 1 that cost
nothing; production has shoppers. That is why the merge is section 3.1 and not an
instruction alone.

Two of the audit's fourteen pairs are not plain merges: proposal 1605 (kiwi) has a
Mercadona row on each side, so the survivor would hold two articles of one chain (R28;
plan `0191` target 6 binds the second and withholds its price); proposal 1030 pairs
80 ml with 300 ml, two products by rule 1 of the curation prompt.

## 3. What cannot be carried out, or is unsafe, and the change for each

### 3.1 Merge: backlog plan `0020`, picked up as its own plan

Nothing in this plan builds it. When the owner schedules it, backlog `0020` moves into
`plans/` with the next free number, and this is what the audit needs from it, beyond what
the backlog text already states:

- A gateway route, `POST /v1/admin/catalog/items/:id/merge` with body
  `{ "intoItemId": "<survivor>", "dryRun": false }`, on the message `item.merge` the
  backlog plan designs. The answer names what moved: price rows, shop rows, barcodes,
  queue rows (through the event), and the `mergedIntoId` set. A `dryRun` answers the
  same and writes nothing, as the settle route does.
- The two refusals the audit met: `item_merge_two_articles_one_chain` when both products
  hold a bound row of the same chain (R28), unless the body says
  `allowSecondArticle: true`; and `item_merge_format_differs` when size or unit differ,
  unless `allowFormatDifference: true`. Both are the owner's to override, per pair.
- Under plan `0185` a merge moves every barcode row, and a product with two different
  first barcodes is not refused.

Until it is built, the fourteen merges of the audit wait, or the owner accepts 2.7 in
writing in the data plan that runs the audit.

### 3.2 A batch entry states what it expects

**Problem.** A product that a harvest rewrote after the audit is overwritten by an entry
made from stale rows, and nothing says so. The read of 1.2 catches it only until the
next write of the harvester lands between the read and the batch.

**Change.** `UpdateItemBatchEntryDto` and `UpdateItemDto` take an optional `expect`, in
the shape `SourceEntryExpectationDto` gave the decisions route (plan `0166`, section 3,
and the harvest DTO):

```ts
export class ItemExpectationDto {
  @IsOptional() @ValidateNested() @Type(() => LocalizedTextDto) name?: LocalizedTextDto;
  @IsOptional() @IsString() @MaxLength(120) brand?: string | null;
  @IsOptional() @IsNumber() unitSize?: number | null;
  @IsOptional() @IsEnum(UnitOfMeasure) defaultUnit?: UnitOfMeasure;
  @IsOptional() @IsInt() packCount?: number | null;
  @IsOptional() @IsArray() @IsString({ each: true }) categorySlugs?: string[];
}
```

- Every field is optional. A field that is present is compared with the row inside the
  transaction, before any edit of the batch is applied: `name` as both halves after
  trimming, `brand` by `brandKey` (so `Pierrot` and `PIERROT` agree), `categorySlugs` as
  an ordered list. `null` means "the row holds nothing here".
- One mismatch refuses the whole batch, as a wrong `categoryId` does today, with the code
  `item_expectation_failed` and, in the error detail, each `itemId` that failed and the
  fields that differed with the row's value. `UpdateItemInput` in the contracts gains the
  same `expect`.
- A single `PATCH /v1/admin/catalog/items/:id` takes it too.
- Spec: an integration spec on real Postgres, one entry with a right `expect` writes, one
  with a wrong `brand` refuses the batch and leaves the first product untouched, one with
  `categorySlugs` in another order refuses.

### 3.3 The unit rules the service left to the tools

**Problem.** Plan `0183` chose: "The gateway DTOs and the catalog service do not change:
an admin can still write any unit by hand." The audit asked for twenty sized `KILOGRAM`
writes and one `5 KILOGRAM`. An operator who follows the audit's `change` object as
written puts rows into the catalog that check A3 then counts. The register's rule R9
says such rows are not stored.

**Change.** `item.create`, `item.createMany`, `item.update` and `item.updateMany` refuse,
after the edit is applied to the row in memory and before it is saved:

- `defaultUnit` `LITER` or `PACK`: `item_unit_not_base`, with the unit that was sent and
  the unit it becomes (`MILLILITER`, `UNIT`).
- `defaultUnit` `KILOGRAM` with `unitSize` not null: `item_kilogram_has_size`, with the
  grams it would be.

The check reads the row as it will be saved, so an entry that sets `defaultUnit` alone on
a sized product is refused, which is the audit's case. `sourceEntry.createItem` in the
harvester normalizes with `toBaseUnit` before it sends and is not affected; the spec
proves it with the fixtures of `file-import.integration.spec.ts`. No migration: the
first catalog holds no such row (check A3 reads 0, plan `0186`), and a cluster that holds
one keeps it until a write touches it. The two codes are added where the others are and
reach `openapi.json`.

### 3.4 Category slugs on the item routes

**Problem.** `CreateItemDto` and `UpdateItemDto` take `categoryIds` only. The slugs are
what the audit, the register and the harvester's create-from-row speak; the id is derived
by a `uuidv5` that lives in the service's taxonomy folder.

**Change.** Both DTOs take `categorySlugs?: string[]` (1 to 10) beside `categoryIds`.
Exactly one of the two is sent, else `validation_failed`. The service resolves slugs
through the category rows (`category_not_found`, `category_not_a_leaf`, as for ids) and
continues as today. `CreateItemInput` and `UpdateItemInput` in the contracts gain the
field. The back office keeps sending ids.

### 3.5 A category change is audited

**Problem.** `setItemCategories` runs raw SQL on `item_categories` outside the audit
write (`category.service.ts:349`). A product's category history is in nobody's record,
and plan `0075` says every operator change is.

**Change.** In `applyUpdates` and in the create path, the category write happens inside
the same `audit.write` as the field edits, and the diff carries `categories` as before
and after lists of slugs, in order. A `categoryIds` that equals the current set, in the
same order, is not a change and writes no audit row for it. An integration spec reads
the `catalog_audit` row after a category edit and finds both lists.

### 3.6 A batch that refuses a brand the registry lacks

**Problem.** `applyBrand` stores an unregistered label as text with `brandId` null. For
the harvester that is right: a printed brand is a reading, and the queue sends the row to
a person (plan `0178`). For an operator who writes sixty labels from an audit it is a
silent wrong state: forty of the audit's labels appear nowhere else in it.

**Change.** `UpdateItemsDto` and `CreateItemsDto` take `requireRegisteredBrands?: boolean`,
default false. When true, a label whose key is not registered, and is not a spelling of a
registered brand, refuses the whole batch with `brand_unregistered` and the labels that
failed. A `null` brand passes. `UpdateManyItemsRequest` and `CreateManyItemsRequest`
gain the flag; the harvester never sends it.

### 3.7 An admin read of many products

**Problem.** `POST /v1/catalog/items/lookup` reads many ids at once but is behind
`JwtAuthGuard`, the shopper's token; an admin token is refused. The operator reads 1,100
products one at a time, at 100 a minute.

**Change.** `POST /v1/admin/catalog/items/lookup { "ids": [...] }`, up to 1,000 ids,
behind `AdminJwtGuard`, on the message `item.getMany` the public lookup uses. Unknown ids
are absent from the answer, as there. It answers `ItemView[]` with `categories[].slug`
and `eans`, which is what 1.2 compares. **Read the public route first**: its comment says
it resolves like a search and shares its cache, and an admin read that answers a cached
view is wrong under 3.2. The admin lookup reads through to catalog on every call.

## 4. Order and acceptance

Build in the order 3.2, 3.3, 3.4, 3.5, 3.6, 3.7. Each is one commit with its spec. Then
regenerate the document and the wire types.

- [ ] `npx nx run luna-shopper-backend-catalog:test`, `luna-shopper-backend-gateway:test`
      and `luna-shopper-admin/models:test` pass, including `openapi-document.spec.ts` and
      `wire-types.spec.ts` on the regenerated files.
- [ ] 3.2: a batch with a wrong `expect` on one entry writes nothing and names the entry,
      the field and the row's value; a right `expect` writes; `brand` compares by key.
- [ ] 3.3: `{ "defaultUnit": "KILOGRAM" }` on a product sized 4000 `GRAM` is refused with
      `item_kilogram_has_size`; with `"unitSize": null` it is applied; `LITER` is refused
      on create and update; the harvester's file import fixtures still create their
      products.
- [ ] 3.4: `categorySlugs: ["small-appliances"]` writes the same row `categoryIds` with
      its id does; both at once is `validation_failed`; a root slug is
      `category_not_a_leaf`.
- [ ] 3.5: a category edit leaves one `catalog_audit` row with `before.categories` and
      `after.categories` as slug lists; an unchanged set leaves none.
- [ ] 3.6: a batch with `requireRegisteredBrands: true` and one label the registry lacks
      is refused with `brand_unregistered` naming it; the same batch without the flag
      writes the label with `brandId` null, as today; a spelling passes and stores the
      canonical label.
- [ ] 3.7: an admin token reads 1,000 ids in one call and a shopper token is refused;
      the answer reflects a write made one second earlier.
- [ ] The walk of the progress evidence on a local slot.

## 5. What this plan does not do

- **Build the merge.** Backlog `0020`, as 3.1 says.
- **Run the audit.** The run in a cluster is a data plan of its own, as `0186` and `0192`
  were: it names the verdicts that ship (`ACCEPT` alone is 457 proposals; with `AMEND`,
  825; the 54 `UNVERIFIED` stay out unless named), answers the ten category conflicts,
  decides each split and each brand the registry lacks, and says whether the fourteen
  merges wait for `0020` or run by 2.7.
- **Store the audit file.** It stays with the owner. The register folder takes the data
  file of what was applied (1.4), as it did for the first catalog.
- **A merge screen in the back office.** It is admin work and a plan of its own, named by
  backlog `0020`.
- **The five patterns of 1.5 that need a person.**
