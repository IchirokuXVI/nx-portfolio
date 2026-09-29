# @portfolio/luna-shopper/shop-map/model

The shop map document, and everything that can be computed from it without a screen
(`libs/luna-shopper/shop-map/plans/0001`). People draw it in velista. A recorded walk
produces it. The backend validates it, and the back office reviews it. It also gives the
walk order that sorts a basket. So it lives here, with no framework in it.

The library is pure TypeScript with zero runtime dependencies. It names no DOM global, no
Node global and no framework, so it compiles under Node and under Angular. It never
invents an id. Callers give the ids, and the same document always gives the same results.

## The document, version 1

`version: 1` is the only version. The document holds these parts:

- a grid of `size.cols` by `size.rows` cells, with `cell` metres per cell for information
  only
- `fixtures`: rectangles with a kind
- `anchors`: a chain section, a product or a free note
- an optional building `outline` from OpenStreetMap, for size and orientation

Every fixture kind blocks walking except `entrance` and `exit`. Those two sit on the
border, and shoppers walk through them. Every other cell is floor. An aisle is not drawn.
It is the floor between two shelves.

## The rules

`validateShopMap(doc)` gives a list of problems. An empty list means valid. The problems
come grouped by code in the order below, and in document order within a code.

| Code                 | Refuses                                                                                             |
| -------------------- | --------------------------------------------------------------------------------------------------- |
| `OUT_OF_BOUNDS`      | a fixture or anchor outside `size`, or a fixture not in whole cells                                 |
| `BLOCKING_OVERLAP`   | two blocking fixtures sharing a cell, once per pair, naming the later one                           |
| `ENTRANCE_INSIDE`    | an entrance or exit not touching the border                                                         |
| `NO_ENTRANCE`        | no entrance at all                                                                                  |
| `ANCHOR_OFF_FIXTURE` | a section or product anchor on a floor cell                                                         |
| `ANCHOR_UNREACHABLE` | a section or product anchor with no free neighbouring cell                                          |
| `ANCHOR_UNNAMED`     | a section anchor with no `sectionId` or `categoryId`, or a product anchor with no `itemId` or `ean` |
| `DISCONNECTED`       | a free cell no entrance can reach, reported once with the first such cell                           |

A missing checkout is not a problem. The walk then ends at the section farthest from the
entrance, and `endsAtCheckout` is false.

## The functions

| Function                                 | Gives                                                             |
| ---------------------------------------- | ----------------------------------------------------------------- |
| `emptyShopMap(cols, rows)`               | a valid empty document, with one entrance on the bottom border    |
| `validateShopMap(doc)`                   | the rules above                                                   |
| `walkableGrid(doc)`                      | `grid[y][x]`, true on free cells                                  |
| `distancesFrom(doc, cell)`               | breadth first steps over free cells, `Infinity` where unreachable |
| `anchorFace(doc, anchor)`                | the free cell a shopper stands on for an anchor, or `null`        |
| `walkOrder(doc)`                         | the walk through every section anchor, below                      |
| `fitOutline(outline, cellMetres)`        | an outline in metres as cells, longest wall along x, and its size |
| `parallelAisles(cols, rows, count, gap)` | `count` shelf pairs with `gap` cells between them                 |
| `normalizeShopMap(doc)`                  | one canonical form, so equal documents hash equal                 |

## The walk order

The walk starts on the first entrance by id. It visits the standing cell of every section
anchor. The order is nearest neighbour first, then 2-opt until no reversal makes it
shorter. The walk ends at the checkout that makes the whole walk shortest.

A product anchor belongs to a section anchor on the same fixture. If there is none, it
belongs to the nearest section anchor by standing distance. Its `at` is the first route
cell nearest to where a shopper stands for it.

The fixtures in `src/lib/__fixtures__` prove this. There is a corner shop (one aisle, a
counter, no checkout), a supermarket (six aisles, two checkouts) and one invalid document
per rule. `expected.json` states every answer.

```sh
npx nx test luna-shopper/shop-map/model
npx nx lint luna-shopper/shop-map/model
```

## Version 2: a map in metres, and a walk that keeps its history

`libs/luna-shopper/shop-map/plans/0002` adds a second document. Every new piece reads and
writes it. Version 1 above stays built and exported, and nothing new reads it.

`ShopMapDocumentV2` stores `areas` (rectangles with a kind), `marks` (section, counter and
note, each with the heading the phone faced) and the walked `path` as polylines, all in
metres in the frame of the walk. The map's `x` is the camera's `x` and its `y` is the
camera's `z`, so `y` points down when the map is drawn. A heading is in degrees, 0 along
`+y` and clockwise as drawn, so the phone faced `(-sin h, cos h)`. Nothing snaps to a grid.

| Function                    | Gives                                                                    |
| --------------------------- | ------------------------------------------------------------------------ |
| `validateShopMapV2(doc)`    | the problems below, empty when valid                                     |
| `normalizeShopMapV2(doc)`   | one canonical form: sorted by id, two decimals, so equal maps hash equal |
| `foldWalk(entries, start?)` | the normalized document a walk log folds to                              |
| `stateAt(entries, logMs)`   | the document at a point of the log                                       |
| `walkTimeline(entries)`     | one marker per entry, for the rewind slider                              |
| `walkOrderV2(doc)`          | section names in walk order, with their areas and metres walked          |
| `shopperView(doc)`          | the walkway polygons, the areas, the notes and the bounds                |

| Code                    | Refuses                                                             |
| ----------------------- | ------------------------------------------------------------------- |
| `AREA_TOO_SMALL`        | an area under 0.3 m on a side                                       |
| `BLOCKING_OVERLAP`      | two blocking areas overlapping by more than 0.1 m, naming the later |
| `SECTION_ON_WRONG_KIND` | a `section` on anything but a shelf or a counter                    |
| `BAD_COLOUR`            | a custom colour that is not `#rrggbb`                               |
| `MARK_UNNAMED`          | a section or counter mark with empty text                           |

### The walk log

A walk is a log of entries, and the log only grows. `foldWalk` applies them in `seq` order.

- **Log time** is recorded time with the gaps between sessions removed. In a recording
  entry (`started`, `resumed`, `stopped`) each event carries its own log time. An event with
  none takes the time of the event before it. Every other entry happens at its `logTo`.
- **Polylines**: the first path point of a `started` or `resumed` entry starts a new one.
  Every other point continues the last one.
- **`rewound`** replaces the map with `stateAt(the entries before it, rewoundTo)` and the
  walk continues from there. A rewind to a point after an earlier rewind answers the map
  that rewind made.
- **`discarded`** drops the path, marks and areas of the entry just before it from its
  `logFrom` on: the segment after an automatic resume. `confirmed` keeps them.
- **A starting document** stands for every entry before the first one given, so a server
  can fold from a snapshot. A rewind or a discard that reaches before that first entry
  throws, and the caller folds from an earlier snapshot.

### The raster

`walkOrderV2` and `shopperView` rasterize the document at 0.5 m. A cell is free when no
blocking area (every kind except `path` and `entrance`) covers its centre and the walk or a
`path` area passed within 0.75 m of it. A shopper stands on the free cell nearest an area,
at most 1.5 m from it.

The walk starts beside the first entrance, else at the first walked point. It visits one
stop per section name (names match after trimming and case folding, and the stop is the
first area by id), ordered by `walkOrder`'s nearest neighbour and 2-opt. It ends beside the
checkout that makes it shortest, else at the last walked point. `startsAtEntrance` and
`endsAtCheckout` say which.

The shopper's walkway is the free cells plus every unblocked cell in a gap under 1 m, traced
into rings. Outer rings run clockwise as drawn and holes the other way.

### The El Jamón fixture

`src/lib/__fixtures__/el-jamon/` holds the second El Jamón walk of 2026-09-29 as a walk log
(`walk-log.json`), the map it folds to (`expected-map.json`) and its walk order
(`expected-walk-order.json`). `tools/shop-map/reduce-el-jamon-walk.ts` writes all three from
the 18 MB walk file, which is not committed. Never edit them by hand.

```sh
npx tsx tools/shop-map/reduce-el-jamon-walk.ts <path to walk-20260929-1242-el-jamon-2.geojson>
```

The log holds the camera path at one point per second and the 57 marks of the walk. It
also holds the tracking stop at 920.5 s, the turned frame after it as an automatic resume
that is then discarded, and a manual resume from 1013.4 s. Two rewinds are authored: the
first goes back before the last two marks, the tail is replayed as a new session, and the
second goes to 15 s into that replay. One edit, also authored, draws the areas.
