# 0002: a map in metres, and a walk that keeps its history

> Second plan of the model library. Replaces the grid document of `0001` as the document
> every new piece reads and writes. `0001` stays built and exported, and nothing new reads it.
> Followed by `0003` (the live rules while walking), `recorder/plans/0003` (camera tracking
> and its guards), `editor/plans/0001` (the canvas), backend `0168` (walks are stored and one
> is the shop's map) and velista `0121` to `0123` and `0126`.
>
> Mock: `apps/velista/plans/mocks/shop-map/`, reviewed over five rounds on 2026-09-29 and
> published at https://claude.ai/artifact/Q3iEPafsH5G9Aqgvkgqi1f. Read its brief note first.
>
> Prerequisite reading: `0001` (the document of whole cells, `walkOrder`, the rules), the
> recorder plan `0002` (the walk file and `vio`), and the field test notes of 2026-09-28 and
> 2026-09-29 in the recorder README.

The field test settled the positioning question: the camera (`vio`) repeats a place to
about 1 m, and steps with a compass drift tens of metres. So a map is drawn from a camera
walk, and a walk is no longer one recording. It is a history. Somebody walks for twenty
minutes, stops, edits a shelf at home, rewinds to before a tracking problem, and resumes a
week later. Each of those is an entry in one log, and the map is what the log folds to.

Shapes are stored in metres. The half metre grid is a drawing aid and the input to the
suggestion rules of `0003`, never the storage, because a counter is 2.8 m wide and a grid
of half metres rounds it to 3.

## Brief for the agent

### Objective

Add version 2 of the shop map document (areas, marks and the walked path in metres), the
walk log that produces it (entries of events, folded in order), rewinding to a point of the
log, the walk order over a version 2 document, and the projection a shopper is shown. Pure
TypeScript in `@portfolio/luna-shopper/shop-map/model`.

### Context

- **The library** exports `0001`'s document, `validateShopMap`, `walkableGrid`,
  `distancesFrom`, `walkOrder` and `normalizeShopMap`. It is framework free and runs in Node,
  velista and the back office. It has no runtime dependency.
- **The frame**: a walk's coordinates are the camera's, x to the right and z towards the
  camera at the start, with y up ignored. The map's `x` is the camera's `x` and its `y` is the
  camera's `z`, so north is wherever the first walk faced. A resume after a lost session is
  aligned into the same frame by the recorder (`recorder/plans/0003`), so the log holds one
  frame.
- **Sizes**: an 18 minute walk is 18 MB of raw streams. The log keeps only the path, at
  most one point per 0.25 m or per second, plus marks and edits: about 100 KB for that walk.
  Raw streams stay in the walk lab.
- **The source walk** is `tmp/walk-20260929-1242-el-jamon-2.geojson` in the owner's main
  checkout, 18 MB and not committed. Ask the owner for it if the checkout has none, and
  commit only the reduced log.
- **Decisions of the mock** (all fixed): areas are rectangles, possibly rotated only by
  swapping width and height. Marks are Section, Counter and Note, each with the direction the
  phone faced. A section fills the shelf it was marked on until a turn, the next section mark
  or "Section left". Walking back along a section run removes the part walked back over.
  Every area has one default colour unless the mapper picks one, and "use the category
  colour" is a mode the document stores before categories have colours.

### Target state

- `ShopMapDocumentV2` and its parts exist as in section 1, with `validateShopMapV2`
  (section 2) and `normalizeShopMapV2`.
- The walk log of section 3: `WalkEntry`, `WalkEvent`, `foldWalk(entries)`,
  `stateAt(entries, logMs)`, `walkTimeline(entries)`.
- `walkOrderV2(doc)` (section 4) answers the ordered section names with their areas, by
  rasterizing the document at 0.5 m and reusing `0001`'s breadth first distances.
- `shopperView(doc)` (section 5) answers what a shopper is drawn.
- Fixtures: the second El Jamón walk of 2026-09-29 reduced to a log (path at 1 point per
  second, its 57 marks, one tracking stop, one edit and two rewinds), with the expected
  document and walk order checked in.

### Scope

Work only in `libs/luna-shopper/shop-map/model/**`.

Do not touch: `0001`'s types or functions, the recorder, the editor, the backend, velista.

### Constraints

- **Zero runtime dependencies. Deterministic.** Ids come from callers. The same log folds to
  the same document byte for byte after `normalizeShopMapV2`.
- **The log only grows.** No function edits or deletes an entry. A rewind is an entry.
- **Metres are floats with 2 decimals** after normalizing. Nothing snaps: snapping is the
  editor's switch.
- Nothing names `window`, `document`, `process` or a framework.
- Only make changes directly requested.

### Action boundaries

Stop and ask before: a shape other than a rectangle, rotation by angle, a new area kind or
mark kind, storing raw sensor streams in the log, or migrating `0001` documents (there are
none stored).

### Progress evidence

Per section: the files changed and the spec run. At the end: `npx nx test
luna-shopper/shop-map/model` and the lint target, the El Jamón fixture folded with its
expected document, `stateAt` answers for five points of that log (before the stop, inside
the discarded segment, after each rewind), and a `grep` for `window|document\.|process` over
`src/` answering nothing.

## 1. The document

```ts
export interface ShopMapDocumentV2 {
  version: 2;
  /** Metres, in the walk's frame. */
  areas: MapArea[];
  marks: MapMark[];
  /** The walked path, as polylines. A gap between two means tracking stopped. */
  path: { points: [number, number][] }[];
}

export type AreaKind = 'shelf' | 'counter' | 'checkout' | 'entrance' | 'blocked' | 'path';

export interface MapArea {
  id: string;
  kind: AreaKind;
  x: number; y: number; w: number; h: number; // metres, top left corner
  /** A section's name as the mapper typed or picked it. Backend 0168 resolves it to a chain section. */
  section?: string;
  label?: string;
  colour: { mode: 'default' } | { mode: 'category' } | { mode: 'custom'; value: string }; // value is #rrggbb
  /** Where it came from: a tapped suggestion, a section run, a counter mark, or drawn by hand. */
  origin: 'suggested' | 'section-run' | 'counter-mark' | 'drawn';
}

export type MarkKind = 'section' | 'counter' | 'note';

export interface MapMark {
  id: string;
  kind: MarkKind;
  x: number; y: number;
  /** Degrees, 0 along +y, clockwise: where the phone pointed when it was saved. */
  heading: number;
  text: string;
  /** Log milliseconds, for the timeline and for rewinding. */
  logMs: number;
}
```

`path` areas are floor somebody drew by hand where the walk did not go. `blocked` is
anything nobody walks through that is not a shelf or a counter. `entrance` and `checkout`
are walkable ends of the walk order.

## 2. The rules

`validateShopMapV2(doc)` answers problems with a code and the id they name. Empty means
valid, and every writer runs it before saving.

| Code | Refuses |
| ---- | ------- |
| `AREA_TOO_SMALL` | an area under 0.3 m on a side |
| `BLOCKING_OVERLAP` | two blocking areas (every kind except `path` and `entrance`) overlapping by more than 0.1 m |
| `SECTION_ON_WRONG_KIND` | `section` on anything but a shelf or a counter |
| `BAD_COLOUR` | a custom colour that is not `#rrggbb` |
| `MARK_UNNAMED` | a section or counter mark with empty text |

A document with no entrance or no checkout is valid. `walkOrderV2` starts at the first
walked point and ends at the last one instead, and says so.

## 3. The walk log

```ts
export type WalkEntryKind =
  | 'started' | 'resumed' | 'stopped' | 'edited' | 'rewound' | 'confirmed' | 'discarded';

export interface WalkEntry {
  id: string;            // given by the client, so a retried save is the same entry
  seq: number;           // 1, 2, 3 per walk, assigned by the server
  kind: WalkEntryKind;
  at: string;            // wall clock, ISO
  /** Log time this entry covers. A recording entry advances it; an edit or a rewind does not. */
  logFrom: number; logTo: number;
  events: WalkEvent[];
  /** kind rewound: the point of the log the map returns to. */
  rewoundTo?: number;
  /** kind stopped: why. */
  reason?: 'button' | 'left-page' | 'tracking-lost' | 'frame-moved';
}

export type WalkEvent =
  | { type: 'path'; points: [number, number, number][] }   // logMs, x, y; a new polyline starts after a stop
  | { type: 'mark-put'; mark: MapMark }
  | { type: 'mark-removed'; id: string }
  | { type: 'area-put'; area: MapArea }
  | { type: 'area-removed'; id: string }
  | { type: 'section-left'; logMs: number };
```

**Log time** is recorded time with the gaps between sessions removed, so a slider over it
has no empty week in the middle. Every event that happens while walking carries its log
time, and an edit made without walking takes the `logTo` of the entry before it.

`foldWalk(entries)` applies the entries in `seq` order. A `rewound` entry replaces the state
with `stateAt(entries before it, rewoundTo)` and then continues. So rewinding past a rewind
works: rewinding to a point after an earlier rewind returns the state that rewind produced.
A `discarded` entry removes the path and the areas of the unconfirmed segment it names (the
events of the entry before it whose log time is after the automatic resume), and
`confirmed` keeps them.

`stateAt(entries, logMs)` folds every event with a log time up to `logMs`, and every edit
entry whose `logTo` is at most `logMs`. `walkTimeline(entries)` answers one marker per entry
with its kind, its wall clock and its log time, which the rewind slider draws.

A server stores a folded snapshot every twenty entries and on every `rewound` entry
(backend `0168`), so `foldWalk` also accepts a starting document.

## 4. The walk order

`walkOrderV2(doc)` rasterizes the document at 0.5 m: a cell is free when no blocking area
covers its centre and the walk or a `path` area passed within 0.75 m of it. It then runs
`0001`'s nearest neighbour and 2-opt order from the entrance (else the first walked point)
over the standing cell of every area with a `section`, ending at the nearest checkout (else
the last walked point). Two areas with the same section name are one stop at the first of
them. The answer lists section names in order, each with its area ids and the distance
along the walk.

## 5. What a shopper is shown

`shopperView(doc)` answers:

- **The walkway**: the free cells of section 4 closed over gaps under 1 m, as polygons. The
  shopper map fills them with the dotted walkway.
- **The areas**: every area except `path`, with its section, label and colour mode.
- **The notes**: note marks with their text and position. Section and counter marks are
  not shown, because the areas they made are.
- **The bounds** of all of it, for fitting.

The path itself is not in the view: a shopper does not need to know how somebody walked.

## 6. Not in this plan

- The live rules that turn a walk into suggestions and section runs: `0003`.
- Tracking guards and aligning a resumed session: `recorder/plans/0003`.
- Deleting `0001`'s document and functions, which waits until nothing imports them.
- Levels and shapes other than rectangles.
