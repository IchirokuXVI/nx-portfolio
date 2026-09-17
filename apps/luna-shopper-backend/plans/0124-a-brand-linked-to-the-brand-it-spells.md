> **PR:** [#409](https://github.com/IchirokuXVI/nx-portfolio/pull/409)

# 0124 A brand linked to the brand it spells

> Client halves: `apps/luna-shopper-admin/plans/0032` (the back office) and
> `libs/luna-shopper/tools/curation/suggestions/plans/0005` (the curator). Both read what this
> plan adds, so this plan is built and deployed first.
>
> `DEBORAH` and `DEBORAH 48H` are one brand. The registry from plan `0115` cannot say so: a brand
> holds exactly one key, so `deborah48h` either becomes a second brand or stays a suggestion
> forever. Registering the suggestion `DEBORAH 48H` under the name `Deborah` today creates a
> brand with the key `deborah`, links the products carrying `deborah`, leaves every product
> carrying `deborah48h` without a brand, and puts the suggestion back on the list at the next
> read. This plan lets a registered brand point at the brand it is really a spelling of, one
> level deep, and moves the products with it. It also gives the source products list a brand
> key filter, which the back office needs to open a suggestion's products.
>
> Prerequisite reading: `0115` in full (sections 3 to 5 and 9 above all), `0086` (source
> entries), and the memory notes on raw SQL in TypeORM and on integration specs.

## Brief for the agent

### Objective

Add `brands.canonicalBrandId` and everything in sections 2 to 7: the one level rule, the item
writes that follow a link, the link and unlink moves, the register suggestion route, the
`BrandView` fields, and the `brandKey` filter on `GET /v1/admin/harvest/entries`. Prove the SQL
with integration specs and regenerate the OpenAPI document and the wire types.

### Context

- `Brand` (`catalog/src/app/entities/brand.entity.ts`) has `key` (varchar 120, unique
  `uq_brands_key`), `label` (varchar 120) and `privateLabelSupermarketId` (uuid null, FK to
  `supermarkets`, `ON DELETE SET NULL`), plus the `BaseEntity` columns. There is no delete.
- The latest catalog migration is `1757500000000-ScopeCopies.ts`. The latest harvester migration is
  `1757400000000-RunPresets.ts`.
- `BrandService` (`catalog/src/app/catalog/brand.service.ts`):
  - `create` (:96) runs `requireAdmin`, trims, `requireKey`, then inside `audit.write` creates
    the row and calls `linkUnlinkedItems`. A 23505 becomes `BrandKeyTakenException` with
    `details.brandId` (`asKeyTaken`, :342).
  - `update` (:127) rewrites `items.brand` **and `items.brandKey`** for every item whose
    `brandId` is this brand when the label is sent, then links unlinked items for a changed key.
  - `list` (:180) is raw SQL with a grouped item count, filters `query` and
    `privateLabelSupermarketId`, orders `label` or `itemCount` with a keyset cursor.
  - `keys` (:277) answers every key. `linkUnlinkedItems` (:305) sets `brandId` and `brand` where
    `brandKey` matches and `brandId` is null.
- `ItemService` resolves the brand at write time: `registeredBrands(texts)` (:1096) loads brands
  by key, and `applyBrand` (:1132) sets `brand` to the registered label, `brandKey` to the key
  and `brandId` to the registered id. Create (:167), `createMany` (:225, :241) and update (:295)
  use it.
- `toBrandView` is `catalog.mappers.ts:234`. `BrandView`, `CreateBrandRequest`,
  `UpdateBrandRequest`, `ListBrandsRequest` and `BRAND_PATTERNS` are in
  `libs/luna-shopper/contracts/src/lib/messages/catalog.messages.ts` (:574, :1434, :1446, :1457,
  :209), with schemas in `schemas/messages/catalog.schemas.ts`.
- The gateway brand routes are `AdminCatalogBrandsController` (`catalog-admin.controller.ts:567`).
  `CreateBrandDto` and `UpdateBrandDto` are in `gateway/src/app/catalog/catalog.dto.ts` (:1262,
  :1291). `GET :id/spellings` (:615) sends `brandSpellings` with `keys: [brand.key]`. The
  suggestions route (:689) sends every key from `brand.keys` as `registeredKeys`.
- Error codes live in `libs/luna-shopper/platform/src/lib/errors/`: `error-codes.ts` (codes and
  HTTP statuses), `error-catalog.ts` (messages), `domain-exception.ts` (exceptions).
- Source entries: `SourceEntryService.list` (`harvester/src/app/harvest/source-entry.service.ts`,
  :169) filters `supermarketId`, `status` (absent means `CANDIDATE` and `UNRESOLVED`),
  `sourceKind` and `query`. `SourceEntryListQueryDto` is `gateway/src/app/harvest/harvest.dto.ts`
  :656, and the validation pipe forbids unknown properties. `ListSourceEntriesRequest` is
  `harvest.messages.ts` :1136. The partial index
  `ix_source_catalog_entries_queued_brand_key` covers `brandKey` on queued rows only.
- Specs: `brands.integration.spec.ts` and `item.service.spec.ts` (catalog),
  `brands.http.spec.ts` (gateway), `brand-suggestions.integration.spec.ts` and
  `source-entry.service.spec.ts` (harvester). Integration specs run under `test-integration`.

### Target state

Every acceptance criterion in section 10 holds, and
`npx nx run-many -t lint test -p luna-shopper-backend-catalog luna-shopper-backend-gateway luna-shopper-backend-harvester luna-shopper/contracts luna-shopper/platform luna-shopper-admin/models`
plus `test-integration` on the catalog and the harvester are green, with `openapi.json` and the
wire types regenerated.

### Scope

- Work only in: the catalog `brands` entity, one new catalog migration, `brand.service.ts`,
  `item.service.ts` (`registeredBrands` and `applyBrand` only), `catalog.mappers.ts`, the
  catalog brand message handlers, `libs/luna-shopper/contracts` (brand and source entry
  messages and schemas), `libs/luna-shopper/platform` errors, the gateway brand controllers and
  DTOs, the harvest entries DTO, `SourceEntryService.list`, their specs, and the generated
  `openapi.json` and `wire-types.ts`.
- Do NOT touch: the back office, the curation tool, velista, `items` columns, the harvester
  schema, the suggestion SQL, or any brand key rule in `brandKey`.

### Constraints

- One level. A link never points at a linked brand, and a brand that others point at is never
  linked itself. The service enforces it under row locks (section 3), not the client.
- `items.brandKey` is always the key of the item's own brand text, never the canonical key. It
  is what lets an unlink move products back (section 4).
- Moving products writes no per item audit row, the rule `0115` set for linking. The brand's own
  `UPDATE` or `CREATE` audit row is the record.
- Every new query value lives on its DTO (memory note on sibling query params).
- Regenerate `openapi.json` and the wire types with their generators, never by hand.

### Action boundaries

- Proceed with in scope edits, the migration, unit and integration specs, and the generators.
- Stop and ask if the one level rule cannot be enforced without a database trigger, or if a
  move in section 4 turns out to need a column this plan does not add.

### Progress evidence

Report after the migration and the one level rule with their integration spec, after the item
moves with theirs, after the register suggestion route with its HTTP spec, and after the source
entries filter.

## 1. What is being built

| Piece                                                | Where                                         |
| ---------------------------------------------------- | --------------------------------------------- |
| `brands.canonicalBrandId`                            | catalog entity and a new migration            |
| The one level rule, three refusal codes              | `BrandService`, platform errors               |
| Item writes that follow a link                       | `ItemService.applyBrand`                      |
| Link, relink and unlink move products                | `BrandService.update`                         |
| `POST /v1/admin/catalog/brands/register-suggestion`  | gateway, `BRAND_PATTERNS.registerSuggestion`  |
| `canonicalBrandId`, `canonicalLabel`, `linkCount`    | `BrandView`, list filter `canonicalBrandId`   |
| Spellings of a brand include its links               | `GET :id/spellings`                           |
| `brandKey` filter on source entries                  | gateway DTO, contracts, `SourceEntryService`  |

## 2. The column

`brands.canonicalBrandId` uuid null, FK `brands(id)` `ON DELETE SET NULL`, index
`ix_brands_canonical`, and a check `ck_brands_not_own_canonical` that it never equals `id`.

**The canonical brand of a brand** is the one its `canonicalBrandId` names, or the brand itself
when the column is null. Everything below reads "canonical" in that sense.

A linked brand keeps its own row, key and label. That is the record the user asked to keep:
`DEBORAH 48H` stays registered, so its key stops being a suggestion (`brand.keys` already
answers every row's key) and the curator can recognise it (curation plan `0005`).

**A linked brand owns no private label chain.** Its canonical brand's chain is the one that
counts. Linking a brand clears its `privateLabelSupermarketId`, and a create or update that sets
both a chain and a link on one brand is refused with `brand_link_owns_no_chain` (400).

## 3. The one level rule

A request that sets `canonicalBrandId` to `T` on brand `B` is refused when:

| Condition                                  | Code                         | Status |
| ------------------------------------------ | ---------------------------- | ------ |
| `T` is `B`                                 | `brand_link_to_self`         | 400    |
| `T` itself has a `canonicalBrandId`        | `brand_link_too_deep`        | 409    |
| some brand already has `canonicalBrandId = B` | `brand_link_too_deep`     | 409    |
| `T` does not exist                         | the usual not found          | 404    |

`brand_link_too_deep` carries `details.brandId`, naming the brand that breaks the rule (`T` in the
first case, one linking brand in the second), so the back office can open it.

**Checked under locks.** Inside the transaction, lock `B` and `T` with `SELECT ... FOR UPDATE` in
id order, then check both conditions. Two concurrent requests linking `A` to `B` and `B` to `C`
then serialise, and the second sees the first.

## 4. Products follow the link

### 4.1 Writing an item

`registeredBrands` also loads the canonical brand of every brand it finds. `applyBrand` then
writes:

- `brandKey`: the key of the text, as today.
- `brandId`: the canonical brand's id.
- `brand`: the canonical brand's label.

So a harvested product printed `DEBORAH 48H` reads `Deborah` and belongs to `Deborah` from the
moment it is written.

`linkUnlinkedItems(brand)` does the same: it sets `brandId` and `brand` from the canonical brand
of `brand`, for items whose `brandKey` is `brand.key` and whose `brandId` is null.

### 4.2 Link, relink and unlink

When an update changes `canonicalBrandId` on brand `B`, let `before` be the canonical brand of
`B` before the write and `after` the canonical brand after it. In the same transaction:

```sql
UPDATE items
SET "brandId" = :afterId, brand = :afterLabel
WHERE "brandId" = :bId
   OR ("brandId" = :beforeId AND "brandKey" = :bKey)
```

That one statement covers every case:

- **Link** (`before` is `B`): every item of `B` moves to `after`. This includes items that
  joined `B` under an older key through a rename, which is what "linking moves existing products"
  means.
- **Relink** (`before` is `C`, `after` is `D`): items carrying `B`'s key leave `C` for `D`.
- **Unlink** (`after` is `B`): items carrying `B`'s key come back to `B`. Items that joined `B`
  under an older key before it was linked stay on the canonical brand. That is the one thing an
  unlink cannot restore, because nothing records it. State it in the service's doc comment.

The answer reports the count as `movedItems`.

### 4.3 A rename no longer rewrites a linked product's key

`update` rewrites `items.brandKey` for every item of the brand when the label changes. With links
that stamps `deborah` onto products printed `DEBORAH 48H`, and a later unlink cannot find
them. Rewrite `brandKey` only where it equals the brand's key before the rename:

```sql
UPDATE items SET brand = :label WHERE "brandId" = :id;
UPDATE items SET "brandKey" = :newKey WHERE "brandId" = :id AND "brandKey" = :oldKey;
```

A rename of a linked brand changes nothing on items, because none has its `brandId`.

## 5. Registering a suggestion under another name

`POST /v1/admin/catalog/brands/register-suggestion`, body
`{ spelling, label, privateLabelSupermarketId? }`, pattern `brand.registerSuggestion`.

`spelling` is the suggestion's own spelling, which makes the suggestion's key. `label` is the name
the person typed. In one transaction:

1. `suggestionKey = brandKey(spelling)`, `labelKey = brandKey(label)`. Either null answers 400
   `brand_label_empty`.
2. **Same key:** create the brand exactly as `POST /brands` does, including the 409 when the key
   is taken. Answer as below with `linked: null`.
3. **Different key:** find the brand holding `labelKey`.
   - None: create it with `label` and the chain. `canonicalCreated: true`.
   - One: use its canonical brand, and ignore the chain in the request. `canonicalCreated: false`.
4. Create the linked brand with `label = spelling`, key `suggestionKey`, `canonicalBrandId` set to
   the canonical brand from step 3, no chain. A 23505 on its key answers 409 `brand_key_taken`,
   because somebody registered the suggestion in between.
5. Link unlinked items for both keys (section 4.1).

Answer: `{ brand: BrandView, linked: BrandView | null, canonicalCreated: boolean, linkedItems: number }`,
where `brand` is the canonical brand, re read after the moves so its `itemCount` is current.

The route exists because the back office must not make two requests for one decision. A failure
between a create and a link leaves the suggestion half registered.

## 6. What a brand view says

`BrandView` gains:

- `canonicalBrandId: string | null`
- `canonicalLabel: string | null`: the canonical brand's label, joined on the read, null for a
  brand that is not linked.
- `linkCount: number`: how many brands point at this one.

`itemCount` keeps its meaning, the items whose `brandId` is this brand, so a linked brand counts
0 and its canonical brand counts every item of both.

`CreateBrandRequest` and `UpdateBrandRequest` gain `canonicalBrandId?: string | null` (null on an
update unlinks). The DTOs validate it as a uuid, nullable on the update.

`ListBrandsRequest` and `AdminListBrandsQueryDto` gain `canonicalBrandId` (uuid): only the brands
linked to that brand. The `privateLabelSupermarketId` filter also matches a linked brand whose
canonical brand carries that chain.

`GET :id/spellings` sends the keys of the brand **and of every brand linked to it**, so a
canonical brand's spellings table shows `DEBORAH 48H` beside `DEBORAH`.

## 7. The brand key filter on source entries

`GET /v1/admin/harvest/entries` gains `brandKey` (string, max 120), in
`SourceEntryListQueryDto`, `ListSourceEntriesRequest` and its schema.

The harvester applies `brandKey()` to the value and filters `e."brandKey" = :key`. A value that
makes no key matches nothing rather than being refused, so a person typing punctuation gets an
empty list and not an error. On queued rows the partial index serves it. On other statuses it is
a filter over the rows the chain filter leaves, which is acceptable for an admin screen.

## 8. What this plan does not do

- **No chains of links.** One level, enforced.
- **No automatic linking.** A person links, in the back office. The curator only reads links.
- **No change to `brandKey`.** `deborah48h` and `deborah` stay two keys.
- **No per item audit.** As in `0115`.
- **No velista change.** A shopper reads `items.brand`, which now holds the canonical label.

## 9. Tests

- Catalog integration (`luna-shopper-backend-catalog:test-integration`):
  - the migration, the FK and the self check.
  - each refusal in section 3, and two concurrent links that together make a chain (one succeeds,
    one answers `brand_link_too_deep`).
  - link, relink and unlink move exactly the items section 4.2 names, including an item under an
    older key through a rename.
  - a rename of a canonical brand keeps a linked item's `brandKey`.
  - an item created with a linked brand's spelling gets the canonical id and label.
  - the register suggestion route in its three cases (same key, new canonical, existing
    canonical, including a typed name whose key belongs to a linked brand, which resolves to that
    brand's canonical brand).
  - list by `canonicalBrandId`, `canonicalLabel` and `linkCount` on the view, the chain filter
    through a link.
- `item.service.spec.ts`: `applyBrand` with a linked brand.
- Gateway `brands.http.spec.ts`: the new route, the new body fields and filter, the three codes.
- Harvester: `source-entry.service.spec.ts` for the `brandKey` filter, including a value that makes
  no key.
- `openapi-document.spec.ts` and `wire-types.spec.ts` pass after regeneration.

## 10. Acceptance criteria

- [ ] `brands.canonicalBrandId` exists with its FK, index and self check.
- [ ] A link to self, to a linked brand, or from a brand others point at is refused with the code
      section 3 names.
- [ ] An item written with a linked brand's spelling carries the canonical brand's id and label
      and its own key.
- [ ] Linking a brand moves all its items to the canonical brand, and unlinking moves back the
      items carrying its key.
- [ ] Renaming a canonical brand leaves a linked item's `brandKey` untouched.
- [ ] `POST /v1/admin/catalog/brands/register-suggestion` registers and links in one transaction in
      the three cases of section 5.
- [ ] `BrandView` carries `canonicalBrandId`, `canonicalLabel` and `linkCount`, and the list filters
      by `canonicalBrandId`.
- [ ] A canonical brand's spellings include its linked brands' keys.
- [ ] `GET /v1/admin/harvest/entries?brandKey=` filters by the normalized key.
- [ ] `openapi.json` and `wire-types.ts` are regenerated and their specs pass.

## 11. Verification

```sh
npx nx run-many -t lint test -p luna-shopper-backend-catalog luna-shopper-backend-gateway luna-shopper-backend-harvester luna-shopper/contracts luna-shopper/platform
npx nx run luna-shopper-backend-catalog:test-integration
npx nx run luna-shopper-backend-harvester:test-integration
npx nx run luna-shopper-backend-gateway:openapi
npx nx run luna-shopper-admin/models:wire-types
npx nx test luna-shopper-admin/models
```

## 12. Decisions taken while building

A review of this plan against the code, and the build itself, settled what the sections above
left open. Where a line here differs from the text above, this line is what was built.

- **A linked brand keeps its key.** A rename of a linked brand to a label that makes another key
  is refused with `brand_link_keeps_key` (409). A label that keeps the key is allowed, and so is
  an unlink and a rename in one request. Without the rule the old key came back as a suggestion,
  a later item with that spelling lost its brand, and an unlink found nothing.
- **A linked brand can be deleted, and only a linked one.** `DELETE /v1/admin/catalog/brands/:id`
  answers `{ id, movedItems }`. The products carrying its key on its canonical brand go back to
  no brand, with the deleted label as their brand text, which is the state before the spelling
  was registered. Its key returns to the suggestions by itself. Any other brand answers
  `brand_not_linked` (409), so section 9 of plan `0115` still holds for every real brand.
- **Lock first, then check, then write** (section 3). The update used to write the row before
  anything else, and two requests linking `A` to `B` and `B` to `A` would deadlock.
- **Section 5 locks too.** The canonical brand from step 3 is locked and read again before step 4
  inserts the link. `linkedItems` is the sum over both keys. `canonicalCreated` is true in the
  same key case.
- **`brand_link_owns_no_chain` judges the resulting row** (section 2). A link sent alone clears
  the chain the row held, and an unlink does not restore it. A chain set on a brand that is
  linked, or sent beside a link, is refused.
- **The move runs before the rename rewrites** when one update carries both. The other order
  leaves returning products with the new label and the old key.
- **The update answers `UpdateBrandResult`**, the view plus `movedItems`, always present.
- **`GET :id/spellings` reads one page of links** (100). The harvester caps its own answer at 200
  rows.

### A known cost, not fixed here

The harvester's `ItemMatchIndex` (`matching.ts`, rung 3) keys on `items.brand`, the label. After
a link rewrites the label to the canonical one, a new source row printed with the linked spelling
no longer matches by name, brand and size, and two look alike products can share one bucket,
which matches nothing. Catalog search by the printed spelling also stops finding moved items.
EAN and source reference matching are not affected. The follow up is a plan of its own.
