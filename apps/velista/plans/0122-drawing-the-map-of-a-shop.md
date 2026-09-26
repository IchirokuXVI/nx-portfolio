# 0122: drawing the map of a shop

> **Mock first.** The session that builds it adds to `mocks/shop-map/` the editor page at a
> phone width (the canvas, the tool strip, the section and product pickers as sheets, the
> submit review) and stops for the user's review before any code. The tool strip is the
> hardest screen in the series to get right on a phone, and the mock is walked on one.
>
> Needs `0121` (the map page and the wrapper), `libs/luna-shopper/shop-map/editor/plans/0001`
> (edit mode), `0119` (the category picker, whose pages the section picker reuses) and
> backend `0168` (submission and the outline). Prerequisite reading: the editor plan's
> sections 1, 3 and 4, backend `0168` sections 3 and 4, and the sheets rule in CLAUDE.md.

The user decided that maps are drawn in velista, on the phone, in the shop. This plan is the
page that does it: the shared editor in edit mode, a tool strip drawn by velista, pickers for
a section and a product drawn as sheets over the page, a draft kept on the device, and a
submission that lands in the queue of admin `0038`. Recording a walk (`0123`) starts here
and ends here.

## Brief for the agent

### Objective

Add an editor page for a shop that mounts the shared editor in edit mode, draws the tool
strip and the pickers, starts from the shop's building outline or its current map, keeps a
draft on the device, and submits the document. Use the `nx-portfolio-angular-developer`
skill and `design-taste-frontend` for the tool strip and the pickers.

### Context

- **The editor**: `mountShopMap(host, { mode: 'edit', pickSection, pickProduct, editNote,
  onChange, onProblems, ... })` and `setTool`. It draws no controls, so the tool strip, the
  undo buttons and every picker are this plan's.
- **The category picker** of `0119` has a parents page and a children page. The section
  picker here is a sheet that lists the chain's sections (backend `0167`) when the chain
  has any, and otherwise, or on "something else", the app's categories in the same two
  levels. Picking a category writes `categoryId` on the anchor, and acceptance creates the
  section (backend `0168` section 3).
- **The product picker** is the typeahead card of `0101` inside a sheet, searching the
  catalog, writing `itemId`.
- **The reads and writes** (backend `0168`): the outline, the current map, `POST maps`
  with the document, `maps/mine` for the person's pending one, refusal with problems.
- **Drafts**: the app has device storage helpers in `libs/velista/platform`
  (`storage-keys.ts`). A document is a few kilobytes.

### Target state

1. **The page**, `shops/:locationId/map/edit`, for an account. It opens on the shop's
   current map when there is one (as a new draft), else on an empty grid sized from the
   building outline when the shop has one, else on a 40 by 30 grid. The mock decides the
   default zoom, which the editor fits.
2. **The tool strip** along the bottom, above the keyboard line: select, pan, draw with a
   kind sub menu (shelf, fridge, freezer, counter, checkout, wall, pillar, entrance, exit),
   section, product, note, erase, aisles template, undo, redo. One tap selects a tool, and
   the strip says which tool is on in words as well as by state.
3. **The pickers** are sheets under the page's `sheet` segment (`sheet/section`,
   `sheet/product`, `sheet/note`), opened by the editor's callbacks and resolved when the
   sheet closes, so the phone's back button cancels a pick.
4. **Problems** from `onProblems` are shown as a count in the strip and a list in a sheet,
   each naming the fixture or anchor and centring the canvas on it when tapped.
5. **Drafts** are saved on the device on every change, keyed by shop, and offered on the
   next open ("Continue your draft from Tuesday, or start again").
6. **Submit** shows a review sheet: the map, the count of aisles, sections and products, a
   sentence that somebody will check it before it is shown, and Send. A refusal lists the
   problems. Success returns to the map page (`0121`) with "Sent for review", and
   `maps/mine` shows the pending one on the page until it is accepted or rejected.
7. **Record** is the first item of the strip and leads to `0123`.

### Scope

Work in `libs/velista/feature-shopping-lists` or a new `libs/velista/feature-shop-map` if
the two pages and their sheets outgrow the basket library (the building session decides
and says why), `libs/velista/data-access` (the outline read, the submission, drafts),
`libs/velista/feature-shell/src/lib/routes.ts` and its spec, `libs/velista/ui` for the tool
strip if it is worth sharing, the locale files, and the specs of each.

Do not touch: the editor library beyond consuming it, the backend, the admin.

### Constraints

- The sheets rule: every sheet is addressed under `sheet/` through `sheet()`, and
  `SheetNavigation.dismiss(fallbackUrl)` is the only way out.
- The document is validated on the client before Send, with the same function the server
  runs.
- No `@angular/core/rxjs-interop`. `svh` only. Tokens on the host. Every string is a key.
- The tool strip's targets are at least 44 css pixels, and the canvas keeps at least 60
  percent of the height with the strip open.
- Only make changes directly requested.

### Action boundaries

Stop and ask before: creating the Angular adapter library, a new feature library, an
export to a file (admin `0038` reads a file only from an operator), or letting a guest
open the page.

### Progress evidence

The mock walked on a phone, then the user's review. Then per target: the files changed and
the spec run. At the end: `npx nx test` and `npx nx lint`, `npx nx build velista`, and a
real map of one nearby shop drawn on a phone against a slot serving backend `0168`,
submitted, and accepted in the admin, with the time it took to draw stated in the plan's
"decisions taken" section. That number decides how urgent `0123` is.

## 1. Not in this plan

- Recording: `0123`.
- Reviewing: admin `0038`.
- Editing the taxonomy or the chain's sections from the phone.
