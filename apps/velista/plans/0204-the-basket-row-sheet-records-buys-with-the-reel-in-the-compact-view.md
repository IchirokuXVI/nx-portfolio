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
> Amended again on 2026-11-22: the owner ruled what colour and what weight each number on
> the tape takes. On a reel with a target, colour says the status only and selection is
> never a colour: the selected number is larger and bold inside the thumb's ring, its
> neighbours smaller and regular. So a selected number that equals the ask is green and
> bold. On a reel with no target the selected number keeps the old reel's quiet amber. This
> replaces the earlier wording about the board's `.cur.plain` case (target state 2).
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
2. The reel gains the input `target: number | null`. **What colour and what weight a number
   takes** (the owner, 2026-11-22):
   - **On a reel with a target** (the basket row sheet), **colour says the status only.** A
     number below the target takes the normal text colour (`--app-text-primary`), the
     number equal to it `--app-status-success-fg`, and a number above it
     `--app-action-quiet-fg`. This holds for every number on the tape and for the resting
     number on the pill, selected or not. So amber means only "more than asked".
   - **Selection is never a colour.** The selected number of the tape (the current one,
     inside the thumb's ring) is larger and bold, 19 px as velista `0203` sizes it; its
     neighbours are smaller, 14 px, and regular weight. A selected number that equals the
     target is green and bold; a neighbour that equals it is green and regular.
   - **On a reel with no target** (the zone list, the due rows, the product page's table of
     velista `0203`), nothing changes: the selected number keeps the old reel's quiet amber
     and the neighbours stay muted.

   This replaces the earlier rule that read the board's `.cur.plain` case. The builder
   takes the colours from this rule, not from that class of the mock's stylesheet.
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
5. With a target of 3, a tape on 2 draws 1, 2 and 3 as: 1 and 2 in the normal text colour,
   3 in the success colour; the selected 2 is bold and larger, 1 and 3 are regular and
   smaller. No number below the target is amber, selected or not.
6. With a target of 3, a tape on 3 draws the selected 3 in the success colour and bold, and
   the neighbour 4 in amber and regular; on 4 the selected 4 is amber and bold.
7. The resting number on the pill takes the same colour as on the tape: the normal text
   colour below the target, green at it, amber above it, at the size and weight velista
   `0203` gives the pill.
8. With a null target the selected number of the tape is the quiet amber and its
   neighbours are muted, as velista `0203` draws them; the zone list's, the due rows' and
   the product page's reels receive no `target`.

## 2. Acceptance criteria

- The compact view's row sheet has no typed field and records buys with the reel.
- The green and the amber are visible while the reel moves.
- On the sheet's reels a colour always means a status, and the selected number is told by
  its size and weight alone.

## Not in this plan

- The detailed view of velista `0200`, which has typing and so keeps the button stepper in
  both views.
