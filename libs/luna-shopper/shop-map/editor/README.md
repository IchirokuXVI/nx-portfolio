# @portfolio/luna-shopper/shop-map/editor

The shop map canvas (`plans/0001`): one inline SVG that draws a version 2 document of
`@portfolio/luna-shopper/shop-map/model` in one of three looks. It has no framework and no
chrome. It draws the map, area labels and badge numbers, and nothing else a person reads.
Every menu, sheet and word around it belongs to the host, which it reaches through callbacks.

- **mapper**: unknown ground, the 0.5 m grid, the walked floor, areas in their kind's
  colour with the section along the long side, shelf suggestions, marks as round pins with
  an arrow the way the phone pointed, the person with a view cone, the purple path to
  check, and faded content after a rewind point.
- **shopper**: the dotted walkway of `shopperView`, every area in the one area colour with
  a 2 px border and 6 px corners, labels, count badges, note pins and the entrance as a chip
  on its side. No grid and no outer border.
- **shopper-drawn** (velista `plans/0128`): the shopper look with drawings on the areas.
  Badges, labels and taps are the same.

## The drawn look

`setLook('shopper-drawn')` draws each area by its kind and its section, and by nothing else:

| Area                                       | Drawing                                                                                                                                                                                                                                                          |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shelf`                                    | a row of products in three colours along each long side, a line down the middle and a divider every 1.25 m shelf unit. When the walkway runs along one long side only, as it does beside a wall, only that side has products and there is no middle line         |
| `counter`                                  | a glass front along the long side the walkway runs along (the side farther from the shop's edge when it runs along both or neither)                                                                                                                              |
| any area of a fruit and vegetables section | a crate: two offset grids of dots. A section is fruit and vegetables when the first word of its name is one of `PRODUCE_SECTION_WORDS` (`Frutería`, `Fruta y verdura`, `Verdulería`, `Fruit and vegetables`, `Produce` ...). `isProduceSection(name)` answers it |
| `checkout`                                 | a till: a screen, a body and a belt                                                                                                                                                                                                                              |
| `entrance`                                 | two door leaves in the shop's edge, beside the entrance chip                                                                                                                                                                                                     |

Every label sits on a tag in its area's colour so it reads over the drawing. On a custom
colour the text is dark or light, whichever contrasts more with that colour.

The drawing is inline SVG only: `<pattern>` and `<symbol>` in the canvas's own `defs`, no
`<image>`, no file. It is drawn in metres at the mock's scale (28 css pixels to the metre),
so it grows and shrinks with the map. It sits in one group that follows the view, so a
frame of zooming sets one more attribute than the plain look and draws nothing new.

## Mounting

```ts
import { mountShopMap } from '@portfolio/luna-shopper/shop-map/editor';

const map = mountShopMap(hostElement, {
  document, // ShopMapDocumentV2
  look: 'mapper', // or 'shopper'
  onSelect: (area) => {},
  onChange: (events) => {}, // WalkEvent[] for the log
  onLongPress: (at, area, client) => {},
  onSuggestion: (id) => {},
  onMark: (mark) => {}, // mapper look: a mark's pin was tapped
  onArea: (area) => {}, // shopper looks: an area was tapped
  onNote: (note) => {}, // shopper looks: a note was tapped
});
map.setDocument(next);
map.destroy();
```

The host element needs a size. The map fills it, fits the content on mount and on
`fitToContent()`, and keeps fitting until somebody zooms or pans, so a map that grows
while somebody walks stays in view. Zoom runs from everything to half a metre in 28 css
pixels, by pinch, wheel and double tap. One finger moves the map in the shopper looks and
draws in the mapper look.

Two fingers move the map in every look (velista `plans/0129`). The map follows the point
between the fingers and the scale does not change. The gesture becomes a zoom only after
the distance between the fingers changes by more than a dead zone from where it started:
the larger of 12 percent and 24 css pixels. From that moment the scale follows the
fingers, measured from the distance at which they left the dead zone, so the map does not
jump. A zoom stays a zoom until both fingers lift. `pinch.ts` holds the rule.

## Taps

A tap is a press released within 8 css pixels of where it landed, however long it was
held. A drag past that reports no tap, and neither does a two finger gesture. A second
finger that lands during a press cancels it.

- **Mapper look.** A mark's pin is asked first, within 22 css pixels of its centre at the
  scale the pin is drawn, and reports `onMark(mark)`. Then the handles, the suggestions
  and the areas, as before. A drag or a long press that starts on a pin acts on what is
  under the pin.
- **Shopper looks.** A note is asked first, like a pin, and reports `onNote(note)`. Then
  any area that is not `path` or `blocked` reports `onArea(area)`. The host decides what
  opens: the canvas does not know which areas name a section the shop has.

A tap is reported on `pointerup`. After a quick touch the browser then sends a `click` at
the same point. If the host opened a sheet for the tap, that click lands on the sheet's
scrim and closes it. So the canvas consumes the one click that follows a tap, at the
tap's point, before any element hears it.

Every gesture of the mapper look reports a finished change as `area-put` events through
`onChange` and applies it at once. The host appends the events to the log and then calls
`setDocument` with the fold. A draw, move or resize that `validateShopMapV2` refuses is
drawn in the refusal colour and not committed. It stays for under a second, and the next
touch clears it at once.

A long press marks the square under the finger. Then it calls `onLongPress`, and the host
opens its menu. The next touch removes the square. Any `setDocument` removes it too, also
one from a live walk while the menu is open. Selecting the pressed area keeps it.
Selecting any other area removes it. If the host closes its menu with no action, it calls
`clearHeld()`. A long press on a resize handle reports the selected area.

A selected area has four corner handles to resize it. Where the press lands decides.
Outside the area, the 36 px touch target around a corner grabs the handle. Inside the
area, only the drawn 16 px square does, and the rest moves the area. When two targets
overlap, the nearest corner wins. An area under 16 px on a side moves from any press
inside it. Zoom in to resize it.

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
The drawn look adds `--shop-map-product-1`, `-product-2` and `-product-3` (the product
row), `--shop-map-crate` (the crate's second dot), `--shop-map-glass`, `--shop-map-door`
and `--shop-map-label-ink-dark` and `-label-ink-light` (the text on a custom colour's tag).

The theme follows `prefers-color-scheme`. Set `data-theme="day"` or `data-theme="night"`
on the host element or any ancestor to choose one instead. The closest one wins. A Day
host inside a Night page draws Day. When the attribute changes, the map changes too.

## The demo

```sh
npx nx build luna-shopper/shop-map/editor
```

Then open `dist/libs/luna-shopper/shop-map/editor/demo/index.html` from disk. It shows the
El Jamón walk of model plan 0002 and replays it through the live map of model plan 0003.
`?doc=sample` draws a shop laid out like the mock's boards instead. The Drawn button shows
the drawn look, and Side by side (`?compare=1`) shows the plain and the drawn shopper looks
next to each other. `?look=shopper`, `?look=shopper-drawn`,
`?theme=night`, `?live=1`, `?zoom=3` and `?t=600` (seconds of the walk) set the start.

## Running unit tests

Run `npx nx test luna-shopper/shop-map/editor`.
