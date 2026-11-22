# 0204: the basket row sheet records buys with the reel in the compact view

> Decided on 2026-11-22. In the compact view of velista `0202`, the basket row sheet draws
> the reel of velista `0203` for each list's buys, in place of the typed stepper of velista
> `0201`. The sheet drops typing in that view (the owner's ruling). The reel colours its
> number as the stepper does: green when what was bought reaches the list's ask, amber above
> it, and the colour shows on the tape while the reel moves, so a shopper sees it reached
> before letting go.
>
> **Blocked until the owner approves a mock**: `apps/velista/plans/mocks/compact-reel/`, a
> frame of the basket row sheet in the compact view with one reel open showing the green and
> the amber numbers on its tape.
>
> Depends on velista `0201` (the sheet records buys per list, the `target` colour rule) and
> velista `0203` (the reel). It can be released once those are released (and with them
> `0200`, `0202` and backend `0273`); it adds nothing those need.
>
> Code anchors, on `dev` at `e06813139`:
> `libs/velista/feature-shopping-lists/src/lib/row-entries/row-entries.html:47` to `:59` and
> `:122` to `:134` (the two steppers of the entries); the reel of velista `0203`
> (`libs/velista/ui/src/lib/list/quantity-reel.*`); the stepper's `target` input of velista
> `0201`; `libs/velista/data-access/src/lib/lists/list-rows-store.ts`.

## Brief for the agent

### Objective

In the compact view, draw each buy stepper of the basket row sheet, in the entries and in
"Bought for another list", as the reel, with the green and amber colours on its number and
on the tape.

### Context

- After velista `0201` the entries' steppers record buys through runs and colour the number
  by `target` (the list's ask).
- After velista `0203` the reel emits one `QuantityStep` when its overlay closes.

### Target state

1. The entries read the view from `ListRowsStore`. In the compact view each buy stepper is a
   `lib-quantity-reel` with the same value, unit, step, `min` 0 and the list's ask as
   `target`; in the default view nothing changes.
2. The reel gains the input `target: number | null`. Its resting number and every number of
   its tape are `--app-status-success-fg` when equal to the target and
   `--app-action-quiet-fg` when above it.
3. A reel's step goes through the same run as a press of `0201` and is written at once
   (`flush`), so the same settle or revert is sent.
4. "Bought for another list" draws reels too, starting at 0.

### Scope

- Work in `feature-shopping-lists` (the entries) and `ui` (the reel's `target`).
- Do NOT change what a buy writes (velista `0201`) or the reel's gesture (velista `0203`).

### Constraints

- Rule T1 and the contrast spec for both colours on the reel's surface and its overlay, Day
  and Night.
- No dashes as punctuation in comments.

### Action boundaries

- Stop if the mock is not approved, or if velista `0201` or `0203` is not built.

### Progress evidence

`npx nx affected -t lint test`; a walk on a slot in the compact view: drag a list asking 3
from 0 to 4 and see the 3 green and the 4 amber on the tape before release; read the row's
history for one buy of 4.

## 1. Specs

1. In the compact view the entries draw reels and no steppers; in the default view the
   reverse.
2. The reel's number and its tape numbers carry the success colour at the target and amber
   above it.
3. A reel closed from 0 at 4 sends one settle of 4 for that line.

## 2. Acceptance criteria

- The compact view's row sheet has no typed field and records buys with the reel.
- The green and the amber are visible while the reel moves.

## Not in this plan

- The detailed view of velista `0200`, which has typing and so keeps the button stepper in
  both views.
