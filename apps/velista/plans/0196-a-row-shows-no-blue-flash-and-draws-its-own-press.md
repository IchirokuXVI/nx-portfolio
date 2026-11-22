# 0196: a row shows no blue flash and draws its own press

> Decided on 2026-11-22. On a phone, a tap on the stepper of a zone list row flashes the
> whole row in the browser's blue tap highlight, and the owner does not like it. The row is
> a `role="button"` element with a click handler, so the browser highlights it for any tap
> inside it, the stepper's included. The highlight is also the only feedback a tap on the
> row gives today: the row has no pressed style of its own. The owner asked that no
> functionality is lost, so the row gets its own pressed state, and a press inside the
> stepper, the photo or the choose button does not draw it.
>
> The text selection that a long hold starts is velista `0193`, not this plan. Independent
> of every other plan of this round; it can be built and released alone. Velista `0202`
> and `0203` change the row's layouts later and keep this rule.
>
> Code anchors, on `dev` at `e06813139`: `libs/velista/ui/src/lib/list/line-row.html:10` to
> `:24` (the row element, `role="button"`, `(click)="onRowClick()"`), `:403` (the stepper,
> which stops `pointerdown` and `click`); `libs/velista/ui/src/lib/list/line-row.scss:10` to
> `:32` (`.row`, `.row.inert`); `libs/velista/ui/src/lib/list/quantity-stepper.scss:13` (the
> stepper's own `-webkit-tap-highlight-color: transparent`);
> `libs/velista/ui/src/lib/home/shopping-list-card.scss:52` (a pressed card:
> `background: var(--app-surface-sunken)`).

## Brief for the agent

### Objective

Remove the browser's tap highlight from the zone list row and give the row a pressed
background of its own, drawn only when the press is on the row itself and not on a control
inside it.

### Context

- `-webkit-tap-highlight-color` decides the blue box; only the stepper sets it to
  transparent. The row is the element the browser highlights.
- CSS `:active` applies to every ancestor of the pressed element, so a plain
  `.row:active` would draw for a press on the stepper too.
- `:has()` works in every browser velista supports, the Android WebView of the Capacitor
  app included.
- A reader's row (`.inert`) opens nothing it may not open; it still opens the line.

### Target state

1. `.row` has `-webkit-tap-highlight-color: transparent`, and so do the controls inside it
   that the browser would highlight on their own (the choose buttons, the picture's zoom
   button).
2. `.row:active` draws `background: var(--app-surface-sunken)`, unless the press is inside
   a control: the rule is
   `.row:active:not(:has(lib-quantity-stepper:active, button:active, lib-product-picture:active))`
   or an equivalent the builder proves with the spec of section 1.
3. The press shows at once and goes on release, with no transition longer than
   `--app-motion-fast`, and none under `prefers-reduced-motion: reduce`.
4. The focus ring of `:focus-visible` is unchanged.
5. The due row (`lib-due-line-row`) is a plain button and keeps its look: it has no
   `role="button"` wrapper, so the browser highlights only its own button. Check it on a
   phone; if it flashes too, it gets target state 1 and a pressed state on its `.body`
   button, the same way.

### Scope

- Work in `libs/velista/ui/src/lib/list/line-row.scss` and, only under target state 5,
  `due-line-row`'s styles.
- Do NOT change what a tap does, the stepper, or the row's height.

### Constraints

- Rule T1: semantic tokens only, the hygiene spec passes.
- The contrast spec still passes: the text of a pressed row on `--app-surface-sunken` keeps
  its contrast in Day and Night.

### Action boundaries

- Stop and ask if the pressed background makes any text of the row fail the contrast spec.

### Progress evidence

`npx nx affected -t lint test`; a walk on a slot at 390 by 844 with touch emulation, in Day
and Night: a tap on the row shows the sunken background and no blue; a tap and a hold on
the stepper show neither on the row.

## 1. Specs

In `line-row.spec.ts` (a style rule cannot be asserted through jsdom's `:active`, so assert
the stylesheet):

1. The compiled style of `.row` sets `-webkit-tap-highlight-color: transparent`.
2. The `:active` rule of `.row` excludes the stepper, buttons and the picture (read the
   component's style text and match the selector).

## 2. Acceptance criteria

- No blue flash anywhere on a zone list row, for a tap on the row or on the stepper.
- A tap on the row shows a short sunken background; a tap on the stepper does not.

## Not in this plan

- The selection after a long hold (velista `0193`).
- The dimming while a save is in flight (velista `0197`).
