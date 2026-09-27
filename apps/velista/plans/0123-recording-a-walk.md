# 0123: recording a walk

> **Mock first.** The session that builds it adds to `mocks/shop-map/` the recording screen
> (the live grid, the step and heading readout, the mark buttons, the scan button with the
> camera open, the finish review) and stops for the user's review before any code.
>
> Needs `0122` (the editor page the recording lands in), `libs/luna-shopper/shop-map/recorder/plans/0001`
> (the recorder) and backend `0168` (`lookup` by EAN). Prerequisite reading: the recorder
> plan in full, especially its constraints (the library touches no sensor), `0117` (the
> microphone, for marks by voice), and the assessment of 2026-09-27 on what a browser can
> sense.

Drawing a supermarket by hand is the part shoppers will not do, so the editor page opens
with Record. The person stands at the entrance, taps Record, walks the aisles with the
phone in hand, scans a product or two per aisle, taps a mark at the checkout and the
counters, and taps Finish. The recorder library turns that into a draft with the aisles
walked and the products pinned, the backend turns the barcodes into products and their
categories, and the person lands in the editor with sections already labelled.

## Brief for the agent

### Objective

Add a recording screen that owns the motion permission, the sensor listener, the wake lock
and the camera, feeds the recorder library, resolves scanned barcodes to products and
sections, and hands the resulting draft to the editor page. Use the
`nx-portfolio-angular-developer` skill and `design-taste-frontend` for the recording screen.

### Context

- **The recorder**: `createWalkRecorder({ start, onStep, onTurn })`, `push(sample)`,
  `mark`, `scan`, `note`, `finish`, and `walkToDocument`, all framework free and blind to
  the browser.
- **Sensors**: `DeviceMotionEvent.requestPermission()` on iOS from a tap, `devicemotion`
  at the browser's rate, `navigator.wakeLock.request('screen')`, and `visibilitychange`,
  which ends a recording because a hidden page stops receiving samples.
- **Barcodes**: `BarcodeDetector` where the browser has it, else a JavaScript decoder,
  which is one dependency and needs the user's yes before it is added. The camera is
  `getUserMedia` on a `<video>`.
- **Resolving a scan**: `POST /v1/catalog/items/lookup` with `eans` (backend `0168`)
  answers products with their `categories` (backend `0166`), so a scan names a leaf, and
  the shop's chain sections covering that leaf (backend `0167`) name the section.
- **Voice**: the composer's microphone of `0117` exists, and a mark by voice ("checkout",
  "fish counter") is a small reuse of it.

### Target state

1. **The screen**, `shops/:locationId/map/record`, reached from the editor's Record. It
   asks for motion permission on a tap with a sentence about why, then for the camera when
   the first scan is tapped. It shows the live grid from the recorder (steps, heading, the
   walked cells), four mark buttons, Scan, Note, and Finish. The screen stays on.
2. **Recording** starts at the entrance cell the person taps on an empty grid, or at the
   outline's entrance when the shop has an outline with a door. Each step and turn updates
   the grid. A scan opens the camera in a sheet, decodes one barcode, closes, and marks the
   position. Marks and notes take one tap, or one word by voice.
3. **Finish** shows the walk on the grid with its confidence per segment, the count of
   scans, and Continue. Continue resolves the scans in one lookup, writes `itemId` on each
   product anchor, adds a section anchor per aisle from the scanned products' sections (the
   most common section among an aisle's scans, and a category anchor when the chain has
   no such section), and opens the editor page (`0122`) on the draft with the low
   confidence aisles selected so the person looks at them first.
4. **Interruptions**. A hidden page, a call or a locked screen ends the recording and keeps
   what was walked as a draft with a sentence that says so. The person can continue by
   drawing.
5. **Measured**. The plan's "decisions taken" section reports, for one real shop: steps
   counted against steps taken, turns detected against turns made, drift at the end in
   cells, and how many aisles were labelled from scans alone.

### Scope

Work in the same feature library as `0122`, `libs/velista/data-access` (the lookup by EAN),
`libs/velista/feature-shell/src/lib/routes.ts` and its spec, the locale files, and the
specs of each. The barcode decoder dependency, if the user agrees, is added in `package.json`
with the lock file regenerated on the machine that adds it.

Do not touch: the recorder library beyond consuming it, the editor library, the backend.

### Constraints

- The library gets samples and strings. Every browser API stays in this screen.
- Nothing is sent to the server during a walk except the one lookup at Finish.
- No `@angular/core/rxjs-interop`. `svh` only. Every string is a key.
- Only make changes directly requested.

### Action boundaries

Stop and ask before: adding the barcode decoder dependency, using WebXR, using
`DeviceOrientationEvent`, recording in the background, or uploading anything before Finish.

### Progress evidence

The mock, then the user's review. Then per target: the files changed and the spec run. At
the end: `npx nx test` and `npx nx lint`, `npx nx build velista`, and the measurements of
target 5 from a real shop, on an iPhone and an Android phone.

## 1. Not in this plan

- A camera based recorder through WebXR: a second recorder behind the same `Walk`
  interface, later, Android only.
- Merging walks: backlog (backend `0017`).
- Where the person stands during a later visit: backlog `0001`.
