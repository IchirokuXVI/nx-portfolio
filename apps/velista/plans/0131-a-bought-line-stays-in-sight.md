# 0131: a bought line stays in sight

> Reported by the owner on 2026-10-04, as the first thing to build. Two or more people
> shop the same zone list, each from their own basket. One of them buys a line. The row
> disappears from every other basket, and the buyer keeps it. The owner expects the row
> to stay in the basket, marked as bought, for a fixed time.
>
> **Needs backend plan `0188` first** (a line bought through another basket stays a
> row). It serves the row, `boughtElsewhere` and the note `BOUGHT_ON_ANOTHER_BASKET`. If
> its contract is not on your base branch, stop and say so.
>
> **The zone list page is correct and this plan does not touch it.** A bought line
> leaves "To buy" there. The owner confirmed that on 2026-10-04. An earlier draft of this
> plan blamed that page, and it was wrong.
>
> Prerequisite reading: backend `0188` (all of it), velista `0090` to `0092` (the basket
> as rows of lists), `libs/velista/data-access/src/lib/mapping/basket-mappers.ts`,
> `libs/velista/models/src/lib/basket-view.ts` (`BasketRow`), `enums.ts`,
> `compose-basket-view.ts`, `libs/velista/data-access/src/lib/baskets/basket-memory.ts`,
> and the row template of
> `libs/velista/feature-shopping-lists/src/lib/basket-page/`.

## Brief for the agent

### Objective

Draw a basket row that somebody bought through another basket: it stays where done rows
are drawn, it says that it was bought on another basket, and it offers no revert.

Use the `nx-portfolio-angular-developer` skill, and read the velista UI rules in
`CLAUDE.md` before you touch the template.

### Context

- **The cause is in the backend read**, and backend `0188` fixes it. Until then the row
  is not in the answer, so nothing here can draw it.
- **Velista re-reads the basket** on `basket.linesChanged` (`BasketStore`, the first
  `case` of its socket subscription). No store change is needed for the row to arrive.
- **Rule D4.** A backend DTO is never passed through. `basket-mappers.ts` maps the answer
  from `unknown` into velista's own model and enums.
- **An unknown note falls back to none today.** So before this plan, a client that
  receives the new row draws a done row that says "0 of 0". That is the reason both
  plans go out together.

### Target state

1. **The model.** `BasketRow` and its entry gain `boughtElsewhere: number`. The velista
   note enum gains its own value for `BOUGHT_ON_ANOTHER_BASKET`.
2. **The mapper.** A missing or malformed `boughtElsewhere` is `0`. An unknown note stays
   none, as today.
3. **The row.** A row with state `DONE`, `bought` of zero and `boughtElsewhere` above
   zero is drawn in the section that holds done rows, with the same look as a done row.
   Its count reads from `boughtElsewhere`, not from `bought`.
4. **The caption.** One line under the name: "Bought on another basket" and "Comprado en
   otra cesta". It names nobody. The time is not drawn.
5. **No revert.** The control that undoes a purchase is not drawn on such a row, and the
   settle sheet offers no revert for it. Raising the quantity stays possible where
   `demandEditable` allows it.
6. **A row with something left** and `boughtElsewhere` above zero keeps the look of
   today and gains the same caption.
7. **The in-memory service** (`basket-memory.ts`) produces such a row, so the app in its
   memory mode shows it.

### Scope

- `libs/velista/models`: `basket-view.ts`, `enums.ts`, `compose-basket-view.ts`, specs.
- `libs/velista/data-access`: `mapping/basket-mappers.ts`, `baskets/basket-memory.ts`,
  specs.
- `libs/velista/feature-shopping-lists`: the basket page row and the settle sheet, specs.
- `libs/velista/ui/assets/i18n/en.json` and `es.json`: one key.
- `apps/velista-luna-e2e/src/member.spec.ts`: one step.

### Constraints

- **Do not touch `libs/velista/feature-lists`.** The zone list page is correct.
- **No number is computed on the client.** Every count on the row is one the server
  sent.
- **No clock on the client.** The row leaves when a read no longer holds it.
- **The basket page's CSS budget is nearly full.** Reuse the done row's classes and the
  existing caption style. Add no new block of styles.
- Translation assets are in `libs/velista/ui/assets/`, not under `src/`.
- Do not use `@angular/core/rxjs-interop` in a store.

### Action boundaries

**Stop and ask before** any of these:

- A new visual treatment (an icon, a color, a badge). This plan reuses the done row. A
  new look needs a mock first.
- Naming the person who bought.
- Any change to the zone list page, to `BasketStore`'s refresh, or to the backend.

### Progress evidence

- The specs below fail before the change and pass after it.
- `npx nx affected -t lint test build` is green.
- A browser walk with two accounts on one slot, through the shell: member B has the
  basket open, member A buys a line from A's basket, and B's row moves to the done
  section with the caption and without a reload. Put a screenshot in the pull request.

## Tests

1. `basket-mappers.spec.ts`: the new field and the note map. A missing field is `0`. A
   malformed one is `0`.
2. `compose-basket-view.spec.ts`: the row lands in the done section and reads its count
   from `boughtElsewhere`. A row with something left keeps its section.
3. The basket page spec: the caption is drawn, the revert control is not, and the
   quantity control is drawn only when `demandEditable` is true.
4. The settle sheet spec: no revert is offered for such a row.
5. `member.spec.ts`: the owner buys a line from the owner's basket over the gateway, and
   the member's open basket shows the row as done with the caption, without a reload.
   Run it against a slot, and say in the pull request what it printed. This suite does not
   run on a pull request.

## What this plan does not do

- It does not change the zone list page.
- It does not decide how long the row stays. Backend `0188` does: six hours.
- It does not show who bought the line.
