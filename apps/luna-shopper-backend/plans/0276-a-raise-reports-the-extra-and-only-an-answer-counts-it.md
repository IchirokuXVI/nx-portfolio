# 0276: a raise reports the extra and only an answer counts it

> Decided on 2026-11-23. It amends backend `0275`, which is built (PR #1087) and merged
> into `dev`, and which no release carries.
>
> **What changes.** Backend `0275` counted the units bought above the ask inside the zone
> list's raise (`countExtra: true`), so the line ended at the smaller amount and the
> answer "Still need" sent a second raise. The owner corrected that on 2026-11-23: "If the
> user sets 4, it will be 4 unless he answers that he is ok with it going down to 1." So:
>
> - **A raise never counts by itself.** It writes the amount the person set, in full. With
>   `reportExtra: true` its answer says how many units are above the ask, how many of them
>   the raise can count, and who bought them. It moves no `applied`.
> - **Only the explicit answer "Count the extra" counts.** It is a write of its own, on the
>   line or on the basket row, that lowers the line by the units it counts and moves those
>   units into the ask, oldest buy first, in one transaction under the line's lock.
> - **The report is asked for by every control that raises a list line** (velista `0208`):
>   the line quantity route, the line edit, the list's add, the basket's add and the
>   basket's demand. Not only the zone list's rows.
> - `countExtra` is removed.
>
> **The owner's answers of 2026-11-25** (they were this plan's open questions):
>
> 1. **No exception for the same shopping list.** Every route reports every countable
>    extra, the extra bought through the same shopping list included: the person may have
>    forgotten it, or another shopper on the same shopping list bought it. One rule
>    everywhere. So the demand no longer gives this basket's own units above the ask back
>    to a raised ask (`0274`'s fold), and nothing is left out of a report. The owner's
>    note: if users complain later, the exception for the same shopping list can be added
>    then.
> 2. **A count whose line moved meanwhile is refused.** It answers `stale_quantity`,
>    counts nothing and writes nothing. Velista tells the person and shows the line's
>    current amount.
> 3. **An answered question is not asked again** (section 3). The answer "Still need" is
>    a write too, recorded on the line, so it holds for every member and on every device.
>
> **Dependencies and release rule.** It builds on backends `0274` and `0275` as merged on
> `dev`. **Release it together with velista `0208`.** The two replace behaviour that is in
> `dev` only: neither PR #1087 nor PR #1089 (velista `0207`) is on `main` or in any tag
> (the newest velista tag is `velista-v0.19.0` at `0f7476f4e`, 2026-11-03), so no
> installed client sends `countExtra`. The new request fields are optional, so this plan
> raises no `minClientVersion` (production holds `0.17.0`, and backend `0274` raises it
> with its own release). Release it with the set of velista `0200`, `0201` and backends
> `0273`, `0274`, as `0275` was to be.

## Brief for the agent

### Objective

Make a raise of a list line report the units bought above the ask without counting them,
add one write that counts them when the person answers "Count the extra" and one write
that records the answer "Still need", give all three to every route that raises a list
line, stop the demand's silent fold of a basket's own extra, and remove `countExtra`.

### Context

- Backend `0274`: an open basket's ask of a line is `left + sum(applied)` over that basket's
  standing `BOUGHT` buys of the line in its scope; units above the ask are
  `quantity - applied`, never stored. A basket's `left` is the zone line's quantity.
- Backend `0275`, as built on `dev` at `6fa4f4b9c`, under
  `apps/luna-shopper-backend/core/src/app/`:
  - `lists/line.service.ts:3869` to `:3991` (`addQuantity`): `counting` at `:3884`,
    `countersOf` before the transaction at `:3903`, the count under the lock at `:3947`, the
    branch "whole raise counted, line not written" at `:3952`, the events at `:3978` to
    `:3989`, `extra` on the answer at `:3990`.
  - `:3998` `countersOf` (open covering baskets and their scopes, read through the pool,
    outside the transaction), `:4033` `countExtra` (buys of every counting basket, oldest
    first, `countAboveAsk`, the `applied` writes), `:4090` `buyersOf` (account, guest as the
    basket's owner, only approved members of the zone, one `null` entry), `:4161` `viewOf`.
  - `baskets/basket-applied.ts:113` `countAboveAsk`, `:148` `buysOf` (with `openOnly`),
    `:55` `rebalanceApplied` (the branch `target > held` gives units above the ask back to a
    raised ask, oldest buy first).
  - `baskets/basket-demand.service.ts:96` `setDemand`: the plan at `:128`, `delta` at
    `:132`, the branch that moves only the split at `:166`, the write through
    `addQuantity(..., underLock)` at `:198`.
- The other routes that raise a list line:
  - `lists/line.service.ts:2766` `update` and `:2839` `applyLineEdit` (the `PATCH` with an
    absolute `quantity` and an optional `expect`, plan 0209; a rename onto a held name
    merges through `applyRename`).
  - `lists/line.service.ts:1175` `add`: answers `RAISED` when the add meets only a line at
    zero or below and raises it (`:1229`, `:1333`; plan 0260 R2), `ALREADY_ON_LIST` when
    it meets a wanted line and writes nothing.
  - `baskets/basket-line-add.service.ts:66` `add` (the basket's "Add or find"), which adds
    through `LineService` and answers `BasketRowResult.addOutcome`.
- A line bought above its ask sits at 0 (the floor of the settle), so an add that meets it
  answers `RAISED`. That is the case where the add field raises a line with extra.
- The line is `entities/list-line.entity.ts` (`list_lines`); a buy is
  `entities/line-settlement.entity.ts` (`line_settlements`, ordered by `settledAt` and `id`).
- Gateway: `gateway/src/app/lists/list.controller.ts:624` (`POST /v1/lines/:id/quantity`),
  `list.dto.ts:378` (`AddLineQuantityDto`, `countExtra` at `:394` to `:406`);
  `gateway/src/app/baskets/basket.controller.ts:774` (`POST /v1/baskets/:id/rows/:rowKey/demand`);
  `gateway/src/app/docs/api-problem-responses.decorator.ts` (`staleQuantity` at `:47`).
- Contracts: `libs/luna-shopper/contracts/src/lib/messages/list.messages.ts:1093` to `:1165`
  (`AddLineQuantityRequest.countExtra`, `CountedExtraBuyer`, `CountedExtra`,
  `AddLineQuantityResult`), `:856` (`AddLineResult`), `:945` (`UpdateLineRequest`), `:1052`
  (`UpdateLineResult`); `basket.messages.ts:1202` (`BasketRowResult`);
  `libs/luna-shopper/contracts/src/schemas/messages/list.schemas.ts:36` to `:38`, `:263`,
  `:282`, `:678`.
- Core serves no names. The reader names a user id through the zone's members.

### Target state

1. **`countExtra` is removed** from `AddLineQuantityRequest`, `AddLineQuantityDto`, the
   request schema, the controller and their specs. The arithmetic `countAboveAsk` stays
   (it is the count of target state 6), renamed in its doc comment from "toward a raise"
   to "toward an answer". `0275`'s branch where a raise writes only `applied` is deleted:
   a raise always writes the line.
2. **The flag `reportExtra?: boolean`** (a JSON `true` or `false` only, absent is false) is
   added to five requests: `AddLineQuantityRequest`, `UpdateLineRequest`, `AddLineRequest`,
   `AddBasketLineRequest`, `SetBasketRowDemandRequest`, and to their gateway DTOs with the
   validation `AddLineQuantityDto.countExtra` uses today (`ValidateIf` plus the `Transform`
   that reads the body as spelled, then `IsBoolean`). Description: "Report the units bought
   above the ask in open shopping lists when this write raises the line. Nothing is
   counted."
   - **Why a flag and not always.** A report costs one read per covering basket outside
     the transaction (`countersOf`) and one read of buys and of members inside it, and the
     reel and the steppers send a write per quiet beat. The admin app, the assistant, a
     batch add and old clients need no report. With the flag, every caller that does not
     ask keeps its answer and its cost exactly as today.
3. **When it reports.** With `reportExtra: true` and a write that raised the line, read
   under the line's lock: `before` the quantity the lock read, `after` the quantity
   written, `raisedBy = after - max(before, 0)`. A write that did not raise the line (a
   lowering, a zero delta, an `ALREADY_ON_LIST`, an edit of the name alone, a merge of plan
   0112) carries no `extra`. A raise with nothing above carries `extra` with zeros.
4. **What it reports**, the type `ExtraAboveAsk` (it replaces `CountedExtra`; the buyer
   type `CountedExtraBuyer` becomes `ExtraBuyer`, same shape):
   - `above`: the units above the ask on the standing buys of the line in the counting
     baskets (target state 5), read in the write's transaction after the line is written,
     in the line's unit;
   - `countable`: the units "Count the extra" would take off. It is
     `min(raisedBy, above, after)`, and it is 0 when the line's recorded answer still
     covers every unit above the ask (section 3, rule 3);
   - `buyers`: as `0275` built them (`buyersOf`, unchanged): `{ userId: string | null }`
     each, in the order of their oldest such buy, a guest as the owner of the basket the
     guest bought through, an id only for an approved member of the list's zone, every
     `null` one entry. Empty when `above` is 0.
   Nothing is written by the report: no `applied`, no record of an answer, no change row
   beyond the raise's own. The raise's events are the events of the same raise without the
   flag.
5. **The counting baskets.** The open baskets that cover the line's list now
   (`countersOf`, read before the transaction), each in its scope, through `buysOf` with
   `openOnly`, as `0275` built it. **Nothing is left out**, on any route (the owner's
   answer 1): a write made from a basket counts that basket's own buys as every other
   basket's. There is no `excludeBasketId`.
6. **The count write.** `line.countExtra` in core, `LineService.countExtra(req, options?)`:
   - request `CountLineExtraRequest`: `userId`, `lineId`, `unit` (required, checked as a
     delta's, plan 0246 M8), `amount` (a positive whole number within the line quantity
     bounds: the `countable` the client was answered), `expect` (required: the line's
     quantity the client was answered, the `after` of the raise), and the internal
     `via?` and, through `options`, the permission set to use.
   - In one transaction: read the line under `pessimistic_write`; `assertLineUnit`; if
     `line.quantity !== expect`, throw `StaleQuantityException` and write nothing (the
     owner's answer 2); read the standing buys of the counting baskets under the lock,
     oldest first across all of them by `(settledAt, id)` (`0275`'s order);
     `counted = min(amount, above now, line.quantity)`, so the line never goes below 0.
   - `counted === 0` (the extra is gone, by a revert or another person's count): write
     nothing, emit nothing, answer the line as it stands with `counted: 0`.
   - Otherwise: `authorizeEdit({ quantity: line.quantity - counted }, line, permissions)`,
     exactly as any lowering of the amount; raise `applied` with `countAboveAsk(buys,
     counted)`; lower the line by `counted` with `reopenAfterEdit`, a version bump and its
     change row (`changes.edited`, actor as the request's); clear the line's recorded
     answer (section 3, rule 4); all under the same lock.
   - Events: as any written delta, `announce(list, written, 'moved')`: `line.updated` to
     the zone and `linesMoved(listId, [lineId], true)` to every covering basket, which
     carries each counted basket's moved `asked`.
   - Answer `CountLineExtraResult extends LineView` with `counted` (the units moved into
     the ask) and `above` (the units still above the ask after the write).
7. **The list route.** `POST /v1/lines/:id/extra`, body `{ unit, amount, expect }`
   (`CountLineExtraDto`), the actor's own permissions, answers `201` with
   `CountLineExtraResult` (`ApiContractResponse(LINE_PATTERNS.countExtra, { status:
   CREATED })`, `ApiProblemResponses({ body: true, lineUnitMismatch: true, staleQuantity:
   true })`). Every POST is 201 with a contract body (the document spec refuses a 204).
8. **The basket route.** `POST /v1/baskets/:id/rows/:rowKey/extra`, body `{ lineId, unit,
   amount, expect }`, guarded and throttled as the demand route is (`Participant`,
   `ParticipantThrottle(write)`), answering `BasketRowResult` with a new optional field
   `counted`, set by this write alone. Core's new `basket.rowCountExtra` opens the basket as
   `setDemand` does (`BasketWriteContext.open`, refused on a finished basket, `pick` for the
   line), asks plan 0131's `canChangeDemand` **of the owner**, and calls
   `LineService.countExtra` as the owner with `via: opened.via()`. It answers
   `opened.result([lineId])` plus `counted`.
9. **The "Still need" write**, section 3, with its two routes.
10. **The demand no longer folds this basket's extra** (the owner's answer 1).
    `rebalanceApplied`'s branch `target > held` is deleted: a raised ask gives no units
    above the ask back, the line holds `asked - held`, and the units stay above, where the
    demand's report names them. The lowering branch (`target < held`) stays. This is the
    one change a caller sees without `reportExtra`: a raise of a basket's ask over its own
    units above the ask now raises the line by the whole raise, and only a count lowers it.
    It follows the owner's first ruling, that a raise never counts by itself.
11. **The reports on each route.**
    - `addQuantity`: `AddLineQuantityResult.extra?: ExtraAboveAsk`.
    - `update` (`PATCH /v1/lines/:id`): `UpdateLineResult.extra?`, when `quantity` rose.
      The report is read inside `applyLineEdit`'s transaction. A rename that merges
      reports nothing.
    - `add` (`POST /v1/lists/:id/lines`): `AddLineResult.extra?`, on `RAISED` alone.
      `addBatch` takes no flag.
    - The basket's add (`POST /v1/baskets/:id/lines`) and the demand
      (`POST /v1/baskets/:id/rows/:rowKey/demand`): `BasketRowResult.extra?`. The demand
      reports only when its `delta` (`planned.left - from`) is positive and the line was
      written through `addQuantity`; its branch that moves only the split (`delta === 0`)
      reports nothing.
12. **The cost stays where it was without the flag.** `countersOf` runs only when the flag
    is true and the write can raise (for `update`, when the request names a `quantity`).
13. **The documents.** Regenerate and commit `apps/luna-shopper-backend/gateway/docs/openapi.json`
    with `npx nx run luna-shopper-backend-gateway:openapi`, then the admin wire types with
    `npx nx run luna-shopper-admin/models:wire-types`. Never edit either by hand.

### The cases

Each basket is read through its basket read: `asked / left / bought`, and the units above
the ask. `line` is the zone line's quantity, which every basket shares. "Report" is the
raise's `extra`; "count" is a write of target state 6; "still need" is a write of section
3. "Record" is the line's recorded answer: units, and the mark. One basket (A, Marta's)
unless the case says two.

| Case | Before | The write | After | Answer |
| --- | --- | --- | --- | --- |
| 1. The owner's example: asks 1, Marta bought 4 | line 0; A 1 / 0 / 4, 3 above | raise +4, report | line 4; A 5 / 4 / 4, 3 above | `extra` above 3, countable 3, buyers [Marta] |
| 2. "Count the extra" after 1 | as after 1 | count 3, expect 4 | line 1; A 5 / 1 / 4, 0 above | counted 3, above 0 |
| 3. No answer after 1 (closed, left, too late) | as after 1 | nothing | line 4, as after 1, no record | |
| 4. A raise smaller than the extra | line 0; A 1 / 0 / 4, 3 above | raise +2, report | line 2; A 3 / 2 / 4, 3 above | above 3, countable 2 |
| 5. Count after 4 | as after 4 | count 2, expect 2 | line 0; A 3 / 0 / 4, 1 above | counted 2, above 1 |
| 6. Two baskets: A asks 3 and bought 4 (the older buy), B bought 2 with the line at 0 | line 0; A 3 / 0 / 4, 1 above; B 0 / 0 / 2, 2 above | raise +2, report | line 2; A 5 / 2 / 4, 1 above; B 2 / 2 / 2, 2 above | above 3, countable 2, buyers [A's buyer, B's buyer] |
| 7. Count after 6 | as after 6 | count 2, expect 2 | line 0; A 4 / 0 / 4, 0 above; B 1 / 0 / 2, 1 above | counted 2, above 1 |
| 8. The extra shrank: after 1, Marta reverts 2 (the revert takes units above the ask first, backend `0274`) | line 4; A 5 / 4 / 2, 1 above | count 3, expect 4 | line 3; A 5 / 3 / 2, 0 above | counted 1, above 0 |
| 9. The extra is gone: after 1, Marta reverts 3 | line 4; A 5 / 4 / 1, 0 above | count 3, expect 4 | nothing written, nothing emitted | counted 0, above 0 |
| 10. The line moved: after 1, somebody lowers it to 2 | line 2 | count 3, expect 4 | nothing written | 409 `stale_quantity` |
| 11. A weight: asks 1000 g, bought 1500 g | line 0; A 1000 / 0 / 1500, 500 above | raise +1500, report | line 1500; A 2500 / 1500 / 1500, 500 above | above 500, countable 500 |
| 12. Count after 11 | as after 11 | count 500, expect 1500 | line 1000; A 2500 / 1000 / 1500, 0 above | counted 500, above 0 |
| 13. No extra: asks 3, bought 2 | line 1; A 3 / 1 / 2, 0 above | raise +2, report | line 3; A 5 / 3 / 2 | above 0, countable 0, buyers [] |
| 14. A lowering with the flag, after 1 | line 4 | raise -1, report | line 3 | no `extra` |
| 15. No flag, as case 1 | line 0; A 1 / 0 / 4, 3 above | raise +4 | as after 1 | no `extra` |
| 16. The line edit, as case 1 | as case 1 | `PATCH` quantity 4, report | as after 1 | `UpdateLineResult.extra` as case 1 |
| 17. The list's add meets the line at 0 | as case 1 | add the product, amount 2, report | `RAISED`; line 2; A 3 / 2 / 4, 3 above | `AddLineResult.extra` above 3, countable 2 |
| 18. The demand, another basket's extra: A (Marta) asks 3 and bought 4; in your basket B the list asks 0 | line 0; A 3 / 0 / 4, 1 above; B 0 / 0 / 0 | demand B to 2 (from 0), report | line 2; A 5 / 2 / 4, 1 above; B 2 / 2 / 0 | `BasketRowResult.extra` above 1, countable 1, buyers [Marta] |
| 19. The basket's count after 18 | as after 18 | basket count 1, expect 2 | line 1; A 5 / 1 / 4, 0 above; B 1 / 1 / 0 | `counted` 1 |
| 20. The demand, this basket's own extra: you bought 4 of an ask of 3 in B | line 0; B 3 / 0 / 4, 1 above | demand B to 5 (from 0), report | line 2; B 5 / 2 / 4, 1 above (no fold) | above 1, countable 1, buyers [you] |
| 21. The basket's count after 20 | as after 20 | basket count 1, expect 2 | line 1; B 5 / 1 / 4, 0 above | `counted` 1; the ask stays 5 |
| 22. "Still need" after 1 | as after 1 | still need, above 3, expect 4 | line 4, nothing else moves; record 3, marked at Marta's buy | recorded 3 |
| 23. A raise after 22 | line 4; record 3 | raise +1, report | line 5; A 6 / 5 / 4, 3 above | above 3, countable 0: no question |
| 24. More bought after 22: Marta buys 6 more (the line goes to 0, 2 above on the new buy) | line 0; A 5 / 0 / 10, 5 above; record 3 | raise +1, report | line 1 | above 5, countable 1: the question comes back, about 5 |
| 25. The extra shrank, then more was bought: after 22, Marta reverts 2 (1 above on the old buy), then buys 6 more (2 above on the new buy) | line 0; A 5 / 0 / 8, 3 above; record 3 | raise +1, report | line 1 | covered 1, above 3, countable 1: the question comes back. An amount without the mark would have silenced it |
| 26. "Still need" on a moved line: after 1, somebody lowers it to 2 | line 2 | still need, above 3, expect 4 | nothing recorded | 409 `stale_quantity` |
| 27. "Still need" when the extra is gone: after 1, Marta reverts 3 | line 4; 0 above | still need, above 3, expect 4 | nothing recorded | recorded 0 |
| 28. A count after 24 clears the record | as after 24 | count 1, expect 1 | line 0; record cleared | counted 1, above 4 |
| 29. A unit change after 22 | line 4; record 3 | the line moves to grams | record cleared | |

In case 1 the line holds 4, the amount the person set. Only case 2, the explicit answer,
lowers it to 1. In case 21 the ask stays 5 because a basket's ask is `left` plus its own
applied units: the count moved the unit from above the ask into it, and `left` fell from 2
to 1. Velista `0208` words the question in a basket by what is left for this reason.

### Scope

- Work in `core` (`LineService.addQuantity`, `update`/`applyLineEdit`, `add`, the new
  `countExtra` and `stillNeedExtra`, the clearing of the record on a unit change, a
  removal and a merge; `basket-demand.service.ts`, `basket-line-add.service.ts`, a new
  basket service beside the demand for both basket writes; `basket-applied.ts`; one
  migration for the three columns), the gateway (the five DTOs, four new routes, the
  controllers), the contracts (`list.messages.ts`, `basket.messages.ts`, the schemas, the
  pattern maps, their specs), and the generated files.
- Do NOT change the settle, the revert, the basket reads, the trips read or the freeze.
- Do NOT change what any route does without `reportExtra`, except two things: `countExtra`
  is refused as an unknown field once it is removed, and the demand no longer folds this
  basket's own extra (target state 10).

### Constraints

- Real Postgres in the integration specs, on an ephemeral luna slot (CLAUDE.md, "One checkout
  runs one slot, unless the slot is `--ephemeral`"). The memory notes on TypeORM raw SQL
  traps and on luna backend spec traps apply.
- The covering baskets and their scopes are read outside the transaction; a read through
  another repository inside it holds two pool connections (the comment at
  `line.service.ts:3886`).
- One expression for the buys (`buysOf`), one for the buyers (`buyersOf`), one for the count
  arithmetic (`countAboveAsk`), one for `covered`. No second copy.
- A refusal about the line is a 403 or 409, never a 401 (a 401 signs velista out).
- No dashes as punctuation in comments.

### Action boundaries

- Stop and ask if `applyLineEdit` writes a raised quantity outside a transaction that holds
  the line's lock, so the report cannot be read under it.
- Stop and ask if `LineService.add` can answer `RAISED` for a line above zero, or if the
  basket's add can raise a line through a path that does not answer `RAISED`.
- Stop and ask if a guest participant can reach the basket count route or the basket
  "Still need" route on a row whose demand the guest may not change, and the owner's rule
  (`canChangeDemand`) lets it through.
- Stop and ask if `authorizeEdit` refuses the count's lowering for a reader who was allowed
  the raise it answers, or if no edit check fits a write that moves no amount.
- Stop and ask if a caller other than velista (the assistant, the admin app) relies on the
  demand's fold of target state 10.
- Stop and ask if the owner changes section 3 before you build it: it is the
  orchestrator's design, to be confirmed.

### Progress evidence

The specs of section 1 green on an ephemeral luna slot; `npx nx affected -t lint test`; the
gateway's `openapi-document.spec.ts` and the admin `wire-types.spec.ts` green on the
regenerated files.

## 1. Specs

Unit:

1. `countAboveAsk` gives the `applied` and `counted` of cases 2, 5, 7, 8, 9 and 12 from
   their buys, oldest first, never raises an `applied` above its `quantity`, and counts
   nothing for an amount of 0.
2. `rebalanceApplied` gives nothing back on a raised ask, and its lowering is unchanged.
3. `covered` gives the numbers of cases 23 to 25 from their buys and record, and 0 with no
   record.

Integration, real Postgres, through the services and the basket read of each basket:

4. Every case of the table ends at its "After" column and answers its "Answer" column.
5. A raise with `reportExtra` writes no `applied` and no record, and its change row and
   events are those of the same raise without the flag.
6. Cases 9, 10, 26 and 27 write no change row, bump no version and emit nothing; case 22
   writes the record alone, with no version bump, no change row and no event.
7. A count writes one change row, bumps the version once, emits `line.updated` and
   `basket.linesChanged` to each covering basket with the counted baskets' `asked` moved,
   and clears the record.
8. A buy of a `LIVE` basket outside its current session, a buy made on the list page, a
   reverted buy and a buy in another unit are never reported, counted nor covered.
9. The buyers of `0275`'s spec 5 hold for the report (a guest as the basket's owner, one
   buyer for a guest and the owner on one basket, no participant id, no name).
10. A write from a basket reports, counts and records that basket's own buys (cases 20 and
    21).
11. A reader who may not lower an approved line is refused the count, and no `applied`
    moves; the basket count and the basket "Still need" are refused when the owner may not
    change the demand.
12. A settle that lands between the raise's answer and the count or the "Still need" is
    read under the lock.
13. A unit change, a removal and a merge clear the record.
14. Every existing spec of the five routes passes unchanged without the flag, except the
    demand specs that assert the fold of `0274`, rewritten to target state 10; the `0275`
    specs that assert a counted raise are rewritten to the cases above.

Gateway:

15. Each of the five DTOs accepts `reportExtra` `true` and `false`, refuses `"true"` with a
    400, and passes it on; `AddLineQuantityDto` refuses `countExtra` as an unknown field.
16. The two count routes validate `amount` (positive, whole, within bounds), `expect`
    (required, whole) and `unit`, answer 201, and pass `expect` to core.
17. The two "Still need" routes validate `above` (positive, whole, within bounds), `expect`
    and `unit` the same way, answer 201, and pass `expect` to core.
18. The contract schemas accept every new response, with and without `extra`.

## 2. Acceptance criteria

- A raise always writes the amount the person set, and its report counts nothing.
- Only the count write lowers the line for the extra, and it refuses a line that moved.
- Every route that raises a list line can report, and only when asked, about every
  shopping list's extra, the writer's own included.
- After "Still need", no raise reports the same extra as countable again, for any member
  on any device; extra bought after the answer brings the question back.
- No route behaves differently without the new fields, except the removal of `countExtra`
  and the end of the demand's fold.

## 3. An answered question is not asked again

> **Decided in principle by the owner on 2026-11-25. The design below is the
> orchestrator's, to be confirmed by the owner.** The owner's rule: once someone answered
> "Still need" or "Count the extra" for a line, a later raise of that line does not ask
> about the same extra again.

1. **The answer lives on the line, in the backend.** It holds for every member of the
   list and on every device, not per person and not in the app's memory. Only the two
   answers record anything. Closing the question, leaving the page, and a default taken
   because the control was gone are no answer and record nothing.
2. **"Count the extra" needs no record.** It moves the units it counts into the ask, so
   they are no longer above the ask and nothing is left to ask about. Units it could not
   count (a raise smaller than the extra, case 5) stay above the ask, and a later raise
   asks about them: the person asked to count, and the rest is still uncounted.
3. **"Still need" records what it covered.** Three nullable columns on `list_lines`, in a
   core migration: `extra_still_needed` (the units, in the line's unit),
   `extra_still_needed_through_at` and `extra_still_needed_through_id` (the `settledAt`
   and `id` of the newest standing buy of the line in the counting baskets when the answer
   was recorded). On every report, under the line's lock:
   - `covered = min(extra_still_needed, the units above the ask on the standing buys at or
     before (through_at, through_id))`, 0 when nothing is recorded;
   - when `above <= covered`, the record still covers every unit above the ask: the report
     carries `above` and `buyers` as always and `countable: 0`, so the app asks nothing;
   - when `above > covered`, someone bought more above the ask since the answer, or the
     ask fell under older buys: `countable` is as in target state 4, and the question comes
     back, about the whole current extra (`above`).
4. **When the record goes.**
   - **The extra shrinks** (a buy is reverted, a shopping list is finished and its buys
     stop counting): nothing is written, and nothing has to be. `covered` is read each
     time from the buys that still stand at or before the mark, so it can never be more
     than what is still above the ask on them. Units that arrive later sit on newer buys,
     after the mark, and are never covered. This is why an amount alone is not enough: the
     revert runs in the basket code and takes no lock of the line, so an amount it does not
     lower would silence a later, unrelated extra (case 25).
   - **A count** with `counted > 0` clears the record, in its own transaction.
   - **The line starts over**: a change of the line's unit (the units no longer compare),
     the removal of the line, and a merge of plan 0112 (the merged line's record goes with
     it; the line it merges into keeps its own) clear it.
   - The settle, the revert and the basket reads do not touch it.
5. **The write.** `line.stillNeedExtra` in core, `LineService.stillNeedExtra(req, options?)`:
   - request `StillNeedLineExtraRequest`: `userId`, `lineId`, `unit` (required, checked as
     a delta's), `above` (a positive whole number within the line quantity bounds: the
     `above` the client was answered, the extra the question named), `expect` (required:
     the line's quantity the client was answered), the internal `via?`, and through
     `options` the permission set to use.
   - In one transaction: read the line under `pessimistic_write`; `assertLineUnit`; if
     `line.quantity !== expect`, throw `StaleQuantityException` and record nothing (as the
     count; the person answered about numbers that are no longer true, and the cost is one
     more question); read the standing buys of the counting baskets under the lock; the
     reader must be allowed the same edit of the line that the raise needed
     (`authorizeEdit` with the line's quantity as it stands).
   - `above now === 0`: record nothing, answer `recorded: 0`.
   - Otherwise write `extra_still_needed = min(above, above now)` and the mark of the
     newest standing buy. When `above now` is larger than the `above` sent, somebody
     bought more between the question and the answer: the record covers only what the
     question named, so the next raise asks again.
   - No version bump, no change row, no event: the line's amount does not move, and no
     other screen shows the record.
   - Answer `StillNeedLineExtraResult extends LineView` with `recorded` (the units
     recorded).
6. **The list route.** `POST /v1/lines/:id/extra/still-needed`, body `{ unit, above,
   expect }` (`StillNeedLineExtraDto`), the actor's own permissions, answers `201` with
   `StillNeedLineExtraResult` (`ApiContractResponse(LINE_PATTERNS.stillNeedExtra, {
   status: CREATED })`, `ApiProblemResponses({ body: true, lineUnitMismatch: true,
   staleQuantity: true })`).
7. **The basket route.** `POST /v1/baskets/:id/rows/:rowKey/extra/still-needed`, body `{
   lineId, unit, above, expect }`, guarded and throttled as the demand route is, answering
   `BasketRowResult` with a new optional field `recorded`, set by this write alone. Core's
   new `basket.rowStillNeedExtra` opens the basket as `basket.rowCountExtra` does (refused
   on a finished basket, `pick` for the line, `canChangeDemand` of the owner) and calls
   `LineService.stillNeedExtra` as the owner with `via: opened.via()`.
8. **The errors of both routes**: 400 for a body out of bounds, a missing field, or a number
   spelled as a string; 409 `line_unit_mismatch` for another unit; 409 `stale_quantity` for a line that
   moved; 409 for a finished basket on the basket route, as the demand; 403 and 404 as the
   demand route and `PATCH /v1/lines/:id`. Never a 401.

## Not in this plan

- The question, its words, its look and which controls ask (velista `0208`).
- A report on a batch add or on the assistant's writes.
