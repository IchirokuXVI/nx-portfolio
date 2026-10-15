> **PR:** [#722](https://github.com/IchirokuXVI/nx-portfolio/pull/722)

# 0063: sections are the shop's

> Asked for by the owner on 2026-10-11: "Sections of a shop are almost never the same for
> other shops of the same chain, so sections are only shop-wide, not chain-wide (remove the
> feature that adds sections to chains, only keep them for shops)." And: "Don't copy chain
> sections to each shop, I don't want them."
>
> Backend plan `0200` moves sections from the chain to the shop and removes pins. This plan
> is the back office that edits them. **Build it on a branch that holds plan `0200`**,
> because the wire types it compiles against come from that contract.
>
> Prerequisite reading: backend plan `0200`, back office plan `0037` (shop sections in the
> back office) and `0036` (categories), plan `0004` section 2 (the wire types are the view
> models), and in `libs/luna-shopper-admin/feature-catalog/src/lib/`: `sections.ts`,
> `chain-sections.ts`, `chains/section-tabs.ts`, `chains/chains-routes.ts`,
> `location-sections.ts`, `shop-sections.ts`, `item-sections-panel.ts`,
> `products/product-tabs.ts`, `section-rules.ts` and `section-seed.ts`.

The back office edits sections on the record of a chain, lets a shop select and order them,
and pins products to a section on the record of a product. After this plan a section is
created, named, given its categories, ordered and deleted on the record of its shop, and
nowhere else.

## What the build decided

The build of 2026-10-15 settled the points below. None was asked of the owner, so each is a
choice of the builder that the owner can overturn. Where this section and a later section
disagree, this section is right.

1. **The preview moved to the sections tab of the shop.** Target 2 removes the section
   panel of a product, and that panel held the preview (admin plan `0037`, target 4). Target
   5 and section 2 keep the preview, so it is now under the list of the shop: a product
   picker over every product, and one sentence. It reads what the server holds, not the
   order in hand, and it is asked again after a delete.
2. **The order is held and saved whole.** A move changes nothing on the server until "Save
   this order", which sends every section of the shop in the order shown in one
   `PUT locations/:id/sections`. This keeps the bar, the drag, the arrow keys and the phone
   buttons of the old panel. A delete keeps an order in hand, less the deleted section.
3. **A row opens the section to be read, not as a form.** The name of the row links to
   `/chains/{chainId}/shops/{shopId}/sections/{id}`, where Edit turns the page into the form,
   as every other record page does (admin plan `0053`).
4. **The form has no order field.** `CreateShopSectionDto` has no `position`, and a new
   section goes last. `UpdateShopSectionDto` takes one, but the tab owns the order, so the
   descriptor offers name, slug (on create only) and categories. The `locationCount` column
   and the search filter left with the chain list, because the route of a shop takes no
   query.
5. **The map question stays, for a move only.** A walk writes the order of the sections of
   its shop (backend plan `0200`, section 5), so the first move of a visit at a shop with a
   map still asks first. Add, open and delete never ask, because a walk deletes no section.
   The words now say "order" where they said "list".
6. **`section_of_another_shop` has its sentence.** The case for `section_of_another_chain`
   in `gateway-error-key.ts` (`libs/luna-shopper-admin/feature-resource`) became the case for
   the new code. That file is outside the stated scope. It was the one place the code could
   get a sentence, and backend `0200` removed the old code from the contract.
7. **The twin.** Centro has Chilled (a root) then Offers (no category). Oeste has Pantry (a
   leaf) then its own Chilled, with the same slug. Sierra and the Consum shop have none. The
   seeded rows of Centro and Oeste name their sections, so the count on the tab is right.
   The twin keeps the rules of `0200`: a slug unique in its shop, a new section last, a
   delete that closes the gap, a `PATCH` with `position` that moves, an order that keeps
   the sections it leaves out after the named ones. It does not rewrite the names on the row
   of a shop after a write.
8. **A write answers only the shop it was asked for** (follow up PR [#PRNUM](https://github.com/IchirokuXVI/nx-portfolio/pull/PRNUM)). `save()`
   and `confirmDelete()` take `_generation` as they start, and drop an answer or a refusal
   that lands after another shop was picked. The note to the page above is still sent,
   because the write happened.
9. **A save refused with `section_not_found` reads the list again** (follow up PR
   [#PRNUM](https://github.com/IchirokuXVI/nx-portfolio/pull/PRNUM)). The order in hand is kept, less the section that went, so a retry sends
   sections that exist. The sentence of the refusal stays.
10. **A delete is done once `remove` answers** (follow up PR [#PRNUM](https://github.com/IchirokuXVI/nx-portfolio/pull/PRNUM)). If the read
    after it fails, the row leaves the list held here, the page above and the preview are
    told, and the failed read is said on its own under the list
    (`catalog.locationSections.rereadFailed`, with Retry).

What moved, against the names the plan uses:

- `chain-sections.ts`, `item-sections-panel.ts` and `chain-section-view.ts` are deleted. The
  last one was the stopgap of backend `0200`.
- `panelErrorKey` moved from `chain-sections.ts` to `shop-sections.ts`, and `previewSentence`
  from `item-sections-panel.ts` to `location-sections.ts`.
- `ShopSections` lost `chainSections`, `pinsOf` and `setPins`. `setForLocation` is now
  `setOrder`, and `remove` is new. `forLocation` answers the sections alone, with no `source`.
- `ChainCounts` counts no sections, and `CHAIN_SECTIONS_TAB` and `PRODUCT_WHERE_TAB` are gone.

## Brief for the agent

### Objective

Remove the sections tab of a chain and the section pins of a product, and make the
sections tab of a shop the one place that creates, edits, orders and deletes the sections
of that shop.

Use the `nx-portfolio-angular-developer` skill.

### Context

Every statement below was read on `dev` at `6cced1bd`. The split of the files below is by
their names. Open each one before you rely on it.

- **Chain sections**: `chain-sections.ts`, `sections.ts` (the resource and its form) and
  `ChainSectionsTab` in `chains/section-tabs.ts`, on the routes
  `/chains/{chainId}/sections`, `/sections/new` and `/{id}` (`chains/chains-routes.ts`).
- **Shop sections**: `location-sections.ts` (`LocationSections`, the panel that selects and
  orders), `shop-sections.ts` (models and mappers) and `ShopSectionsTab`, on
  `/chains/{chainId}/shops/{shopId}/sections`.
- **Pins**: `item-sections-panel.ts` (`ItemChainSections`) on the record of a product,
  wired in `products/product-tabs.ts`.
- **Shared**: `section-rules.ts` and `section-seed.ts` (the in memory twin).
- **The routes of the gateway after plan `0200`**:
  `POST`, `GET` and `PUT admin/catalog/locations/:id/sections`,
  `GET admin/catalog/locations/:id/item-sections` (the preview),
  `GET`, `PATCH` and `DELETE admin/catalog/sections/:id`. The chain routes and the pin
  routes are gone. No answer carries `source`, and no item is `PINNED`.

### Target state

1. The record of a chain has no sections tab, and its three routes are removed.
2. The record of a product has no section panel.
3. The sections tab of a shop lists the sections of that shop in order. From it an
   operator adds a section, opens one to edit its name and its categories, changes the
   order, and deletes one after a confirm.
4. A shop with no sections shows an empty state that says the shop has none and offers
   the add action. It never mentions the chain.
5. The preview of which products fall in which section stays, with two states for a
   product: covered by a category of a section, or in none.

### Scope

- `libs/luna-shopper-admin/feature-catalog`: the files named above, their specs and the
  twin.
- `libs/luna-shopper-admin/models`: only what the regenerated wire types of plan `0200`
  require. Do not write a type by hand beside them.
- The translation files of the back office for the strings that change.

### Constraints

- **Reuse the form of `sections.ts`** for the name and the categories. It moves under the
  shop. Do not write a second form.
- **The descriptor contract of the back office holds** (plan `0004` and the plans that
  follow it). A section is a resource of a shop, addressed under its shop.
- **Follow the look of the remodel** (plans `0041` onward) for anything new. No new colour
  role.
- **The content language rule holds** for the name of a section.

### Action boundaries

- Do not change the backend or `openapi.json`. If the contract lacks something, say what
  and stop.
- Do not add a "copy the sections of another shop" action. The owner refused it.
- Do not touch the map screens of a shop, which read the same sections.

### Progress evidence

- `npx nx run-many -t lint test -p luna-shopper-admin/feature-catalog luna-shopper-admin/models`
  pass.
- `npx nx build luna-shopper-admin` passes. The pull request checks never build the back
  office, so run it yourself and say so.
- A browser walk on a slot: add two sections to a shop, give one a root category, reorder
  them, delete one, and read the preview. Open another shop of the same chain and see that
  it has no sections.

## 1. What is removed

- `chain-sections.ts`, `ChainSectionsTab` and the three chain routes.
- `item-sections-panel.ts` and its tab on the record of a product.
- Every string, fixture and spec that only they use.
- In the twin (`section-seed.ts`), the chain sections and the pins. Its sections are owned
  by shops, and two shops of one chain differ.

## 2. The sections tab of a shop

- The list is the order of the shop. Reordering writes
  `PUT admin/catalog/locations/:id/sections`.
- "Add a section" opens the form under the shop and writes
  `POST admin/catalog/locations/:id/sections`. The new section goes last.
- A row opens the section. Its form edits the name and the categories, and Delete asks
  first, because a delete also removes the section from the shopping lists of shoppers in
  that shop.
- A slug is unique inside its shop. The form says so when the backend refuses one.
- The preview keeps its place. A product that no category of a section covers is shown as
  in no section.

## 3. Tests

- The tab: the empty state, add, edit, reorder, delete with its confirm, a refused slug.
- The routes: the chain routes and the product tab are gone, the shop routes resolve.
- The mappers: a section with no `source`, a preview with no pinned step.

## 4. Not in this plan

The backend (plan `0200`), the release task that removes the old rows, and the velista
reader (velista plan `0138`).
