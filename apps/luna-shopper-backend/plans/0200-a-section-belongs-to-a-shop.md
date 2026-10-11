# 0200: a section belongs to a shop

> Asked for by the owner on 2026-10-11, with the redesign of the shopping list: "Sections of
> a shop are almost never the same for other shops of the same chain, so sections are only
> shop-wide, not chain-wide (remove the feature that adds sections to chains, only keep
> them for shops)". And later: "only sections of the specific shop you are buying at should
> be shown, i don't want chain sections. Don't add the 'copy sections of another shop'."
>
> This plan is the catalog, the gateway and the release task. Back office plan `0063` is the
> screens, and velista plan `0138` stage 2 is the reader.
>
> Prerequisite reading: plan `0167` (sections of a chain, the list of a shop, pins), plan
> `0168` (a walk writes the list of a shop), plan `0170` (section names on shop rows), plan
> `0173` (the category tree that `section_categories` points at), k8s plan `0011` and
> `k8s/release-tasks/README.md`, `catalog/src/app/catalog/section.service.ts`,
> `location-sections.ts`, `sections.controller.ts`,
> `catalog/src/app/db/migrations/1758200000000-ShopSections.ts`,
> `catalog/src/app/shop-walks/shop-walk.service.ts`,
> `gateway/src/app/catalog/catalog-admin.controller.ts` and `SECTION_PATTERNS` in
> `libs/luna-shopper/contracts/src/lib/messages/catalog.messages.ts`.

A section is owned by a chain today, and a shop only selects and orders the sections of its
chain. A shop with no selection inherits every section of the chain. This plan makes the
shop the owner. A chain has no sections, a product has no pin, and a shop with no sections
of its own has none.

## Brief for the agent

### Objective

Move sections from the chain to the shop: two new tables, a migration that copies what each
shop selected, the service, the NATS patterns, the gateway routes, the walk, a release task
that removes the old rows, and the regenerated `openapi.json` and admin wire types.

### Context

Every statement below was read on `dev` at `6cced1bd`. Check each one before you rely on
it.

- **Four tables hold sections** (migration `1758200000000-ShopSections.ts`):
  `supermarket_sections` (owned by `supermarketId`), `section_categories` (a section covers
  a root or a leaf category), `location_sections` (the sections a shop selected, with a
  `position`), and `supermarket_item_sections` (the pin: chain, item, section). Two triggers
  keep a shop and a pin inside one chain.
- **A shop with no `location_sections` rows inherits the chain's sections** in `position`
  order. The `present` CTE of `ITEMS_AT_LOCATION_SQL` (`section.service.ts`) and of
  `PRESENT_SECTIONS_SQL` (`location-sections.ts`) does it, and the answer names its
  `source` as `CHAIN` or `LOCATION`.
- **`section.itemsAtLocation` answers a step for each item**: `PINNED`, `COVERED` or
  `NONE`. A root category covers its children.
- **A map walk creates chain sections by name.** `SectionService.followWalk` matches the
  names of a walk against the chain's sections, `createWalkSections` inserts the missing
  ones into `supermarket_sections` for the chain of the shop, and then the shop's
  `location_sections` are replaced.
- **Later migrations read `section_categories`**: `1758500000000-DiaCategoryTree.ts` and
  `1758600000000-CategoriesBeyondDia.ts`.
- **The gateway has ten section routes** under `admin/catalog` and one public route,
  `GET /v1/catalog/locations/:id/sections`.
- **A change that deletes rows a person wrote goes in a release task**, not in a migration
  (CLAUDE.md, k8s plan `0011`).

### Target state

1. A section is a row of `shop_sections`, owned by one `supermarketLocationId`, with its
   own `position`. Its categories are rows of `shop_section_categories` (section 1).
2. A migration copies the selection of every shop into the new tables and deletes nothing
   (section 2).
3. Every reader and writer uses the new tables. No answer carries a `source`, and no item
   is `PINNED` (sections 3 and 4).
4. A walk creates and orders the sections of the shop it walked (section 5).
5. Release task `0004` removes the rows of the four old tables (section 6).

### Scope

- `apps/luna-shopper-backend/catalog`: entities, one migration, `SectionService`, the two
  SQL files, the controller, the walk, the in memory fixtures and the specs.
- `libs/luna-shopper/contracts`: `SECTION_PATTERNS`, the section messages and schemas.
- `apps/luna-shopper-backend/gateway`: the admin and public section routes and their DTOs,
  `basket-catalog.service.ts` (`sectionsAt`), `openapi.json`.
- `libs/luna-shopper-admin/models`: the regenerated wire types only.
- `k8s/release-tasks/tasks/0004-remove-chain-sections/`.

### Constraints

- **The migration deletes nothing and drops nothing.** The four old tables stay as they
  are, unread. The release task empties them. A later plan drops the empty tables.
- **No inheritance of any kind.** A shop with no rows in `shop_sections` has no sections.
  Do not add a fallback, a default set or a copy from another shop.
- **No pin.** Nothing replaces `supermarket_item_sections`. A product is in a section only
  through a category of that section.
- **`openapi.json` and the wire types are generated output.** Regenerate both, never edit
  them by hand.
- **Raw SQL is checked against a real Postgres**, as the existing section specs do.

### Action boundaries

- Do not build back office plan `0063` or velista plan `0138`. Their agents read this
  contract.
- Do not drop the old tables, their triggers or their entities' migrations.
- **Stop and ask the owner for `PRODUCTION_RELEASE`** before you write `task.env`. The
  windows are at most 14 days after the commit that writes them.
- Search for every writer of `supermarket_sections` and `supermarket_item_sections`, the
  harvester included. If one exists outside the files in scope, report it and stop.

### Progress evidence

- `npx nx run-many -t lint test -p luna-shopper-backend-catalog luna-shopper-backend-gateway`
  pass, with the integration specs of the migration and of the section service run on a
  slot.
- `npx nx run luna-shopper-backend-gateway:openapi` and
  `npx nx run luna-shopper-admin/models:wire-types` are run and their diffs committed.
- `node k8s/release-tasks/check-tasks.mjs` passes with the new task.
- The pull request names the count of rows the migration copied on a slot that holds
  sections, and the count the task would delete.

## 1. The tables

- **`shop_sections`**: `id`, `createdAt`, `updatedAt`, `supermarketLocationId` (foreign key
  to `supermarket_locations`, cascade), `slug` varchar(80), `name` jsonb, `position` (0 or
  more). Unique on `(supermarketLocationId, slug)` and on
  `(supermarketLocationId, position)`.
- **`shop_section_categories`**: primary key `(sectionId, categoryId)`. `sectionId` cascades
  from `shop_sections`. `categoryId` is restricted from `categories`, as today.
- No trigger is needed, because a section names its one shop.

## 2. The migration

For each row of `location_sections`, insert one row of `shop_sections` for that shop with
the `slug` and `name` of the chain section and the `position` of the selection, and one row
of `shop_section_categories` for each category of the chain section.

- A shop with no selection gets nothing. The owner decided this.
- `down` removes the two new tables. It restores nothing, because `up` deleted nothing.
- The integration spec seeds two shops of one chain with different selections, one shop
  with none, and one pin. It asserts the copies, that the third shop has no sections, and
  that the old rows are still there.

## 3. The service and its patterns

| Today | After |
| --- | --- |
| `section.create` for a chain | `section.create` for a shop (`supermarketLocationId`) |
| `section.list` for a chain | removed |
| `section.get`, `section.update`, `section.delete` | the same, on `shop_sections` |
| `section.forLocation` | the sections of the shop in `position` order, with no `source` |
| `section.setForLocation` | sets the order of the shop's own sections. It refuses an id of another shop |
| `section.listPins`, `section.setPins` | removed |
| `section.itemsAtLocation` | `COVERED` or `NONE` for each item. `PINNED` is removed from the contract |
| `section.namesForLocations` | the same, read from `shop_sections` |

- A delete of a section closes the gap in `position` inside one transaction.
- A slug is unique in its shop. Two shops of one chain can both have `fruteria`.

## 4. The gateway routes

- Removed: `POST` and `GET admin/catalog/supermarkets/:id/sections`, `GET` and
  `PUT admin/catalog/supermarkets/:id/item-sections`.
- Added: `POST admin/catalog/locations/:id/sections`, which creates a section of that shop
  after its last position.
- Kept: `GET` and `PUT admin/catalog/locations/:id/sections`,
  `GET admin/catalog/locations/:id/item-sections` (the preview), `GET`, `PATCH` and
  `DELETE admin/catalog/sections/:id`, and the public
  `GET /v1/catalog/locations/:id/sections`.
- The answers lose `source` and the chain id of a section. `BasketProductView.sectionIds`
  keeps its meaning.

## 5. The walk

`followWalk` matches the names of the walk against the sections of the shop that was
walked. It creates the missing ones for that shop, with no categories, and writes the order
of the walk into `position`. It locks the shop row and not the chain row.

## 6. Release task `0004-remove-chain-sections`

- `check.sh` refuses to run when `shop_sections` does not exist, or when a row of
  `location_sections` has no copy in `shop_sections`. The copy is matched on shop and slug.
- `post.sh` deletes the rows of `supermarket_item_sections`, `location_sections`,
  `section_categories` and `supermarket_sections`, in that order.
- `task.env` states `DATABASES` (catalog), the two windows and `PRODUCTION_RELEASE`, with a
  maximum row count for each environment, as task `0003` does.
- The dump the runner keeps is the way back. `k8s/release-tasks/README.md` is the contract.

## 7. Not in this plan

The drop of the four old tables, the back office screens (plan `0063`), the velista reader
(plan `0138`), and shop maps, which keep reading the sections of their one shop.
