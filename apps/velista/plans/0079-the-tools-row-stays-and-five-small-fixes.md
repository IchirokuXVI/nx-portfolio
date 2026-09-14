> **PR:** [#362](https://github.com/IchirokuXVI/nx-portfolio/pull/362)

# 0079: the tools row stays, and five small fixes

> Seven independent changes, each too small for a plan of its own, collected so they ship
> together. Nothing here depends on another plan, and no other plan in this series depends
> on this one, except that `0082` reuses the tools row this plan makes sticky.
>
> Prerequisite reading: `0074` sections 3 and 6 (the tools row and the search field this
> plan changes), `0054` (the quantity reel) and `0104`'s client half `0073` section 5.

## Brief for the agent

### Objective

Build the seven changes in sections 2 to 8, in the listed files, with the tests in section
9, and nothing else.

### Context

- The basket's tools row (`.tools`, `.search` and `lib-chip-row` in
  `libs/velista/feature-shopping-lists/src/lib/basket-page/basket-page.html`) is plain
  block flow inside the scroll container `.page`, so it scrolls away with the lines.
- Opening the search replaces the row with a column (label, field, count line), which is
  about twice the height of the closed row.
- The zone list line sheet's link reads "Everything about this line"
  (`list.detail.everything`).
- `ListPage.addAloud` clears `voiceStrip` and awaits `askAboutList`, and nothing is drawn
  while it waits.
- `.voice-strip.failed` (`list-page.scss`) and `.failed` in
  `libs/velista/ui/src/lib/assistant/assistant-message.scss` paint `--app-status-danger-bg`,
  which is translucent (`_themes.scss`, `app-status`). The busy assistant bubble is drawn at
  `opacity: 0.62`.
- `ListPage.composerBusy` is one signal set by both `add` and `addAloud`. `add` resets it
  in its `finally` even while a voice request is still out. `LineComposer.submit()` (Enter)
  and `LineComposer.choose()` (tapping a suggestion) ignore `busy`.
- `QuantityReel` (`libs/velista/ui/src/lib/list/quantity-reel.ts`) opens its overlay and
  captures the pointer on `pointerdown`, and its host has `touch-action: none`. A vertical
  swipe that starts on a reel cannot scroll the page and opens the reel instead.

### Target state

Every acceptance criterion in section 10 holds, every test in section 9 exists and passes,
and `npx nx run-many -t lint test -p velista/ui velista/feature-lists velista/feature-shopping-lists velista/feature-assistant`
is green.

### Scope

- Work only in: `libs/velista/feature-shopping-lists/src/lib/basket-page/`,
  `libs/velista/feature-shopping-lists/src/lib/basket-line-row/`,
  `libs/velista/feature-lists/src/lib/list-page/`,
  `libs/velista/ui/src/lib/list/` (reel, line composer, line row),
  `libs/velista/ui/src/lib/assistant/assistant-message.*`,
  `libs/velista/ui/assets/i18n/en.json` and `es.json`, and the specs beside those files.
- Do NOT touch: `_themes.scss`, `_semantic.scss` tokens, any backend project, any other
  plan's screens.

### Constraints

- Use the `nx-portfolio-angular-developer` skill for Angular conventions and the
  `design-taste-frontend` skill for every visual change (sections 2, 5 and 6).
- Only make the changes this plan names. Do not extract a shared tools row component: `0082`
  decides that when it has a second consumer.
- Token hygiene: `velista/ui`'s `token-hygiene.spec.ts` rejects raw pixel values other than
  `0px` and `1px`. `--app-space-2` is 4px and `--app-space-3` is 8px.
- Never reach for `@angular/core/rxjs-interop` in a service (CLAUDE.md).

### Action boundaries

- Proceed with in-scope reading, editing, lint, test and build.
- Stop and ask before changing a design token, adding a dependency, or changing the reel's
  public inputs and outputs.
- Stop and report if a fix for one section breaks a spec in an unrelated library, rather
  than editing that library.

### Progress evidence

Report once per section, naming the files changed and the test run that proves it. Claim a
section done only after its tests pass.

## 1. What is being built

| Piece                                               | Where                                               |
| --------------------------------------------------- | --------------------------------------------------- |
| The tools row sticks, with the chips under it       | `basket-page.html`, `basket-page.scss`              |
| The search keeps the closed row's height            | `basket-page.html`, `basket-page.scss`, `.ts`       |
| "See more details"                                  | `en.json`, `es.json`                                |
| A message while the assistant works out a recording | `list-page.ts`, `list-page.html`, copy              |
| Solid assistant surfaces                            | `list-page.scss`, `assistant-message.scss`          |
| Nothing is added while the assistant works          | `list-page.ts`, `line-composer.ts`                  |
| A scroll never opens the reel                       | `quantity-reel.ts`, `.scss`, the two row components |

## 2. The tools row stays on screen

Wrap the tools row (closed or searching) and the chip row in one element, `.tools-bar`, and
make it sticky inside `.page`:

- `position: sticky`, `inset-block-start: 0`, and the page's own background colour, read
  from what `.page` paints, so rows never show through it.
- A `z-index` above the rows and below the quantity reel's overlay and every sheet. Check
  the reel overlay's stacking by opening a reel on the first row while the bar is stuck.
- In the standalone build the document scrolls, not `.page`. Sticky still applies. Check
  both modes in the browser (section 11).
- The progress text and the search count stay inside the bar. The empty state and the
  "nothing matches" block stay below it, in the scroll.

## 3. The search keeps the row's height

This **reverses `0074` section 6** on two points, by decision of the product owner on
2026-09-13: the search field has no visible label, and no visible count.

- The open search is one row: the field (icon, input, clear button), Cancel, and the filter
  button. Its block size equals the closed row's, which is `--app-control-height`.
- The `<label>` stays, bound with `for`, and is hidden with the component's own
  `.visually-hidden` rule, copied from `basket-line-row.scss`. There is no shared utility,
  and this plan does not add one.
- The count paragraph is no longer visible. Keep one visually hidden element with
  `role="status"` and `aria-live="polite"` that carries the same `basket.search.count`
  sentence, so a screen reader still hears how many lines match.
- Opening and closing the search must not move the first row of lines by a single pixel.

## 4. See more details

`list.detail.everything` becomes "See more details" in `en.json` and "Ver más detalles" in
`es.json`. The key does not change.

## 5. The assistant says it is working

From the moment `addAloud` sends the recording until `askAboutList` settles, the voice strip
shows `list.add.working` with `lib-spinner-icon` in front of it: "Working out what you
said…" and "Procesando lo que has dicho…". The reply or the failure replaces it exactly as
today. The strip already announces politely, and this state must do the same.

## 6. The assistant's surfaces are solid

- `.voice-strip.failed` and the assistant page's `.failed` bubble keep their danger tint and
  lay it over the opaque surface under it: two background layers, the tint first and
  `--app-surface-raised` second. Do not change the token.
- The busy bubble loses `opacity: 0.62`. It shows that it is busy with the muted text colour
  token and the spinner it already has, if it has one, not with transparency.
- Check both in Night and Day, over a scrolled list.

## 7. Nothing is added while the assistant works

- Split `composerBusy` into `_typedBusy` and `_voiceBusy`, and derive `composerBusy` as
  either. `add` touches only the first, `addAloud` only the second.
- `LineComposer.submit()` and `LineComposer.choose()` return without emitting when `busy()`
  is true, like the button and the stepper already do.
- The text field stays editable while busy. That is a recorded decision in
  `line-composer.ts`, and this plan keeps it.

## 8. A scroll never opens the reel

The reel must tell three gestures apart: a tap, a sideways drag, and a vertical scroll.

- Put the decision in a pure function beside the reel, `quantity-reel-gesture.ts`:
  `classifyReelGesture({ dx, dy, elapsedMs, ended })` answering `pending`, `tap`, `drag` or
  `scroll`, using `QUANTITY_REEL_TAP_SLOP_PX` and `QUANTITY_REEL_TAP_MAX_MS` from
  `libs/velista/models/src/lib/limits.ts`.
  - `drag`: `|dx|` is above the slop and above `|dy|`.
  - `scroll`: `|dy|` is above the slop first.
  - `tap`: ended within the slop and within the time limit.
- The host gets `touch-action: pan-y`, so the browser owns vertical panning. The overlay
  keeps `touch-action: none`.
- `pointerdown` records the start and does nothing visible. It does not capture the pointer.
- The overlay opens, and the pointer is captured, only on `drag` or on `tap`. A tap opens it
  as a tap opens it today.
- `scroll` and `pointercancel` abandon the gesture: no overlay, no change, no commit.
- Keyboard handling does not change.
- `line-row.ts` and `basket-line-row.ts` guard clicks around an open reel on the assumption
  that it opens on `pointerdown`. Re-read both guards and keep what they protect: a tap on
  the row body while a reel is open closes the reel and opens nothing.

## 9. Tests

1. The basket page draws the tools row and the chips inside one `.tools-bar`.
2. The search field has an accessible name from its label, and no visible label or count is
   rendered. The hidden status element carries the count sentence.
3. `list.detail.everything` reads "See more details" and "Ver más detalles".
4. While `askAboutList` is pending, the voice strip shows `list.add.working`, and it shows
   the reply once the promise resolves.
5. A typed add that finishes while a voice request is pending leaves `composerBusy` true.
6. With `busy` true, Enter and a suggestion tap emit nothing.
7. `classifyReelGesture`: a short still press is `tap`, a sideways move past the slop is
   `drag`, a vertical move past the slop is `scroll`, a long still press is not `tap`.
8. The reel opens no overlay on `pointerdown`, and none after a vertical move followed by
   `pointerup` or `pointercancel`.
9. The existing row guard specs in `line-row` and `basket-line-row` still pass, changed only
   where they dispatched `pointerdown` alone to open a reel.

## 10. Acceptance criteria

- [ ] Scrolling a long basket keeps the tools row and the chips visible at the top.
- [ ] Opening and closing the search does not change the row's height.
- [ ] The zone list line sheet's link reads "See more details".
- [ ] A recording in progress with the assistant shows "Working out what you said…".
- [ ] No assistant message or error lets the rows behind it show through.
- [ ] No line can be added, by button, Enter or suggestion, while the assistant works.
- [ ] A vertical swipe that starts on a reel scrolls the page and opens nothing, on the
      basket and on a zone list.
- [ ] A tap and a sideways drag on a reel behave as before.

## 11. Verification

```sh
npx nx run-many -t lint test -p velista/ui velista/feature-lists velista/feature-shopping-lists velista/feature-assistant
npx nx build velista
tools/dev/ng-slot.sh --list
tools/dev/ng-slot.sh --up --apps shell,velista
```

In the browser, at a phone viewport with touch emulation: scroll a basket with more lines
than the screen holds, open and close the search, swipe vertically over a reel on both
pages, and send a voice recording on a zone list. Standalone (velista's own port) and
mounted (`/velista/<locale>`) both. `--down` the slot when finished.
