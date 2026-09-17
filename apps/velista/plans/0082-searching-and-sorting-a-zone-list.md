> **PR:** [#374](https://github.com/IchirokuXVI/nx-portfolio/pull/374)

# 0082: searching and sorting a zone list

> The basket can be searched, sorted and grouped (`0074` to `0077`). A zone list cannot, and
> a household list of sixty lines is where that hurts most. This plan gives the zone list
> page the basket's search, an A to Z order, and a category view that shows one category at
> a time. It draws no chip row: the filter button's badge says that something is on.
>
> Prerequisite reading: `0074` (the tools row and the in memory search), `0075` (the filter
> sheet and `composeBasketView`), `0076` (what is remembered), `0077` (grouping by
> category), `0079` sections 2 and 3 (the sticky, fixed height tools row), and
> `libs/velista/feature-lists/src/lib/list-page/`.

## Brief for the agent

### Objective

Add a search button and a filter button to the zone list page, with a filter sheet that
sets the order (list order or A to Z) and a category view (off, or one category), a search
over line names, product names and category names, and a reorder action that explains why
it is unavailable while any of those is on.

### Context

- `ListPage` draws `lib-list-header` and `lib-line-list` and has no search or filter.
- The basket's pieces: `foldForSearch` and `basketMatchRange` in
  `libs/velista/models/src/lib/basket-search.ts` (generic), `composeBasketView` in
  `compose-basket-view.ts` (typed on basket lines), `BasketViewStore` in `data-access`
  (route provided, injects `BasketStore`), `FilterSheet` in `feature-shopping-lists`,
  `basket-view-memory.ts` (lifetimes are a duration in ms or `null` for ever).
- `0079` makes the basket's tools row sticky with one fixed height. It must be merged
  before this plan starts.
- `Line.itemIds` holds the products. `ItemNames` (`data-access/src/lib/catalog/item-names.ts`)
  resolves ids to `CatalogItem` through `itemsByIds`, capped per request at
  `ITEM_LOOKUP_LIMITS.maxIds`. `CatalogItem` has **no category**: `toCatalogItem` drops the
  wire `category`. The list page does not call `ItemNames` at all.
- Categories: `PRODUCT_CATEGORIES` in `models/src/lib/enums.ts`, labels under
  `basket.category.*` in `libs/velista/ui/assets/i18n/*.json`.
- The reorder action lives in `lib-list-header`, drawn only for managers, and is absent
  when `canReorder` is false.
- `libs/velista/ui/src/lib/home/auth-actions.*` is the pattern for an action that is held
  with `aria-disabled` and says why on tap, through a polite live message.

### Target state

Sections 2 to 8 hold on the zone list page, the basket page behaves exactly as before, and
`npx nx run-many -t lint test -p velista/ui velista/models velista/data-access velista/feature-lists velista/feature-shopping-lists velista/feature-shell`
plus `npx nx build velista` are green.

### Scope

- Work only in: `libs/velista/feature-lists/`, `libs/velista/ui/src/lib/list/` (the tools
  row component and the list header), `libs/velista/data-access/src/lib/` (a list view
  store, `ItemNames`, the mapper for catalog items, the memory helpers), `libs/velista/models/src/lib/`,
  `libs/velista/platform/src/lib/storage-keys.ts`, `libs/velista/feature-shell/src/lib/routes.ts`,
  the two translation files, and the basket page only for switching it to the shared tools
  row.
- Do NOT touch: any backend project, the basket's view pipeline, the basket's filter sheet.

### Constraints

- Use the `nx-portfolio-angular-developer` skill, and the `design-taste-frontend` skill for
  the tools row, the sheet and the headings.
- Rule D4: map from `unknown`, own the models. Rule N1: no product name in keys or classes.
- A route provided store is never destroyed. Reset it from `ListPage`'s `DestroyRef`, as
  the basket page does with `BasketViewStore.leave()`.
- Dates and numbers through `Intl`, collation through `Intl.Collator` in the current locale.
- Only make the changes this plan names. Do not add grouping by anything but category.

### Action boundaries

- Proceed with in-scope edits, specs and a local slot for the browser check.
- Stop and ask if `0079` is not merged, if extracting the tools row changes any basket spec
  beyond a selector, or if categories cannot be read without a backend change.

### Progress evidence

Report after the tools row extraction (basket specs green), after categories reach the
list page, after the sheet and the view, and after the reorder hold. Each report names the
spec run.

## 1. What is being built

| Piece                                              | Where                                                               |
| -------------------------------------------------- | ------------------------------------------------------------------- |
| The tools row as a shared component                | `libs/velista/ui/src/lib/list/list-tools.*`, basket page, list page |
| `category` on `CatalogItem`                        | `models` `domain.ts`, the catalog mapper                            |
| The list page loads its products                   | `list-page.ts`, `ItemNames`                                         |
| The view: search, order, category                  | `models/src/lib/compose-list-view.ts`, a new `ListViewStore`        |
| The filter sheet at `…/lists/:listId/sheet/filter` | a new `list-filter-sheet` in `feature-lists`, `routes.ts`           |
| The reorder hold and its message                   | `list-header`, `list-page`                                          |
| Remembered order                                   | `StorageKeys.listView`, a `list-view-memory.ts`                     |
| Copy                                               | `en.json`, `es.json`                                                |

## 2. One tools row for two pages

The tools row now has a second consumer, so extract it from the basket page into
`lib-list-tools` in `velista/ui`: the search button, the open search field (with `0079`'s
hidden label, hidden count and fixed height), Cancel, and the filter button with its badge.
It takes plain values and emits events (rule D1: only the page injects stores). The basket
page passes its chips and progress through content projection, and its specs change only in
selectors.

On the zone list page the row sits between the header and the lines, sticky as in `0079`,
with **no chip row**. The filter button's badge shows the number of active settings: A to
Z counts one, a chosen category counts one. Search and filter are hidden while reorder mode
is on.

## 3. Categories reach the page

- `CatalogItem` gains `category: ProductCategory`, mapped in `toCatalogItem` with
  `oneOf(raw['category'], PRODUCT_CATEGORIES, PRODUCT_CATEGORY_FALLBACK)`, the rule the
  basket mapper already uses.
- `ListPage` calls `ItemNames.ensure` with every line's `itemIds` when the lines load, and
  again for new ids when lines arrive over the socket. If `ensure` does not split requests
  at `ITEM_LOOKUP_LIMITS.maxIds`, make it.
- **A line's categories** are the set of its products' categories. A line with no products
  has none and belongs to "No category". A line whose products did not load yet, or failed,
  also counts as "No category" until they load.

## 4. The filter sheet

`ListFilterSheet` at `…/lists/:listId/sheet/filter`, declared with `sheet()`. Every change
applies at once, as the basket's filter sheet does, and Reset puts both sections back.

**ORDER**: "List order" (the default, the server's `position`) and "A to Z" (`Intl.Collator`
over the line name in the current locale).

**VIEW**: "All lines" (the default) and "One category". Choosing "One category" reveals a
radio list of the categories present on this list, in `PRODUCT_CATEGORIES` order, plus "No
category" when a line has none, each with its line count. **Nothing changes on the page
until a category is picked.** Closing the sheet with "One category" chosen and no category
picked puts the view back to "All lines".

## 5. What the page draws

- With a category picked, only the lines holding that category are drawn, under one heading
  naming the category. A line with three categories is drawn under whichever one of them is
  picked, and never twice, because only one category is drawn at a time.
- The order applies inside the view.
- Search applies on top of both.
- Pending and rejected lines keep their approval buttons under the row.
- When nothing is left to draw, the page says so and offers Reset, as the basket does with
  `basket.view.none`.

## 6. The search

A line matches when the folded query appears in its name, in the name of any of its
products, or in the label of any of its categories in the current locale. The match inside
the line name is marked with `<mark>` using `basketMatchRange`, as the basket row does.
`lib-line-row` gains one input for the range. The count is announced through the hidden
status element from `0079`.

## 7. Reorder waits for the list order

While A to Z is on, a category is picked, or a search is active, the reorder action in the
header stays visible for managers and is held with `aria-disabled="true"`. Tapping it moves
nothing and shows a polite message under the header, `list.reorder.unavailable`, following
the `auth-actions` pattern. The message goes when all three are off.

## 8. What is remembered

One record per device, `StorageKeys.listView`, following `basket-view-memory.ts`:

- The lifetime type gains a third value, `'visit'`, meaning never stored. Add it to the
  shared helpers without changing the basket's lifetimes.
- `order` is remembered for ever (`null`).
- `view` is `'visit'`. A category view cannot apply without its category, and the product
  owner decided on 2026-09-13 that the category is not remembered, so the view starts at
  "All lines" on every visit. Changing `view` to `null` later is a one line change and must
  also decide what a restored view with no category draws.
- The search is never stored.

## 9. Copy

| Key                        | English                                                  | Spanish                                                                        |
| -------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `list.view.order`          | Order                                                    | Orden                                                                          |
| `list.view.order.list`     | List order                                               | Orden de la lista                                                              |
| `list.view.order.alpha`    | A to Z                                                   | De la A a la Z                                                                 |
| `list.view.view`           | View                                                     | Ver                                                                            |
| `list.view.all`            | All lines                                                | Todas las líneas                                                               |
| `list.view.oneCategory`    | One category                                             | Una categoría                                                                  |
| `list.view.noCategory`     | No category                                              | Sin categoría                                                                  |
| `list.view.reset`          | Reset                                                    | Restablecer                                                                    |
| `list.view.none`           | No lines match.                                          | Ninguna línea coincide.                                                        |
| `list.reorder.unavailable` | To reorder, use the list order, all lines and no search. | Para reordenar, usa el orden de la lista, todas las líneas y ninguna búsqueda. |

Reuse `basket.search.*` for the search field and count, and `basket.category.*` for category
labels. Moving those keys to a neutral namespace is not part of this plan.

## 10. Accessibility

- The category radios are a real `radiogroup` with a visible legend.
- The held reorder action keeps its name, and its message is announced once per tap.
- The category heading is a heading element one level below the page title.

## 11. Tests

1. `toCatalogItem` maps `category`, and an unknown value falls back.
2. `composeListView`: A to Z collates accents in the locale. A category view keeps only the
   lines holding it. "No category" keeps lines with no products. Search matches the name, a
   product name and a category label. No line is drawn twice.
3. The sheet shows only categories present on the list, with counts, and applies nothing
   until one is picked. Closing without a pick restores "All lines".
4. The filter badge counts A to Z and a picked category.
5. The reorder action is `aria-disabled` under each of the three conditions, and a tap shows
   the message and moves nothing.
6. `order` survives a reload, and the view does not.
7. `ListPage` calls `ItemNames.ensure` for loaded lines and for ids arriving over the
   socket, split at the lookup limit.
8. The basket page's search and filter specs pass with the shared tools row.
9. `routes.spec.ts` sees the new sheet under the marker.

## 12. Acceptance criteria

- [ ] A zone list can be searched by line name, product name and category.
- [ ] A to Z and one category at a time work, alone and together, with the search on top.
- [ ] No line appears twice.
- [ ] Reorder explains itself instead of working while the view is not the list order.
- [ ] The order is remembered on the device, the category view is not.
- [ ] The basket page is unchanged to its user.

## 13. Verification

```sh
npx nx run-many -t lint test -p velista/ui velista/models velista/data-access velista/feature-lists velista/feature-shopping-lists velista/feature-shell
npx nx build velista
tools/dev/ng-slot.sh --list
tools/dev/ng-slot.sh --up --apps shell,velista
```

On the slot, open a zone list with products in several categories, try every combination
at a phone viewport, then `--down`.
