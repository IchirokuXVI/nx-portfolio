# The list page

The mock for plan `0012`, the shopping list and its lines.

Published: https://claude.ai/code/artifact/59311ab0-2a5f-4169-a115-af8f56f939be

Build it after changing an artboard or `canvas.json`, then republish `index.html` to
that URL:

```sh
node apps/velista/plans/mocks/build-index.mjs list
```

`index.html` is generated. Never hand edit it. See `../README.md`.

## What each artboard is for

| Artboard | Answers |
| --- | --- |
| `List.dc.html` | What the screen is, to a writer, a reader, and staff |
| `LineStates.dc.html` | The row, measured, in every state it can hold |
| `AddAndEdit.dc.html` | How something gets onto the list, and how it changes |
| `Comments.dc.html` | The one thing a reader can still do |
| `ReorderAndSwipe.dc.html` | The manual order, and every gesture with a non gesture twin |
| `ListStates.dc.html` | Arriving: warm, cold, and empty |
| `ListProblems.dc.html` | Not live, failed, and gone |
| `ListSettings.dc.html` | Rename, share, delete |
| `DayTheme.dc.html` | Day, and why it is not Night with the colours flipped |

## The three things this mock decides that the plan then had to follow

1. **The whole row ticks a line off.** Everything else on the row is arranged around
   keeping that one target big and unambiguous, which is why the ring is an indicator
   and the overflow is the only other target.
2. **Reordering is a mode.** It came out of drawing the row: a press cannot mean both
   tick and pick up. The plan's rule L4 was rewritten to match the artboard rather than
   the other way around.
3. **The share sheet is drawn and cannot ship.** `PUT /v1/lists/:id/access` replaces the
   whole set and nothing can read it. The artboard carries that callout in the frame, so
   the gap is visible to anybody looking at the design rather than only to somebody
   reading section 5.5.

## Deliberately not here

No catalog items, no presence, and no "finish the shop". All three are recorded in the
plan's section 9, and drawing any of them would put a promise in the mock that no
endpoint can keep.
