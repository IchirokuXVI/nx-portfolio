# 0001: an editor and a viewer without a framework

> Rewritten on 2026-09-29 for the design of `shop-map/plans/0002`: shapes in metres, a walk
> drawn live, and a map for shoppers with no grid. The first version drew `0001`'s grid of
> fixtures with a tool strip, and nothing of it was built.
>
> Needs `shop-map/plans/0002` (the document in metres and `shopperView`) and
> `shop-map/plans/0003` (suggestions and section runs). Consumed by velista `0121` (the map
> shoppers see), `0123` (editing by hand) and `0126` (recording a walk).
>
> Mock: `apps/velista/plans/mocks/shop-map/`, published at
> https://claude.ai/artifact/Q3iEPafsH5G9Aqgvkgqi1f. Every board that draws a map is this
> library's output, and the host draws everything around it.
>
> Prerequisite reading: `shop-map/plans/0002` and `0003`, the icon pattern in
> `libs/shared/ui` (an SVG inlined once and coloured through CSS), the memory note that a
> remote's `url()` assets resolve against the shell, and velista's token rules.

The user decided on 2026-09-27 that the editor is its own library in TypeScript with no
framework, and that an Angular adapter exists only when it is needed and then as a separate
library. This plan builds `@portfolio/luna-shopper/shop-map/editor`: one SVG canvas with
two looks. The **mapper** look shows the half metre grid, the walked floor, suggested
shelves, marks with the direction they faced, the person and the purple path to check. The
**shopper** look shows a friendly map with no grid: a dotted walkway, areas with clear
borders and rounded corners, count badges and no outer border.

## Brief for the agent

### Objective

Build a framework free library that mounts into a host element, draws a version 2 document
in the mapper or the shopper look, fits and zooms it, draws live walking state, and in the
mapper look lets a single tap draw, select and resize areas while a long press asks the host
for a menu.

### Context

- **The document** and its projections come from `@portfolio/luna-shopper/shop-map/model`:
  `ShopMapDocumentV2`, `validateShopMapV2`, `shopperView` and `LiveSnapshot`.
- **Where it runs**: velista, a zoneless Angular PWA served standalone and as a remote, on
  phones first. The back office does not draw maps in this series.
- **Assets**: a remote's CSS `url()` resolves against the shell's origin, and a raster image
  cannot take Day and Night colours. Everything is inline SVG coloured through custom
  properties.
- **Decisions of the mock** (all fixed):
  - The mapper look has no edit buttons. A single tap on the floor starts drawing, a tap on
    an area selects it, and dragging a handle resizes it. A long press opens the host's menu.
  - Snapping to the grid is a switch, off by default. Sizes show in metres while resizing.
  - The shopper look fills the walkway with a dotted pattern. Areas have a 2 px border,
    6 px rounded corners, no gap to the walkway and one default colour. The map has no
    outer border. Count badges sit on an area's corner and turn green with a tick when that
    section is done.
  - An area's colour is the default, a custom colour, or "the category colour". The last
    one draws the default until categories have colours (backend backlog `0018`).
  - After a rewind is previewed, what comes after the chosen moment is drawn faded.

### Target state

- `libs/luna-shopper/shop-map/editor` exists with jest (jsdom) and lint targets and a path
  alias.
- `mountShopMap(host, options)` (section 1) draws a document in either look, returns a
  handle, and cleans up on `destroy()`.
- The looks of section 2, every colour a custom property with Day and Night defaults, so a
  host restyles by setting variables on the host element.
- Zoom fits on mount and on `fitToContent()`, clamps between "everything" and "0.5 m is 28
  css pixels", and follows pinch, wheel, double tap and drag.
- The interactions of section 3 in the mapper look, each committed change reported through
  `onChange` as the `WalkEvent`s it produced.
- A demo page, `demo/index.html`, opened from disk after the library's own build, shows the
  El Jamón fixture of `shop-map/plans/0002` in both looks and both themes, and replays its
  live snapshots.

### Scope

Work only in `libs/luna-shopper/shop-map/editor/**` and `tsconfig.base.json` for the alias.

Do not touch: the model and recorder libraries beyond consuming them, velista, the back
office.

### Constraints

- **No framework and no chrome.** The library draws the canvas and nothing else: no menu,
  sheet, button or text a person reads except area labels and badge numbers. Menus and
  sheets are the host's, reached through callbacks.
- **Inline SVG only**, `<pattern>` for the dotted walkway and the grid, no `<image>`, no
  `url()` to a file. Zero runtime dependencies unless one is unavoidable, and then stop and
  ask.
- **Touch first.** A resize handle is at least 28 css pixels. A long press is 450 ms without
  moving more than 8 px.
- **The Angular adapter rule.** A host wraps `mountShopMap` in a component of its own. If
  that component grows beyond mounting, destroying and forwarding, or a second host needs
  the same glue, `@portfolio/luna-shopper/shop-map/angular` is created by the plan that hits
  that point, and it says so.
- Only make changes directly requested.

### Action boundaries

Stop and ask before: adding a dependency, drawing any control inside the canvas, a canvas
element instead of SVG, rotation by angle, or the drawn assets of velista `0128` (section 4).

### Progress evidence

Per section: the files changed and the spec run. At the end: the test and lint targets, the
demo page with screenshots at a phone width in both looks and both themes, and the frame
time when zooming the El Jamón fixture.

## 1. The API

```ts
export interface ShopMapHandle {
  setDocument(doc: ShopMapDocumentV2): void;
  setLook(look: 'mapper' | 'shopper'): void;
  /** Mapper look: the walk as it happens. */
  setLive(live: {
    snapshot: LiveSnapshot;
    person?: { x: number; y: number; heading: number };
    unconfirmed?: [number, number][];  // the purple path after an automatic resume
  } | null): void;
  /** Mapper look, rewind preview: draw everything after this log time faded. */
  setFadedAfter(logMs: number | null): void;
  /** Shopper look: badges per section name. */
  setBadges(badges: Record<string, { count: number; done: boolean }>): void;
  setSelected(areaId: string | null): void;
  setSnap(on: boolean): void;
  /** Mapper look: the kind a tap and drag on the floor draws. */
  setDrawKind(kind: AreaKind): void;
  fitToContent(): void;
  destroy(): void;
}

export interface MountOptions {
  document: ShopMapDocumentV2;
  look: 'mapper' | 'shopper';
  labelOf?: (area: MapArea) => string;
  /** Mapper look: an area was tapped, or the selection was cleared. */
  onSelect?: (area: MapArea | null) => void;
  /** Mapper look: a finished draw, move or resize, as log events. */
  onChange?: (events: WalkEvent[]) => void;
  /** Mapper look: a long press, with the area under it and the point in metres. */
  onLongPress?: (at: { x: number; y: number }, area: MapArea | null, client: { x: number; y: number }) => void;
  /** Mapper look: a suggestion was tapped. The host asks, then calls the live map. */
  onSuggestion?: (id: string) => void;
  /** Shopper look: a section's area was tapped. */
  onSection?: (section: string) => void;
}

export function mountShopMap(host: HTMLElement, options: MountOptions): ShopMapHandle;
```

## 2. The looks

| Look | Draws |
| ---- | ----- |
| mapper | unknown ground, the 0.5 m grid, walked cells, areas with their kind's fill and section label along the long side, suggestions dashed with "Shelf?", marks as round pins with an arrow for the heading, the person as a dot with a view cone, the purple unconfirmed path, faded content after a rewind point |
| shopper | the walkway polygons of `shopperView` with the dotted pattern, every area in the default area colour with a 2 px border and 6 px corners, labels, badges, note pins, the entrance as a chip on its side, no grid and no outer border |

Custom properties, each with a Day and a Night default: `--shop-map-walkway`,
`--shop-map-walkway-dot`, `--shop-map-area`, `--shop-map-area-border`,
`--shop-map-area-text`, `--shop-map-grid`, `--shop-map-walked`, `--shop-map-suggestion`,
`--shop-map-unconfirmed`, `--shop-map-person`, `--shop-map-badge`, `--shop-map-badge-done`.
A custom area colour is drawn as the fill with a border 40 percent darker.

## 3. Interactions in the mapper look

| Gesture | Does |
| ------- | ---- |
| tap on the floor, then drag | draws a rectangle of the kind the host set with `setDrawKind` (shelf by default) |
| tap on an area | selects it and shows four corner handles and its size in metres |
| drag a handle | resizes, snapped to 0.5 m when the switch is on |
| drag a selected area | moves it |
| tap on a suggestion | calls `onSuggestion` |
| long press | calls `onLongPress` with what is under the finger |
| two fingers | pan and zoom, never an edit |

Each finished gesture calls `onChange` with the `area-put` or `area-removed` events it made.
A drawn or moved area that `validateShopMapV2` refuses is drawn in the refusal colour and
not committed.

## 4. Not in this plan

- Menus, sheets, the colour picker, the mark sheet and every word: the hosts.
- **Drawn assets** (shelves with products, tills, a door): velista `0128`, low priority and
  built last, adds them as a second shopper look. The plain look ships first.
- Rotation by angle, multi selection, copy and paste, levels.
