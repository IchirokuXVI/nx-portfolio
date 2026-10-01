# 0129: the shop map after the first phone walk

> Asked for on 2026-10-01, after the owner used the shop map series (velista `0121` to
> `0128`) on a phone for the first time. Nine changes, all small, and all in the screens
> that series built. One plan, because they share the canvas and three pages.
>
> Prerequisite reading: `libs/luna-shopper/shop-map/editor/src/lib/mount.ts` (every
> gesture of the canvas: `hitTest`, `onDown`, `onMove`, `tap`, `startPinch`),
> `libs/velista/feature-shop-map/src/lib/shop-map-view/shop-map-view.ts` (the Angular
> adapter), `shop-page/`, `shop-map-page/`, `walks/`, `edit/edit-map-page.ts`,
> `record/record-walk-page.ts`, `record/walk-recording.ts`,
> `libs/velista/data-access/src/lib/shops/walk-entry-saver.ts`, and the route block that
> starts at `shops/:locationId/walks/settings` in
> `libs/velista/feature-shell/src/lib/routes.ts`. Velista `0121`, `0122`, `0123` and
> `0126` state the rules these screens were built to.

## Brief for the agent

### Objective

Make the shop map usable with one thumb on a phone: the map opens from every shop, a tap
opens anything on the shopper map, two fingers move the mapper's map without zooming it,
a mark can be changed or deleted, a walk has one page instead of two, and a visit that
changes nothing leaves no history entry.

Use the `nx-portfolio-angular-developer` skill for the Angular work and
`design-taste-frontend` for the merged walk page and the two new sheets.

### Context

What the code does today, read on 2026-10-01. Verify each before you change it.

- **"See the map" is hidden without a shown walk.** `shop-page.html` draws the button
  inside `@if (shop.hasMap)`. `hasMap` is "the shop has a walk shown to shoppers"
  (`catalog.mappers.ts`, `toSupermarketLocationView`). A shown walk is also what writes
  the shop's sections, which is why the button seemed to depend on sections. The map page
  already has a `none` state ("This shop has no map yet") and draws the Walks button for
  an account with `shopMap.record`, so the page works for a shop with no map.
- **A two finger gesture always zooms.** `startPinch` stores the finger distance, and
  `onMove` sets the scale to `view.s * distance / startDistance` on every move. Two
  fingers that drag together never keep exactly the same distance, so the map zooms in
  and out while it moves. In the mapper look one finger draws, so two fingers are the
  only way to move the map.
- **Marks are not tappable.** The canvas draws one pin per mark (`drawMarkPin`: a round
  pin with an arrow for a section or counter mark, a square for a note) and `hitTest`
  knows only handles, areas, suggestions and the floor. `ShopMapView.markAt` finds a pin
  by measuring the DOM, and only the "where are you?" step of the record page uses it.
  The log already has `mark-put` and `mark-removed` events.
- **The shopper map opens only areas that name a section.** `tap` calls `onSection` only
  when `target.area.section !== undefined`. A checkout, an entrance and a counter with no
  section report nothing, and a note is not an area at all, so it is never hit.
- **A quick tap on the shopper map opens nothing, a long touch does.** Not reproduced
  yet. The most likely cause: the canvas reports the tap on `pointerup`, the section
  sheet opens, and the `click` the browser sends after a quick tap lands on the sheet's
  scrim, which is a button that dismisses on `click` (`sheet-shell.html`). After a long
  touch Android sends no `click`, so the sheet stays. The phone's vibration on the press
  is Android's own long press feedback.
- **A walk has two pages.** `walks/:walkId` is the history (Rewind, Edit map, Resume
  walking, the entries). `walks/:walkId/settings` holds the name, "Show this walk to
  shoppers" and Delete, with the delete sheet as its child.
- **A visit with no change still writes entries.** `WalkRecording.flush` calls
  `add(events, logTo)`, and `WalkEntrySaver.add` opens an entry when `logTo` is given
  even with no events. `stopWalk` always pushes a `stopped` entry. So a resume that is
  stopped at once writes `resumed` and `stopped`. The area sheet applies an `area-put`
  when it is saved with nothing changed, which writes an `edited` entry.

### Target state

1. **The map opens from every shop.** Remove the `hasMap` condition around "See the map"
   on the shop page. A shop with no shown walk opens the map page in its `none` state.
   The basket's Map button keeps its `hasMap` condition: it promises a map of where the
   lines are, and a shop with no map has none.

2. **Two fingers move the map, and zoom only on a pinch.** In every look, a two finger
   gesture starts as a move: the map follows the point between the fingers and the scale
   does not change. It becomes a zoom only after the distance between the fingers has
   changed by more than a dead zone from where the gesture started (start with the larger
   of 12 percent and 24 css pixels, and tune it on a phone). From that moment the scale
   follows the fingers, measured from the distance at the moment the dead zone was left,
   so the map does not jump. A zoom keeps moving with the fingers and stays a zoom until
   both fingers lift. The decision is a pure function beside `viewport.ts`, with its own
   spec. The mouse wheel and the double tap are unchanged.

3. **A mark opens on a tap, and can be changed or deleted.** In the mapper look the
   canvas hit tests the pins first, before handles and areas, with a reach of about 22
   css pixels at the scale the pin is drawn, and reports `onMark(mark)`. `ShopMapView`
   emits `markTapped`. The edit page and the record page open a mark sheet as a child
   route, `sheet({ path: 'marks/:markId' })`, declared beside `areas/:areaId` on both
   pages. The sheet shows the kind and the text, saves a changed text as a `mark-put`
   with the same id, position, heading and `logMs`, and has Delete, which sends
   `mark-removed`. An empty text is refused in the sheet (`MARK_UNNAMED`). Reuse the
   fields of `record/mark-sheet` where they fit. Delete `ShopMapView.markAt` and make the
   "where are you?" step use `markTapped`.

4. **The shopper map has no "Walkway" legend.** Remove the swatch and its label from
   `shop-map-page.html`, the `shopMap.legendWalkway` key in both locales, and the styles
   and host bindings that only the swatch used. Keep whatever the canvas itself reads.

5. **A tap opens an area, and moving the map opens nothing.** Reproduce the quick tap
   failure first, with touch emulation and on a phone, and fix the cause you find. If it
   is the trailing `click`, the fix belongs in how the tap is reported (for example from
   the `click` event, or by the canvas consuming that click), not in a delay. Then
   assert, in the editor's spec: a press released within the slop reports one tap however
   long it was held, a drag past the slop reports none, a two finger gesture reports
   none, and a second finger that lands during a press cancels it.

6. **Everything on the shopper map opens.** In the shopper looks the canvas reports
   `onArea(area)` for any area that is not `path` or `blocked`, and `onNote(note)` for a
   note, hit tested like a pin and before the areas. The map page decides what opens:
   - an area whose section resolves (`shopMapSectionNamed`): the section sheet, as now.
   - any other area (checkout, entrance, a counter or shelf with no known section): a
     new place sheet, `sheet({ path: 'areas/:areaId' })`, with the area's label or the
     word for its kind, and nothing else it cannot fill.
   - a note: the same place sheet at `sheet({ path: 'notes/:noteId' })`, showing the
     note's text.

   Both read the map the page already opened. `shopMap.hint` and `shopMap.hintAll` stay
   true: rewrite them only if a word in them is now wrong.

7. **The Walks page has less text.** Remove the paragraph `shopWalks.list.intro` and the
   foot note `shopWalks.list.startNote`, with their keys in both locales and their styles.

8. **One page per walk.** `walks/:walkId` holds everything, in this order: the name
   field, "Show this walk to shoppers" with its hint, Rewind, Edit map and Resume
   walking, the history, and Delete this walk at the foot. The name still saves on blur,
   on Go and when the page goes away, and the live region still reports each write.
   - The delete sheet becomes a child of `walks/:walkId`, beside the resume warning.
   - `walks/:walkId/settings` redirects to `walks/:walkId`. `walks/settings` (the
     settings for every walk) is another page and stays.
   - Delete `WalkSettingsPage`, the `'settings'` page of `shopWalkPath`, the ellipsis
     button on the history header and the ellipsis button on each row of the walks list.
     A row opens the walk.
   - After a delete, the sheet leaves to the walks list, as it does today.

9. **No change, no history entry.**
   - **Recording.** A session that added no path point, no mark and no edit sends no
     entry at all: no `started` or `resumed`, no `continued` and no `stopped`. A `stopped`
     entry goes out only when the entry that opened its session went out or is queued.
     `WalkEntrySaver.add` with no events and a `logTo` that does not pass the open
     entry's own opens nothing.
   - **Editing.** An event that leaves the document as it was is dropped before it
     reaches the saver: an `area-put` equal to the stored area, a `mark-put` equal to the
     stored mark. The area sheet and the new mark sheet do not send one when nothing
     changed.
   - **Rewind.** "Continue from here" is disabled while the slider stands at the end of
     the log.
   - Entries already stored are not cleaned up.

### Scope

Work in `libs/luna-shopper/shop-map/editor` (the gestures, the hit tests, the new
callbacks, `README` if it lists them), `libs/velista/feature-shop-map/**`,
`libs/velista/data-access/src/lib/shops/walk-entry-saver.ts` and its spec,
`libs/velista/platform/src/lib/shop-paths.ts`, the shop routes in
`libs/velista/feature-shell/src/lib/routes.ts` with `routes.spec.ts`, and
`libs/velista/ui/assets/i18n/{en,es}.json`.

Do not touch: the backend and the OpenAPI document, the walk log's event kinds, the
basket's Map button, the mapping settings page, the walk lab, the drawn look of `0128`.

### Constraints

- New sheets are child routes made with `sheet()` and opened with `sheetSegments()`.
  Never write the `sheet` segment by hand, and no page takes a `sheet` segment.
- Every back control names a fallback: `PageNavigation.back(url)` and
  `SheetNavigation.dismiss(url)`. No bare `.back()`.
- No `@angular/core/rxjs-interop` in anything new. `svh` only. `Intl`, not `DatePipe`.
  Every string is a key, in English and Spanish.
- The editor library stays framework free: no Angular and no velista import.
- Icons come from `libs/shared/ui` or `@portfolio/velista/ui`. No inline `<svg>` in a
  page.
- Only make changes directly requested.

### Action boundaries

Stop and ask before: changing a backend route or a contract schema, adding a walk event
kind, changing what `hasMap` means, removing the double tap zoom, or deleting stored
history entries. If the quick tap failure of target 5 has a cause outside the scope
above (the sheet shell, the router), say what it is and ask before you change shared
code.

### Progress evidence

Per target: the files changed and the spec run. At the end: `npx nx test` and
`npx nx lint` for `luna-shopper-shop-map-editor`, `velista-feature-shop-map`,
`velista-data-access`, `velista-platform` and `velista-feature-shell` (read the real
project names from `nx show projects`), `npx nx build velista`, and the `velista-e2e`
suite on a slot. Then, in a browser with touch emulation on a slot, a screenshot or a
short note for each: the map opened from a shop with no walk, a two finger drag that
does not zoom, a mark changed and a mark deleted, a tap on a section, a checkout, an
entrance and a note, the merged walk page, and a resume stopped at once that leaves the
history as it was. The two finger gesture and the quick tap need a real phone: say
plainly that the owner walks those two.

## Decisions taken in this plan

Each is cheap to change. Say so in review if one is wrong.

- The basket's Map button stays hidden for a shop with no map (target 1).
- The two finger rule applies to the shopper map too, where one finger already moves it,
  so the canvas has one rule (target 2).
- A mark's sheet changes the text and deletes. It does not move the mark or turn its
  arrow (target 3).
- An area with no known section and a note open one small sheet with a name or a text,
  not the section sheet with empty parts (target 6).
- The old `settings` URL of a walk redirects instead of ending on the not found page
  (target 8).
- "No change" is decided on the phone. The server still stores any entry it is sent
  (target 9).
