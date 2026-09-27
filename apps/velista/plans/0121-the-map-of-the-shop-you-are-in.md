# 0121: the map of the shop you are in

> **Mock first.** There is no mock for this plan yet. The session that builds it draws
> `mocks/shop-map/` first (the Map control on the basket at a shop, the map page with the
> aisles that still hold something lit and the walk drawn, the empty state when the shop
> has no map, and Night as well as Day because the map is the one screen where colour
> carries meaning), and stops for the user's review before any code. `0122` and `0123`
> add their artboards to the same folder.
>
> Needs `0120` (the basket grouped by the shop's aisles), backend `0168` (the current map
> read) and `libs/luna-shopper/shop-map/editor/plans/0001` (the viewer). Prerequisite
> reading: the editor plan's sections 1 and 2 (the mount API, `setHighlight`, the Angular
> adapter rule), `0102` (Buying at), `0097` (the bar), and CLAUDE.md on going back.

A shopper with "Buying at" set and a basket grouped by the shop's aisles can now see the
shop. The map page draws the current map, lights the sections that still hold unsettled
rows, draws the walk from the entrance to the checkout, and a tap on an aisle jumps the
basket to that section. A shop without a map offers to draw one (`0122`).

## Brief for the agent

### Objective

Add a Map control to the basket at a shop and a map page that mounts the shared viewer with
the basket's remaining sections highlighted and the walk drawn. Use the
`nx-portfolio-angular-developer` skill and `design-taste-frontend` for the page and the
empty state.

### Context

- **The basket at a shop** (`0102`, `0120`): `BasketViewState.shop`, products with
  `sectionIds`, the view grouped by aisle in the shop's order.
- **The viewer**: `mountShopMap(host, { mode: 'view', labelOf, onSelect })` and
  `setHighlight({ sectionAnchorIds, route })` from `@portfolio/luna-shopper/shop-map/editor`.
  It renders inline SVG coloured through CSS custom properties, so velista sets its tokens on
  the host element. Velista wraps it in a component of its own, per the adapter rule in that
  plan, and admin `0038` does the same. Whichever of the two hits the rule's limit creates
  the adapter library and says so.
- **The reads**: `GET /v1/catalog/locations/:id/map` (no account) answers the current
  `ShopMapView`. `walkOrder` from the model library answers the route and the section
  anchors on the client, so no extra route is needed for highlighting.
- **Pages**: `PageNavigation.back(fallbackUrl)`, the locale guard on the parent, and the
  rule that a page's URL is unique.

### Target state

1. **The control.** With a shop chosen and a current map, the basket page's head shows a
   Map control beside the aisle grouping. Without a map it shows "No map yet" and, for an
   account, "Draw it" (`0122`). A guest sees the map and not the offer.
2. **The page**, `shops/:locationId/map`, with the app's page head, the shop's name and
   chain as the title, and the viewer filling the rest at `svh`. On open it fits the map.
   The sections holding unsettled rows are lit, the walk is drawn, and a legend line says
   "N aisles left". As rows settle, the highlight follows.
3. **Tap to jump.** Tapping a lit section returns to the basket scrolled to that section's
   heading, through `PageNavigation.back` when the basket is the entry below, else a
   navigation to the basket with a fragment.
4. **Sharing.** A guest on a shared basket at a shop reaches the same page, because the
   map read takes no account.
5. **Offline.** The current map of the chosen shop is cached with the basket read for the
   two hours the shop choice lives (`0102`), so the page opens in a shop with poor signal.

### Scope

Work in `libs/velista/feature-shopping-lists` (the control, a new map page, a `ShopMapView`
wrapper component), `libs/velista/data-access` (a `ShopMapStore` reading and caching the
current map, with an in memory twin), `libs/velista/models` for the map's client model if
one is needed beyond the document, `libs/velista/feature-shell/src/lib/routes.ts` and its
spec, the locale files, and the specs of each.

Do not touch: the editor library beyond consuming it, the backend, the aisle grouping of
`0120`.

### Constraints

- Rule D4 applies to the wrapper's inputs: the document comes off the wire through a mapper
  that validates it with `validateShopMap` and refuses a document with problems.
- Tokens on the host element, never colours inside the library. Night is checked in the
  mock and in the browser.
- No `@angular/core/rxjs-interop`. `svh` only. Every string is a key.
- Only make changes directly requested.

### Action boundaries

Stop and ask before: creating the Angular adapter library, drawing the map inside the
basket page instead of a page of its own, adding any editing, or fetching the map for a
shop the person has not chosen.

### Progress evidence

The mock, then the user's review. Then per target: the files changed and the spec run. At
the end: `npx nx test` and `npx nx lint` for the touched libraries, `npx nx build velista`,
and a walk on a phone at a slot serving backend `0168` with the supermarket fixture
accepted on one shop, in Day and Night.

## 1. Not in this plan

- Drawing or recording: `0122` and `0123`.
- Where the person stands: backlog `0001`.
- A map on the zone list, which has no shop.
