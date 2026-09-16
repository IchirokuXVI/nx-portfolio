# 0028 A shop priced at several scopes

> Backend half: `apps/luna-shopper-backend/plans/0116`.
>
> Since backend plan 0105 a shop holds a stack of price scopes, ranked by priority, and since
> backend plan 0116 it always holds its own single shop scope beside whatever else it is given.
> The back office still edits one `priceScopeId` per shop, and it names the priority bands in
> English literals that disagree with the kind names. This plan gives the shop form a stack editor
> and puts one set of four names on the tiers.

## Brief for the agent

### Objective

Replace the single price scope field of a shop with an editor for its whole stack, rename the
`POSTAL_CODE` kind to `LOCAL_AREA` in the back office, and draw the priority bands with the same
four translated names as the kinds, as sections 2 to 5 describe. Use the
`nx-portfolio-angular-developer` skill for the Angular work and `design-taste-frontend` for the
stack control.

### Context

- The shop descriptor is `libs/luna-shopper-admin/feature-catalog/src/lib/locations.ts`. Its
  `priceScopeId` field is `kind: 'reference'` (:85-95), a list column (:184) with no name lookup,
  and a reference filter (:226).
- The wire view `CatalogSupermarketLocationView` carries `priceScopeId: string` and
  `priceScopeIds: string[]` (`wire-types.ts:2087`). Create and update DTOs accept either. No
  descriptor, screen or spec reads `priceScopeIds`.
- The field kinds are the union at `libs/luna-shopper-admin/models/src/lib/resource/resource-field.ts:256`:
  `text`, `number`, `money`, `boolean`, `enum`, `reference`, `localized-text`, `date`, `json`.
  **There is no multiple reference kind.** The renderer is `libs/luna-shopper-admin/ui/src/lib/resource/field-control.ts`,
  and the draft and view switch on the kind in `resource-draft.ts` (:60, :126, :281, :417) and
  `resource-view.ts:114`.
- `lib-reference-picker` (`libs/luna-shopper-admin/ui/src/lib/resource/reference-picker.ts`) takes a
  `scope` input of type `ReferenceScope`, which the runs page uses to limit price scopes to one
  chain.
- `priorityBand()` (`feature-catalog/src/lib/price-scopes.ts:25`) returns `'This shop'`,
  `'Postal code'`, `'Region'`, `'Everywhere'` and `` `Custom (${priority})` `` as literals. No spec
  covers it.
- The kind names live in `libs/luna-shopper-admin/ui/assets/i18n/en.json:411`:
  `NATIONAL` "Nationwide", `REGION` "Chain region", `POSTAL_CODE` "Postal code area", `STORE`
  "Single shop". `PRICE_SCOPE_KIND_OPTIONS` is in `feature-catalog/src/lib/catalog-enums.ts:53`.
- The price scopes list query accepts `supermarketId`, and a repeatable `kind` once backend plan
  0116 section 7 lands.
- The testing translator drops interpolation, so a spec asserting "Custom (250)" reads the key.

### Target state

Every acceptance criterion in section 8 holds and `nx affected -t lint test` is green for the
touched projects.

### Scope

- Work only in: `libs/luna-shopper-admin/models/src/lib/resource/` (the new field kind and its
  draft and view cases), `libs/luna-shopper-admin/ui/src/lib/resource/` (its control),
  `libs/luna-shopper-admin/feature-catalog/src/lib/` (`locations.ts`, `price-scopes.ts`,
  `catalog-enums.ts`, `catalog-seed.ts`), `libs/luna-shopper-admin/ui/assets/i18n/en.json`, the
  data-access memory fakes if they model a stack, and their specs.
- Do NOT touch: the wire types by hand, the harvest screens, any backend code.

### Constraints

- The new field kind is generic: it knows a resource and a list of ids, and nothing about price
  scopes. What is special about a shop's own scope is stated by the shop descriptor.
- Match the look of the existing reference picker and field controls.
- An edit sends only what changed, as every descriptor form does.

### Action boundaries

- Proceed with in-scope edits and specs.
- Stop and ask before adding a dependency, and if the shop list's `priceScopeId` filter turns out
  to filter on something other than stack membership (section 4.3).

### Progress evidence

Report after the field kind with its draft, view and control specs, after the shop descriptor, and
after the names, each with the spec run.

## 1. What changes for the operator

- A shop's form shows every scope it is priced at, most specific first, and lets the operator add
  and remove scopes of the shop's chain.
- The shop's own single shop scope is always in the list and cannot be removed. On a new shop the
  form says it is added automatically.
- The price scopes list names each priority band with the tier name: Single shop, Local area,
  Chain region, Nationwide.

## 2. The names

One set of four names, used by the kind and by the band alike:

| Kind         | Default priority | Key                                  | English        |
| ------------ | ---------------- | ------------------------------------ | -------------- |
| `STORE`      | 100              | `catalog.priceScopeKind.STORE`       | Single shop    |
| `LOCAL_AREA` | 200              | `catalog.priceScopeKind.LOCAL_AREA`  | Local area     |
| `REGION`     | 300              | `catalog.priceScopeKind.REGION`      | Chain region   |
| `NATIONAL`   | 1000             | `catalog.priceScopeKind.NATIONAL`    | Nationwide     |

- `catalog.priceScopeKind.POSTAL_CODE` is removed and `LOCAL_AREA` added. `PRICE_SCOPE_KIND_OPTIONS`
  follows.
- The owner wrote the names in title case ("Chain Region"). The back office writes every label in
  sentence case, so the keys keep sentence case. This is a one word change in `en.json` if the owner
  prefers the other.
- `priorityBand(priority)` returns a translation key: the kind key for 100, 200, 300 and 1000, and
  `catalog.priceScopes.priorityCustom` with a `{{priority}}` parameter otherwise ("Custom
  ({{priority}})"). The priority field's `read` translates it.

## 3. A field that holds several references

A new field kind in `resource-field.ts`:

```ts
export interface ReferencesField<T extends ResourceRow> extends FieldBase<T> {
  readonly kind: 'references';
  /** The `name` of the resource every id points at. */
  readonly resource: string;
  /** Resolve each id's name through the reference lookup, as `ReferenceField.nameLookup`. */
  readonly nameLookup?: true;
  /** Limit the picker to rows matching this scope, read from the draft. */
  readonly scopeFrom?: (draft: Partial<T>) => ReferenceScope;
  /** Ids the form shows and keeps but never offers to remove. */
  readonly locked?: (row: Partial<T>) => readonly string[];
}
```

- **Draft.** The value is `string[]`. An unchanged list, in any order, is not a change. A changed
  list is sent whole.
- **View.** A cell shows the names joined by commas, in the order the row carries them.
- **Control.** A list of chips with a remove button, and a `lib-reference-picker` below it that
  adds the chosen id. A locked id has no remove button and a `title` saying why. An id already in
  the list is not added twice. The control is keyboard operable: the remove buttons are real
  buttons with an accessible name that includes the scope's name.

## 4. The shop descriptor

### 4.1 The field

`priceScopeId` is replaced by:

```ts
{
  kind: 'references',
  name: 'priceScopeIds',
  label: 'catalog.locations.priceScopeIds',
  help: 'catalog.locations.priceScopeIdsHelp',
  resource: 'price-scopes',
  nameLookup: true,
  scopeFrom: (draft) => ({
    supermarketId: draft.supermarketId,
    kind: ['LOCAL_AREA', 'REGION', 'NATIONAL'],
  }),
  locked: (row) => row.priceScopeIds?.filter(isOwnStoreScope(row)) ?? [],
}
```

`isOwnStoreScope` needs the scope's kind and key, which a list of ids does not carry. It resolves
through the same lookup that names the chips: a scope whose kind is `STORE` and whose
`externalKey` is the shop's id is locked. Until the lookup answers, nothing is locked and nothing
is removable either, so a slow lookup cannot let the operator remove the shop's own scope.

The help text says: "The most specific scope with a valid price answers. A single shop scope is
always kept, and a new shop gets one automatically."

### 4.2 Another shop's single shop scope

The picker asks for every kind but `STORE` (backend plan 0116, section 7). A shop's own store scope
is already in its stack and locked, and another shop's is never a sensible choice, so the picker
does not offer one. The backend refuses it anyway (backend plan 0116, section 5).

If `ReferenceScope` cannot carry a repeated query parameter, extend it to accept a string array
and send one parameter per value.

### 4.3 The list and the filter

- The list column becomes `priceScopeIds` with names.
- The filter stays a single `priceScopeId` reference. The agent confirms in the catalog list query
  that it matches a shop holding that scope anywhere in its stack, since the column it once read
  was dropped by backend plan 0105. If it does not, stop and ask: that is a backend change.

### 4.4 The seed

`catalog-seed.ts` rows already carry `priceScopeIds`. They gain the shop's own store scope where
missing, so the memory back end shows the same shape the real one returns.

## 5. The run form's scope titles

`runs-page.ts` titles a scope by its key and label and does not show the kind. It is not changed.
Admin plan 0029 reworks that form.

## 6. What this plan does not do

- It does not let the form edit a scope's priority.
- It does not change any harvest screen.

## 7. Tests

- **Field kind**: draft equality ignores order, a changed list is sent whole, the view joins names,
  the control adds, removes, refuses a duplicate, and draws a locked id without a remove button.
- **Shop descriptor** (`catalog-descriptors.spec.ts`): the field is `references` over
  `price-scopes`, scoped to the chain, with names, and the own store scope is locked while another
  scope is not.
- **Names**: `priorityBand` answers the kind key for the four defaults and the custom key otherwise,
  and `PRICE_SCOPE_KIND_OPTIONS` has `LOCAL_AREA` and no `POSTAL_CODE`.
- **Screen** (`catalog-screens.spec.ts`): editing a shop and removing a region sends
  `priceScopeIds` without that region and with the store scope.

## 8. Acceptance criteria

- [ ] A shop's form edits its whole stack, and the own single shop scope cannot be removed.
- [ ] The picker offers only the shop's chain's scopes, and no single shop scope.
- [ ] The list shows each shop's scopes by name.
- [ ] Kinds and priority bands use the same four translated names, and `POSTAL_CODE` is gone.
- [ ] The references field kind has draft, view and control specs.
- [ ] The shop list filter is confirmed to match stack membership, or the agent stopped and asked.

## 9. Verification

```sh
npx nx test luna-shopper-admin/models
npx nx test luna-shopper-admin/ui
npx nx test luna-shopper-admin/feature-catalog
npx nx affected -t lint test
```
