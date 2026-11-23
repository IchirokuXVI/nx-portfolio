# 0206: a popover about one control points at it

> Decided by the owner on 2026-11-22, as a rule for every popover: whenever a popover refers
> to one specific thing (a stepper, a reel), it has a pointer aimed at that thing so it
> cannot be taken for another row's, and it never hides what it points at.
> `AnchoredPopover` (velista `0110`) has no pointer today. It flips between above and below
> its anchor, and that is all. This plan gives it an optional pointer and a placement that
> keeps the anchor, and a "keep in sight" element the caller names (a row), uncovered.
>
> **Release rule: this plan can be built and released alone.** No existing popover changes:
> a caller that does not ask for the pointer draws exactly as before. Velista `0200` (the
> disabled stepper's popover in the detailed view) and velista `0207` (the question a raised
> line asks) are its first callers and are built after it.
>
> **The look is from an approved board**: `apps/velista/plans/mocks/compact-reel/OverBought.dc.html`,
> published at https://claude.ai/artifact/U74Z1MyvcxEK6PN3CRn8N6, with its notes "A RULE FOR
> EVERY POPOVER THAT REFERS TO ONE CONTROL" (`ob-pointer`) and "ROUND 6, THE FRAME"
> (`ob-frame`) in `canvas.json`. Its CSS draws the pointer as `.ask .ptr`, `.ask.up .ptr`
> and `.ask.down .ptr`.
>
> Code anchors, on `dev` at `3f26ae3d3`: `libs/velista/ui/src/lib/list/anchored-popover.ts`
> (`START`, `END` and `CENTER` at `:37` to `:97`, each with an `offsetY` of 8 px; `positions`
> at `:195`; the template at `:123` to `:146`) and `anchored-popover.scss` (`.pop`;
> `.pop.choice` with `overflow: hidden` at `:25` to `:30`; `.pop.hint`);
> `anchored-popover.spec.ts`. Its callers today, none of which this plan changes:
> `libs/velista/feature-lists/src/lib/list-page/list-page.html:170` (the add choice of velista
> `0170`), `libs/velista/feature-shopping-lists/src/lib/basket-page/basket-page.html:660`,
> `libs/velista/ui/src/lib/basket/basket-total.html:19`, `libs/velista/ui/src/lib/catalog/order-menu.ts:61`,
> `libs/velista/ui/src/lib/list/list-picker.ts:85`, `libs/velista/ui/src/lib/list/quantity-stepper.html:121`
> (the refused key hint of velista `0188`). Tokens: `--app-surface-raised`,
> `--app-border-subtle`, `--app-elevation-2`.

## Brief for the agent

### Objective

Give `AnchoredPopover` an optional pointer aimed at the centre of its anchor, and an optional
element to keep in sight, so that a popover about one control opens wholly above or wholly
below that control and its row and never covers either.

### Context

- `AnchoredPopover` is a CDK connected overlay drawn as an inline native popover. Its
  position lists try one side and then the other, each 8 px off the anchor. `push` is off by
  default.
- Its `choice` frame clips its content (`overflow: hidden`) so that a row's pressed tint
  reaches the rounded edge. A pointer drawn inside that box is clipped.
- The board draws the pointer as a 12 px square turned 45 degrees, filled with the
  popover's raised surface, with the popover's hairline on its two outer sides, placed 7 px
  outside the popover's edge. The popover sits 12 px off the row's edge, so the pointer's tip
  is 3 to 4 px off the row. The pointer's centre is on the control's centre.
- On the board none of the 29 popovers, pointer included, overlaps its own row's box or its
  control.

### Target state

1. **Two inputs, both optional.**
   - `pointer: boolean`, default `false`. When it is `false`, the popover draws, places and
     behaves exactly as it does on `dev`, in every frame.
   - `keepInSight: Element | null`, default `null`: an element that holds the anchor (a
     row) and that the popover must not cover.
2. **The pointer.** When `pointer` is `true`, the popover draws a 12 px square turned 45
   degrees on the edge that faces the anchor: the bottom edge when it opened above, the top
   edge when it opened below. It is filled with `--app-surface-raised` and carries the
   popover's own border (`--app-border-subtle`, 1 px) on its two outer sides only, so the
   pointer and the popover read as one shape. It sits 7 px outside the edge, as on the
   board. It has no shadow of its own.
3. **The pointer is on the anchor's centre.** Its centre, along the edge, is the anchor's
   horizontal centre. It is placed again whenever the overlay's position changes (the
   `positionChange` of the connected overlay) and when the page scrolls or resizes while it
   is open. If the anchor's centre falls outside the straight part of the edge (the edge less
   the radius and half the pointer at each corner), the pointer stops at the end of that
   straight part.
4. **Nothing clips it.** The pointer is drawn outside any element that has `overflow:
   hidden`. For the `choice` frame the clip moves to an inner element that holds the
   projected content, and the outer `.pop` keeps the border, the radius, the surface and the
   shadow. The `choice` frame without a pointer looks the same as on `dev` (the same computed
   styles in the spec).
5. **The placement with a pointer.** When `pointer` is `true`:
   - the popover opens wholly above or wholly below. It is never pushed over the anchor, and
     `push` is ignored;
   - the distance is measured from `keepInSight` when it is given, else from the anchor. The
     popover's edge is 12 px off that element's edge, so the pointer's tip is 3 to 4 px off
     it;
   - the side the caller asks for (`side`) is tried first, then the other;
   - when neither side fits whole in the viewport less `VIEWPORT_MARGIN`, it opens on the
     side with more room, still off the element. To make room is the caller's job (velista
     `0207` scrolls its row into place first);
   - `align` keeps its meaning against the anchor, with one change: when `keepInSight` is
     given and `align` is `end`, the popover's end lines up with the end of `keepInSight`
     (the row's end, as the board draws it).
6. **The flip moves the pointer.** When the overlay flips to the other side, the pointer moves
   to the other edge and faces the anchor.
7. **An accent state for callers.** An input `accent: boolean`, default `false`, colours the
   popover's border and the pointer's two outer sides with the colour of one custom property
   that the caller sets, `--anchored-popover-accent`. It changes no fill. Velista `0207` uses
   it for its flash. Without the input nothing changes.
8. **Motion.** The pointer has no animation of its own. The `hint` frame's fade stays as it
   is.

### Scope

- Work in `libs/velista/ui/src/lib/list/anchored-popover.{ts,scss,spec.ts}` only.
- Do NOT add the pointer to any existing caller. Do NOT change any caller's template.
- The owner ruled on 2026-11-22 that no existing popover gains a pointer. Only the two
  popovers that the plans name have one: the disabled stepper's popover of velista `0200`
  and the question of velista `0207`. The refused key hint of velista `0188` and every
  other caller listed above keep their look.

### Constraints

- Angular conventions of CLAUDE.md: standalone, `OnPush`, signals, zoneless, `input()`.
- Rule T1, the hygiene spec (`token-hygiene.spec.ts`) and the contrast spec: colours come
  only from tokens. The pointer's size and offsets are SCSS numbers named in one place, with
  a comment that names the board.
- No raw `<svg>`: the pointer is CSS.
- No dashes as punctuation in comments.

### Action boundaries

- Stop and ask if the clip of the `choice` frame cannot move to an inner element without a
  visible change to the add choice, the view picker or the list picker popovers.
- Stop and ask if the overlay cannot report the side it applied in a way the pointer can
  follow.

### Progress evidence

The specs of section 1; `npx nx affected -t lint test`; `npx nx build velista`. The walk is
done through velista `0200` or `0207`, its first callers.

## 1. Specs

In `anchored-popover.spec.ts`:

1. With `pointer` false, the rendered DOM, the classes and the position list are those of
   `dev` for each frame (`note`, `choice`, `hint`), for both sides and every `align`.
2. With `pointer` true and the popover above, the pointer is on the bottom edge; below, on
   the top edge.
3. The pointer's centre is within 1 px of the anchor's horizontal centre, for an anchor at
   the start, the middle and the end of a 390 px wide host.
4. With `keepInSight` given, the box of the popover and the box of the pointer do not
   intersect the box of `keepInSight` or of the anchor, above and below.
5. With `keepInSight` given and `align` `end`, the popover's end edge is the end edge of
   `keepInSight`.
6. A flip (no room above for a popover asked above) puts it below, with the pointer on the
   top edge.
7. With neither side fitting, it opens on the side with more room and does not intersect
   `keepInSight`.
8. In the `choice` frame with a pointer, no ancestor of the pointer inside the popover has
   `overflow: hidden`.
9. With `accent` true, the border and the pointer's border read `--anchored-popover-accent`,
   and the fill is still `--app-surface-raised`.

## 2. Acceptance criteria

- A popover that asks for a pointer points at the centre of its control and covers neither
  the control nor the named row.
- Every existing popover looks and behaves as before.

## Not in this plan

- Any caller of the pointer (velista `0200`, velista `0207`).
- A pointer for the existing popovers.
