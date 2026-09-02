# 0056: what is outstanding is a number you can move

> One message, and it is the most consequential small message in this product, because moving
> one number in one direction writes purchase history into other people's households.
>
> A shopper finds a sale and wants twenty instead of five. A shopper picks up two of the five
> and puts the trolley in the queue. Today the first is impossible from the basket and the
> second takes a sheet and three taps. Both are the same gesture on the same number: **what is
> still to get.**
>
> Prerequisite reading: `0047` sections 4 and 4.2 (settling, and what happens when you buy more
> than was asked), `0051` sections 6.2 and 6.4 (the default allocation, and whose access
> authorizes a settle), and `0054` section 3 (reopening, which is the only other thing that
> lowers a settled quantity). Velista `0054` is the other half.

## 1. The rule

> **The number on a basket line is what is still to get. Raising it means this basket will buy
> more. Lowering it means that many were bought.**

That asymmetry is deliberate and it is the whole design, so it is stated before anything else.
It is not two behaviours bolted onto one control: it is one meaning, read in two directions.

- Outstanding goes **down** when units are dealt with, and the only thing that deals with a unit
  is buying it. Five to three is two in the trolley.
- Outstanding goes **up** when the basket decides to carry more than the households asked for.
  Nothing has been bought, no household has changed its mind, and no zone list moves.

The alternative, a control that edits the basket's `quantity` in both directions, was the first
draft and it is wrong in the case the feature exists for: a shopper who takes three of five off
the shelf and edits the line down to two has said nothing about buying anything, and the
household's list still believes five are wanted. The number they touched would then mean
"demand" while the number beside it means "outstanding", and the screen would carry two
quantities a person has to tell apart while holding a trolley.

## 2. What is wrong today

| Want | Today |
| ---- | ----- |
| Buy more than was asked | Impossible from the basket. `settle` clamps its units to the outstanding amount, and raising `quantity` is on the owner's account surface through `updateLine`, resolved by `ownerUserId` |
| Buy some of a line | `POST .../settle` with a quantity, which velista reaches through a sheet with a pane in it |
| Do either as a guest | Only the second |

`0047` section 4.2 already decided what buying more than was asked means: the zone line floors at
zero and the settlement records the real number, because the extra unit is real and belongs in
the consumption history. What is missing is any way to say it from the screen where the shopper
is standing.

## 3. The message

**`GENERATED_LIST_SHARING_PATTERNS.setOutstanding`**, and
`POST /v1/generated-lists/:id/lines/:lineId/outstanding`, under `ParticipantGuard`.

```
{ outstanding: number, from: number }
```

`outstanding` is where the control was let go. `from` is where the client believed it started.
Both are absolute, and section 3.2 is why.

The server computes `current = quantity - settledQuantity` and then:

| Case | What happens |
| ---- | ------------ |
| `outstanding > current` | `quantity += (outstanding - current)`. Nothing else. No settlement, no zone write, no claim change |
| `outstanding < current` | A `BOUGHT` settle of `current - outstanding` units, through the existing settle path unchanged |
| `outstanding === current` | Nothing, and a success. A drag that landed where it started is not an error |

The second case is a **call into the code that already exists**, not a second implementation of
it. The default allocation (oldest origin first), the owner's access check per origin, the skip
report, the zone `line.settled` events, the claim release on a finished line and the
`lastEditedByParticipantId` write all come with it, and the response is the same
`GeneratedListSettleResult` the settle route returns. A separate path that wrote settlements its
own way is how two ways of buying the same tin end up disagreeing about who bought it.

### 3.1 Raising is not reopening

Raising outstanding on a **finished** line looks like undoing a purchase and is not one. It adds
demand: `settledQuantity` is untouched, every `LineSettlement` stands, and the line goes from
done to partly settled because it now wants more than it has got.

Undoing a purchase is `0054` section 3's reopen, which reverts settlements and puts units back on
the origin lists. The two are different acts with different records, and the screen must offer
them as different things (velista `0054` section 5).

### 3.2 The client says what it believed, and a stale client is refused

The one thing this message must never do is invert its own meaning.

Two phones in one shop both read outstanding 5. One drags to 3, settling 2. The other, a second
behind, drags to 4 meaning "I got one". By then `current` is 3, so `outstanding: 4` reads as
**raise by one** and the purchase is lost, replaced by a demand nobody expressed.

So the request carries `from`, and a mismatch with `current` is refused with a distinct code
rather than applied. The client refetches and shows the number as it now stands, which is the
only honest answer: somebody else moved this line, and what your gesture meant depends on where
it started.

This is the case for an absolute value rather than a signed delta, and it deviates from `0047`
section 2.1, which chose a delta for the zone list's quantity precisely because absolute writes
from a moving control race. Both are right, for different controls:

- The zone list's stepper emits a **run** of increments while a thumb moves, and every one of
  them is a demand change with no second meaning. A delta cannot race and a retry of a delta is
  harmless.
- `QuantityReel` commits **once**, on release. A delta here would be a delta whose meaning
  depends on the sign, and a retried `-2` after a network wobble buys two more tins.

An absolute target with a stated origin is idempotent: the same request sent twice is refused the
second time by section 3.2's own check, which is exactly the behaviour a shopper on a bad
connection needs.

### 3.3 Who may move it

**Any live participant, guests included**, on the same terms as `settle`, which this is.

- Lowering is a settle and is authorized exactly as a settle is: `0051` section 6.4's rule, the
  **owner's** standing on each origin's list, not the actor's. A guest still cannot cause a write
  anywhere the owner could not have written themselves, and an origin whose access has gone is
  skipped and reported.
- Raising touches the basket line alone, so there is nothing to authorize beyond being on the
  basket.

## 4. Where the extra units go when they are bought

Raising outstanding to twenty on a line whose origins asked for five, then settling it, allocates
twenty units across origins that between them want five. `0047` section 4.2 says the excess is
recorded rather than dropped; it does not say which origin records it, because before baskets
there was only ever one line.

**The default order runs to exhaustion, and every unit past the last origin's own contribution is
recorded on that last origin.** Its zone line floors at zero, as it already does, and its
settlement carries the real number.

The case this rule is actually about has one origin, where there is no ambiguity at all: a sale
on the milk the flat wants. With several origins the rule is a convention rather than a truth,
and the honest way to say something else is the allocation sheet (`0051` section 6.3), which
already overrides the default and needs no change.

A line with **no** origins records nothing anywhere, per `0055` section 6.

## 5. The floor, and the ceiling

- **Outstanding cannot go below zero.** Zero is the whole line settled, which is what the "got
  all" button already does.
- **Outstanding is capped** by `LINE_QUANTITY_MAX`, applied to the resulting `quantity` and not
  to the outstanding number, so a partly settled line cannot be raised past the same limit an
  unsettled one has.
- **A finished basket refuses both directions**, with `0055` section 3.3's code.

## 6. What this does not change

- **`settle` stays.** The sheet's "got all", "got some" and "they had none" are unchanged, and
  `NOT_AVAILABLE` has no representation on this control at all: it is an outcome and not a
  quantity, and dragging a number to zero must never be able to mean "the shop had none".
- **No new settlement columns.** Everything written here is written by the existing settle.
- **No zone read.** Raising never touches a zone, and lowering touches exactly the zones the
  settle already would.

## 7. Contracts, events, migrations

- `SetGeneratedListLineOutstandingRequest` in `libs/luna-shopper/contracts`, answering
  `GeneratedListSettleResult` in both directions so a client has one response shape to handle.
  A raise answers with `skippedCount: 0` and no settlement refs, which is true.
- A distinct problem code for the stale `from`, named for what happened rather than for the
  field, since the client's recovery is a refetch and not a correction.
- Events: a raise emits `generatedList.lineUpdated` on the basket room and nothing else. A lower
  emits everything the settle already emits, including the zone side, unchanged.
- **No migration.** Every column this needs exists, which is the payoff of building it on the
  settle rather than beside it.
- The OpenAPI document is regenerated.

## 8. Open decisions

- **Undo.** `0047` section 9 already leaned toward a real undo for a mis tapped settle, and this
  control makes it pressing rather than nice: a drag is easier to get wrong than a tap, and a
  wrong one writes into four households. `0054`'s reopen is whole line and deliberately refuses
  to guess which settlement it is undoing, which is right in general and answerable here, because
  one act's rows are known at the moment it commits. The shape would be an act id stamped on
  every `LineSettlement` written by one settling act, returned in the result, and accepted by
  `reopenLine` to revert exactly those rows. Leaning yes, in its own plan, because it also fixes
  the mis tapped sheet settle that has been shippable since `0047`.
- Whether the excess in section 4 should be spread proportionally rather than landing on the last
  origin. Leaning no, for the reason `0051` section 6.2 rejected proportional allocation: it
  produces fractions of things that come in units.
- Whether raising should be refused for a **guest** and allowed for everybody else. Leaning no.
  The guest is the person at the shelf looking at the sale, and refusing them would put the one
  gesture this feature is named for behind an account.

## 9. Exit criteria

- Raising the number on a line raises what the basket will buy, writes no settlement, changes no
  zone list, and leaves `settledQuantity` where it was.
- Lowering it by two records two units bought, allocated oldest origin first, with the same
  events, the same skip report and the same owner access check a sheet settle produces.
- Lowering it to zero finishes the line, exactly as "got all" does.
- A request whose `from` no longer matches is refused with a code the client can act on, and
  nothing is written.
- Raising a finished line takes it back to partly settled without reverting any settlement.
- Buying twenty of a line five were asked for floors the origin's zone line at zero and records
  twenty.
- A guest can do all of it, and an origin the owner may no longer write is skipped and reported.
- Neither direction can express `NOT_AVAILABLE`.
- The OpenAPI document covers the route.
