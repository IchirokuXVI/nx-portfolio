> **PR:** [#523](https://github.com/IchirokuXVI/nx-portfolio/pull/523) (synthetic traces in place of phone traces, and no demo page, which the velista walk lab replaced)

# 0001: steps, turns and scans

> Third of the shop map series. Needs `shop-map/plans/0001` (the document). Consumed by
> velista `0123` (recording a walk). Prerequisite reading: the model plan in full, the
> editor plan's section 1 (the document a recording hands over is edited there), and the
> assessment of 2026-09-27 on why radios cannot position a phone in a shop.

Drawing a whole supermarket by hand is the part shoppers will not do. This library turns a
walk into a draft: the phone's motion sensors count steps and detect turns, the walk is
snapped to a grid because aisles are straight and turns are square, and a barcode scanned
on a shelf labels the aisle with the product's section and pins the product. The draft is
then corrected in the editor. Nothing here positions the phone from Wi-Fi, Bluetooth or the
network, because no browser can and no shop has the hardware.

## Brief for the agent

### Objective

Build `@portfolio/luna-shopper/shop-map/recorder`, a framework free library that consumes
motion samples, detects steps and square turns, keeps a grid position, accepts marks and
scans from the host at the current position, and converts the finished walk into a shop
map document draft with aisles where the person walked and anchors where they scanned.

### Context

- **Sensors in a browser**: `DeviceMotionEvent` gives acceleration and rotation rate at
  about 60 Hz. iOS requires `requestPermission()` from a tap and only delivers while the
  page is visible and the screen is on. Safari and Chrome both deliver it in an installed
  PWA. The magnetometer is useless between steel shelves, so heading comes from integrating
  the gyroscope's yaw rate, reset at every detected turn.
- **Barcodes**: `BarcodeDetector` exists in Chrome on Android and not everywhere else. A
  JavaScript decoder is one dependency. The library takes a decoded string from the host
  and never touches the camera, so the dependency, if any, belongs to velista `0123`.
- **The document**: `ShopMapDocument` with fixtures and anchors, and `validateShopMap`,
  from the model library. A product anchor carries `ean` until the backend resolves it.
- **Testability**: the two chain libraries test against checked in fixtures with no
  network. This one tests against checked in sensor traces with no phone.

### Target state

- `libs/luna-shopper/shop-map/recorder` exists with jest and lint targets and a path alias.
- `createWalkRecorder(options)` (section 1) takes samples through `push(sample)` from any
  source, so a spec feeds a trace and a host feeds `devicemotion`.
- Steps are detected from acceleration magnitude peaks with a refractory period, turns from
  integrated yaw crossing 60 degrees and settling near 90 or 180, and the position advances
  one step length per step along the current heading, quantized to the grid.
- `mark(kind)` and `scan(ean)` record at the current position. `finish()` answers a
  `Walk` (section 2). `walkToDocument(walk, options)` answers a draft document (section 3)
  that passes `validateShopMap`.
- `__fixtures__/traces/` holds at least three recorded traces with their expected walks: a
  straight aisle with a scan, an L shape, and six parallel aisles walked in a serpentine.
  The traces are recorded once on a real phone by the building session with the demo page
  of section 4 and committed as JSON.

### Scope

Work only in `libs/luna-shopper/shop-map/recorder/**` and `tsconfig.base.json` for the alias.

Do not touch: the model library beyond consuming it, the editor, velista, the camera.

### Constraints

- **Zero runtime dependencies.** Peak detection and yaw integration are arithmetic.
- **No sensor access inside the library.** The host owns permission, the event listener,
  the wake lock and the camera, and pushes samples and decoded barcodes in. That is what
  makes the library testable and keeps velista `0123` the only place that knows the browser.
- **The grid is the truth.** Step length is a parameter with a default of 0.7 metres, that
  is 1.4 cells at half a metre per cell, and positions are rounded to cells. A recorder that
  reports centimetres is claiming a precision it does not have.
- **Honest about drift.** `Walk.confidence` falls with time since the last turn and is
  reported per segment, so the editor can show which aisles need a look.
- Only make changes directly requested.

### Action boundaries

Stop and ask before: adding a dependency, using the magnetometer, using
`DeviceOrientationEvent` heading, or estimating anything from Wi-Fi or Bluetooth.

### Progress evidence

Per section: the files changed and the spec run. At the end: `npx nx test luna-shopper/shop-map/recorder`,
the lint target, the three traces with their expected walks, and a table from the demo page
on a real phone: for each of three walks, steps counted against steps taken, turns detected
against turns made, and the drift in cells at the end.

## 1. The API

```ts
export interface MotionSample {
  t: number;                       // ms
  accel: { x: number; y: number; z: number }; // including gravity, m/s²
  yawRate: number;                 // rad/s around the vertical axis
}

export interface RecorderOptions {
  cellMetres?: number;             // 0.5
  stepMetres?: number;             // 0.7
  start: { x: number; y: number; heading: 'n' | 's' | 'e' | 'w' }; // the entrance cell
  onStep?: (position: { x: number; y: number }) => void;
  onTurn?: (heading: 'n' | 's' | 'e' | 'w') => void;
}

export interface WalkRecorder {
  push(sample: MotionSample): void;
  mark(kind: 'entrance' | 'exit' | 'checkout' | 'counter', label?: string): void;
  scan(ean: string): void;
  note(text: string): void;
  position(): { x: number; y: number; heading: 'n' | 's' | 'e' | 'w' };
  finish(): Walk;
}

export function createWalkRecorder(options: RecorderOptions): WalkRecorder;
export function walkToDocument(walk: Walk, options: { size?: { cols: number; rows: number }; outline?: ShopMapDocument['outline'] }): ShopMapDocument;
```

## 2. The walk

```ts
export interface Walk {
  segments: { from: Cell; to: Cell; heading: Heading; steps: number; confidence: number }[];
  marks: { kind: 'entrance' | 'exit' | 'checkout' | 'counter'; at: Cell; label?: string }[];
  scans: { ean: string; at: Cell; heading: Heading }[];
  notes: { text: string; at: Cell }[];
  startedAt: number;
  finishedAt: number;
}
```

A segment ends at a turn or at `finish`. Heading is one of four, because a supermarket is
square and forcing the choice is what kills drift: a yaw that settles at 80 degrees is a
left turn, not an 80 degree walk.

## 3. From a walk to a draft

Every segment is an aisle the person walked down, so `walkToDocument` lays a shelf one cell
deep along each side of the segment's cells, merges shelves that touch into one fixture,
and leaves the walked cells as floor. A scan becomes a product anchor on the shelf to the
person's right at the scan's cell (right handed by default, the host can say left), with
`ean` set and `itemId` empty. A mark becomes a fixture of its kind at the cell, snapped to
the border for an entrance or exit. The document's `size` is the walk's bounding box plus
two cells, or the outline's when one is given, and the walk is translated to fit.

The draft is deliberately generous with shelves: it is easier to erase a shelf that is not
there than to draw one that is. A section anchor is not invented here. Velista `0123` turns
scans into sections after the backend resolves the barcodes to products and categories.

## 4. The demo page

`libs/luna-shopper/shop-map/recorder/demo/index.html`, opened over HTTPS on a phone (a dev
slot serves it), asks for motion permission, records, shows steps, heading and the grid
position live, and downloads the trace and the walk as JSON. It is the tool that records
the fixtures and the one that measures the recorder against a real shop. It is not shipped
anywhere.

## 5. Not in this plan

- The camera, permission prompts, the wake lock, the barcode decoder: velista `0123`.
- Resolving a barcode to a product and a section: backend `0168` and velista `0123`.
- A camera based recorder through WebXR on Android, or native tracking through a shell
  around the app. Either produces a `Walk` through the same interface, later.
- Merging several people's walks of one shop.
