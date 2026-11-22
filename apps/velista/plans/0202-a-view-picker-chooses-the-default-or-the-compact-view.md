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
> **Blocked until the owner approves a mock**: `apps/velista/plans/mocks/compact-reel/`, the
> mock the owner asked for to judge the reel before it is restored. This plan's frames are in
> section 1.
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
> `libs/velista/ui/src/lib/list/anchored-popover.ts`.

## Brief for the agent

### Objective

Swap what the two row layouts mean, so the default is the row of velista `0191` and the
compact view is the two line row, and replace the account page switch with a view picker on
the zone list page and the basket page that writes the one device setting.

### Context

- `ListRowsStore` is provided by the app layer and read by the list page; the basket page
  and the product page can inject it the same way.
- `LineRow` draws the `0191` row when `layout` is `'compact'` and the two line row
  otherwise.

### Target state

1. **The meaning.** `ListRowLayout` stays `'default' | 'compact'`. `'default'` draws the row
   of velista `0191`; `'compact'` draws the two line row. `DEFAULT_LIST_ROW_LAYOUT` is
   `'default'`. The names in `line-row` follow (`compact()` is true for the two line row).
2. **The record.** The store writes `{ version: 2, layout }`. A record of another version,
   or one it cannot read, is the default view.
3. **The picker.** An icon button in the header of the zone list page (beside the filter)
   and of the basket page, its icon and place from the mock, its accessible name "View".
   It opens an `AnchoredPopover` with two `menuitemradio` choices, each an icon and a line
   of text from the mock ("Default", "Compact: more rows on the screen"), the current one
   checked. Choosing writes the store and closes the popover; focus returns to the button.
   Keys in `en` and `es`.
4. **The account page** has no switch for the rows, and its keys go.
5. Every place that draws a zone list row reads the store, as today. The due rows and the
   product page's table follow it in velista `0203`.

### Scope

- Work in `models`, `data-access` (the store), `ui` (the row's branch names, the picker
  component, its icons), `feature-lists` and `feature-shopping-lists` (the headers),
  `feature-account` (the switch goes), the i18n files.
- Do NOT restore the reel here (velista `0203`). Until it lands, the compact view draws the
  two line row with the button stepper.

### Constraints

- Angular conventions of CLAUDE.md; rule D5 for the store; rule T1, the hygiene and contrast
  specs.
- No dashes as punctuation in copy or comments.

### Action boundaries

- Stop if the mock is not approved.
- Stop and ask if the basket page header has no room for the button at 360 px wide.

### Progress evidence

The specs of section 2; `npx nx affected -t lint test`; `npx nx build velista`; a walk on a
slot: choose Compact on the zone list, see the basket page's picker checked on Compact, and
the reverse.

## 1. Frames the mock must have

1. The zone list header with the picker button, and the picker open.
2. The basket page header with the picker button.
3. The zone list in each view (the compact one with the reel, which is velista `0203`'s).

## 2. Specs

1. A store with no record reads `'default'`; a version 1 record reads `'default'`; a
   version 2 record reads its layout.
2. `LineRow` draws the three facts in `'default'` and the two lines in `'compact'`.
3. The picker checks the current view, writes the store on a choice, and closes.
4. The account page draws no rows switch.

## 3. Acceptance criteria

- The default view is the row of velista `0191`.
- One choice, from either page, sets the view everywhere.

## Not in this plan

- The reel (velista `0203`, `0204`).
