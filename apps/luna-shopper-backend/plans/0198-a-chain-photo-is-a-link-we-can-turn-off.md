# 0198 A chain photo is a link we can turn off

> Asked for by the owner on 2026-10-11: "create a plan to get the product's image url. It's
> important to flag images that aren't our own, so they can be disabled very quickly if needed".
>
> **This plan reverses a standing rule, and only as far as a link.** Backlog `0001` section 9
> says that `Item.imageUrl` comes "never from chain product photography", plan `0038` section
> 5.7 repeats it, and backlog `0007` adds "do not hotlink". The harvester obeys: every item it
> creates gets `imageUrl: null`. After this plan the harvester records the address of the
> photo that a chain prints for a product, and catalog can answer that address to a client.
> No server of ours ever fetches the bytes, and no copy is kept. The other half of those rules
> ("images are not rehosted") stands.
>
> The price of the reversal is the reason for the second half of the request. A photo on a
> chain's host is not ours. It is marked as such from the adapter to the client, it is off
> until the owner turns it on for a chain, and one request turns it off again.
>
> Prerequisite reading: backlog `0001` section 9, plan `0038` sections 5.7 and 8.1, plan
> `0083` (a row, not a switch), plan `0086` sections 3.1 and 5 (the source's columns), plan
> `0103` (a runner reports and the orchestrator writes), plan `0119` section 6 (the partial
> observation), plan `0191` (settle a product at a chain), and plan `0127` section 4, which
> this plan takes two view fields from (see section 7).

No harvest path stores a photo address today. Two adapters parse one and drop it, one keeps
it in a bag that nothing reads, and three never look. This plan gives the address a column
on the harvester's row, a link row in catalog, a mark on the item that says whose photo it
is, and a switch for each chain.

## Brief for the agent

### Objective

Record the photo address that each chain states for a product, link it to the catalog item
that the row is bound to, answer it on `ItemView` with its source named, and add the two
switches of section 4. Regenerate `openapi.json` and the wire types.

### Context

Every statement below was read in the file it names, on `dev` at `44f6b1da`.

- **The harvester writes null on purpose.** `source-entry.service.ts:633` and
  `source-entry-batch.service.ts:830` both set `imageUrl: null` on the item they create,
  with the comment "Never from the chain (plan 0038, section 5.7)".
- **`items.imageUrl` is the owner's.** `item.entity.ts:26`, written only by `create`,
  `createMany` and `update` in `item.service.ts` from a request of an admin. `toItemView`
  (`catalog.mappers.ts:238`) answers it unchanged.
- **What each adapter does with a photo today:**

  | Chain     | The source states                                     | The code today                               |
  | --------- | ----------------------------------------------------- | -------------------------------------------- |
  | Mercadona | `thumbnail` and `photos[]` on the detail and the listing | `libs/luna-shopper/mercadona` reads neither |
  | DIA       | `image`, a path on `www.dia.es`                       | parsed (`listing.ts:51`), kept in `extra.image` by `dia-catalog.runner.ts:700` |
  | El Jamón  | `image` in the JSON-LD of the product page            | parsed (`product.ts:42`), the runner drops it |
  | Carrefour | `images.desktop` and `images.mobile` on a listing row | typed (`types.ts:44`), never read            |
  | LIDL      | `image` and `imageList` on a search row               | never read                                   |
  | DEZA      | no product photo in the listing fixture, only badges  | nothing to read                              |

- **A source row has no photo column.** `source_catalog_entries` holds the source's own
  columns (`name`, `brand`, `ean`, `unitSize`, `sizeFormat`, `categoryPath`, `url`, `extra`),
  which every full read rewrites. `extra` is "stored, shown in the queue, and never
  interpreted", so the DIA address in it is not a field a rule can read.
- **A runner reports a `SourceObservation`** (`source-ingest.ts:77`) and never writes. A
  product whose detail a walk skipped is a `PartialSourceObservation` (138), which carries
  no identity field.
- **Plan `0191` (PR #652) built "settle a product at a chain"**: `SourceEntrySettler.settle`
  in `source-entry-settle.ts`. It is the one place that withdraws from a product what a row
  of a chain no longer states.
- **A per chain decision is a row.** `supermarket_sources.enabled` and `autoImportPlaces`
  are columns written from the back office, and the entity comment says "Do not add a per
  chain environment variable".
- **Plans `0126` to `0129` (Open Food Facts) are not built.** Plan `0171` lists them as
  stale. No `item_facts` table and no `imageSource` field exist.
- **Measured on 2026-10-11 with `curl`**, one photo for each chain, once with
  `Referer: https://velista.app/` and once with none:

  | Host                             | Answer                                                    |
  | -------------------------------- | --------------------------------------------------------- |
  | `static.carrefour.es`            | 200 `image/webp` both times                               |
  | `www.lidl.es`                    | 200 `image/webp` both times                               |
  | `www.supermercadoseljamon.com`   | 200 `image/jpeg` both times                               |
  | `www.dia.es`                     | 403 both times. Its edge refuses `curl`, so this proves nothing about a browser |
  | `prod-mercadona.imgix.net`       | 404 for the address in the fixture, which is old. The answer carries `Access-Control-Allow-Origin: *` and `Cross-Origin-Resource-Policy: cross-origin` |

  **Not confirmed:** that DIA and Mercadona serve a photo to an `<img>` on another origin
  in a real browser. Stage 1 of section 8 measures that before anything is turned on.

### Target state

Every acceptance criterion of section 10 holds, the commands of section 9 are green, and
`openapi.json` and `wire-types.ts` are regenerated.

### Scope

- Work in the five adapter libraries that state a photo: `libs/luna-shopper/mercadona`,
  `dia`, `eljamon`, `carrefour`, `lidl`. One pure function and one host list in each.
- In the harvester: `entities/source-catalog-entry.entity.ts`, one migration,
  `source-ingest.ts`, `source-snapshot.ts`, `source-entry-write.ts`, `source-entry.service.ts`,
  `source-entry-batch.service.ts`, `source-entry-settle.ts`, `catalog-client.service.ts`,
  the five catalog runners, `file-import.runner.ts` (it states null), `harvest.mappers.ts`
  and the entry view.
- In catalog: one new entity, `item.entity.ts` (two columns), `supermarket.entity.ts` (one
  column), one migration, a new `item-linked-image.service.ts`, `catalog-audit.service.ts`
  (`WRITE_BOOKKEEPING` only), `catalog.mappers.ts`, `catalog.controller.ts`.
- In the gateway: the admin routes of section 4 beside the existing admin supermarket
  routes, and the DTOs they need.
- In `libs/luna-shopper/contracts`: the messages, schemas, one enum and the view fields.
- Their specs, `openapi.json` and `wire-types.ts`.
- Do not touch: `items.imageUrl` and the three writes of it, the harvest document schema,
  the helm chart, `provision-release.sh`, either compose file, `luna-slot.sh`, velista, the
  back office.

### Constraints

- **No server of ours opens a photo address.** Not the harvester, not catalog, not the
  gateway, not a spec. A spec asserts on strings.
- **The address is stored as the source printed it.** No size parameter is added, removed
  or guessed. Mercadona prints `?fit=crop&h=300&w=300` on a listing and none on a detail,
  and each is stored as read.
- **An address outside the chain's own host list is dropped with a warning.** The list is
  a constant of the adapter library. This is what stops a changed page from making a
  client load an arbitrary host.
- **A link is never written to `items.imageUrl`.** That column means "the owner chose
  this". A link in it loses the mark, and the switch cannot find it.
- No environment variable, no new dependency, no per chain configuration outside a row.
- Do not use dashes as punctuation in comments or in this file.

### Action boundaries

- Proceed with in scope edits, both migrations, specs and the generators.
- Refresh a fixture only through the `capture-fixtures` target of its library, and only
  when a fixture lacks the photo field that the table above says the source states.
- Stop and ask when a chain states the photo only on a page that the walk does not fetch
  today, because a new request per product is a different cost.
- Stop and ask before any change to `0127`, `0128` or `0129`.

### Progress evidence

Report after the adapter functions with their specs, after the harvester migration and
ingest with their integration spec, after the catalog table and the switches with theirs,
after the gateway routes with their HTTP spec, and after the generators.

## 1. What is being built

| Piece                                                    | Where                                    |
| -------------------------------------------------------- | ---------------------------------------- |
| `photoAddress(raw)` and `PHOTO_HOSTS`                    | each of the five adapter libraries       |
| `SourceObservation.imageUrl`, required                   | `source-ingest.ts`, every runner         |
| `source_catalog_entries.imageUrl`                        | harvester entity and migration           |
| `item_linked_images`                                     | catalog entity and migration             |
| `items.linkedImageUrl`, `linkedImageSupermarketId`       | the same migration                       |
| `supermarkets.linkedImagesEnabled`, default false        | the same migration                       |
| `ITEM_LINKED_IMAGE_PATTERNS`: `linkBatch`, `unlink`, `disableAll` | contracts, `ItemLinkedImageService` |
| `supermarket.setLinkedImagesEnabled`                     | contracts, catalog                       |
| `ItemImageSource`                                        | `contracts/src/lib/enums/catalog.enums.ts` |
| `ItemView.imageSource`, `imageSupermarketId`, `ownImageUrl` | contracts, `toItemView`               |
| Two admin routes                                         | gateway                                  |

## 2. The harvester reads the address

Each adapter library gains a pure `photoAddress(raw): string | null`. It answers the one
address the chain prints for the product, made absolute, or null. It answers null for an
address that is not `https`, that is longer than 500 characters, or whose host is not in the
library's `PHOTO_HOSTS`. Which field is the one address:

- Mercadona: `thumbnail`.
- DIA: `image`, made absolute against `www.dia.es` as the runner does today.
- El Jamón: `image` of the JSON-LD.
- Carrefour: `images.desktop`, else `images.mobile`.
- LIDL: `image`, else the first entry of `imageList`.
- DEZA: none. Its runner states null.

`SourceObservation` gains `imageUrl: string | null`. It is **required**, as `sizeUnit` is,
so that an adapter cannot forget to say. `PartialSourceObservation` gains an optional
`imageUrl`. A photo is not an identity field, and three listings state it, so a known
product gets its address on the next walk with no new request. Absent leaves the stored
address alone. Null is a statement that the source prints none.

`source_catalog_entries` gains `imageUrl varchar(500) null`. It belongs to the source's
group: a full read rewrites it, a decision never does, and `sourceGroupChanged` compares it.
The file import states null and leaves the column alone on a row that a walk owns
(`writesSourceGroup`, plan `0190`). The harvest document gains no field: a file that an
admin uploads cannot name an address a shopper's browser will load.

The migration copies `extra->>'image'` into the column for the rows of DIA, which hold an
absolute address there already, and the DIA runner stops writing that key. The harvester's
entry view answers `imageUrl`, so the queue can show it.

## 3. Catalog holds a link, beside the owner's photo

`item_linked_images` in the catalog database:

| Column          | Type                                      | Notes                                 |
| --------------- | ----------------------------------------- | ------------------------------------- |
| `itemId`        | uuid, FK `items` `ON DELETE CASCADE`      |                                       |
| `supermarketId` | uuid, FK `supermarkets` `ON DELETE CASCADE` | whose photo it is                   |
| `url`           | varchar(500)                              | verbatim                              |
| `firstLinkedAt` | timestamptz                               | what the choice of section 3.1 orders on |
| `lastSeenAt`    | timestamptz                               |                                       |
| `runId`         | uuid null                                 | the run that last stated it           |

Unique `(itemId, supermarketId)`. One row for each chain that states a photo for the
product. Nothing is overwritten across chains, which is the rule prices follow (plan `0080`).

**Who writes it.** The harvester, through its service actor, in three places:

- **A run.** After a chunk is written, the ingest sends `itemLinkedImage.linkBatch` with
  `{ itemId, supermarketId, url, runId }` for every row of the chunk that is `ACTIVE` and
  holds an address. Every run sends every such row, changed or not. That is one message for
  each chunk, and it is what links the rows the migration filled and repairs a link that
  was lost. Catalog upserts and answers `{ linked, unchanged }`, and the run report counts
  them.
- **A decision.** `accept` and `createItem`, on the one row routes and on the bulk route,
  send the link for the row after the bind. `createItem` still creates the item with
  `imageUrl: null`. Replace the two comments named in the context with a sentence that says
  where the address goes now.
- **A settle.** `SourceEntrySettler.settle` sends `itemLinkedImage.unlink
  { itemId, supermarketId }` when no bound row of the chain that holds an address names the
  product any more. A row that moves to another product takes its photo with it, as it
  takes its offers.

Two bound rows of one chain on one product (plan `0155`) write one link, and the later
write wins. Both are photos of the same product from the same chain.

`linkBatch` and `unlink` take `AdminCredential` and call `requireAdmin`, which admits the
harvester's service actor. `linkBatch` refuses an address that is not `https`, with a
rejection for that entry and not for the batch.

### 3.1 The photo an item shows

`items` gains `linkedImageUrl` (varchar null) and `linkedImageSupermarketId` (uuid null).
They are materialized: the link of the item whose chain has `linkedImagesEnabled`, the
oldest `firstLinkedAt` first, the lower `supermarketId` on a tie. Null when the item has no
link of an enabled chain. The choice is stable, so a photo does not change from one read to
the next because a run finished.

`refreshLinkedImage(itemIds | supermarketId)` computes both columns in one statement. It
runs inside the transaction of every write that can change the answer: `linkBatch`,
`unlink`, both switches of section 4, and any delete of a chain. Both columns go in
`WRITE_BOOKKEEPING`, and they are written with a plain `UPDATE`, not through `audit.write`.

`ItemView` answers:

| Field                | Value                                                              |
| -------------------- | ------------------------------------------------------------------ |
| `imageUrl`           | `items.imageUrl`, else `items.linkedImageUrl`                      |
| `imageSource`        | `OWNER` when `items.imageUrl` is set, else `CHAIN` when the linked one is, else null |
| `imageSupermarketId` | the chain of a `CHAIN` photo, else null                            |
| `ownImageUrl`        | `items.imageUrl`, which is what the back office edits              |

`ItemImageSource` is `OWNER` and `CHAIN`. **`imageSource` is the mark the owner asked for**:
any value except `OWNER` is a photo that is not ours. `ownImageUrl` exists because the back
office edits the owner's photo, and a form filled from `imageUrl` saves a chain's address as
ours on the first save. The owner's photo always wins, so an item with its own photo never
shows a chain's.

A client that draws a photo whose `imageSource` is not `OWNER` sets
`referrerpolicy="no-referrer"` on the element and draws its own placeholder when the load
fails. That rule is stated here because the field is defined here. Building it is a velista
plan.

## 4. Turning it off

Two switches, both rows in catalog and both off until a person turns one on.

- **One chain.** `supermarkets.linkedImagesEnabled`, default false.
  `supermarket.setLinkedImagesEnabled { supermarketId, enabled }` writes it and refreshes
  every item that holds a link of that chain, in one transaction. `SupermarketView` answers
  the column.
- **Everything.** `itemLinkedImage.disableAll` sets the column to false on every chain and
  clears both materialized columns on every item, in one transaction. It answers
  `{ supermarkets, items }`, the counts it changed. Turning chains back on is one request
  for each chain, on purpose: the stop is one step and the start is a decision for each
  chain.

The gateway routes sit beside the existing admin supermarket routes and follow their guard
and their path shape:

- `PUT …/supermarkets/:id/linked-images` with `{ enabled }`.
- `POST …/linked-images/disable-all`, with no body.

Both writes are audited through `audit.write` on the `supermarkets` rows, so the audit log
says who turned what off and when.

**What "off" reaches, stated plainly.** After the transaction commits, every read of an
item answers no chain photo for that chain. The link rows stay, so turning a chain on again
needs no harvest. What the switch cannot reach: a photo a browser already holds in its
cache, and an item a client already holds in memory until it reads again. Nothing of the
chain's is stored on a server of ours, so there is nothing else to remove. Removing the
addresses themselves is `DELETE FROM item_linked_images WHERE "supermarketId" = …` followed
by the refresh, and the next run writes them back, so it is not a route.

The row is in catalog and not on `supermarket_sources` because catalog answers the read.
The harvester's `enabled` decides that a chain is fetched. This decides that its photo is
shown. A chain that asks us to stop showing its photos is not the same event as one that
asks us to stop reading its prices.

**The fallback with no gateway**, written in the doc comment of the entity:

```sql
UPDATE supermarkets SET "linkedImagesEnabled" = false;
UPDATE items SET "linkedImageUrl" = NULL, "linkedImageSupermarketId" = NULL
 WHERE "linkedImageUrl" IS NOT NULL;
```

## 5. What a cluster gets

Neither cluster fetches a storefront (plan `0083`), so no run in a cluster writes a link.
The addresses arrive with the catalog that is moved in (k8s plans `0011` and `0012`,
backlog `0019`). `supermarkets.linkedImagesEnabled` travels in the same dump. See open
decision D2.

## 6. What this plan does not do

- **No copy of a chain's photo, ever.** Plan `0038` section 5.7 stands on that half.
- **No fetch of a photo by a server**, not to check that it exists and not to measure it.
- **No second size.** One address for each chain and product. A thumbnail field waits
  until a client asks for one.
- **No back office screen.** The two routes exist. The button is a plan in
  `apps/luna-shopper-admin/plans/`.
- **No photo in velista.** That is a velista plan, with the client rule of section 3.1.
- **No Open Food Facts.** Plans `0126` to `0129` are untouched.
- **No photo from a leaflet or an uploaded file.**

## 7. What this takes from plan 0127

Plan `0127` section 4.2 defines `ItemView.imageSource` and `ownImageUrl`, and the enum
`ItemImageSource` as `OWNER` plus its two databases. It is not built. This plan builds those
two fields and the enum first, with `OWNER` and `CHAIN`. When `0127` is picked up it adds its
values to an enum that exists and its columns to the order of section 3.1. Where an open
database photo ranks against a chain photo is a decision for that plan, and the answer that
costs least is "the open one first", because it carries a license.

## 8. Stages

1. **Measure in a browser.** For each of the five chains, load one current photo address
   from an `<img>` on a page of another origin, with `referrerpolicy="no-referrer"`, in
   Chrome and in Safari or Firefox. Record the answer in a decisions section at the end of
   this file. A chain whose host refuses is still harvested and linked, and its switch
   stays off. This stage is a person's or a browser tool's, it is ten requests, and it
   blocks nothing below.
2. The adapter functions and their specs against the fixtures.
3. The harvester column, migration, ingest and the three senders.
4. The catalog table, the materialized columns, the view and the switches.
5. The gateway routes and the generators.

## 9. Tests and verification

- Each adapter spec: the address of a fixture product, a relative address made absolute,
  null for a foreign host, null for `http`, null for a product with none.
- Each runner spec with `RecordingRunReport`: a full observation carries `imageUrl`, and a
  partial one carries it only where the listing states it. The file import states null.
- Harvester integration: the migration up and down and the DIA copy. A full read rewrites
  the column, a partial read with no field leaves it, and one with null clears it. A chunk
  sends one `linkBatch` with its `ACTIVE` rows only. `accept` and `createItem` send the
  link and create the item with `imageUrl: null`. A row that moves away makes `settle` send
  `unlink`, and a second bound row with a photo stops it.
- Catalog integration: the migration, the unique index and both cascades. `linkBatch`
  upserts, counts and refuses an `http` address. An item with links of two chains shows
  nothing while both are off, the older link when both are on, and the other when the
  first is turned off. The owner's photo wins and answers `OWNER`. `disableAll` clears
  every item and every chain in one call and leaves the link rows. An item update by an
  admin records neither materialized column in the audit.
- Gateway HTTP spec: both routes, their guard, and `ItemView` with the three new fields.
- `openapi-document.spec.ts` and `wire-types.spec.ts` pass after regeneration.

```sh
npx nx run-many -t lint test -p luna-shopper/mercadona luna-shopper/dia luna-shopper/eljamon luna-shopper/carrefour luna-shopper/lidl luna-shopper/contracts luna-shopper-backend-harvester luna-shopper-backend-catalog luna-shopper-backend-gateway
npx nx run luna-shopper-backend-harvester:test-integration
npx nx run luna-shopper-backend-catalog:test-integration
npx nx run luna-shopper-backend-gateway:openapi
npx nx run luna-shopper-admin/models:wire-types
npx nx test luna-shopper-admin/models
```

## 10. Acceptance criteria

- [ ] After a walk of each of the five chains against its fake, every row whose source
      states a photo holds its address, verbatim, on an allowed host.
- [ ] No code path in the harvester, catalog or the gateway requests a photo address.
- [ ] No harvest path writes `items.imageUrl`.
- [ ] An `ACTIVE` row with an address has a row in `item_linked_images` after the run, and
      a row that left its product has none there.
- [ ] With every switch off, which is the state after the migration, no `ItemView` answers
      a chain's address.
- [ ] With a chain on, an item with no owner photo answers the chain's address with
      `imageSource: CHAIN` and the chain's id, and an item with an owner photo answers
      `OWNER`.
- [ ] `setLinkedImagesEnabled(false)` for a chain removes its photo from every item in the
      same transaction, and `disableAll` does so for every chain in one request.
- [ ] Both switch writes are in the audit log.
- [ ] No helm file, compose file, `luna-slot.sh` line or environment variable was added.
- [ ] `openapi.json` and `wire-types.ts` are regenerated and their specs pass.

## 11. Open decisions for the owner

- **D1. `imageUrl` answers the chain's address.** Section 3.1 follows plan `0127`: one
  field means "the picture of this product", and `imageSource` says whose it is. A client
  that draws `imageUrl` and ignores `imageSource` then draws a chain's photo with no
  referrer rule. The other choice keeps `imageUrl` as the owner's and answers the chain's in
  a new `linkedImageUrl`, so no client can show one by accident. The plan is written for
  the first. Say so before the build if the second is wanted.
- **D2. A catalog moved into a cluster brings its switches.** A chain turned on locally
  arrives turned on. The safer rule is that a restore ends with `disableAll`, and each
  cluster is turned on by hand. That is one line in the restore of k8s plan `0012`, and it
  is not written there by this plan.
- **D3. DIA and Mercadona are unmeasured in a browser.** Stage 1 answers it. If either
  refuses another origin, its photos can never be shown as links, and only a copy would
  show them, which this plan rules out.
