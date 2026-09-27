# 0001: an editor and a viewer without a framework

> Second of the shop map series. Needs `shop-map/plans/0001` (the document). Consumed by
> velista `0121` (the viewer on the basket), velista `0122` (drawing a shop's map) and admin
> `0038` (review). Prerequisite reading: the model plan in full, the icon pattern in
> `libs/shared/ui` (an SVG inlined once and coloured through CSS), the memory note that a
> remote's `url()` assets resolve against the shell, and velista's token rules in
> `velista-ui-rules`.

The user decided on 2026-09-27 that the editor is its own library, written in TypeScript
with no framework, and that an Angular adapter exists only if it is needed and then as a
separate library. This plan builds `@portfolio/luna-shopper/shop-map/editor`: one SVG canvas
that draws a document, zooms and pans it, and in edit mode changes it. The host application
owns every button around the canvas.

## Brief for the agent

### Objective

Build a framework free library that mounts into a host element, renders a shop map
document as stylized SVG with a symbol per fixture kind, fits and clamps zoom, supports
pinch, wheel and drag, and in edit mode offers the tools of section 3 with undo and redo,
reporting every change to the host as a new document.

### Context

- **The document** and its functions come from `@portfolio/luna-shopper/shop-map/model`:
  `validateShopMap`, `walkableGrid`, `walkOrder`, `parallelAisles`, `fitOutline`.
- **Where it runs**: velista, a zoneless Angular PWA served standalone and as a remote in
  the portfolio shell, on phones first, and the admin, a desktop Angular app. Both are
  Angular, and neither is allowed to shape this library.
- **Assets**: a remote's CSS `url()` resolves against the shell's origin, and a raster image
  cannot take Day and Night colours from tokens. `libs/shared/ui` inlines SVG once and
  colours it through CSS for exactly those reasons.
- **Existing dependencies**: `d3-array`, `d3-scale` and `d3-shape` are in `package.json`.
  `d3-zoom` and `d3-selection` are not, and pointer maths for zoom and pan is a hundred
  lines.

### Target state

- `libs/luna-shopper/shop-map/editor` exists with jest and lint targets and a path alias.
  Its tests run in jsdom against the DOM it builds.
- `mountShopMap(host, options)` (section 1) renders a document in `view` or `edit` mode,
  returns a handle, and cleans up on `destroy()`.
- Every fixture kind of the model has a symbol (section 2), shelves repeat their symbol
  along the long side, and every colour is a CSS custom property with a default, so a host
  restyles it by setting variables on the host element.
- Zoom fits the document on mount and on `fitToContent()`, clamps between "whole document"
  and "one cell is 28 css pixels", and follows pinch, wheel, double tap and drag.
- Edit mode has the tools of section 3, an undo stack of fifty steps, keyboard equivalents,
  and calls `onChange(document)` after each committed change with a document that passes
  `validateShopMap` or names its problems through `onProblems`.
- A demo page under `libs/luna-shopper/shop-map/editor/demo/index.html`, opened from disk
  with no build step beyond the library's own, shows the supermarket fixture in both modes.
  It is how a reviewer sees the library without an application.

### Scope

Work only in `libs/luna-shopper/shop-map/editor/**` and `tsconfig.base.json` for the alias.

Do not touch: the model library beyond consuming it, velista, the admin, the recorder.

### Constraints

- **No framework and no UI chrome.** The library draws the canvas and nothing else: no
  toolbar, no dialog, no text a person reads except fixture labels. Tools are selected by
  the host through `setTool`. Pickers for a section or a product are the host's, reached
  through the callbacks of section 1. This is what keeps copy, i18n and design in the
  applications.
- **Zero runtime dependencies** unless one is unavoidable, and then stop and ask. Pointer
  events, `ResizeObserver` and SVG are enough.
- **Inline SVG only.** Symbols are `<symbol>` elements defined once inside the canvas and
  used with `<use>`, and shelves repeat through a `<pattern>`. No `<image>`, no `url()`.
- **Touch first.** Every handle is at least 28 css pixels at the minimum zoom, and a long
  press starts the move that a mouse starts by dragging.
- **The Angular adapter rule.** No adapter library is created by this plan. A host wraps
  `mountShopMap` in a component of its own. If that component grows beyond mounting,
  destroying, forwarding a document and forwarding callbacks, or a second host needs the
  same glue, then `@portfolio/luna-shopper/shop-map/angular` is created as a separate
  library by whichever plan hits that point, and it says so.
- Only make changes directly requested.

### Action boundaries

Stop and ask before: adding a dependency, drawing any control inside the canvas, a canvas
element instead of SVG, rotation of fixtures other than by swapping width and height, or a
tool not in section 3.

### Progress evidence

Per section: the files changed and the spec run. At the end: `npx nx test luna-shopper/shop-map/editor`
and the lint target, the demo page opened with screenshots at a phone width in both modes
and both themes, and a note of the frame time when zooming a 60 by 40 document with 200
fixtures.

## 1. The API

```ts
export interface ShopMapHandle {
  setDocument(doc: ShopMapDocument): void;
  getDocument(): ShopMapDocument;
  setMode(mode: 'view' | 'edit'): void;
  setTool(tool: Tool): void;
  setHighlight(h: { sectionAnchorIds?: string[]; route?: { x: number; y: number }[]; cell?: { x: number; y: number } } | null): void;
  fitToContent(): void;
  zoomTo(cell: { x: number; y: number }, cellPx?: number): void;
  undo(): void;
  redo(): void;
  canUndo(): boolean;
  canRedo(): boolean;
  destroy(): void;
}

export interface MountOptions {
  document: ShopMapDocument;
  mode: 'view' | 'edit';
  /** Text for a fixture or anchor, resolved by the host in its locale. */
  labelOf?: (target: ShopMapFixture | ShopMapAnchor) => string;
  onChange?: (doc: ShopMapDocument) => void;
  onProblems?: (problems: ShopMapProblem[]) => void;
  onSelect?: (target: ShopMapFixture | ShopMapAnchor | null) => void;
  /** Edit mode: the host opens its picker and resolves with what to write on the anchor, or null to cancel. */
  pickSection?: (anchor: ShopMapAnchor) => Promise<Pick<ShopMapAnchor, 'sectionId' | 'categoryId' | 'text'> | null>;
  pickProduct?: (anchor: ShopMapAnchor) => Promise<Pick<ShopMapAnchor, 'itemId' | 'ean' | 'text'> | null>;
  editNote?: (anchor: ShopMapAnchor) => Promise<string | null>;
}

export type Tool =
  | 'select' | 'pan'
  | { draw: FixtureKind }
  | { anchor: AnchorKind }
  | 'erase'
  | { template: 'parallel-aisles'; count: number; gap: number };

export function mountShopMap(host: HTMLElement, options: MountOptions): ShopMapHandle;
```

`view` mode ignores every tool and every pointer action except zoom, pan and tapping a
target, which calls `onSelect`. `setHighlight` is how a host says "these aisles still hold
something to buy" and "this is the walk" and "you are here".

## 2. The look

One symbol per fixture kind, drawn once as a `<symbol>` with `currentColor` and two custom
properties per kind (`--shop-map-<kind>-fill`, `--shop-map-<kind>-stroke`) with defaults
that read on a light and a dark background. Shelves, fridges and freezers repeat a unit
symbol along their long side through a `<pattern>`, so a shelf of any length looks like a
shelf and not like a stretched one. Counters and checkouts are single symbols scaled to
their rectangle. Walls are flat. Entrances and exits are a gap in the border with an arrow.

Anchors are drawn as a pin on the fixture's standing face with the host's label, a section
pin larger than a product pin, a note as a small tag. A highlighted section anchor and its
fixture take a highlight property. The route is a rounded polyline over the floor with a
dashed default. Text is drawn in the host's font, inherited.

## 3. The tools

| Tool | Does |
| ---- | ---- |
| `select` | tap selects, drag moves, eight handles resize by whole cells, a long press on touch starts the drag |
| `pan` | drag pans regardless of what is under the finger |
| `draw` | drag draws a rectangle of the kind, snapped to cells, refused visually where it overlaps a blocking fixture |
| `anchor` | tap on a fixture cell places the anchor and calls the host's picker, which fills it or cancels |
| `erase` | tap removes a fixture with its anchors, or an anchor |
| `template` | tap places `parallelAisles` at the tapped cell as a group that stays selected for one move |

Every committed change pushes one undo step. Dragging is one step. Keyboard on desktop:
arrows move the selection by a cell, `Delete` erases, `Ctrl+Z` and `Ctrl+Shift+Z` undo and
redo, `Escape` returns to `select`.

## 4. Zoom

On mount and on `fitToContent`, the document's bounding box (the outline when there is one,
else `size`) fits the host with 8 percent padding. The minimum zoom is that fit. The maximum
makes one cell 28 css pixels, which is the smallest a finger can hit a handle at. A wheel
zooms around the pointer, a pinch around its midpoint, a double tap steps in, and a two
finger drag pans. The host is observed with `ResizeObserver`, and a resize refits only when
the previous zoom was the fit.

## 5. Not in this plan

- A toolbar, a palette, dialogs, copy: the hosts.
- The recorder that produces a document from a walk.
- An Angular adapter, per the rule in Constraints.
- Multi selection, copy and paste, rotation by angle, layers.
