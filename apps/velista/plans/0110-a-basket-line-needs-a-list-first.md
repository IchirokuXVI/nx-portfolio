> **PR:** [#489](https://github.com/IchirokuXVI/nx-portfolio/pull/489)

# 0110: a basket line needs a list first

On a basket that gathers more than one list, the composer at the bottom adds a line to the list
chosen next to it ("Choose a list"). With no list chosen, the field works, the typeahead runs,
and then choosing a suggestion or pressing + does nothing, silently. The user wants the
composer disabled until a list is chosen, and a popover that says why.

This reverses a deliberate choice of plans `0091` and `0092`: "the field stays usable while no
target is chosen". The user decides it.

## Brief for the agent

### Objective

On a basket with no list chosen for new lines, disable the composer's field and add button, and
show a popover that tells the user to choose a list first.

### Context

- The dock: `libs/velista/feature-shopping-lists/src/lib/basket-page/basket-page.html`, the
  block under `@if (state() === 'ready' && canAdd())`.
  - With more than one list (`canRetarget()`), a `<button class="target">` opens the target
    sheet (`openTarget()`), labelled `basket.add.to` or `basket.add.choose`.
  - With one list the target is chosen automatically (`basket-target-store.ts`, `restore`).
  - `<lib-line-composer ... [submitDisabled]="target() === null">`. The comment above it
    explains the old rule.
- `libs/velista/ui/src/lib/list/line-composer.{ts,html}`: `submitDisabled` holds the + button
  and makes `choose()` return early. Its class comment says it is "absent without WRITE, never
  disabled".
- The target: `libs/velista/data-access/src/lib/baskets/basket-target-store.ts`.
- The suggest effect on the basket page (`onComposerQuery`, `_suggestEffect`) does not check
  the target.
- The only popover in velista: the group help popover in `suggestion-list.html`, a CDK
  `cdkConnectedOverlay` with `[cdkConnectedOverlayUsePopover]="'inline'"`, closed by an
  outside click and by Escape, positioned by `POPOVER_POSITIONS` in `suggestion-list.ts`.
- Translations: `basket.add` block in `libs/velista/ui/assets/i18n/en.json` and `es.json`.

### Target state

- While a basket's composer has no target list:
  - the text field cannot be typed into and the + button is disabled
  - no suggest request is made
  - the "Choose a list" button next to it stays active and is visually marked as the next step
- Tapping or focusing the disabled composer opens a popover anchored to it: "Choose a list
  first. The new product goes into the list you pick." / "Primero elige una lista. El producto
  nuevo se añade a la lista que elijas.", with a button "Choose a list" / "Elegir lista" that
  opens the same target sheet as `openTarget()`.
- The popover closes on an outside tap, on Escape and when a list is chosen. Focus returns to
  where it was.
- Screen readers: the field is exposed as disabled with a description that says why (use
  `aria-disabled` with `aria-describedby`, so it stays focusable and the popover can open from
  the keyboard).
- Once a list is chosen, the composer works exactly as today, with focus left where it was.
- With one list, nothing changes: the target is chosen automatically.

### Scope

Work in the basket page's composer dock (`basket-page.{html,ts,scss}`), `line-composer.*` in
`libs/velista/ui/src/lib/list` (a new input for the disabled state), the suggest effect's guard
on the basket page, the two translation files, and their specs.

Translation anchor: new keys go in the `basket.add` block, after `sheetTitle`.

Other agents edit `basket-page.{html,ts}` (the header, the search tools, the product link) and
`line-composer` and `suggestion-list` (the suggestion panel's states) at the same time. Touch
only the dock and a new input on `LineComposer`.

If the popover markup is more than a few lines, make it a small standalone component in
`libs/velista/ui` rather than a second copy of the group help popover's wiring.

### Constraints

- Use the `nx-portfolio-angular-developer` and `design-taste-frontend` skills.
- Rewrite the comments that state the old rule ("never disabled", "the field stays usable")
  so that they describe the new one.
- Playwright does not click an `aria-disabled` element without `force: true`.
- `token-hygiene.spec.ts` rejects raw pixel values except `0px` and `1px`.
- Only make changes directly requested.

### Action boundaries

Stop and ask before:

- choosing a list automatically when there is more than one
- changing the zone list page's composer
- changing the target sheet

### Progress evidence

- `npx nx run-many -t lint,test -p velista-ui velista-feature-shopping-lists velista-data-access`
  green, and `npx nx build velista` green.
- Specs: no target disables the field and the button and makes no suggest request, tapping it
  opens the popover, the popover's button opens the target sheet, choosing a list enables the
  composer, one list changes nothing.
- A browser check against slot 3 at 390 px on a basket built from two lists, with a screenshot
  of the popover in the PR body.
