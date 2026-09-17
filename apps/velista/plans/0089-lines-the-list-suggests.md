> **PR:** [#407](https://github.com/IchirokuXVI/nx-portfolio/pull/407)

# 0089: lines the list suggests

> Backend half: `apps/luna-shopper-backend/plans/0123`. Build `0088` first.
> Mock: `mocks/list-trips/`, the rows under "You usually buy these about now".
>
> A household buys milk every week and types nothing: the line is already on the list, at
> zero, waiting for somebody to remember it. This plan lets the list remember. Under what is
> to buy, the page offers the lines that are due, each with the reason and one button that
> puts it back at its usual amount. A suggestion is never a new line and never a row of its
> own in the data. It is a line at zero, drawn early.
>
> Prerequisite reading: `0088`, backend `0123` sections 2 to 5, `0043` section 6 (the
> composer's suggestions, which are a different thing and keep their name), and
> `select-line-detail.ts` for `estimateFrom`.
>
> **Amended on 2026-09-17, before it was built.** The product owner changed the row in
> three ways, and sections 2, 3, 5, 6, 7 and 8 below say the amended design:
>
> 1. A due row carries a quantity stepper that starts at the suggested amount, and the
>    button adds the amount the stepper shows.
> 2. Changing the amount can add the line by itself. That is a switch in code,
>    `DUE_LINE_ADDS_ON_STEP`, and it is **off** in this version.
> 3. The section draws three due lines, and "Show more suggestions" draws the rest. The
>    server answers every due line for this (backend `0125`), and no longer stops at 20.

## Brief for the agent

### Objective

Draw the suggestions of section 2 under To buy, read through a new store, add a suggested
line with one tap, and make the line sheet's estimate merge purchases as the server does.

### Context

- Backend `0123` serves `GET /v1/lists/:id/suggestions`: rows of `lineId`, `reason`
  (`PERIOD` or `STAPLE`), `periodDays`, `daysSinceBought`, `tripsWith`, `tripsSeen`,
  `quantity`, already ordered. Backend `0125` takes the cap of 20 away, so the answer is
  every due line. There is no event and nothing is dismissed.
- `QuantityStepper` in `libs/velista/ui/src/lib/list/` is the composer's stepper. The due
  row reuses it with a floor of one.
- `0088` draws To buy as the page's first group and owns the refetch signal (`0088`
  section 8).
- A row's write ability is `LineRowVm.adjustable`, and the quantity write is the one the
  reel already uses in `LineStore`.
- The composer's typeahead is called suggestions too (`suggestion-list`,
  `CatalogSuggestion`). Those are catalog products. Name nothing here so that the two can
  be confused: this plan says **due lines** in code (`DueLine`, `DueLineStore`,
  `lib-due-line-row`) and "suggested" only in copy.
- `estimateFrom` computes the line sheet's "every N days" from raw settlements. Several
  settlements of one trip give it gaps of zero, which the server's rule now merges away.

### Target state

Sections 2 to 5 hold on the zone list page in both themes, and
`npx nx run-many -t lint test -p velista/ui velista/models velista/data-access velista/feature-lists`
plus `npx nx build velista` are green.

### Scope

- Work only in: `libs/velista/models/src/lib/`, `libs/velista/data-access/src/lib/` (a
  `due-lines/` folder), `libs/velista/ui/src/lib/list/` (one row component),
  `libs/velista/feature-lists/` (the page, its selector, `select-line-detail.ts`), and the
  two translation files.
- Do NOT touch: any backend project, the composer and its suggestion list, the trip
  components of `0088`, browser storage.

### Constraints

- Use the `nx-portfolio-angular-developer` skill, and `design-taste-frontend` for the row.
- Rule D4: map from `unknown`, with a fallback for an unknown `reason`.
- Relative days through `Intl.RelativeTimeFormat` in the current locale, never a
  hand built sentence.
- Amber is the action colour and not an attention colour (memory note on velista UI
  rules). The section uses the attention role for its label and the action role for its
  one button.
- There is no dismissal and no stored state in this plan.

### Action boundaries

- Proceed with in scope edits, specs and a slot for the browser check.
- Stop and ask if `0088` or backend `0123` is not merged.

### Progress evidence

Report after the store with its spec, after the section on the page, and after the
estimate change, each with the spec run.

## 1. What is being built

| Piece                                 | Where                                              |
| ------------------------------------- | -------------------------------------------------- |
| `DueLine` and its mapper              | `models`, `data-access/src/lib/due-lines/`         |
| `DueLineStore`                        | `data-access/src/lib/due-lines/`                   |
| `lib-due-line-row`, with a stepper    | `libs/velista/ui/src/lib/list/`                    |
| `DUE_LINES_SHOWN`, `DUE_LINE_ADDS_ON_STEP` | `models` `due-lines.ts`                       |
| The section under To buy              | `feature-lists` `list-page.*`, the composed view   |
| `estimateFrom` merges close purchases | `feature-lists` `select-line-detail.ts`            |
| Copy                                  | `en.json`, `es.json`                               |

## 2. The section

Inside the To buy group, after its lines and before the zero lines of `0088` section 3, under
a small label, "You usually buy these about now". It is part of To buy and not a group:
it has no fold and no count.

**Who sees it.** Only a person whose rows are `adjustable` on this list. A suggestion that
cannot be taken is noise, so a reader gets no section at all.

**When it is drawn.** Never in reorder mode, never while a search is active, and not at all
when there is nothing to suggest. With a category view on, only the due lines holding that
category are drawn.

**A row** is quieter than a line and visibly not one: a dashed hairline in the attention
role over the attention tint, no reel.

- The line's name, from `LineStore`. A due line whose line is not held, or whose `quantity`
  is already above zero, is not drawn. The second case is what makes a tap feel instant.
- The reason, one sentence. `PERIOD`: "Every 7 days · last bought 5 days ago", the second
  half from `Intl.RelativeTimeFormat`. `STAPLE`: "In 5 of your last 6 shopping lists".
- A quantity stepper, `lib-quantity-stepper`, starting at `quantity` and never below one.
  Moving it writes nothing while `DUE_LINE_ADDS_ON_STEP` is off.
- One button, "Add 2", the number being what the stepper shows. It sets the line's
  quantity to that amount through the reel's own write. The line then appears among the
  lines of To buy at its list position, and the row goes. A failed write puts the row
  back and says why through the page's polite region, because the line's own row, where a
  failed reel write reports, is not drawn while the line is at zero.
- Tapping the name opens the line detail sheet, as everywhere.

**Adding on a change of the amount is a switch.** `DUE_LINE_ADDS_ON_STEP` in `models`
decides it, and it is `false` in this version. With it on, a change of the stepper that
stays quiet for `DUE_LINE_STEP_QUIET_MS` (the reel's own idle window, 1600 ms) adds the
line at the chosen amount. It waits instead of adding on the first press, because the row
leaves the section the moment its line is above zero, and it would take the stepper away
from somebody who meant to press three times. The button stays, for the suggested amount
as it is.

**Three, then all.** The section draws the first `DUE_LINES_SHOWN` (3) due lines. When
more are due, "Show more suggestions" under the rows draws every one of them for the rest
of the visit to that list, and goes away. The rest are already held, so pressing it asks
for nothing. Taking one of the three draws the next due line in its place at once.

**Nothing dismisses a row.** Somebody who does not want the line does not add it, and it
stays. A dismissal that lasts a day on the device is planned as a later improvement.

## 3. Loading and staying current

- `DueLineStore.load(listId)` reads when the page opens, after the lines, and never blocks
  them. A failure draws no section and says nothing: the list works without it.
- It reads again on `0088`'s signal, coalesced with it, because a settle and the end of a
  basket are exactly what change the answer. An overtaken answer is dropped.
- It holds every due line the server answers. Which three are drawn, and whether "Show
  more suggestions" was pressed, is page state, never stored.
- The store is provided by the page component, not by the route: nothing else reads it,
  and a component injector is destroyed with the page.
- A due line enters and leaves without animation beyond the row's own fade. The section
  label goes with its last row.

## 4. The line sheet agrees with the list

`estimateFrom` folds purchases closer than 12 hours into one before it takes the gaps, as
backend `0123` section 3 step 1 does, and counts `ESTIMATE_MIN_PURCHASES` after the fold.
Nothing else in it changes: the median, the rounding and the rough range stay. Without
this the sheet says "every 3 days" of a line the list calls "every 7 days", whenever a
trip wrote two settlements.

## 5. Copy

| Key                      | English                                            | Spanish                                            |
| ------------------------ | -------------------------------------------------- | -------------------------------------------------- |
| `list.due.label`         | You usually buy these about now                    | Sueles comprar esto por ahora                      |
| `list.due.period`        | Every {{days}} days · last bought {{when}}         | Cada {{days}} días · última compra {{when}}        |
| `list.due.periodOne`     | Every day · last bought {{when}}                   | Cada día · última compra {{when}}                  |
| `list.due.staple`        | In {{with}} of your last {{seen}} shopping lists   | En {{with}} de tus últimas {{seen}} listas         |
| `list.due.add`           | Add {{count}}                                      | Añadir {{count}}                                   |
| `list.due.addLabel`      | Add {{count}} of {{name}} to the list              | Añadir {{count}} de {{name}} a la lista            |
| `list.due.quantityLabel` | How many of {{name}}                               | Cuántos de {{name}}                                |
| `list.due.more`          | Show more suggestions                              | Ver más sugerencias                                |
| `list.due.added`         | {{name}} added to the list                         | {{name}} añadido a la lista                        |

## 6. Accessibility

- The label is a heading one level below To buy.
- The button's accessible name is `list.due.addLabel`, because "Add 2" twenty times over
  says nothing to a screen reader. The stepper's is `list.due.quantityLabel` for the same
  reason.
- After a tap, focus moves to the next due row's button, or to the added line's row when
  no due row is left (the section and its label go with the last row), and the polite
  status element says the line was added.
- "Show more suggestions" moves focus to the first row it drew.

## 7. Tests

1. The mapper refuses a malformed row and falls back on an unknown `reason`.
2. A reader sees no section. A writer does.
3. A due line whose line is above zero, or not held, is not drawn.
4. The section is absent in reorder mode, during a search, and when the answer is empty.
5. A category view keeps only due lines of that category.
6. Add writes the stepper's amount through the reel's write, the row goes at once, and a
   failed write brings it back. The stepper starts at `quantity` and stops at one.
10. With `DUE_LINE_ADDS_ON_STEP` off a change of the amount writes nothing. With it on, a
    burst of presses is one add after the quiet window, and pressing the button during
    the wait adds once.
11. Three rows are drawn, "Show more suggestions" draws every one, and it is absent at
    three or fewer.
7. `PERIOD` and `STAPLE` rows draw their sentences, the relative day through `Intl`. A
   period of one day uses `periodOne`.
8. The store reads again on the shared signal, once per burst.
9. `estimateFrom`: three settlements within an hour are one purchase, and a history that
   folds below the minimum gives null.

## 8. Acceptance criteria

- [ ] A writer sees, under what is to buy, the lines at zero that are due, with the reason.
- [ ] One tap puts a due line back on the list at its usual amount, or at the amount the
      stepper was moved to.
- [ ] Moving the stepper adds nothing while `DUE_LINE_ADDS_ON_STEP` is off.
- [ ] Three due lines are drawn, and "Show more suggestions" draws the rest.
- [ ] No line is created and nothing is stored on the device.
- [ ] A line that a live basket holds is never offered.
- [ ] The line sheet and the list state the same period for the same line.

## 9. Verification

```sh
npx nx run-many -t lint test -p velista/ui velista/models velista/data-access velista/feature-lists
npx nx build velista
tools/dev/ng-slot.sh --list
tools/dev/ng-slot.sh --up --apps shell,velista
```

A due line needs three purchases days apart, which a fresh slot does not have. Settle a
line three times by hand, then move the three `settledAt` values back in the slot's core
database (memory note on the velista visual check session), reload, and check the row, the
tap and both themes at a phone viewport. Then give the slot back.
