# 0032 A brand linked to another, and its products

> Backend half: `apps/luna-shopper-backend/plans/0124`. Builds on PR #403, which moved both brand
> screens into the harvester (`/harvest/brands` and `/harvest/suggested-brands`) and added the
> capitalize and revert buttons to the register panel. Do not start before both have merged.
>
> A registered brand can now point at the brand it is really a spelling of, one level deep, and
> the products move with the link. This plan gives that a face: the registered brand form links
> and unlinks, the detail screen lists what is linked, and registering a suggestion under a name
> with a different key links the suggestion to that name instead of leaving its products behind.
> It also lets a person open a suggestion's products: each chain on a suggested brand row opens
> Source products filtered to that chain and that brand.

## Brief for the agent

### Objective

Build sections 2 to 5 in `feature-brands`, `feature-harvest` and `data-access`: the link field
and column, the linked brands block on the detail screen, the register panel that links, the
brand filter on Source products, and the chain count links on the suggested brands row. Use the
`nx-portfolio-angular-developer` skill for the Angular work and `design-taste-frontend` for the
panel and the detail block.

### Context

- `BRANDS` (`libs/luna-shopper-admin/feature-brands/src/lib/brands.ts`) is a `defineResource`
  with fields `label`, `key` (not editable), `privateLabelSupermarketId` (`kind: 'reference'`,
  `resource: 'supermarkets'`, `nameLookup`, `nullable`), `itemCount` and `updatedAt`, list columns
  `label, key, privateLabelSupermarketId, itemCount`, a `query` search filter and a chain filter,
  `actions: { create, edit }`, and `detail: BrandDetailPage`.
- `ReferenceField` (`libs/luna-shopper-admin/models/src/lib/resource/resource-field.ts:177`)
  names its target with `nameFrom` (a row property, for a large target, rendered as a localized
  text) or `nameLookup` (one request per distinct id, for a small target only). Brands are a
  large target.
- `BrandsGateway` (`brands-gateway.ts`): `Brand = Wire.CatalogBrandView`, `create` and `update`
  pass through to `RESOURCE_GATEWAYS`, `register(label, chainId)` posts to
  `/v1/admin/catalog/brands`, `spellings(brandId)` reads `/brands/{id}/spellings`, `notices` is a
  computed over what a create announced. Paths are in `brand-sources.ts`. The in memory seed is
  `brand-seed.ts`.
- `BrandDetailPage` draws `<lib-resource-form-page />` and one spellings panel that fails on its
  own, reading `brandId` from `RESOURCE_ID_PARAM`.
- `BrandSuggestionsPage` (`brand-suggestions-page.ts`) draws each chain as a plain `<li
  class="chip">` twice (cards and table), with `brands.suggested.chain` and `chainAria`. The
  register panel has the label input, capitalize and revert, the live key line with the
  `keyDiffers` warning, the chain picker, a failure line whose `holderLink` opens the brand
  named by a `brand_key_taken`, and the confirm button. `register()` calls
  `BrandsGateway.register`, removes the row and moves focus on.
- `EntriesQueuePage` (`feature-harvest/src/lib/entries-queue-page.ts`) filters by chain (a
  reference picker), status (a select whose empty value means queued, `CANDIDATE` and
  `UNRESOLVED`) and source kind. Only `supermarketId` is read from the URL, once, when the
  page starts (~:853). Nothing writes the filters back to the URL. `reload()` builds a new
  `QueueStore` and calls `HARVEST_SERVICE.listEntries(...)`.
- `EntryQuery` is `libs/luna-shopper-admin/data-access/src/lib/harvest/harvest-service.ts:320`,
  sent by `harvest-api.ts` through `toParams`, with an in memory twin in `harvest-memory.ts:364`.
- A link to a hand written screen uses `HARVEST_SEGMENT` (`dashboard-view.ts:144` links to
  entries with a `supermarketId` query param). A link to a resource uses
  `ResourceRegistry.pathOf`, and `no-literal-resource-path.spec.ts` fails a literal one.
- `gatewayErrorKey` (`feature-resource/src/lib/gateway-error-key.ts`) needs a case and a
  `resource.error.*` string per new backend code, or a refusal reads as "the server did not say
  why".
- After backend `0124`, `Wire.CatalogBrandView` carries `canonicalBrandId`, `canonicalLabel` and
  `linkCount`, the brands list takes `canonicalBrandId`, `POST
  /v1/admin/catalog/brands/register-suggestion` takes `{ spelling, label,
  privateLabelSupermarketId? }` and answers `{ brand, linked, canonicalCreated, linkedItems }`,
  `GET /v1/admin/harvest/entries` takes `brandKey`, and the new codes are `brand_link_to_self`,
  `brand_link_too_deep` (with `details.brandId`) and `brand_link_owns_no_chain`.

### Target state

Every acceptance criterion in section 8 holds and
`npx nx run-many -t lint test -p luna-shopper-admin luna-shopper-admin/feature-brands luna-shopper-admin/feature-harvest luna-shopper-admin/feature-resource luna-shopper-admin/data-access luna-shopper-admin/ui`
plus `npx nx build luna-shopper-admin` are green.

### Scope

- Work only in: `libs/luna-shopper-admin/feature-brands/src/lib/`,
  `libs/luna-shopper-admin/feature-harvest/src/lib/entries-queue-page.ts` and its spec,
  `libs/luna-shopper-admin/data-access/src/lib/harvest/` (`EntryQuery`, the API and memory
  twins), `gateway-error-key.ts`, and `libs/luna-shopper-admin/ui/assets/i18n/en.json`.
- Do NOT touch: the generated wire types, any backend code, the section table, other descriptors,
  the generic resource form.

### Constraints

- Map what the gateway answers into the screen's own types where the brands gateway already does,
  and read new wire fields through `Wire.*` only where `feature-brands` already does (rule D4 and
  admin plan 0004 section 2).
- One level is the server's rule. The client does not pre filter the link picker. It shows the
  server's refusal with a link to the brand that breaks the rule.
- Keep focus handling and the single panel template of the suggestions page.
- English copy only. No dashes as punctuation in copy.

### Action boundaries

- Proceed with in scope edits, specs and a build.
- Stop and ask if `nameFrom` cannot render a plain string label (it is documented for a localized
  text), rather than adding a lookup against the whole brand list or changing the generic field.
- Stop and ask if the generic form cannot draw a reference field to the same resource it edits.

### Progress evidence

Report after the descriptor and detail block with specs, after the register panel with specs, and
after the entries filter and the chain links with specs and a build.

## 1. What is being built

| Piece                                          | Where                                   |
| ---------------------------------------------- | --------------------------------------- |
| "Same brand as" field, column and filter       | `brands.ts`                             |
| Linked brands block, link to the canonical     | `brand-detail-page.ts`                  |
| Register panel links a different key           | `brand-suggestions-page.ts`, gateway    |
| Brand filter on Source products, from the URL  | `entries-queue-page.ts`, `EntryQuery`   |
| Chain counts open Source products              | `brand-suggestions-page.ts`             |
| Three refusal strings                          | `gateway-error-key.ts`, `en.json`       |

## 2. The registered brands

### 2.1 The field

Add to `BRANDS`:

```ts
{
  kind: 'reference',
  name: 'canonicalBrandId',
  label: 'brands.registered.field.canonicalBrandId',
  help: 'brands.registered.help.canonicalBrandId',
  resource: 'brands',
  nameFrom: 'canonicalLabel',
  nullable: true,
}
```

Add it to `list.columns` after `label`, and a `reference` filter on `canonicalBrandId` (not
nullable, the route has no "none"). An empty field on edit sends `null`, which unlinks.

### 2.2 The detail screen

Below the form, above the spellings, one block that fails on its own like the spellings do:

- **A linked brand:** one sentence, "This brand is a spelling of {{label}}. Its products are
  counted on {{label}}.", with the label a link to the canonical brand (`pathOf('brands')` plus
  its id).
- **A brand with links** (`linkCount > 0`): a heading "Spellings linked to this brand" and the
  list of `GET brands?canonicalBrandId=<id>`, each a link to that brand.
- **Neither:** nothing.

The spellings table needs no change: the backend already sends the linked keys.

### 2.3 Refusals

`gatewayErrorKey` cases and strings for the three codes. `brand_link_too_deep` offers a link to
the brand in `details.brandId`, the way the suggestions panel does for `brand_key_taken`.

## 3. Registering a suggestion under another name

When `keyDiffers()` is true, the panel stops warning and says what will happen instead:

> `{{spelling}}` will be registered as a spelling of `{{label}}`, and its products will move to
> `{{label}}`.

The confirm button reads "Register and link" in that state and "Register" otherwise.

`BrandsGateway.registerSuggestion(spelling, label, chainId)` posts to the new route with
`spelling = capitalizeBrand(row.spelling)`. `register()` calls it in both states, because the
route handles the same key case too. On success:

- The row leaves the list and focus moves on, as today.
- The done notice names what happened: "{{label}} registered. {{count}} products now carry it."
  when `linked` is null, "{{spelling}} linked to {{label}}. {{count}} products now carry
  {{label}}." when it is not.
- The chain picker applies only when the name makes a new brand. When the typed name's key
  belongs to a registered brand, `canonicalCreated` is false and the chain was ignored: say so in
  the notice, "{{label}} was already registered, so its chain was kept."

`holderLink` keeps working for the one 409 left, a suggestion registered by somebody else in
between.

## 4. The brand filter on Source products

- `EntryQuery` gains `brandKey?: string`, sent by `toParams`. The memory twin keeps entries whose
  `brandKey(entry.brand)` equals it.
- The page gains a "Brand" text input beside the chain filter. It takes any spelling, shows the
  key it makes under it (the suggestions panel's live key line, same style), and reloads after the
  same 250 ms settle the suggestions search uses. An empty input is no filter.
- The page reads `brandKey` from the query params where it reads `supermarketId`.

## 5. The chain counts open the products

On the suggested brands row, each chain becomes a link, in both the cards and the table:

```html
<a
  [queryParams]="{ supermarketId: chain.supermarketId, brandKey: row.key }"
  [routerLink]="['/', HARVEST_SEGMENT, 'entries']"
  class="chip"
>
```

The visible text stays `brands.suggested.chain`. The screen reader text becomes "{{name}},
{{count}} products. Open them in Source products." No status parameter: the entries page's
default is already queued, which is exactly what the suggestion counted, so the list the link
opens holds the number the chip showed.

Style the chip as a link without losing its shape: the underline on hover and focus, the existing
focus ring, the same size.

## 6. Copy

| Key                                                  | Text                                                                                              |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `brands.registered.field.canonicalBrandId`           | Same brand as                                                                                     |
| `brands.registered.help.canonicalBrandId`            | Set this when the name is only another spelling of a brand, the way DEBORAH 48H is Deborah. Its products move to that brand. |
| `brands.registered.filter.canonicalBrandId`          | Spellings of                                                                                      |
| `brands.registered.links.spellingOf`                 | This brand is a spelling of {{label}}. Its products are counted on {{label}}.                    |
| `brands.registered.links.heading`                    | Spellings linked to this brand                                                                    |
| `brands.suggested.register.linksTo`                  | {{spelling}} will be registered as a spelling of {{label}}, and its products will move to {{label}}. |
| `brands.suggested.register.confirmLink`              | Register and link                                                                                 |
| `brands.suggested.register.doneLinked`               | {{spelling}} linked to {{label}}. {{count}} products now carry {{label}}.                         |
| `brands.suggested.register.chainKept`                | {{label}} was already registered, so its chain was kept.                                          |
| `brands.suggested.chainAria`                         | {{name}}, {{count}} products. Open them in Source products.                                       |
| `harvest.entries.filter.brand`                       | Brand                                                                                             |
| `resource.error.brandLinkToSelf`                     | A brand cannot be a spelling of itself.                                                           |
| `resource.error.brandLinkTooDeep`                    | That link makes a chain of spellings. Only one level is allowed.                                   |
| `resource.error.brandLinkOwnsNoChain`                | A spelling of another brand has no chain of its own. Set the chain on the brand it spells.        |

`brands.suggested.register.keyDiffers` goes, replaced by `linksTo`.

## 7. Tests

- `brands.spec.ts`: the field, the column and the filter.
- `brand-detail-page.spec.ts`: the three states of the links block, the link targets built from
  `pathOf`, and the block failing without taking the form down.
- `brand-suggestions-page.spec.ts`: the linking text and button label follow `keyDiffers`,
  `registerSuggestion` is called with the capitalized spelling, the three done notices, and the
  chain chips link to entries with both query params (assert the `RouterLink` inputs, the testing
  translator does not interpolate).
- `entries-queue.spec.ts`: `brandKey` read from the URL, the input sends the normalized key after
  the settle, an empty input sends none.
- The memory twin filters by key.

## 8. Acceptance criteria

- [ ] A registered brand can be linked to and unlinked from another brand on its form, and the
      list shows and filters "Same brand as".
- [ ] A linked brand's detail names the brand it spells, and a brand with links lists them.
- [ ] Each of the three link refusals reads as its own sentence, and a too deep refusal links to
      the brand that breaks the rule.
- [ ] Registering a suggestion under a name with a different key links the suggestion to that name
      in one request, and the notice says so.
- [ ] Source products has a brand filter that reads `brandKey` from the URL.
- [ ] Every chain on a suggested brand row opens Source products filtered to that chain and brand,
      and the queued list it opens holds the count the chip showed.
- [ ] Lint, tests and the admin build pass.

## 9. Verification

```sh
npx nx run-many -t lint test -p luna-shopper-admin luna-shopper-admin/feature-brands luna-shopper-admin/feature-harvest luna-shopper-admin/feature-resource luna-shopper-admin/data-access luna-shopper-admin/ui
npx nx build luna-shopper-admin
```
