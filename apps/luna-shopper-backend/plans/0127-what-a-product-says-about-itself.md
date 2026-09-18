# 0127 What a product says about itself

> Second of four plans that bring Open Food Facts and Open Beauty Facts into Luna Shopper.
> `0126` is the library that reads them. This plan is where catalog keeps what was read and how
> a client asks for it. `0128` is the harvester run that fills it, and it cannot be built before
> this plan. `0129` keeps a copy of the photo.
>
> An item in catalog says six things about a product: its name, brand, size, category, unit and
> barcode. `imageUrl` exists and is null on every imported item, because plan `0038` section 5.7
> forbids a chain's own photography and names Open Food Facts as the source that is allowed.
> Ingredients, allergens, nutrition values and scores have no column at all.
>
> This plan adds a table of product facts keyed on the item and on the database the facts came
> from, a second table for the whole source document, and the photo an item shows when its owner
> set none. It writes nothing by itself: every row arrives through one message, and plan `0128`
> is the only sender.
>
> **The facts stay in their own table and never overwrite an item.** `backlog/0013` measured
> that their brand disagreed with ours on 16% of the matched products where both had one. It
> also keeps their data a separable collection beside our catalog instead of mixed into it,
> which matters under the share alike term of the Open Database License. That last point is a
> reading of the license by an engineer and not legal advice.
>
> Prerequisite reading: `0038` section 5.7, `0075` (the audit trail and what it skips), `0080`
> (deciding on read and materializing the answer, the pattern section 4 copies), the doc comment
> of `core/src/app/entities/comment-audio.entity.ts` (why a heavy column gets its own table),
> and the memory notes on raw SQL in TypeORM and on integration specs.

## Brief for the agent

### Objective

Add `item_facts` and `item_facts_raw`, the four materialized columns on `items`, the seven
`itemFacts.*` messages of section 5, the `ItemView` fields of section 4.2, and the gateway
routes of section 6. Prove the SQL with integration specs and regenerate the OpenAPI document
and the wire types.

### Context

- `Item` (`catalog/src/app/entities/item.entity.ts`) has `name` (jsonb `LocalizedText`),
  `brand`, `imageUrl` (varchar null), `sku`, `ean` (varchar null, unique when present),
  `unitSize`, `category`, `defaultUnit`, `productGroupId`, `brandKey`, `brandId`.
- The latest catalog migration is `1757600000000-BrandLinks.ts`. Check the directory again
  before naming yours.
- `toItemView` is `catalog.mappers.ts:211` and maps a row with no join. Every item read in
  `item.service.ts`, including the raw SQL search, ends in it.
- `ItemService.update` (`item.service.ts:286`) loads the row, applies each sent field, and
  saves inside `audit.write`. `imageUrl` is applied at :297. `create` and `createMany` take
  `imageUrl` too (:156, :233).
- `PlatformAdminService.requireAdmin` (`catalog/src/app/catalog/platform-admin.service.ts:76`)
  accepts an admin **or** a user id listed in `SERVICE_ACTOR_IDS`. That is how the harvester
  writes today, and how it writes here.
- `CatalogAuditService.write` wraps a change and its audit row in one transaction (plan `0075`).
  `WRITE_BOOKKEEPING` in that file names the fields the trail never mentions, and its doc
  comment explains why `priceObservedAt` is one of them.
- Message handlers are `catalog/src/app/catalog/catalog.controller.ts` (`@MessagePattern`).
  Patterns, requests and views are in
  `libs/luna-shopper/contracts/src/lib/messages/catalog.messages.ts` (`ITEM_PATTERNS` at :101,
  `ItemView` at :707), schemas in `schemas/messages/catalog.schemas.ts`.
- Gateway: `CatalogItemsController` (`gateway/src/app/catalog/catalog.controller.ts:342`) is
  guarded by `JwtAuthGuard` and holds `GET :id` at :457. The admin item routes are
  `catalog-admin.controller.ts:328`. DTOs are `catalog.dto.ts` and `catalog-admin.dto.ts`.
- `barcodeKey` is `@portfolio/luna-shopper/contracts/barcode-key` (plan `0126`, section 2). If
  plan `0126` is not merged yet, build `barcodeKey` exactly as its section 2 says, in the place
  it names, and say so in the pull request. It is the only thing the two plans share.
- NATS `max_payload` is 16 MB in both clusters and in the compose stack.
- Error codes live in `libs/luna-shopper/platform/src/lib/errors/`.
- Integration specs run under `test-integration`, not `test`.

### Target state

Every acceptance criterion in section 10 holds, and
`npx nx run-many -t lint test -p luna-shopper-backend-catalog luna-shopper-backend-gateway luna-shopper/contracts luna-shopper/platform luna-shopper-admin/models`
plus `luna-shopper-backend-catalog:test-integration` are green, with `openapi.json` and the wire
types regenerated.

### Scope

- Work only in, under `apps/luna-shopper-backend/catalog/src/app/`: two new entities,
  `entities/item.entity.ts` (the four columns of section 4.1), `entities/index.ts`, one new
  migration and `db/migrations/index.ts` (`CATALOG_MIGRATIONS` is an explicit list, and a
  migration that is not in it never runs), a new `catalog/item-facts.service.ts`,
  `catalog/item.service.ts` (the `ean` change in `update` only),
  `catalog/catalog-audit.service.ts` (`WRITE_BOOKKEEPING` only), `catalog/catalog.mappers.ts`,
  `catalog/catalog.controller.ts` and catalog's own `catalog/catalog.module.ts`.
- And in: `libs/luna-shopper/contracts` (enums, messages, schemas, a new `facts/attribution.ts`),
  `libs/luna-shopper/platform` errors, the gateway's two catalog controllers, a new gateway
  controller for `admin/catalog/item-facts`, the gateway's `catalog/catalog.module.ts`, the two
  gateway DTO files, their specs, and the generated `openapi.json` and `wire-types.ts`.
- Do NOT touch: the harvester, the back office, velista, `libs/luna-shopper/open-facts`,
  `supermarket_items`, any price table, or any existing column of `items`.

### Constraints

- **Facts never write an item's `name`, `brand`, `ean`, `unitSize` or `category`.** The only
  columns of `items` this plan writes are the four of section 4.1.
- `items.imageUrl` stays the owner's. Nothing in this plan writes it.
- The raw document lives in `item_facts_raw` and no query that answers a list selects it.
- A facts batch writes no audit row (section 5.2). Suppressing and deleting do.
- Catalog never builds an address on their hosts. Every URL arrives in the message.
- Regenerate `openapi.json` and the wire types with their generators, never by hand.

### Action boundaries

- Proceed with in scope edits, the migration, unit and integration specs, and the generators.
- Stop and ask if `toItemView` cannot produce section 4.2 without a join in the search SQL, or
  if a batch of 50 entries with a 60 KB `raw` each does not cross NATS in the integration stack.
  The spec builds those entries itself, so this plan needs no fixture of plan `0126`.

### Progress evidence

Report after the migration with its integration spec, after `upsertBatch` and the materialized
photo with theirs, after the reads and the gateway routes with their HTTP spec, and after the
generators.

## 1. What is being built

| Piece                                                    | Where                                    |
| -------------------------------------------------------- | ---------------------------------------- |
| `item_facts`, `item_facts_raw`                           | two entities, one migration              |
| `items.factsImageUrl`, `factsThumbnailUrl`, `factsImageSource`, `hasFacts` | the same migration     |
| `ItemFactsSource`, `ItemImageSource`, `ItemFactsImageRole`, `ItemFactsRejection` | `contracts/src/lib/enums/catalog.enums.ts` |
| `ITEM_FACTS_PATTERNS` and seven messages                 | contracts, `ItemFactsService`            |
| `ITEM_FACTS_ATTRIBUTION`                                 | `contracts/src/lib/facts/attribution.ts` |
| `ItemView.thumbnailUrl`, `imageSource`, `ownImageUrl`, `hasFacts` | contracts, `toItemView`         |
| `GET /v1/catalog/items/:id/facts`                        | gateway                                  |
| Four admin routes                                        | gateway                                  |

## 2. The tables

### 2.1 `item_facts`

One row per item and source. `BaseEntity` columns, then:

| Column                | Type                          | Notes                                         |
| --------------------- | ----------------------------- | --------------------------------------------- |
| `itemId`              | uuid, FK `items` `ON DELETE CASCADE` |                                        |
| `source`              | enum `item_facts_source`      | `OPEN_FOOD_FACTS`, `OPEN_BEAUTY_FACTS`        |
| `code`                | varchar(32)                   | the barcode as **they** write it              |
| `sourceUrl`           | varchar                       | their page for the product, for the credit    |
| `revision`            | integer                       | their `rev`                                   |
| `sourceModifiedAt`    | timestamptz                   | their `last_modified_t`                       |
| `fetchedAt`           | timestamptz                   | when an upsert last wrote or confirmed it     |
| `runId`               | uuid null                     | the harvester run, opaque                     |
| `missingSince`        | timestamptz null              | section 5.4                                   |
| `suppressed`          | boolean default false         | section 5.5                                   |
| `suppressedAt`, `suppressedByUserId` | timestamptz null, uuid null |                                  |
| `mainLocale`          | varchar(8) null               |                                               |
| `names`, `genericNames`, `ingredients` | jsonb `{}`   | one text per locale                           |
| `brands`, `categories`, `labels`, `countries`, `stores`, `origins`, `packaging` | jsonb `[]` |        |
| `allergens`, `traces`, `additives`, `analysis` | jsonb `[]` |                                         |
| `categoriesText`, `labelsText` | varchar null         | as a person typed them                        |
| `quantity`, `servingSize`, `periodAfterOpening` | varchar null |                                      |
| `productQuantity`     | numeric(12,4) null            |                                               |
| `productQuantityUnit` | varchar(16) null              |                                               |
| `nutriments`          | jsonb `{}`                    | their keys, verbatim                          |
| `nutritionPer`        | varchar(16) null              | `100g` or `serving`                           |
| `nutriScore`          | char(1) null                  | `a` to `e`                                    |
| `novaGroup`           | smallint null                 | 1 to 4                                        |
| `environmentalScore`  | char(1) null                  | `a` to `f`                                    |
| `images`              | jsonb `[]`                    | section 3                                     |
| `frontImageUrl`, `frontThumbnailUrl` | varchar null   | the chosen front crop, section 3              |
| `completeness`        | numeric(5,4) null             | their own measure, 0 to 1                     |

Unique `uq_item_facts_item_source (itemId, source)`. Index `ix_item_facts_source`. Three
checks: `nutriScore` inside `a` to `e`, `environmentalScore` inside `a` to `f`, `novaGroup` inside
1 to 4. The upsert also turns a value outside those into null before it writes, because one
check violation fails the whole batch and their grades include `a-plus` and `unknown`.

`ItemFactsSource` is `OPEN_FOOD_FACTS` and `OPEN_BEAUTY_FACTS`. `ItemImageSource` is `OWNER` plus
those two. `items.factsImageSource` uses the same Postgres enum and never holds `OWNER`, which
only the view answers (section 4.2).

The columns are the fields of `OpenFactsProduct` in plan `0126` section 4, under the same
names, so the harvester maps one to the other without a table of renames. `images` is the one
exception: section 3 defines its entries, and the sender builds them.

### 2.2 `item_facts_raw`

`factsId` uuid primary key and FK `item_facts` `ON DELETE CASCADE`, `raw` jsonb, `bytes` integer.

**Its own table for the reason `comment_audio` is.** A document is tens of kilobytes. On the
facts row it sits in the path of every read that answers a list, which is how a sound decision
turns bad quickly. Nothing selects this table except the one admin route that asks for it.

## 3. The photos of a facts row

`images` is an array of
`{ role, locale, url, thumbnailUrl, width, height, revision }`. `role` is `ItemFactsImageRole`:
`FRONT`, `INGREDIENTS`, `NUTRITION`, `PACKAGING`. `url` is the 400 pixel file and `thumbnailUrl`
the 200 pixel one, both absolute and both built by the sender. `url` is never null: the sender
leaves out a crop that has no 400 pixel file. `thumbnailUrl` is null when their record lists no
200 pixel file. `revision` is theirs, and it is part of the address, so an address never changes
what it shows.

`frontOf(images, mainLocale)` answers the `FRONT` entry for locale `es`, then for `mainLocale`,
then any. The upsert calls it once and writes the answer into `frontImageUrl` and
`frontThumbnailUrl`, so that choosing an item's photo is a read of two columns in SQL and not a
walk of a jsonb array. Plan `0129` reads the same two columns to know which photos to copy.

## 4. The photo an item shows

### 4.1 Materialized on the item

`items` gains `factsImageUrl` (varchar null), `factsThumbnailUrl` (varchar null),
`factsImageSource` (enum `item_image_source` null) and `hasFacts` (boolean default false).

`ItemFactsService.refreshSummary(manager, itemId)` recomputes all four in one statement, inside
the transaction of whatever changed the facts. It considers the item's facts rows that are not
suppressed, takes `hasFacts` from whether one exists, and takes the photo from the row whose
`frontImageUrl` is not null and whose `completeness` is highest, with `OPEN_FOOD_FACTS` first on
a tie.

This is the rule plan `0080` set for prices: decide on read, materialize the answer inside the
write that changed it. A join in every item query answers the same thing, but `toItemView` is
reached from raw SQL in the search and the join has to be repeated in each.

These four columns are bookkeeping. Add them to `WRITE_BOOKKEEPING` so that an item update by a
person never records a photo it did not change, and write them with a plain `UPDATE`, not
through `audit.write`.

### 4.2 What the view says

| `ItemView` field | Value                                                                |
| ---------------- | -------------------------------------------------------------------- |
| `imageUrl`       | `items.imageUrl`, else `items.factsImageUrl`                         |
| `thumbnailUrl`   | `items.imageUrl` when set, else `items.factsThumbnailUrl`            |
| `imageSource`    | `OWNER` when `items.imageUrl` is set, else `factsImageSource`, else null |
| `ownImageUrl`    | `items.imageUrl`, which is what the back office edits                |
| `hasFacts`       | `items.hasFacts`                                                     |

`imageUrl` keeps its name and its meaning for a client, "the picture of this product", and
starts being filled. `imageSource` is how a client knows that it owes a credit. `ownImageUrl`
exists because the back office edits the owner's photo: a form filled from `imageUrl` saves
their address as ours on the first edit.

`UpdateItemRequest.imageUrl` and `CreateItemRequest.imageUrl` keep writing `items.imageUrl`.

## 5. The messages

`ITEM_FACTS_PATTERNS`: `upsertBatch`, `markMissing`, `listTargets`, `get`, `getRaw`,
`setSuppressed`, `delete`, as `itemFacts.<name>`. Every one of them except `get` takes
`AdminCredential` and calls `requireAdmin`, which also admits the harvester's service actor.
`get` is what a shopper's route sends, so it takes a `userId` and checks nothing, the way
`item.get` does, and calls `requireAdmin` only when `includeSuppressed` is true.

### 5.1 `itemFacts.upsertBatch`

Request: `{ runId, entries }`, at most 50 entries. An entry is
`{ itemId, source, code, sourceUrl, revision, sourceModifiedAt, values, raw }`, where `values` is
`ItemFactsValues` (every column of section 2.1 from `mainLocale` down, except `frontImageUrl` and
`frontThumbnailUrl`, which the upsert computes) and `raw` is the document or null.

For each entry, in one transaction per batch:

1. Load the item. None: reject `ITEM_NOT_FOUND`. The reasons are the enum `ItemFactsRejection`.
2. `barcodeKey(item.ean)` must equal `barcodeKey(entry.code)` and must not be null. Otherwise
   reject `BARCODE_MISMATCH`. **Catalog checks the join itself**, because the barcode is the
   only thing that binds a stranger's record to our product and an item's barcode can change
   between the harvester reading it and this write arriving.
3. Same `revision` as the stored row: set `fetchedAt`, clear `missingSince`, count `unchanged`.
4. Otherwise insert or update every column, replace the raw row, clear `missingSince`, count
   `created` or `updated`. `suppressed` is never touched by an upsert.
5. A `raw` that is null or above 512 KB writes no `item_facts_raw` row and removes the one that
   was there. Above the limit it is also counted `rawDropped`. The facts are still written.

Then `refreshSummary` for every item the batch changed.

Answer: `{ created, updated, unchanged, rawDropped, rejected: [{ itemId, source, reason }] }`.

A batch is 50 entries because a document measured about 40 KB before plan `0126` strips it,
which keeps a full batch near 2 MB against a 16 MB payload limit.

### 5.2 No audit row for a batch

The trail answers who changed a catalog row and what it said before. A facts row is a copy of a
record somebody else keeps, with its own revision number, and `runId` names the run that brought
it. One audit row per product per run grows the trail by a catalog per run, which is the reason
`priceObservedAt` is bookkeeping. `setSuppressed` and `delete` are a person's decisions, and
they go through `audit.write`.

### 5.3 `itemFacts.listTargets`

Request: `{ afterItemId?, limit, itemIds? }`, limit at most 1,000, `itemIds` at most 100. Answer:
`{ targets: [{ itemId, ean, facts: [{ source, revision, sourceModifiedAt, fetchedAt, missingSince }] }], nextAfterItemId }`.

Every item whose `ean` is not null, or only the named ones when `itemIds` is sent, ordered by
`id`, keyset on `id`. A named item with no barcode is left out, and the caller sees that fewer
came back than it named. This is what the harvester
reads to know which barcodes to ask about and what it already holds. It is raw SQL with one
grouped read of `item_facts` for the page, not a query per item.

### 5.4 `itemFacts.markMissing`

Request: `{ source, itemIds }`, at most 1,000. Sets `missingSince = now()` where it is null. A
whole export that does not hold a product means they deleted the record, usually because it was
a duplicate or junk. We keep the row and show the date to the back office. Nothing is deleted
by a run, because a run that read a short file deletes everything, and under deleting is the
safe way to be wrong.

### 5.5 `get`, `getRaw`, `setSuppressed`, `delete`

- `get { itemId, includeSuppressed? }` answers `{ facts: ItemFactsView[] }`, empty for an item
  with none, which is a normal answer and not a 404.
- `getRaw { factsId }` answers `{ raw, bytes }`, or `item_facts_not_found` (404) when the facts
  row does not exist or holds no raw document.
- `setSuppressed { factsId, suppressed }` flips the flag, stamps who and when, refreshes the
  summary. A suppressed row keeps being refreshed by runs and is never shown to a shopper. It
  exists because their record under our barcode is sometimes a different product, and deleting
  it only lasts until the next run.
- `delete { factsId }` removes the row and refreshes the summary. For a row that belongs to a
  barcode the item no longer has.

`ItemFactsView` is every column of section 2.1 except `suppressedByUserId`, plus `id`, plus
`attribution`: the entry of `ITEM_FACTS_ATTRIBUTION` for the row's source with `productUrl` set
to `sourceUrl`. The entry holds the database's name and home page and the names and addresses of
the data license and of the photo license. It is on the view so that no client can render the
facts and forget the credit.

### 5.6 An item whose barcode changes

In `ItemService.update`, when `ean` is sent and `barcodeKey` of the new value differs from
`barcodeKey` of the old one, delete the item's facts rows and call `refreshSummary`, inside the
same `audit.write`. The facts described the other barcode.

## 6. The routes

| Route                                              | Guard | Sends                                  |
| -------------------------------------------------- | ----- | -------------------------------------- |
| `GET /v1/catalog/items/:id/facts`                  | JWT   | `get`, never suppressed rows           |
| `GET /v1/admin/catalog/items/:id/facts`            | admin | `get` with `includeSuppressed: true`   |
| `GET /v1/admin/catalog/item-facts/:id/raw`         | admin | `getRaw`                               |
| `PATCH /v1/admin/catalog/item-facts/:id`           | admin | `setSuppressed`, body `{ suppressed }` |
| `DELETE /v1/admin/catalog/item-facts/:id`          | admin | `delete`                               |

The shopper route is unscoped for the reason `GET :id` is (plan `0049`, section 3): the request
names the one product it is about. It is not reachable by a guest of a shared list. The memory
note on guest reachable routes says why that is a composition at the gateway, and it is a plan
of its own when a guest screen needs it.

`upsertBatch`, `markMissing` and `listTargets` have no route. They are the harvester's.

## 7. What this plan does not do

- **No fetching.** Catalog never opens a socket to their hosts. Plan `0128` does.
- **No copy of a photo.** `imageUrl` is an address on their image host until plan `0129`.
- **No translation of a tag.** `en:gluten` is stored and answered as `en:gluten`.
- **No search over facts.** Finding products by allergen or by score is a plan of its own.
- **No velista screen and no back office screen.** Those are plans in their own directories.

## 8. Tests

- Catalog integration (`luna-shopper-backend-catalog:test-integration`):
  - the migration up and down, the unique index, the three checks, both cascades, and a grade
    of `a-plus` written as null and not refused.
  - `upsertBatch`: created, updated, unchanged on the same revision, `ITEM_NOT_FOUND`,
    `BARCODE_MISMATCH` for a different barcode and for a restricted one, a padded code that
    matches an unpadded `ean`, `rawDropped`, and that a suppressed row stays suppressed.
  - `refreshSummary`: the higher `completeness` wins, food wins a tie, a suppressed row is
    ignored, the last row deleted clears all four columns, and no audit row is written.
  - `listTargets` pages by `id` with no gap and no repeat across three pages.
  - `markMissing` sets the date once and an upsert clears it.
  - an `ean` change that changes the key deletes the facts, and one that only adds a leading
    zero does not.
- `catalog.mappers.spec.ts`: the five rows of the table in section 4.2.
- Gateway HTTP spec for the five routes, including that the shopper route never sends
  `includeSuppressed`, and that a shopper's token reads facts while an admin route refuses it.
- `openapi-document.spec.ts` and `wire-types.spec.ts` pass after regeneration.

## 9. Verification

```sh
npx nx run-many -t lint test -p luna-shopper-backend-catalog luna-shopper-backend-gateway luna-shopper/contracts luna-shopper/platform
npx nx run luna-shopper-backend-catalog:test-integration
npx nx run luna-shopper-backend-gateway:openapi
npx nx run luna-shopper-admin/models:wire-types
npx nx test luna-shopper-admin/models
```

## 10. Acceptance criteria

- [ ] `item_facts` and `item_facts_raw` exist with their indexes, checks and cascades, and the
      migration reverts cleanly.
- [ ] `upsertBatch` refuses an entry whose barcode key is not the item's and an entry with a
      restricted barcode, and writes the rest of the batch.
- [ ] An upsert with the stored `revision` changes `fetchedAt` and `missingSince` and nothing
      else.
- [ ] No list read selects `item_facts_raw`.
- [ ] An item with no owner photo answers their front photo in `imageUrl` with `imageSource`
      naming the database, and an item with an owner photo answers `OWNER`.
- [ ] Suppressing a row removes it from the shopper route and from the item's photo, and the
      next upsert does not bring it back.
- [ ] A facts batch writes no audit row, and a suppress and a delete each write one.
- [ ] Changing an item's barcode to a different key deletes its facts.
- [ ] Every `ItemFactsView` carries its attribution.
- [ ] `openapi.json` and `wire-types.ts` are regenerated and their specs pass.
