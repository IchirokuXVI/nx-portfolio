> **PR:** [#640](https://github.com/IchirokuXVI/nx-portfolio/pull/640)

# 0055 A product on the record page

> Fourth plan of the record page series (`0052` to `0060`). Needs `0054` (the collections of
> a record), merged. It moves the product and the product group.
>
> Mock: `plans/mocks/record-page/` in this app, published at
> <https://claude.ai/artifact/9w1HHBNWQHyy3GTJWtjcYM>. The boards for this plan are
> `Product`, `Product-Edit`, `Create`, `Phone-Product`, `Phone-Product-Edit` and
> `Phone-Create`.

The page of a product is plan `0043`: a header, four tabs, and a summary column at the
side. Its Details tab is `ItemFormPage`, a subclass of the old form, which is always a
form. The page of a product group embeds the old form and puts "Add items" under it.

After this plan both are the record page. The Prices, Where and Sources tabs of a product
stay as they are, as parts of the record.

## Brief for the agent

### Objective

Draw the product and the product group with `RecordPage`. Delete `ItemFormPage`,
`ProductPage` and `ProductGroupDetailPage`, and keep the three tabs of a product and the
"Add items" block of a group as parts. Use the `nx-portfolio-angular-developer`,
`design-taste-frontend`, `antislop`, `antislop-ui`, `antislop-human` and
`antislop-layoutmobile` skills.

### Context

- **The product today**, under `feature-catalog/src/lib/`:
  - `products/products-routes.ts` mounts `/products/new` as `ItemFormPage` and
    `/products/:productId` as `ProductPage` with four children: `details` (`ItemFormPage`),
    `prices` (`ProductPricesTab`, with the child `new` for `PriceFormPage`), `where`
    (`ProductWhereTab`) and `sources` (`ProductSourcesTab`).
  - `products/product-page.ts` (609 lines) draws the header, the tabs with two counts, Edit
    and Delete, a refusal, and at 72 rem a summary column 300 px wide: brand, size,
    barcode, group, categories.
  - `products/product-context.ts` reads the product, its price scopes and the count of its
    source entries, and three tabs inject it.
  - `item-form-page.ts` (146 lines) extends `ResourceFormPage`.
- **The fields of `ITEMS`** (`items.ts`): `id`, `name` (localized, required), `brand`
  (text), `ean`, `sku`, `categoryIds` (references, ordered, required), `defaultUnit` (a
  choice, required), `unitSize`, `productGroupId` (a reference), `imageUrl` (a `url`).
  `actions` are `create`, `edit`, `delete` and two bulk actions. `errorFields` puts three
  codes under `categoryIds`.
- **The brand of a product is text.** `CatalogItemView.brand` is a string, and
  `CreateItemDto` and `UpdateItemDto` take `brand` as a string. The catalog works out the
  registered brand from the text by itself. The view carries no `brandId`, and neither DTO
  takes one. The mock draws the brand as a picker.
- **The view of a product has no dates.** `CatalogItemView` has no `createdAt` and no
  `updatedAt`.
- **The product group today**: `PRODUCT_GROUPS` (`product-groups.ts`) has
  `detail: ProductGroupDetailPage` and is mounted by `resourceRoutes`. Its fields are `id`,
  `name`, `slug`, `referenceUnit`, `synonyms`. The page (476 lines) embeds
  `<lib-resource-form-page />` and adds "Add items": a search of products, tick boxes and
  one reviewed move.
- `product-page.spec.ts` (1,075 lines) covers `ProductPage`, `ItemFormPage`,
  `ProductPricesTab` and `PriceFormPage`.

### Target state

1. **A product opens on Details, reading**, at `/products/:productId/details`. The tabs are
   "Details", "Prices", "Where" and "Sources", with the counts of today. Every address of
   today still opens the same thing.
2. **Details has three sections**, as on the board: "Name and codes" (name, brand,
   barcode, the chain's code), "Where it belongs" (categories, product group), "How it is
   sold" (sold by, size, picture).
3. **The name** is one field with one line for each language. **The categories** are rows
   with arrows, and the first is "Main". **The picture** is its address with a preview.
   **The barcode and the chain's code** are in the mono face.
4. **The brand stays a text field.** While reading it is the text. Section 3 says why, and
   what turns it into a picker.
5. **The summary column is gone.** Everything it showed is in Details, which is the first
   tab.
6. **A new product** is `RecordPage` at `/products/new`. "Sold by" starts at "Unit". After
   the save the new product is open, with "Product added." and "Add another product".
7. **Prices, Where and Sources are parts** (`RecordChildPart`, `as: 'tab'`). Their
   components keep what they do. They read the product from `RECORD_CONTEXT`.
8. **A product group is the record page** with one panel of its own, "Add items".
9. **`ItemFormPage`, `ProductPage` and `ProductGroupDetailPage` are gone.**

### Scope

- In: `feature-catalog/src/lib/items.ts`, `item-form-page.ts` (deleted),
  `product-groups.ts`, `product-group-detail-page.ts` (replaced by a panel),
  `products/products-routes.ts`, `products/product-page.ts` (deleted),
  `products/product-context.ts`, `products/product-tabs.ts`,
  `products/product-prices-tab.ts`, `item-sections-panel.ts` and `item-source-entries.ts`
  (only how they learn the product), their specs, `en.json`, and
  `apps/.../no-new-old-form.spec.ts` (its list loses two files).
- Out: `PriceFormPage` and the child route `prices/new` (plan `0060`), the Products list,
  the Categories page, the price rules, the bulk panels, the gateway, `openapi.json` and
  `wire-types.ts`.

### Constraints

- The three tabs keep their behavior. This plan changes where they get the product and
  nothing else in them.
- No field of a product is worked out from another one. The old form said so, and the new
  page holds to it.
- A reference is a picker and a text is a text. Do not draw a picker over a field that the
  gateway reads as text.
- The constraints of plans `0053` and `0054` hold.

### Action boundaries

- Do not change a gateway route or a DTO. Section 3 names what the brand picker needs.
- Do not move the price form. It stays the `editor` of `PRICES`, mounted under the Prices
  tab.
- Do not start, stop or migrate Luna slot 0, 1 or 3. The walk saves, so it needs a Luna
  slot of your own, given back with `--down`.

### Progress evidence

- `npx nx lint` and `npx nx test` are green for `luna-shopper-admin/feature-catalog`,
  `luna-shopper-admin/feature-resource`, `luna-shopper-admin/models` and
  `luna-shopper-admin`.
- `npx nx build luna-shopper-admin` is green.
- The browser walk of section 5, at 1360 px and at 390 px, with screenshots.

## 1. Not in this plan

- A picker for the brand of a product (section 3).
- The dates of a product in the Record block. The view carries none.
- The price form and the price rules (`0060`).
- `packCount` and `eans`. The view carries both and the descriptor has neither. Adding a
  field is a decision about the catalog, and it is not this plan's.

## 2. The descriptors

### 2.1 `ITEMS`

```ts
record: {
  sections: [
    { title: 'catalog.items.section.name', fields: ['name', 'brand', 'ean', 'sku'] },
    { title: 'catalog.items.section.where',
      fields: ['categoryIds', 'productGroupId'] },
    { title: 'catalog.items.section.sold',
      fields: ['defaultUnit', 'unitSize', 'imageUrl'] },
  ],
  children: [
    { as: 'tab', name: 'prices', label: 'catalog.product.tab.prices',
      component: ProductPricesTab },
    { as: 'tab', name: 'where', label: 'catalog.product.tab.where',
      component: ProductWhereTab },
    { as: 'tab', name: 'sources', label: 'catalog.product.tab.sources',
      component: ProductSourcesTab },
  ],
  counts: () => inject(ProductCounts).of,
},
```

- `ean` and `sku` get `format: 'code'`. `imageUrl` gets `format: 'image'`.
- `editor` is deleted from `ITEMS`.
- The heading of the page is `ITEMS.title`. The line under it on the board ("Hacendado,
  1 l") is the brand and the size, which Details shows three rows lower. It is not drawn.
- Use the keys of the tabs that `product-tabs.ts` reads today. The names above are
  examples.

### 2.2 `ProductCounts`, in place of `ProductContext`

`ProductContext` did three jobs. The record is now `RECORD_CONTEXT`. The delete is the
page's. What is left is the two counts and the list of price scopes that the Prices tab
draws.

- Keep one service in `products/product-context.ts` for the price scopes of the open
  product and the count of its source entries. Name it for what it holds.
- `record.counts` reads it: `{ prices: <scopes>, sources: <entries> }`.
- The Prices tab reads its scopes from it, as today, and tells it to read again after a
  write.

### 2.3 `PRODUCT_GROUPS`

```ts
record: {
  sections: [
    { title: 'catalog.productGroups.section.name',
      fields: ['name', 'slug', 'synonyms', 'referenceUnit'] },
  ],
  children: [
    { as: 'panel', name: 'add-items', label: 'catalog.productGroups.addItems.title',
      component: GroupAddItemsPanel },
    { as: 'link', resource: 'items', by: 'productGroupId',
      label: 'catalog.productGroups.products' },
  ],
},
```

- `detail` is deleted. `GroupAddItemsPanel` is the "Add items" block of
  `ProductGroupDetailPage`, moved as it is into `product-group-add-items.ts`. It reads the
  group from `RECORD_CONTEXT`.
- `slug` gets `format: 'code'`.
- The link has no count, because the view of a group carries none.
- The panel is a part and not a tab: a group has four fields, and the board `Main` shows a
  record that small with its collections in the page.

### 2.4 The routes

`products-routes.ts` builds `/products/new` and `/products/:productId` with `recordRoute`
and the children of plan `0054`. The route of the price form stays where it is, as a child
of the `prices` tab: hand that route to `recordRoute` through its `tabs` option. `resourceRoutes(PRODUCT_GROUPS)` needs no change: with no `detail`,
the factory mounts `RecordPage`.

## 3. The brand of a product

The mock draws a picker over the registered brands. The field is text today, at every
layer: the view answers a string, both DTOs take a string, and the catalog finds the
registered brand from the text when it saves.

**This plan keeps the field a text field.** A picker would let the operator choose a brand
by its record, and the form would then have to send that brand's label as text and hope
the catalog finds the same brand again. Two brands can share a label (a private label
never crosses chains), so it would not always find it.

What turns it into the picker of the mock is a change to the gateway, with its own backend
plan:

1. `CatalogItemView` carries `brandId` beside `brand`.
2. `CreateItemDto` and `UpdateItemDto` take `brandId`.

Then the field becomes
`{ kind: 'reference', name: 'brandId', resource: 'brands', nameFrom: 'brand', nullable: true }`,
it reads as a link to the brand, and the page needs no other change. Until then the old
link from the product to the brands list, narrowed by the text, is not drawn. The brands
list takes that text in its own search box.

## 4. Specs

- `product-page.spec.ts` is split by what it covers. The cases about the header, the tabs
  and the delete move to a new `products/product-record.spec.ts`, over `RecordPage` with
  `ITEMS`. The cases about `ItemFormPage` become cases of the descriptor
  (`catalog-descriptors.spec.ts`: the sections, the formats, the tabs). The cases about
  `ProductPricesTab` and `PriceFormPage` stay, in a spec named for the Prices tab.
- `product-record.spec.ts` also proves: every address of today opens the same tab, the
  counts beside "Prices" and "Sources", the three codes of `errorFields` drawn under
  "Categories", and that a new product opens after its save.
- `product-group-bulk.spec.ts` keeps its cases, over the panel.
- List in the pull request any case of a deleted spec that has no new home.

## 5. The walk

On slots of your own, at 1360 px and at 390 px:

- A product with a name in one language only: the other line says "Not written yet".
- Two categories: "Main" on the first. Edit, move the second up, save: it is "Main" now.
- A barcode with 11 digits: refused under the field. Emptying the Spanish name is refused
  under the name. The bar counts 2, and "Go to the first" goes to the name.
- The picture: an address that loads shows the picture, and one that does not shows the
  grey square.
- The tabs: Prices, Where and Sources work as before, and their counts are right after a
  price is added.
- Change a field, then press "Prices": the page asks.
- A new product: "Sold by" is "Unit", the bar says how many required fields are empty, and
  after the save the product is open with "Add another product".
- Delete a product from the More menu.
- A product group: its fields, "Add items" with a reviewed move, and the link to its
  products.
- At 390 px: the label is above each value, the save bar and the bar of the app both stay,
  a picker is a sheet, the tabs scroll sideways and the page does not.

## 6. Decisions made

From the mock, approved on 2026-10-05:

- **A record with 30 fields is the same rows in more sections.** The product is the record
  with the most fields that are changed by hand, and it gets three sections.
- **A text in several languages is one field.** A list of references is rows, with "Main"
  on the first when the order counts.
- **An image is a link with a preview.**

Decisions this plan made, for the owner to confirm:

- **The brand of a product stays text** until the gateway carries its ID (section 3). This
  is the one place where the page differs from the board `Product`.
- **The summary column of plan `0043` is deleted.** The mock has the Record block in that
  place, and the board `Product` repeats nothing from Details beside it.
- **The line under the heading is not drawn.** `PageHeader` has a subtitle, and the
  descriptor has no word for one. Adding it to the contract for one record is not worth
  it.
- **"Add items" of a product group is a panel in the page**, and not a tab.

## 7. What this plan deletes

- `feature-catalog/src/lib/item-form-page.ts`.
- `feature-catalog/src/lib/products/product-page.ts`, and what of `product-context.ts` the
  record page now does.
- `feature-catalog/src/lib/product-group-detail-page.ts`.
- `editor` on `ITEMS` and `detail` on `PRODUCT_GROUPS`.
- The keys of `en.json` that only those files read.
