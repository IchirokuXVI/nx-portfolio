# 0036 The category tree in the back office

> Back office half of backend `0166`. **Lands in the same pull request as `0166`**: the
> generated wire types lose `ItemCategory`, so the admin stops building the moment the
> backend merges, and a stacked PR gets no checks. Followed by `0037` (shop sections).
>
> Prerequisite reading: backend `0166` sections 1 to 3 and 8 (the rules, the wire and the
> fallout table, whose admin rows this plan owns), admin `0033` Context (how sections, routes,
> gateways and wire types work), admin `0035` (the bulk actions and the review step this plan
> reuses), and the `admin-app` notes on descriptors.

Today a product's category is a twelve value select in the item form (`items.ts:88`), a
column, a list filter, and a select on the entries queue for the create override
(`entries-queue-page.ts:445`). After backend `0166` a category is a row with a parent, a
product carries one or more, and the twelve values do not exist. This plan gives the tree a
screen, turns the product's field into a picker of leaves, and gives an operator the one bulk
action the migration makes urgent: every harvested product lands on an `other-*` leaf, and
moving them to real leaves is a filter, a tick and a set.

## Brief for the agent

### Objective

Add a Categories screen under Catalog with create, read, update and delete over two levels.
Replace every use of the twelve value enum with the tree. Add a "Set categories" bulk
action on the items list. Use the `nx-portfolio-angular-developer` skill for the Angular work
and `design-taste-frontend` for the tree screen and the review step.

### Context

- **The enum in the app**: `ITEM_CATEGORY_OPTIONS` in
  `libs/luna-shopper-admin/feature-catalog/src/lib/catalog-enums.ts:18`; the item form field,
  column and filter in `items.ts:88, 132, 150`; the entries queue's `CATEGORIES` and select
  in `feature-harvest/src/lib/entries-queue-page.ts:63, 445, 861, 1434`; `decisions-file.ts:186`
  passing `category` into a `createItem` op; `harvest-memory.ts:517` defaulting it; the seed
  items in `catalog-seed.ts`; the specs `catalog-descriptors.spec.ts`, `entries-queue.spec.ts`,
  `decisions-file.spec.ts`; and the keys `catalog.itemCategory.*` and `harvest.category.*` in
  `ui/assets/i18n/en.json`.
- **Descriptors**: `ResourceDescriptor` and the field kinds in
  `libs/luna-shopper-admin/models/src/lib/resource/resource-field.ts`, among them
  `localized-text`, `reference` (with `nameLookup`) and `references` (many ids, with a
  picker limit read from the row). Sections are `ADMIN_SECTIONS` in
  `apps/luna-shopper-admin/src/app/sections.ts`. Bulk actions are `actions.bulk` with a review
  panel (admin `0035`).
- **The new wire** (backend `0166` section 3): `CategoryView { id, parentId, slug, name,
  position, itemCount }`; `GET /v1/admin/catalog/categories` with `parentId=<id>`,
  `parentId=none` or `kind=root|leaf`; create, read, patch and delete; `ItemView.categories`;
  `categoryIds` on item create, update and the batch update op; `categorySlugs` on the
  harvest create override and the bulk `createItem` op; `categoryId` on the item search.
  Error codes `CATEGORY_TOO_DEEP`, `CATEGORY_NOT_A_LEAF`, `ITEM_NEEDS_A_CATEGORY`,
  `CATEGORY_IN_USE`, `CATEGORY_NOT_FOUND`.
- Rule D4 and its recorded exception: the generated wire types are the view models here
  (admin plan `0004` section 2).

### Target state

1. **Categories screen**, `/catalog/categories`. The list shows roots, each expandable to
   its children, or a flat list filtered by parent through `parentId`. The mock of the
   review step decides. Columns: name, slug, position, products (`itemCount`). Create and
   edit forms: name (`localized-text`, required), slug (`text`, required on create, read
   only after), parent (`reference` to categories with the picker limited to `kind=root`,
   nullable), position (`number`). A refusal `CATEGORY_TOO_DEEP` or `CATEGORY_IN_USE` is a
   sentence beside the field, and `CATEGORY_IN_USE` on delete links to the items list
   filtered by that category through `errorLinks`.
2. **The product's categories.** The item form's `category` select becomes a `references`
   field `categories` to the categories resource, picker limited to `kind=leaf`, required
   with at least one, ordered as the operator lists them (first is first). The list column
   shows the first category's name through `nameLookup`. The list filter becomes a
   `reference` to categories at any level. A root narrows to all its children, as the
   route does.
3. **"Set categories" bulk action** on the items list, in the pattern of `0035`: tick rows,
   pick one or more leaves, review a table of each product's current and new categories,
   then send one `items/batch` with an update op per row carrying `categoryIds`. The result
   lists each product's outcome. It replaces the set: the operator moving products off
   `other-frozen` means to replace.
4. **The entries queue.** The create override's select becomes the same leaf picker,
   sending `categorySlugs`. Empty still means "resolve from the source path". The row
   detail keeps showing `categoryPath`. A decisions file's `createItem` op carries
   `categorySlugs` (backend `0166` section 9), and `decisions-file.ts` passes it through.
5. **Copy and twins.** `catalog.itemCategory.*` and `harvest.category.*` are deleted; the new
   screen's keys are added. The in memory gateway holds a dozen rows of the taxonomy of
   backend `0166` appendix A, refuses a product on a root and a third level, and defaults a
   created product to `uncategorised`.
6. **Specs.** The descriptors spec, the entries queue spec and the decisions file spec pass
   with categories as rows. A screen spec covers the bulk action's review and a refusal.

### Scope

Work only in `libs/luna-shopper-admin/feature-catalog` (a new `categories.ts` descriptor, the
bulk panel, `items.ts`, `catalog-enums.ts`, `catalog-seed.ts`), `feature-harvest`
(`entries-queue-page.ts`, `decisions-file.ts`), `data-access` and its in memory twins,
`ui/assets/i18n/en.json`, `apps/luna-shopper-admin/src/app/sections.ts` for the section
entry, the specs of each, and the generated wire types only by running the generator.

Do not touch: the backend, the curation CLI, product groups, or the harvest run screens.

### Constraints

- **A review step comes before every bulk write** (`0035`). Nothing is sent from a tick.
- The slug is written once. The form makes it read only after create, and the backend
  refuses a change anyway.
- Names are `localized-text` and follow the content language rule of admin `0026`.
- `no-literal-resource-path.spec.ts` still passes: resource paths are composed in the three
  files it allows.
- Only make changes directly requested.

### Action boundaries

Stop and ask before: a drag to reorder (position is a number field in this plan), a merge
of two categories, deleting a category that holds products from the app, or a third level.

### Progress evidence

Per target: the files changed and the spec run. At the end: `npx nx test` and `npx nx lint`
for every touched admin library, `npx nx build luna-shopper-admin`, and a walk of the
Categories screen and the bulk action over HTTP against a slot serving backend `0166`,
including moving ten products off `other-frozen` onto `ice-cream`.

## 1. The screens, in one table

| Screen | Route | Reads | Writes |
| ------ | ----- | ----- | ------ |
| Categories list | `/catalog/categories` | `admin/catalog/categories` | |
| Category form | `/catalog/categories/new`, `/catalog/categories/:id` | `admin/catalog/categories/:id` | create, patch, delete |
| Item form, categories field | `/catalog/items/:id` | `admin/catalog/categories?kind=leaf` for the picker | patch `categoryIds` |
| Items list, category filter | `/catalog/items?categoryId=` | `admin/catalog/items?categoryId=` | |
| Items list, Set categories | `/catalog/items` | | `admin/catalog/items/batch` |
| Entries queue, create override | `/harvest/entries` | the leaf picker | `categorySlugs` on the create |

## 2. Not in this plan

- Shop sections, a section's categories, pins: `0037`.
- Importing or exporting the taxonomy as a file.
- A "merge into" for two leaves that mean the same thing. Until it exists the operator sets
  the products of one onto the other with the bulk action and deletes the empty one.
