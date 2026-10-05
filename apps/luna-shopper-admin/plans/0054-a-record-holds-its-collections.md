> **PR:** [#639](https://github.com/IchirokuXVI/nx-portfolio/pull/639)

# 0054 A record holds its collections

> Third plan of the record page series (`0052` to `0060`). Needs `0053` (the page), merged.
> It gives the page its tabs, panels and links, and moves the first record that has a page
> of its own: the brand.
>
> Mock: `plans/mocks/record-page/` in this app, published at
> <https://claude.ai/artifact/9w1HHBNWQHyy3GTJWtjcYM>. The boards for this plan are `Main`,
> `Brand-Edit`, `Phone-Brand`, the tabs of `Product`, the last panel of `Page-States` and
> the right half of `Contract`.

A record owns other rows: a brand has other spellings and products, a product has prices, a
zone has members. The page of plan `0053` draws the fields of a record and nothing that
belongs to it. Each page written by hand draws its own collections in its own way.

The mock settled three shapes and lets the descriptor pick: a tab, a panel, or a link. This
plan builds the three, and the brand is the first record that uses them.

## Brief for the agent

### Objective

Make `RecordPage` draw `record.children`: tabs beside Details, panels in the page and links
with a count. Then move the brand onto the page and delete `BrandDetailPage`. Use the
`nx-portfolio-angular-developer`, `design-taste-frontend`, `antislop`, `antislop-ui`,
`antislop-human` and `antislop-layoutmobile` skills.

### Context

- **The contract** is in `models/src/lib/resource/record-block.ts` since plan `0052`:
  `RecordChildList` (a collection of another resource, `as: 'tab' | 'panel' | 'link'`),
  `RecordChildPart` (a tab or a panel that the record's own library draws),
  `RecordBlock.details` and `RecordBlock.counts`. Nothing reads them yet.
- **The page** is `RecordPage` over `RecordView` and `RecordStore` (plan `0053`). The part
  that draws a collection is `RecordCollection` in `ui` (plan `0052`).
- **A list inside another page** exists: `resourceTabRoute(descriptor)` mounts
  `ResourceListPage` with `RESOURCE_LIST_EMBED: 'tab'`. It takes what the list is fixed to
  from the address, through `ResourceDescriptor.parent`.
- **The brand today.** `BRANDS` is in `feature-brands/src/lib/brands.ts`, with
  `detail: BrandDetailPage`. `feature-harvest/src/lib/routes.ts` mounts it under
  `/harvest/setup/brands`: the list as a tab, `new` and `:id/edit` as the old form, and
  `:id` as `BrandDetailPage` (478 lines). That page embeds `<lib-resource-form-page />` and
  adds two blocks under it:
  - The links: "a spelling of X" with a button that deletes this spelling, or the list of
    the brands that are spellings of this one (`BrandsGateway.links`).
  - The spellings table: what each chain's source calls this brand, with the count of
    products and of queued entries (`BrandsGateway.spellings`).
- **The fields of a brand**: `label`, `key` (never editable), `canonicalBrandId` (a
  reference to `brands`), `privateLabelSupermarketId` (a reference to `supermarkets`),
  `itemCount`, `updatedAt`. The view also carries `createdAt`, which is not a field.
  `actions` are `create` and `edit`. `BrandsGateway.remove` deletes a brand only when it is
  a spelling of another one. `BrandsGateway.notices` says how many products a create or an
  update moved.
- **The products list has no filter by brand.** Its filters are `query`, `categoryId` and
  `productGroupId`.

### Target state

1. **Tabs.** A record whose block has a child `as: 'tab'` gets `PageTabs` under its header:
   "Details", then each tab in the order of `children`, or "Details" last when the block
   says `details: 'last'`. A tab shows its count when the block gives one. The record opens
   on its first tab.
2. **A tab of another resource** is that resource's list, fixed to this record: the rows
   whose `by` is this record's ID, with the list's own filters, order and pages.
3. **A tab of the record's own** is the `component` of a `RecordChildPart`.
4. **Panels.** A child `as: 'panel'` is drawn after the sections of Details, in the order of
   `children`: the heading, the count, at most `rows` rows (5 when left out), "See all" and
   the button of `add`. Below 48 rem it is one row that opens the list.
5. **Links.** The children `as: 'link'` share one last panel, one row each: the label, the
   count, and a way to the list narrowed to this record.
6. **Every tab, panel and link reads the record from one place**, `RECORD_CONTEXT`.
7. **Leaving Details with changes asks first**, also for another tab of the same record.
8. **The brand is drawn by `RecordPage`.** Its descriptor has a `record` block (section 4).
   "Other spellings" is a panel, the table of what each chain calls the brand is a panel of
   its own, and "Products with this brand" is a count.
9. **`BrandDetailPage` is gone**, with its route, its spec and `detail` on `BRANDS`. `new`,
   `:id` and `:id/edit` of a brand are one page.
10. **Nothing the brand page did is lost.** Section 4.3 lists each thing and where it is
    now.

### Scope

- In: `feature-resource/src/lib/` (`record-page.ts`, `record-view.ts`, `routes.ts`,
  `resource-list-page.ts` for the fixed filter, new `record-context.ts` and
  `record-children.ts`), `feature-brands/src/lib/**`, the brand routes in
  `feature-harvest/src/lib/routes.ts`, `models/src/lib/resource/record-block.ts` (only if a
  rule of section 2 needs a helper there), `en.json`, and
  `apps/.../no-new-old-form.spec.ts` (its list loses `brand-detail-page.ts`).
- Out: every other record with a page of its own, the brand suggestions page, the gateway,
  `openapi.json`, `wire-types.ts`.

### Constraints

- A collection is drawn in one of the three shapes. There is no fourth.
- A panel never holds a whole list. It shows a few rows and leads to the rest.
- A count is drawn only when something holds it: a field of the record (`count`) or
  `record.counts`. The page never counts by reading every page of a list.
- A tab keeps its own address, so a reload stays on the tab.
- `RECORD_CONTEXT` is the one way a tab or a panel learns the record. No part reads the
  route for the ID.
- The constraints of plan `0053` hold: the twelve parts, no text in a template, no svg in a
  component, no `rxjs-interop`, no motion.

### Action boundaries

- Do not change a gateway route. The products list has no filter by brand, so the link to
  the products of a brand cannot be built. Draw the count and name the gap (section 5).
- Do not move another record. `ProductGroupDetailPage` embeds the old form the same way,
  and it moves in `0055`.
- Do not start, stop or migrate Luna slot 0, 1 or 3. The walk saves, so it needs a Luna
  slot of your own, given back with `--down`.

### Progress evidence

- `npx nx lint` and `npx nx test` are green for `luna-shopper-admin/models`,
  `luna-shopper-admin/ui`, `luna-shopper-admin/feature-resource`,
  `luna-shopper-admin/feature-brands`, `luna-shopper-admin/feature-harvest` and
  `luna-shopper-admin`.
- `npx nx build luna-shopper-admin` is green.
- The browser walk of section 6, at 1360 px and at 390 px, with screenshots.

## 1. Not in this plan

- A list of sections to jump to. The owner agreed to add it when a record passes six
  sections.
- A way to link an existing brand as a spelling from the panel. The operator opens that
  brand and sets "Same brand as", as today.
- A filter by brand on the products list (section 5).

## 2. How the page draws children

### 2.1 `RECORD_CONTEXT`

`feature-resource/src/lib/record-context.ts`, provided by `RecordPage`:

```ts
export interface RecordContext<T extends ResourceRow = ResourceRow> {
  readonly descriptor: AnyResourceDescriptor;
  /** The ID from the address. */
  readonly id: string;
  /** The record, or `null` until it is read. */
  readonly row: Signal<T | null>;
  readonly mode: Signal<RecordMode>;
  /** Read the record again, after a part wrote something that changes it. */
  reload(): Promise<void>;
}

export const RECORD_CONTEXT: InjectionToken<RecordContext>;
```

### 2.2 The routes

`recordRoute` and `resourceFormRoutes` build the `:id` route of a record like this:

- With no tab: `:id` is `RecordPage`, and Details is the page. Nothing changes from `0053`.
- With one tab or more: `:id` is `RecordPage` with children.
  - `details` is the Details tab (`RecordView`), with `canDeactivate: [recordLeaveGuard]`.
  - One child for each tab, at `child.name` for a part and at the segment of the resource
    for a list.
  - The empty path redirects to the first tab.
- A list tab mounts `ResourceListPage` with `RESOURCE_LIST_EMBED: 'tab'` and a new key of
  route data, `RESOURCE_LIST_FIXED`: `{ [child.by]: <the record's ID> }`. The list sends
  the fixed value on every read and offers no control for it, as it does for a `parent`.
- A part tab mounts `child.component`.
- The forms of the rows of a list tab are not children of the record. The caller mounts
  them beside it, as `resourceFormBranch` does today.
- A list tab that `recordRoute` mounts by itself, from `lists`, is a list that only reads.
  Nothing mounts forms beside it, so a row that opens or a button that adds would lead to
  an address with no route. `recordRoute` throws when the route table is built for such a
  tab whose resource has a detail screen or `actions.create`, or whose child names `add`.
  The caller hands the route of that tab through `tabs` and mounts its forms.
- Two children that are found by one key cannot share it. `recordRoute` throws for two
  tabs with the same key, such as two tabs of one resource. It also throws for two children
  with no `count` field that have the same key, on a record that states `counts`. Links and
  panels counted by a field are found by no key, and any number of them may be of one
  resource.
- A caller that mounts by hand can hand over the whole route of a tab. `recordRoute` gains
  the option `tabs?: Readonly<Record<string, Route>>`, by the `name` of a part or the
  `resource` of a list. The descriptor still says that the tab exists, what it is called
  and where its count is. The route says how it is mounted. This is for a tab with routes
  of its own under it: the price form under the prices of a product (`0055`), and the
  shops of a chain, which are a split (`0056`).
- While the page is a form, the tabs stay. A press on another tab is a navigation, so the
  guard asks. "Leave and lose them" calls `store.cancel()`.

### 2.3 Panels and links

`RecordView` draws them after the sections, through `RecordCollection`.

- A panel of a `RecordChildList` reads `gateway.list({ limit: rows, filters: { [by]: id } })`
  of the child resource, through `ResourceRegistry`.
  - The title of a row is the `title` of the child descriptor.
  - The value at the end is the cell of the child's `list.brief.trailing` field, when it
    has one.
  - A row links to the child's own page when the registry knows one.
  - `more` is true when the read answered a `nextCursor`.
  - "See all" leads to the child's list with `by` in the query string.
  - The button of `add` leads to the child's `new` with `by` filled in from the query
    string, which `RecordPage` already reads.
  - A panel that fails says so in its own frame, with "Try again". The rest of the page
    stays.
- A panel of a `RecordChildPart` is its `component`, inside the page. The component draws
  its own `lib-record-section`, or a `lib-record-collection` when it is a list.
- A link draws the count of `count`, and leads where "See all" leads. A count of 0 reads
  "None yet".
- The child's list is a target only when the child descriptor has a filter whose `param` is
  `by`, or a `parent` whose `filter` is `by`. Without one the list cannot be narrowed, so
  "See all" is not drawn and a link is a count that is not a link.
- Panels and links are not drawn on a new record, and not while the record loads.
- A panel reads again when `ResourceChanges.version` of the child resource changes.

### 2.4 Counts

A tab, a panel or a link shows a count from the first of these that exists:

1. The field of the record that `count` names.
2. `record.counts()(id)()[name]`, for a count that another read holds. `name` is the
   `name` of a part, or the `resource` of a list.
3. Nothing. The label is drawn alone.

## 3. Specs

| Spec | Proves |
| --- | --- |
| `feature-resource/.../record-children.spec.ts` | The order of the tabs for `details: 'first'` and `'last'`. The first tab is where the record opens. A list tab sends the fixed filter and draws no control for it. A panel reads `rows` rows, draws "See all" for a `nextCursor`, links each row, and fails alone. A link with and with no target. The three sources of a count. Nothing is drawn on a new record. |
| `feature-resource/.../record-page.spec.ts`, extended | A press on another tab asks while something changed. `RECORD_CONTEXT` hands the record to a part, and `reload` reads it again. |
| `feature-resource/.../routes.spec.ts`, extended | The routes of section 2.2 for a record with no tab, with a list tab and with a part tab. |
| `feature-brands/.../brands.spec.ts`, extended | The `record` block of section 4.1. The named action is offered only for a spelling. |
| `feature-brands/.../brand-spellings-panel.spec.ts` (new) | The table by chain, its empty sentence, and that it fails alone. It takes the cases of `brand-detail-page.spec.ts` that are about the table. |

`brand-detail-page.spec.ts` is deleted. Before that, move each of its cases to the spec
that now owns the behavior, and list in the pull request any case that has no new home.

## 4. The brand

### 4.1 The `record` block of `BRANDS`

```ts
record: {
  sections: [
    { title: 'brands.section.name', fields: ['label', 'key'] },
    { title: 'brands.section.links',
      fields: ['canonicalBrandId', 'privateLabelSupermarketId'] },
  ],
  children: [
    { as: 'panel', resource: 'brands', by: 'canonicalBrandId', rows: 5,
      label: 'brands.record.spellings', empty: 'brands.record.noSpellings',
      add: 'brands.record.addSpelling' },
    { as: 'panel', name: 'sources', label: 'brands.record.sources',
      component: BrandSpellingsPanel },
    { as: 'link', resource: 'items', by: 'brandId', count: 'itemCount',
      label: 'brands.record.products' },
  ],
  facts: { added: 'createdAt', changed: 'updatedAt' },
},
```

Other changes to the descriptor:

- `createdAt` becomes a field: a date with the time, never editable.
- `key` gets `format: 'code'` and `setBy: 'brands.field.keySetBy'` ("Set by the system").
- `list.brief` gets `trailing: 'itemCount'`, so a row of the spellings panel ends with
  "41 products".
- `detail` is deleted.
- One named action is added: `delete-spelling`, with `danger`, `after: 'leave'`, a
  `confirm` that says the products of the spelling go back to no brand and the spelling
  returns to Suggested brands, and `available: (row) => row.canonicalBrandId !== null`. It
  calls `BrandsGateway.remove`. `actions.delete` stays off. The gateway also deletes a main
  brand that no product holds and no spelling is linked to, and answers 409 `brand_in_use`
  for any other. This page does not offer that.
- `afterAdd` is left out, so a new brand opens.

### 4.2 `BrandSpellingsPanel`

`feature-brands/src/lib/brand-spellings-panel.ts`: the table of what each chain's source
calls the brand, moved out of `BrandDetailPage` as it is. It reads the brand's ID from
`RECORD_CONTEXT` and the rows from `BrandsGateway.spellings`. It is one `lib-record-section`
with the table inside.

### 4.3 Where each thing of the old page went

| The old page | Now |
| --- | --- |
| The form, always open | Details, read first, "Edit" for the form |
| "A spelling of X", with a link | The field "Same brand as", which is a link |
| The button that deletes a spelling | "Delete this spelling" in the More menu |
| The list of the brands that are spellings of this one | The panel "Other spellings" |
| The table by chain | The panel "What sources call it" |
| The count of products | "Products with this brand" |
| The notice after a save, on the list | The same notice, on the record, through `descriptor.notices` |
| `/harvest/setup/brands/:id/edit` | A redirect to `:id?edit=1` |

## 5. What the gateway does not serve yet

- **The products of a brand.** `GET /v1/admin/catalog/items` takes no `brandId`. The row
  "Products with this brand" shows the count and is not a link. When the route takes the
  filter, add a filter with `param: 'brandId'` to `ITEMS`, and the row becomes a link with
  no other change. It belongs in the backend plan that plan `0053`, section 6, names.
- **Who made and who changed a brand.** The view carries the two dates and no person, so
  the Record block shows the dates alone.

## 6. The walk

On slots of your own, at 1360 px and at 390 px:

- A brand with spellings: two sections, the panel with at most five rows and their counts,
  "See all" when there are more, the table by chain, the count of products, and the Record
  block with two dates and the ID.
- A brand with none: both values of "Links" read "None", and the panel says how to add a
  spelling.
- "Edit", change "Own brand of" through the picker, save. The notice says how many
  products moved.
- Add a brand from the list: it opens, reading, with "Brand added." and "Add another
  brand".
- Add a spelling from the panel: the form opens with "Same brand as" filled in.
- Open a spelling: "Delete this spelling" is in the More menu, it asks, and the app goes
  to the list. On a main brand the action is not offered.
- A key that another brand holds: the refusal is above the first section, with "Open that
  brand".
- At 390 px: the panel "Other spellings" is one row that opens the list, the Record block
  is the last section, no sideways scroll.

## 7. Decisions made

From the mock, approved on 2026-10-05:

- **A collection that belongs to the record is shown in one of three ways, and the
  descriptor picks.** A tab is a long list with its own filters. A panel is a short list in
  the page with a link to the rest. A link is a count that opens the filtered list.
- **On a phone a panel is a row that opens the list.**
- **The records that have a page of their own move to this page one at a time, brand
  first.** Each keeps only what is special to it, as a tab or a panel.

Decisions this plan made, for the owner to confirm:

- **The button of the spellings panel adds a new brand as a spelling.** The mock calls it
  "Link a spelling". Linking a brand that exists is done on that brand, with "Same brand
  as". A second way to do it from the panel would be a picker that writes at once, and the
  page has none of those.
- **Deleting a spelling is a named action and not the Delete of the page**, because the
  gateway deletes a brand only when it is a spelling. The mock draws "Delete the brand
  Hdo.?", which is this case.
- **"Products with this brand" is a count and not a link** until the gateway can narrow
  products by brand.
- **Details is at `details` when a record has tabs.** The addresses of today
  (`/products/:id/details`, `/chains/:id/details`) then stay as they are.

## 8. What this plan deletes

- `feature-brands/src/lib/brand-detail-page.ts` and `brand-detail-page.spec.ts`.
- `detail` on `BRANDS`.
- The `:id/edit` route of a brand as a form of its own.
- The keys of `en.json` that only `BrandDetailPage` read. `no-unread-translation-key.spec.ts`
  names them.
