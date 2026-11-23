> **PR:** [#1087](https://github.com/IchirokuXVI/nx-portfolio/pull/1087)

# 0275: a raise from the zone list counts what was bought above the ask

> Superseded in part on 2026-11-23 by backend `0276` (`0276-a-raise-reports-the-extra-and-only-an-answer-counts-it.md`):
> the default is now the amount the person set, and the extra is counted only on the
> explicit answer.
>
> Amended on 2026-11-23 after its review: a buyer is named only when they are a member of
> the list's group; anyone else is answered as nobody.
>
> Decided by the owner on 2026-11-22. A list's line was bought above its ask in an open
> shopping trip: the list asked 3 and Marta bought 4, so 1 unit is above the ask. Backend
> `0274` records that as `quantity - applied` on the basket's standing buys of the line. A
> person then raises that line on the zone list page. Velista `0207` asks them whether the
> units already bought count: "Marta already bought 1 extra. Do you still need 2, or just
> 1?" The owner's rulings that bind this plan:
>
> - **What stands when nobody answers is the smaller amount.** A person who closes the
>   question or leaves the page keeps what is still needed after the extra is counted.
>   "Still need" is the answer that changes something.
> - The person can be gone when the save answers, so **the count cannot wait for the
>   client**. It happens on the server, inside the write of the raise.
> - **Only the zone list rows ask.** The line page, the line sheet, the catalog and the
>   product page do not count and do not ask.
> - **Who is named** is the person who bought the extra units. A guest's buy names the
>   owner of the shopping list (the basket) the guest shopped, never the guest. This is
>   decided on the server.
> - A lowering never asks.
>
> So the zone list's raise carries a flag, `countExtra: true`. With it, core moves up to the
> raise's size from "above the ask" into the ask on the open baskets' standing buys of the
> line, in the same transaction and under the line's lock, and raises the line only by the
> rest. The answer says how much was above the ask, how much it counted, and who bought it.
> Velista `0207` draws the question from that answer. "Count the extra", closing and leaving
> send nothing more. "Still need" sends one more raise, by the counted amount, without the
> flag.
>
> **Release rule: release this plan and velista `0207` together, after the set of velista
> `0200` and `0201` and backends `0273` and `0274`.** It depends on backend `0274` (the
> `applied` column, `rebalanceApplied`, the `underLock` hook of `addQuantity`). **Build it on
> top of the branch `claude/backend-0274-applied-units` (PR #1066) while that PR is not
> merged**, and rebase onto `dev` once it is. The request field is optional and old clients
> never send it, so the release raises no `minClientVersion`.
>
> Code anchors, on `claude/backend-0274-applied-units` at `7d13098a7`, under
> `apps/luna-shopper-backend/core/src/app/`:
> `lists/line.service.ts:3589` to `:3676` (`addQuantity`: access resolved before the
> transaction at `:3613`, the locked read at `:3621`, the `expect` check at `:3634`, the new
> quantity at `:3647`, `authorizeEdit` at `:3650`, the `underLock` hook at `:3651`, the change
> row at `:3663`, `announce(..., 'moved')` at `:3675`), `:997` to `:1017` (`emit`: `line.updated`
> and `baskets.linesMoved(listId, [lineId], true)`), `:3835` (`announce`);
> `baskets/basket-demand.service.ts` (`rebalanceApplied`, which gives units above the ask
> back to a raised ask oldest buy first, and `buysOf`, the standing buys of one line in a
> basket's scope); `baskets/basket-line-facts.ts` (`basketScopeOf`: a `LIVE` basket counts
> its current session alone); `baskets/basket-coverage.service.ts:59` (`coveringBaskets`,
> with `basketId`, `ownerUserId`, `kind`); `baskets/basket-announcer.service.ts:145`
> (`linesMoved` and its `marksMoved`); `entities/line-settlement.entity.ts` (`applied`,
> `settledByParticipantId`, `basketId`, `unit`, `revertedAt`); `entities/basket-participant.entity.ts`
> (`kind`, `userId`). In the gateway: `gateway/src/app/lists/list.controller.ts:618` to
> `:635` (the route `POST lines/:id/quantity`) and `list.dto.ts:377` (`AddLineQuantityDto`).
> In the contracts: `libs/luna-shopper/contracts/src/lib/messages/list.messages.ts:1093`
> (`AddLineQuantityRequest`) and `:1052` (`UpdateLineResult`, the precedent of one field
> beside a `LineView`); `libs/luna-shopper/contracts/src/schemas/messages/list.schemas.ts:254`
> (`updateLineResult`) and `:1212` (the pattern's response, `lineView` today). The naming
> precedent: backend `0203`, section 5 (`origin.owner` is the owner of the other basket, as
> `{ userId }`; core serves no names).

## Brief for the agent

### Objective

Add an optional `countExtra` flag to the line quantity write. With it, a raise first moves
units bought above the ask on the open baskets' standing buys of the line into the ask, and
raises the line only by the rest, in one transaction under the line's lock. The answer says
how much was above the ask, how much was counted and who bought it.

### Context

- Since backend `0274`, an open basket's ask of a line is `left + sum(applied)` over that
  basket's standing `BOUGHT` buys of the line in its scope. The units above the ask are
  `quantity - applied` on each buy, never stored.
- `addQuantity` reads the line under `pessimistic_write`, authorizes the new quantity, runs
  the caller's `underLock` hook, writes the line and its change row, then announces
  `line.updated` and `basket.linesChanged` (as entries) to every covering basket. The hook
  runs after the new quantity is computed, so it cannot change the amount the line moves by.
  This plan therefore changes `addQuantity` itself; the hook stays for `basket-demand`.
- `rebalanceApplied` already does this count for one basket when its demand route raises an
  ask: units above the ask are given back to it oldest buy first, before the line holds
  anything. A count from the zone list is the same act over every open basket that covers
  the list.
- Core serves no names. A reader resolves a user id through its zone's members, and draws
  "Someone" for an id it cannot resolve (velista `BasketChangeActor`).

### Target state

1. **The request.** `AddLineQuantityRequest` gains `countExtra?: boolean`. The gateway's
   `AddLineQuantityDto` gains the same field (`@IsOptional()`, `@IsBoolean()`, a JSON
   `true` or `false` only), and the controller passes it to core. Its description: "Count
   the units bought above the ask in open shopping lists toward this raise. Only the zone
   list's rows send it." A basket write never sets it.
2. **When it counts.** Only when `countExtra` is `true` and `delta > 0`. With `countExtra`
   absent or `false`, `addQuantity` behaves exactly as on the `0274` branch. With
   `countExtra` true and `delta < 0`, it counts nothing and moves the line by `delta` as
   today; the answer carries `extra` with `counted: 0`.
3. **Which buys.** Before the transaction, beside the access read, core reads the baskets
   that cover the line's list (`coveringBaskets(listId)`), and the scope of each
   (`basketScopeOf`). Under the line's lock it reads the standing buys of the line on those
   baskets: `outcome = BOUGHT`, `revertedAt IS NULL`, `unit` equal to the line's unit, inside
   each basket's scope, with `quantity > applied`. A buy made on the list page (`basketId`
   null) and a buy of a `LIVE` basket outside its current session are never counted.
4. **The order.** The buys are taken **oldest first, across all those baskets**, by
   `(settledAt, id)`. That is `rebalanceApplied`'s order for giving units back to an ask, so
   the units that stay above the ask are on the newest buys, which a minus reaches first
   (backend `0274`, target state 4).
5. **The count.** `above` is the sum of `quantity - applied` over those buys before the write.
   `counted = min(delta, above)`. Walking the buys in order, each buy's `applied` rises by
   what is still to count, up to its `quantity`. The line moves by `delta - counted`. The
   arithmetic is a pure function exported beside `rebalanceApplied` (for example
   `countAboveAsk(buys, delta)`, returning the new `applied` per buy and `counted`), with a
   unit spec.
6. **One transaction, one lock.** The read of the buys, the writes of `applied` and the write
   of the line happen in the transaction of `addQuantity`, under its lock on the line, after
   the `expect` check and the unit check. `authorizeEdit` is asked about the quantity the
   person asked for (`line.quantity + delta`), so a reader who may not raise the line cannot
   count either.
7. **When the whole raise is counted** (`delta - counted === 0`), the line is not written: no
   version bump, no `reopenAfterEdit`, no change row and no `line.updated`. Only `applied`
   moves, as in `basket-demand`'s branch that moves only the split (backend `0274`, section
   5). Otherwise the line is written as today, by `delta - counted`, with its change row.
8. **The answer.** `line.addQuantity` answers `AddLineQuantityResult`: the `LineView` as it
   now stands, and, only when `countExtra` was `true`, a field `extra`:
   - `above`: the units above the ask before this write, in the line's unit;
   - `counted`: the units this write moved into the ask;
   - `buyers`: one entry `{ userId: string | null }` for each person who bought units of
     `above`, in the order of their oldest such buy. A participant with an account
     (`OWNER`, `REGISTERED`) is its `userId`. A `GUEST` participant is the `ownerUserId` of
     the basket the guest bought through. That `userId` is answered only when it is an
     approved member of the list's zone; anyone else, and a buy whose participant row is
     gone, is `{ userId: null }`. Entries with the same `userId` are one entry, and every
     `null` is one entry, at the place of the first. With `above` 0 it is empty.
   Core serves no name, and no participant id, guest name or basket id leaves in this field.
   The client names the people, says "You" for its own user id and "Someone" for null or for
   an id it cannot resolve.
9. **The contracts.** `AddLineQuantityResult extends LineView` and its `extra` type in
   `list.messages.ts`; a schema `addLineQuantityResult` in `list.schemas.ts` (the line view's
   properties plus `extra`, optional) and the pattern's response set to it. The request
   schema allows `countExtra` as a boolean.
10. **The events.**
    - The line was written: as today, `line.updated` to the zone and `linesMoved(listId,
      [lineId], true)` to every covering basket.
    - Only `applied` moved: no `line.updated` (nothing on the line changed), and
      `linesMoved(listId, [lineId], false)` to every covering basket, because each counted
      basket's `asked` for the line moved. No change row is written, so `marksMoved` is false.
    - Nothing moved (`above` 0 and the raise written as today): the events of the first case.
11. **The documents.** Regenerate and commit `apps/luna-shopper-backend/gateway/docs/openapi.json`
    with `npx nx run luna-shopper-backend-gateway:openapi`, then the admin wire types with
    `npx nx run luna-shopper-admin/models:wire-types`. Never edit either by hand.

### The cases

Each case is read through the basket read of each basket (`asked / left / bought`, and the
units above the ask), and through the answer (`above`, `counted`). One basket unless the case
says two. `left` is the zone line's quantity, which both baskets share.

| Case | Before | The write | After | Answer |
| --- | --- | --- | --- | --- |
| 1. Asks 3, bought 4 | 3 / 0 / 4, 1 above | +2, flag | 5 / 1 / 4, 0 above | above 1, counted 1 |
| 2. Asks 3, bought 4 | 3 / 0 / 4, 1 above | +1, flag | 4 / 0 / 4, 0 above; the line is not written | above 1, counted 1 |
| 3. "Still need" after case 1 | 5 / 1 / 4, 0 above | +1, no flag | 6 / 2 / 4, 0 above | no `extra` |
| 4. "Still need" after case 2 | 4 / 0 / 4, 0 above | +1, no flag | 5 / 1 / 4, 0 above | no `extra` |
| 5. Another control raises | 3 / 0 / 4, 1 above | +2, no flag | 5 / 2 / 4, 1 above (as on the `0274` branch) | no `extra` |
| 6. More above than the raise | 1 / 0 / 4, 3 above | +2, flag | 3 / 0 / 4, 1 above; the line is not written | above 3, counted 2 |
| 7. Two baskets: A asks 3 and bought 4 (older buy), B bought 2 with the line at 0 | A 3 / 0 / 4, 1 above; B 0 / 0 / 2, 2 above | +2, flag | A 4 / 0 / 4, 0 above; B 1 / 0 / 2, 1 above; the line is not written | above 3, counted 2, buyers A's buyer then B's buyer |
| 8. The same two baskets | as case 7 | +4, flag | A 5 / 1 / 4, 0 above; B 3 / 1 / 2, 0 above | above 3, counted 3 |
| 9. A weight: asks 1000 g, bought 1500 g | 1000 / 0 / 1500, 500 above | +1500, flag | 2500 / 1000 / 1500, 0 above | above 500, counted 500 |
| 10. "Still need" after case 9 | 2500 / 1000 / 1500 | +500, no flag | 3000 / 1500 / 1500 | no `extra` |
| 11. No extra: asks 3, bought 2 | 3 / 1 / 2, 0 above | +2, flag | 5 / 3 / 2, the same as without the flag | above 0, counted 0, buyers empty |
| 12. A lowering with the flag, from case 5's result | 5 / 2 / 4, 1 above | -1, flag | 4 / 1 / 4, 1 above | above 1, counted 0 |

Case 12 starts from case 5 because a buy above the ask leaves the line at 0, and a line at 0
cannot be lowered. The flag changes nothing on a lowering.

"Still need" is a plain raise by the counted amount. It leaves the counted units in the ask,
so after it the list asks for what was bought plus everything the person set: 6 in case 3,
where the person set 2 on top of the 4 bought. Nothing is above the ask any more, so a later
raise of the line does not ask again about those units.

### Scope

- Work in `core` (`addQuantity`, the count function beside `rebalanceApplied`, the reads of
  the buys and of the participants), the gateway's DTO and controller for the route, the
  contracts (`list.messages.ts`, `list.schemas.ts` and their specs), and the generated files.
- Do NOT change `basket-demand`, the settle, the revert, the basket reads or the trips read.
- Do NOT change the meaning of the route without the flag.

### Constraints

- Real Postgres in the integration specs, on an ephemeral luna slot (CLAUDE.md, "One checkout
  runs one slot, unless the slot is `--ephemeral`"). The memory notes on TypeORM raw SQL
  traps and on luna backend spec traps apply.
- The read of the covering baskets and their scopes stays outside the transaction: a read
  through another repository inside it holds two pool connections (the comment at
  `line.service.ts:3604`).
- One expression for "the standing buys of a line in a basket's scope": reuse `buysOf` (or
  the fragment beside `basketAskedCte`), never a third copy.
- No dashes as punctuation in comments.

### Action boundaries

- Stop and ask if a settle or a revert writes `line_settlements` of a line without first
  holding the line's `pessimistic_write` lock. The count relies on that lock order.
- Stop and ask if `coveringBaskets` can return a basket that is not open, or omits an open
  basket that holds standing buys of the line (for example a basket whose access to the list
  was taken away after its buys). This plan counts only the baskets that cover the list now.
- Stop and ask about a buyer who is in two of the counted baskets as two kinds (a guest in
  one, a registered person in another) if the dedupe by `userId` gives an answer the owner
  has not seen.
- Stop and ask if `authorizeEdit` refuses a raise whose whole amount is counted for a reason
  that does not apply when the line is not written.

### Progress evidence

The specs of section 1 green on an ephemeral luna slot; `npx nx affected -t lint test`; the
gateway's `openapi-document.spec.ts` and the admin `wire-types.spec.ts` green on the
regenerated files.

## 1. Specs

Unit, beside `rebalanceApplied`:

1. The count function gives the `applied` and `counted` of cases 1, 2, 6, 7, 8, 9 and 11 from
   their buys, oldest first, and never raises an `applied` above its buy's `quantity`.

Integration, real Postgres, through `addQuantity` and the basket read of each basket:

2. Every case of the table ends at its "After" column and answers its "Answer" column.
3. Cases 2, 6 and 7 write no change row, do not bump the line's `version`, emit no
   `line.updated`, and announce `basket.linesChanged` to each covering basket with
   `marksMoved` absent and the entries' `asked` moved.
4. A buy of a `LIVE` basket outside its current session, a buy made on the list page, a
   reverted buy and a buy in another unit are never counted.
5. A guest's buy above the ask answers `buyers: [{ userId: <the basket's owner> }]`. A guest
   and the basket's owner on one basket answer one buyer. Two people answer two buyers, in
   the order of their oldest buy. No answer carries a participant id or a typed name.
6. The flag with a lowering moves the line by the delta and answers `counted: 0`.
7. Without the flag every existing `addQuantity` spec passes unchanged, and the answer has no
   `extra`.
8. A reader without `DECIDE` on an approved line is refused with the flag as without it, and
   no `applied` moves.
9. A settle that lands between the client's read and the write is read under the lock: the
   count uses the buys as they stand at the lock.

Gateway:

10. The DTO accepts `countExtra` `true` and `false`, refuses a string `"true"` with a 400, and
    the controller passes it to core.
11. The contract schemas accept the new response, with and without `extra`.

## 2. Acceptance criteria

- A raise from the zone list counts the units bought above the ask before it raises the
  line, and nothing a client does afterwards is needed for the count to stand.
- The answer says how much was above the ask, how much was counted and who bought it, and
  never names a guest.
- Every other caller of the route behaves as before.

## Not in this plan

- The question, its words and its look (velista `0207`).
- A count from the basket: the demand route already does it for its own basket.
- A count on the line page, the line sheet, the catalog or the product page (the owner
  ruled that only the zone list rows ask).
