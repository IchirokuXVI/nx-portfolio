# 0118: categories are data

> Client half of backend `0166`. No mock: this plan changes what a category **is** on the
> client and draws nothing new. `0119` (the category picker) and `0120` (the aisles of the
> shop you are in) build on it and each has its own mock.
>
> Prerequisite reading: backend `0166` sections 2, 3 and 8 (the wire and the fallout table),
> `0077` (grouping by category, the first place the client treated one as an aisle), `0082`
> section 6 (one category at a time on a zone list), `0117` (the one field matches category
> labels), and rule D4 in CLAUDE.md (the client owns its models and maps from `unknown`).

Today a category on the client is one of twelve string constants (`PRODUCT_CATEGORIES` in
`libs/velista/models/src/lib/enums.ts:463`), a label is the key `basket.category.<VALUE>`, and
a product carries one. After backend `0166` a category is a row with an id, a parent, a slug
and a localized name, a product carries one or more, and there is no constant list to fold an
unknown value onto. This plan moves the client to that, in every place the sweep found, and
adds the one store the two plans after it need: the tree, read once.

Two things are already right and stay: `BasketProduct.categories` is a list
(`basket-view.ts:381`, put there by `0077` for exactly this day), and `compose-basket-view`'s
`byCategory` draws a row under every category the product has.

## Brief for the agent

### Objective

Replace the twelve constant categories with categories read from the wire, name them from
their data in the person's locale, keep every grouping, filter and search that used them
working, and add a `CategoryStore` that holds the tree for the session. Use the
`nx-portfolio-angular-developer` skill.

### Context

- **The constants**: `PRODUCT_CATEGORIES`, `ProductCategory` and `PRODUCT_CATEGORY_FALLBACK`
  in `libs/velista/models/src/lib/enums.ts:463-488`.
- **Models that carry one**: `CatalogItem.category` (`domain.ts:491`, scalar),
  `CatalogProduct.category` (`catalog-browse.ts:80`, scalar), `BasketProduct.categories`
  (`basket-view.ts:381`, a list).
- **Mappers**: `toCatalogItem` (`data-access/src/lib/mapping/mappers.ts:593`),
  `toBasketProduct` (`basket-mappers.ts:594`, reads `raw['category']` into a one element
  list), `toCatalogProduct` (`catalog-browse-mappers.ts:63`).
- **Grouping and filtering**: `byCategory` in `compose-basket-view.ts:820-870` (section key
  `category:${c}`, heading key `basket.category.${c}`, the `no-category` sink last);
  `lineCategories` in `compose-list-view.ts:98-115` (the set of a line's products'
  categories in `PRODUCT_CATEGORIES` order, `NO_CATEGORY` when none); `pickedListCategory`
  and the trip rule in `compose-list-groups.ts:121, 232`; `categoriesOf`, `categoryLabel`
  and `categoryCounts` in `list-view-store.ts:109-162`.
- **Search**: `basket-search.ts` folds a category label into the match, and
  `compose-list-view.ts:185-207` matches on `categoryLabel`.
- **Screens that name one**: `list-filter-sheet.html:92-106` (a radio per category),
  `list-page.ts:677-683` (the heading), the basket's grouping heading, and the copy
  `basket.category.*`, `basket.group.noCategory`, `list.view.oneCategory`,
  `list.view.noCategory` in `libs/velista/ui/assets/i18n/{en,es}.json`.
- **Memory stores**: `catalog-memory.ts:179`, `catalog-browse-memory.ts:147, 298, 363`,
  `basket-memory.ts:157-202`.
- **The new wire** (backend `0166` section 3): `ItemView.categories: { id, parentId, slug,
  name }[]` in position order, never empty; `GET /v1/catalog/categories` answers the whole
  tree with `itemCount` per row.
- **e2e**: `apps/velista-luna-e2e/src/shop.spec.ts:113-151, 363` groups by category and
  reads headings.

### Target state

1. **The model.** `ProductCategory` is `{ id, parentId, slug, name: LocalizedName }` in
   `libs/velista/models`. `PRODUCT_CATEGORIES` and `PRODUCT_CATEGORY_FALLBACK` are gone.
   `CatalogItem.categories` and `CatalogProduct.categories` are lists like `BasketProduct`'s.
2. **The mappers** read `raw['categories']` from `unknown`, keep the elements that carry an
   id, a parent id, a slug and a readable name, and drop the rest. A product whose list comes
   out empty has no category, and the pipelines treat it as they treat a row with no product:
   the `no-category` sink on the basket, `NO_CATEGORY` on the zone list. The `OTHER` fold is
   gone with the constant. "Not yet categorised" is a real leaf and arrives as data.
3. **Names come from data.** Every heading, radio and chip that said
   `basket.category.<VALUE>` says `inLocale(category.name)`. The keys are deleted from both
   locale files. Section keys become `category:${id}`.
4. **Order comes from the tree.** `CategoryStore` in `libs/velista/data-access` reads
   `GET /v1/catalog/categories` once per session, exposes the tree as roots with their
   children in `position` order, a `byId` lookup and a `rank(id)` for sorting, and has an in
   memory twin seeded with a dozen rows of the taxonomy. `lineCategories`, the zone list's
   radios and `categoryCounts` order by `rank`, falling back to first appearance while the
   tree is not loaded yet. The basket's `byCategory` keeps ordering sections by their first
   row, as `0077` section 3 decided.
5. **Search matches names.** The one field and the zone list match the folded name in the
   person's locale, as they matched the folded label. Nothing else about matching changes.
6. **Screens and copy.** The zone list's filter sheet draws one radio per category present
   in the list, named from data. The headings on the list page and the basket page follow.
   `basket.view.group.category`, `basket.view.chip.byCategory` and the grouping option keep
   their words.
7. **Specs and e2e.** Every spec the sweep names passes with categories as objects. The
   memory stores carry a few real slugs. `shop.spec.ts` reads the heading it expects from
   the seed's data, not from a key.

### Scope

Work only in `libs/velista/models`, `libs/velista/data-access`, `libs/velista/feature-lists`
(the filter sheet and the list page headings), `libs/velista/feature-shopping-lists` (the
basket page heading), `libs/velista/ui/assets/i18n/{en,es}.json`, the specs of each, and
`apps/velista-luna-e2e/src/shop.spec.ts`.

Do not touch: the catalog tab (`0119`), the basket at a shop (`0120`), the backend, the
routes, or the design of any screen.

### Constraints

- Rule D4: map from `unknown`, own the model, never import a contract type.
- `inLocale` for every name, never a flattened string in a model.
- No `@angular/core/rxjs-interop` (CLAUDE.md, module federation).
- `CategoryStore` writes its signal by hand like `RokuLocaleStore`, is provided in the
  platform providers once, and never blocks a screen: a grouping drawn before the tree
  arrives is drawn in first appearance order and re-sorts when it lands.
- Only make changes directly requested.

### Action boundaries

Stop and ask before: keeping any `basket.category.*` key, adding a category to the URL,
changing the basket's section order rule, or touching a screen this plan does not name.

### Progress evidence

After each numbered target, the files changed and the spec run. At the end: `npx nx test`
and `npx nx lint` for every touched library, `npx nx build velista`, and the e2e suite
against a slot serving backend `0166`.

## 1. What each pipeline does with several categories

| Place | Today | After |
| ----- | ----- | ----- |
| basket, group by category | a row under each category of the product (already) | the same, headed by the data name |
| zone list, one category at a time | a line's categories are the set of its products' one category each | the set of every product's categories, so a line whose product is frozen and a ready meal is under both radios, and shown once under whichever is picked (`compose-list-view.spec.ts:162` already asserts "never twice") |
| zone list, counts | per category | per category, a line counted under each of its categories |
| search | matches the label | matches the name |
| product row caption (`0100`, `0101`) | none | none in this plan; `0119` decides whether the first category is shown |

## 2. What a missing category means now

`0077` section 2 said a product's list is "never empty" because an unreadable value folded
onto `OTHER`. There is no `OTHER` to fold onto. A product whose wire list is unreadable is a
product with no category, and both pipelines already have a place for that: the last section
on the basket, `NO_CATEGORY` on the zone list. The server guarantees a non empty list, so the
case is a defence, not a state a shopper will see.

## 3. Not in this plan

- The picker and a category filter on the catalog tab: `0119`.
- Sections at a shop: `0120`.
- Showing a product's first category on a product row or card.
