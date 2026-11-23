> **PR:** [#1084](https://github.com/IchirokuXVI/nx-portfolio/pull/1084)

# 0202: a view picker chooses the default or the compact view

> Decided on 2026-11-22. Velista `0191` added a second way to draw a zone list row, chosen
> by a switch on the account page and kept on the device: "default" is the two line row,
> "compact" the row with three lines of facts. The owner turns it around:
>
> - The row of velista `0191` (three lines of facts and the button stepper) becomes the
>   **default view**.
> - The **compact view** is the two line row, with the reel of velista `0203` in place of the
>   button stepper. It shows more rows on a screen. The reel was liked by some people and is
>   far narrower than the stepper.
> - The switch on the account page goes. An icon on the zone list page and on the basket
>   page opens a small popover with the two views, each a line of text with an icon.
>   Choosing one in either place changes both, and the product page follows it. If people
>   want a choice per page later, that is another plan.
>
> No version with the old setting has reached production, so nobody's stored choice needs
> care: a stored record of version 1 is read as the default view.
>
> Amended on 2026-11-22 after the owner approved the mock: icon set B (rows with a picture)
> for the header button and the two choices; on the zone list the button sits in the header
> before the filter; on the basket page the picker is offered in the tools row beside the
> filter and as a "View" row in the basket's menu, with no fourth header action; the words
> are final; and **the filter icon becomes a funnel** on the zone list header and on the
> basket's tools row, so it is not confused with the view button.
>
> **The mock is approved**: `apps/velista/plans/mocks/compact-reel/`, published at
> https://claude.ai/artifact/U74Z1MyvcxEK6PN3CRn8N6. Take every look and word from its boards
> (section 1 lists them) and the notes in its `canvas.json`.
>
> Linked plans: velista `0203` (the reel in the compact view). **Release `0202` and `0203`
> together**: without `0203` the compact view is the two line row with the wide button
> stepper, which is not compact and is not what the owner chose. Velista `0204` (the reel in
> the basket row sheet) builds on both. Velista `0196`, `0197`, `0198` and `0199` apply to
> both views and need no change from this plan.
>
> Code anchors, on `dev` at `e06813139`: `libs/velista/models/src/lib/list-view.ts:190`
> (`DEFAULT_LIST_ROW_LAYOUT`, `ListRowLayout`); `libs/velista/data-access/src/lib/lists/list-rows-store.ts`
> (the device setting, `{ version: 1, layout }` under `StorageKeys.listRows`);
> `libs/velista/platform/src/lib/storage-keys.ts:190` to `:197`;
> `libs/velista/feature-account/src/lib/account-page/account-page.html:100` to `:110` (the
> switch) and `account-page.ts:136`; `libs/velista/ui/src/lib/list/line-row.html:31` (the
> `@if (compact())` branch: the row of `0191`) and its `@else` (the two line row);
> `libs/velista/ui/src/lib/list/line-row.ts:121` (`compact`);
> `libs/velista/feature-lists/src/lib/list-page/list-page.html:38` (the filter icon of the
> header) and `:348`, `:435`, `:478`, `:494` (`[layout]`);
> `libs/velista/feature-shopping-lists/src/lib/basket-page/` (the basket page header);
> `libs/velista/ui/src/lib/list/anchored-popover.ts`. On `dev` at `3f26ae3d3`:
> `libs/velista/ui/src/lib/icons/icons.ts:110` to `:122` (`FilterIcon` and its doc comment);
> `libs/velista/ui/src/lib/list/list-tools.html:9` (the `listToolsTrail` slot before the
> filter) and `:27` (the filter glyph of the basket's tools row);
> `libs/velista/feature-shopping-lists/src/lib/basket-page/basket-page.html:97` (the tools
> row); `libs/velista/feature-shopping-lists/src/lib/basket-menu.ts:74` to `:84`
> (`BasketMenuEntry`, `basketMenuEntries`) and `more-sheet/` (the basket's menu).

## Brief for the agent

### Objective

Swap what the two row layouts mean, so the default is the row of velista `0191` and the
compact view is the two line row; replace the account page switch with a view picker on
the zone list page and the basket page that writes the one device setting; and draw the
filter button as a funnel.

### Context

- `ListRowsStore` is provided by the app layer and read by the list page; the basket page
  and the product page can inject it the same way.
- `LineRow` draws the `0191` row when `layout` is `'compact'` and the two line row
  otherwise.
- `FilterIcon` (sliders) is the filter glyph of the zone list header and of the basket's
  tools row (`list-tools`). Its doc comment says the sliders were chosen over a funnel on
  purpose. The owner overruled that; the icon can change again later.

### Target state

1. **The meaning.** `ListRowLayout` stays `'default' | 'compact'`. `'default'` draws the row
   of velista `0191`; `'compact'` draws the two line row. `DEFAULT_LIST_ROW_LAYOUT` is
   `'default'`. The names in `line-row` follow (`compact()` is true for the two line row).
2. **The record.** The store writes `{ version: 2, layout }`. A record of another version,
   or one it cannot read, is the default view.
3. **The icons.** Icon set B of the mock (rows with a picture), as three new icons in
   `libs/velista/ui/src/lib/icons/icons.ts`, each built with `inlineSvg()` from an `.svg`
   beside it, at the header's 1.8 stroke and round joins: the header button's glyph (two
   rows with their pictures, the board's "2"), the Default glyph (one picture with three
   lines) and the Compact glyph (three small rows). Names are the builder's, for example
   `ViewIcon`, `DefaultViewIcon`, `CompactViewIcon`.
4. **The picker.** An icon button with the header glyph, its accessible name "View" /
   "Vista", in the secondary text colour like the filter beside it. It opens an
   `AnchoredPopover` in its choice frame (276 px), under the button and aligned to its end,
   with two `menuitemradio` rows, each an icon and its words:
   - "Default" / "Normal";
   - "Compact" / "Compacta", with "More rows on the screen" / "Más filas en la pantalla" on
     a second line under it.
   The current row carries the tick in the quiet amber and the heavier weight, the only
   accent. Choosing writes the store and closes the popover; focus returns to the control
   that opened it. Keys in `en` and `es`.
5. **Where the picker is.**
   - **The zone list page**: the button is the first header action, before the filter.
   - **The basket page**: in two places, and no fourth header action. A button in the tools
     row beside the filter (the `listToolsTrail` slot of `list-tools`), the same pair as on
     the zone list; the popover opens under it. And a "View" / "Vista" row in the basket's
     menu, its first row, with the current view's name at its right ("Default" /
     "Normal"); it opens the same choices. The header keeps its three actions. This settles
     the old question of room in the basket page header at 360 px.
6. **The funnel.** A new outline funnel icon in `icons.ts`, at the same stroke, replaces the
   sliders glyph of the filter button in the zone list header and in the basket's tools row
   (`list-tools`). `FilterIcon` draws the funnel, or a new icon replaces it at both places;
   either way no sliders glyph remains on a filter button. An active filter shows as today:
   the glyph in the quiet amber and the count badge over its corner. The doc comment on
   `FilterIcon` that says the sliders were chosen over a funnel on purpose is removed, and
   the new comment says the owner chose the funnel on 2026-11-22 so it is not confused with
   the view button. The owner judges the badge's distance from the narrow funnel on a
   device after the build.
7. **The account page** has no switch for the rows, and its keys go.
8. Every place that draws a zone list row reads the store, as today. The due rows and the
   product page's table follow it in velista `0203`.

### Scope

- Work in `models`, `data-access` (the store), `ui` (the row's branch names, the picker
  component, its icons, the funnel, `list-tools`), `feature-lists` and
  `feature-shopping-lists` (the headers, the tools row, the basket's menu),
  `feature-account` (the switch goes), the i18n files.
- Do NOT restore the reel here (velista `0203`). Until it lands, the compact view draws the
  two line row with the button stepper.

### Constraints

- Angular conventions of CLAUDE.md; rule D5 for the store; rule T1, the hygiene and contrast
  specs.
- The velista icon rule of CLAUDE.md: each icon a component in `icons.ts`, no raw `<svg>` in
  a feature or ui component.
- No dashes as punctuation in copy or comments.

### Action boundaries

- Stop and ask if the mock shows something on a header, the tools row or the menu that this
  plan does not list.

### Progress evidence

The specs of section 2; `npx nx affected -t lint test`; `npx nx build velista`; a walk on a
slot at 390 by 844 and 360 by 800, Day and Night: choose Compact on the zone list, see the
basket page's picker checked on Compact and its menu row reading "Compact", choose Default
from the menu and see the zone list follow; turn a filter on and see the amber funnel with
its badge.

## 1. The mock's boards

The boards of `apps/velista/plans/mocks/compact-reel/` for this plan:

1. `Picker.dc.html`: the zone list header with the view button before the filter, closed and
   open, Day in Spanish and Night in English.
2. `Icons.dc.html`: the view button, final, the two choice glyphs, and the filter before and
   after it becomes a funnel, with one and two filters on.
3. `Basket.dc.html` and `BasketNight.dc.html`: the basket page at 390 and 360, the picker
   open from the tools row, and the basket's menu open with its "Vista" row.
4. `Default.dc.html` and `Compact.dc.html`: the zone list in each view (the compact one with
   the reel, which is velista `0203`'s).

## 2. Specs

1. A store with no record reads `'default'`; a version 1 record reads `'default'`; a
   version 2 record reads its layout.
2. `LineRow` draws the three facts in `'default'` and the two lines in `'compact'`.
3. The picker checks the current view, writes the store on a choice, and closes.
4. The zone list header draws the view button before the filter.
5. The basket page draws the view button in the tools row beside the filter, its header has
   three actions, and its menu has a "View" row that names the current view.
6. The filter buttons of the zone list header and of the basket's tools row draw the
   funnel; with a filter on, the glyph has the active class and the badge shows the count.
7. The account page draws no rows switch.

## 3. Acceptance criteria

- The default view is the row of velista `0191`.
- One choice, from either page or the basket's menu, sets the view everywhere.
- No filter button draws the sliders.

## Not in this plan

- The reel (velista `0203`, `0204`).
