# 0047 The kept list, and what was actually bought

A zone list stops being a to do list and becomes a **record of what a household keeps**. Nobody
ticks anything off it. A line's quantity is how many you want right now, buying decrements it,
zero means you are stocked, and the line stays where it is until somebody deletes it on purpose.

That one change is what this plan is for. Everything else here follows from it: a `LineStatus`
that no longer has anywhere to live, a settlement record that has to exist before any of the
history the line page promises can be computed, and an assistant tool that stops meaning
anything.

Companion plan: `apps/velista/plans/0043`, which is the screen. `0051` takes the
settlement machinery here and drives it from a shared basket; this plan is deliberately usable
without it, and section 4.4 is how.

## 1. Why quantity is a better state than status

Today a line carries two state machines: `approvalStatus` (does this belong on the list) and
`status` (`PENDING`, `READY`, `NOT_AVAILABLE`, where has it got to on the trip). The second one
is the problem.

`READY` is a fact about **one shopping trip**, written onto a record that outlives every trip.
So a list accumulates lines that are done, and the only ways out of that are to delete them,
which throws away everything you knew about the thing, or to reset them by hand every week,
which nobody does. Both are how a shared list rots into a screen people stop opening.

Quantity does not have that problem, because it is a fact about **now**. Two litres of milk
wanted, buy two, want zero, and the line is still there in a fortnight holding its history when
somebody swipes it back up to two. Nothing is deleted and nothing needs resetting, and the list
becomes the household's standing inventory rather than a week's worth of ticks.

The three things a person still wants to see on that page are all **derived** rather than
stored, which is section 5.

## 2. What changes on `ListLine`

**`status` is dropped.** `LineStatus` survives as an enum, because `0051` still needs it
on a basket line where a trip is exactly the right scope for it, and because a settlement records
which of two things happened. It just stops being a column on `list_lines`.

Nothing else on the line changes. `quantity` is already an `int` defaulting to 1, `version` still
does the concurrency work, and `approvalStatus` is untouched.

### 2.1 The endpoint the whole gesture rests on already exists

`POST /v1/lines/:id/quantity`, taking a **signed delta** and applying it atomically, was built by
plan `0040` for the assistant and has never had a second caller. It is exactly right for a gesture
that emits a run of increments while a thumb is moving: absolute writes from a moving control race
each other and lose, and a delta cannot.

Velista calls it for the first time in the companion plan. No new write endpoint is needed for
quantity.

### 2.2 Zero is not deleted

A line at zero is a line the household knows about and does not currently need. Deleting is a
separate, confirmed gesture, and it is the only thing that discards the history. This distinction
is the whole reason the model works, so it is stated as a rule rather than left implicit.

### 2.3 The counts have to be re-derived

`readyCount` is on `ListPreview`, on `ShoppingListSummary`, in `ZoneCounts`, in the core service's
`zones/zone-summary.sql.ts`, and in velista's models. It counts `status = READY`, which will not
exist.

It becomes **`wantedCount`**: lines with `quantity > 0`. That is the number a zone card should
have been showing all along, since "four things needed" is the useful figure and "four things
already bought" never was. `lineCount` is unchanged and still counts every line.

This is a rename plus a predicate change across a shipped API and a shipped client, and it is the
one part of this plan that is not additive.

### 2.4 An assistant tool stops meaning anything

Plan `0043` shipped **`set_line_status`**, moving lines between `PENDING`, `READY` and
`NOT_AVAILABLE` through `POST /v1/lines/:id/status`. Both the tool and the route lose their
subject here.

The route is deleted and the tool is replaced by **`settle_lines`**, which is the same sentence
said out loud ("we got the milk", "they had no bread") mapped onto section 4 instead. It keeps
`0043`'s array shape and its resolution rule, both of which are unaffected. `0043`'s other tool,
`remove_lines`, is untouched.

Calling this out because it is easy to read the status drop as pure deletion and then discover
mid build that a shipped tool, a shipped route and a documented OpenAPI operation went with it.

## 3. `LineSettlement`

One row per **origin line touched by one settling act**. It is the record that makes every
history, every indicator and every estimate on the line page computable, and none of them are
computable without it.

**LineSettlement**

- `id` (uuid)
- `lineId` (the zone line), `listId` (denormalized, so a list scoped read needs no join)
- `itemId` (nullable, **copied at settle time**; section 3.2)
- `outcome`: `SettlementOutcome` enum (`BOUGHT`, `NOT_AVAILABLE`)
- `quantity` (int; the units bought, and `0` for `NOT_AVAILABLE`)
- `settledByUserId` (widened by `0051`; section 3.3)
- `settledAt` (timestamptz)
- `generatedListLineId` (nullable uuid, opaque; null when settled straight from the list page)
- `pricePaidCents` (nullable int), `supermarketLocationId` (nullable uuid, opaque)
- index on (`lineId`, `settledAt` desc) and on (`itemId`, `settledAt` desc)

Named for what it is. Most rows are purchases and the screen calls the `BOUGHT` subset "buy
history", but a row saying "we tried and the shop did not have it" is not a purchase, and naming
the table after the happy case would make the other outcome look like a special case of it.

### 3.1 A settlement is a zone fact

**Anyone with `READ` on the list may read its settlements.** This is the one place the privacy
posture had to be decided rather than inherited, because `0050` section 8 makes a
generated list readable by its owner alone.

The line the two sides fall on: the **basket** is private, the **purchase** is not. What the flat
bought and when is exactly the shared knowledge a shared list exists to hold, and a history
visible only to whoever happened to do the shopping is useless in the household this product is
for. `0050` section 8 already drew this distinction for the audit case, noting that an
admin can see a line was marked bought but not what else was in the basket it came from. This
makes that explicit rather than incidental: `generatedListLineId` is stored but is **never
served** outside `0051`'s own reads.

### 3.2 `itemId` is copied, not joined

A settlement keeps **the exact product that was bought**: the basket line’s pick when the
settle comes through a basket (`0051`), the product chosen in the detail sheet when it comes
straight from the list page (velista `0043` section 5.2), and null for a free text line. A
zone line carries a whole product set (`0048` section 1.1) and the set can change afterwards;
the settlement does not move with it, and the cross zone item aggregate in section 6.2 stays
answerable by an index on the settlement rather than by a join through lines that may have
moved.

### 3.3 Attribution, and what 0051 widens

`settledByUserId` is non nullable here, because without baskets the only people who can settle
are account holders with access to the list.

`0051` introduces guests, who settle and are not users. It makes this column nullable and
adds `settledByParticipantId` beside it, with exactly one of the two set. That migration belongs
to `0051` and is named here only so the shape is not a surprise.

### 3.4 Two nullable columns nothing writes yet

`pricePaidCents` and `supermarketLocationId` are declared and never written by anything in this
plan. They are what "the price you actually paid" and "where you got it" will fill in once
backlog `0004` exists, and both are cheap to declare now and a migration each to add later on a
table that will by then be the largest in core.

## 4. Settling

One operation, `line.settle`, with three outcomes and a cumulative result.

| Outcome | Writes a settlement | Decrements quantity | Sets an indicator |
| --- | --- | --- | --- |
| `BOUGHT` | yes, with the units bought | yes, by that many, floored at 0 | bought, once quantity reaches 0 |
| `NOT_AVAILABLE` | yes, with quantity 0 | no | not available last trip |
| skipped | no | no | nothing |

**Skipping writes nothing at all**, which is deliberate. "I decided not to buy this today" must
leave the line exactly as it was and must not look like it was dealt with, which is the rule
`0050` section 5 set for deleting a derived line and it holds here for the same reason.

### 4.1 Partial settles are cumulative

Asking for three and buying two decrements to one, and the line stays wanted. A second settle
later takes it the rest of the way. Nothing about settling is terminal, which is what lets a
basket be worked through two shops in one afternoon, and it is the property `0051`
section 6 depends on.

### 4.2 Quantity floors at zero, and the excess is recorded

Buying three of a line that says two decrements to zero and records a settlement of three. The
extra unit is real and belongs in the consumption history even though it has no demand to satisfy,
and a settlement clamped to the outstanding demand would quietly under report what the household
actually goes through.

### 4.3 Allocating across several origins is 0051's problem, not this plan's

A settle here names one line. A **basket** line can sum several zone lines, and deciding how many
units each of them gets is a question this plan does not have, because it has no baskets. It is
`0051` section 6, and this plan's job is only to accept the per line results it produces.

### 4.4 This plan ships without baskets

Settling directly from the list page is a first class gesture, not a stopgap: somebody who has
just come back from the shop opens the list and says what they got. It writes settlements with a
null `generatedListLineId`, and it is what makes the entire line page in the companion velista
plan buildable before `0051` is started.

## 5. The three indicators, all derived

None of these is a column, and that is the payoff of section 1.

| Indicator | Derivation |
| --- | --- |
| Bought | `quantity = 0` **and** at least one `BOUGHT` settlement exists |
| Not available last trip | the most recent settlement for the line has `outcome = NOT_AVAILABLE` |
| Somebody is buying this | an active generated list carries this line (`0051`) |

The first is why "at least once" is in the rule rather than just `quantity = 0`: a line somebody
typed and never bought is at zero too, and it has not been bought, it has simply never been
wanted yet.

The third is the only one that reaches outside core's own tables, and it is also the only one
that leaks the existence of a private basket. `0051` section 5 owns that decision.

## 6. Reading the history

Two reads, and the line page shows them side by side and labelled, because they answer different
questions and conflating them would mix one household's consumption with the reader's own.

### 6.1 This line

`line.settlements { lineId, cursor? }`, newest first, cursor paginated. Guarded by `READ` on the
list, which section 3.1 settled.

### 6.2 This item, across every list the caller can read

`line.itemSettlements { itemId, cursor? }`, over settlements whose `itemId` matches, restricted to
lists the caller holds read access to **at request time**. This is what makes "you buy this about
every eleven days" a useful number instead of a per list fragment, and it is the read that pays
for section 3.2's denormalized column.

It only exists for a line that carries at least one product (the page unions it over the
line’s set), so the section is absent rather than empty on a free text line. Which makes attaching items the thing the whole line page rests on, and that is
the companion plan's suggestion dropdown.

### 6.3 Estimating when it will be needed again

Computed, never stored. **Median** interval between `BOUGHT` settlements, weighted by nothing, and
**nothing at all is shown until there are three**.

The median rather than the mean because one stock up trip distorts a mean permanently and moves a
median by one position. The three row floor because two purchases define exactly one interval,
which is not an estimate, it is a coincidence. A confident wrong date on this screen is worse than
an empty field, since the entire value of the number is that somebody trusts it enough to not
check the cupboard.

## 7. What does not change

- **Approval is untouched.** `DECIDE` still approves lines, `autoApproveLines` still decides
  whether a new line arrives approved, and plan `0037`'s rule that the server decides is intact.
- **A quantity change never re-triggers approval.** Approval answers whether the thing belongs on
  the list, and how many you want is not that question. If the primary gesture on the page needed
  somebody else's blessing, the gesture would be dead and so would the model in section 1.
- Deleting, reordering, comments, presence and access are all as they are.

## 8. Contracts, events, migrations

- New enum `SettlementOutcome` in `libs/luna-shopper/contracts`, per the constant sets rule.
- New events on the list room: `line.settled`, carrying the line as it now stands and the
  settlement that moved it, so a phone in the shop and a phone at home agree without a refetch.
  `line.updated` continues to carry ordinary quantity edits.
- Endpoints: `POST /v1/lines/:id/settle`, `GET /v1/lines/:id/settlements`,
  `GET /v1/items/:id/settlements`. `POST /v1/lines/:id/status` is deleted with its tool.
- Migrations, in core, and one of them is destructive:
  1. Create `line_settlements`.
  2. Drop `list_lines.status`, having first set `quantity = 0` on every `READY` line. `PENDING`
     and `NOT_AVAILABLE` lines keep their quantity. **No settlements are backfilled**, because
     there is nobody to attribute them to and no date to give them, so no line shows a bought
     indicator until it is genuinely bought again. That is the honest migration and it costs one
     cycle of history that was never recorded in the first place.
  3. Rename the count in `zone-summary.sql.ts` and change its predicate (section 2.3).
- The OpenAPI document is regenerated, per the rule in `CLAUDE.md`.

## 9. Open decisions

- Whether `wantedCount` should count **lines** with quantity above zero or **units**. Leaning
  lines: "4 things needed" is legible on a card and "17 units needed" is not.
- Whether a settle should be reversible by an undo within some window, or only by a compensating
  quantity edit. Leaning a real undo, since the gesture happens one handed in a shop and the
  failure mode of a mis tap is a line that silently drops to zero.
- Whether `line.itemSettlements` should include lists in zones the caller has since left. Leaning
  no, on the same "access at request time" rule everything else here uses.
- Whether the estimate should degrade to a wider phrase ("every few weeks") between three and six
  settlements rather than giving a number. Leaning yes, but it is a copy decision for the
  companion plan.

## 10. Exit criteria

- A zone line carries no trip status, and its quantity is the only thing that says whether the
  household wants it.
- Settling a line writes a settlement, decrements the quantity by what was bought, floors at zero,
  and leaves the line in place.
- A partial settle leaves the remainder wanted, and a second settle finishes it.
- Marking a line not available records that and changes no quantity.
- Skipping a line records nothing and changes nothing.
- Anyone who can read a list can read its settlements; nobody learns which basket a settlement
  came from.
- The line history and the cross list item history are two separate reads, the second filtered by
  the caller's read access at request time, and it is absent for a line with no item.
- No estimate is shown before three purchases exist.
- `set_line_status` and `POST /v1/lines/:id/status` are gone, `settle_lines` replaces the tool,
  and the OpenAPI document reflects both.
- The zone card count reports what is wanted, not what is done.
