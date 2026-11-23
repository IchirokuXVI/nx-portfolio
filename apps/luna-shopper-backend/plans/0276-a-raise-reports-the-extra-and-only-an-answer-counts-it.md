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
> **Dependencies and release rule.** It builds on backends `0274` and `0275` as merged on
> `dev`. **Release it together with velista `0208`.** The two replace behaviour that is in
> `dev` only: neither PR #1087 nor PR #1089 (velista `0207`) is on `main` or in any tag
> (the newest velista tag is `velista-v0.19.0` at `0f7476f4e`, 2026-11-03), so no
> installed client sends `countExtra`. The new request fields are optional, so this plan
> raises no `minClientVersion` (production holds `0.17.0`, and backend `0274` raises it
> with its own release). Release it with the set of velista `0200`, `0201` and backends
> `0273`, `0274`, as `0275` was to be.

## Questions for the owner (open)

1. **What extra can the basket's "Lists and amounts" ask about?** That view sets a list's
   **whole** ask through the demand route (backend `0274`, target state 8), and the demand
   already gives units that **this** shopping list bought above the ask back to a raised
   ask, silently (`rebalanceApplied`, the branch `target > held`). Example for both
   readings: the list asks 3 and you bought 4 in your shopping list (asked 3, left 0,
   bought 4, 1 above). In "Lists and amounts" you set the ask to 5.
   - **(a) This shopping list's own extra stays folded, as `0274` built it.** The ask
     becomes 5, left 1, bought 4, nothing above, and no question. The question in a
     basket control asks only about units that **other** open shopping lists bought above
     the ask of the same list. Example: Marta's shopping list bought 4 of an ask of 3; in
     yours the list asks 0; you set it to 2: the line holds 2, Marta's 1 unit is
     reported, and "Count the extra" leaves your ask at 1.
   - **(b) This shopping list's own extra waits for the answer too.** `rebalanceApplied`
     stops giving units back on a raise. The ask becomes 5, left 2, bought 4, 1 above, and
     the answer reports "You already bought 1 extra". But "Count the extra" then moves that
     unit into this basket's own ask: left 1, applied 4, and the ask **stays 5**, because
     a basket's ask is `left` plus its own applied units. The question "Do you still need
     5, or just 4?" would not be true: the only honest words speak of what is left ("2
     more, or just 1 more?"), which the owner has not ruled. Until the person answers,
     the sheet also shows ask 5, bought 4 and left 2, which do not add up for a reader.
     It also changes `0274`'s demand: an ask lowered below what was bought and raised back
     would ask instead of giving the units back.
   - **Recommendation: (a).** In a basket's own sheet the person sees their own buys next to
     the ask, so folding them asks nothing that the screen does not already say; only
     another shopping list's buys are news. This plan is written for (a); section 6 lists
     what (b) changes.
2. **A count whose line moved meanwhile.** The person answers "Count the extra", but since
   the question opened somebody changed the line (lowered it from 4 to 2, say).
   - **(a) Refuse** with `stale_quantity` and write nothing, as the demand's `from` does.
     The amount the person set stands (the default), and velista says the amount changed.
   - **(b) Count anyway**, capped by what the line holds now.
   - **Recommendation: (a).** The answer was about numbers that are no longer true, and a
     lowering by another person can itself have been a count by hand, so (b) can lower the
     line twice. The plan is written for (a).

## Brief for the agent

### Objective

Make a raise of a list line report the units bought above the ask without counting them,
add one write that counts them when the person answers "Count the extra", give both to
every route that raises a list line, and remove `countExtra`.

### Context

- Backend `0274`: an open basket's ask of a line is `left + sum(applied)` over that basket's
  standing `BOUGHT` buys of the line in its scope; units above the ask are
  `quantity - applied`, never stored.
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
    `:55` `rebalanceApplied`.
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
- Gateway: `gateway/src/app/lists/list.controller.ts:624` (`POST /v1/lines/:id/quantity`),
  `list.dto.ts:378` (`AddLineQuantityDto`, `countExtra` at `:394` to `:406`);
  `gateway/src/app/baskets/basket.controller.ts:774` (`POST /v1/baskets/:id/rows/:rowKey/demand`).
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
   - `countable`: `min(raisedBy, above, after)`, the units "Count the extra" would take off;
   - `buyers`: as `0275` built them (`buyersOf`, unchanged): `{ userId: string | null }`
     each, in the order of their oldest such buy, a guest as the owner of the basket the
     guest bought through, an id only for an approved member of the list's zone, every
     `null` one entry. Empty when `above` is 0.
   Nothing is written by the report: no `applied`, no change row beyond the raise's own.
   The raise's events are the events of the same raise without the flag.
5. **The counting baskets.** The open baskets that cover the line's list now
   (`countersOf`, read before the transaction), each in its scope, through `buysOf` with
   `openOnly`, as `0275` built it. One exception, internal and never on the wire: a write
   made from a basket (the demand and the basket's add) passes `excludeBasketId`, the
   basket's own id, and that basket's buys are left out of `above`, `countable` and
   `buyers` (question 1, reading (a)). The zone list's routes leave nothing out: the
   reader's own shopping list counts there, as `0275` built it ("You already bought 1
   extra").
6. **The count write.** `line.countExtra` in core, `LineService.countExtra(req, options?)`:
   - request `CountLineExtraRequest`: `userId`, `lineId`, `unit` (required, checked as a
     delta's, plan 0246 M8), `amount` (a positive whole number within the line quantity
     bounds: the `countable` the client was answered), `expect` (required: the line's
     quantity the client was answered, the `after` of the raise), and the internal
     `via?` and, through `options`, `excludeBasketId?` and the permission set to use.
   - In one transaction: read the line under `pessimistic_write`; `assertLineUnit`; if
     `line.quantity !== expect`, throw `StaleQuantityException` and write nothing
     (question 2, reading (a)); read the standing buys of the counting baskets under the
     lock, oldest first across all of them by `(settledAt, id)` (`0275`'s order);
     `counted = min(amount, above now, line.quantity)`, so the line never goes below 0.
   - `counted === 0` (the extra is gone, by a revert or another person's count): write
     nothing, emit nothing, answer the line as it stands with `counted: 0`.
   - Otherwise: `authorizeEdit({ quantity: line.quantity - counted }, line, permissions)`,
     exactly as any lowering of the amount; raise `applied` with `countAboveAsk(buys,
     counted)`; lower the line by `counted` with `reopenAfterEdit`, a version bump and its
     change row (`changes.edited`, actor as the request's), all under the same lock.
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
   `LineService.countExtra` as the owner with `via: opened.via()` and `excludeBasketId`
   set to the basket. It answers `opened.result([lineId])` plus `counted`.
9. **The reports on each route.**
   - `addQuantity`: `AddLineQuantityResult.extra?: ExtraAboveAsk`. A third optional
     parameter `options?: { excludeBasketId?: string }` carries the demand's exclusion.
   - `update` (`PATCH /v1/lines/:id`): `UpdateLineResult.extra?`, when `quantity` rose.
     The report is read inside `applyLineEdit`'s transaction. A rename that merges
     reports nothing.
   - `add` (`POST /v1/lists/:id/lines`): `AddLineResult.extra?`, on `RAISED` alone.
     `addBatch` takes no flag.
   - The basket's add (`POST /v1/baskets/:id/lines`) and the demand
     (`POST /v1/baskets/:id/rows/:rowKey/demand`): `BasketRowResult.extra?`, with
     `excludeBasketId`. The demand reports only when its `delta` (`planned.left - from`) is
     positive and the line was written through `addQuantity`; its branch that moves only
     the split (`delta === 0`) reports nothing.
10. **The cost stays where it was without the flag.** `countersOf` runs only when the flag
    is true and the write can raise (for `update`, when the request names a `quantity`).
11. **The documents.** Regenerate and commit `apps/luna-shopper-backend/gateway/docs/openapi.json`
    with `npx nx run luna-shopper-backend-gateway:openapi`, then the admin wire types with
    `npx nx run luna-shopper-admin/models:wire-types`. Never edit either by hand.

### The cases

Each basket is read through its basket read: `asked / left / bought`, and the units above
the ask. `line` is the zone line's quantity, which every basket shares. "Report" is the
raise's `extra`; "count" is a write of target state 6. One basket (A, Marta's) unless the
case says two.

| Case | Before | The write | After | Answer |
| --- | --- | --- | --- | --- |
| 1. The owner's example: asks 1, Marta bought 4 | line 0; A 1 / 0 / 4, 3 above | raise +4, report | line 4; A 5 / 4 / 4, 3 above | `extra` above 3, countable 3, buyers [Marta] |
| 2. "Count the extra" after 1 | as after 1 | count 3, expect 4 | line 1; A 5 / 1 / 4, 0 above | counted 3, above 0 |
| 3. No answer after 1 (closed, left, too late) | as after 1 | nothing | line 4, as after 1 | |
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
| 20. The demand, this basket's own extra (reading (a)): you bought 4 of an ask of 3 in B | line 0; B 3 / 0 / 4, 1 above | demand B to 5 (from 0), report | line 1; B 5 / 1 / 4, 0 above (`0274`'s fold) | above 0, countable 0, buyers [] |

In case 1 the line holds 4, the amount the person set. Only case 2, the explicit answer,
lowers it to 1. Case 20 under reading (b) is in section 6.

### Scope

- Work in `core` (`LineService.addQuantity`, `update`/`applyLineEdit`, `add`, the new
  `countExtra`; `basket-demand.service.ts`, `basket-line-add.service.ts`, a new basket count
  service beside the demand; `basket-applied.ts`), the gateway (the five DTOs, two new
  routes, the controllers), the contracts (`list.messages.ts`, `basket.messages.ts`, the
  schemas, the pattern maps, their specs), and the generated files.
- Do NOT change the settle, the revert, the basket reads, the trips read or the freeze.
- Do NOT change what any route does without `reportExtra`, except that `countExtra` is
  refused as an unknown field once it is removed.

### Constraints

- Real Postgres in the integration specs, on an ephemeral luna slot (CLAUDE.md, "One checkout
  runs one slot, unless the slot is `--ephemeral`"). The memory notes on TypeORM raw SQL
  traps and on luna backend spec traps apply.
- The covering baskets and their scopes are read outside the transaction; a read through
  another repository inside it holds two pool connections (the comment at
  `line.service.ts:3886`).
- One expression for the buys (`buysOf`), one for the buyers (`buyersOf`), one for the count
  arithmetic (`countAboveAsk`). No second copy.
- A refusal about the line is a 403 or 409, never a 401 (a 401 signs velista out).
- No dashes as punctuation in comments.

### Action boundaries

- Stop and ask if the owner chose reading (b) of question 1 or (b) of question 2 before you
  start: the plan is written for (a) and (a).
- Stop and ask if `applyLineEdit` writes a raised quantity outside a transaction that holds
  the line's lock, so the report cannot be read under it.
- Stop and ask if `LineService.add` can answer `RAISED` for a line above zero, or if the
  basket's add can raise a line through a path that does not answer `RAISED`.
- Stop and ask if a guest participant can reach the basket count route on a row whose
  demand the guest may not change, and the owner's rule (`canChangeDemand`) lets it through.
- Stop and ask if `authorizeEdit` refuses the count's lowering for a reader who was allowed
  the raise it answers.

### Progress evidence

The specs of section 1 green on an ephemeral luna slot; `npx nx affected -t lint test`; the
gateway's `openapi-document.spec.ts` and the admin `wire-types.spec.ts` green on the
regenerated files.

## 1. Specs

Unit:

1. `countAboveAsk` gives the `applied` and `counted` of cases 2, 5, 7, 8, 9 and 12 from
   their buys, oldest first, never raises an `applied` above its `quantity`, and counts
   nothing for an amount of 0.

Integration, real Postgres, through the services and the basket read of each basket:

2. Every case of the table ends at its "After" column and answers its "Answer" column.
3. A raise with `reportExtra` writes no `applied`, and its change row and events are those
   of the same raise without the flag.
4. Cases 9 and 10 write no change row, bump no version and emit nothing.
5. A count writes one change row, bumps the version once, emits `line.updated` and
   `basket.linesChanged` to each covering basket with the counted baskets' `asked` moved.
6. A buy of a `LIVE` basket outside its current session, a buy made on the list page, a
   reverted buy and a buy in another unit are never reported nor counted.
7. The buyers of `0275`'s spec 5 hold for the report (a guest as the basket's owner, one
   buyer for a guest and the owner on one basket, no participant id, no name).
8. With `excludeBasketId`, that basket's buys are in neither `above` nor the count.
9. A reader who may not lower an approved line is refused the count, and no `applied`
   moves; the basket count is refused when the owner may not change the demand.
10. A settle that lands between the raise's answer and the count is read under the lock.
11. Every existing spec of the five routes passes unchanged without the flag; the `0275`
    specs that assert a counted raise are rewritten to the cases above.

Gateway:

12. Each of the five DTOs accepts `reportExtra` `true` and `false`, refuses `"true"` with a
    400, and passes it on; `AddLineQuantityDto` refuses `countExtra` as an unknown field.
13. The two count routes validate `amount` (positive, whole, within bounds), `expect`
    (required, whole) and `unit`, answer 201, and pass `expect` to core.
14. The contract schemas accept every new response, with and without `extra`.

## 2. Acceptance criteria

- A raise always writes the amount the person set, and its report counts nothing.
- Only the count write lowers the line for the extra, and it refuses a line that moved.
- Every route that raises a list line can report, and only when asked.
- No route behaves differently without the new fields.

## 3. Reading (b) of question 1, if the owner chooses it

- `rebalanceApplied` gives nothing back when the ask rises (`target > held`): the line
  holds `asked - held`, the units stay above, and the demand reports them. The lowering
  branch stays.
- `excludeBasketId` is removed: the basket's routes report and count their own basket too.
- Case 20 becomes: line 2; B 5 / 2 / 4, 1 above; `extra` above 1, countable 1, buyers
  [you]. The basket's count of 1 after it: line 1; B 5 / 1 / 4, 0 above. The ask stays 5.
- Velista `0208` then needs words for the basket that speak of what is left, which the
  owner has not ruled.

## Not in this plan

- The question, its words, its look and which controls ask (velista `0208`).
- A report on a batch add or on the assistant's writes.
