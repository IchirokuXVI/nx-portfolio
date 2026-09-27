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
