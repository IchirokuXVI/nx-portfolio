> **PR:** [#325](https://github.com/IchirokuXVI/nx-portfolio/pull/325)

# 0104: taking a purchase back one unit at a time

> Client half: `apps/velista/plans/0073`, which draws every rule this plan owns.
>
> Plan `0056` made the number on a basket row a control, and put an asymmetry inside it:
> lowering it records a purchase, raising it makes the basket buy more than the households
> asked for. The person holding the phone does not see two meanings. They see one number,
> and the thing they reach for when they put a tin back on the shelf is the same thing they
> reach for when they want more of it.
>
> This plan removes the raise. The number runs between zero and what the lists asked for,
> and going up takes purchases back, one unit at a time. It also adds the write the line
> sheet needs: how many of this line one list got, set as a number rather than derived from
> an allocation nobody sees.
>
> Prerequisite reading: `0056` (the control and its `from` bargain, whose second branch this
> replaces), `0054` sections 3.1 to 3.5 (the reopen, whose transaction this generalizes),
> `0057` and `0092` (what a list contributes, and the origins read this writes beside) and
> `0093` (a settlement that waits for a list, which is reverted like any other).

## 1. What is being built

| Piece                                                          | Where                                                                 |
| -------------------------------------------------------------- | --------------------------------------------------------------------- |
| The raise becomes a revert, bounded by the line's own quantity | `generated-list-outstanding.service.ts`                               |
| Reverting **n** units, which the whole line reopen now calls   | `generated-list-reopen.service.ts`                                    |
| What one list got, set absolutely                              | a new `generated-list-origin-settled.service.ts`                      |
| The message, the result and the route                          | `libs/luna-shopper/contracts`, `generated-list-sharing.controller.ts` |
| The document                                                   | `gateway/docs/openapi.json`                                           |

`GeneratedListSettleService.settle` is not touched. It is still the only thing that writes a
purchase, and every new path here either calls it or reverts what it wrote.

## 2. The number has two ends

**Outstanding runs from zero to `line.quantity`.** Zero is the whole line dealt with, which is
what "got all" already does. The top is what the lists asked for, and there is nothing above it.

`SetGeneratedListLineOutstandingRequest.outstanding` above `line.quantity` is a
`ValidationException`, not a clamp. A client that asks for a number the rule forbids has a stale
idea of the line, and answering it with a different number would teach it that its idea was
right.

### 2.1 What this deletes

**A basket can no longer decide to buy more than was asked for.** The raise branch of `0056`
section 4 wrote `quantity` up, and nothing writes it up any more from this route: `quantity` is
now moved only by what the lists ask for, which is `setOriginQuantity` (`0092`).

Lines carrying that extra already exist, and they keep it. `quantity` above the sum of the
origins is still a legal row, still served, and still the ceiling of its own reel. Nothing
migrates it away and nothing new creates it.

The rejected alternative was to keep the raise and add a separate revert control. It fails on the
screen rather than in the model: one number that goes up for two unrelated reasons is the thing
the client half is being written to remove.

## 3. Raising is a revert

`outstanding > current` reverts `outstanding - current` units of this line.

The `from` check of `0056` section 3.2 stands unchanged, and it matters more here than it did
there, for the same reason: a gesture whose meaning depends on where it started must never be
applied to a number that moved underneath it.

### 3.1 Which units go back

**Newest first, across the whole line, whatever origin they sat on.** The walk reads this line's
standing settlements ordered by `settledAt` descending, and consumes them until the count is met.

Newest first is the rule because the act is an undo: the person raising the number is almost
always taking back the thing they just did, and an order that reached for the oldest purchase
would take back somebody else's.

A **waiting** settlement (`0093`: a purchase on a line that had reached no list) is in the walk
like any other row, and is reverted the same way. It names no list, so nothing goes back onto a
zone line for it.

### 3.2 A row that is bigger than what is being taken back

The walk splits it. The original row is marked reverted in full, and a new row is appended for
the part that stands, carrying the original `settledByParticipantId`, `outcome`, `itemId`,
`lineId`, `listId` and `settledAt`, with its own id.

`settledAt` is **copied and not restamped**, because it is the time the shopping happened and
that has not changed.

The rejected alternative was a `revertedQuantity` column on `LineSettlement`. It loses on the
same ground the entity's own comment rejects a negative compensating row: every sum over
`quantity` anywhere in core would need a second term, and every one that was not found would be
silently wrong. A split leaves those sums correct with no change at all, because a reverted row
is already excluded and the remainder is an ordinary standing row.

### 3.3 A close that has no units to divide

A `NOT_AVAILABLE` row carries `quantity` zero and closed however many units were outstanding when
it was written. There is no arithmetic that takes one unit back off it, so **the walk takes the
whole close back** when it reaches one.

That is the one case where the number lands somewhere other than where it was asked for. A line
of six with two bought and four closed as unavailable, raised by one, comes back with four
outstanding rather than three. It cannot overshoot `quantity`, because the close restored exactly
what it closed, and it errs toward "not bought", which is the safe direction to be wrong in.

**The answer carries the line**, as it always did, and the client redraws from it rather than
from what it asked for.

### 3.4 The rest of the transaction is the reopen's

Everything else a revert does is what `0054` already does for a whole line: units go back onto
each origin's `ListLine` under the same pessimistic write lock, `settledQuantity` comes down by
what was taken back, the claim is retaken through `LineClaimService` when a finished line becomes
outstanding again, and the zone rooms hear what they heard then.

So the arithmetic moves into `GeneratedListReopenService` as a method taking a number of units,
and `reopen` becomes that method called with everything the line has settled. One implementation,
because two would disagree about the claim on the day one of them was changed.

## 4. What one list got

A new message, `SetGeneratedListOriginSettledRequest`, on `POST :id/lines/:lineId/origins/settled`.

```ts
interface SetGeneratedListOriginSettledRequest {
  generatedListId: string;
  lineId: string;
  participantId: string;
  /** The origin's zone line. */
  sourceLineId: string;
  /** How many of this line this basket has bought for that list, after this write. */
  settled: number;
  /** What the caller believed that number was. */
  from: number;
}
```

It sits beside `setOriginQuantity` and is deliberately not the same message. One says what a list
asked for and the other says what it got, they move in opposite directions on the same row of the
same sheet, and a single message with two optional fields would let a client send both and mean
neither.

- **Raising** settles the difference **against that origin alone**, through
  `GeneratedListSettleService.settle` with an allocation naming one list, so the allocation, the
  events, the claim release and the skip report are the settle's own and not a second copy of
  them.
- **Lowering** reverts the difference against that origin alone, by section 3's walk restricted
  to that origin's settlements.
- `settled` is bounded by `0` and the origin's `contributed`. Above it is a
  `ValidationException`: a list cannot have got more of a line than it asked for through this
  basket, and a shopper who bought more than that raises what the list asked for first.

The answer is `SetGeneratedListOriginSettledResult`: the basket line as it now stands, the origin
detail as it now stands, and the settle's own `skipped` report. Both numbers on the row come back
from the server, so the sheet never computes one of them from the other.

### 4.1 Who may

The all or nothing rule of `0051` section 5.2, which is what `setOriginQuantity` and the
allocation already require: this message names a list, and naming a list is naming zone data.

A guest is refused. That is not a restriction on shopping. A guest still settles the whole line,
or part of it, through the settle route, and the default allocation decides where the units land
exactly as it does today.

## 5. What everybody hears

Nothing new. A revert emits what `0054`'s reopen emits, a per origin settle emits what the settle
emits, and the basket room hears `GeneratedListLineUpdated` for the line in both directions.

The one thing that stops being emitted is the raise announcement of `0056` section 7, because the
act it announced no longer exists.

## 6. Errors

| Case                                        | Code             |
| ------------------------------------------- | ---------------- |
| `outstanding` above `line.quantity`         | `validation`     |
| `settled` above the origin's `contributed`  | `validation`     |
| `from` does not match what the server holds | `stale_quantity` |
| the basket is finished                      | `list_finished`  |
| the caller is not a participant             | `forbidden`      |
| the caller fails the all or nothing rule    | `forbidden`      |

`stale_quantity` carries the number as it now stands in `messageArgs.current`, as `0056` and
`0057` already do, because that is the one channel that reaches the client.

## 7. Tests

1. Raising by two reverts the two newest units, and the origins' zone lines go back up by what
   came off each of them.
2. Raising above `line.quantity` is refused, and the line does not move.
3. A revert that lands inside a settlement of three splits it: the original is reverted in full,
   a standing row of two remains with the original buyer and the original `settledAt`, and the
   consumption total for that list is two.
4. Raising a line closed as unavailable takes the close back whole, and the answer's line says
   where the number landed.
5. Raising a line with a waiting settlement reverts it, and no zone line moves.
6. `reopen` and a raise to the top of the same line leave identical rows.
7. Setting an origin's settled amount up writes settlements against that origin only, and the
   basket line's `settledQuantity` moves by the same amount.
8. Setting it down reverts that origin's newest settlements only, and another origin's stand.
9. Setting it above what that list asked for is refused.
10. A guest is refused the origin route and still settles the whole line.
11. A stale `from` on either route is refused with the current number.

## 8. Acceptance criteria

- The outstanding number cannot be set above what the lists asked for, from any client.
- Raising it takes purchases back, newest first, and puts the units back on the lists they came
  off.
- A partial take back out of a larger purchase leaves an honest history: what was taken back is
  marked, what stands is a plain settlement with its original buyer and time.
- A line closed as unavailable is reopened whole by any raise, and the answer says so.
- One list's bought amount can be set to any number between zero and what that list asked for,
  and doing so writes or reverts settlements for that list alone.
- Nothing in this plan writes `quantity`, and no route raises a basket above what was asked for.
- `openapi.json` is regenerated and committed with the change.
