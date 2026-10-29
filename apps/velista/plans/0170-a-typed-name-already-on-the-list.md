# 0170: a typed name already on the list

> Asked for by the owner on 2026-10-27, with backend `0228`. The owner picked the mocks in
> `apps/velista/plans/mocks/duplicate-line/` (PR #843, round two):
>
> - **One line holds the typed name**: the plus adds to it, and the row that took the units
>   shows an amber edge on its quantity for 2.5 s. Nothing marks the row before the press
>   (alternatives A and B were rejected).
> - **Two or more lines hold it**: alternative D. The plus opens a small popover held
>   against it that lists the lines, each with `2 → 3`, and "A new line" last. The title
>   wraps on as many lines as it needs, and a long name never pushes a count out.
> - **Basket**: the list picker comes first, as today, and D appears in the same popover
>   after a list is picked.
> - Popovers are small, with rows of 48 px. Every screen above was drawn with the keyboard
>   open.
>
> **Needs backend `0228` merged first**: it owns `askIfAmbiguous`, `intoLineId`, `newLine`
> and the `line_add_needs_choice` refusal. Build nothing of `0228` here. If those fields are
> not on `dev`, say so and stop.
>
> Every fact below was read on `dev` at `83f982bd` on 2026-10-27.
>
> Prerequisite reading: backend `0228` (all of it), plan `0116` (the basket plus asks which
> list), plan `0117` (one field finds and adds), plan `0144` (the name a row shows), the
> canvas `apps/velista/plans/mocks/duplicate-line/index.html`, and in the code the files
> named under Context.

## Brief for the agent

Load the `nx-portfolio-angular-developer` skill before you write code, and
`design-taste-frontend` before you touch a template or a stylesheet.

### Objective

A free text add on the zone list and on the basket follows backend `0228`. A merge keeps the
raised row in its place and marks its quantity for 2.5 s. A `line_add_needs_choice` refusal
opens alternative D against the plus, and the person's pick is sent back as `intoLineId` or
`newLine: true`.

### Context

- **The answer's `merged` is thrown away on the list page.** `LineApi.addLine`
  (`libs/velista/data-access/src/lib/lines/line-api.ts:79-97`) returns only `line`.
  `addLineResult` (`:99-139`) reads `merged` but `LineStore.addLine` calls `addLine`
  (`line-store.ts:585`).
- **A merge moves the raised row today.** `LineStore.addLine` puts an optimistic row at the
  end (`line-store.ts:545-583`). On the answer, `_settleAdd` (`:1655-1672`) replaces that
  pending row with the server's line and filters the line's old row out. A merged line thus
  jumps to the slot of the optimistic row. With an amber edge on it, the person would see
  the row leave its place.
- **The list page.** `add()` (`libs/velista/feature-lists/src/lib/list-page/list-page.ts:1785-1828`)
  calls `LineStore.addLine`, clears the query, and announces the line's name. A failure goes
  to `_reportPageError`.
- **The basket page.** `askWhere` (`basket-page.ts:2182`) opens `ListPicker` against the
  plus, `pickList` (`:2193`) picks, and `_addTo` (`:2433-2470`) calls `BasketStore.addLine`.
  A failure restores the words with `_composer()?.restore(...)` and says a generic error.
  The basket add is not optimistic.
- **The popover exists.** `libs/velista/ui/src/lib/list/anchored-popover.ts` (a CDK overlay
  held against a button) is what `list-picker.ts` uses.
- **A refusal with a question exists.** `line-merge-question.ts` in `feature-lists` turns
  `line_merge_required` into a question. A new code also needs
  `libs/velista/models/src/lib/problem.ts` and `errors.ts`, or it falls back to a generic
  code.
- **Rows already know how to draw a line.** A list row's name follows plan `0144` (the line's
  own name, or its product's name in the viewer's locale), and its second line is the
  product's brand and size from the catalog read the list already holds. The catalog lookup
  route (`POST /v1/catalog/items/lookup`) reads products the client does not have.

### Target state

1. **Every free text add sends `askIfAmbiguous: true`**, on the list page and the basket.
   A card add (`itemIds` set) sends nothing new.
2. **`LineStore.addLine` returns `merged`** and, on a merged answer, drops its optimistic
   row and patches the answered line **in place**. If that line is not loaded, it is
   inserted where the list's order puts it. The same fix applies to the event echo, so a
   `line.updated` that arrives first does not leave a pending row behind.
3. **No optimistic row when the loaded lines say a merge or a question is likely.** If any
   loaded line that holds a product has the folded typed name, the add waits for the
   server, which is quick, instead of drawing a row that would vanish. Otherwise the
   optimistic row is drawn as today. The server's answer always wins.
4. **A merged add marks the row.** The quantity chip of the raised row takes an amber
   border, 1.5 px, for 2.5 s, then returns to plain. Take the colour from the semantic layer
   in `libs/velista/ui/src/lib/styles/_semantic.scss`, the amber of the held stepper's
   border if a token for it exists. If none fits, add one semantic token there with its
   Night value. Never a literal colour: `token-hygiene.spec.ts` checks it. If the row is off screen, the list scrolls it into view
   first. The live region says "{{name}}, {{quantity}}". On the basket the basket row of
   that line takes the same edge.
5. **`line_add_needs_choice` opens D** against the plus, in `anchored-popover`:
   - Title: "{{name}} is already on your list" (basket: "…on this list"). It wraps and is
     never clamped. A word with no spaces breaks anywhere.
   - One row per entry of `details.lines`, in that order: a 30 px thumb, the line's name,
     the product's brand and size (from the loaded catalog or one lookup of the missing
     `itemIds`), and `{{quantity}} → {{quantity + n}}` where `n` is the composer quantity.
     The name and the product line cut with an ellipsis. The count never shrinks.
   - "A new line" last, with the dashed plus thumb the list already uses for a line with
     no product.
   - Width 276 px, rows at least 48 px, title 15 px, rows 14.5 px and 12 px. If the rows do
     not fit above the keyboard, the rows scroll inside the popover and the title stays.
   - A row sends the same add with `intoLineId`. "A new line" sends it with
     `newLine: true`. Escape, a tap outside, and the back gesture close it.
   - The words stay in the field while the popover is open, and after a close.
   - Focus moves to the first row when it opens and returns to the plus when it closes.
6. **Basket**: the list picker opens first, unchanged. After a pick, a refusal swaps the
   popover's content to D in place, with "‹ {{list name}}" above the title that returns to
   the picker. A merge closes the popover and marks the basket row (target 4).
7. The new strings exist in English and Spanish. The refusal maps to the model through a
   mapper from `unknown` (rule D4): `AddChoice { lines: AddChoiceLine[] }`.

### Scope

- `libs/velista/models`: `problem.ts`, `errors.ts`, a new `add-choice.ts`.
- `libs/velista/data-access`: `line-api.ts`, `line-store.ts`, `line-memory.ts` (the double
  mirrors backend `0228`), `basket-api.ts`, `basket-store.ts`, `basket-memory.ts`, the
  mappers, and their specs.
- `libs/velista/ui`: a new `add-choice` component (the popover's content), reusing
  `anchored-popover`, and the amber edge as an input of the row's quantity chip.
- `libs/velista/feature-lists` (`list-page`) and `libs/velista/feature-shopping-lists`
  (`basket-page`).
- The translation JSON of the libraries that own the strings.
- This plan file: section 6 at the end and the `> **PR:**` line at the top.

### Constraints

- Follow the mocks for size and placement. Do not add a hint before the press: the owner
  rejected A and B.
- No inline `<svg>` in a feature or ui component. Reuse the icons in `libs/shared/ui`.
- No `@angular/core/rxjs-interop` in code that every remote provides.
- No `Location.back()` without a fallback (the back rule in CLAUDE.md).
- Respect `prefers-reduced-motion`: the edge appears and disappears with no transition when
  motion is reduced.

### Action boundaries

- Do not change the backend. If a field of backend `0228` is missing or named differently,
  stop and say so.
- Do not draw a "2 on it" mark in the basket's list picker (section 1, D3).

### Progress evidence

- Specs: `LineStore` merged answer in place, no jump, no ghost row; the optimistic rule of
  target 3; the mapper of `line_add_needs_choice`; the D component's rows, ellipsis and
  focus; the basket's swap from picker to D and back.
- A browser walk on a slot with a backend that has `0228` (see the velista browser check
  recipes): one candidate raises in place with the edge; two candidates open D; each D
  answer does what it says; the basket does the same after a pick. Screenshots at 390 px.
- `npx nx run-many -t lint test build -p velista` and the affected libraries pass.

## 1. Decisions

- **D1. The backend decides, the client asks** (the owner, answer 3). The client never
  decides "one" or "two or more" by itself. It only predicts, to skip an optimistic row that
  would vanish.
- **D2. A bought line counts, from 0 to 1** (the owner, answer 1). The D rows show `0 → 1`
  for such a line. Nothing else marks it.
- **D3. No "2 on it" mark in the basket's list picker.** The round two mock drew one. The
  basket holds only lines still to buy, and answer 1 makes bought lines count, so a count
  read from the basket would be wrong exactly when it matters. The second step asks
  correctly anyway. The owner can ask for the mark back, backed by a server count, in a
  later plan.
- **D4. 2.5 s** for the amber edge (the owner).

## 2. Strings

| Key | English | Spanish |
| --- | --- | --- |
| `list.addChoice.title` | {{name}} is already on your list | {{name}} ya está en tu lista |
| `basket.addChoice.title` | {{name}} is already on this list | {{name}} ya está en esta lista |
| `list.addChoice.newLine` | A new line | Una línea nueva |
| `list.addChoice.row` (aria) | Add {{added}} to {{name}}, {{product}}: {{from}} to {{to}} | Añadir {{added}} a {{name}}, {{product}}: de {{from}} a {{to}} |
| `list.addChoice.merged` (live) | {{name}}, {{quantity}} | {{name}}, {{quantity}} |

## 3. Not in this plan

- The backend (`0228`).
- A near match ("leche" against "leche entera").
- Card adds. Their held stepper already says where a product goes.

## 4. Known limit, from backend `0228` section 2

The match is on the name the line was stored with. A line added from the catalog in another
locale keeps that locale's name, so typing the name in this locale does not meet it, and the
add creates a line as today.

## 5. Choices that are mine

- No optimistic row when a loaded product line has the typed name (target 3).
- Focus on the first row when D opens.
- D3, the picker without a mark.

## 6. What the build decided

Built against the field names of backend `0228` as its plan states them (`askIfAmbiguous`,
`intoLineId`, `newLine`, `line_add_needs_choice` with `details.lines`), while `0228` was being
built beside it. The browser walk of Progress evidence runs once both halves are in.

1. **The list page's composer holds its words now** (`holdOnSend`, as the basket's has since
   `0116`). The page clears them at once for an add that draws its row, so a run of adds is as
   quick as before, and keeps them for an add that waits for the server. That is how the words
   stay in the field while D is open and after a close, and how D gets the plus to stand on.
   Escape belongs to D while it is open (`escapeClears` is off then).
2. **Target 3 predicts on any loaded line with the folded name**, not only one that holds a
   product, and never on a turned down line. A free text line of that name is a certain raise
   (`0091`), so drawing a row for it would draw a row that vanishes, which is what target 3 is
   for. An add the person answered with `intoLineId` draws nothing either. The fold is
   `foldName` from `models`, which is the server's `normalizeContent`.
3. **`LineStore.addLine` now asks with `addLineResult`** and answers `{ line, merged }`. A
   raise is patched in place through `_reconcile`, so a newer echo wins by version; a raised line
   the store does not hold goes where its position puts it; a new line with no placeholder goes
   at the end. `LineStore.drawsBeforeAnswer` is public, because the page reads it to know whether
   to follow the end of the list (a new row) or scroll the raised row into view.
4. **The mapper lives in `data-access`** (`toAddChoice`, `mapping/add-choice-mappers.ts`) and the
   model in `models/add-choice.ts`, beside `addChoiceRows` (the rows from the refusal and the
   catalog) and `addMayMeetLine` (the prediction). An entry the mapper cannot read is dropped, a
   refusal left with none is not a question, and ten is held as the cap.
5. **The edge** is `--app-action-bg`, the border of the held stepper (`QuantityStepper.is-accent`),
   on `QuantityReel` through a new `took` input, with the number in `--app-action-quiet-fg` as the
   mock draws it. No new colour token. The 1.5 px is a size token (`--app-took-edge-width`), drawn
   as the 1 px border plus a 0.5 px ring so the row does not move. Its transition rides the
   motion tokens, which are zero under reduced motion, and the reel's own reduced motion rule
   already drops the pill's transitions.
6. **D's sizes are tokens** in `_semantic.scss` (`--app-add-choice-*`), because
   `token-hygiene.spec.ts` refuses a raw pixel. The rows scroll past `45svh`; `dvh` is refused
   by `no-dynamic-viewport-units.spec.ts`, and with `interactive-widget=resizes-content` the
   small viewport also shrinks with the keyboard. `AnchoredPopover` gained a `frame` input
   (`note` or `choice`), so D's rows reach its edges at 276 px.
7. **Two strings beyond section 2**: `list.addChoice.rowNoProduct` (a row whose product is not
   loaded has no product to name) and `basket.addChoice.back`, the accessible name of
   "‹ {{list name}}", which starts with the list's name so the visible words are in it.
8. **The back gesture** closes D through `handleBackWhile` (the back stack of `0166`), since D
   has no route. Focus goes to the first row on open and back to the plus on Escape and on the
   back gesture; a press outside leaves focus where the press put it.
9. **The basket detects a raise itself**: its route answers the lines, not `merged`, so a raise
   is an answer naming a line the basket already showed, or an answer to `intoLineId`. The
   marked row is the one whose entries hold that line. The basket does not scroll it into view;
   its rows carry no line id to find.
10. **The basket keeps the picker open while a typed add is out**, so a refusal swaps its
    content in place (target 6). A card add closes it at the pick, as before. "‹ list" goes back
    to the lists unchanged and puts focus back in the field.
11. **D's rows read `ItemNames`** on both pages, which now also backs the basket page; one
    `ensure` of the refusal's item ids fills the products the page did not hold. The basket
    holds no favourite, so its rows show a line's first product.
12. **The live region** says `list.addChoice.merged` on a raise on both pages; the basket uses
    the entry's `left` as the number.
