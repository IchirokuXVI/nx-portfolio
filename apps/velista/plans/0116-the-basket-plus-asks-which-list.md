# 0116: the basket plus asks which list

On the basket, a new line goes to the list chosen next to the composer ("Choose a list", plan
`0110`). Until one is chosen the field is locked, a popover says why, and the choice is
remembered. The user decided on 2026-09-25 to replace all of that with one question at the
moment it matters: pressing the plus, or the add button on a product card, opens a picker with
the lists the reader can add to, and picking one is the add. It asks every time. Adding from
the basket is rare, and one honest tap beats a chip that remembers last week's list.

This is the first of two plans. `0117` makes the composer's field the list search, which needs
a field that is never locked, so this plan lands first.

The mock is `plans/mocks/one-field/` (the `Basket, idle` and `Basket, which list` boards), and
the canvas is https://claude.ai/artifact/3TQcq1qAQcF12We8s4a6pu.

## Brief for the agent

### Objective

On the basket page, remove the target list chip, the remembered target, the locked field and its
popover, and the hint sentence under the title. Add a picker, anchored to the button that was
pressed, that lists the lists the reader can add to. Choosing one adds the line to it.

### Context

- The dock: `libs/velista/feature-shopping-lists/src/lib/basket-page/basket-page.html`, the
  block under `@if (state() === 'ready' && canAdd())`. It holds the `<button class="target">`
  chip (`basket.add.to` / `basket.add.choose`), the `needs-list` popover from plans `0110` and
  `0113`, and `<lib-line-composer>` with `[lockReasonId]` and `(lockedPressed)`.
- The target: `libs/velista/data-access/src/lib/baskets/basket-target-store.ts` (`restore`
  chooses the only list by itself, `canRetarget()` on the page says whether there is more than
  one). The sheet it opens: `libs/velista/feature-shopping-lists/src/lib/target-list-sheet/`,
  reached through the `add/list` sheet route in `libs/velista/feature-shell/src/lib/routes.ts`
  and `openTarget()` on the page. The sheet's title key is `basket.add.sheetTitle`, "Which list
  is it for?" / "¿Para qué lista es?".
- The lock: `lockReasonId` and `lockedPressed` on `libs/velista/ui/src/lib/list/line-composer.ts`,
  the `aria-disabled` field, the guard in the page's suggest effect (`onComposerQuery`,
  `_suggestEffect`) that makes no request without a target, and `basket.add.needsList`.
- The add: `BasketPage.add()` calls `BasketStore.addLine({ targetListId, content, quantity,
  itemIds? })` (`libs/velista/data-access/src/lib/baskets/basket-store.ts`). It is not
  optimistic, and on failure the page puts the words back in the field. `choose(suggestion)` on
  the composer emits `submitted` with the card's `itemIds`, and the page adds at once.
- The card's add button is `.pick` in `libs/velista/ui/src/lib/list/suggestion-list.html`, which
  emits `chose`. Every control in the panel cancels `mousedown` so the keyboard stays up (plan
  `0101`, rule T2).
- The hint: `basket-page.ts` line 389, `hint = computed(() => this.surface()?.hintKey ?? null)`,
  drawn as `<p class="hint">` under the title. The live basket's key is `basket.live.hint`,
  "Every list you can add to, in one place." Grep `hintKey` for where each surface sets it.
- The only anchored popover in velista is `libs/velista/ui/src/lib/list/anchored-popover.ts`
  (plan `0110`), a CDK `cdkConnectedOverlay` closed by an outside tap and by Escape. The group
  help popover in `suggestion-list.html` is the other CDK overlay.
- The picker's rows need each list's name, its zone's name and its pending count. The basket
  view already holds its lists (the `from <list>` caption on every row, and the target sheet's
  rows), so this is a client side join and not a request.

### Target state

- Under the basket title there is no hint sentence. `basket.live.hint` is gone from both
  languages, and `hintKey` with it if nothing else sets one.
- The composer's dock holds only the composer. No chip, no `needs-list` popover, no lock:
  `lockReasonId`, `lockedPressed` and the `aria-disabled` state leave `LineComposer`, the
  suggest effect makes requests with or without a list, and `basket.add.to`,
  `basket.add.choose` and `basket.add.needsList` are gone. The comments that describe the lock
  (plan `0110`) describe the picker instead.
- `BasketTargetStore`, the target sheet, its `add/list` route and `openTarget()` are gone,
  together with anything only they used.
- Pressing the plus with words in the field, or the add button on a card, opens a picker
  anchored above that button: the title "Which list is it for?" (`basket.add.sheetTitle`,
  moved, not rewritten), then one button per list the reader can add to, showing the list's
  name and, under it, the zone's name and its pending count ("Casa · 10 to buy"). Lists are in
  the order the target sheet used.
- A pick adds the line to that list with the words, the quantity and, from a card, its
  `itemIds`, exactly as `add()` does today. Then the field clears, the quantity resets and focus
  returns to the field (`_refocusField()` from plan `0113`). The picker opens every time, also
  when there is exactly one list.
- The picker closes on an outside tap and on Escape, and Escape returns focus to the button
  that opened it. Its buttons cancel `mousedown`, so the keyboard stays up while it is open.
- With no words in the field the plus does nothing, as today. With no list the reader can add
  to, `canAdd()` is false and the dock is absent, as today.
- The picker is a standalone component in `libs/velista/ui/src/lib/list/`, `ListPicker`, with
  plain values in (the rows, the anchor) and one event out (the chosen list id). No store, no
  router. Rows carry the `from` names the page already has.
- `no-output-native` applies in `velista/ui`, so the output is not named `select` or `change`.

### Scope

Work in `basket-page.{html,ts,scss}` and its spec, `line-composer.{ts,html,scss}` (remove the
lock), `suggestion-list.{ts,html}` only if the card's add button needs to report its element as
an anchor, the new `list-picker.*` in `libs/velista/ui/src/lib/list/`, `basket-target-store.ts`
and `target-list-sheet/` (delete), `routes.ts` and `routes.spec.ts` in `feature-shell` (the
sheet route), `libs/velista/ui/assets/i18n/{en,es}.json`, and the specs of each.

Translation anchor: `basket.add.sheetTitle` stays where it is. New keys go in the `basket.add`
block after it. Remove `basket.add.to`, `basket.add.choose`, `basket.add.needsList` and
`basket.live.hint`.

Plan `0117` edits the same dock and `line-composer` right after this. Keep the composer's
inputs and outputs otherwise as they are.

### Constraints

- Use the `nx-portfolio-angular-developer` and `design-taste-frontend` skills.
- The picker is a popover and not a sheet: it has no URL, and it must not close the keyboard.
  Cancel `mousedown`, never `pointerdown` or `touchstart` (plan `0101`, rule T2).
- The picker is never a child of the suggestion panel, which clips and scrolls. Position it
  with a CDK overlay against the button, the way the group help popover is.
- `token-hygiene.spec.ts` rejects raw pixel values except `0px` and `1px`.
- `suggestion-list.scss` is at its `anyComponentStyle` budget. Put nothing new in it.
- Only make changes directly requested.

### Action boundaries

Stop and ask before:

- skipping the picker when there is one list
- remembering a picked list for the next add
- changing the zone list page's composer
- changing `BasketStore.addLine` or anything on the wire

### Progress evidence

- `npx nx run-many -t lint,test -p velista-ui velista-feature-shopping-lists velista-feature-shell velista-data-access`
  green, and `npx nx build velista` green with no new budget warning.
- Specs: no hint under the title, no chip and no lock in the dock, a suggest request with no
  list, the plus opens the picker with every addable list in order, a pick calls `addLine` with
  that list id and the card's `itemIds`, then the field is empty and focused, Escape closes and
  returns focus, one list still opens the picker.
- A browser check at 390 px against a slot with a basket built from two lists: type "queso",
  press the plus, pick a list, and see the line appear under that list's name with the field
  empty and the keyboard still up. Screenshot of the open picker in the PR body.
