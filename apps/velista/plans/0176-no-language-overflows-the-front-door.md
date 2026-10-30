# 0176: no language overflows the front door

> Asked for by the owner on 2026-10-30, with `0175`: an e2e test that the landing page fits
> the screen with nothing cut and nothing scrolled, **in every language the app offers**,
> not only English and Spanish, at the five most common phone sizes from 844 px tall down to
> 640 px.
>
> **Needs `0175` first, or in the same PR.** On `dev` today the landing scrolls by 8 px at
> 390 by 844 and by 205 px at 360 by 640, so this test fails until `0175` lands. If `0175`
> is not on the branch, build the spec, run it, report the failures it finds, and stop.
>
> Every fact below was read on `dev` at `8a01d669f` on 2026-10-30.
>
> Prerequisite reading: `0175` (all of it, above all target states 1, 5, 6, 7 and 8), plan
> `0071` (the held ways in), plan `0173` (the terms line), `apps/velista-e2e/src/landing.spec.ts`,
> `apps/velista-e2e/src/startup-gate.spec.ts` and `apps/velista-e2e/src/support/gateway.ts`.

## Brief for the agent

Load the `nx-portfolio-angular-developer` skill before you write code.

### Objective

One Playwright spec in `velista-e2e` loads the landing page in every locale the language
control offers, at five phone sizes, in the states that change its height, and fails if any
of them scrolls, cuts text, pushes the foot off the screen, or draws a count that does not
match the card's rows.

### Context

- **The suite.** `apps/velista-e2e/playwright.config.ts` runs `./src` against
  `VELISTA_BASE_URL` or a dev server on 4205, in five projects: Mobile Chrome (Pixel 5),
  Mobile Safari (iPhone 12), and three desktop browsers. The gate
  `k8s/e2e/velista-luna/gate.env` triggers on `velista-e2e`, so this spec runs before a
  staging deploy of velista.
- **The language control** is `.locale` in the app bar. Opening it draws
  `.menu [role="menuitem"]`, one item per usable locale, with the locale code as its text
  (`landing.spec.ts` uses it). The usable locales are `APP_USABLE_LOCALES`, today `en` and
  `es`. Each locale's landing is `/<locale>`.
- **Gateway stubs.** `support/gateway.ts` exports `stubBackendReady(page, settings?)` (health
  and `GET /v1/legal/settings`, with `STUB_LEGAL_SETTINGS`: Google offered, terms published)
  and `stubBackendUnreachable(page)`. `startup-gate.spec.ts` shows both in use.
- **What changes the page's height:** the terms line under Google (Google offered and terms
  published), the held sentence while the backend is not ready (`startup.actions.connecting`,
  then `startup.actions.slow` after the wall clock delay of plan `0071` D8), and the delete
  notice (in memory only, after an account delete, not reachable from a URL).
- **The scroller** is `.app-page` (`overflow-y: auto`), not the document.
- **The hooks `0175` adds:** `data-preview-row` on each card row, `data-settled` on a
  settled one, and `data-pending` and `data-rows` on each count variant.

### Target state

1. A new spec, `apps/velista-e2e/src/landing-fit.spec.ts`.
2. **Locales are read, not listed.** The spec opens `/en`, opens the language control, and
   reads the locale codes from its menu items. It asserts there is at least one, then runs
   every check below for each. A locale added to `APP_USABLE_LOCALES` is covered with no
   change to the spec.
3. **Five sizes:** 390 by 844, 375 by 812, 360 by 800, 375 by 667, 360 by 640, set with
   `page.setViewportSize`.
4. **Two states:**
   - **Ready**: `stubBackendReady` with `STUB_LEGAL_SETTINGS`, so Google and the terms line
     are drawn. This is the tallest normal state.
   - **Held**: `stubBackendUnreachable`, checked after the slow sentence appears. Use
     `page.clock` to move past the delay rather than waiting for it.
5. **Before measuring:** the headline is visible, `document.fonts.ready` has resolved, and
   the four card photos (or the glyph tiles) have loaded or failed. No fixed sleeps.
6. **Checks, for every locale, size and state:**
   - `.app-page` does not scroll: `scrollHeight <= clientHeight`. Neither does the document.
   - The foot, and each of Privacy, Terms and the version inside it, has a bounding box fully
     inside the viewport.
   - Every visible element under the page lies inside the viewport horizontally.
   - No button, link, headline line, terms line or foot item is cut: for each,
     `scrollWidth <= clientWidth`. The card's second lines and names are excluded: they cut
     with an ellipsis on purpose.
   - The first way in starts at least 12 px below the card's bottom edge, when a card is
     drawn.
7. **Card checks, Ready state only:**
   - At least two `[data-preview-row]` are visible.
   - Exactly one count variant is visible. Its `data-rows` equals the number of visible rows,
     its `data-pending` equals the visible rows without `data-settled`, and its text contains
     both numbers.
8. **Card checks, Held state:** if rows are visible, the count matches them as above. Zero
   rows is allowed here (`0175` target state 7).
9. **Projects.** The spec runs in Mobile Chrome and Mobile Safari and skips the desktop
   projects, which have no phone sizes to check. The skip names the reason.
10. **One test per locale and size**, generated in a loop, each named like
    `es 360x640 ready`, so a failure names the case without opening the trace.
11. **A failure says what overflowed**: the element (its class or role and text) and by how
    many pixels.

### Scope

- `apps/velista-e2e/src/landing-fit.spec.ts` (new)
- `apps/velista-e2e/src/support/` if a helper is shared with other specs

### Constraints

- Measure in the browser with `getBoundingClientRect`, `scrollWidth` and `scrollHeight`,
  never by screenshots.
- No hard coded list of locales. No hard coded copy, except where a check reads a number out
  of the count.
- No fixed waits.
- `prettier` per file.

### Action boundaries

- Change no app code. A failure this spec finds is fixed in `0175`'s files, in the same PR
  if `0175` is open, otherwise reported.
- Do not change `playwright.config.ts` or the gate.

### Progress evidence

- `npx nx e2e velista-e2e -- --grep landing-fit` green against a slot (`tools/dev/ng-slot.sh
  --up --apps velista`), in both mobile projects.
- The same command against `dev` without `0175` fails, and its output names the cases at
  360 by 640 and 390 by 844. Paste that failure in the PR description.
- The number of generated tests is locales × 5 sizes × 2 states, printed by the run.

## 1. Decisions

- **D1. Locales come from the language control**, because that is what a person can choose.
  A locale with assets but not usable cannot be reached and does not need to fit.
- **D2. Five sizes** cover the common phone heights between 844 and 640 px: iPhone 12 to 14
  (390 by 844), iPhone X to 13 mini (375 by 812), common Android (360 by 800), iPhone SE and
  8 (375 by 667), and the smallest Android the app supports (360 by 640).
- **D3. The held state is tested** because a person opening a shared link on a slow network
  sees it first, and its sentence adds a line.

## 2. Not in this plan

- The delete notice. It lives in memory only and is not reachable from a URL. `0175` makes
  the card give way to it by the same rule.
- Landscape and desktop sizes.
- Visual comparison against the mock.
