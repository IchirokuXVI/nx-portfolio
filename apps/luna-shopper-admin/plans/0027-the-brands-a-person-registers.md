# 0027 The brands a person registers

> Server half: `apps/luna-shopper-backend/plans/0115`. This plan cannot start before it lands:
> every route it reads is built there.
>
> The catalog now has a registry of brands and nothing fills it on its own. **This plan gives
> the operator the two screens that fill it**: the brands already registered, where a label and
> a private label chain are edited and every chain's spelling is visible, and the suggested
> brands, where the keys the queue repeats most wait to be registered, with everything needed
> to decide in the row itself.

## Brief for the agent

### Objective

Add a sixth section, Brands, holding a descriptor for registered brands with a detail page that
shows each chain's spellings, and a hand written suggested brands list with a register action,
as sections 2 to 6 describe.

### Context

- Sections are declared in `apps/luna-shopper-admin/src/app/sections.ts:101` (`ADMIN_SECTIONS`,
  typed by `feature-resource/src/lib/admin-section.ts:22-45`). Catalog already holds 8 screens,
  and `shell-sections.spec.ts:36` fails a section with more than 8, so brands cannot go there.
- A section with no `home` draws nothing at its own empty path (`sectionBranch`,
  `feature-resource/src/lib/routes.ts:178`). Hand written `screens` are plain routes, so a
  redirect among them is allowed.
- The closest templates: `feature-catalog/src/lib/product-groups.ts` for a small editable
  descriptor, `price-scopes.ts:97-110` for a reference field to a chain with `nameLookup`,
  `feature-harvest/src/lib/postal-codes.ts` with its row, detail page and hand written gateway
  (plan `0021`), and `harvestRoutes()` with `HARVEST_LINKS` for screens and links.
- `ChainNames` (`feature-harvest/src/lib/chain-names.ts`, exported) resolves a chain id to a
  name once per id and falls back to the id.
- `formatInstant` and `formatSince` (`feature-harvest/src/lib/format-instant.ts`) format dates
  with `Intl`. Never `DatePipe`.
- Lists page by cursor: `ResourcePage { items, nextCursor }`, deduped by id.
- A `ResourceCell` holds one text. No generic cell draws several chips, which is why the
  suggestions list is hand written.
- Strings live in `libs/luna-shopper-admin/ui/assets/i18n/en.json` only, keyed
  `<section>.<camelResource>.*`, tabs under `shell.sections.*`. New error codes need a case in
  `feature-resource/src/lib/gateway-error-key.ts:28` and a `resource.error.*` string.
- Row types are wire types from `models/src/lib/wire/wire-types.ts` (`Wire.*`), flattened by
  hand only where a column needs a different shape (admin plan `0004` section 2).

### Target state

Every exit criterion in section 9 holds, and `npx nx affected -t lint test build` is green.

### Scope

- Work only in: a new library `libs/luna-shopper-admin/feature-brands`,
  `apps/luna-shopper-admin/src/app/sections.ts` and `shell-sections.spec.ts`,
  `feature-resource/src/lib/gateway-error-key.ts` and its spec, and
  `libs/luna-shopper-admin/ui/assets/i18n/en.json`.
- Do NOT touch: the backend, `wire-types.ts` (plan `0115` generates it), the entries queue,
  `ChainNames` itself, the other sections.

### Constraints

- Use the `nx-portfolio-angular-developer` skill for the library, the components and the specs,
  and the `design-taste-frontend` skill for the suggestions list. Match the existing admin look
  rather than inventing one.
- Create the library with the Nx generator the other `feature-*` libraries were made with, then
  run `nx reset`.
- No router link is built from a literal resource segment outside `routes.ts`
  (`no-literal-resource-path.spec.ts`). Ask `ResourceRegistry.pathOf`.
- Every figure and date goes through `Intl`.

### Action boundaries

- Proceed with in-scope edits, specs and the generator.
- Stop and ask before changing the `AdminSection` contract, a descriptor type in `models`, or
  anything in `feature-resource` beyond `gateway-error-key.ts`.

### Progress evidence

Report after the section and its spec, after the descriptor with its detail page, after the
suggestions list, and after the register action, each with its spec run and a screenshot of the
screen on the slot.

## 1. Where it lives

| Piece                       | Where                                                        |
| --------------------------- | ------------------------------------------------------------ |
| Section `brands`            | `sections.ts`, after `catalog`                               |
| `BRANDS` descriptor         | `feature-brands/src/lib/brands.ts`                           |
| Brand detail page           | `feature-brands/src/lib/brand-detail-page.ts`                |
| Suggested brands page       | `feature-brands/src/lib/brand-suggestions-page.ts`           |
| Suggestions gateway         | `feature-brands/src/lib/brand-suggestions-gateway.ts`        |
| `brandsRoutes()`, `BRANDS_LINKS` | `feature-brands/src/lib/routes.ts`                      |

The section:

```ts
{
  key: 'brands',
  label: 'shell.sections.brands',
  segment: BRANDS_SEGMENT,          // 'brands'
  resources: [BRANDS],               // descriptor segment 'registered'
  screens: brandsRoutes(),           // '' redirects to 'registered', and 'suggested'
  links: BRANDS_LINKS,               // Suggested
},
```

- `/brands` opens the registered list, through the redirect in `brandsRoutes()`.
- The second nav row reads **Suggested** then **Registered**, because `sectionScreens` puts links
  before resources. Suggested first is the right order: it is where the work is.
- `shell-sections.spec.ts` changes from five sections to six, gains `brands` in its order and in
  its exact path list, and every other assertion stays.

## 2. Registered brands

### 2.1 The descriptor

`defineResource<Brand>` with `type Brand = Wire.CatalogBrandView` (the exact alias follows the
generated name).

| Field                       | Kind      | Notes                                                                 |
| --------------------------- | --------- | --------------------------------------------------------------------- |
| `label`                     | text      | required, `maxLength: 120`, help: how the brand is written everywhere |
| `key`                       | text      | `editable: false`, help: made from the label, how spellings meet       |
| `privateLabelSupermarketId` | reference | `resource: 'supermarkets'`, `nameLookup: true`, nullable, help: set only when the brand belongs to one chain |
| `itemCount`                 | number    | `editable: false`                                                     |
| `updatedAt`                 | date      | `editable: false`                                                     |

- List columns: `label`, `key`, `privateLabelSupermarketId`, `itemCount`. Compact: `label`,
  `itemCount`.
- Sorts: `label` (default) and `itemCount`, sent as `order`.
- Filters: search on `query`, and a reference filter on `privateLabelSupermarketId` to the
  supermarkets resource (not nullable: the route has no `none`).
- Actions: create and edit. No delete, because the route has none.
- `title(row)` is the label.

### 2.2 After a create

The create answer carries `linkedItems`. Show it once as the success notice the resource screens
already use: "Mahou registered. 38 products now carry it." When it is zero, say "No product
carries it yet."

### 2.3 The detail page

`detail: BrandDetailPage`. It draws the brand exactly as the generic detail does (read
`postal-code-detail-page.ts` for how a hand written detail page reuses the resource frame), and
below it one more block, **How chains spell it**, read from
`GET /v1/admin/catalog/brands/:id/spellings`:

| Chain            | Spelling  | Products | Waiting |
| ---------------- | --------- | -------- | ------- |
| Carrefour        | MAHOU     | 41       | 12      |
| Mercadona        | Mahou     | 17       | 0       |

- Chain names come from `ChainNames`, grouped by chain, the chain's rows adjacent, ordered as the
  route answers.
- A brand no source row carries says so in one sentence: "No harvested product carries this
  brand." That is the normal state of a brand registered by hand.
- A failed read shows the error in that block alone. The brand above it stays usable.
- A spelling that differs from the label only by case or accents is still listed: seeing
  `MAHOU` is the point.

## 3. Suggested brands

### 3.1 What the list is

A read of `GET /v1/admin/catalog/brand-suggestions`, one row per key, **ordered by how many
queued products carry the key, most first.** The order is the server's and the page offers no
other.

### 3.2 The row

Everything the operator decides on is in the row. There is no detail screen.

| Column       | Content                                                                                   |
| ------------ | ----------------------------------------------------------------------------------------- |
| Brand        | `spelling` in the body style, and `key` under it in the muted monospace the key uses elsewhere |
| Products     | `productCount`, `Intl.NumberFormat`, right aligned                                        |
| First seen   | `firstSeenAt` as a medium date with `formatInstant`, and the relative age with `formatSince` beside it in muted text |
| Chains       | one chip per chain: the name from `ChainNames` and its count, `Carrefour 12`, in the server's order |
| (action)     | **Register**                                                                              |

- Every chain is shown. Chips wrap onto a second line rather than truncating, because a chain
  hidden behind "+2" is a fact moved out of the row.
- On a phone the row becomes a card: brand and key on top, then products and first seen on one
  line, then the chips, then the action.

### 3.3 Paging, search and empty states

- Cursor paging with a **Load more** button, as the queues use. Rows are deduped by `key`.
- One search box, sent as `query`. The server keys it, so `el pozo` finds `elpozo`.
- Empty with no search: "No queued product carries an unregistered brand."
- Empty with a search: the generic no match string.
- Loading and failure use the states the other lists use.

### 3.4 Registering a row

**Register** opens an inline panel under the row, not a new screen:

- **Label**, a text input prefilled with `spelling`, so `MAHOU` can become `Mahou` before it is
  saved. The key the label will produce is shown live under the input with `brandKey` from
  `@portfolio/luna-shopper/contracts`, and a sentence appears when it differs from the row's key:
  "This label makes a different key, so these products will not be linked."
- **Private label of**, the existing `lib-reference-picker` for supermarkets, nullable, empty by
  default.
- **Register** and **Cancel**.

On success the row leaves the list, a notice reads "Mahou registered. 38 products now carry
it.", and focus moves to the next row's Register button, or to the search box when no row is left.

On 409 `brand_key_taken`, the panel stays open and says: "A brand with this key already exists."
with a link to that brand, built with `ResourceRegistry.pathOf` from the id in `details`. On 400
`brand_label_empty`: "The label needs at least one letter or digit."

There is no bulk register. Every label is a decision, which is what the panel is for.

## 4. Gateways

- `BRANDS` uses the resource gateway over `admin/catalog/brands`, with an in memory seed of four
  brands (one private label) for the specs and the in memory mode.
- `BrandSuggestionsGateway` is hand written, `providedIn: 'root'`, with `page(query, cursor)` and
  `register(label, privateLabelSupermarketId)`, the second posting to `admin/catalog/brands`. Its
  in memory twin holds six suggestions across three chains.
- The spellings read belongs to the detail page's own small service, or to
  `BrandSuggestionsGateway` renamed to a brands gateway if that reads better. One of the two, not
  both.

## 5. Translations

Under `brands` in `en.json`:

- `shell.sections.brands`: "Brands".
- `brands.nav.suggested`: "Suggested".
- `brands.registered.*`: `one`, `many`, field labels and helps, `sort.*`, `filter.*`,
  `created` (with and without products), `spellings.*` (heading, columns, empty, failed).
- `brands.suggested.*`: `heading`, column headers, `empty`, `register.*` (panel labels,
  `keyDiffers`, `done`), `chain` (`{name} {count}`).
- `resource.error.brandKeyTaken` and `resource.error.brandLabelEmpty`, with their cases in
  `gatewayErrorKey` for `brand_key_taken` and `brand_label_empty`.

`translations.spec.ts` must pass: every literal key in a template exists.

## 6. Accessibility

- The suggestions list is a table on wide screens with real `th` headers, and a list of
  articles on a phone.
- A chip is text, not a control. Its count is read with the chain name, "Carrefour, 12 products".
- The inline panel is announced when it opens, its first field takes focus, Escape closes it and
  returns focus to the row's Register button.
- The live key under the label input is in an `aria-live="polite"` region.

## 7. Tests

- `shell-sections.spec.ts`: six sections, the brands paths, eight or fewer screens.
- `brands.spec.ts` in the style of `catalog-descriptors.spec.ts`: columns name fields, compact is
  a subset, the reference points at a mounted resource, no field declares both `nameFrom` and
  `nameLookup`.
- `brand-detail-page.spec.ts`: spellings grouped by chain, the empty sentence, a failed read that
  leaves the form usable.
- `brand-suggestions-page.spec.ts`:
  - rows render in the gateway's order with every chain chip, the number and both dates;
  - Load more appends and dedupes by key;
  - search sends `query`;
  - Register prefills the label, shows the live key, posts, removes the row and moves focus;
  - the key differs sentence appears and disappears as the label changes;
  - 409 keeps the panel open with a link built by `pathOf`, and 400 shows its sentence.
- `gateway-error-key.spec.ts`: the two new codes.

## 8. Out of scope

- Deleting or merging brands, and aliases (plan `0115` section 9).
- Editing the brand of a product from these screens.
- Registering several suggestions at once.
- A dashboard for the section.
- Any curation change (curation plan `0004`).

## 9. Exit criteria

- [ ] A Brands tab exists, `/brands` opens the registered list, and Suggested sits beside it.
- [ ] A registered brand's label and private label chain are editable, and its detail page
      shows every chain's spelling with counts.
- [ ] Suggested brands are listed by product count, and each row shows the spelling, key,
      product count, first seen date and every chain with its count.
- [ ] Registering a suggestion from its row creates the brand, removes the row and reports how
      many products it linked.
- [ ] Both error codes read as sentences, not as "the server did not say why".
- [ ] `npx nx affected -t lint test build` is green.

## 10. Verification

```sh
npx nx test luna-shopper-admin
npx nx test luna-shopper-admin/feature-brands
npx nx test luna-shopper-admin/feature-resource
npx nx test luna-shopper-admin/ui
npx nx affected -t lint test build

# see it run against a backend slot that has plan 0115
bash tools/dev/ng-slot.sh --up --apps luna-shopper-admin
```
