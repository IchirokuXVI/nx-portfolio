# 0029 A run that copies its walks

> Backend half: `apps/luna-shopper-backend/plans/0118` and `0119`.
>
> A catalog discovery can now copy what it read at a walked scope onto other scopes of any tier,
> choose whether it writes prices, availability or both, and fetch product details only for new
> products. This plan puts those three choices on the run form, shows the copies a run made, and
> shows on every price where a copied price was read.

## Brief for the agent

### Objective

Add a copies editor, a writes choice and a details choice to the run form, show a run's copies and
detail counts in its report, and show `copiedFromScopeId` beside every price that carries it, as
sections 2 to 6 describe. Use the `nx-portfolio-angular-developer` skill for the Angular work and
`design-taste-frontend` for the copies editor.

### Context

- The run form is the hand written `RunsPage`
  (`libs/luna-shopper-admin/feature-harvest/src/lib/runs-page.ts`), spec `runs-page.spec.ts`.
- Capabilities come from `Wire.HarvestAdapterCapabilityTable` through `capabilitiesOf` (:132),
  with a local `AdapterCapabilities` interface (:88). After backend plan 0119 the table carries
  `skipsKnownDetails`.
- `needsScopeList` (:644) draws the walked scopes as a checkbox list (template :248-276) from
  `scopeChoices()` (:661), disabling scopes outside `walkablePriorities`. `toggleScope` (:731)
  keeps the order of ticking. `_readScopes` (:831) pages the chain's scopes, 100 per page, at most
  5 pages.
- `_input()` (:1025) builds `Wire.SpawnHarvestRunDto` and leaves out blank fields.
- After backend plan 0118 the DTO accepts `scopeCopies: { from: string; to: string[] }[]`. After
  0119 it accepts `writes` (`PRICES_AND_AVAILABILITY`, `PRICES`, `AVAILABILITY`) and `details`
  (`NEW`, `ALL`).
- After backend plan 0116 the price scopes list accepts a repeatable `kind` filter, and every shop
  has a `STORE` scope, so Mercadona holds about 1,675 of them.
- Admin plan 0028 adds a `references` field kind with a chip list control.
- Translations: `libs/luna-shopper-admin/ui/assets/i18n/en.json`, `harvest.runs.start.*` at :575.

### Target state

Every acceptance criterion in section 8 holds and `nx affected -t lint test` is green for the
touched projects.

### Scope

- Work only in: `libs/luna-shopper-admin/feature-harvest/src/lib/` (the runs page, the run report
  view and their specs), `libs/luna-shopper-admin/ui/src/lib/resource/` (only to make the chip list
  control of admin plan 0028 usable outside a descriptor), the catalog descriptors that list prices
  (section 5), `en.json`, the data-access harvest memory fake and seed, and their specs.
- Do NOT touch: the wire types by hand, the sources page, presets (admin plan 0030), any backend
  code.

### Constraints

- The server is the authority on every copy rule. The form prevents the obvious mistakes and shows
  the server's refusal for the rest, the way it already shows a refused spawn.
- Keep the existing run form cases green unless a case asserts the old scope read, which is named
  in the PR.

### Action boundaries

- Proceed with in-scope edits and specs.
- Stop and ask before adding a dependency, and if admin plan 0028's control cannot be used outside
  a descriptor form without changing its behaviour there.

### Progress evidence

Report after the scope read change, after the copies editor with specs, after writes and details,
and after the report and provenance columns.

## 1. What changes for the operator

On a catalog discovery whose adapter takes a scope list (Mercadona):

1. Tick the warehouses to walk, as today.
2. Under each ticked warehouse, a "Copy to" list: add any scope of the chain, of any tier.
3. Choose what the run writes: prices and availability, prices only, or availability only.
4. Choose product details: new products only, or every product.

On any catalog discovery, the writes choice is shown. On an adapter that takes one scope
(Carrefour), a single "Copy to" list sits under the scope picker.

## 2. Reading the scopes

`_readScopes` asks for every kind but `STORE` (`kind=LOCAL_AREA&kind=REGION&kind=NATIONAL`), so the
walk list is not cut short by 1,675 shop scopes. A walk never targets a shop scope: no adapter's
band reaches priority 100.

Copy targets can be shop scopes, so the "Copy to" lists do not use this page. They use the
reference picker, which searches the server as the operator types.

## 3. The copies editor

- **One list per walked scope**, drawn under its checkbox when it is ticked, using the chip list
  control of admin plan 0028, scoped to `{ supermarketId }`, with names.
- **Unticking a walked scope drops its list.** The copies it held are lost, and the form says so
  in the list's place until the operator ticks it again or starts the run.
- **The form refuses two mistakes as they are made**, with an inline message under the list:
  - adding a scope that is ticked as walked ("This scope is walked in this run.").
  - adding a scope that is already a target under another walked scope ("Already copied from
    {{scope}}.").
- **Ticking a scope that is a target somewhere** is allowed, and the target is highlighted with the
  same message until one of them is removed. The start button stays disabled while any conflict is
  shown.
- A list with no targets sends nothing for that walked scope.

`_input()` sends `scopeCopies` as `{ from, to }` for every walked scope with at least one target, in
the order the scopes were ticked and the targets added.

## 4. Writes and details

- **Writes**: a radio group with three options, default "Prices and availability". Shown for every
  catalog discovery that is not a detail backfill. "Prices only" is not offered when the adapter's
  `writesPrices` is false, and "Availability only" is the only option then.
- **Details**: a radio group with two options, default "New products only", shown only when the
  adapter's `skipsKnownDetails` is true. Its help text: "A product the harvester already knows keeps
  the EAN and brand it was read with. Choose every product to read them again."
- `_input()` sends `writes` whenever the group is shown and `details` whenever its group is shown,
  so the run's stored input matches what the operator saw.

## 5. Where a copied price was read

- Every admin list and detail that shows a price's `priceSourceKind` or `sourceKind` gains a
  "Copied from" column or row, reading `priceCopiedFromScopeId` or `copiedFromScopeId`, named
  through the price scopes lookup. Find them with a search for `priceSourceKind` and `sourceKind`
  in `libs/luna-shopper-admin/feature-catalog`. An empty value shows nothing, not a dash.
- A scope that no longer exists shows its raw id, which is what the lookup already answers for an
  unknown id.

## 6. The run's report

Where a run's `report` is drawn, the report gains:

- a copies table: walked scope, targets (names, collapsed after five with a count), prices copied,
  availability copied.
- the detail counts of backend plan 0119: requested, skipped as known, fetched for a missing EAN.
- the resolved `writes` and `details`.

The warnings `COPY_TARGET_GONE`, `COPY_SOURCE_NOT_WRITTEN` and `DETAIL_SKIPPED_UNKNOWN` get
translated messages beside the existing ones.

## 7. Tests

- **Scope read**: `_readScopes` sends the three kinds.
- **Copies**: ticking two scopes and adding targets sends `scopeCopies` in order. Adding a walked
  scope as a target is refused inline. Adding the same target under two walked scopes is refused
  inline. Ticking a scope that is a target disables start until resolved. Unticking drops that
  scope's copies.
- **Writes and details**: defaults are sent. Details is hidden for an adapter without
  `skipsKnownDetails`. "Prices only" is hidden for an adapter that writes no price.
- **Refusal**: a server refusal naming a scope is shown the way the existing refusal case shows it.
- **Report**: a report with copies and detail counts renders both.
- **Provenance**: a price row with `copiedFromScopeId` shows the scope's name.

## 8. Acceptance criteria

- [ ] Each walked scope can carry a list of copy targets of any tier.
- [ ] The form refuses a walked scope as a target and a target used twice, before the request.
- [ ] Writes and details are chosen on the form and sent.
- [ ] The walk list reads no shop scopes and is not cut short.
- [ ] A run's report shows its copies and detail counts.
- [ ] Every price that was copied shows the scope it was read at.

## 9. Verification

```sh
npx nx test luna-shopper-admin/feature-harvest
npx nx test luna-shopper-admin/feature-catalog
npx nx test luna-shopper-admin/ui
npx nx affected -t lint test
```
