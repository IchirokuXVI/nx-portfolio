# 0113: composer follow ups

Three follow ups to plans `0108` and `0110`, found on a phone:

1. The popover that says to choose a list first has a "Choose a list" button, but it opens right
   above the "Choose a list" chip that does the same thing. The button is not needed.
2. After a list is chosen in the target sheet, focus does not go back to the composer's field.
3. With one product in the typeahead, the suggestion panel scrolls a few pixels.

## Brief for the agent

### Objective

Remove the popover's button, put focus on the composer field after a list is chosen, and stop
the one card suggestion panel from scrolling.

### Context

- **The popover** (plan `0110`): `AnchoredPopover` in
  `libs/velista/ui/src/lib/list/anchored-popover.ts` projects its content. The basket page
  (`libs/velista/feature-shopping-lists/src/lib/basket-page/basket-page.html`, the
  `needs-list` block) projects a sentence and a `.needs-list-action` button calling
  `chooseFromNeedsList()`. The key is `basket.add.needsListAction`, used nowhere else. The token
  `--app-anchored-popover-width` in `_semantic.scss` is described as fitting "two short
  sentences and a button".
- **Focus.** `openTarget()` in `basket-page.ts` opens `TargetListSheet`
  (`target-list-sheet.ts`), whose `choose(list)` calls the target store and then
  `SheetNavigation.dismiss`. `SheetShell` returns focus only on Escape and the scrim, and to the
  element that opened it (the chip). `LineComposer.focusField()` exists, and the basket page
  wraps it as `_refocusField()`, which sets `_quietFocus` so that the focus does not reopen the
  popover. `BasketTargetStore.restore` also sets the target on page load.
- **The scroll.** In `libs/velista/ui/src/lib/list/suggestion-list.scss`, the touch target
  pseudo elements (`.chains::after`, `.reveal::after`, `.details::after`) extend
  `(--app-touch-target - --app-chain-mark) / 2` = 13 px above and below the card's last row,
  and the card's bottom padding is 8 px. So they stick out 5 px below the last card and give
  the `overflow-y: auto` panel 5 px to scroll, whatever the card count.

### Target state

1. The popover holds only its sentence. `chooseFromNeedsList()`, `.needs-list-action`, its spec
   and `basket.add.needsListAction` in both languages are gone. The popover's accessible name
   and Escape behavior are unchanged, and the width token's comment matches its content.
2. After a list is chosen in the target sheet, whether the sheet was opened from the chip or
   from a tap on the locked field, focus lands on the composer's field once the sheet is gone,
   and the popover does not reopen. Dismissing the sheet without a choice behaves as today. The
   target set by `restore` on page load moves no focus.
3. The suggestion panel has no scrollable overflow with one, two or three cards: its
   `scrollHeight` equals its `clientHeight`. The touch targets keep their full 44 px, measured
   with `getBoundingClientRect`. Fix it inside the card (padding, or a touch target that stays
   within it), not by clipping the panel.

### Scope

Work in the basket page's composer dock and focus logic (`basket-page.{html,ts,scss}` and its
spec), `target-list-sheet.ts` only if focus needs its help, `libs/velista/ui/src/lib/list`
(suggestion list stylesheet, anchored popover comment), `_semantic.scss` for the token comment,
and the two translation files.

Translation anchor: only remove `basket.add.needsListAction`. Add nothing.

Another agent edits the basket page header at the same time. Touch only the dock, the popover
and the focus logic.

### Constraints

- Use the `nx-portfolio-angular-developer` and `design-taste-frontend` skills.
- `suggestion-list.scss` is near the `anyComponentStyle` budget. Read the warning in
  `npx nx build velista` before and after, and do not raise the budget.
- On iOS, a programmatic focus does not always raise the keyboard. Do not fight that, but note it in the PR.
- Only make changes directly requested.

### Action boundaries

Stop and ask before:

- changing `SheetShell`'s focus return for every sheet
- raising the style budget

### Progress evidence

- `npx nx run-many -t lint,test -p velista/ui velista/feature-shopping-lists` green, and
  `npx nx build velista` green with no new budget warning.
- Specs: no button in the popover, focus on the field after a choice from both openings, no
  focus move on restore, and a style spec or a browser measurement for the panel overflow.
- A browser check at 390 px: a one product search ("tofu") shows a panel that cannot be
  scrolled, and choosing a list leaves the caret in the field.
