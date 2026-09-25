# 0129 A photo we keep a copy of

> Last of four plans that bring Open Food Facts and Open Beauty Facts into Luna Shopper. It needs
> `0126`, `0127` and `0128` merged. After `0128` an item already shows a photo: `imageUrl` is an
> address on their image host. This plan downloads that photo once, keeps the bytes, and serves
> them from our own gateway.
>
> **This plan reverses one sentence, and only for these photos.** `backlog/0001` section 9 says
> "images are not rehosted", and plan `0038` section 5.7 repeats it as "is never rehosted". Both
> were written about a chain's own photography, which we have no right to copy, and the code
> comment at `source-entry.service.ts:319` already reads it that way. These photos are published
> under Creative Commons Attribution ShareAlike, which permits an unmodified copy with a credit.
> A chain's photography stays forbidden, and nothing here fetches one.
>
> The owner asked for the photo to be fetched and not only linked, and building this plan is the
> decision to reverse the rule. If that is not wanted, stop at `0128`: everything before this
> plan works without it.
>
> Why a link is not enough:
>
> - Their services are run by a small nonprofit. `backlog/0013` measured their search and facet
>   endpoints answering 503. The image host was not measured, and we have no reason to expect
>   better of it. A list of fifty lines with fifty broken pictures is our defect to a shopper.
> - A link sends every shopper's address to a third party each time a list is drawn.
> - velista is an installable app. A photo on another origin is outside what it can promise to
>   keep available.
> - One download per photo is politer to them than one per shopper per visit.
>
> Prerequisite reading: plans `0126` section 5, `0127` sections 3 and 4, `0128` sections 4 and 5,
> and the doc comment of `core/src/app/entities/comment-audio.entity.ts`, which is the decision
> this plan repeats and the exit it names.

## Brief for the agent

### Objective

Add `item_images` to catalog, the photo stage of a `PRODUCT_FACTS` run, the public route
`GET /v1/catalog/images/:sha256`, and the `imagePath` and `thumbnailPath` fields a client
prefers over `imageUrl`. Regenerate the OpenAPI document and the wire types.

### Context

- After plan `0127`, `item_facts` has `frontImageUrl` and `frontThumbnailUrl`, the chosen front
  crop at 400 and 200 pixels, and `refreshSummary` materializes `items.factsImageUrl`,
  `factsThumbnailUrl`, `factsImageSource` and `hasFacts`. `ItemView` answers `imageUrl`,
  `thumbnailUrl`, `imageSource`, `ownImageUrl`.
- An address on their image host contains the crop's revision (plan `0126`, section 5), so **an
  address never changes what it shows**. A changed photo is a changed address.
- Measured on 2026-09-19 for `8480000160072`: 16,606 bytes at 400 pixels, 6,263 at 200, 119,034
  at full size, all `image/jpeg`. Two sizes for 5,000 products is about 115 MB and for 30,000
  about 690 MB.
- `comment_audio` (core) is the precedent: `bytea` in the service's own database and not object
  storage, in its own table so that no listing selects the bytes, with the playback route as the
  only reader. Its doc comment names the exit: a few gigabytes, or a second thing that stores a
  file. This is the second thing, in a different database, and section 2 answers that.
- Gateway guards are per controller (`@UseGuards(JwtAuthGuard)`), so a controller without one
  is public. There is no public catalog route today. `ProblemThrottlerGuard` is global, and
  named limits live in `THROTTLE_LIMITS` in `libs/luna-shopper/platform`. The gateway sets no
  `Cross-Origin-Resource-Policy` header, so an `<img>` on `velista.app` can load from
  `api.velista.app`.
- The audio route (`gateway/src/app/lists/list.controller.ts:747`) shows how bytes that arrive
  over NATS are written to a response with their content type.
- NATS `max_payload` is 16 MB.
- `FactsReportSink` and the executor's `PRODUCT_FACTS` branch are plan `0128`, section 5.
- The memory note on tier 2 compose says a new required environment variable needs
  `compose.apps.yml` by hand. This plan adds none.

### Target state

Every acceptance criterion in section 9 holds, and
`npx nx run-many -t lint test -p luna-shopper/open-facts luna-shopper-backend-catalog luna-shopper-backend-harvester luna-shopper-backend-gateway luna-shopper/contracts luna-shopper/platform luna-shopper-admin/models`
plus `test-integration` on catalog and the harvester are green, with `openapi.json` and the wire
types regenerated.

### Scope

- Work only in: `libs/luna-shopper/open-facts` (one client method, two fixture photos).
- In catalog: one new entity, `entities/item.entity.ts` (two columns), `entities/index.ts`, one
  new migration and `db/migrations/index.ts`, `item-facts.service.ts`, a new
  `item-image.service.ts`, `catalog-audit.service.ts` (`WRITE_BOOKKEEPING` only),
  `catalog.mappers.ts`, `catalog.controller.ts` and catalog's own `catalog.module.ts`.
- In the harvester: `run-executor.service.ts`, a new `facts-photo.stage.ts`,
  `catalog-client.service.ts` and `harvest.module.ts`.
- In the gateway: a new `catalog-images.controller.ts` and the gateway's `catalog.module.ts`.
- And: `libs/luna-shopper/contracts` (messages, schemas, one `HarvestWarningCode` value),
  `libs/luna-shopper/platform` (one throttle limit), their specs, and the generated
  `openapi.json` and `wire-types.ts`.
- Do NOT touch: any runner, `items.imageUrl`, the helm chart, `provision-release.sh`, either
  compose file, `luna-slot.sh`, velista, the back office.

### Constraints

- **Unmodified bytes.** Store exactly what their host sent. No resize, no recompression, no
  format change. The license asks for a credit on a copy, and a changed copy is an adaptation
  with a further obligation. The sizes we want already exist on their host.
- Only a photo from a dataset's own image host is ever fetched. The client refuses any other
  host, so a record typed by a stranger cannot make our server fetch an arbitrary address.
- No object storage, no volume, no new environment variable, no new dependency.
- No list read selects `item_images.data`.
- The public route answers bytes and nothing else: no item id, no barcode, no listing.
- Regenerate `openapi.json` and the wire types with their generators, never by hand.

### Action boundaries

- Proceed with in scope edits, the migration, unit and integration specs, and the generators.
- The capture tool downloads the two fixture photos. Do not run the stage against the live
  image host for more than ten products while building.
- Stop and ask if the throttle configuration cannot give one route its own limit, or if a
  measured photo is above the 1 MB cap of section 3 at 400 pixels.

### Progress evidence

Report after the migration and `store` with their integration spec, after the photo stage with
its spec, after the public route with its HTTP spec, and after the generators.

## 1. What is being built

| Piece                                             | Where                                     |
| ------------------------------------------------- | ----------------------------------------- |
| `OpenFactsClient.image(url)`                      | `libs/luna-shopper/open-facts`            |
| `item_images`                                     | catalog entity and migration              |
| `items.factsImagePath`, `factsThumbnailPath`      | the same migration, `refreshSummary`      |
| `ITEM_IMAGE_PATTERNS`: `listWanted`, `store`, `get` | contracts, `ItemImageService`           |
| `FACTS_PHOTO_FAILED`                              | `HarvestWarningCode`                      |
| The photo stage of a facts run                    | `facts-photo.stage.ts`, the executor      |
| `GET /v1/catalog/images/:sha256`                  | gateway, no guard, its own throttle limit |
| `ItemView.imagePath`, `thumbnailPath`             | contracts, `toItemView`                   |

## 2. Where the bytes live

`item_images` in the catalog database:

| Column        | Type                                       | Notes                               |
| ------------- | ------------------------------------------ | ----------------------------------- |
| `factsId`     | uuid, FK `item_facts` `ON DELETE CASCADE`  | the facts row whose front crop it is |
| `size`        | smallint                                   | 400 or 200                          |
| `sourceUrl`   | varchar                                    | the address it was read from        |
| `sha256`      | char(64), indexed                          | of `data`                           |
| `contentType` | varchar(64)                                |                                     |
| `bytes`       | integer                                    |                                     |
| `data`        | bytea                                      |                                     |

Unique `(factsId, size)`. A new revision of a crop replaces the row for that facts row and size,
and deleting the facts deletes the copies, so there is nothing to collect later.

**`bytea`, for the reasons `comment_audio` gives**: no StatefulSet, no volume, no credential in
`provision-release.sh`, no second entry in both values files and both compose files, no second
backup story, and no second thing that can be up while the other is down. The arithmetic: about
23 KB a product for both sizes, so 115 MB at 5,000 products and 690 MB at 30,000. `comment_audio`
says to reconsider at a few gigabytes or when a second thing stores a file. This is that second
thing, and the answer is still the same table shape, because it is in another service's database
with its own growth and its own backup. **This row is the seam**, as that one is: if the table
passes a few gigabytes it becomes a key into something else and the one route that reads it is
the only thing that changes. Write that into the entity's doc comment with these numbers.

## 3. Copying a photo

`OpenFactsClient.image(url)` answers `{ contentType, data }`. It refuses a URL whose host is not
the image host of a dataset in `OPEN_FACTS_DATASETS`, a response that is not `image/jpeg`,
`image/png` or `image/webp`, and a body above 1 MB. Its floor is
`OPEN_FACTS_IMAGE_MIN_DELAY_MS = 500`, clamped up like the other two. Their documentation states
no limit for the image host, and two a second is a guess made on the polite side.

The photo stage runs inside a `PRODUCT_FACTS` run as stage `photos`, **after the sink drained
and after the watermark was written** (plan `0128`, section 5, step 5). A run aborted or failed
while it copies photos keeps its watermark, because the facts are held and a photo is never a
reason to read 13 GB again. The next run lists the same photos as still wanted.

1. Page `itemImage.listWanted { source, itemIds?, afterFactsId?, limit }`. It answers, for facts
   rows of that source that are not suppressed, every `{ factsId, size, url }` where the facts
   row's front address has no `item_images` row with that `sourceUrl`. An `API` run passes its
   `itemIds`, so that refreshing one product does not start four thousand downloads.
2. Download each, compute the hash, and send `itemImage.store { factsId, size, sourceUrl,
   contentType, sha256, data }` with `data` as base64. One photo a message.
3. A refusal or a failed download is a `FACTS_PHOTO_FAILED` warning that names the address, and
   the run goes on. A photo is never a reason for a facts run to fail, so these do not count
   toward `HARVEST_FAILURE_RATIO`. The run's report gains
   `{ photosWanted, photosStored, photosFailed, photoBytes }`.

The stage is a class of its own, constructed with the client and the `CatalogClient` and run
with the `RunContext`, because it is not a runner: it reads what catalog asks for, which is the
executor's side of plan `0103`. From the context it takes the abort signal, `warn`, `setStage`,
and `heartbeat`, which it calls every 50 photos. Four thousand products at two sizes and two a
second is over an hour, against the reaper's 900 seconds.

`listWanted` and `store` take `AdminCredential` and call `requireAdmin`, which admits the
harvester's service actor. `get` takes no credential at all, because the route that sends it has
no caller to name.

`itemImage.store` checks the hash against the bytes, checks that `sourceUrl` still equals the
facts row's `frontImageUrl` or `frontThumbnailUrl` for that size (the facts can change between
the list and the store), upserts on `(factsId, size)`, and calls `refreshSummary`.

## 4. What an item answers

`items` gains `factsImagePath` and `factsThumbnailPath`. `refreshSummary` fills each with
`/v1/catalog/images/<sha256>` when the chosen facts row has a copy of that size **whose
`sourceUrl` equals the row's current front address**, and with null otherwise. A crop that
changed therefore falls back to their address until the next run copies the new one, and never
shows the old photo under the new record. Add both columns to `WRITE_BOOKKEEPING`.

`ItemView` gains `imagePath` and `thumbnailPath`: `null` when the owner set a photo, otherwise
the two columns. They are paths relative to the API origin, which every client already knows,
and not absolute addresses, because catalog does not know the name the gateway is reached by and
a staging database restored into production must not point at staging.

**A client prefers the path and falls back to the URL.** `imageUrl` and `thumbnailUrl` keep
their values from plan `0127`, so a client that ignores the new fields keeps working.

`ItemFactsView` is unchanged: its `images` list every crop at their addresses. Only front crops
are copied, one for each facts row that is not suppressed. That includes the row of a product
held in both databases whose photo loses in `refreshSummary`, which costs 23 KB and saves a rule.

## 5. Serving it

`GET /v1/catalog/images/:sha256` on a new `CatalogImagesController` with **no guard**. An
`<img>` element cannot send a bearer token, and the bytes are a photo a stranger published under
an open license, addressed by a hash nobody can guess a useful one of.

- `:sha256` is validated as 64 hexadecimal characters before anything is sent over NATS.
- `itemImage.get { sha256 }` answers the first row with that hash, or `not_found`.
- The response carries the stored `Content-Type`, `Content-Length`,
  `Cache-Control: public, max-age=31536000, immutable`, and `ETag` set to the hash. A request
  with a matching `If-None-Match` answers 304 without asking catalog.
- `THROTTLE_LIMITS.itemImage` is its own named limit. A list of fifty lines is fifty requests
  from one address in a second, which the default limit is not sized for. The cache header means
  a browser asks once per photo, ever. Record the numbers chosen in a decisions section at the
  end of this file.
- The OpenAPI entry declares `image/*` as binary, the way the audio route declares `audio/*`.

## 6. What this plan does not do

- **No copy of a chain's photo, ever.** Plan `0038` section 5.7 stands.
- **No copy of the ingredients, nutrition or packaging crops.** Their text is already in
  `item_facts`. Those crops stay links in `ItemFactsView`.
- **No copy of an owner's photo.** `items.imageUrl` is an address the owner chose.
- **No resize and no new format.** See the first constraint.
- **No cache in the gateway and no CDN rule.** The response headers let either be added later
  with no code change.
- **No credit on the photo route.** A credit is shown where the photo is shown. `imageSource` on
  the item and `attribution` on the facts are what a client renders it from.

## 7. Tests

- `open-facts.client.spec.ts`: a foreign host refused, a wrong content type refused, a body
  above the cap refused, the floor clamped up.
- Catalog integration: the migration up and down, the unique index and the cascade. `store`
  refuses a wrong hash and a stale `sourceUrl`, and replaces on a new revision. `listWanted`
  lists both sizes once, stops listing a stored one, lists again after the front address
  changes, skips suppressed rows, and honours `itemIds`. `refreshSummary` sets a path only for a
  copy of the current address and clears it when the facts are suppressed. No list read selects
  `data`.
- `facts-photo.stage.spec.ts` with a fake `fetch`: pages to the end, one failed download does
  not stop the next, the counters, the `API` run's `itemIds`, abort, the heartbeat, and that the
  watermark is already written when the stage starts.
- Gateway HTTP spec: 200 with the four headers, 304 on a matching `If-None-Match`, 404 for an
  unknown hash, 400 for a malformed one, and that the route answers with no `Authorization`
  header.
- `catalog.mappers.spec.ts`: `imagePath` null for an owner photo, set for a copied one.
- `openapi-document.spec.ts` and `wire-types.spec.ts` pass after regeneration.

## 8. Verification

```sh
npx nx run-many -t lint test -p luna-shopper/open-facts luna-shopper-backend-catalog luna-shopper-backend-harvester luna-shopper-backend-gateway luna-shopper/contracts luna-shopper/platform
npx nx run luna-shopper-backend-catalog:test-integration
npx nx run luna-shopper-backend-harvester:test-integration
npx nx run luna-shopper-backend-gateway:openapi
npx nx run luna-shopper-admin/models:wire-types
npx nx test luna-shopper-admin/models
```

## 9. Acceptance criteria

- [ ] `item_images` exists with its unique index and its cascade, and the entity's doc comment
      states the decision and the exit with the measured numbers.
- [ ] The stored bytes of a fixture photo are identical to the fixture.
- [ ] The client refuses a host that is not a dataset's image host.
- [ ] A facts run copies both sizes of every front crop that has no copy, and a second run with
      nothing changed downloads nothing.
- [ ] A failed download is a warning, and the run still reaches `SUCCEEDED`.
- [ ] An item with a copied photo answers `imagePath` and `thumbnailPath`, and an item whose
      crop changed answers null for both until it is copied again.
- [ ] `GET /v1/catalog/images/:sha256` answers with no credentials, with an immutable cache
      header, and 304 on a matching `If-None-Match`.
- [ ] No list read selects `item_images.data`.
- [ ] No helm file, compose file, `luna-slot.sh` line or environment variable was added.
- [ ] `openapi.json` and `wire-types.ts` are regenerated and their specs pass.
