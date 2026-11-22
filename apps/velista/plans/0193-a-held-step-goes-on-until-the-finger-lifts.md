# 0193: a held step goes on until the finger lifts

> Decided on 2026-11-22. The owner tried the stepper of velista `0188` on staging with a
> phone: holding minus or plus repeats, but the repeat stops as soon as the finger moves a
> little, so on a phone it stops at random and it is hard to keep stepping. A hold that lasts
> also selects the text of the row in blue. Both are fixed here, and nothing the stepper
> does today may be lost.
>
> Amends velista `0188` (the hold, S8b, and the section on the buttons). Independent of every
> other plan of this round (velista `0194` to `0204`, backend `0273`): it can be built and
> released alone. Velista `0194` changes the timing of the same repeat and touches other
> lines of the same file; build them in either order.
>
> Prerequisite reading: velista `0188` (the stepper, the hold, why a hold never reaches 0,
> why the release of a hold is swallowed, the second finger rule).
>
> Code anchors, on `dev` at `e06813139`:
> `libs/velista/ui/src/lib/list/quantity-stepper.html:20` to `:45` and `:81` to `:96` (the two
> buttons and their pointer bindings: `pointercancel`, `pointerdown`, `pointerleave`,
> `pointerup`); `libs/velista/ui/src/lib/list/quantity-stepper.ts:334` (`_onScroll`), `:390`
> (`startHold`), `:425` (`endHold`), `:544` (`_stopRepeat`), `:555` (`_repeat`);
> `libs/velista/ui/src/lib/list/quantity-stepper.scss:46` to `:66` (`.step`, with
> `touch-action: manipulation` and `user-select: none`);
> `libs/velista/ui/src/lib/list/quantity-stepper.spec.ts` (the hold specs).

## Brief for the agent

### Objective

Make a hold on minus or plus repeat until the finger or the mouse button is lifted, even
when the pointer moves off the button, and make a long hold select no text anywhere on the
page. Keep every other behaviour of the stepper exactly as it is.

### Context

- The repeat ends today in three ways while the finger is still down:
  1. `pointercancel`. The buttons allow panning (`touch-action: manipulation`), so a small
     vertical drift makes the browser take the touch for a scroll, and it cancels the
     pointer. This is the cause the owner feels on a phone.
  2. The capture `scroll` listener (`_onScroll`), which stops the repeat on any scroll.
  3. `pointerleave`, for a mouse or a pen that leaves the button. A touch pointer is
     captured by the browser on its own, so a finger mostly ends through 1 and 2.
- A long press on a phone starts a text selection. The buttons have `user-select: none`,
  but the browser selects the nearest text of the row (the label), and that is the blue the
  owner sees after a hold.
- The release of a hold that repeated is swallowed (`_swallowClick`), so the click that
  follows adds no extra step. A second finger never undoes that.

### Target state

1. **A hold is claimed once it repeats.** From the first repeat until the pointer goes up,
   the stepper calls `preventDefault` on the `touchmove` events of that touch, through a
   listener added with `{ passive: false }` while the hold is active and removed when it
   ends. The page does not scroll, so the browser sends no `pointercancel`, and the repeat
   goes on wherever the finger goes.
2. **Before the first repeat, a move is still a scroll.** During the wait before the first
   repeat (`QUANTITY_HOLD_DELAY_MS`) nothing is prevented: a swipe that starts on a button
   scrolls the list as it does today, the browser cancels the pointer, and the hold ends
   with no step.
3. **The pointer is captured on `pointerdown`** (`setPointerCapture`), for every pointer
   type. `pointerleave` no longer ends the hold, so a mouse that slides off keeps repeating
   too. `pointerup` and `pointercancel` still end it.
4. **A press that wandered does not step.** A pointer that left the button's box before the
   first repeat, and is released, makes no step on its click: with capture the click now
   reaches the button, which it did not before. The rule is the one of today, kept: only a
   press released on the button steps.
5. **No selection during a hold.** While a hold is down the stepper prevents
   `selectstart` on the document (a capture listener added on `pointerdown` and removed on
   the end of the hold) and clears a selection that started anyway. The buttons also get
   `-webkit-touch-callout: none`. Outside a hold nothing changes: the name of a row can
   still be selected and copied by a long press on the name.
6. Everything else stays: the release of a hold is swallowed, a repeat never reaches 0, the
   second finger rule, `contextmenu` prevented, keys, the sheets' typing.

### Scope

- Work in `libs/velista/ui/src/lib/list/quantity-stepper.{ts,html,scss,spec.ts}` only.
- Do NOT change the timing of the repeat (velista `0194`), the step rule (velista `0195`) or
  the row around the stepper (velista `0196`).
- Do NOT add `touch-action: none` to the buttons: a swipe that starts on a stepper must
  still scroll the list (target state 2).

### Constraints

- Zoneless, `OnPush`, signals. Listeners added by hand are removed in `endHold` and on
  destroy (the `DestroyRef` hook already ends the hold).
- No dashes as punctuation in comments.
- Rule T1: no raw values in the stylesheet beyond the property this plan adds.

### Action boundaries

- Stop and ask if a browser refuses `preventDefault` on `touchmove` after the hold has
  started (a console warning "Ignored attempt to cancel a touchmove event"): that means the
  pan began first, and the design of target state 1 needs the owner.
- Stop and ask before changing any behaviour target state 6 lists.

### Progress evidence

The specs of section 2 passing; `npx nx affected -t lint test`; `npx nx build velista`; a
walk on a slot at 390 by 844 with touch emulation: hold plus, drag the finger 60 px up and
40 px sideways, and the amount keeps rising until release; a swipe that starts on a button
scrolls; no text is selected after a 3 second hold.

## 1. Why the capture alone is not enough

Pointer capture keeps the events on the button, but it does not stop the browser from
deciding that a moving touch is a scroll. That decision is what sends `pointercancel`, and
only `touch-action` or a cancelled `touchmove` prevents it. `touch-action: none` would make
every stepper a dead zone for scrolling, two 48 px squares on every row of a long list. A
`touchmove` cancelled only after the hold has started is the narrow fix: the finger has
been still for `QUANTITY_HOLD_DELAY_MS` by then, so the first move is still cancelable.

## 2. Specs

In `quantity-stepper.spec.ts`, with fake timers and synthetic pointer and touch events:

1. A hold that repeated, then a `pointerleave`, keeps repeating; `pointerup` ends it.
2. A `touchmove` during the repeat is `defaultPrevented`; a `touchmove` before the first
   repeat is not, and the `pointercancel` that follows ends the hold with no step.
3. `setPointerCapture` is called on `pointerdown` of a button that is not at an end.
4. A press that left the button before the first repeat and is released steps nothing.
5. A `selectstart` during a hold is prevented; one after the hold ended is not.
6. The listeners of 2 and 5 are gone after `pointerup`, after `pointercancel` and on
   destroy.
7. The existing hold specs pass unchanged (swallowed release, no repeat to 0, second
   finger).

## 3. Acceptance criteria

- On a phone, a hold keeps stepping while the finger wanders, until it lifts.
- A swipe that starts on a stepper still scrolls the list.
- A hold of any length selects no text and opens no callout.
- A long press on a row's name still selects the name.
- Every spec of `0188` passes unchanged.

## Not in this plan

- The speed of the repeat (velista `0194`).
- The tap highlight of the row and its pressed state (velista `0196`).
