> **PR:** [#257](https://github.com/IchirokuXVI/nx-portfolio/pull/257)

# 0093: a settlement that waits for its list

> Somebody adds "batteries" in the shop, buys four, and at home sends the line to the flat's
> list. The flat's list gets a line asking for nothing, and its history says batteries were
> never bought. `0058` section 4.1 decided that on purpose, and `0055` section 6 made it
> unavoidable: a settle on a line with no origins writes **no row at all**, so by the time the
> line reaches a list there is nothing left to record. Not the time, not the person, not the
> product.
>
> This plan reverses that decision. **A purchase on a line that has no list yet is written
> anyway, attached to the basket line alone, and it is re-homed onto the list the moment the
> line reaches one.** The household's line then reads bought, because it was.
>
> Prerequisite reading: `0047` sections 3, 4 and 6.3 (the settlement row, settling, and the
> estimate this plan now seeds), `0055` section 6 (the branch that writes nothing), `0058`
> section 4.1 (the decision reversed here, and its reasoning), `0054` section 3 (reopening,
> which must revert these rows too) and `0092` section 4.3 (the hook this plan fills). Build
> this before `0094`, which re-points these rows when two basket lines merge.

## 1. What is reversed, and what it costs

`0058` section 4.1 refused a backfill because the household never asked for those units, and
`0047` section 6.3 computes "you buy this about every eleven days" from exactly these rows.
Seeding that series with a purchase that satisfied no demand of theirs was judged to make the
first estimate worse.

That reasoning was right about the estimate and wrong about the record. The shopper bought
the batteries **for** that household, which is why they sent the line there. A history that
omits a real purchase because the list had not been told yet is a history that lies to the
person who reads the line a fortnight later and buys batteries again. The estimate accepts
the row. An estimate built from real purchases is the only kind worth trusting, and three
rows are still needed before it says anything at all.

## 2. The waiting row

`line_settlements.lineId` and `listId` become nullable, together. A row with both null is a
**waiting settlement**: it belongs to a basket line, through `generatedListLineId`, and to no
zone line yet.

- A check constraint: `lineId` and `listId` are both null or both set.
- A check constraint: a row with `lineId` null has `generatedListLineId` set. A waiting row
  with no basket line would belong to nothing.
- A partial index on (`generatedListLineId`, `settledAt`) where `lineId` is null, which is
  the only read a waiting row ever gets.

Every other column means what it meant: `itemId` is the pick at settle time, the participant
is who bought it, `settledAt` is when, `quantity` is how many, `outcome` is which of the two
things happened, `revertedAt` is whether somebody took it back.

### 2.1 The settle writes it

`GeneratedListSettleService.settle`'s no origin branch (the `eligible.length === 0` case)
writes one waiting row per act: `BOUGHT` with the units the settle asked for, `NOT_AVAILABLE`
with zero. `advance` is unchanged. `setOutstanding` lowers through the same settle and gets
this for free.

### 2.2 What can see it

Nothing that reads by list. `line.settlements` and `item.settlements` in
`lists/settlement.sql.ts` select by `lineId` and join the list for access, so a null `lineId`
row is invisible to them by construction. The plan asserts that with a test rather than
trusting the shape, because the day somebody adds a read over `generatedListLineId` alone is
the day a guest's purchase could be named to a household that never received the line.

`settledPerOrigin` in `generated-list-origins.service.ts` groups by `row.lineId` and must skip
null rows, or the floor `0057` section 5.2 computes gains a key of `null`.

The basket line view gains one number:

```ts
/** Units bought on this line before it reached any list. Zero once every unit is re-homed. */
waitingSettled: number;
```

It is what lets velista `0068` say "4 recorded as bought there" when a list receives them,
and it is redacted from nobody, since it names no list.

## 3. Coming home

`WaitingSettlementService.rehome(generatedListLineId, manager)`, called inside the transaction
by everything that inserts an origin row for a basket line: `promote` (creation) and
`setOriginQuantity` (adoption) in `0092`, and the run itself never, because a composed line
has origins before it has purchases.

The rule is the allocation rule, applied to the past:

1. Waiting `BOUGHT` rows, oldest `settledAt` first.
2. Origins, oldest first, the order `allocateOldestFirst` uses.
3. Each origin takes units up to `contribution - settledHere`, its own room.
4. A row that fits whole is re-homed: `lineId` and `listId` set, everything else kept.
5. A row that fits partly is **split**: a new row with the fitting units is re-homed and the
   original keeps the rest, still waiting, still dated and attributed as it was.
6. Units that fit nowhere stay waiting. The next list the line reaches gets them.

For every re-homed row, the zone line's `quantity` is lowered by the row's units and floored
at zero, exactly as a settle does (`0047` section 4.2), and `line.settled` is emitted on the
zone room with the line as it now stands. A list that asked for three and receives three
lands at zero with a `BOUGHT` row, which is `0047` section 5's bought indicator, and that is
the sentence this plan exists for.

### 3.1 Not available is an outcome, and it goes to the first list

A waiting `NOT_AVAILABLE` row says the shop had none, about the product and not about units.
It is re-homed whole onto the first origin the line reaches, once, and never split or copied
to later lists. The household's line then reads "not available last trip" if that row is its
most recent, which is true.

### 3.2 Reverted rows stay where they are

A waiting row that was reopened (`0054` section 3) carries `revertedAt` and is not re-homed.
It stays a waiting, reverted row, which is history and not a fact about any list.

### 3.3 Units still waiting when the basket finishes stay waiting

A basket that finishes with waiting units keeps them on the basket line, attached to no list.
A finished basket refuses every write that could create an origin, so in practice they are
basket history: the shopper bought them, nobody was ever told for whom, and the record says
exactly that. Putting them on the last list as extra was the alternative, and it was rejected
because the last list is whichever the shopper happened to raise last, which is not a fact
about who wanted the units.

## 4. Reopen, and the counts

`GeneratedListReopenService.reopen` reverts every standing row whose `generatedListLineId` is
the line's, and resets `settledQuantity`. Waiting rows are found by the same query and are
reverted the same way. The loop that restores units to zone lines must skip a row with
`lineId` null, since there is no zone line to restore to.

`waitingSettled` on the view is the sum of standing waiting `BOUGHT` rows. "Bought here" on a
list's origin, `settledHere`, includes re-homed rows by construction, because they carry the
origin's `lineId` once they are home.

## 5. Contracts, events, migrations

- `waitingSettled` on `GeneratedListBasketLineView` in `libs/luna-shopper/contracts`.
- Events: `line.settled` on the zone room per re-homed row, unchanged in shape, and the
  `generatedList.lineUpdated` the origin write already emits.
- One migration in core: the two columns nullable, the two check constraints, the partial
  index. **No data moves.** Purchases made before this plan on lines with no origins were
  never written and cannot be recovered, which is `0047` section 8's honest migration again.
- The OpenAPI document and the admin wire types are regenerated.

## 6. Tests

In `generated-list-settle.spec.ts`, `generated-list-reopen.spec.ts` and a new
`waiting-settlement.spec.ts`:

1. Settling four on a line with no origins writes one waiting `BOUGHT` row of four with the
   pick, the participant and the time, and `waitingSettled` reads four.
2. Reaching a list asking for three re-homes three (a split row), lowers the list's line to
   zero, emits `line.settled`, and leaves one waiting.
3. Reaching a second list asking for two re-homes the last unit and leaves that list at one.
4. A waiting `NOT_AVAILABLE` row lands whole on the first list and never on the second.
5. Reopening a line with waiting rows reverts them, resets `settledQuantity`, restores no zone
   line, and reaching a list afterwards re-homes nothing.
6. `line.settlements` and `item.settlements` never return a waiting row.
7. `settledPerOrigin` ignores waiting rows.
8. A finished basket keeps its waiting units.

One integration assertion, through the gateway: add a line as a guest, settle it, have the
owner raise it for a list, and read that list's line back with the bought indicator set and
one settlement attributed to the guest's participant.

## 7. Open decisions

- Whether a `NOT_AVAILABLE` waiting row should instead be dropped on re-homing. Leaning kept,
  section 3.1: it is the only record that the shop had none, and the household's indicator is
  the point of recording it.
- Whether `waitingSettled` should be shown on the row itself rather than only on the sheet.
  Velista `0068`'s question.

## 8. Exit criteria

- A purchase on a line with no list is written, dated, attributed and named by product, and
  is visible to no list read.
- The moment the line reaches a list, units are recorded on it oldest first up to what it
  asked for, its line moves, and its household hears it.
- Units that fit nowhere wait for the next list, and wait forever on a finished basket.
- Reopening reverts waiting rows too, and reverted rows never come home.
- The estimate on a list line counts a re-homed purchase.
- `line.settlements`, `item.settlements` and `settledPerOrigin` are proven blind to waiting
  rows.
