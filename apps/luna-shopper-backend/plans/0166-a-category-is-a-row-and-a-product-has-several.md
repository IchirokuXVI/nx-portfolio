# 0166: a category is a row, and a product has several

> Frontend halves: velista `0118` (categories are data on the client) and `0119` (the
> category picker on the catalog tab). Back office half: admin `0036`. **This plan and admin
> `0036` land in one pull request**: the wire types the admin builds against lose
> `ItemCategory`, so a backend PR alone fails `affected build` on the admin, and a stacked PR
> gets no checks. Followed by `0167` (shop sections), which maps a shop's aisles onto the rows
> this plan creates and cannot exist against an enum.
>
> Prerequisite reading: backlog `0001` section 3.1 (the tree this plan builds two levels of),
> `0048` (why product groups carry no `categoryId`), `0038` section 5.6 (the lossy mapping onto
> twelve values), `0067` section 6 (the reference seed, whose pattern the taxonomy reuses),
> `0156` (search, which this plan leaves alone), and velista `0077` and `0100` (the two places
> the client already treats a category as an aisle).

Today a product's category is a Postgres enum column on `items`: twelve values, one per
product, named on the wire as `ItemCategory` and drawn from translation keys in two apps.
That was plan `0012`'s placeholder, and it is now the thing in the way. Five reasons, and each
one is a defect a shopper or an operator can see:

1. **Twelve values cannot hold a supermarket.** Mercadona publishes 26 top level categories and
   around two hundred leaves. The gateway's own DTO comment says the mapping onto twelve "is
   lossy by construction". LIDL, Carrefour and DEZA paths run through Mercadona's name table
   at item creation (`source-entry.service.ts:412`), so a node not named like Mercadona lands
   in `OTHER`. A shopper browsing "Pantry" gets olive oil, flour, canned tuna and stock cubes
   in one list.
2. **A product lives in several places.** A frozen pizza is frozen food and a ready meal.
   Sliced cheese is dairy and cold cuts. An oat drink is a milk and a plant drink. One column
   forces a choice that is wrong for half the people looking.
3. **Browsing needs a tree, and a phone needs two levels of it.** Velista `0100` dropped the
   category chip row because "two rows of chips above a list is most of a phone". The phone
   answer is a page of parents and a page of children, which needs parents and children.
4. **Shop sections (`0167`) map onto categories.** A shop's "Pizzas" aisle covers the leaf
   `pizzas`, and its "Frozen" aisle covers the parent `frozen`. A mapping is a row pointing at a
   row, and an enum value is not a row.
5. **A category is a deploy today.** Its name lives in `basket.category.<VALUE>` in velista
   and in two key families in the admin, and the curation and leaflet tools carry the twelve
   values as a vocabulary. Adding a thirteenth is a contracts change, a migration on the enum
   type, three translation files and four prompts, and velista folds an unknown value onto
   `OTHER` in the meantime.

This plan replaces the column with two tables and a seeded taxonomy, and takes the enum off
the wire. The velista client already keeps a product's categories as a **list** and draws a
basket row under every one of them (`basket-view.ts:381`, `compose-basket-view.ts:837`), so
the change on that side is the shape of one element, not the pipeline.

## Brief for the agent

### Objective

Make a category a row in catalog, at most two levels deep, with a localized name and a slug.
Let a product carry one or more leaf categories in a stated order. Seed a starting taxonomy,
move every existing product onto it, and remove `ItemCategory` from the database, the
contracts, the wire and every tool that reads it.

### Context

- **The column**: `items.category` (`catalog/src/app/entities/item.entity.ts:52`), enum type
  `item_category` from `1756000500000-InitialCatalogSchema.ts:17`, default `OTHER`, no index.
  Written by `item.service.ts` create, `createMany` and update (around lines 203, 281 and
  356); read by the search SQL (`:1174`, `:1314`) and by `catalog.mappers.ts:222`.
- **On the wire**: `ItemView.category` (inherited by `BasketProductView`),
  `CreateItemRequest.category` (required), `UpdateItemRequest.category?`,
  `SearchItemsRequest.category?` (`libs/luna-shopper/contracts/src/lib/messages/catalog.messages.ts`),
  the `category?` override on `CreateItemFromSourceEntryRequest` and the bulk `createItem` op
  (`harvest.messages.ts:1313`, `:1387`), and the `enums/ItemCategory` schema in
  `catalog.schemas.ts:62` with its seven references.
- **Seeds**: `catalog/src/app/db/reference/{authored,mercadona}.ts` set the enum per item;
  `ids.ts` derives every reference id from a slug with a fixed v5 namespace, and
  `seed-reference-catalog.ts` upserts by that id on every boot and rewrites names, so a rename
  is safe and a slug is an identity. `libs/luna-shopper/test-fixtures` (`types.ts:255`,
  `demo-world.ts:579`, `factories.ts:274`) feeds the demo seed and dozens of specs.
- **Harvest**: `@portfolio/luna-shopper/mercadona` and `.../lidl` each hold a `categories.ts`
  that maps source node names onto the enum, deepest node first then climbing to the root.
  The harvester calls the Mercadona resolver for every source (`source-entry.service.ts:35`,
  `source-entry-batch.service.ts:20`). Both libraries are framework free and test against
  fixtures with no network. The source path itself is stored verbatim as `categoryPath` and
  is not touched.
- **Tools that read the enum out of the OpenAPI document**:
  `libs/luna-shopper/tools/curation/suggestions/src/rules.mjs:294-307` (throws when
  `enums.ItemCategory` is missing, puts the twelve values in the prompt and the JSON schema,
  requires `category` on a CREATE), its twin `tools/catalog/review-entries.mjs:165-178`,
  the four leaflet vision prompts under `tools/leaflet/chains/src/*/prompt.txt` ("MUST be one
  of exactly these values"), and `tools/leaflet/cli/src/check-page.mjs:36-49` (a hard coded
  twelve value validator). The leaflet reading's `category` ends in `extra.category` of the
  harvest document, which nothing on the backend reads.
- **Nothing else holds a copy.** Core stores no category on a line, realtime relays none, the
  assistant never names one, and the search document of `0156` is name, brand and group name.
- **Product groups** deliberately carry no category (`product-group.entity.ts:24`).
- The gateway's OpenAPI document and the admin wire types are generated and committed
  (CLAUDE.md, "The committed OpenAPI document must always be current").

### Target state

- Tables `categories` and `item_categories` exist with the rules of sections 1 and 2, enforced
  in the service and by triggers.
- `GET /v1/catalog/categories` answers the whole tree. `admin/catalog/categories` has create,
  list, read, update and delete.
- `ItemView.categories` replaces `ItemView.category` on every route that returns an item.
  `categoryIds` replaces `category` on create, update, batch and the harvest override.
  `SearchItemsRequest.categoryId` replaces `category` and accepts a root or a leaf.
- `ItemCategory` no longer exists in `contracts`, and `grep -rn ItemCategory` over the
  workspace answers nothing outside `plans/` and migration history.
- The migration seeds the roots and the landing leaves, moves every product onto its landing
  leaf, and drops the column and the type. A database with 4,300 harvested products migrates
  with no product left without a category.
- The reference seed writes the taxonomy of appendix A and the categories of its own products
  by slug.
- The Mercadona and LIDL resolvers answer a leaf slug, the harvester turns it into an id, and
  every resolver spec passes against the new table.
- The curation and leaflet tools run against the new wire (section 9), and their node tests
  pass.
- `openapi.json` and `wire-types.ts` are regenerated and committed.

### Scope

Work only in:

- `apps/luna-shopper-backend/catalog/src/app/entities`, `db/migrations`, `db/reference`,
  `db/seed`, `catalog/*.service.ts`, `catalog/catalog.mappers.ts` and the NATS handlers for
  categories and items, plus the specs section 8 names
- `libs/luna-shopper/contracts` (messages, schemas, the enum file, error codes)
- `libs/luna-shopper/test-fixtures`
- `apps/luna-shopper-backend/gateway/src/app/catalog` and `.../harvest/harvest.dto.ts`
- `apps/luna-shopper-backend/harvester/src/app/harvest/source-entry*.service.ts` and their
  specs
- `libs/luna-shopper/mercadona/src/lib/{categories,normalize,types}.ts`,
  `libs/luna-shopper/lidl/src/lib/{categories,normalize,types}.ts`, their specs and `index.ts`
- the tools of section 9, to the minimum that section states
- the regenerated `openapi.json` and `wire-types.ts`

Do not touch: velista, the admin app beyond the regenerated wire types (admin `0036` is a
separate plan in the same PR), product groups, prices, search ranking, `categoryPath`, or the
curation prompts beyond the vocabulary paragraph.

### Constraints

- **Two levels, hard coded.** A parent has no parent, and a product attaches only to a row
  that has a parent. Both rules are one row lookups, and both live in the database as well as
  the service, because the admin is not the only writer.
- **Every product has at least one category**, from the migration onward. Create refuses an
  empty list, update refuses emptying it, and delete of a category with products refuses.
- **The enum leaves in this plan.** No deprecated twin on the wire and no version bump on the
  items controller: every consumer is in this repo and ships in the same release, and
  velista's mapper already folds a missing value onto a fallback for the PWA window.
- **Slugs are identities.** The seed derives category ids from slugs through `ids.ts`, the
  migration inserts the roots and landing leaves with those same ids, and nothing renames a
  slug after it ships. Names are the thing that changes.
- **The libraries stay framework free.** A resolver answers a slug string; only the harvester
  knows ids.
- Only make changes directly requested. Do not build shop sections, a source path mapping
  table, icons or a materialized path.

### Action boundaries

Stop and ask before:

- allowing a product on a root, or a third level
- changing the taxonomy of appendix A beyond spelling, if a rule in section 5 cannot be met
- deleting or merging a category that holds products
- touching search ranking or the `search_es` trigger
- rewriting a curation or leaflet prompt beyond the vocabulary paragraph of section 9
- adding a dependency

### Progress evidence

After each numbered section, state what was built and paste the output that proves it:

- The migration run up and down on an ephemeral Luna slot holding a harvested catalog, with
  `SELECT count(*) FROM items i WHERE NOT EXISTS (SELECT 1 FROM item_categories ic WHERE ic."itemId" = i.id)`
  answering 0 afterwards.
- A trigger spec for each of the rules R1, R2 and R4 of sections 1 and 2, against real
  Postgres.
- The resolver specs of both libraries, and the count of Mercadona fixture products that
  resolve to `uncategorised` before and after (section 7 names the target).
- `EXPLAIN` of the search with `categoryId` on a root, using `ix_item_categories_category`.
- The node tests of the curation and leaflet tools.
- The regenerated documents, and the `grep` of the target state.

## 1. The tree

```
categories
  id            uuid PK            derived from the slug by ids.ts for seeded rows
  parentId      uuid NULL          FK categories(id) ON DELETE RESTRICT
  slug          varchar UNIQUE     kebab case, ascii, stable forever
  name          jsonb              LocalizedText, at least one of en and es
  position      int NOT NULL       order among siblings, new rows append
  createdAt, updatedAt
```

Four rules, each one enforced in `CategoryService` with a readable error code **and**, for
three of them, by a trigger or a constraint, because the seed, the migration and any later
writer reach the table too:

| Rule | What it refuses | Error code |
| ---- | --------------- | ---------- |
| R1 | `parentId` naming a row whose own `parentId` is not null | `CATEGORY_TOO_DEEP` |
| R2 | an `item_categories` row whose category has `parentId` null | `CATEGORY_NOT_A_LEAF` |
| R3 | an item with no `item_categories` row (service only, see below) | `ITEM_NEEDS_A_CATEGORY` |
| R4 | deleting a category that has children or products | `CATEGORY_IN_USE` |

R1 also covers the two edits that break the depth: setting `parentId` on a root that
already has children, and clearing `parentId` on a child that has products (R2 catches the
second). R3 is a service rule, not a trigger: a deferred constraint over two tables is more
machinery than the one write path that creates items deserves, and the migration guarantees
the starting state. R4 is the two `ON DELETE RESTRICT` foreign keys, caught and named.

**Why hard coded and not a recursion.** Every rule the product stated is a two level rule:
products only on leaves, a parents page then a children page, a section covering a parent to
mean all its children. With `N` levels each of those needs a depth check anyway, the reads
need a recursive CTE or a materialized path, and the picker needs `N` pages. With two, R1 and
R2 are one row lookups, "a parent's children" is one join, and there is nothing to keep
consistent. If a third level ever arrives, relaxing R1 is a migration. Going the other way
means paying for the generality every day.

**A leaf is a row with a parent, not a row without children.** A fresh root with no children
yet is still not a place for a product (R2), so there is no "a leaf with products refuses its
first child" rule to write. That is the second thing two levels buy.

## 2. Many categories per product

```
item_categories
  itemId        uuid  FK items(id) ON DELETE CASCADE
  categoryId    uuid  FK categories(id) ON DELETE RESTRICT
  position      smallint NOT NULL     0 is first
  PRIMARY KEY (itemId, categoryId)
  UNIQUE (itemId, position)
  INDEX ix_item_categories_category (categoryId, itemId)
```

`position` is an order, not a flag. It decides which category a row shows when it has room
for one (a caption on a product row) and the order the categories are listed in. Grouping a
basket by category draws a product under **every** category it has, as `compose-basket-view`
does today over its list: a product with two categories is in two aisles because somebody put
it there. Writers send `categoryIds` in the order they mean. The service numbers them.

## 3. The wire

```ts
// contracts, catalog.messages.ts
export interface CategoryView {
  id: string;
  parentId: string | null;
  slug: string;
  name: LocalizedText;
  position: number;
  /** Distinct products under this row. A root counts the distinct products under its children. */
  itemCount: number;
}

export interface ItemCategoryView {
  id: string;
  parentId: string; // never null: a product is only ever on a leaf
  slug: string;
  name: LocalizedText;
}

// ItemView
categories: ItemCategoryView[]; // position order, never empty

// CreateItemRequest
categoryIds: string[]; // 1 or more leaf ids, in the order meant
// UpdateItemRequest, the items batch update op
categoryIds?: string[]; // replaces the whole set
// SearchItemsRequest
categoryId?: string; // a leaf, or a root meaning all of its children
// CreateItemFromSourceEntryRequest, the bulk createItem op
categorySlugs?: string[]; // 1 or more leaf slugs; absent means "resolve from categoryPath"
```

The harvest surfaces take **slugs** where the catalog surfaces take ids. A decisions file is
written by a tool or by hand and read by a person, and `["ice-cream"]` is readable where a
uuid is not. Catalog resolves a slug to a row at write time and refuses an unknown one with
`CATEGORY_NOT_FOUND`, the same way it refuses an unknown id.

`ItemView` carries the categories **denormalized** rather than ids alone. Names are data now,
every consumer of an item needs them (the basket read for a guest included, and a guest
reaches no catalog route), and the cost is two short objects per item. The tree route exists
for the picker, not for resolving names.

Routes:

| Route | Answers |
| ----- | ------- |
| `GET /v1/catalog/categories` | `{ categories: CategoryView[] }`, roots then children, by `position` |
| `POST /v1/admin/catalog/categories` | create: `parentId`, `slug`, `name`, optional `position` |
| `GET /v1/admin/catalog/categories` | the same list, with `parentId=<id>`, `parentId=none` or `kind=root|leaf` as filters, so a picker limited to leaves is one query |
| `GET /v1/admin/catalog/categories/:id` | one row |
| `PATCH /v1/admin/catalog/categories/:id` | `name`, `position`, `parentId` |
| `DELETE /v1/admin/catalog/categories/:id` | R4 applies |

A product's categories are written through the item routes (`categoryIds`), not through a
route of their own: the set is a field of the product. The items batch endpoint takes
`categoryIds` on its update op the same way, which is what the back office's "set category"
bulk action (admin `0036`) and a curation pass will use.

## 4. Search by category

`categoryId` on the item search is one `EXISTS` over `item_categories` joined to
`categories`, matching `c.id = $1 OR c."parentId" = $1`, planned on
`ix_item_categories_category`. It composes with `query`, `soldBy`, `priceScopeId` and the
rest as `category` did, in both the ranked branch and the listed branch. Item counts on the
tree route are one grouped query over the same index, and a root's count is the count of
distinct products under its children, not the sum of the leaves.

Search **text** does not change. The `search_es` document of `0156` is name, brand and group
name, and a category name is not added to it here: a shopper typing "pizza" finds pizzas by
name, and velista's one field (`0117`) matches category names on the client, which `0118`
keeps working from the data names. Adding category names to the document is a ranking change
and belongs to a plan that measures it.

## 5. The seed and the taxonomy

`db/reference/categories.ts` states the taxonomy of appendix A as data: roots with `slug`,
`name` and children, each child with `slug` and `name`. `ids.ts` gains `categoryId(slug)`.
The seed upserts every row by that id on every boot, names and positions included, and never
deletes, which is the pattern the products already follow. `authored.ts` and `mercadona.ts`
name each product's categories by slug (`categories: ['frozen-vegetables']`) in place of the
enum, `types.ts` follows, and `reference-catalog.spec.ts` asserts every slug they name exists
in the taxonomy and is a leaf. The demo world in `test-fixtures` and `db/seed/seed.ts` do the
same with slugs.

Rules the taxonomy keeps, and the spec asserts:

- every root has at least one child, and every root has an `other-*` child, so a product
  that fits the root and no leaf has somewhere honest to go
- a slug is ascii kebab case and unique across the whole tree, not only among siblings
- each of the twelve enum values has a named landing leaf (appendix A, last column)

The taxonomy is a starting point authored for Spanish supermarkets. It is edited in the back
office afterwards, and the seed rewrites names and positions on every boot, so a rename in
the file wins and a row added by hand survives.

## 6. The migration

One migration, five steps, up and down:

1. Create `categories`, `item_categories`, the indexes and the triggers of sections 1 and 2.
2. Insert the seventeen roots and the twelve landing leaves of appendix A with the ids
   `ids.ts` derives, `ON CONFLICT (id) DO NOTHING`. The seed adds the rest on the next boot;
   the migration only needs the rows it is about to point products at.
3. `INSERT INTO item_categories ("itemId", "categoryId", position) SELECT id, <landing id of
   category>, 0 FROM items`, one `CASE` over the twelve values.
4. Drop `items.category`.
5. Drop the type `item_category`.

Down recreates the type and the column with default `OTHER`, fills it from each product's
first category's **root** slug where a root corresponds to an enum value, and drops the two
tables. A product moved to a leaf under `ready-meals` or `pets` comes back as `OTHER`, which
is the best a twelve value column can do, and the down path is for a broken deploy, not for
a round trip.

`migrations.integration.spec.ts:137` asserts the enum type exists and flips to asserting it
does not. The four migration specs that `INSERT INTO items ("name","category",...)` by hand
(`price-scope`, `item-prices`, `brands` and their siblings) insert without the column and add
an `item_categories` row where the spec reads the product back.

**After the migration, every harvested product sits on an `other-*` leaf.** That is correct
and temporary: the migration has no better information than the old column. The next
harvest run of each chain and a curation pass over `categoryPath` and names move products to
real leaves. Neither is this plan.

## 7. The harvest mapping, retargeted

The two resolvers keep their rule (deepest node first, then climb) and change their answer:
a **leaf slug** from appendix A, or `null`. Their tables grow from twelve targets to the
leaves, which is where the lossiness of `0038` section 5.6 goes away: Mercadona's "Aceite,
especias y salsas" becomes `oil-and-vinegar`, `spices-and-salt` and `sauces-and-condiments`
by its children rather than `PANTRY` as a whole. The cheese override stays and answers
`cheese`. `NormalizedProduct.category` in both libraries becomes `categorySlug: string |
null`, and LIDL's `extra.category` on the entry follows.

The harvester resolves a slug to an id once per batch through the tree route's NATS twin,
and a `null` becomes `uncategorised`. `req.categoryIds` on the override wins when present, as
`req.category` did. DEZA and Carrefour paths still run through the Mercadona table, as they
do today. Section 11 records the follow up.

Target for the progress evidence: on the checked in Mercadona fixture, fewer than one
product in twenty resolves to `uncategorised`, against roughly one in six landing in `OTHER`
today. If the table cannot reach that, say so with the count rather than widening the table
past what the fixture supports.

## 8. What this breaks, and where

From the sweep of every reader and writer of `ItemCategory` on 2026-09-26. *Breaks* means
the code assumes one enum value per product and stops compiling or running. *Cosmetic* means
labels, comments or fixture values. *Paired plan* means another plan in this series owns the
change.

| Area | Files | Impact | Owner |
| ---- | ----- | ------ | ----- |
| Catalog entity, mapper, service | `item.entity.ts`, `catalog.mappers.ts:222`, `item.service.ts` create, `createMany`, update, both search branches | Breaks | this plan |
| Catalog seeds | `db/reference/{types,authored,mercadona,seed-reference-catalog}.ts`, `db/seed/seed.ts`, `test-fixtures/{types,demo-world,factories}.ts` | Breaks | this plan |
| Catalog specs | `migrations.integration.spec.ts:137`, four migration specs with raw item inserts, and about fifteen service and integration specs with `category:` in item fixtures (`item.service.spec.ts` alone has 17) | Breaks (specs) | this plan |
| `catalog/tools/assign-groups.mjs` | reads `item.category` into a packet, nullable | Cosmetic | this plan, drop the field |
| Contracts | `catalog.enums.ts:110`, `catalog.messages.ts` four fields, `basket.messages.ts:343` by inheritance, `harvest.messages.ts:1313, 1387`, `catalog.schemas.ts` seven sites, `basket.schemas.ts:319`, `harvest.schemas.ts:1138, 1191`, `schemas.spec.ts` | Breaks | this plan |
| Gateway | `catalog.dto.ts:402, 504, 1113`, `catalog-admin.dto.ts:50`, `harvest.dto.ts:421` (its comment about 26 against 12 goes), two controllers passing `query.category`, three gateway specs | Breaks | this plan |
| Harvester | `source-entry.service.ts`, `source-entry-batch.service.ts`, their specs, `matching.spec.ts:30`, `lidl-catalog.runner.ts:263` | Breaks | this plan |
| Chain libraries | `mercadona` and `lidl` `categories.ts`, `normalize.ts`, `types.ts`, `index.ts`, specs, LIDL fixture | Breaks | this plan |
| Curation and leaflet tools | section 9 | Breaks | this plan, to the minimum |
| Admin | `catalog-enums.ts`, `items.ts` field, column and filter, `entries-queue-page.ts` override select, `decisions-file.ts:186`, `harvest-memory.ts:517`, `catalog-seed.ts`, specs, two key families in `en.json` | Breaks | admin `0036`, same PR |
| Velista models and mappers | `enums.ts:463`, `domain.ts:491`, `catalog-browse.ts:80`, `basket-view.ts:381`, three mappers, `compose-list-view.ts` (`lineCategories` reads the scalar), `list-view-store.ts:109`, memory stores | Breaks at type level; at run time the fallback folds every product onto `OTHER` | velista `0118` |
| Velista copy and screens | `basket.category.*` in `en.json` and `es.json`, `list-filter-sheet.html:92`, `list-page.ts:677`, the basket grouping heading | Cosmetic until `0118` | velista `0118` |
| Velista e2e | `apps/velista-luna-e2e/src/shop.spec.ts:113-151, 363` uses the "By category" grouping | Cosmetic unless seed categories change | velista `0118` |
| Core, realtime, assistant, k8s, compose | nothing | none | none |

Two consequences of that table are worth stating plainly:

- **Velista does not stop working when the backend lands first.** Its mappers read `category`
  out of `unknown` and fold a missing value onto `OTHER`, so a client built before `0118`
  groups every product under "Other" and nothing else changes. That is the PWA window, and it
  is tolerable for a release.
- **The admin does stop building**, because it compiles against the generated wire types.
  That is why `0036` is in the same PR.

## 9. The tools that read the enum

Three tools carry the twelve values as a vocabulary, and one of them refuses to start
without the enum in the OpenAPI document. This plan makes the smallest change that keeps
each running against the new wire. A smarter categorization pass is a curation plan, not
this one.

| Tool | Today | Minimum change |
| ---- | ----- | -------------- |
| `curation/suggestions/src/rules.mjs`, `decision.mjs`, `gateway.mjs`, `prompt.md` | reads `enums.ItemCategory` from `openapi.json` and throws without it. The prompt lists twelve values. A CREATE requires `category` and posts it | read the vocabulary from `GET /v1/catalog/categories` at start, as leaf slugs grouped under their root's name. A CREATE requires `categorySlugs` (one or more), which the harvest bulk op takes as they are (section 3). `UNKNOWN_CATEGORY` validates a slug against the read |
| `tools/catalog/review-entries.mjs` and its prompt | the same, older twin | the same change, or retire it if the suggestions tool has replaced it (ask) |
| `tools/leaflet/chains/src/*/prompt.txt`, `tools/leaflet/cli/src/check-page.mjs` | the vision model is told "MUST be one of exactly these values"; `check-page` validates against a hard coded list | the field becomes optional free text the model reads off the page, `check-page` stops validating it, and the value keeps travelling to `extra.category`, where nothing reads it. A reading's category was never used to place a product; removing the constraint loses nothing |

The node tests beside each tool (`*.test.mjs`, `fixtures/queue-page.json`) follow.

## 10. Not in this plan

- Shop sections, a section's categories, pins and the walk order: `0167`.
- A source path to category mapping table per chain: section 11.
- Category names in the search document.
- Icons, a materialized path, a third level.
- Moving products off their landing leaves: a harvest run and a curation pass.
- The client and the back office: velista `0118` and `0119`, admin `0036`.

## 11. Open questions

- **A mapping table per chain.** The code tables in the two libraries are the right first
  step because they are tested against fixtures, but DEZA and Carrefour have no table at all
  and run through Mercadona's. A `source_category_maps(supermarketId, sourcePath, categoryId)`
  table, edited from the back office, is the follow up when an operator wants to fix a
  mapping without a release. It is the same shape as `0167`'s section to category mapping,
  and it is tempting to make it one table. Decide when `0167` is built, not before.
- **Counts on the tree route are catalog wide.** The picker (`0119`) hides an empty leaf on
  them. With a chain chip chosen, a leaf can be empty for that chain and still be shown.
  Acceptable for the first version. A per chain count is one more parameter if it grates.
- **The down migration loses information.** Stated in section 6. Confirm that is acceptable,
  or ask for the old column to be kept for one release.
- **`review-entries.mjs`.** Retire or retarget (section 9).

## Appendix A: the starting taxonomy

Seventeen roots. Each root's `other-*` child is its catch all, and the last column names the
enum value the migration lands there. Spanish names are the ones shoppers here will read; the
English ones are for the back office and the second locale.

| Root (slug: en / es) | Children (slug: en / es) | Landing for |
| --- | --- | --- |
| `fruit-and-vegetables`: Fruit and vegetables / Frutas y verduras | `fruit`: Fruit / Fruta · `vegetables`: Vegetables / Verduras y hortalizas · `salads-and-herbs`: Salads and fresh herbs / Ensaladas y hierbas frescas · `nuts-and-dried-fruit`: Nuts and dried fruit / Frutos secos y fruta desecada · `other-produce`: Other fruit and vegetables / Otras frutas y verduras | `PRODUCE` → `other-produce` |
| `meat`: Meat / Carne | `poultry`: Poultry / Aves · `pork`: Pork / Cerdo · `beef-and-lamb`: Beef and lamb / Vacuno y cordero · `minced-and-burgers`: Minced meat and burgers / Carne picada y hamburguesas · `other-meat`: Other meat / Otras carnes | `MEAT` → `other-meat` |
| `cold-cuts-and-cheese`: Cold cuts and cheese / Charcutería y quesos | `cured-ham-and-sausages`: Cured ham and sausages / Jamón y embutidos · `sliced-cold-cuts`: Sliced cold cuts / Fiambres · `cheese`: Cheese / Quesos · `pates-and-spreads`: Pâtés and spreads / Patés y untables · `other-cold-cuts`: Other cold cuts / Otra charcutería | |
| `fish-and-seafood`: Fish and seafood / Pescado y marisco | `fresh-fish`: Fresh fish / Pescado fresco · `shellfish`: Shellfish / Marisco · `smoked-and-salted-fish`: Smoked and salted fish / Ahumados y salazones · `other-seafood`: Other fish and seafood / Otros pescados y mariscos | `SEAFOOD` → `other-seafood` |
| `dairy-and-eggs`: Dairy and eggs / Lácteos y huevos | `milk`: Milk / Leche · `plant-drinks`: Plant based drinks / Bebidas vegetales · `yogurts-and-desserts`: Yogurts and desserts / Yogures y postres · `butter-and-cream`: Butter and cream / Mantequilla y nata · `eggs`: Eggs / Huevos · `other-dairy`: Other dairy / Otros lácteos | `DAIRY` → `other-dairy` |
| `bakery`: Bakery / Panadería y bollería | `bread`: Bread / Pan · `pastries-and-cakes`: Pastries and cakes / Bollería y pasteles · `toasts-and-crispbread`: Toasts and crispbread / Tostadas y picos · `other-bakery`: Other bakery / Otra panadería | `BAKERY` → `other-bakery` |
| `breakfast-and-sweets`: Breakfast and sweets / Desayuno y dulces | `cereals`: Cereals / Cereales · `biscuits`: Biscuits / Galletas · `jam-honey-and-spreads`: Jam, honey and spreads / Mermelada, miel y cremas de untar · `chocolate-and-sweets`: Chocolate and sweets / Chocolate y golosinas · `coffee-tea-and-cocoa`: Coffee, tea and cocoa / Café, té y cacao · `other-breakfast`: Other breakfast and sweets / Otros desayunos y dulces | |
| `pantry`: Pantry / Despensa | `pasta-rice-and-legumes`: Pasta, rice and legumes / Pasta, arroz y legumbres · `canned-food`: Canned food / Conservas · `oil-and-vinegar`: Oil and vinegar / Aceite y vinagre · `sauces-and-condiments`: Sauces and condiments / Salsas y condimentos · `flour-sugar-and-baking`: Flour, sugar and baking / Harina, azúcar y repostería · `spices-and-salt`: Spices and salt / Especias y sal · `soups-and-stock`: Soups and stock / Sopas y caldos · `other-pantry`: Other pantry / Otra despensa | `PANTRY` → `other-pantry` |
| `frozen`: Frozen / Congelados | `frozen-vegetables`: Frozen vegetables / Verduras congeladas · `frozen-fish-and-seafood`: Frozen fish and seafood / Pescado y marisco congelado · `frozen-meals-and-pizzas`: Frozen meals and pizzas / Platos preparados y pizzas congeladas · `ice-cream`: Ice cream / Helados · `other-frozen`: Other frozen / Otros congelados | `FROZEN` → `other-frozen` |
| `ready-meals`: Ready meals / Platos preparados | `pizzas`: Pizzas / Pizzas · `prepared-dishes`: Prepared dishes / Platos cocinados · `salads-and-sandwiches`: Salads and sandwiches / Ensaladas y sándwiches · `fresh-pasta-and-dough`: Fresh pasta and dough / Pasta fresca y masas · `other-ready-meals`: Other ready meals / Otros platos preparados | |
| `snacks`: Snacks / Aperitivos | `crisps`: Crisps / Patatas fritas · `salty-snacks`: Salty snacks / Snacks salados · `olives-and-pickles`: Olives and pickles / Aceitunas y encurtidos · `other-snacks`: Other snacks / Otros aperitivos | `SNACKS` → `other-snacks` |
| `drinks`: Drinks / Bebidas | `water`: Water / Agua · `soft-drinks`: Soft drinks / Refrescos · `juices`: Juices / Zumos · `beer`: Beer / Cerveza · `wine-and-cava`: Wine and cava / Vino y cava · `spirits`: Spirits / Licores y destilados · `other-drinks`: Other drinks / Otras bebidas | `BEVERAGES` → `other-drinks` |
| `baby`: Baby / Bebé | `baby-food`: Baby food / Alimentación infantil · `nappies-and-wipes`: Nappies and wipes / Pañales y toallitas · `other-baby`: Other baby / Otros de bebé | |
| `pets`: Pets / Mascotas | `dogs`: Dogs / Perros · `cats`: Cats / Gatos · `other-pets`: Other pets / Otras mascotas | |
| `household`: Household / Hogar y limpieza | `cleaning`: Cleaning / Limpieza del hogar · `laundry`: Laundry / Lavado de ropa · `dishwashing`: Dishwashing / Lavavajillas · `paper-and-wipes`: Paper and wipes / Papel y toallitas · `bags-foil-and-wrap`: Bags, foil and wrap / Bolsas, papel de aluminio y film · `other-household`: Other household / Otros de hogar | `HOUSEHOLD` → `other-household` |
| `personal-care`: Personal care / Cuidado personal | `hair`: Hair / Cabello · `skin-and-body`: Skin and body / Piel y cuerpo · `oral-care`: Oral care / Higiene bucal · `shaving-and-deodorant`: Shaving and deodorant / Afeitado y desodorante · `feminine-care`: Feminine care / Higiene íntima · `pharmacy`: Pharmacy / Parafarmacia · `other-personal-care`: Other personal care / Otro cuidado personal | `PERSONAL_CARE` → `other-personal-care` |
| `other`: Other / Otros | `uncategorised`: Not yet categorised / Sin categoría | `OTHER` → `uncategorised` |

Eighty leaves. The first velista picker page draws seventeen rows, which fits a phone with
room for a title, and no children page exceeds eight.
