# 0033 Screens that replace psql

> Backend half: `apps/luna-shopper-backend/plans/0160`. Do not start before it is merged,
> because every screen here reads a route it adds.
>
> Backend plan `0150` built a catalog by hand and checked it. Three of its findings were visible
> only with psql, and the operator used a Node script for anything the back office did not
> do. This plan gives those checks a screen: the prices a run wrote, why a price is shown, the
> source products bound to an item, and what a basket row was bought for. It also lets an
> operator write a hand price with a past date and see a proposed unit price.

## Brief for the agent

### Objective

Add a "Prices written" tab to the run screen, an all scopes price view for one item with the
reason each shown price wins, a "Source products" panel on the item screen, settlements on the
basket detail rows, and two fields on the add price form: `observedAt` and a proposed unit
price. Use the `nx-portfolio-angular-developer` skill for the Angular work and
`design-taste-frontend` for the new panels.

### Context

- Sections are `ADMIN_SECTIONS` in `apps/luna-shopper-admin/src/app/sections.ts`, of type
  `AdminSection` (`libs/luna-shopper-admin/feature-resource/src/lib/admin-section.ts`). One list
  builds the routes and the `ResourceRegistry`. A custom screen goes into its feature's
  `routes.ts` with a matching `ShellLink`. HTTP calls live in `libs/luna-shopper-admin/data-access`
  (for example `harvest-api.ts` with its in memory twin `harvest-memory.ts`). Types come from
  `libs/luna-shopper-admin/models/src/lib/wire/wire-types.ts`, generated, never written by hand.
- Run screen: `libs/luna-shopper-admin/feature-harvest/src/lib/run-page.ts`, which polls the
  counters and shows the report and an export (the harvested document, not the rows written).
- Prices: `/catalog/prices` (`feature-catalog/src/lib/prices.ts`), `price-detail-page.ts` (all
  rows of one item at one scope, with a "shown" badge) and `price-form-page.ts` (adds an
  `ADMIN` price and shows the scope notice). `prices.ts:58-64` records why the app does not
  compute a unit price: `price / unitSize` disagrees with the source on 110 of 4,232 products.
- Items: `feature-catalog/src/lib/items.ts` shows no bindings.
- Baskets: `basket-detail-page.ts` is read only and shows `rowKey, content, left, bought, asked`.
- Backend `0160` adds: `item-prices?runId=`, `items/{id}/prices` with `shownBecause` and
  `protectedUntil`, `observedAt` on the add price write, `harvest/items/{itemId}/entries`, and
  settlements on `AdminBasketRowView`.
- Rule D4: the app owns its view models and maps from the wire. The generated wire types are
  the recorded exception (admin plan `0004` section 2).

### Target state

- The run screen has a "Prices written" tab: item, scope, kind, price, unit price,
  `INSERTED` or `CONFIRMED`, paged, filterable by item name. Each row links to the item's price
  view.
- The item's price view lists every scope, with all rows per scope, the shown row marked, a
  plain sentence for `shownBecause`, and `protectedUntil` as a date where it applies. It opens
  from the item screen and from the prices list.
- The item screen has a "Source products" panel: chain, external id, name, EAN, status,
  `matchedBy`, and a warning chip when the EAN is shared by more than one entry of that chain.
- The basket detail shows each row's settlements: outcome, quantity, price paid or "no price",
  shop, and who settled.
- The add price form has an optional `observedAt` (past only, 30 days at most) and a unit price
  field that proposes `price / unitSize` in the item's base unit, marked as a proposal the
  person accepts or edits. Nothing is sent that the person did not see.

### Scope

Work only in:

- `libs/luna-shopper-admin/feature-harvest/src/lib/run-page.ts` and a new tab component
- `libs/luna-shopper-admin/feature-catalog/src/lib/` (items, prices, price detail, price form,
  and a new item prices page)
- `libs/luna-shopper-admin/feature-harvest/src/lib/basket-detail-page.ts`, or wherever the
  basket detail lives
- `libs/luna-shopper-admin/data-access` and its in memory twins
- `libs/luna-shopper-admin/ui/assets/i18n/*.json` for the copy
- `libs/luna-shopper-admin/models/src/lib/wire/wire-types.ts`, only by running
  `npx nx run luna-shopper-admin/models:wire-types`

Do not touch: the backend, the generic resource list and form, or other sections.

### Constraints

- The proposed unit price is a proposal. The form never sends a derived value by itself,
  which keeps `prices.ts:58-64` true.
- Each panel fails on its own: an error in one panel does not blank the screen.
- Only make changes directly requested.

### Action boundaries

Stop and ask before: adding a section, changing `AdminSection`, or adding a dependency.

### Progress evidence

- Specs for each new component with the in memory gateway, including an empty state and an
  error state.
- `npx nx test` and `npx nx lint` pass for every touched admin library, and
  `npx nx build luna-shopper-admin` passes.
- A browser check on a slot with backend `0160`: the four walk 2 Dorada rows show on the run's
  "Prices written" tab, and a settled row shows its price.
