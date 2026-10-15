> **PR:** [#721](https://github.com/IchirokuXVI/nx-portfolio/pull/721)

# 0138: the shopping list groups by parent category

> Asked for by the owner on 2026-10-11: "The basket list won't be grouped by the child
> categories, only by parent. Right now, even with very big shopping lists (100+ lines),
> most groups have 1 or 2 products because the categories are very specific. Instead, group
> everything by parent category so it's more broad. If the shop has sections configured, it
> will use the sections but unmapped categories will still be shown by parent, even if some
> childs were mapped to a section."
>
> On a product under two parents: "I don't think that case is going to happen too much now
> that only parent categories are shown. If the product is in both, show the duplicate. It
> can be fixed later if needed."
>
> On sections: "only sections of the specific shop you are buying at should be shown, i
> don't want chain sections."
>
> **The mock is the design.** It is `apps/velista/plans/mocks/basket-by-product/`
> (`Main.dc.html` and `AtShop.dc.html`), published at
> https://claude.ai/artifact/TNn8WVuoznc9Zsabozn9c7. The rows of the mock are the rows of
> plan `0139`. This plan changes only the headings.
>
> **Stage 1 needs nothing from the backend. Stage 2 needs backend plan `0200`.** If that
> contract is not on your base branch, build stage 1, say plainly that stage 2 is left
> out, and stop.
>
> Prerequisite reading: velista `0077` and `0118` (categories as headings, the category
> store), `0120` (the aisles of the shop you are in), `0132` (what the shopping list
> costs), backend `0200`, `libs/velista/models/src/lib/compose-basket-view.ts` and its
> spec, `libs/velista/models/src/lib/product-category.ts`, `shop-section.ts`, and
> `libs/velista/data-access/src/lib/catalog/category-store.ts`.

## Brief for the agent

### Objective

Make the category headings of the shopping list the parent categories, with and without
the sections of a shop, and (stage 2) read sections as the shop's own.

Use the `nx-portfolio-angular-developer`, `design-taste-frontend`, `antislop` and
`antislop-ui` skills.

### Context

Every statement below was read on `dev` at `6cced1bd`.

- **Grouping is on the client**, in `composeBasketView` (`compose-basket-view.ts`), a pure
  function. `groupRows` dispatches to `byCategory`, `byAisle` and `byList`.
- **`byCategory` groups by leaf.** It uses the `id` of each `ProductCategory` of the
  product of the row. A product with two leaves is drawn under both. The order of the
  sections is the place of their first row. "No category" is pushed last.
- **`byAisle`** runs when `basketGroupsByAisle` is true. The sections of the shop come
  first in the order of the shop. The rows no section covers follow, grouped by leaf, and
  the first of those headings carries `uncoveredBand`. "No category" never carries it.
- **A `ProductCategory` has `parentId`**, the root its leaf sits under. It does not have
  the name of that root. `CategoryStore.byId(parentId)` has it, after `ensure()`.
- **`ShopSections.source`** is `CHAIN` or `LOCATION` (`shop-section.ts`), and
  `ShopSection.supermarketId` is the chain. The `CHAIN` value appears in
  `shop-sections-memory.ts`, `shop-sections-api.ts`, `shop-section-mappers.ts` and their
  specs.
- **Specs that cover the grouping**: `compose-basket-view.spec.ts`,
  `basket-view-store.spec.ts`, `basket-page.spec.ts`, and the e2e
  `apps/velista-luna-e2e/src/aisles.spec.ts`.

### Target state

1. Grouped by category, each heading is a parent category. A row is under the parent of
   each category of its product.
2. At a shop with sections, the rows no section covers are under parent categories, below
   the band.
3. "No category" stays last and is unchanged.
4. Stage 2: the models and mappers of sections have no chain and no source. A shop with
   no sections groups by parent category only.

### Scope

- `libs/velista/models`: `compose-basket-view.ts` and its spec. Stage 2: `shop-section.ts`.
- `libs/velista/data-access`: the store that feeds the composition with the category
  tree. Stage 2: the three shop section files and their specs.
- `libs/velista/feature-shopping-lists`: only what the heading needs.
- `apps/velista-luna-e2e/src/aisles.spec.ts`.

### Constraints

- **`composeBasketView` stays pure.** The parents arrive as an input, a map from the id of
  a root to its name. It does not read a store.
- **A heading is never a leaf**, also when a parent holds one row.
- **A product under two parents is drawn under both.** The owner decided this.
- **The order of the headings does not change its rule**: the place of the first row.
- **Section progress counts the rows of the parent.**
- **No new string for a parent.** Its name is the localized name of the category.

### Action boundaries

- Do not change the rows, the row sheet or the merge. They are plan `0139`.
- Do not change the backend or the back office.
- Do not change grouping by list or the ungrouped view.

### Progress evidence

- `npx nx build velista` and
  `npx nx run-many -t lint test -p velista/models velista/data-access velista/feature-shopping-lists`
  pass.
- A browser walk at 390 pixels on a slot, in English and Spanish: a shopping list of at
  least twenty rows grouped by category shows parent headings, and at a shop with two
  sections the band and the parent headings follow the sections.

## 1. Stage 1: parent headings

- The key of a category section is the id of the root. Its title is the name of the root.
- A product with two leaves under one root is drawn once under that root.
- A product with leaves under two roots is drawn under both.
- Until the category tree is loaded, the page shows the rows ungrouped under the loading
  state it already has. It never shows leaf headings first and parents after.
- A root the tree does not know (a stale id) groups under "No category".

## 2. At a shop

- A row a section covers is under that section, as today.
- A row no section covers is under the parent of its category, **also when a sibling leaf
  of the same parent is in a section**. The parent heading then holds only the rows the
  sections left out.
- The band "Categories we could not find in this shop" sits above the first parent
  heading, as today above the first leaf heading.

## 3. Stage 2: the shop's own sections

After backend plan `0200`:

- `ShopSectionsSource`, `ShopSections.source` and `ShopSection.supermarketId` are removed,
  with the `CHAIN` fallback of the API client, the default of the mapper and the twin.
- A shop that answers no sections makes `basketGroupsByAisle` false, and the list groups
  by parent category with no band.
- The section names on the rows of the shop picker (plan `0124`) read the same answer.

## 4. Tests

- `compose-basket-view.spec.ts`: one heading for two leaves of one root, two headings for
  a product under two roots, the order of the headings, the progress of a parent, a stale
  root, "No category" last, and at a shop: a sibling leaf in a section, the band on the
  first parent heading.
- The store: it waits for the tree before it groups.
- Stage 2: the mapper with no source, a shop with no sections.
- `aisles.spec.ts`: the headings it expects become parents.

## 5. Not in this plan

Rows that are products (plan `0139`), and a rule that draws a product under one parent
only, which the owner left for later.

## What the build decided

The build of 2026-10-15 built both stages. Backend `0200` was on `dev` (PR #707). Each point
below is a choice of the builder that the owner can overturn.

1. **The parents arrive as `BasketViewContext.parents`**, a map from the id of a root to its
   `LocalizedName`, built by `categoryParents(tree)` in `product-category.ts`. The name stays a
   pair, so the pipeline resolves it with the reader's locale like every other heading.
2. **The tree is asked for only when somebody groups by category.** `BasketViewStore` calls
   `CategoryStore.ensure()` from an effect on the grouping. A failed read is asked again the
   next time the grouping changes to category.
3. **Until the tree lands, the whole category grouping is drawn ungrouped**, the aisles of a
   shop included. The aisles do not need the tree, but drawing them with the rest ungrouped
   below them would be a second interim layout. The tree is read once per session, so this is
   one short wait per session. A tree that failed to load draws the list ungrouped.
4. **A product with one known root and one stale root is drawn under the known one only.** It
   goes under "No category" only when none of its roots is in the tree.
5. **Stage 2 removed the `ShopSections` wrapper too.** With `source` gone it held one field, so
   `ShopSectionsServiceI.sections` answers `readonly ShopSection[] | null` and the mapper
   `toShopSections` answers the list. An older answer that still carries `source` or
   `supermarketId` is read and those fields are dropped.
6. **"A shop with no sections groups by parent category with no band"** needed no new code:
   `basketGroupsByAisle` was already false for an empty list. A spec states it.
7. **The shop picker (plan `0124`) needed no change.** Its names come from
   `toShopSectionNames`, which reads `section.namesForLocations`, and backend `0200` already
   reads that from the shop's own sections.
8. **Outside the stated scope:** `apps/velista-luna-e2e/src/shop.spec.ts` expected the leaf
   name over the Milk row. Its helper now reads the parent's name from the tree. Five sheet
   specs of `feature-shopping-lists` provide the fake `CategoryStore`, because
   `BasketViewStore` injects it.
9. **No UI change.** The heading markup, the band and the progress are as they were. Only the
   words in a heading changed.

The browser walk of 2026-10-15 (390 pixels, English and Spanish, 31 rows under nine parents,
and Mercadona Colón with two sections of its own) is a private artifact:
https://claude.ai/artifact/6CdwhY1HnYGuHZEsVaYXDd
