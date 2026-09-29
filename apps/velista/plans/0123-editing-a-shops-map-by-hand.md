# 0123: editing a shop's map by hand

> Rewritten on 2026-09-29. The first version was a step counting recorder, which the field
> test ruled out (3.4 m at best, and 20 to 45 m with snapping). Recording with the camera is
> now `0126`, and this plan is the editing that recording also uses.
>
> Mock: `mocks/shop-map/`, published at https://claude.ai/artifact/Q3iEPafsH5G9Aqgvkgqi1f.
> The boards "Holding a square", "Selecting and resizing", "Editing an area without walking"
> and "How the map is drawn", plus "Not saved yet". Day and Night.
>
> Needs `0122` (the walk's history, whose Edit map button this plan wires), backend `0168`
> (appending entries), and the editor's mapper look with its interactions
> (`libs/luna-shopper/shop-map/editor/plans/0001` section 3). Prerequisite reading: backend
> `0168` section 2, `shop-map/plans/0002` sections 1 and 3, and `CLAUDE.md` on sheets.

The user decided that a map can be changed without walking. It is also the same editing
somebody does while walking. There are no edit buttons: a single tap on the floor draws, a
tap on an area selects it, handles resize it, and a long press opens a menu. Sizes are
metres, and snapping to the half metre squares is a switch. Selecting an area opens its
sheet, where it is renamed, its colour chosen, or deleted.

## Brief for the agent

### Objective

Add the editing page of a walk and the pieces that `0126` reuses while walking: the long
press menu, the area sheet with its colours, the snap switch, saving edits as `edited`
entries, and the unsaved warning. Use the `nx-portfolio-angular-developer` skill and
`design-taste-frontend`.

### Context

- **The editor** in the mapper look reports each finished gesture through `onChange` as
  `WalkEvent`s, a tap on an area through `onSelect`, and a long press through
  `onLongPress` with the point in metres and the area under it.
- **Saving**: `POST /v1/catalog/walks/:walkId/entries` with an `edited` entry, idempotent on
  its id, refused with `WALK_CHANGED` when another phone saved first.
- **Decisions of the mock** (all fixed):
  - The bar shows the walk's name, "Not walking" and Done.
  - The long press menu has the point as its header ("This square · 14.5 m across, 8.5 m
    in") and seven actions: Make it a shelf, Draw a counter here, Mark as blocked, Make it a
    path, Add a note here, Change its section, and Erase. An action that does not apply to
    what is under the finger is absent.
  - The area sheet shows the name, the kind and size ("Section · 1.4 m × 11 m"), Rename, the
    checkbox "Use the category colour" (on by default for new areas, disabled with "Not
    available yet: categories have no colours."), and a row of colours with Default first.
  - No warning about a colour close to the walkway: the dotted walkway already stands
    apart.
  - "Snap to the squares" is a switch in the resize controls, off by default.
  - Leaving with unsaved changes asks first ("Not saved yet").

### Target state

1. **The page**, `shops/:locationId/walks/:walkId/edit`, reached from the history's Edit
   map. It mounts the editor in the mapper look on the walk's document with no person and
   no live state.
2. **The long press menu** as a popover anchored at the press, with the actions above.
3. **The area sheet**, `…/edit/sheet/areas/:areaId`: rename, kind, the colour row and the
   disabled category checkbox, and delete with a confirmation.
4. **The resize controls**: the selected area's name and kind, "Drag a corner to resize",
   the snap switch, and Done.
5. **Saving**: edits collect into one `edited` entry, sent on Done, on leaving, when the page
   is hidden, and every 20 s while there are changes. A `WALK_CHANGED` refusal reloads the
   walk and says the map changed on another phone.
6. **The unsaved warning** on leaving the page with an unsent entry, as a guard and a
   `beforeunload`.
7. The editing parts (menu, sheet, controls, the saver) are exported for `0126`.

### Scope

Work in `libs/velista/feature-shop-map`, `libs/velista/data-access` (the entry saver with
its in memory twin), `libs/velista/feature-shell/src/lib/routes.ts` and its spec, the locale
files, and the specs of each.

Do not touch: the backend, the libraries beyond consuming them, recording.

### Constraints

- The route guard of `0122`: nothing here without `shopMap.record`.
- An edit is only ever an appended entry.
- The sheet and back rules of `CLAUDE.md`. No `@angular/core/rxjs-interop`. `svh` only.
  Every string is a key. Popover targets are at least 44 css pixels.
- Only make changes directly requested.

### Action boundaries

Stop and ask before: adding edit buttons to the map, enabling the category colour before
backend backlog `0018` is built, or saving anything but an appended entry.

### Progress evidence

Per target: the files changed and the spec run. At the end: `npx nx test` and `npx nx lint`
for the touched libraries, `npx nx build velista`, and on a phone against a slot serving
backend `0168`: draw a counter, resize it to 2.8 by 1.4 m with snapping off, recolour a
section, delete an area, leave with an unsent change, and see the entries in the history,
in Day and Night.

## 1. Not in this plan

- Recording: `0126`.
- Colours per category: backend backlog `0018`.
