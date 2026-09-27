> **PR:** [#523](https://github.com/IchirokuXVI/nx-portfolio/pull/523)

# 0001: the shop map folder, and the document

> First of the shop map series. It creates `libs/luna-shopper/shop-map/` as a folder of
> framework free libraries, in the pattern of `libs/luna-shopper/tools/`, and builds the
> first of them: `@portfolio/luna-shopper/shop-map/model`, the document every other piece
> reads and writes. Followed by `shop-map/editor/plans/0001` (the editor and viewer),
> `shop-map/recorder/plans/0001` (steps, turns and scans), backend `0168` (a shop has a map),
> admin `0038` (a map is reviewed) and velista `0121` to `0123`.
>
> Prerequisite reading: backend `0167` (sections per chain, presence and order per shop,
> pins), `libs/luna-shopper/tools/plans/0001` (a folder of libraries and one shared model),
> the `postal-codes` and `osm-places` libraries (framework free code that compiles under
> both Node and Angular), and the memory rule that a browser reachable library never names
> `process`.

A shop map is one document: a grid, rectangles on it with a kind, and anchors that say what
is where. The same document is drawn by a person in velista, produced by a recorded walk,
validated by the backend on submission, rendered for review in the back office, rendered
for a shopper in the basket, and reduced to a walk order that feeds backend `0167`'s section
list. Six readers and three writers, so the document and everything that can be computed
from it without a screen live in one library with no framework in it.

## Brief for the agent

### Objective

Create the `shop-map` folder and its `model` library: the document type, its validation,
the walkable grid, distances, the walk order, templates, and the fixtures that prove them.
Pure TypeScript, no DOM, no framework, runs in Node and in a browser.

### Context

- **Folder precedent**: `libs/luna-shopper/tools/` holds several libraries under one folder
  with one plan describing the folder (`tools/plans/0001`). `project.json` names follow
  `luna-shopper/<folder>/<lib>`, and the path alias is `@portfolio/luna-shopper/<folder>/<lib>`.
- **Framework free precedent**: `libs/luna-shopper/postal-codes` (a jest test target, a lint
  target, no Angular, checked in data) and `osm-places` (the same, plus fixtures). Both are
  imported by the backend and compile under velista's Angular build.
- **What the document must carry**, from the design of 2026-09-26 and 2026-09-27: a grid
  without a real scale, fixtures as rectangles snapped to the grid with a kind that decides
  the picture and whether it blocks walking, anchors for a chain section, a product and a
  free note, entrances and checkouts, and an optional building outline from OpenStreetMap
  for size and orientation.
- **What is computed from it**: whether it is valid, which cells can be walked, distances
  from a cell, a walk from the entrance through every anchored section to the checkout
  (this is what orders a basket, backend `0167` and velista `0120`), and the position of each
  product anchor along that walk.

### Target state

- `libs/luna-shopper/shop-map/model` exists with `project.json`, jest and lint targets, a
  path alias, and a `README.md` naming the document version and the rules of section 2.
- `index.ts` exports the types of section 1 and the functions of section 3.
- `__fixtures__/` holds at least three documents: a corner shop (one aisle, one counter), a
  supermarket with six parallel aisles and two checkouts, and an invalid one for each rule.
- Every function has a table spec against those fixtures, and `walkOrder` on the
  supermarket fixture answers the order a person walks it in, stated in the fixture's
  `expected.json`.
- Nothing in the library names `window`, `document`, `process` or any framework.

### Scope

Work only in `libs/luna-shopper/shop-map/model/**`, `tsconfig.base.json` for the alias, and
`tools/release/rules.mjs` only if a new scope is needed (it is not: `luna` covers it).

Do not touch: the editor, the recorder, the backend, velista, or the admin.

### Constraints

- **Zero runtime dependencies.** The grid maths is small enough to write. Adding a package
  means `npm install` on Windows, which prunes other platforms' bindings from the lock file.
- **Deterministic.** Ids are given by callers. The library invents none. `walkOrder` on the
  same document answers the same order every time.
- **Version one is the only version.** The document carries `version: 1` so a later change
  can migrate, and this plan writes no migration code.
- Only make changes directly requested.

### Action boundaries

Stop and ask before: a third level of anchor, a real world scale beyond the informative
`cell` metres, a fixture kind not in section 1, or a dependency.

### Progress evidence

Per section: the files changed and the spec run. At the end: `npx nx test luna-shopper/shop-map/model`
and `npx nx lint luna-shopper/shop-map/model`, the three fixtures with their expected
orders, and a `grep` for `window|document\.|process` over `src/` answering nothing.

## 1. The document

```ts
export interface ShopMapDocument {
  version: 1;
  /** Metres per cell, informative. 0.5 by default. Nothing computes with it. */
  cell: number;
  size: { cols: number; rows: number };
  /** The building outline in cells, from OpenStreetMap, for size and orientation only. */
  outline?: { points: [number, number][]; bearing: number };
  fixtures: ShopMapFixture[];
  anchors: ShopMapAnchor[];
}

export type FixtureKind =
  | 'shelf' | 'fridge' | 'freezer' | 'counter' | 'checkout' | 'wall' | 'pillar'
  | 'entrance' | 'exit';

export interface ShopMapFixture {
  id: string;
  kind: FixtureKind;
  x: number; y: number; w: number; h: number; // cells, integers, w and h at least 1
  label?: string;
}

export type AnchorKind = 'section' | 'product' | 'note';

export interface ShopMapAnchor {
  id: string;
  kind: AnchorKind;
  /** The cell it sits on. A section or product anchor sits on a fixture cell. */
  at: { x: number; y: number };
  /** Which side a shopper stands on. Derived from the nearest free cell when absent. */
  face?: 'n' | 's' | 'e' | 'w';
  /** kind section: a chain section (backend 0167), or an app category when the chain has none yet. */
  sectionId?: string;
  categoryId?: string;
  /** kind product: the catalog product, or the barcode the recorder scanned before it was resolved. */
  itemId?: string;
  ean?: string;
  /** kind note, and an optional label on the other two. */
  text?: string;
}
```

Every fixture kind blocks walking except `entrance` and `exit`, which sit on the border and
are walked through. Cells not covered by a blocking fixture are floor. An aisle is not
drawn: it is the floor between two shelves.

## 2. The rules

`validateShopMap(doc)` answers a list of problems, each with a code and the id it names,
and an empty list means valid. Every writer calls it before saving and the backend calls it
on submission.

| Code | Refuses |
| ---- | ------- |
| `OUT_OF_BOUNDS` | a fixture or anchor outside `size` |
| `BLOCKING_OVERLAP` | two blocking fixtures sharing a cell |
| `ENTRANCE_INSIDE` | an entrance or exit not touching the border |
| `NO_ENTRANCE` | no entrance at all |
| `ANCHOR_OFF_FIXTURE` | a section or product anchor on a floor cell |
| `ANCHOR_UNREACHABLE` | a section or product anchor with no free neighbouring cell |
| `ANCHOR_UNNAMED` | a section anchor with neither `sectionId` nor `categoryId`, or a product anchor with neither `itemId` nor `ean` |
| `DISCONNECTED` | a free cell no entrance can reach, reported once with the cell |

A missing checkout is not a problem: `walkOrder` ends at the farthest anchored section
instead, and the report says so.

## 3. The functions

| Function | Answers |
| -------- | ------- |
| `emptyShopMap(cols, rows)` | a valid empty document |
| `validateShopMap(doc)` | section 2 |
| `walkableGrid(doc)` | a boolean grid of free cells |
| `distancesFrom(doc, cell)` | breadth first distances over free cells, `Infinity` where unreachable |
| `anchorFace(doc, anchor)` | the free cell a shopper stands on for this anchor |
| `walkOrder(doc)` | section 4 |
| `fitOutline(outline, cellMetres)` | the outline in cells and the `size` that holds it, rotated so its longest wall is horizontal |
| `parallelAisles(cols, rows, count, gap)` | a template of `count` shelf pairs with `gap` cells between them |
| `normalizeShopMap(doc)` | fixtures and anchors sorted by id, numbers as integers, so two equal documents hash equal |

## 4. The walk order

From the entrance (the first by id when there are several), visit the standing cell of
every section anchor and end at the nearest checkout. Distances between standing cells are
breadth first distances over the free grid. The route is nearest neighbour first, then
improved by 2-opt until no swap shortens it. That is exact enough for a shop with under a
hundred sections and runs in milliseconds.

The answer:

```ts
interface WalkOrder {
  sections: { anchorId: string; sectionId?: string; categoryId?: string; at: number }[]; // at: cells along the walk
  products: { anchorId: string; itemId?: string; ean?: string; sectionAnchorId: string | null; at: number }[];
  route: { x: number; y: number }[]; // the cells walked, for drawing
  endsAtCheckout: boolean;
}
```

A product anchor belongs to the section anchor on the same fixture, else the nearest
section anchor by standing distance, else none. Backend `0168` writes `sections` into the
shop's section order (backend `0167`) and `products` into its per shop pins. Velista draws
`route`.

## 5. Not in this plan

- Anything that draws: `shop-map/editor`.
- Anything that senses: `shop-map/recorder`.
- Georeferencing beyond the outline's bearing.
- Levels. A supermarket with two floors is two maps, and that is a later document version.
