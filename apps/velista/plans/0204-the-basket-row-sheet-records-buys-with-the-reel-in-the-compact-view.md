# 0204: the basket row sheet records buys with the reel in the compact view

> Decided on 2026-11-22. In the compact view of velista `0202`, the basket row sheet draws
> the reel of velista `0203` for each list's buys, in place of the typed stepper of velista
> `0201`. The sheet drops typing in that view (the owner's ruling). The reel colours its
> number as the stepper does: green when what was bought reaches the list's ask, amber above
> it, and the colour shows on the tape while the reel moves, so a shopper sees it reached
> before letting go.
>
> Amended on 2026-11-22 after the owner approved the mock: the reels take the list's ask as a
> second snap point beside 1000, like the buy steppers of velista `0201`, and they are the
> stacked 52 by 44 reel of velista `0203` (the number over its unit).
>
> **The mock is approved**: `apps/velista/plans/mocks/compact-reel/`, published at
> https://claude.ai/artifact/U74Z1MyvcxEK6PN3CRn8N6. Its board `Sheet.dc.html` draws the
> basket row sheet in the compact view, green at the ask and amber above it. Take the look
> and the words from it and its note in `canvas.json`.
>
> Depends on velista `0195` (the snap points), velista `0201` (the sheet records buys per
> list, the `target` colour rule) and velista `0203` (the reel). It can be released once those are released (and with them
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
   `lib-quantity-reel` with the same value, unit, step, `min` 0, the list's ask as
   `target`, and the same `snaps` as the stepper of velista `0201` (`[...QUANTITY_SNAP_POINTS,
   entry.asked]`), so a drag lands exactly on the ask even when the step would skip it. It
   is the reel of velista `0203`, 52 by 44 with the number over its unit. In the default view
   nothing changes.
2. The reel gains the input `target: number | null`. Its resting number and every number of
   its tape are `--app-status-success-fg` when equal to the target and
   `--app-action-quiet-fg` when above it. With a target, the tape's current number below
   it is the primary text colour, not the quiet amber velista `0203` gives it, so amber
   means only "more than asked" (the board's stylesheet has that `plain` case).
3. A reel's step goes through the same run as a press of `0201` and is written at once
   (`flush`), so the same settle or revert is sent.
4. "Bought for another list" draws reels too, starting at 0, with no `snaps` input (only
   the default stop at 1000), as its steppers in velista `0201`.

### Scope

- Work in `feature-shopping-lists` (the entries) and `ui` (the reel's `target`).
- Do NOT change what a buy writes (velista `0201`) or the reel's gesture (velista `0203`).

### Constraints

- Rule T1 and the contrast spec for both colours on the reel's surface and its overlay, Day
  and Night.
- No dashes as punctuation in comments.

### Action boundaries

- Stop if velista `0195`, `0201` or `0203` is not built.
- Stop and ask if the mock shows something on the sheet that this plan does not list.

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
4. An entry's reel receives `snaps` `[1000, ask]`: with an ask of 990 g and a step of 25, a
   drag up from 975 g shows 990 (green) and then 1000 (amber) on its tape. A reel of "Bought
   for another list" receives no `snaps` input.

## 2. Acceptance criteria

- The compact view's row sheet has no typed field and records buys with the reel.
- The green and the amber are visible while the reel moves.

## Not in this plan

- The detailed view of velista `0200`, which has typing and so keeps the button stepper in
  both views.
