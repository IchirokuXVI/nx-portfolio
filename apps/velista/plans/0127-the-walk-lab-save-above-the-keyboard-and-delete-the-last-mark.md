# 0127: the walk lab, Save above the keyboard, and deleting the last mark

> Asked for on 2026-09-29 after the second El Jamón walk, and held until the plans were
> written. Small and independent of the rest of the shop map series. The user asked for the
> same button in the Android walk app, then decided to delete that app instead
> (`libs/luna-shopper/shop-map/recorder/plans/0004`).
>
> Prerequisite reading: `libs/velista/feature-walk-lab/src/lib/pages/record-page.html`
> (the checkpoint and note panel, a `<form class="panel">` under the map), `record-page.ts`
> (`saveLabel`, `openPanel`, `lastMark`), `capture/walk-builder.ts` (marks and how they are
> drained into storage), and `libs/luna-shopper/shop-map/recorder/plans/0002` (the walk
> file's `marks` and `events`).

Two things stopped the user from recording checkpoints in the browser. With camera tracking
on, the lab runs inside WebXR's DOM overlay, which does not scroll, and the on screen
keyboard covers the panel's Save button, so a checkpoint cannot be saved at all. And a wrong
checkpoint cannot be taken back. The user asked for one thing for the second: a button that
deletes the last mark, and nothing more.

## Brief for the agent

### Objective

Keep the checkpoint panel's Save button visible above the on screen keyboard in the walk
lab, with and without camera tracking, and add a "Delete last mark" button that removes the
most recent mark from the walk being recorded and from what is stored.

### Context

- **The panel** is a form with a title, used labels as chips, one input and Save and Cancel
  under it, drawn in the flow of the recording page. In the WebXR DOM overlay the page
  cannot scroll.
- **`visualViewport`** reports the height the keyboard leaves, in the overlay too, on
  Chrome for Android.
- **Marks** are appended to `WalkBuilder._marks` and drained into IndexedDB in batches
  (`#marks` in `_drained`), so the last mark can already be stored when the person deletes
  it.
- **The walk file** (`recorder/plans/0002`) has `marks` and `events`. `readWalkFile` reads it,
  and the recorder README lists the rules it follows.

### Target state

1. **Save stays visible.** While the panel is open, it is positioned against the bottom of
   the visual viewport, so Save and Cancel sit directly above the keyboard. The chips
   scroll sideways in one row instead of wrapping, so the panel never grows taller than the
   space left.
2. **Delete last mark** is a button beside the "last mark" status line, shown when the walk
   has a mark. It asks nothing, removes the mark, and the status line then names the mark
   before it.
3. **Stored walks agree.** A mark not yet drained is removed from the builder. A mark
   already drained is cancelled with an event `{ kind: 'mark-deleted', detail: <the mark's
   t> }`, and `readWalkFile` drops a mark with a matching `mark-deleted` event. The rule is
   added to the recorder README beside its other rules.

### Scope

Work only in `libs/velista/feature-walk-lab/**`, `libs/luna-shopper/shop-map/recorder`
(the reader rule, its spec and the README line), and the lab's locale strings.

Do not touch: anything outside the lab, the Android app (deleted by recorder `0004`), the walk file's
shape beyond the one event kind.

### Constraints

- No `@angular/core/rxjs-interop`. `svh` only. Every string is a key.
- Only make changes directly requested.

### Action boundaries

Stop and ask before: deleting more than the last mark, an undo for a deletion, or changing
how marks are drained.

### Progress evidence

Per target: the files changed and the spec run. At the end: `npx nx test` and `npx nx lint`
for the lab and the recorder, `npx nx build velista`, and on an Android phone on staging or
a slot: a checkpoint saved with the keyboard open and camera tracking on, and a wrong mark
deleted after the walk was drained, then the exported file read back without it.
