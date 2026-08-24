# 0012 Catalog: items and supermarkets

The **last** plan, built after everything else is done. It introduces the product catalog: the
real items you buy and the supermarkets that sell them, all owned and edited **only by the app
owner**, never by users. It connects to shopping lines through the optional `itemId` and the
`quantity` already added in 0007.

## 1. New service

A dedicated `luna-shopper-catalog` service with its own database, kept separate because it is a
different concern (owner curated reference data, read by everyone) with a different write
audience (the app owner alone). Core references catalog only by an opaque `itemId`, so the two
databases stay independent, consistent with the rest of the system.

## 2. Data model (catalog database)

TypeORM classes local to catalog. Localized text fields carry **at least English and Spanish**
(0004 section 12). Timestamps omitted.

**Supermarket** (the chain / brand, one row per brand)
- `id` (uuid)
- `name` (localized)
- brand level info (logo, website, ...)
- Example: "Mercadona" is a single row.

**SupermarketLocation** (a physical location of a chain, many per chain)
- `id` (uuid)
- `supermarketId` -> Supermarket
- `label` (localized, optional)
- address, geo coordinates, and other location specific info
- Example: Mercadona's 50 stores are 50 rows.

**Item** (the actual product, owner managed)
- `id` (uuid)
- `name` (localized)
- `brand`
- `image`
- `sku`
- further item level info (category, default unit, ...)
- Items are never created by users.

**SupermarketItem** (the segregated, per location product: the "slave")
- `id` (uuid)
- `itemId` -> Item
- `supermarketLocationId` -> SupermarketLocation
- `price`
- `positionInStore` (aisle / shelf / section)
- further per location info (per store availability, promotions, ...)
- unique (`itemId`, `supermarketLocationId`)

So an `Item` is one global product; its `SupermarketItem` rows carry the price and in store
position for each specific store. In the example, one item can have up to 50 `SupermarketItem`
rows, one per Mercadona location.

Any constant sets (unit of measure, category) are enums, per the project rule.

## 3. Ownership and access

- **Write access is the app owner only.** Creating and editing supermarkets, locations, items,
  and supermarket items is gated behind a **platform admin** role (a claim on the owner's
  registered account, or a small allowlist), distinct from a zone owner. This platform admin
  role is also what will later power the admin back office (the zone usage listing deferred in
  0006 section 7).
- **Read access** is open to authenticated users: search items, and view an item's per store
  price and position.

## 4. Integration with lines

- `ListLine.itemId` (added nullable in 0007) becomes the live optional link to an `Item`. A line
  may reference an item or be free text; it is never required to have one. `quantity` already
  lives on the line.
- Because catalog is a separate service, a line stores only the opaque `itemId`. When a client
  shows a line with an item, it fetches the item (and, if a store is chosen, the matching
  `SupermarketItem` for price and position) from the catalog read API. Core never joins to the
  catalog database.
- The core migration that formalizes `itemId` as a validated reference (still cross service, so
  validated in application code rather than by a database foreign key) lands with this plan.

## 5. Migrations

Catalog's first migration creates `Supermarket`, `SupermarketLocation`, `Item`, and
`SupermarketItem`. Append only. Any core side change for the `itemId` link is a new core
migration.

## 6. Exit criteria

- The app owner can manage supermarkets, their locations, items, and per location prices and
  positions; users cannot write any of it.
- Authenticated users can search items and read per store price and position.
- A shopping line can optionally reference an item and always carries a quantity; a line without
  an item still works.
- Localized fields carry English and Spanish at minimum.
- Catalog owns its own database and is referenced from core only by opaque `itemId`.
