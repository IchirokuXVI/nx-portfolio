# 0115 A registry of brands

> Client halves: `apps/luna-shopper-admin/plans/0027` (the Brands section) and
> `libs/luna-shopper/tools/curation/suggestions/plans/0004` (the curator checks a brand against
> the registry). Both read what this plan builds and neither can start before it lands.
>
> A brand today is free text on every table. `items.brand` is whatever the create request said,
> `source_catalog_entries.brand` is whatever the chain printed, and the curator invents one per
> row with nothing to check it against. The result is `+Proteínas` stored as a brand on 24
> Mercadona products, when it is a range of Hacendado, and nobody can list the brands the
> catalog holds because there is no such list. This plan adds the list: a `brands` table in
> catalog that a person fills from the back office, a normalized key that lets every spelling of
> one brand meet, and the two reads the back office needs to fill it.
>
> Prerequisite reading: `0086` (one source product, and D8), `0048` (brand in the search
> vector), the memory notes on catalog search strictness and the admin descriptor contract,
> `catalog/src/app/catalog/item.service.ts` in full, `harvester/src/app/harvest/source-entry.service.ts`
> and `source-snapshot.ts`.

## Brief for the agent

### Objective

Build the `brands` table and its admin routes, the `brandKey` column on items and on source
catalog entries, and the two composed reads (suggested brands, and the spellings of one brand)
described in sections 2 to 8.

### Context

- `items.brand` (`catalog/src/app/entities/item.entity.ts:20`) is a nullable varchar with no
  normalization. It is written only by `ItemService.create` (:147), `createMany` (:193) and
  `update` (:272). The harvester's accept paths reach those three through
  `ITEM_PATTERNS.create` and `item.createMany`, taking `req.brand` or else the source row's
  brand (`source-entry.service.ts:256`, `source-entry-batch.service.ts:408`).
- `tg_items_search` fires `BEFORE INSERT OR UPDATE` on every `items` row and puts `brand` in the
  search vector at weight B. `ix_items_brand_trgm` and `lower(brand) = lower(raw)` in
  `item.service.ts:909` rank on it. Rewriting `items.brand` rebuilds the vector with no extra work.
- `source_catalog_entries.brand` (`harvester/.../source-catalog-entry.entity.ts:83`) is written
  by `applySourceGroup` (`source-snapshot.ts:76`) and on insert through `fieldsOf()`
  (`source-ingest.ts:658`). Decisions never rewrite it (`source-entry-write.ts:27`, plan `0086`
  D8), and this plan keeps that.
- `supermarketId` in the harvester is catalog's `supermarkets.id`. The harvester stores no chain
  name, and the back office resolves names itself through `ChainNames`.
- Queued means `status IN (CANDIDATE, UNRESOLVED)` (`QUEUED`, `source-entry.service.ts:56`).
- No database has `unaccent`. `catalog_norm` uses `translate` on purpose
  (`1757100000000-StricterCatalogSearch.ts:18-20`) and keeps punctuation, so it is not the key
  this plan needs.
- Lists page by cursor: `PageQuery`, `Paginated<T>`, `encodeCursor` and `decodeCursor` from
  `@portfolio/luna-shopper/platform`, `MAX_PAGE_SIZE = 100`.
- `product_groups` (unique `slug`, `product-group.service.ts`, `AdminCatalogProductGroupsController`)
  is the closest template for a small catalog table keyed on unique text.
- Latest migrations: catalog `1757200000000-PriceScopePriority.ts`, harvester
  `1757100000000-AutoImportPlaces.ts`.

### Target state

Every acceptance criterion in section 11 holds, the integration specs in section 10 pass on a
throwaway slot, and `openapi.json` and `wire-types.ts` are regenerated.

### Scope

- Work only in: `libs/luna-shopper/contracts` (the key function, messages, schemas, views),
  `libs/luna-shopper/platform/src/lib/errors/` (two codes), `apps/luna-shopper-backend/catalog/src/app/`
  (entity, migration, a brand service, the item service, the controller),
  `apps/luna-shopper-backend/harvester/src/app/` (entity, migration, `source-snapshot.ts`,
  `source-ingest.ts`, the source entry service and controller), the gateway's catalog admin
  controller, DTOs and module, and the two generated files.
- Do NOT touch: `libs/luna-shopper-admin`, `libs/luna-shopper/tools/curation`, the harvest
  runners and adapters, the search trigger function, D8, the Helm chart.

### Constraints

- Both migrations are additive. The backfills compute the key in TypeScript, in pages of 1,000
  rows, and never in SQL. Show each migration before running it.
- One `brandKey` function, in contracts, used by catalog, harvester and gateway alike. No second
  copy anywhere in this plan.
- No brand is created by a migration, a seed or a run. A person creates every row.
- `source_catalog_entries.brand` stays verbatim. Only the new `brandKey` column is derived.
- Regenerate `openapi.json` and the wire types with their targets, never by hand.

### Action boundaries

- Proceed with in-scope edits, unit and integration specs, and the generators.
- Stop and ask before running a migration against anything but a throwaway slot, before adding a
  Postgres extension, and if the suggested brands query cannot answer a page in under a second
  on the seeded slot 0 volume.

### Progress evidence

Report after the key function and its cases, after each migration with its integration spec,
after the brand routes, after the suggestions read, after the spellings read, and after the
generators, each with the spec run that proves it.

## 1. What is being built

| Piece                                            | Where                                                     |
| ------------------------------------------------ | --------------------------------------------------------- |
| `brandKey(text)`                                 | `libs/luna-shopper/contracts/src/lib/brands/brand-key.ts` |
| `brands` table                                   | catalog migration, `brand.entity.ts`                      |
| `items.brandKey`, `items.brandId`                | the same catalog migration, `item.entity.ts`              |
| Brand list, read, create, update                 | catalog `brand.service.ts`, `BRAND_PATTERNS`              |
| `source_catalog_entries.brandKey`                | harvester migration, entity, `source-snapshot.ts`         |
| Suggested brands read                            | harvester `sourceEntry.brandSuggestions`                  |
| Spellings of registered keys                     | harvester `sourceEntry.brandSpellings`                    |
| `GET/POST /v1/admin/catalog/brands`              | gateway catalog admin controller                          |
| `GET/PATCH /v1/admin/catalog/brands/:id`         | the same                                                  |
| `GET /v1/admin/catalog/brands/:id/spellings`     | the same, composed                                        |
| `GET /v1/admin/catalog/brand-suggestions`        | the same, composed                                        |

## 2. The key

**A brand's key is its text with everything but letters and digits taken out.** One function,
used everywhere a key is computed:

```ts
export function brandKey(text: string | null | undefined): string | null {
  if (text == null) return null;
  const key = text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
  return key === '' ? null : key;
}
```

- `El Pozo`, `ElPozo`, `ELPOZO` and `elpozo` are all `elpozo`. `Campofrío` is `campofrio`,
  `Ñora` is `nora`, `Coca-Cola` is `cocacola`, `+Proteínas` is `proteinas`.
- **A text with no letters or digits has no key**, so it has no brand. LIDL's `-` and `---`
  become null here without a special case.
- The key is not a spelling fix. `Hacenado` and `Hacendado` are two keys. Aliases are out of
  scope (section 9).
- The function is shared with the curation tool, which is plain `.mjs` and keeps its own copy
  (curation plan `0004`). So the cases live in a JSON file,
  `libs/luna-shopper/contracts/src/lib/brands/brand-key.cases.json`, as `[text, key]` pairs,
  and the contracts spec runs every pair. The curation spec reads the same file. Include at
  least the examples above, an empty string, whitespace only, `null`, and a text in capitals
  with an accent (`DON SIMÓN`).
- `brandKey` must stay browser reachable: contracts compile under the Angular apps, so it names
  no `process` and imports nothing from Node.

## 3. The catalog tables

### 3.1 `brands`

| Column                      | Type                                                                                   |
| --------------------------- | -------------------------------------------------------------------------------------- |
| `id`, `createdAt`, `updatedAt` | as `BaseEntity`                                                                     |
| `key`                       | varchar(120), not null, unique `uq_brands_key`. Always `brandKey(label)`.              |
| `label`                     | varchar(120), not null. How the brand is written everywhere a person reads it.         |
| `privateLabelSupermarketId` | uuid null, FK `supermarkets(id)` `ON DELETE SET NULL`, indexed. The chain that owns a private label. |

**The key follows the label.** It is never sent by a client and never edited on its own. Editing
`Hacenado` to `Hacendado` changes the key to `hacendado`, and that is the only way a key
changes.

### 3.2 On `items`

| Column     | Type                                                                     |
| ---------- | ------------------------------------------------------------------------ |
| `brandKey` | varchar(120) null, indexed. Always `brandKey(brand)`.                    |
| `brandId`  | uuid null, FK `brands(id)` `ON DELETE SET NULL`, indexed.                |

`items.brand` stays, and stays the column search reads. When `brandId` is set, `brand` holds
that brand's label, byte for byte. It is a copy kept on purpose: the search trigger, the trigram
index and the ranking all read `items.brand`, and a copy means none of them changes.

### 3.3 The migration

1. Create `brands` and its index.
2. Add `items.brandKey` and `items.brandId` with their indexes and the FK.
3. Backfill `items.brandKey` in pages of 1,000 by id, calling `brandKey`. `brandId` stays null
   on every row, because no brand exists yet.

`down` drops the two columns and the table.

## 4. Writing an item

`ItemService.create`, `createMany` and `update` gain one step, in one private method both use,
run whenever the request carries `brand`:

1. `key = brandKey(brand)`.
2. If `key` is null, write `brand = null`, `brandKey = null`, `brandId = null`. A product with
   no brand is valid.
3. If a brand has that key, write `brandId` = its id and `brand` = its **label**, whatever
   spelling the request sent. `MAHOU` from a Carrefour accept is stored as `Mahou` when `Mahou`
   is registered.
4. Otherwise write `brand` as sent, trimmed, `brandKey = key`, `brandId = null`. An unregistered
   brand is still accepted. Refusing it is the curator's decision (curation plan `0004`), not
   the catalog's, because a person creating an item by hand in the back office has to be able
   to.

`createMany` resolves every distinct key of the batch in one query, not one per item.

## 5. The brand routes

`BRAND_PATTERNS` in `catalog.messages.ts`: `list`, `get`, `create`, `update`. No `delete` (section 9).

### 5.1 `BrandView`

```ts
interface BrandView {
  id: string;
  key: string;
  label: string;
  privateLabelSupermarketId: string | null;
  itemCount: number;   // items whose brandId is this brand
  createdAt: string;
  updatedAt: string;
}
```

### 5.2 List

`GET /v1/admin/catalog/brands`, `AdminListBrandsQueryDto extends PageQueryDto`:

- `query` (max 120): matches when `brandKey(query)` is contained in `key`, or `label ILIKE`.
  A query with no key matches on the label only.
- `privateLabelSupermarketId` (uuid): only that chain's private labels.
- `order`: `label` (default, then `id`) or `itemCount` (descending, then `id`).
- `limit` up to 100. The curation tool reads the whole registry by following `nextCursor`, so the
  cursor must be stable under both orders.

`itemCount` is one grouped subquery for the page, never one count per row.

### 5.3 Create

`POST /v1/admin/catalog/brands`, body `{ label, privateLabelSupermarketId? }`.

In one transaction:

1. `key = brandKey(label)`. Null answers 400 `brand_label_empty`.
2. Insert. A unique violation on `uq_brands_key` answers 409 `brand_key_taken`, with the id of the
   brand holding the key in `details`, so the back office can open it.
3. `UPDATE items SET "brandId" = :id, brand = :label WHERE "brandKey" = :key AND "brandId" IS NULL`.

The answer is the `BrandView` plus `linkedItems`, the row count of step 3.

### 5.4 Update

`PATCH /v1/admin/catalog/brands/:id`, body `{ label?, privateLabelSupermarketId? }`.

When `label` is sent, in one transaction:

1. `key = brandKey(label)`, with the same two refusals as create.
2. Update the brand row.
3. `UPDATE items SET brand = :label, "brandKey" = :key WHERE "brandId" = :id`.
4. If the key changed, link the unlinked items that carry the new key, as create step 3 does.

Items linked under the old key stay linked. They were this brand, and a corrected spelling does
not change that.

## 6. The harvester column

`source_catalog_entries.brandKey`: varchar(120) null.

- Written wherever `brand` is written: `applySourceGroup` sets both, and `fieldsOf()` carries
  both into `this.entries.create`. `sourceGroupChanged` compares `brand` as today. The key
  follows it and needs no comparison of its own.
- Index `ix_source_catalog_entries_queued_brand_key` on `("brandKey")` `WHERE "brandKey" IS NOT NULL
  AND status IN ('CANDIDATE', 'UNRESOLVED')`.
- The migration adds the column and the index and backfills in pages of 1,000 by id, as 3.3 does.

## 7. Suggested brands

### 7.1 What a suggestion is

**A suggestion is a key carried by at least one queued source row and by no registered brand.**
Queued is `CANDIDATE` or `UNRESOLVED`: the products still waiting for a person. An `ACTIVE` row
is already a product and a `REJECTED` row is one the owner said is not tracked, so neither
counts. A product carried by two chains is two source rows and counts twice, which is the
number the queue shows.

### 7.2 The harvester read

`sourceEntry.brandSuggestions`, request `{ registeredKeys: string[], query?, cursor?, limit? }`
plus `AdminCredential`.

```sql
SELECT "brandKey"                                   AS key,
       mode() WITHIN GROUP (ORDER BY brand)         AS spelling,
       count(*)                                     AS "productCount",
       min("firstSeenAt")                           AS "firstSeenAt",
       jsonb_object_agg(...)                        AS chains   -- see below
FROM source_catalog_entries
WHERE status IN ('CANDIDATE', 'UNRESOLVED')
  AND "brandKey" IS NOT NULL
  AND NOT ("brandKey" = ANY(:registeredKeys))
  [AND "brandKey" LIKE '%' || :queryKey || '%']
GROUP BY "brandKey"
ORDER BY "productCount" DESC, key ASC
```

- `spelling` is the most common verbatim spelling, the label the back office proposes.
- `chains` is `[{ supermarketId, productCount }]`, every chain whose queued rows carry the key,
  ordered by count descending. Build it in a subquery grouped by key and chain, not with a
  second query per row.
- `query` is keyed with `brandKey` before matching. A query with no key answers every suggestion.
- The cursor is a keyset over `(productCount, key)`: the next page is
  `productCount < :c OR (productCount = :c AND key > :k)`. Counts move as the queue is worked,
  so a row can appear on two pages. The back office dedupes by key, as plan `0004` of the admin
  already does by id.

```ts
interface BrandSuggestionView {
  key: string;
  spelling: string;
  productCount: number;
  firstSeenAt: string;
  chains: { supermarketId: string; productCount: number }[];
}
```

### 7.3 The gateway route

`GET /v1/admin/catalog/brand-suggestions`, `query`, `cursor`, `limit`.

1. Read every registered key from catalog with a new `brand.keys` pattern, which answers
   `string[]` and nothing else.
2. Send them to `sourceEntry.brandSuggestions` with the page parameters.

**The keys travel in the NATS message, and that has a ceiling.** A key is at most 120 bytes and
the default NATS payload limit is 1 MB, so the design holds to several thousand brands with
room left. Add a spec that builds a request of 5,000 keys of 30 characters and asserts it
serializes under 512 KB, and a comment on `brand.keys` naming the limit and the alternative (a
copy of the keys kept in the harvester by an event), so the next person does not rediscover it.

## 8. The spellings of one brand

`GET /v1/admin/catalog/brands/:id/spellings`:

1. Read the brand from catalog. A missing id answers 404 `not_found`, as every missing catalog
   row does.
2. Send `sourceEntry.brandSpellings` with `{ keys: [brand.key] }`.

The harvester groups every source row with that key **except `REJECTED`**, by chain and by
verbatim spelling:

```ts
interface BrandSpellingView {
  supermarketId: string;
  spelling: string;      // brand, verbatim
  productCount: number;
  queuedCount: number;   // of those, CANDIDATE or UNRESOLVED
}
```

The answer is the full list, ordered by chain then count descending, not paged: one brand has a
handful of spellings. Cap it at 200 rows and say so in the view's description.

## 9. What this plan does not do

- **No aliases.** `Hacenado` does not resolve to `Hacendado`. Fixing it is renaming the brand or
  a later plan.
- **No delete.** A brand cannot be removed. The FK sets `items.brandId` null for the day one is
  added.
- **No automatic registration.** `apps/luna-shopper-backend/plans/backlog/0013` records the
  design for registering brands from trusted chain fields, and it is not scheduled.
- **No change to what a shopper reads.** Velista reads `items.brand` as before.
- **No curation change.** The curator reads the registry in curation plan `0004`.
- **No rewrite of existing products' brands** beyond linking the ones whose key matches a
  registered brand. `+Proteínas` stays on its 24 items until somebody edits them.

## 10. Tests

- `brand-key.spec.ts`: every pair in `brand-key.cases.json`.
- Catalog unit: the item write step for each of the four cases in section 4, and `createMany`
  resolving keys in one query.
- Catalog integration (`luna-shopper-backend-catalog:test-integration`):
  - the migration backfills `brandKey` and creates no brand;
  - creating a brand links matching unlinked items, rewrites their `brand`, and the search vector
    finds them by the label;
  - a second brand with the same key is 409 with the holder's id;
  - a label rename rewrites every linked item and links newly matching ones;
  - `itemCount` and both orders page without a gap or a repeat on a stable table.
- Harvester integration (`luna-shopper-backend-harvester:test-integration`):
  - the backfill and the write path set `brandKey`;
  - suggestions exclude registered keys, `ACTIVE` and `REJECTED` rows, order by count then key,
    report `firstSeenAt` as the minimum and the chains with their counts;
  - the keyset cursor walks a fixed table with no gap;
  - spellings exclude `REJECTED` and split by chain and spelling.
- Gateway HTTP specs for all six routes, including 400 `brand_label_empty` and 409
  `brand_key_taken`, and the 5,000 key size spec.

## 11. Acceptance criteria

- [ ] `brandKey` exists once, in contracts, and its cases file covers section 2.
- [ ] `brands` exists and a person is the only thing that creates a row.
- [ ] Creating or renaming a brand makes every item with its key show the label.
- [ ] An item written with a registered key stores the label, and an unregistered brand is
      still accepted.
- [ ] `source_catalog_entries.brand` is unchanged by every path in this plan.
- [ ] `GET /v1/admin/catalog/brand-suggestions` lists unregistered keys of queued rows, ordered
      by product count, each with its spelling, count, first seen instant and chains.
- [ ] `GET /v1/admin/catalog/brands/:id/spellings` lists how each chain spells the brand.
- [ ] `openapi.json` and `wire-types.ts` are regenerated and their specs pass.

## 12. Verification

```sh
npx nx test luna-shopper/contracts
npx nx test luna-shopper-backend-catalog
npx nx test luna-shopper-backend-harvester
npx nx test luna-shopper-backend-gateway
npx nx run luna-shopper-backend-catalog:test-integration
npx nx run luna-shopper-backend-harvester:test-integration
npx nx run luna-shopper-backend-gateway:openapi
npx nx run luna-shopper-admin/models:wire-types
npx nx affected -t lint test build
```
