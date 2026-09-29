# 0168: a shop has walks, and one of them is its map

> Rewritten on 2026-09-29. The first version stored map documents that any shopper
> submitted and an operator accepted, drawn on a grid of fixtures. Nothing of it was built.
> The design changed over five rounds of the mock: a map is drawn from camera walks in
> metres, only accounts with the mapping permission walk, a shop has several walks with a
> history each, and one walk is shown to shoppers.
>
> Needs `0175` (roles and the `shopMap.record` permission), `0167` (chain sections and a
> shop's ordered section list, built in #527), and `libs/luna-shopper/shop-map/plans/0002`
> (the document in metres, the walk log, `walkOrderV2` and `shopperView`). Frontend halves:
> velista `0121` (the shop's page and the map shoppers see), `0122` (the walks of a shop),
> `0123` (editing by hand) and `0126` (recording a walk). The shop's size is `0176`.
>
> Mock: `apps/velista/plans/mocks/shop-map/`, published at
> https://claude.ai/artifact/Q3iEPafsH5G9Aqgvkgqi1f.

A walk is an append only log of entries, and the map is what the log folds to. A shop has
any number of walks, each with a name, and at most one is shown to shoppers. Saving a walk
appends an entry, rewinding appends an entry, and nothing is ever rewritten. The walk
shown to shoppers also writes the shop's section order into `0167`'s tables every time it
changes, which is how a map orders a basket without a second ordering system.

## Brief for the agent

### Objective

Store walks per location with their append only log and snapshots, serve the shown walk's
map to anybody, serve and change walks for accounts with `shopMap.record`, and keep the
shop's section list of `0167` in the shown walk's order.

### Context

- **Locations** are `supermarket_locations`. `GET /v1/catalog/locations/:id` answers
  `SupermarketLocationView` to any signed in account, guests included.
- **Sections** (`0167`): `supermarket_sections` per chain with a slug and a localized name,
  `location_sections` for a shop's presence and order, and the read rule that serves
  `sectionIds` on the basket read at a shop.
- **The model library** runs in Node: `validateShopMapV2`, `foldWalk`, `stateAt`,
  `walkOrderV2`, `shopperView`, `normalizeShopMapV2`.
- **Sizes** (`shop-map/plans/0002`): the log of an 18 minute walk is about 100 KB. Raw
  sensor streams are never sent.
- **Decisions of the mock** (all fixed):
  - Saves happen every 20 s while walking, on every stop, on leaving the page and on closing
    the app. A failed save warns the person.
  - Shoppers see the shown walk as of its last save, not live.
  - A rewind adds a "Rewound to" entry and changes no earlier entry. Rewinding past a
    rewind is allowed.
  - Walks are renamed and deleted, and one is shown to shoppers at a time.

### Target state

- Tables of section 1, with a migration.
- The routes of section 3, the permission routes behind `@RequirePermission('shopMap.record')`.
- Appending an entry (section 2) is idempotent on the entry's id, refuses a stale base, and
  folds the walk's current document inside the same transaction.
- A change to the shown walk rewrites `location_sections` for its shop in walk order and
  creates chain sections for names the chain does not have (section 4).
- `SupermarketLocationView` and the admin location read gain `hasMap: boolean`.
- `openapi.json` and `wire-types.ts` are regenerated.

### Scope

Work only in `apps/luna-shopper-backend/catalog/src/app` (entities, migrations, a new
`shop-walks/` module with its NATS handlers, `section.service.ts` for section 4, the
location read), `libs/luna-shopper/contracts`, `apps/luna-shopper-backend/gateway/src/app/catalog`
(a `shop-walks.controller.ts`, DTOs, a throttle bucket for entries), and the regenerated
`openapi.json` and `wire-types.ts`.

Do not touch: velista, the back office, the model library beyond consuming it, `0167`'s
read rule, prices, availability.

### Constraints

- **The log only grows.** No route updates or deletes an entry. Deleting a walk sets
  `deletedAt` and keeps its entries.
- **The public read answers the shown walk only**, projected with `shopperView`, with no
  account needed. Walks, entries and marks are served only with the permission.
- **One shown walk per shop**, enforced by a partial unique index.
- **Every stored document passes `validateShopMapV2`.** An entry whose fold does not is
  refused with the problems.
- **Size caps**: 256 KB per entry, 2 MB per folded document.
- Only make changes directly requested.

### Action boundaries

Stop and ask before: storing raw sensor streams, serving a walk that is not shown without
the permission, editing or deleting an entry, writing chain sections for anything other
than a section name the chain lacks, or changing `0167`'s read rule.

### Progress evidence

Per section: the files changed and the spec run. At the end: the migration up and down on
an ephemeral Luna slot, a spec against real Postgres that appends the El Jamón fixture log
of `shop-map/plans/0002` entry by entry and reads the same document the library folds, a
retried entry answering the first result, a stale base refused, a rewind past a rewind, the
section list of the shop in walk order after the walk is shown, the public read without an
account, and the regenerated documents.

## 1. The tables

```
shop_walks
  id                     uuid PK
  supermarketLocationId  uuid FK supermarket_locations(id) ON DELETE CASCADE
  name                   varchar(80)
  shown                  boolean NOT NULL DEFAULT false
  lastSeq                int NOT NULL DEFAULT 0
  document               jsonb NOT NULL      the folded ShopMapDocumentV2, normalized
  createdByUserId        uuid
  deletedAt              timestamptz NULL
  createdAt, updatedAt
  UNIQUE (supermarketLocationId) WHERE shown AND deletedAt IS NULL

shop_walk_entries
  id                     uuid PK             given by the client
  walkId                 uuid FK shop_walks(id) ON DELETE CASCADE
  seq                    int NOT NULL        UNIQUE (walkId, seq)
  kind                   shop_walk_entry_kind
  at                     timestamptz
  logFrom, logTo         bigint              log milliseconds
  events                 jsonb
  rewoundTo              bigint NULL
  reason                 varchar NULL
  snapshot               jsonb NULL          the fold after this entry, every 20th entry and on every rewind
  createdByUserId        uuid
  createdAt
```

## 2. Appending an entry

`POST /v1/catalog/walks/:walkId/entries` takes `{ id, baseSeq, kind, at, logFrom, logTo,
events, rewoundTo?, reason? }`. In one transaction, with the walk row locked:

1. An entry with this `id` exists: answer it. A retried save is not an error.
2. `baseSeq` is not the walk's `lastSeq`: refuse with 409 `WALK_CHANGED` and the current
   `lastSeq`. Two phones on one walk see this, and the second reloads.
3. Fold the new entry onto `document` (for `rewound`, with the log read back from the last
   snapshot), validate it, and store the entry with `seq = lastSeq + 1`, the snapshot when
   this entry needs one, and the new `document` and `lastSeq` on the walk.
4. If the walk is shown, run section 4.

## 3. The wire

| Route | Answers |
| ----- | ------- |
| `GET /v1/catalog/locations/:id/map` | `{ map: ShopMapView \| null }`, the shown walk through `shopperView`, no account |
| `GET /v1/catalog/locations/:id/walks` | the shop's walks (name, shown, last change, entry count, mark count), permission |
| `POST /v1/catalog/locations/:id/walks` | `{ name }`, a new empty walk, permission |
| `PATCH /v1/catalog/walks/:walkId` | `{ name?, shown? }`, permission. `shown: true` unshows the shop's other walk in the same transaction |
| `DELETE /v1/catalog/walks/:walkId` | sets `deletedAt`, permission. A shown walk stops being shown and the shop has no map |
| `GET /v1/catalog/walks/:walkId` | the walk, its `document`, and its timeline (one row per entry without events), permission |
| `GET /v1/catalog/walks/:walkId/log?fromSeq=` | entries with their events from the snapshot at or before `fromSeq`, for a rewind preview folded on the phone, permission |
| `POST /v1/catalog/walks/:walkId/entries` | section 2, permission, throttled per account at 10 a minute |

```ts
export interface ShopMapView {
  walkId: string;
  savedAt: string;
  view: ShopperView;              // from shop-map/plans/0002 section 5
  sections: { name: string; sectionId: string }[]; // the chain sections the names resolved to, in walk order
}
```

## 4. The shop's sections follow the shown walk

When the shown walk changes or a walk becomes shown:

1. `walkOrderV2(document)` answers section names in walk order.
2. Each name resolves to the chain's section whose localized name matches it after
   trimming and case folding, in any locale. A name with no match creates a chain section
   with that name in the account's locale and a slug from it, covering no category.
3. `location_sections` for the shop is replaced by the resolved sections in that order.

A hand edit of a shop's sections in the back office is overwritten by the next save of
the shown walk. Admin `0040` says so on the sections panel of a shop with a map, which
reads `hasMap` from the admin location read.

## 5. Not in this plan

- Screens: velista `0121`, `0122`, `0123` and `0126`.
- Per shop pins of products, which the first version derived from product anchors. The new
  document has no product anchors.
- Moderation of what shoppers submit: backlog `0017`. Only accounts with the permission
  write walks, so nothing here waits for review.
- The shop's size from OpenStreetMap: `0176`.
