# 0126: recording a walk with the camera

> Part of the shop map series as rewritten on 2026-09-29. It replaces the step counting
> recorder of the first `0123`.
>
> Mock: `mocks/shop-map/`, published at https://claude.ai/artifact/Q3iEPafsH5G9Aqgvkgqi1f.
> The boards "Walking", "Adding a mark" and "Shelf suggestion", and the group "Mapping a
> shop: stops and resumes": "Stopped by a tracking problem", "Path to check after an
> automatic resume", "Resuming: where are you?", "Resuming the walk shoppers see" and "Not
> saved yet". Day and Night.
>
> Needs `0122` (the history, whose Resume walking and Start a new walk this plan wires),
> `0123` (the editing parts, reused while walking), backend `0168` (appending entries),
> `libs/luna-shopper/shop-map/plans/0003` (the live map), `recorder/plans/0003` (the
> tracking guard and aligning a resumed session), and the editor's mapper look.
> Prerequisite reading: those plans, and `libs/velista/feature-walk-lab` (how the lab opens
> `immersive-ar` with a DOM overlay today, `capture/walk-capture.ts`).

Somebody with the mapping permission stands in the shop, taps Resume walking or Start a
new walk, and walks with the phone upright. The camera tracks where they are. The floor they
walk fills in, shelves between walked aisles are offered as suggestions to tap, and marks
of three kinds name sections, counters and notes, each with the direction the phone
pointed. When the camera loses its place or its frame jumps, the walk stops with a sound.
Nothing is lost: the walk saves every 20 s and on every stop.

## Brief for the agent

### Objective

Add the recording screen: a WebXR camera session with the map as its DOM overlay, the live
map and tracking guard fed from it, marks and suggestions, sections in progress, stops and
both kinds of resume with their sounds, and saving. Use the `nx-portfolio-angular-developer`
skill and `design-taste-frontend`.

### Context

- **Camera tracking in a browser** is WebXR `immersive-ar` with `dom-overlay`, which Chrome
  on Android offers. Safari on an iPhone does not. The walk lab (`feature-walk-lab`) opens
  it today, reads `XRViewerPose` and treats `emulatedPosition` as lost tracking. The page
  cannot scroll inside the overlay, which is why the lab's Save button hides under the
  keyboard (`0127`).
- **The compass** is `deviceorientationabsolute`, needed by the tracking guard.
- **The live map** (`shop-map/plans/0003`): `push`, `setTracking`, `mark`, `sectionLeft`,
  `acceptSuggestion`, `snapshot`. **The guard** (`recorder/plans/0003`): `pushPose`,
  `pushCompass`, `state`, `keepPathPoint`, `alignSession`.
- **Decisions of the mock** (all fixed):
  - The bar: the walk's name, a tracking pill ("Tracking good"), and Stop. A "Saved 20 s ago"
    chip on the map. The hint "Tap the map to draw or select. Hold a square for more."
  - At the bottom: "In section Lácteos" with "Section left" while a section runs, and three
    buttons, Section, Counter and Note, each opening the mark sheet on that kind.
  - The mark sheet: "Point your phone at what you mark" with where the phone points now,
    the kind switch, the name field, "Recent in this walk" (marks of the same kind in this
    walk) and "Sections in this shop" (the shop's sections, section kind only) as chips that
    scroll sideways and show only the name, and Save. **Save is never hidden** by the
    keyboard or by scrolling: it sits in its own bar pinned directly above the keyboard.
  - A suggestion shows "Shelf? Tap to fill". Its sheet says "Is this a shelf?", why and its
    size, the section it takes from a mark nearby with Change, and "Not a shelf" or "Fill as
    shelf".
  - A hardware stop plays a sound and shows "The walk stopped" with why, "Everything up to
    this moment is saved.", and "Resume from a place I marked".
  - An automatic resume plays another sound and draws its path in purple: "Is the purple
    path right?", with "No, stop here" and "Yes, keep it". The purple part is not saved
    until confirmed, and No keeps the walk up to the problem.
  - A manual resume asks "Where are you?": tap a mark on the map, point the phone the way
    its arrow shows, and "Start from here".
  - Leaving the page or pressing Stop pauses the walk. A save that fails shows "Not saved
    yet" and keeps trying.
  - Resuming the walk shown to shoppers asks first (`0122`).

### Target state

1. **The screen**, `shops/:locationId/walks/:walkId/record`, from Resume walking and from
   Start a new walk. Where `immersive-ar` is not supported, Resume walking is absent and
   the history says why in one line.
2. **The session**: one XR session per recording, the map page as the DOM overlay, the wake
   lock, the compass listener, the guard and the live map fed on every frame, and the
   editor's `setLive` updated at most 10 times a second.
3. **Marks** through the mark sheet, with the heading from the camera at the moment Save is
   tapped. Save sits in a bar kept above the keyboard with `visualViewport`.
4. **Suggestions** through their sheet, and **sections** with the label and Section left.
5. **Editing while walking**: the tap, handles and long press of `0123`, which never pause
   the walk.
6. **Stops**: Stop, leaving the page, hiding it, and the guard's stops each append a
   `stopped` entry with its reason. A guard stop plays the stop sound.
7. **Resumes**: automatic ones draw the unconfirmed path and append `confirmed` or
   `discarded`. Manual ones pick a mark, align the new session with `alignSession`, and
   append `resumed`.
8. **Saving**: a `started` or `resumed` entry grows while walking and is sent every 20 s,
   on every stop, and with `keepalive` when the page is hidden. A failure shows "Not saved
   yet" and retries every 10 s. The unsaved guard of `0123` covers leaving.
9. **Sounds** are two short tones made with Web Audio, with no audio files.
10. **Shared capture code**: the lab's `capture/` pieces that open the session and read
    poses and the compass move to `libs/velista/platform/src/lib/sensors/`, and the lab
    imports them from there.

### Scope

Work in `libs/velista/feature-shop-map`, `libs/velista/platform` (the sensors move),
`libs/velista/feature-walk-lab` (imports only), `libs/velista/data-access`,
`libs/velista/feature-shell/src/lib/routes.ts` and its spec, the locale files, and the
specs of each.

Do not touch: the backend, the libraries beyond consuming them, the lab's behaviour.

### Constraints

- **Nothing is painted unless the guard says `good`.** The purple path is the only thing
  drawn otherwise.
- **Raw sensor streams are never sent.** Only the kept path points, marks and edits.
- The route guard of `0122`. No `@angular/core/rxjs-interop`. `svh` only. Every string is a
  key. Targets are at least 44 css pixels, because the person holds the phone in one hand.
- Only make changes directly requested.

### Action boundaries

Stop and ask before: recording without the camera, recording in the background, painting
while tracking is not good, saving an unconfirmed path without the person's yes, or adding
an audio file or a dependency.

### Progress evidence

Per target: the files changed and the spec run. At the end: `npx nx test` and `npx nx lint`
for the touched libraries, `npx nx build velista`, and a real walk of a shop on an Android
phone against a slot serving backend `0168`: the walk's time, its marks, one forced stop
(covering the camera) with its sound, one automatic resume confirmed and one discarded,
one manual resume at a mark, and the repeat error at three marks visited twice, stated in
the plan's "decisions taken".

## 1. Not in this plan

- Editing without walking: `0123`. The walks and their history: `0122`.
- Recording on an iPhone, which has no WebXR camera tracking in Safari.
- Relocalizing against a saved camera map.
