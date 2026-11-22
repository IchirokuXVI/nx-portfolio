> **PR:** [#1066](https://github.com/IchirokuXVI/nx-portfolio/pull/1066)

# 0274: a buy records how much of the ask it met

> Decided on 2026-11-22. While a basket is open, what a list asks of it is not stored: it
> is `bought + left`, where `left` is the zone line's `quantity` and `bought` is the sum of
> this basket's standing buys of the line in this trip (plan 0136; `rowNumbersOf`,
> `basketAskedCte`, the freeze of plan 0135). A settle lowers the line's quantity and floors
> it at 0; a revert adds the units back. So a buy above the ask erases the ask:
>
> | Case | After the buy (asked / left / bought) | After a minus of 1 | What velista `0201` needs |
> | --- | --- | --- | --- |
> | A line made at 0, buy 2 | 2 / 0 / 2 | 2 / 1 / 1 | 0 / 0 / 1 |
> | Asks 3, buy 4 | 4 / 0 / 4 | 4 / 1 / 3 | 3 / 0 / 3 |
> | Asks 3, buy 2 | 3 / 1 / 2 | 3 / 2 / 1 | 3 / 2 / 1 |
>
> Found by the review of backend `0273` on 2026-11-22. The owner chose the fix: each buy
> records how many of its units lowered the line (`applied`). The ask becomes `left` plus
> the sum of `applied`, a revert gives back to the line only units that were applied, and the
> units above the ask are the ones a minus takes first. The alternative (store the ask on
> the line) was rejected: the line is a record that outlives every trip, and plan 0136 made
> an open basket's ask a view of its lists on purpose.
>
> No number that a reader sees today changes for existing data: every existing buy is given
> `applied = quantity`, which is what the floor made of it as far as the database can tell.
>
> Linked plans: velista `0201` and backend `0273` cannot show or keep the right ask without
> this plan. **Release `0200`, `0201`, backend `0273` and backend `0274` together.** It can
> be built beside `0273`; the two touch `basket-settle.service.ts` in different places, and
> `0273`'s insert of a settlement must set `applied` (0 on a line made at 0).
>
> Code anchors, on `dev` at `81012e10d`, under `apps/luna-shopper-backend/core/src/app/`:
> `entities/line-settlement.entity.ts` (the columns; `quantity` at `:113`);
> `baskets/basket-settle.service.ts:131` to `:232` (the `from` guard, the floor at `:178`,
> the insert); `baskets/basket-revert.service.ts:88` to `:239` (newest first, revert plus
> append at `:166` to `:209`, `zoneLine.quantity += units` at `:233`);
> `baskets/basket-demand.service.ts:20` to `:60` (setting an ask, and why there is "no stored
> number for a purchase to be below"); `baskets/basket-read.sql.ts`,
> `lists/trips/basket-asked.sql.ts:48` (`basketAskedCte`), `lists/trips/trips.sql.ts`,
> `baskets/basket-trip-rows.sql.ts` (the freeze: `(ll.quantity + b."bought")`),
> `baskets/basket-usual.sql.ts` and `lists/suggestions/suggestions.sql.ts` (other sums of
> bought units: check each); `libs/luna-shopper/basket-rules/src/lib/basket-rules.ts:161`
> (`rowNumbersOf`: `asked: bought + left`) and its `sumsOf`;
> `libs/luna-shopper/contracts/src/lib/messages/basket.messages.ts:287` and
> `admin-core.messages.ts:634` (the doc comment "`bought + left`, computed, never stored").

## Brief for the agent

### Objective

Record on every `BOUGHT` settlement how many of its units lowered the line, compute an open
basket's ask from those, and make a revert give back to the line only units that were
applied, taking the units above the ask first.

### Context

- `line_settlements` holds one row per line a buy touched, with `quantity`. A revert never
  edits a row: it marks it reverted and appends the rest as a new row with the same
  `settledAt`, price and snapshot.
- Every read of an open basket's ask derives it: the basket read and its rules
  (`rowNumbersOf`), the trips read (`basketAskedCte`), the freeze at finish. They must keep
  agreeing, which is why the freeze's `SELECT` is "the seam".
- Setting an ask from the basket (`basket-demand.service.ts`) writes the line's quantity
  through `LineService.addQuantity`.

### Target state

1. **The column.** `line_settlements.applied`, `int NOT NULL`, with a check
   `applied >= 0 AND applied <= quantity`. A migration adds it and sets
   `applied = quantity` on every existing row, then drops any default. A `NOT_AVAILABLE` row
   has `applied = 0`.
2. **A settle** writes `applied = min(allocated, line quantity before the buy)` per line,
   inside the transaction that lowers the line. The line's quantity is lowered by `applied`,
   which is what the floor did; nothing else about the settle changes.
3. **The ask.** For an open basket, a line's ask is `left + sum(applied)` over this basket's
   standing `BOUGHT` buys of the line in this trip. `bought` stays the sum of `quantity`.
   `rowNumbersOf` takes `applied` per entry and returns `asked: left + applied`. Every SQL
   that derives the ask (the basket read, `basketAskedCte`, the trips read, the freeze) reads
   `applied` the same way. Over the ask is `bought - applied`, never stored.
4. **A revert of units** takes the newest buys first, as today, and within a buy takes its
   units above the ask (`quantity - applied`) before its applied units. Only the applied
   units it takes go back onto the line. The appended row keeps
   `applied = original applied - applied units taken`.
5. **Setting an ask below what was applied.** When `basket-demand` sets a line's ask to `n`
   and `n` is below the sum of `applied`, the line's quantity becomes 0 and `applied` is
   lowered on this basket's standing buys of the line, newest first, until the sum equals
   `n`; those units become units above the ask. At or above the sum, the quantity becomes
   `n - sum(applied)`, as today in effect. The comment that says no such floor can be
   stated is rewritten.
6. **The words.** The doc comments that say "`bought + left`, computed, never stored" say
   "`left` plus the units of this basket's buys that met the ask, computed, never stored",
   and the freeze's comment says the same.
7. Backend `0273`'s new write inserts its settlement with `applied = 0` (the line is made, or
   found, at 0).
8. No route, request or response shape changes. `openapi.json` changes only if a doc comment
   the generator reads changed; regenerate and commit it, and the admin wire types, if so.

### Scope

- Work in `core` (the entity, a migration, settle, revert, demand, the SQL reads and the
  freeze), `libs/luna-shopper/basket-rules`, the contracts' doc comments, the generated
  files if they change.
- Do NOT change the gateway's routes, the velista client, or how `bought` is counted.

### Constraints

- One migration, reversible (the down drops the column).
- Every read of the ask reads one expression; write it once in SQL (a shared fragment beside
  `basketAskedCte`) and once in `basket-rules`.
- Real Postgres in the integration specs (the memory note on TypeORM raw SQL traps applies).
- No dashes as punctuation in comments.

### Action boundaries

- Stop and ask if a read derives the ask in a place this plan does not name and its owner
  plan says it must stay `bought + left`.
- Stop and ask before changing an existing integration spec's expected `asked` in a case
  that is not a buy above the ask, a revert of one, or a lowered ask.

### Progress evidence

The specs of section 1 green on an ephemeral luna slot; `npx nx affected -t lint test`; the
gateway's document and wire type specs green.

## 1. Specs

Integration, real Postgres:

1. The three cases of the table above end at the right column after the buy and after a
   minus of 1, read through the basket read.
2. A row of two lines asking 3 and 1, a buy of 5 on the first: asked 3 and 1, the first
   entry's bought 5 and applied 3; a revert of 2 on the first gives back nothing to the line
   (its two units above the ask go first) and leaves bought 3, asked 3.
3. A revert across two buys (buy 2, then buy 2 more on a line asking 3): the newest buy has
   applied 1; a revert of 2 takes that buy's unit above the ask, then its applied unit, and
   gives 1 back to the line.
4. Setting the ask of a line that asks 3 and has 3 bought to 2: left 0, asked 2, over 1;
   setting it back to 4: left 1, asked 4.
5. The freeze writes `asked` with the new expression; a basket finished after a buy above
   the ask freezes the original ask.
6. The trips read shows the same ask as the basket read for each of the cases above.
7. The migration on a database with old buys gives `applied = quantity` and changes no row's
   `asked`, `left` or `bought` as read before it.
8. Existing specs that assert a buy above the ask (the outside buy, bought elsewhere and
   product rows suites) now assert the original ask; every other existing spec passes
   unchanged.

## 2. Acceptance criteria

- A buy above the ask keeps the ask, and the units above it are visible as `bought - asked`.
- A minus after a buy above the ask never raises the ask.
- No existing number changes for data written before the migration.

## Not in this plan

- The velista sheet (velista `0201`), which reads `asked` and `bought` as they come.
- A per buy "over" field on the wire: the client derives it from `bought` and `asked`.
