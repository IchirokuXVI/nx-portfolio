> **PR:** [#1098](https://github.com/IchirokuXVI/nx-portfolio/pull/1098)

# 0276: a raise takes the extra into the ask, and only an answer lowers it

> Decided on 2026-11-23; the owner's final rulings of 2026-11-25 replace the design this
> plan held before. It amends backend `0275`, which is built (PR #1087) and merged into
> `dev`, and which no release carries.
>
> **The rule: after a raise, the extra always ends up inside the ask. Only the size of the
> ask differs.** The owner's example, in a basket's "Lists and amounts": a list asks 3,
> 5 were bought (2 extra), and the person presses plus twice.
>
> - **"Count the extra":** ask 5, bought 5 of 5, left to buy 0. The extra covers the raise.
> - **"Still need"**, which is also what stands when the question gets no answer (closed,
>   page left, control gone, app closed): ask 7, bought 5 of 7, left to buy 2. The ask
>   rises by the extra plus what the person added: the extra is counted as bought, and the
>   whole raise still stands as left to buy.
>
> In both outcomes no unit is left above the ask, "bought" and "asked" always add up, and
> nothing has to be remembered about an answer. The question comes back only when somebody
> later buys above the ask again.
>
> **What changes against `0275`:**
>
> - **The raise writes the "Still need" outcome by itself**, in one transaction, on every
>   route that raises a list line, for every caller: it raises the line by the amount the
>   person set (what is left to buy) and moves every unit above the ask into the ask
>   (the buys' `applied` rise). `0275` did the opposite: it took the extra off the raise.
> - **`reportExtra: true`** asks the raise to answer what it took in (`above`), who bought
>   it, and what "Count the extra" would take off (`countable`). Five requests take it.
> - **"Count the extra" is the one answer that writes.** It lowers the line by `countable`,
>   refused with `stale_quantity` when the line moved. "Still need" writes nothing.
> - `countExtra` is removed, and so is the demand's fold of a basket's own extra into a
>   raised ask (`0274`): the raise's own absorption replaces it.
>
> **The owner's answers of 2026-11-25:**
>
> 1. **No exception for the same shopping list.** Every route takes in, and reports, every
>    open shopping list's extra, the extra bought through the same shopping list included:
>    the person may have forgotten it, or another shopper on the same shopping list bought
>    it. If users complain later, the exception can be added then.
> 2. **A count whose line moved meanwhile is refused.** It answers `stale_quantity`, counts
>    nothing and writes nothing. Velista says so and shows the line's current amount.
> 3. **Nothing is recorded about an answer.** The earlier design of this plan (three
>    `extra_still_needed*` columns on `list_lines` and two "Still need" routes) is dropped:
>    once the extra is inside the ask there is nothing left to ask about.
>
> **Dependencies and release rule.** It builds on backends `0274` and `0275` as merged on
> `dev`. **Release it together with velista `0208`, and merge it together with `0208`'s
> stage 1.** The two replace behaviour that is in `dev` only: neither PR #1087 nor PR #1089
> (velista `0207`) is on `main` or in any tag (the newest velista tag is `velista-v0.19.0`
> at `0f7476f4e`, 2026-11-03), so no installed client sends `countExtra`. The new request
> fields are optional, so this plan raises no `minClientVersion` (production holds
> `0.17.0`, and backend `0274` raises it with its own release). Release it with the set of
> velista `0200`, `0201` and backends `0273`, `0274`, as `0275` was to be.
>
> **Velista code in `dev` that is wrong once this merges, until `0208` stage 1 merges:**
> the zone list page's raise sends `countExtra: true`
> (`libs/velista/feature-lists/src/lib/list-page/list-page.ts`, `_writeRun`), which the
> gateway then refuses with a 400, so the zone list's row steppers and reel fail to save a
> raise; the store's `raiseCountingExtra`, the model `CountedExtra` and its mapper read a
> `counted` that no answer carries; the page draws `Y` over a store that holds `Z`, and its
> "Still need" sends a second raise. Every other velista control raises without asking and
> takes the default, which is right; the basket's "Lists and amounts" and its catalog
> cards then show the larger ask from the answer with no question beside it until `0208`
> stage 4.

## Brief for the agent

### Objective

Make every raise of a list line move the units bought above the ask into the ask, in the
raise's own transaction, while the line rises by the full amount the person set; let five
requests ask for a report of what was taken in; add one write, "Count the extra", that
lowers the line by what the report offered; delete the demand's fold and `countExtra`.

### Context

- Backend `0274`: an open basket's ask of a line is `left + sum(applied)` over that
  basket's standing `BOUGHT` buys of the line in its scope; units above the ask are
  `quantity - applied`, never stored. A basket's `left` is the zone line's quantity, which
  every covering basket shares. A buy on the list page names no basket, so no ask reads it
  (`settlement.service.ts:206`).
- A revert takes a buy's units above the ask first, and puts only the applied units it
  takes back onto the line (`baskets/basket-revert.service.ts:170` to `:175`).
- Backend `0275`, as built on `dev` at `6fa4f4b9c`, under
  `apps/luna-shopper-backend/core/src/app/`:
  - `lists/line.service.ts:3869` to `:3991` (`addQuantity`): `counting` at `:3884`,
    `countersOf` before the transaction at `:3903`, the count under the lock at `:3947`, the
    branch "whole raise counted, line not written" at `:3952`, the events at `:3978` to
    `:3989`, `extra` on the answer at `:3990`.
  - `:3998` `countersOf` (open covering baskets with a kind and their scopes, through
    `this.dataSource`), `:4033` `countExtra` (buys of every counting basket, oldest first,
    `countAboveAsk`, the `applied` writes), `:4090` `buyersOf` (account, guest as the
    basket's owner, only approved members of the zone, one `null` entry), `:4161` `viewOf`.
  - `baskets/basket-applied.ts:113` `countAboveAsk`, `:148` `buysOf` (with `openOnly`),
    `:55` `rebalanceApplied` (the branch `target > held` at `:76` gives units above the ask
    back to a raised ask, oldest buy first).
  - `baskets/basket-demand.service.ts:96` `setDemand`: the plan at `:128`, `delta` at
    `:132`, the branch that moves only the split at `:166`, the write through
    `addQuantity(..., underLock)` at `:198`.
  - `baskets/basket-line-facts.ts:60` `basketScopeOf(runner, basket)` takes any runner, the
    transaction's manager included.
- The paths that raise a list line, all in `lists/line.service.ts`:
  - `addQuantity` (`:3869`), which the basket's demand also writes through;
  - `applyLineEdit` (`:2839`), behind `update` (`:2766`, the `PATCH` with an absolute
    `quantity` and an optional `expect`, plan 0209) and behind `updateAsOperator`
    (`:2812`, the admin app's operator edit); a rename onto a held name merges through
    `applyRename` instead;
  - `raiseForAdd` (`:2615`), behind `add` (`:1175`, `RAISED` when the add meets only a
    kept line, `:1229`, `:1333`; plan 0260 R2) and behind `addBatch` (`:1963`). The
    basket's "Add or find" (`baskets/basket-line-add.service.ts:66`) adds through `add`.
- Callers outside velista: the assistant writes `POST /v1/lists/:id/lines`,
  `/lines/batch`, `PATCH /v1/lines/:id` and `POST /v1/lines/:id/quantity`
  (`apps/luna-shopper-backend/assistant/src/app/assistant/gateway-api.client.ts:131`,
  `:190`, `:203`, `:227`) and reads the line back. The admin app raises a line only through
  the operator edit (`core/src/app/admin/admin-list.service.ts:250`, `:356`). Neither
  reads a basket's ask or `applied`.
- Gateway: `gateway/src/app/lists/list.controller.ts:624` (`POST /v1/lines/:id/quantity`),
  `list.dto.ts:378` (`AddLineQuantityDto`, `countExtra` at `:394` to `:406`);
  `gateway/src/app/baskets/basket.controller.ts:774` (`POST /v1/baskets/:id/rows/:rowKey/demand`);
  `gateway/src/app/docs/api-problem-responses.decorator.ts` (`staleQuantity` at `:47`).
- Contracts: `libs/luna-shopper/contracts/src/lib/messages/list.messages.ts:1093` to
  `:1165` (`AddLineQuantityRequest.countExtra`, `CountedExtraBuyer`, `CountedExtra`,
  `AddLineQuantityResult`), `:856` (`AddLineResult`), `:945` (`UpdateLineRequest`),
  `:1052` (`UpdateLineResult`); `basket.messages.ts:1202` (`BasketRowResult`);
  `libs/luna-shopper/contracts/src/schemas/messages/list.schemas.ts:36` to `:38`, `:263`,
  `:282`, `:678`.
- Core serves no names. The reader names a user id through the zone's members.

### What counts as extra

**The countable extra of a line** is the units above the ask on every standing buy that
an open basket's ask reads: each open basket that covers the line's list now
(`COVERING_BASKETS_SQL`, a basket with a kind), each in its scope (a `LIVE` basket's
current session alone), `BOUGHT`, not reverted, in the line's unit, through `buysOf` with
`openOnly`. Per buy it is `quantity - applied`. This is `0275`'s set, unchanged.

- **The same shopping list and another shopping list are the same case** (the owner's
  answer 1). A write made from basket A takes in A's extra and B's alike. Each unit taken
  in raises the `applied` of the buy that holds it, so it raises the ask of the basket that
  bought it: A's own extra raises A's ask, B's extra raises B's ask. In every basket the
  ask ends at or above what it bought. The rule holds for both.
- **What is not countable, and stays where it is:**
  - a buy of a finished basket: its trip is over, no ask reads it any more, and its
    `applied` is history;
  - a buy of a `LIVE` basket from before its current session, a reverted buy, a buy in
    another unit, a buy of a basket that no longer covers the list;
  - a buy made on the list page: it names no basket, so no ask reads it; its units above
    the line are recorded and never asked about, as today.
  None of these is "a unit above the ask" in any read, so the rule ("no unit is left above
  the ask") is not broken by them: there is no ask for them to be above. The report never
  names them.

### Target state

1. **One absorption for every raise.** A private `absorbExtra(manager, line, zoneId,
   counters)` in `LineService`, called under the line's lock after the line is written
   with its raised quantity, on the three raise paths: `addQuantity` when `delta > 0`,
   `applyLineEdit` when the locked line's quantity rose, and `raiseForAdd`. It reads the
   buys of the counting baskets with `buysOf` (`openOnly`), oldest first across all of them
   by `(settledAt, id)`, and sets every such buy's `applied` to its `quantity`. It answers
   `above` (the units it took in) and the buys it moved. It runs **for every caller, with
   or without `reportExtra`**: the assistant, the batch add and the admin app's operator
   edit included. It writes nothing on a lowering, on a zero delta, on `ALREADY_ON_LIST`,
   on an edit of the name alone, and on a merge of plan 0112 (a merge moves another line's
   ask onto this one; it is not an amount the person set).
   - `countAboveAsk(buys, delta)` becomes `absorbAboveAsk(buys)`: every unit above the ask,
     no delta. Its doc comment says "into the ask on a raise".
   - **Where the counting baskets are read.** `countersOf(runner, listId)` takes a runner.
     A route that knows before the lock that it may raise (`addQuantity` with a positive
     delta, `update` and `updateAsOperator` naming a `quantity`, the demand) reads them
     before the transaction through `this.dataSource`, as `0275` does, so the lock is held
     no longer. `add` and `addBatch` learn that they raise only under the lock, so they read
     them through the transaction's manager when they meet a kept line: through the
     manager it holds no second pool connection (the reason `0275` read outside,
     `line.service.ts:3886`). `buysOf` with `openOnly` drops a basket that finished in
     between, as today.
2. **The line rises by the whole amount set.** `0275`'s branch where a raise moves only
   `applied` and writes no line (`:3952`) is deleted. A raise always writes the line with
   the quantity the request asked for, its version bump, its change row and its events,
   exactly as the same raise without any extra.
3. **The events.** A raise that absorbed anything moved the ask of every basket it took
   units from, so every covering basket is told: the raise's announcement carries
   `linesMoved(listId, [lineId], true)` to the covering baskets (what `addQuantity`'s
   `'moved'` announcement already does). Where a raise path today tells only the zone, it
   adds that call when `above > 0`. No second announcement where one already goes.
4. **`countExtra` is removed** from `AddLineQuantityRequest`, `AddLineQuantityDto`, the
   request schema, the controller and their specs.
5. **The flag `reportExtra?: boolean`** (a JSON `true` or `false` only, absent is false)
   is added to five requests: `AddLineQuantityRequest`, `UpdateLineRequest`,
   `AddLineRequest`, `AddBasketLineRequest`, `SetBasketRowDemandRequest`, and to their
   gateway DTOs with the validation `AddLineQuantityDto.countExtra` uses today
   (`ValidateIf` plus the `Transform` that reads the body as spelled, then `IsBoolean`).
   Description: "Report the units bought above the ask that this raise moved into the
   ask, and what an answer of Count the extra would take off the line."
   - **Why a flag.** The absorption runs anyway. The flag adds only the read of the
     buyers (participants and memberships, `buyersOf`) and the field on the answer. The
     admin app, the assistant, a batch add and old clients ask nothing, so they pay
     nothing more and their answers keep their shape.
6. **What a report says**, the type `AbsorbedExtra` (it replaces `CountedExtra`; the buyer
   type `CountedExtraBuyer` becomes `ExtraBuyer`, same shape). With `reportExtra: true` and
   a write that raised the line:
   - `above`: the units above the ask that the raise moved into the ask, in the line's
     unit;
   - `countable`: what "Count the extra" would take off the line,
     `min(above, raisedBy)`, where `raisedBy = after - max(before, 0)`, `before` the
     quantity the lock read and `after` the quantity written. Bounded by the raise, so the
     count can never take the line below where it stood before the raise; bounded by
     `above`, so it never takes off more than the extra covers;
   - `buyers`: as `0275` built them (`buyersOf`, unchanged): `{ userId: string | null }`
     each, in the order of their oldest such buy, a guest as the owner of the basket the
     guest bought through, an id only for an approved member of the list's zone, every
     `null` one entry. Empty when `above` is 0.
   A raise with nothing above carries `extra` with zeros. A write that did not raise the
   line carries no `extra`. `countable > 0` exactly when `above > 0` and `raisedBy > 0`.
7. **The count write.** `line.countExtra` in core, `LineService.countExtra(req, options?)`:
   - request `CountLineExtraRequest`: `userId`, `lineId`, `unit` (required, checked as a
     delta's, plan 0246 M8), `amount` (a positive whole number within the line quantity
     bounds: the `countable` the client was answered), `expect` (required, whole: the
     line's quantity the client was answered, the `after` of the raise), and the internal
     `via?` and, through `options`, the permission set to use.
   - `amount > expect` is a 400 before anything is read.
   - In one transaction: read the line under `pessimistic_write`; `assertLineUnit`; if
     `line.quantity !== expect`, throw `StaleQuantityException` with `current` and write
     nothing (the owner's answer 2); `authorizeEdit({ quantity: line.quantity - amount },
     line, permissions)`, exactly as any lowering of the amount; lower the line by
     `amount` with `reopenAfterEdit`, a version bump and its change row
     (`changes.edited`, actor as the request's). `applied` does not move: the extra stays
     inside the ask, and the ask of every basket falls by `amount` with the line.
   - **What the server cannot check, and why that is safe.** Nothing is remembered about
     the raise, so the server does not know that `amount` is the `countable` it answered.
     It holds the count to the line as the person saw it (`expect`), and the count is a
     lowering that the same reader could make with the stepper, under the same
     authorization. Every basket's ask still ends at or above what it bought, because the
     extra is inside `applied` and the line cannot go below 0.
   - Events: as any written delta, `announce(list, written, 'moved')`: `line.updated` to
     the zone and `linesMoved(listId, [lineId], true)` to every covering basket.
   - Answer `CountLineExtraResult extends LineView` with `counted` (the units taken off,
     equal to `amount`).
8. **The list route.** `POST /v1/lines/:id/extra`, body `{ unit, amount, expect }`
   (`CountLineExtraDto`), the actor's own permissions, answers `201` with
   `CountLineExtraResult` (`ApiContractResponse(LINE_PATTERNS.countExtra, { status:
   CREATED })`, `ApiProblemResponses({ body: true, lineUnitMismatch: true, staleQuantity:
   true })`). Every POST is 201 with a contract body (the document spec refuses a 204).
9. **The basket route.** `POST /v1/baskets/:id/rows/:rowKey/extra`, body `{ lineId, unit,
   amount, expect }` (`CountBasketRowExtraDto`), guarded and throttled as the demand route
   is (`Participant`, `ParticipantThrottle(write)`), answering `201` with `BasketRowResult`
   and a new optional field `counted`, set by this write alone. Core's new
   `basket.rowCountExtra` opens the basket as `setDemand` does (`BasketWriteContext.open`,
   refused on a finished basket, `pick` for the line), asks plan 0131's `canChangeDemand`
   **of the owner**, and calls `LineService.countExtra` as the owner with
   `via: opened.via()`. It answers `opened.result([lineId])` plus `counted`. `expect` is
   the line's quantity, which is the entry's `left`.
10. **The errors of both count routes**: 400 for a body out of bounds, a missing field, a
    number spelled as a string, or `amount` above `expect`; 409 `line_unit_mismatch` for
    another unit; 409 `stale_quantity` for a line that no longer holds `expect`; 409 for a
    finished basket on the basket route, as the demand; 403 and 404 as the demand route and
    `PATCH /v1/lines/:id`. Never a 401.
11. **The demand no longer folds** (the owner's answer 1, and the absorption replaces it).
    `rebalanceApplied(buys, asked)` becomes: `held = sum(applied)`; when `asked < held`,
    lower `applied` newest buy first until it adds up to `asked` (today's lowering branch,
    unchanged) and `left = 0`; otherwise no buy moves and `left = asked - held`. The branch
    `target > held` is deleted. A rising ask thus raises the line by `asked - held - from`,
    and `addQuantity` takes in the extra under the same lock, this basket's own included.
    In the owner's example (asks 3, bought 5, `left` 0) a demand of 5 writes `left` 2 and
    takes 2 in: ask 7. `0274` folded instead and answered ask 5, `left` 0.
12. **The reports on each route.**
    - `addQuantity`: `AddLineQuantityResult.extra?: AbsorbedExtra`.
    - `update` (`PATCH /v1/lines/:id`): `UpdateLineResult.extra?`, when `quantity` rose.
      The report is read inside `applyLineEdit`'s transaction. A rename that merges
      reports nothing. `updateAsOperator` takes no flag.
    - `add` (`POST /v1/lists/:id/lines`): `AddLineResult.extra?`, on `RAISED` alone.
      `addBatch` takes no flag and absorbs.
    - The basket's add (`POST /v1/baskets/:id/lines`) and the demand
      (`POST /v1/baskets/:id/rows/:rowKey/demand`): `BasketRowResult.extra?`. The demand
      reports only when its `delta` is positive and the line was written through
      `addQuantity`; its branch that moves only the split (a lowering at `left` 0) reports
      nothing. The row in the answer carries every entry's new `asked`, which velista
      shows.
13. **The documents.** Regenerate and commit
    `apps/luna-shopper-backend/gateway/docs/openapi.json` with
    `npx nx run luna-shopper-backend-gateway:openapi`, then the admin wire types with
    `npx nx run luna-shopper-admin/models:wire-types`. Never edit either by hand.

### The cases

Each basket is read through its basket read: `asked / left / bought`, and the units above
the ask. `line` is the zone line's quantity, which every basket shares. "Report" is the
raise's `extra`; "count" is a write of target state 7. `Y` and `Z` are the numbers the
control shows after "Still need" and after "Count the extra" (velista `0208`): on a
control of the line, the line; in a basket's "Lists and amounts", that basket's ask. One
basket (A, Marta's) unless the case says two.

| Case | Before | The write | After | Answer |
| --- | --- | --- | --- | --- |
| 1. A list page raise over the same list's extra: asks 1, Marta bought 4 | line 0; A 1 / 0 / 4, 3 above | raise +4, report | line 4; A 8 / 4 / 4, 0 above | above 3, countable 3, buyers [Marta]; Y 4, Z 1 |
| 2. "Count the extra" after 1 | as after 1 | count 3, expect 4 | line 1; A 5 / 1 / 4 | counted 3 |
| 3. No answer after 1 (closed, left, too late) | as after 1 | nothing | line 4; A 8 / 4 / 4 | |
| 4. The owner's example, in A's "Lists and amounts": asks 3, bought 5, plus twice | line 0; A 3 / 0 / 5, 2 above | demand A to 5 (from 0), report | line 2; A 7 / 2 / 5, 0 above | above 2, countable 2, buyers [you]; Y 7, Z 5 |
| 5. The basket's count after 4 | as after 4 | basket count 2, expect 2 | line 0; A 5 / 0 / 5 | counted 2 |
| 6. Another shopping list's extra, from B's "Lists and amounts": A (Marta) asks 3 and bought 4; in B the list asks 0 | line 0; A 3 / 0 / 4, 1 above; B 0 / 0 / 0 | demand B to 2 (from 0), report | line 2; A 6 / 2 / 4, 0 above; B 2 / 2 / 0 | above 1, countable 1, buyers [Marta]; Y 2, Z 1 |
| 7. The basket's count after 6 | as after 6 | basket count 1, expect 2 | line 1; A 5 / 1 / 4; B 1 / 1 / 0 | counted 1 |
| 8. A list page raise smaller than the extra | line 0; A 1 / 0 / 4, 3 above | raise +2, report | line 2; A 6 / 2 / 4, 0 above | above 3, countable 2; Y 2, Z 0 |
| 9. Count after 8 | as after 8 | count 2, expect 2 | line 0; A 4 / 0 / 4 | counted 2. The ask before the raise was 1; it ends at 4, what was bought |
| 10. A raise smaller than the extra, in A's "Lists and amounts": asks 1, bought 4, set to 3 | line 0; A 1 / 0 / 4, 3 above | demand A to 3 (from 0), report | line 2; A 6 / 2 / 4 | above 3, countable 2; Y 6, Z 4. Neither is the 3 the person set |
| 11. Two baskets: A asks 3 and bought 4 (the older buy), B bought 2 with the line at 0 | line 0; A 3 / 0 / 4, 1 above; B 0 / 0 / 2, 2 above | raise +2, report | line 2; A 6 / 2 / 4; B 4 / 2 / 2; 0 above | above 3, countable 2, buyers [A's buyer, B's buyer]; Y 2, Z 0 |
| 12. Count after 11 | as after 11 | count 2, expect 2 | line 0; A 4 / 0 / 4; B 2 / 0 / 2 | counted 2 |
| 13. A stale count: after 1, somebody lowers the line to 2 | line 2 | count 3, expect 4 | nothing written | 409 `stale_quantity`, current 2 |
| 14. The extra is taken back after the raise: after 1, Marta reverts 3 | line 7; A 8 / 7 / 1 (the 3 units were inside the ask, so the revert puts them back on the line) | count 3, expect 4 | nothing written | 409 `stale_quantity`, current 7 |
| 15. A buy lands before the answer: after 1, Luis buys 1 through A | line 3; A 8 / 3 / 5 | count 3, expect 4 | nothing written | 409 `stale_quantity`, current 3 |
| 16. A weight: asks 1000 g, bought 1500 g | line 0; A 1000 / 0 / 1500, 500 above | raise +1500, report | line 1500; A 3000 / 1500 / 1500 | above 500, countable 500 |
| 17. Count after 16 | as after 16 | count 500, expect 1500 | line 1000; A 2500 / 1000 / 1500 | counted 500 |
| 18. No extra: asks 3, bought 2 | line 1; A 3 / 1 / 2, 0 above | raise +2, report | line 3; A 5 / 3 / 2 | above 0, countable 0, buyers [] |
| 19. A raise after 3 | as after 3 | raise +1, report | line 5; A 9 / 5 / 4 | above 0, countable 0: no question |
| 20. More bought after 3: Marta buys 6 more (the line goes to 0, 2 above on the new buy) | line 0; A 8 / 0 / 10, 2 above | raise +1, report | line 1; A 11 / 1 / 10 | above 2, countable 1: the question comes back; Y 1, Z 0 |
| 21. A lowering with the flag, after 1 | line 4 | raise -1, report | line 3; nothing absorbed | no `extra` |
| 22. No flag, as case 1 (the assistant, an old client) | as case 1 | raise +4 | as after 1 | no `extra` |
| 23. The line edit, as case 1 | as case 1 | `PATCH` quantity 4, report | as after 1 | `UpdateLineResult.extra` as case 1 |
| 24. The list's add meets the line at 0 | as case 1 | add the product, amount 2, report | `RAISED`; line 2; A 6 / 2 / 4 | `AddLineResult.extra` above 3, countable 2 |
| 25. A batch add, or the operator edit, raises the line | as case 1 | raise to 2 | line 2; A 6 / 2 / 4 | no `extra` |
| 26. The extra sits in a finished basket C | line 0; C finished, 2 above | raise +2, report | line 2; C untouched | above 0, countable 0 |
| 27. A guest raises the demand of a single entry row | as case 6 | demand B to 2, report | as after 6 | as case 6; the guest's client names "Someone" for any buyer it cannot resolve |

In case 1 the line holds 4, the amount the person set, and the 3 units Marta bought above
the ask are inside A's ask. Only case 2, the explicit answer, lowers the line, to 1. In
cases 4 and 10 the basket's ask rises by more than the person stepped, because the ask
counts this basket's own extra once it is inside; velista `0208` shows the server's ask.
In case 14 the line rises above what the person set without anybody touching it: the
units Marta took back were part of the ask, so they are needed again.

### Scope

- Work in `core` (`LineService.addQuantity`, `applyLineEdit`, `raiseForAdd`, the new
  `absorbExtra` and `countExtra`, `countersOf`; `basket-applied.ts`;
  `basket-demand.service.ts`; a new basket service beside the demand for the basket's
  count), the gateway (the five DTOs, two new routes, the controllers), the contracts
  (`list.messages.ts`, `basket.messages.ts`, the schemas, the pattern maps, their specs),
  and the generated files.
- No migration.
- Do NOT change the settle, the revert, the basket reads, the trips read or the freeze.
- Do NOT change what a write answers without `reportExtra`, except that `countExtra` is
  refused as an unknown field once it is removed.

### Constraints

- Real Postgres in the integration specs, on an ephemeral luna slot (CLAUDE.md, "One checkout
  runs one slot, unless the slot is `--ephemeral`"). The memory notes on TypeORM raw SQL
  traps and on luna backend spec traps apply.
- A read through another repository or `this.dataSource` inside a transaction holds two
  pool connections (the comment at `line.service.ts:3886`); inside the transaction,
  `countersOf` and `basketScopeOf` run through its manager.
- One expression for the buys (`buysOf`), one for the buyers (`buyersOf`), one for the
  absorption (`absorbAboveAsk`), one place that absorbs (`absorbExtra`). No second copy.
- A refusal about the line is a 403 or 409, never a 401 (a 401 signs velista out).
- No dashes as punctuation in comments.

### Action boundaries

- Stop and ask if `applyLineEdit` writes a raised quantity outside a transaction that holds
  the line's lock, so the absorption cannot run under it.
- Stop and ask if a path in core raises a list line's quantity without passing through
  `addQuantity`, `applyLineEdit` or `raiseForAdd`, so one absorption would not cover it.
- Stop and ask if `LineService.add` can answer `RAISED` for a line above zero, or if the
  basket's add can raise a line through a path that does not answer `RAISED`.
- Stop and ask if a guest participant can reach the basket count route on a row whose
  demand the guest may not change, and the owner's rule (`canChangeDemand`) lets it
  through.
- Stop and ask if `authorizeEdit` refuses the count's lowering for a reader who was
  allowed the raise it answers.
- The admin app's operator edit absorbs like any raise (this plan's choice: one rule for
  every raise). Stop and ask if a spec or a document of the admin app expects an operator's
  correction to leave the baskets' asks alone.
- Stop and ask if the assistant, or anything else outside velista, reads a basket's ask,
  `applied` or the demand's fold.

### Progress evidence

The specs of section 1 green on an ephemeral luna slot; `npx nx affected -t lint test`; the
gateway's `openapi-document.spec.ts` and the admin `wire-types.spec.ts` green on the
regenerated files.

## 1. Specs

Unit:

1. `absorbAboveAsk` sets every buy's `applied` to its `quantity`, answers the units it took
   in, oldest buy first, and moves nothing when nothing is above.
2. `rebalanceApplied` moves no buy on a rising ask and answers `left = asked - held`; its
   lowering is unchanged.

Integration, real Postgres, through the services and the basket read of each basket:

3. Every case of the table ends at its "After" column and answers its "Answer" column.
4. A raise absorbs with and without `reportExtra`, on every raise path (`addQuantity`,
   `update`, `updateAsOperator`, `add` on `RAISED`, `addBatch`, the demand, the basket's
   add); the report adds only the answer's field. A lowering, a zero delta,
   `ALREADY_ON_LIST`, a rename alone and a merge absorb nothing.
5. A raise writes one change row, bumps the version once and emits `line.updated`, and
   every covering basket whose ask moved is told, with its new `asked`.
6. Cases 13 to 15 write no change row, bump no version and emit nothing.
7. A count writes one change row, bumps the version once, moves no `applied`, and emits
   `line.updated` and `basket.linesChanged` to each covering basket.
8. A buy of a finished basket, a buy of a `LIVE` basket outside its current session, a buy
   made on the list page, a reverted buy and a buy in another unit are never absorbed nor
   reported.
9. The buyers of `0275`'s spec 5 hold for the report (a guest as the basket's owner, one
   buyer for a guest and the owner on one basket, no participant id, no name).
10. A write from a basket absorbs and reports that basket's own buys (cases 4 and 5).
11. A reader who may not lower an approved line is refused the count, and nothing moves;
    the basket count is refused when the owner may not change the demand.
12. A settle or a revert that lands between the raise's answer and the count is read under
    the lock and refuses the count.
13. `add` and `addBatch` read the counting baskets through the transaction's manager and
    hold one pool connection (a spec with a pool of one).
14. Every existing spec of the five routes passes unchanged without the flag, except the
    demand specs that assert the fold of `0274` and the `0275` specs that assert a counted
    raise, rewritten to the cases above.

Gateway:

15. Each of the five DTOs accepts `reportExtra` `true` and `false`, refuses `"true"` with a
    400, and passes it on; `AddLineQuantityDto` refuses `countExtra` as an unknown field.
16. The two count routes validate `amount` (positive, whole, within bounds, at most
    `expect`), `expect` (required, whole) and `unit`, answer 201, and pass `expect` to
    core.
17. The contract schemas accept every new response, with and without `extra`.

## 2. Acceptance criteria

- After any raise, by anybody, no unit is left above any open basket's ask: the extra is
  inside the ask, and the line holds the amount the person set.
- Only the count write lowers the line for the extra, by at most what the raise added, and
  it refuses a line that moved.
- Every route that raises a list line can report, and only when asked, about every open
  shopping list's extra, the writer's own included.
- Nothing about an answer is stored; a later raise asks again only about units bought
  above the ask after the last raise.
- No route answers differently without the new fields, except the removal of
  `countExtra`.

## Not in this plan

- The question, its words, its look and which controls ask (velista `0208`).
- A report on a batch add, on the operator edit or on the assistant's writes.
- An exception for the same shopping list (the owner: later, if users complain).
