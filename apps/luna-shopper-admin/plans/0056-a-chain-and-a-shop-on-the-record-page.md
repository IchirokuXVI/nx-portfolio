# 0056 A chain and a shop on the record page

> Fifth plan of the record page series (`0052` to `0060`). Needs `0054` (the collections of
> a record), merged. It moves the chain and the shop, and it is the first plan that draws
> the page as a pane of a split screen.
>
> Mock: `plans/mocks/record-page/` in this app, published at
> <https://claude.ai/artifact/9w1HHBNWQHyy3GTJWtjcYM>. The boards for this plan are `Shop`
> and `Phone-Shop`. The split itself is plan `0042`, and this plan does not redraw it.

Plan `0042` put the chains in a column, the open chain beside it, and inside the chain its
shops in a second column with the open shop beside that. The Details tab of a chain and of
a shop is a subclass of the old form: `SupermarketFormPage` and `LocationFormPage`. The
shop page also has a small editor of its own for the price scopes, with its own Save.

After this plan the chain and the shop are record pages. The shop is the page inside a
pane, which is narrow, so its Record block goes after its sections.

## Brief for the agent

### Objective

Draw the chain and the shop with `RecordPage`, the shop as a pane of the split of plan
`0042`. Delete `ChainPage`, `ShopPage`, `SupermarketFormPage` and `LocationFormPage`. Use
the `nx-portfolio-angular-developer`, `design-taste-frontend`, `antislop`, `antislop-ui`,
`antislop-human` and `antislop-layoutmobile` skills.

### Context

All under `feature-catalog/src/lib/` unless it says otherwise.

- **The routes** are `chains/chains-routes.ts`. `/chains` is a split of `SUPERMARKETS` with
  a column 13.5 rem wide. `/chains/:chainId` is `ChainPage`, which opens on `shops`:
  - `shops` is a split of `LOCATIONS` under the chain's header.
  - `sections` is `ChainSectionsTab`.
  - `scopes` is the list of `PRICE_SCOPES` as a tab.
  - `details` is `SupermarketFormPage`.
- `/chains/:chainId/shops/:shopId` is `ShopPage`, which opens on `details`
  (`LocationFormPage`), with `sections` (`ShopSectionsTab`) and `products` (the list of
  `LOCATION_ITEMS` as a tab).
- **`ChainPage`** (`chains/chain-page.ts`, 462 lines) draws the header, a state that says
  whether the harvester fetches the chain and links to Setup, four tabs with three counts,
  Edit and Delete, and a refusal. Below 72 rem it draws no header while a shop is open.
  `ChainContext` reads the chain, the two counts and the state of the source, and holds
  `setDefaultScope`, which the "Make default" action of a price scope calls.
- **`ShopPage`** (`chains/shop-page.ts`, 716 lines) draws the header, "Priced by" (the
  scopes as marks, and a "Change" button that opens a `lib-references-control` with its own
  Save), three tabs, Edit and Delete. When the address names another chain than the shop's
  own, it goes to the right address. `ShopContext` reads the shop and holds
  `setPriceScopes`.
- **The fields of `SUPERMARKETS`**: `id`, `name` (localized, required), `websiteUrl` and
  `logoUrl` (both `url`), `externalBrandKey`, `defaultPriceScopeId` (a reference,
  `editable: 'edit'`, with `unsetFlag`), `locationCount`. `rowStates`: "no default scope".
- **The fields of `LOCATIONS`**: `id`, `supermarketId` (the parent, `editable: 'create'`),
  `priceScopeIds` (references, with `scopeFrom` and `locked`), `label` (localized),
  `address`, `city`, `postalCode`, `postalCodeSource` (a choice, never editable), `country`,
  `latitude`, `longitude`, `externalRef`, `externalProvider`. `rowStates`: "map" and
  "postal code guessed". `list.brief.line` is the city and the postal code.
- **Neither view carries a date.** `CatalogSupermarketView` and
  `CatalogSupermarketLocationView` have no `createdAt` and no `updatedAt`.
- The heading of a page inside a pane is a level lower, through `PAGE_HEADING_LEVEL` of
  `ui/src/lib/page/page-header.ts`.

### Target state

1. **A chain is a record page** in the pane beside the column of chains. Its tabs are
   "Shops", "Sections", "Price scopes" and "Details", in that order, and it opens on
   "Shops". The counts are those of today.
2. **The state of a chain** in the header says whether the harvester fetches it, as today.
   It is a state and no longer a link.
3. **Details of a chain** reads first: the name in each language, the website, the logo
   with a preview, the chain's key at the source, and the default price scope. A chain with
   no default scope shows its flag there.
4. **A shop is a record page** in the pane beside the column of shops. Its tabs are
   "Details", "Sections" and "Products", and it opens on "Details".
5. **Details of a shop** has four sections: "Name", "Address", "Prices" and "Where it came
   from" (section 3). The Record block comes after them, because the pane is narrower than
   60 rem.
6. **A guessed postal code is amber**: "Guessed from the city. Check it." beside the code.
7. **"Priced by" is a field.** While the page reads, each scope is a name with its scope
   mark. It changes under "Edit" with the rest of the shop, and the shop's own scope has no
   button that takes it away. The "Change" button and its own Save are gone.
8. **The coordinates are two numbers and one link**, "Open on a map", to a map site. There
   is no map.
9. **A new chain and a new shop** are `RecordPage` at `new`. The chain of a new shop is a
   locked value. After the save the new record is open in its pane.
10. **Below 72 rem** an open shop takes the whole page: the chain's header and tabs are not
    drawn, and the back link of the shop names the chain.
11. **A shop reached through the wrong chain** goes to its own address.
12. **`ChainPage`, `ShopPage`, `SupermarketFormPage` and `LocationFormPage` are gone.**
    Sections, price scopes, section order and the products of a shop work as before.

### Scope

- In: `feature-catalog/src/lib/chains/**`, `supermarkets.ts`, `locations.ts`,
  `supermarket-form-page.ts` and `location-form-page.ts` (both deleted),
  `location-sections.ts` and `chain-sections.ts` (only how they learn the chain and the
  shop), `feature-resource/src/lib/` (`record-page.ts`, `record-view.ts`, `routes.ts`,
  `resource-route-data.ts`), `models/src/lib/resource/` (the two additions of section 2),
  `ui/src/lib/record/field-value.ts` and `ui/src/lib/resource/references-control.ts`,
  their specs, `en.json`, and `apps/.../no-new-old-form.spec.ts` (its list loses two
  files).
- Out: `ResourceSplitPage` and the column lists, the sections of a chain and of a shop,
  the price scopes list, the gateway, `openapi.json` and `wire-types.ts`.

### Constraints

- No part changes for the pane. The page lays itself out by its own width: the Record
  block is beside the sections at 60 rem and above, and after them below that.
- The split, its widths and its heights are plan `0042` and plan `0049`. Do not change a
  rule of `resource-split-page.ts`.
- A scope of a shop is changed only with Save. Nothing on a reading page writes.
- The constraints of plans `0053` and `0054` hold.

### Action boundaries

- Do not change a gateway route or a DTO.
- Do not change what the section order of a shop does (`LocationSections`). It keeps its
  own save, inside its own tab.
- Do not start, stop or migrate Luna slot 0, 1 or 3. The walk saves, so it needs a Luna
  slot of your own, given back with `--down`.

### Progress evidence

- `npx nx lint` and `npx nx test` are green for `luna-shopper-admin/feature-catalog`,
  `luna-shopper-admin/feature-resource`, `luna-shopper-admin/models`,
  `luna-shopper-admin/ui` and `luna-shopper-admin`.
- `npx nx build luna-shopper-admin` is green.
- The browser walk of section 5, at 1360 px, at 900 px and at 390 px, with screenshots.

## 1. Not in this plan

- A map for the coordinates. A map is a field kind of its own and it brings a dependency.
- The dates and the people of the Record block. Neither view carries them. The Record
  block of a chain holds the ID alone, and the one of a shop holds the source of the
  postal code and the ID.
- A link from the chain to its source. The source is reached from Setup.

## 2. What the contract gains

Two small additions, both in `models/src/lib/resource/resource-field.ts`.

```ts
// On TextField, for format 'url':
/** A translation key for the words of the link, in place of its address. */
readonly linkLabel?: string;

// On ReferencesField:
/**
 * The scope mark to draw before one target, read from the target's own row.
 * A method for the reason `locked` is one.
 */
mark?(target: ResourceRow): ScopeMarkView | undefined;
```

- `toRecordValue` hands `linkLabel` on, and `lib-field-value` draws the link with those
  words.
- `lib-field-value` and the rows of `ReferencesControl` draw `ScopeMark` before a target
  whose `mark` answers one. The page asks `mark` once the lookup has read the target, as
  it asks `locked`.

And three rules of `RecordPage`, each for any record and not for these two:

- **The line under the heading.** When the descriptor states `list.brief`, the line under
  the heading of the page is the line the row has in a column. For a shop that is
  "Sevilla 41004".
- **A record under the wrong parent.** When the descriptor has a `parent`, the row is
  read, and the row's own parent is not the one the address names, the page goes to the
  row's own address with `replaceUrl`.
- **A page that gives way to its child.** A new key of route data,
  `RECORD_YIELDS_TO`, names a child route. Below 72 rem, while a route under that child
  holds a record, the page draws no header and no tabs. The chain names `shops`.

## 3. The descriptors

### 3.1 `SUPERMARKETS`

```ts
record: {
  details: 'last',
  sections: [
    { title: 'catalog.supermarkets.section.name',
      fields: ['name', 'websiteUrl', 'logoUrl', 'externalBrandKey'] },
    { title: 'catalog.supermarkets.section.prices',
      fields: ['defaultPriceScopeId'] },
  ],
  children: [
    { as: 'tab', resource: 'locations', by: 'supermarketId', count: 'locationCount' },
    { as: 'tab', name: 'sections', label: 'catalog.chains.tab.sections',
      component: ChainSectionsTab },
    { as: 'tab', resource: 'price-scopes', by: 'supermarketId' },
  ],
  counts: () => inject(ChainCounts).of,
},
```

- `logoUrl` gets `format: 'image'`. `externalBrandKey` gets `format: 'code'`.
- `locationCount` is the count of the first tab and is drawn nowhere else. `recordLayout`
  puts a field that a child names as its `count` in no section (plan `0052`, section 2.3).
- `rowStates` gains the state of the source: "Fetched by the harvester", "Not fetched" or
  none. It reads what `ChainContext` reads today.
- `ChainCounts` is what is left of `ChainContext`: the count of sections and of price
  scopes, and `setDefaultScope`. The record itself is `RECORD_CONTEXT`.
- `editor` is deleted.
- The `shops` tab is a split with routes under it, so `chains-routes.ts` hands that route
  to `recordRoute` through `tabs`.

### 3.2 `LOCATIONS`

```ts
record: {
  sections: [
    { title: 'catalog.locations.section.name', fields: ['label'] },
    { title: 'catalog.locations.section.address',
      fields: ['address', 'city', 'postalCode', 'country',
               'latitude', 'longitude', 'mapUrl'] },
    { title: 'catalog.locations.section.prices', fields: ['priceScopeIds'] },
    { title: 'catalog.locations.section.source',
      fields: ['externalProvider', 'externalRef'] },
  ],
  children: [
    { as: 'tab', name: 'sections', label: 'catalog.shops.tab.sections',
      component: ShopSectionsTab, count: 'sectionCount' },
    { as: 'tab', resource: 'location-items', by: 'supermarketLocationId' },
  ],
  facts: { also: ['postalCodeSource'] },
},
```

- `postalCode` gets `check`: when `postalCodeSource` says the code was guessed, it answers
  `{ label: 'catalog.locations.postalCodeGuessed' }`. Use the test that the "postal code
  guessed" state of `rowStates` uses today.
- `mapUrl` is a new field for display only: `kind: 'text'`, `format: 'url'`,
  `editable: false`, `linkLabel: 'catalog.locations.openOnMap'`, and `read` builds the
  address of the place on OpenStreetMap from the two numbers. It answers `null` when a
  coordinate is missing, and the row then reads "None".
- `priceScopeIds` gets `mark`: the mark of the target's kind, from the function that the
  price scope cell already uses.
- `externalProvider` gets `format: 'code'`.
- `supermarketId` is the parent. It is named in no section: on a new shop the page draws
  it as a locked value (plan `0052`, section 2.3), and on a saved shop the pane sits under
  the chain it belongs to.
- The count of the Sections tab is the length of `sections` on the row. The contract takes
  a field name, so add a display field `sectionCount` with `read`, or put the count in
  `record.counts`. Choose the smaller change.
- `editor` is deleted.

## 4. Specs

- `chains/chain-page.spec.ts` (931 lines) and `chains/shop-page.spec.ts` (922 lines) are
  rewritten over `RecordPage` with the two descriptors, as `chains/chain-record.spec.ts`
  and `chains/shop-record.spec.ts`. Keep every case that is about behavior: the tabs and
  their counts, the first tab, the state of the source, the delete and its refusal, the
  shop under the wrong chain, the narrow screen. Drop the cases about the "Change" editor
  of the scopes, and add: the scopes change with Save, the shop's own scope is locked.
- `supermarkets.spec.ts`, `catalog-descriptors.spec.ts`: the two `record` blocks, `check`
  on a guessed code, `mapUrl` with and with no coordinates, `mark`.
- `feature-resource/.../record-page.spec.ts`: the three rules of section 2.
- `ui/.../record/field-value.spec.ts` and `references-control.spec.ts`: `linkLabel`, and
  the mark before a target.
- `resource-split-page.spec.ts` and `routes.spec.ts` stay green with no change to what
  they assert about the split.
- List in the pull request any case of a rewritten spec that has no new home.

## 5. The walk

On slots of your own.

At 1360 px:

- The chains column, a chain open on "Shops", a shop open beside the shops column. The
  white panels reach the bottom of the page, as plan `0049` left them.
- The shop reads: four sections, the amber state on a guessed postal code, "Open on a
  map" opens the right place, the scopes each with its mark, and the Record block after
  the sections.
- "Edit" on the shop: no row moves. Add a scope and take one away, and the shop's own
  scope cannot be taken away. Save. Fix the postal code, save, and the amber state is
  gone.
- Add a shop: the chain is a locked value. After the save the shop is open in its pane
  and the column shows it.
- Details of the chain: read, edit the website, save. A chain with no default scope shows
  the flag, and "Edit" lets one be picked from this chain's scopes only.
- Change a field of the shop, then press another shop in the column, another chain, and a
  tab. Each asks.
- Delete a shop: the app goes to the shops of the chain. Delete a chain that still has
  shops: the refusal says why.
- The address of a shop with another chain's ID in it goes to the right address.

At 900 px: the rail, one column, and each pane as a page of its own.

At 390 px:

- A shop takes the page. Its header is 48 px, the line under the name is the city and the
  postal code, and the back link names the chain. The chain's header and tabs are not
  drawn.
- The Record block is the last section. The save bar sits above the bar of the app.
- No sideways scroll.

## 6. Decisions made

From the mock, approved on 2026-10-05:

- **The page also works as a pane.** Inside a chain, a shop's record is the Details tab of
  the split screen of plan `0042`. The pane is narrow, so the record's facts go after the
  sections. No part changes.
- **A value that a person must check is amber**, such as a guessed postal code. A value
  that a person may not change says who set it.
- **No map for coordinates.** Two numbers and a link are enough for now.
- **A switch, and every other value, changes with Save.**

Decisions this plan made, for the owner to confirm:

- **The source of a shop is a section and not part of the Record block.** The board puts
  "Came from" in the Record block with "Set by the harvester". Both fields can be changed
  by hand today, and a fact of the Record block cannot. Making them fixed is a decision
  about the catalog. Say so if the harvester alone should write them, and the two fields
  move to `facts.also` with `setBy`.
- **"Priced by" loses its own "Change" and its own Save.** It is a field of the shop, and
  the owner agreed that the whole page is edited at once.
- **The state of the chain's source is not a link any more.** A state in a header is not a
  control. The source is reached from Setup, and plan `0059` gives it a page that links
  back to its chain.
- **Details stays the last tab of a chain** and the first of a shop, as plan `0042` has
  them.

## 7. What this plan deletes

- `feature-catalog/src/lib/chains/chain-page.ts` and `chains/shop-page.ts`.
- `feature-catalog/src/lib/supermarket-form-page.ts` and `location-form-page.ts`.
- `chains/shop-context.ts`, and what of `chains/chain-context.ts` the record page now
  does.
- `editor` on `SUPERMARKETS` and on `LOCATIONS`.
- The keys of `en.json` that only those files read.
