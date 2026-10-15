# 0149: a held product choice lets go once it is spent

> Asked for by the owner on 2026-10-15: "create a plan to fix the bugs you mentioned", after
> the review of PR [#716](https://github.com/IchirokuXVI/nx-portfolio/pull/716), which built
> [`0140`](./0140-a-line-takes-another-product-from-the-shopping-list.md). The review found
> two small leftovers in the choices that `0140` holds on the device. Neither draws anything
> wrong today. Both leave state in memory that nothing reads, and a later change that does
> read it inherits a wrong answer.
>
> Every fact below was read on `dev` at `bf701879` on 2026-10-15.
>
> Prerequisite reading: `0140` section 4 and "What the build decided",
> `libs/velista/data-access/src/lib/baskets/held-product-choices.ts`,
> `libs/velista/data-access/src/lib/baskets/basket-store.ts` (`_held`, `rows`, `products`,
> `_read`, `changeProduct`, `_fold`, `_regroup`) and `withHeldChoices` in
> `libs/velista/models/src/lib/basket-row-fold.ts`.

## Brief for the agent

Load the `nx-portfolio-angular-developer` skill before you write code.

### Objective

Make `HeldProductChoices` hold only the choices that still change what the basket draws. A
choice the server has answered, a choice for a line the basket no longer names, and a
choice for the product the line already has are released. Change nothing a person sees.

### Context

- **A held choice is a line moved to another product before its first buy, on this device
  only** (`0140` section 4). `BasketStore.changeProduct` (`basket-store.ts:1165`) sends the
  lines that have a buy today and calls `_choices.hold(id, kept, ...)` (`:1190`) for the
  rest. `HeldProductChoices` keeps them by basket and by line, in a signal, in memory.
- **The rows apply a choice only while it is unspent.** `rows` (`:534`) calls
  `withHeldChoices` (`basket-row-fold.ts:144`), which moves an entry only when the read's
  `entry.tripItemId === null` and `row.productId !== itemId`. So the guards already ignore a
  spent choice and a choice for the line's own product.
- **Defect 1: a spent choice is never released.** The next buy names the held product, and
  from then on the read's entry carries a `tripItemId` of its own. Nothing calls `release`
  for that line. The choice stays in the signal for the session, and `products` (`:573`)
  keeps merging its `product` whenever the read has no row for that id. A line deleted from
  the list, or a list that stops being covered, leaves its choice behind the same way.
- **Defect 2: a choice back to the line's own product is held.** A person who changes a
  line to B and then back to A, with no buy between, ends with `{ itemId: A }` held.
  `withHeldChoices` skips it because the read's row is already A, so it is never applied and
  never released.
- **Where the read lands.** `_read` sets the basket at `:948`. `_fold` (`:1315`) and
  `_regroup` (`:1335`) set it after a write, at `:1324` and `:1344`. `:811` sets null when
  the basket is let go. `basket.rows` is the server's answer. `rows()` is the answer with
  the choices applied, and its entries carry the *held* `itemId` as `tripItemId`. So a test
  for "spent" reads `basket.rows`, never `rows()`.

### Target state

1. After each read and each write answer is stored, every held line of that basket is
   released when the stored read either names no entry for it or names an entry whose
   `tripItemId` is not null.
2. `changeProduct` with no `keep` releases, instead of holds, each kept line whose entry in
   the stored read sits in a row whose `productId` equals `body.itemId` and has
   `tripItemId === null`. The other kept lines are held as today.
3. With nothing held, `rows()` returns the read's own array (`_regrouped` is false), and
   `products()` returns the read's own map.

### Scope

- `libs/velista/data-access/src/lib/baskets/held-product-choices.ts` and its spec. One new
  method is enough, for example `retain(basketId, keep: (lineId) => boolean)`, which
  releases every held line `keep` refuses in one signal write. Name it as you see fit.
- `libs/velista/data-access/src/lib/baskets/basket-store.ts` and `basket-store.spec.ts`.
  One private helper that prunes against a stored basket, called after each `_basket.set`
  with a basket that is not null.
- This plan file: add "What the build decided" at the end and the `> **PR:**` line at the top.

### Constraints

- Do not write a signal inside a `computed`. Prune in the imperative paths that store a
  read, not in `rows`, `_held` or `products`.
- Keep the guards in `withHeldChoices` exactly as they are. They are the rule that decides
  what a row draws, and pruning only removes state the rule already ignores.
- A read that fails stores nothing, so it prunes nothing. Do not release choices on an
  error, a `needsJoin` or a `revoked` state.
- `HeldProductChoices` stays provided by the app layer (rule D5), and stays in memory only.
- Do not use `@angular/core/rxjs-interop`. Do not touch the change sheet, the catalog page
  or any template.

### Action boundaries

- Edit only the files in Scope. Stop and ask before you change a model in
  `libs/velista/models`, a public signature of `BasketStore`, or anything in the backend.
- If a prune turns out to change what a row draws in any test, stop and report it. It means
  the guards and the prune disagree, which this plan assumes cannot happen.

### Progress evidence

- New specs, each failing before the change:
  - `HeldProductChoices.retain` (or the name you chose) releases the refused lines, keeps
    the rest, and drops the basket when none is left.
  - Hold B on a line, store a read whose entry for that line has a `tripItemId`: `heldOn` is
    empty, and `products()` no longer holds B when the read has no row for it.
  - Hold B on a line, store a read that names no entry for that line: released.
  - Hold B, then `changeProduct` back to the read's own product with no `keep`: nothing is
    held, and `rows()` is the read's own array.
  - A held line whose read entry is still unbought stays held across a refresh.
- `npx nx run-many -t lint test -p velista/data-access velista/models` passes.
- `npx nx build velista` passes (production). It already warns about the `app-layout.scss`
  budget, and this plan adds no SCSS.

## 1. Not in this plan

- The `app-layout.scss` budget warning that PR #716 reported. It is a warning on a file this
  plan does not touch, and it was over before `0140`.
- Keeping a held choice across a reload. The owner accepted that a reload forgets it
  (`0140` section 4).
- The backend 500 on product group assignments that the same review found. Backend
  [`0211`](../../luna-shopper-backend/plans/0211-a-malformed-group-assignment-is-refused-not-a-500.md)
  fixes it.

## 2. Choices that are mine

- **Prune on store, not on read of the signal.** The alternative, a `computed` that filters
  the held map, hides the leftovers but keeps them, which is the defect.
- **A line the read no longer names is released.** The choice could only come back into use
  if the same line id reappeared, and a line that leaves a covered list and comes back is a
  new decision for the person.
