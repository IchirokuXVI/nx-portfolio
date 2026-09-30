> **PR:** [#568](https://github.com/IchirokuXVI/nx-portfolio/pull/568)

# 0121: a shop's page, and the map of the shop you are in

> Rewritten on 2026-09-29 after five rounds of the mock. The first version mounted a grid
> map on the basket with a walk drawn, and nothing of it was built.
>
> Mock: `mocks/shop-map/`, published at https://claude.ai/artifact/Q3iEPafsH5G9Aqgvkgqi1f,
> reviewed by the user. The boards of the group "A shop, and the map every shopper sees" are
> this plan: "Opening the map from the basket", "The shop picker opens a shop", "A shop",
> "The shop map" and "One section", in Day and Night. "The shop map with drawn assets" is
> `0128`, built last, and "The shop map, for somebody who maps" is
> `0122`.
>
> Needs backend `0168` (`hasMap` and the map read), `0176` (the shop's size), `0170`
> (section names on a shop view, built), `libs/luna-shopper/shop-map/editor/plans/0001`
> (the shopper look) and `shop-map/plans/0002` (`shopperView`, which backend `0168` serves
inside `ShopMapView`). Prerequisite reading: `0124`
> (the shop picker and its row), `0102` (Buying at), `0120` (the basket grouped by the
> shop's sections), the editor plan's sections 1 and 2, and `CLAUDE.md` on sheets and going
> back.

Two ways lead to a shop's map. From the basket, when it is bought at one shop that has a
map, a Map button in the basket's head opens it. From the shop picker, a small round
button on each shop row opens that shop's own page: its name, chain, address, size when
OpenStreetMap knows it, its sections in the order you walk them, and "See the map".

The map is the friendly one: no grid, a dotted walkway, every area bordered and rounded,
and a count on each section that still holds something on your list, green with a tick
when you got everything there.

## Brief for the agent

### Objective

Add a shop page reached from a new button on every shop picker row, a map page for a shop
that mounts the shared editor in the shopper look with the basket's counts as badges, a
section sheet over it, and a Map button on the basket when it is bought at one shop with a
map. Use the `nx-portfolio-angular-developer` skill and `design-taste-frontend`.

### Context

- **The picker row** (`libs/velista/ui/src/lib/shops/shop-list.html`, pick mode): a
  `.pick` wrapper holding the `<label class="row pick-row">` with the radio at the right,
  and the section chips as the label's sibling so a tap on them never picks the shop. The
  picker has four hosts (`0124`), and all four get the button.
- **The basket at a shop** (`0102`, `0120`): `BasketViewState.shop`, lines with
  `sectionIds`, grouped by the shop's sections in order.
- **The reads**: `GET /v1/catalog/locations/:id` (`hasMap`, `footprintM2`, the address, the
  chain), `GET /v1/catalog/locations/:id/sections` (the shop's sections in order), and
  `GET /v1/catalog/locations/:id/map` (no account).
- **The viewer**: `mountShopMap(host, { look: 'shopper', onSection })`, `setBadges`,
  `setSelected`. Velista wraps it in a component of its own under the adapter rule of the
  editor plan, and sets the `--shop-map-*` properties from its tokens on the host.
- **Decisions of the mock** (all fixed):
  - The title is "Where things are" with "<chain> · <address>" under it.
  - Chips "My list · N" and "All sections". On My list, sections without a line are dimmed.
  - A badge counts the unsettled lines of that section, and turns green with a tick and the
    settled count when every line there is settled.
  - A legend line shows the badge, the done badge and the walkway.
  - "Tap a section to see what you need there." A tap opens the section sheet with the
    section's lines and any note on the map for it.
  - The shop page shows the size as "About 1,200 m²" with "Building size from
    OpenStreetMap" under it, rounded to the nearest 100, and omits the row when the size is
    unknown. It omits "See the map" when the shop has no map.

### Target state

1. **The row button.** Each pick row gets a round 36 px button with an info icon between
   the text and the radio, labelled "About <shop>". It is the label's sibling, so pressing
   it never picks the shop. It opens `shops/:locationId`.
2. **The shop page**, `shops/:locationId`: the page head with the shop's own name and its
   chain, the address, the size row, "See the map", and "Sections · in the order you walk
   them" as a numbered list. A shop with no sections shows none of that list.
3. **The map page**, `shops/:locationId/map`: the head and chips of the mock, the viewer
   filling the rest at `svh`, fitted on open, the legend and the hint. Opened from the
   basket, it takes counts from that basket. Opened from the shop page with no basket at
   that shop, "My list" is absent and every section shows without a badge.
4. **The section sheet**, `shops/:locationId/map/sheet/sections/:sectionId`: the section's
   name, "<position> · N things still to get", its lines with the settle circle and the
   quantity, and the note card when the map has a note for it.
5. **The basket's Map button**, in the head of "Everything to buy" when the basket is at one
   shop and `hasMap` is true. Each basket row names its section under the product, as the
   mock shows.
6. **Offline.** The map read is cached with the basket read for as long as the shop choice
   lives (`0102`), so the page opens in a shop with poor signal.

### Scope

Work in a new `libs/velista/feature-shop-map` (the shop page, the map page, the section
sheet, the viewer wrapper), `libs/velista/ui/src/lib/shops/` (the row button),
`libs/velista/feature-shopping-lists` (the Map button and the section under each row),
`libs/velista/data-access` (a `ShopStore` for the location and sections reads and a
`ShopMapStore` for the map, each with an in memory twin), `libs/velista/models`,
`libs/velista/feature-shell/src/lib/routes.ts` and its spec, the locale files, and the
specs of each.

Do not touch: the editor library beyond consuming it, the backend, the picker's other
behaviour, the aisle grouping of `0120`.

### Constraints

- Rule D4: the map comes off the wire through a mapper into velista's own model, refused
  when `validateShopMapV2` finds problems.
- Tokens on the host element, never colours in the library. Day and Night are both checked
  in the browser.
- The sheet rule: the section sheet is declared with `sheet()` and left with
  `SheetNavigation.dismiss(fallbackUrl)`. Pages go back with `PageNavigation.back`.
- No `@angular/core/rxjs-interop`. `svh` only. Every string is a key.
- Only make changes directly requested.

### Action boundaries

Stop and ask before: drawing the drawn assets of `0128`, drawing the map inside the basket page,
fetching a map for a shop the person did not open, or creating the Angular adapter library.

### Progress evidence

Per target: the files changed and the spec run. At the end: `npx nx test` and `npx nx lint`
for the touched libraries, `npx nx build velista`, and a walk on a phone at a slot serving
backend `0168` with the El Jamón fixture walk shown on one shop, from the picker and from
the basket, in Day and Night, with screenshots beside the mock's boards.

## 1. Not in this plan

- The Walks button and everything behind it: `0122`.
- Editing and recording: `0123` and `0126`.
- Where you are standing on the map: backlog `0001`.
- Drawn assets for shelves, counters, tills and the door: `0128`.
