# @portfolio/luna-shopper/shop-map/editor

The shop map canvas (`plans/0001`): one inline SVG that draws a version 2 document of
`@portfolio/luna-shopper/shop-map/model` in one of two looks. It has no framework and no
chrome. It draws the map, area labels and badge numbers, and nothing else a person reads.
Every menu, sheet and word around it belongs to the host, which it reaches through callbacks.

- **mapper**: unknown ground, the 0.5 m grid, the walked floor, areas in their kind's
  colour with the section along the long side, shelf suggestions, marks as round pins with
  an arrow the way the phone pointed, the person with a view cone, the purple path to
  check, and faded content after a rewind point.
- **shopper**: the dotted walkway of `shopperView`, every area in the one area colour with
  a 2 px border and 6 px corners, labels, count badges, note pins and the entrance as a chip
  on its side. No grid and no outer border.

## Mounting

```ts
import { mountShopMap } from '@portfolio/luna-shopper/shop-map/editor';

const map = mountShopMap(hostElement, {
  document,              // ShopMapDocumentV2
  look: 'mapper',        // or 'shopper'
  onSelect: (area) => {},
  onChange: (events) => {}, // WalkEvent[] for the log
  onLongPress: (at, area, client) => {},
  onSuggestion: (id) => {},
  onSection: (section) => {},
});
map.setDocument(next);
map.destroy();
```

The host element needs a size. The map fills it, fits the content on mount and on
`fitToContent()`, and keeps fitting while nobody has zoomed or panned, so a map that grows
while somebody walks stays in view. Zoom runs from everything to half a metre in 28 css
pixels, by pinch, wheel, double tap and drag (two fingers in the mapper look, where one
finger draws).

Every gesture of the mapper look reports a finished change as `area-put` events through
`onChange` and applies it at once. The host appends the events to the log and may call
`setDocument` with the fold. A draw, move or resize that `validateShopMapV2` refuses is
drawn in the refusal colour and not committed.

Three optional options exist for what the plan leaves to the host: `createId` (the id of
an area drawn by hand, `crypto.randomUUID()` by default), `suggestionLabel` (the words on
a suggestion, `Shelf?` by default) and `sizeLabel` (the size shown on a selected area).

`setFadedAfter(logMs, log)` fades what comes after a point of the log. Marks carry their
own log time. Areas and the walked floor do not, so the log is passed as well, and what
`stateAt(log, logMs)` does not hold is faded.

## Colours and the theme

Every colour is a custom property with a Day and a Night default taken from the mock,
listed with both values in `SHOP_MAP_PROPERTIES`. Set any of them on the host element (or
an ancestor) to restyle, for example `--shop-map-area: #d8e8f8`.

The theme follows `prefers-color-scheme`. Set `data-theme="day"` or `data-theme="night"`
on the host element or any ancestor to choose one instead.

## The demo

```sh
npx nx build luna-shopper/shop-map/editor
```

Then open `dist/libs/luna-shopper/shop-map/editor/demo/index.html` from disk. It shows the
El Jamón walk of model plan 0002 and replays it through the live map of model plan 0003.
`?doc=sample` draws a shop laid out like the mock's boards instead, and `?look=shopper`,
`?theme=night`, `?live=1`, `?zoom=3` and `?t=600` (seconds of the walk) set the start.

## Running unit tests

Run `npx nx test luna-shopper/shop-map/editor`.
