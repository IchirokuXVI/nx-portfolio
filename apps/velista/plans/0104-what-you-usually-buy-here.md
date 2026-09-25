> **PR:** [#483](https://github.com/IchirokuXVI/nx-portfolio/pull/483)

# 0104: what you usually buy here

> **Mock first.** There is no mock for this plan yet. The session that builds it adds to
> `mocks/buying-at/` the filter's switch, a row with the "bought here 2 of the last 6 times"
> message, and the empty state when the filter hides every row. It stops for the user's
> review before any code.
>
> Backend half: `apps/luna-shopper-backend/plans/0165`, where a line is usually bought. Needs
> `0102` first: the filter exists only when a shop is chosen.
>
> Prerequisite reading: `0075` and `0076` (the filter sheet and what it remembers), `0102`,
> and backend `0165` in full, especially section 3.

With a shop chosen, the basket can show only what the household usually buys at that shop's
chain. The server answers, per row, how often its lines were bought there
(`BasketRow.usual`). This plan draws the switch and the message and filters the rows. It
never changes their order.

## Brief for the agent

### Objective

Add the switch "Only what I usually buy here" to the basket's filter sheet, drawn only when a
shop is chosen, that hides the rows backend `0165` says are bought elsewhere, and shows the
"bought here X of the last Y times" message on the rows it keeps.

### Context

- **The filter step** is in `libs/velista/models/src/lib/compose-basket-view.ts`, between
  pricing and ordering. The "Lists" filter there is the model to follow. It is never
  remembered.
- **The filter sheet** is `libs/velista/feature-shopping-lists/src/lib/filter-sheet/`.
- **`usual`** is `{ state, bought, of } | null` on each row of a read made at a shop
  (backend `0165` section 2). It is null when no shop is chosen.
- **Rule D4**: map `usual` from `unknown` into velista's own model.

### Target state

- The switch "Only what I usually buy here" / "Solo lo que suelo comprar aquí" is in the
  filter sheet, below "Buying at", drawn only when a shop is chosen, including a basket's own
  locked shop.
- With the switch on:
  - rows with `state` `NEVER_BOUGHT` or `HERE` are kept, and every other row is hidden
  - a `HERE` row with `bought` under 5 shows "Bought here {{bought}} of the last {{of}}
    times" / "Comprado aquí {{bought}} de las últimas {{of}} veces", pluralised in both
    languages
  - the order of the kept rows is exactly their order with the switch off
- With the switch off, no row carries the message.
- When the switch hides every row, the empty state says so and explains that purchases made
  without a chosen shop are not counted, with a button that turns the switch off.
- The switch is not remembered, like the "Lists" filter.

### Scope

Work only in `libs/velista/models`, `libs/velista/data-access` (the mapper),
`libs/velista/ui`, `libs/velista/feature-shopping-lists`, their specs and the two translation
files.

Do not touch: the backend, the rule that computes `usual`, the order, the grouping, the
availability marks of `0102`.

### Constraints

- Use `nx-portfolio-angular-developer` and `design-taste-frontend`.
- **The client never recounts.** It reads `state`, `bought` and `of` as the server sent them.
- **"Here" means the chain.** A purchase at another Mercadona counts, so the copy says "here"
  and never names the street.
- **Keep `NO_SHOP_KNOWN` separate from `ELSEWHERE` in the model**, even though both are
  hidden. Backend `0165` section 3 explains why the user can reverse the first.
- Only make changes directly requested.

### Action boundaries

Stop and ask before:

- writing code before the mock is reviewed
- remembering the switch
- showing the message with the switch off
- reordering, grouping or sinking rows by `usual`

### Progress evidence

After each step, state what was built and paste the output that proves it:

- A model spec per `state`, the message threshold at 4 and 5, and the order unchanged.
- A component spec: the switch absent with no shop, present with a chosen shop and with a
  locked shop, and the empty state.
- `npx nx build velista` and the affected lint and tests.
