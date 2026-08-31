# 0048 Catalog search, and the product group

Carved out of backlog 0001 sections 3.2 to 3.4, which designed classification and search as
part of the whole price sourcing machine. This plan builds the half a shopping list composer
needs now and leaves the rest where it is: the category tree (backlog 0001 section 3.1), the
multi source price model (section 2), and the harvester's automatic classification ladder
(section 6.2) all stay in the backlog.

The consumer that forces the timing is velista `0043` section 6: after three characters the
list composer offers catalog matches, and choosing one attaches the item to the new line.
`ListLine.itemId` exists today and is null on every line the product has ever created. That
dropdown is what finally populates it, and every history in `0047`, every cross list
indicator, and every price this app will ever show are keyed on that column. The composer
cannot be built against the search that exists: `item.search` is a substring match over one
locale's name with no groups, no ranking and no scopes.

What plan 0038 already shipped, and this plan builds on rather than repeats: `Item` carries a
localized `name`, `brand`, `ean`, `unitSize` and `defaultUnit`; `SupermarketItem` carries one
`price` and one verbatim `unitPrice` per (`itemId`, `priceScopeId`); `PriceScope` exists and
Mercadona's warehouses populate it.

## 1. ProductGroup

A category is a browsing structure. **"Milk" as a thing you can buy** is a different concept
and needs its own entity. This is backlog 0001 section 3.2's argument, unchanged.

**ProductGroup**, in catalog:

- `id` (uuid)
- `name` (jsonb `LocalizedText`, exactly as `Item.name` already is)
- `slug` (unique, stable, for admin tooling and tests)
- `referenceUnit` (`UnitOfMeasure`: the unit its members are compared in)
- `synonyms` (jsonb: per locale string arrays, so `leche` and `milk` reach the same group)

`Item` gains a nullable `productGroupId`. Every Pascual, Central Lechera and Hacendado milk
points at the one Milk group, which declares that they are comparable and that the comparison
happens in litres.

Two deliberate omissions against the backlog design:

- **No `categoryId`.** The group referenced the category tree, and the tree is not being
  built here. The flat `ItemCategory` enum stays as it is, and the column arrives with the
  tree. Nothing in search or in the composer needs it.
- **No automatic assignment.** Assigning items to groups is owner curation through the
  existing admin surface, exactly like every other catalog write. The matching ladder that
  would let a harvest run classify what it finds is backlog 0001 section 6.2 and needs the
  review queue that comes with it. With one chain harvested, hand curating the few hundred
  groups that matter (milk, eggs, bread, oil) is an evening, not a blocker.

### 1.1 The group reaches the shopping list line

`ListLine` gains a nullable `productGroupId` beside the nullable `itemId` from 0007, with a
check constraint that **at most one of the two is set**. "Milk" on a shopping list is a real,
common, deliberately unspecific line, and resolving it to a concrete product is exactly what
the basket optimizer does later (backlog 0004). `GeneratedListLine` in `0050` already carries
both columns with the same rule, so the two line shapes stay parallel.

This is the one part of the plan that reaches outside catalog: one core migration, and
`line.add` accepts the new field. A line with a `productGroupId` renders by the group's
localized name; nothing else about lines changes, and the dedup rule in `0050` section 3
(merge on `itemId`, else `productGroupId`, else normalized text) starts working on its
second key.

## 2. The search implementation

Postgres full text search, not a separate engine. At a few tens of thousands of items one
more stateful dependency buys nothing a GIN index does not already give (backlog 0001
section 3.4).

- Per locale `tsvector` columns on `items` (`search_es`, `search_en`) built from the item's
  name in that locale, its brand, and its group's name and synonyms in that locale, using
  the matching Postgres text search configuration per language. GIN indexed, refreshed by
  trigger on write to the item or to its group.
- `pg_trgm` beside it for typo and partial tolerance, which plain `tsvector` handles badly
  for brand names ("pasqual" should still find Pascual).
- The same pair on `product_groups`, so a group is findable by its own name before it has a
  single member.

## 3. Two read shapes

The two example queries are genuinely different, and they are two messages (backlog 0001
section 3.4):

- **`item.search`** (upgraded in place): ranked items. Answers "Pascual Milk". The existing
  message name, request and response shapes are kept and extended, so the one caller today
  keeps working; the implementation under it changes from substring to the index above.
- **`item.searchOffers`** (new): ranked **groups**, each carrying its cheapest member at the
  requested scopes and the `unitPrice` that made it cheapest, from the `SupermarketItem`
  rows plan 0038 already writes. Answers "milk", and it is the query the composer runs for
  a bare word. A group with no priced member at the given scopes still returns, with the
  price fields null: the composer is attaching identity, not quoting a price, and a group
  must not vanish from suggestions because the one harvested chain is disabled outside
  development.

Ranking, in order: text relevance, then exact brand or group name match, then unit price
ascending where prices exist. Results carry the source kind and observation time of any
price they quote, so a hand entered price is presentable as one.

**The group beats the item for a bare word.** velista `0043` section 6 states it from the
client side and backlog 0004 section 1.2 states it as a hard rule; the server is where it is
enforced. The gateway's suggestion endpoint interleaves the two reads with groups first, so
a client cannot get the ranking wrong.

### 3.1 Scopes are accepted now and resolved later

Both messages take an optional set of `priceScopeId`s, and prices in the response come only
from those scopes. What they do **not** do in this plan is resolve a default when the caller
sends none: that is `0049`'s job, where the gateway fills the set from the caller's shopping
profile, and where an unscoped catalog listing becomes an error. Until `0049` lands, no
scopes means no prices in the results, which degrades exactly the way the composer wants
(suggestions still work, price hints are absent).

Sequencing is the point of this section: this plan is buildable before `0049`, and `0049`
changes the default resolution without touching the messages.

## 4. Contracts, events, migrations

- `ProductGroup` view schema, `item.searchOffers` request and response schemas, and the
  extended `item.search` request in `libs/luna-shopper/contracts/src/schemas`, so 0019
  documents them for free. No new enums: `UnitOfMeasure` exists.
- Gateway: `GET /v1/catalog/product-groups/:id`, and the search endpoints extended with the
  scope and group parameters. The composer's suggestion call is one gateway endpoint
  (`GET /v1/catalog/suggest?q=`) that performs the interleave in section 3, so the ranking
  rule lives server side.
- Catalog migrations: `product_groups`, `items.productGroupId`, the `tsvector` columns,
  their triggers, and the `pg_trgm` extension. One core migration: `list_lines.productGroupId`
  and its check constraint.
- No new events. Catalog reference data has never emitted realtime events and a search does
  not start now.
- The OpenAPI document is regenerated, per the rule in `CLAUDE.md`.

## 5. Open decisions

- Whether the composer's suggest endpoint should also return the caller's own recent free
  text lines as a third source. Leaning no for now: it is a different data source with a
  different privacy shape, and the dropdown should earn its place with the catalog first.
- Seed depth: which groups exist at launch. Leaning the top of Mercadona's own category
  labels for the harvested items, hand assigned, since that is the assortment the dev
  environment actually holds.
- Whether `item.search` should keep answering with no `query` (today it lists). Leaning
  yes, unchanged, because the admin surface uses it as a listing.

## 6. Exit criteria

- A `ProductGroup` with localized names and synonyms exists, owner curated, and items can
  be assigned to one.
- A `ListLine` can carry a `productGroupId` instead of an `itemId`, never both, and renders
  by the group's name.
- Searching "milk" or "leche" returns the Milk group ranked above any single milk item;
  searching a brand returns that brand's items first.
- A typo within trigram distance still finds the brand.
- `item.searchOffers` returns each group's cheapest member and unit price at the requested
  scopes, and returns the group with null price fields when no scope has a price.
- With no scopes given, suggestions work and no prices are quoted.
- The gateway suggest endpoint interleaves groups above items for a bare word.
- The OpenAPI document reflects all of it.
