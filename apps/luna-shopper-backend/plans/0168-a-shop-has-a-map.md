# 0168: a shop has a map

> Needs `0167` (sections, presence and order per shop, pins per chain) and
> `libs/luna-shopper/shop-map/plans/0001` (the document and `walkOrder`). Back office half:
> admin `0038`. Frontend halves: velista `0121` (the map on the basket), `0122` (drawing
> it) and `0123` (recording it). The moderation of what shoppers submit, beyond the one
> gate this plan builds, is backlog `0017`, beside the user submitted prices of backlog
> `0001` section 2.
>
> Prerequisite reading: `0167` sections 1 to 4, the model plan in full, `0163` section 2
> (the basket read at a shop), `0164` (shops near a point, which reads locations by
> geography), `libs/luna-shopper/osm-places` (the Overpass client, which today asks for
> centres and tags), and `0136` section 2 (who is served shop addresses).

A map is a document per physical shop, never per chain. A shopper draws or records one in
velista and submits it. Nothing is shown until somebody accepts it, because it came from a
shopper. On acceptance the map becomes the shop's current map, and the server reduces it to
two things `0167` already consumes: the shop's ordered section list, and a pin per product
anchor. That is how a map orders a basket without a second ordering system: velista `0120`
groups by the shop's sections, and the map is where the shop's section order comes from.

## Brief for the agent

### Objective

Store shop map documents per location with a status, accept submissions from any account
behind a rate limit, serve the current map and the building outline publicly, and on
acceptance derive the shop's section order and per shop pins from the document with the
model library's `walkOrder`.

### Context

- **Locations** are `supermarket_locations` (`0012`, `0164`), with an OpenStreetMap
  identity where discovery found one. **Sections** are `supermarket_sections`,
  `location_sections` and `supermarket_item_sections` after `0167`, and the read rule of
  `0167` section 3 is served as `sectionIds` on the basket read at a shop.
- **The document** is `ShopMapDocument` from `@portfolio/luna-shopper/shop-map/model`, which
  runs in Node. `validateShopMap` names problems, `walkOrder` answers the ordered sections
  and products, `normalizeShopMap` makes two equal documents hash equal.
- **Barcodes**: `items.ean` exists, and `POST /v1/catalog/items/lookup` takes ids only
  (`LookupItemsDto.ids`).
- **OpenStreetMap**: `osm-places.client.ts` queries Overpass with `out center tags`, so no
  geometry is fetched today. A building way's outline needs `out geom`.
- **Throttling**: the gateway has per route buckets, and the admin has a separate bucket
  (PR #514). Uploads from shoppers need their own.

### Target state

- Tables `shop_maps` and `location_item_sections` exist (section 1), and
  `supermarket_locations` caches an outline.
- `POST /v1/catalog/locations/:id/maps` accepts a document from an account, validates it,
  caps it at 256 KB, and stores it `PENDING`. A second submission by the same person for
  the same shop supersedes their earlier pending one.
- `GET /v1/catalog/locations/:id/map` answers the current document or none, with no
  account, as sections do.
- `GET /v1/catalog/locations/:id/outline` answers the building outline in metres with a
  bearing, fetched from Overpass once and cached on the location, or none.
- `POST /v1/catalog/items/lookup` takes `eans` beside `ids`.
- Accepting a map (section 3) is one transaction that makes it current, rewrites the shop's
  section list in walk order, creates chain sections for category anchors that name none,
  and rewrites the shop's product pins. The rule of `0167` section 3 gains the per shop pin
  as step 1.5.
- The admin routes of section 4 exist. `openapi.json` and `wire-types.ts` are regenerated.

### Scope

Work only in:

- `apps/luna-shopper-backend/catalog/src/app/entities`, `db/migrations`, a new
  `catalog/shop-map.service.ts` with its NATS handlers, `section.service.ts` for step 1.5,
  and `catalog.mappers.ts`
- `libs/luna-shopper/osm-places` for one `outlineOf(osmId)` read with a fixture
- `libs/luna-shopper/contracts`
- `apps/luna-shopper-backend/gateway/src/app/catalog` (public and admin controllers, DTOs,
  the new throttle bucket)
- the regenerated `openapi.json` and `wire-types.ts`

Do not touch: velista, the admin app beyond wire types, the model library beyond consuming
it, the walk order of `0141`, prices, availability.

### Constraints

- **Nothing unaccepted is shown.** The public read answers `CURRENT` only. A shopper's own
  pending map is theirs to see through `mine` (section 4) and nobody else's.
- **The map is per location.** No route takes a chain, and a map's anchors name chain
  sections only through the location's chain.
- **Acceptance is the only writer of the derived tables.** `location_sections` and
  `location_item_sections` for a shop with a current map are rewritten from the map, and a
  hand edit in the back office is overwritten by the next acceptance, which admin `0037`
  and `0038` say on screen.
- **The document is stored as submitted** after `normalizeShopMap`, with the problems it
  had at submission if any were tolerated (none are in this plan: a submission with
  problems is refused with them).
- **The outline is read once.** Overpass is polite by construction (`osm-places` section
  8.2), and an outline changes when a building does.
- Only make changes directly requested.

### Action boundaries

Stop and ask before: auto accepting anything, letting a guest account submit, storing more
than one current map per shop, deriving anything into chain level tables other than a
missing section, or calling Overpass from a request path more than once per location.

### Progress evidence

Per section: the files changed and the spec run. At the end: the migration up and down on
an ephemeral Luna slot, a spec against real Postgres for acceptance (the section list and
pins before and after, a category anchor creating a section, a second acceptance
superseding the first), the submission refused for each `validateShopMap` code and for
size, the outline read against the checked in Overpass fixture, the basket read at a shop
with a map showing the map's order in `sectionIds`, and the regenerated documents.

## 1. The tables

```
shop_maps
  id                     uuid PK
  supermarketLocationId  uuid FK supermarket_locations(id) ON DELETE CASCADE
  version                int NOT NULL         1, 2, 3 per location, assigned on acceptance
  status                 shop_map_status      PENDING | CURRENT | SUPERSEDED | REJECTED
  document               jsonb                normalized ShopMapDocument
  documentHash           varchar              sha256 of the normalized document
  submittedByUserId      uuid NULL            null for a map an operator wrote in the back office
  reviewNote             text NULL
  reviewedAt             timestamptz NULL
  createdAt, updatedAt
  UNIQUE (supermarketLocationId) WHERE status = 'CURRENT'
  INDEX ix_shop_maps_pending (status, createdAt)

location_item_sections              the per shop pin, written by acceptance only
  supermarketLocationId  uuid FK supermarket_locations(id) ON DELETE CASCADE
  itemId                 uuid FK items(id) ON DELETE CASCADE
  sectionId              uuid FK supermarket_sections(id) ON DELETE CASCADE
  shopMapId              uuid FK shop_maps(id) ON DELETE CASCADE
  PRIMARY KEY (supermarketLocationId, itemId, sectionId)

supermarket_locations
  + outline              jsonb NULL   { points: [metres east, metres north][], bearing, source: 'OSM', fetchedAt }
```

## 2. The read rule of 0167, amended

Step 1.5, between the present sections and the chain pins: if `location_item_sections` has
rows for `(S, P)`, the answer is those sections. A per shop pin outranks a chain pin
because it was placed by somebody standing in that shop. Nothing else in the rule moves.

## 3. Acceptance

In one transaction, for map `M` of location `S` in chain `C`:

1. `validateShopMap(M.document)` must be empty, again, because the taxonomy can have moved
   since submission.
2. For every section anchor with a `categoryId` and no `sectionId`, find `C`'s section
   covering exactly that category, else create one named after the category and covering
   it. Write the id back onto the anchor in the stored document.
3. For every product anchor with an `ean` and no `itemId`, resolve it through `items.ean`
   and write `itemId` back. An unresolved barcode stays a barcode and produces no pin.
4. `walkOrder(M.document)`. Replace `location_sections` for `S` with the anchored sections
   in walk order, `position` from the order. A chain section the map does not anchor is
   absent from the shop, which is what a map says.
5. Replace `location_item_sections` for `S` with one row per product anchor that has an
   item and a section.
6. The previous `CURRENT` becomes `SUPERSEDED`, `M` becomes `CURRENT` with the next
   `version`.

Rejection sets `REJECTED` with a note and touches nothing else.

## 4. The wire

```ts
export interface ShopMapView {
  id: string;
  supermarketLocationId: string;
  version: number | null;     // null while PENDING
  status: 'PENDING' | 'CURRENT' | 'SUPERSEDED' | 'REJECTED';
  document: ShopMapDocument;
  submittedByMe: boolean;     // on the public reads
  createdAt: string;
  reviewedAt: string | null;
}

export interface ShopMapAcceptancePreview {
  problems: ShopMapProblem[];
  sections: { sectionId: string | null; categoryId: string | null; name: LocalizedText; willCreate: boolean }[]; // in walk order
  pins: { itemId: string | null; ean: string | null; sectionName: LocalizedText | null }[];
  endsAtCheckout: boolean;
}

export interface LocationOutlineView {
  points: [number, number][]; // metres east and north of the location's coordinate
  bearing: number;            // degrees of the longest wall
  source: 'OSM';
}
```

| Route | Answers |
| ----- | ------- |
| `GET /v1/catalog/locations/:id/map` | the current `ShopMapView` or `{ map: null }`, no account |
| `GET /v1/catalog/locations/:id/outline` | `LocationOutlineView` or `{ outline: null }`, no account |
| `POST /v1/catalog/locations/:id/maps` | `{ document }` from an account, throttled, answers the pending `ShopMapView` or the problems |
| `GET /v1/catalog/locations/:id/maps/mine` | the caller's pending or rejected maps for this shop |
| `POST /v1/catalog/items/lookup` | `{ ids?, eans? }`, the same result shape |
| `GET /v1/admin/catalog/shop-maps?status=&locationId=` | the queue |
| `GET /v1/admin/catalog/shop-maps/:id` | one map with its `ShopMapAcceptancePreview` |
| `POST /v1/admin/catalog/shop-maps/:id/accept` | section 3 |
| `POST /v1/admin/catalog/shop-maps/:id/reject` | `{ note }` |
| `POST /v1/admin/catalog/locations/:id/maps` | an operator's own document, accepted in the same call |

## 5. Not in this plan

- Any screen: velista `0121` to `0123`, admin `0038`.
- Trust, per person quotas beyond the throttle, reports, merging several walks, diffs
  between versions, auto acceptance: backlog `0017`.
- Levels, a scale, a georeferenced export.
- Velista's "where am I": velista backlog `0001`.

## 6. Open questions

- **Guests.** A guest is a real temporary account here. Submitting a map is a lot of work
  for somebody who has not registered, and a guest's pending map is orphaned if the account
  expires. The plan refuses guests. Reverse it if a guest turns out to be the person in the
  shop.
- **Category anchors creating chain sections.** A shopper mapping a Mercadona with no
  configured sections creates Mercadona's section list one anchor at a time, named after
  categories. That is right for an independent shop and probably right for a chain nobody
  configured. An operator renames them in admin `0037`.
