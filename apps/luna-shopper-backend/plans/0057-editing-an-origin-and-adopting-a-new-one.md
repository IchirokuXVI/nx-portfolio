# 0057: editing an origin, and adopting a new one

> A basket line is a sum. Three litres of milk is the flat wanting two and the parents' house
> wanting one, and the basket knows the split because `0050` kept a provenance row per
> contributing zone line.
>
> Nothing can read that split back and nothing can change it. The one place the numbers are
> visible is the allocation sheet, which appears only while settling and can only say how many
> of the units **already bought** belong to each list. There is no way to say the flat wants
> three rather than two, and no way at all to put a fourth list's line into a basket that was
> generated without it.
>
> This plan is the read and the write for that. It is the one thing in this batch that changes
> a household's own list, and everything in it is shaped by keeping that separate from buying.
>
> Prerequisite reading: `0050` sections 1 and 3 (the provenance rows and the deduplication rule),
> `0051` sections 5.2, 5.3 and 6.4 (the all or nothing rule, the claim, and whose access
> authorizes a write), `0047` sections 1 and 4 (quantity is the state, and settling is what
> lowers it) and `0040` (the signed delta endpoint this writes through). Velista `0055` is the
> other half.

## 1. The distinction the whole plan rests on

> **Lowering what a list asked for is not buying it.**

`0056` makes the number on the basket row mean "bought" when it goes down. This plan's numbers
sit one screen deeper and mean the opposite: they are what each household **wants**, and moving
one down is that household changing its mind, exactly as somebody editing the quantity on the
list page would.

So nothing here writes a `LineSettlement`, nothing here sets the bought indicator, nothing here
touches `settledQuantity`, and nothing here appears in a consumption history. A line lowered to
zero this way is `0047` section 2.2's line at zero: known about, not currently wanted, and never
bought.

Two numbers, two screens, two meanings. Section 6 is how the client is required to say so.

## 2. What is being built

1. **A read** of a basket line's origins, and of the lists that hold the same thing and are not
   origins.
2. **A write** that sets one list's contribution, editing an origin or adopting a new one.

Both are gated on `0051` section 5.2's all or nothing rule. A guest sees neither, and that is
not a degraded experience: a guest must never have to know which household a tin of tomatoes
belongs to, which is the sentence `0051` section 6.1 is built on.

## 3. The read

**`GENERATED_LIST_SHARING_PATTERNS.lineOrigins`**, and
`GET /v1/generated-lists/:id/lines/:lineId/origins`, under `ParticipantGuard`, refused at the
gateway for a participant who does not pass the rule.

Two collections.

### 3.1 The origins

One row per `GeneratedListLineOrigin`, carrying:

| Field | Why |
| ----- | --- |
| `originId`, `listId`, `lineId`, `zoneId` | identity |
| `listName`, `zoneName` | composed here, as `listNames` on the basket read already is. A reader with two lists called Food needs the zone |
| `contributed` | `origin.quantity`: what this list put into the basket line |
| `listQuantity` | what the zone line asks for **now**, which is not the same number and diverges the moment anybody edits either side |
| `settledHere` | units this basket has already settled against this origin, which is section 5's floor |
| `writable` | whether the basket's owner still holds `WRITE` on the list, so the client can draw a row it cannot move |

`listQuantity` is served because the basket is a snapshot (`0050` section 4) and the sheet is the
one screen where the snapshot and the live list are both in front of somebody. Showing what the
basket took without showing what the list currently wants is how somebody sets a number that
looks right and is not.

### 3.2 The candidates

Lists that hold the same thing and are **not** already an origin of this line.

The match is `mergeKey` from `line-dedup.ts`, unchanged: the same single product, or the same
`itemSetHash`, or the same normalized text. This is not a convenience, it is the correctness
argument for the whole section. **The sheet must never offer a match the run would not have
merged**, or the same product appears as one line in one basket and two in the next, and the
household cannot tell which of the two the shopper was looking at.

The search runs over the lists in section 4's scope, using the queries the run itself already
uses: `WRITABLE_LISTS_SQL` for the scope, `CANDIDATE_LINES_SQL` and `CANDIDATE_LINE_ITEMS_SQL`
for the lines and their products, and `ACTIVE_OVERLAP_SQL` for the lines another active basket is
already carrying.

Each candidate carries the same identity and name fields plus its `listQuantity`, and an
`unavailable` reason where it cannot be adopted:

| Reason | Meaning |
| ------ | ------- |
| `CLAIMED` | another active basket of the owner's already carries this line (`0050` section 3) |
| `NOT_APPROVED` | the line's `approvalStatus` is not `APPROVED`, so the run would not have taken it either |
| `SETTLED` | the line's quantity is already zero and this basket would be asking for nothing |

A candidate with a reason is **served rather than filtered out**, and it is the one place this
codebase deliberately serves something the caller cannot act on. The reason is that "the parents'
house also wants milk and somebody else is already buying it" is a fact worth knowing while
standing in a dairy aisle, and it is a fact about lists this reader is entitled to. Velista
`0055` section 4 draws it as a caption with no control beside it, which keeps `0030`'s rule
intact: the **control** is absent, the information is present.

## 4. The scope, and who may write

### 4.1 The candidate scope is both accesses, intersected

Candidates are drawn from lists that the **owner** holds `WRITE` on **and** the **actor** holds
`WRITE` on.

For the overwhelming case, where the actor is the owner, that is their entire writable set across
every zone they are in, which is exactly the requirement: a list from a zone the run never drew
from is adoptable, and so is a zone the run never heard of.

The intersection bites only on a registered co-shopper, and it is there because of `0051` section
6.4. **A settle is authorized by the owner's access.** If a co-shopper could adopt a line from a
zone the owner is not in, the basket would carry an origin that every subsequent settle skips and
reports, forever. A control that can add a row nothing can ever act on is worse than a control
that cannot add it.

The rejected alternative and what would lift the restriction are in section 8.

### 4.2 The actor's own access is what authorizes the write

Section 6.4 answers "what authorizes an actor who has no access of their own", and its answer is
the owner's delegation. It does not say an actor with access may not use it, and here the actor
necessarily has one: they hold `WRITE` on every source list, which is what passing the rule
means, and section 4.1 makes them hold `WRITE` on the target too.

So the write is checked against **both**, at request time, and the check is cheap because it is
the same `writableAmong` read the settle already makes.

## 5. The write

**`GENERATED_LIST_SHARING_PATTERNS.setOriginQuantity`**, and
`POST /v1/generated-lists/:id/lines/:lineId/origins`:

```
{ listId, lineId, quantity, from }
```

An upsert. An existing origin for that zone line is edited; one that does not exist is adopted.
`from` is the contribution the client believed, refused on a mismatch for `0056` section 3.2's
reason exactly: two people editing one split must not silently overwrite each other's arithmetic.

In one transaction, with `delta = quantity - previous` (`previous` is 0 for an adoption):

1. **The zone line moves by `delta`**, through the atomic signed delta path `0040` built and
   `0047` section 2.1 blessed, floored at zero. This is an ordinary demand change: it emits
   `line.updated`, it re triggers no approval (`0047` section 7), and it writes no settlement.
2. **The origin row is written.** An edit sets `quantity`. An adoption inserts a row with the
   zone line's current `version` as `lineVersion`, exactly as the run does.
3. **The basket line moves by the same `delta`**, floored at `settledQuantity`.
4. **The claim moves.** An adoption claims the zone line, so the other household's list says
   somebody is out buying it (`0051` section 5.3). A contribution set to zero drops the origin row
   and releases the claim.

### 5.1 Why the basket line moves by the delta and is not recomputed

The obvious implementation sets `line.quantity = sum(origins)`. It is wrong, because `0056` lets
a shopper raise a basket line above what the households asked for, and a recompute would silently
throw that away the next time anybody opened this sheet. The delta preserves it without needing a
column to remember it, which is why there is no schema change in this plan.

The consequence is that a basket line's quantity can exceed the sum of its origins, and that is
not drift, it is the sale. `0056` section 4 already says what happens to those units when they
are bought.

### 5.2 The floor is what this basket already settled against that origin

A contribution cannot be set below `settledHere`. Two units of the flat's milk have been bought
through this basket; the flat cannot retroactively have wanted one.

Refused with a distinct code carrying the floor, so the client can say the number and not just
that it failed. Note that the **zone line** may legitimately be below that number already,
because somebody else settled it from the list page, and that is why the floor is per origin and
per basket rather than a comparison against the zone line.

### 5.3 Zero drops the origin, and is not a purchase

Setting a contribution to zero removes the list from the basket line: the origin row goes, the
claim is released, and the zone line is lowered by what it had contributed. The zone line may
land at zero, which is `0047`'s "known about, not currently wanted".

**No settlement is written and no bought indicator is set**, which is the whole point of section
1 and the single most likely thing to be got wrong by somebody implementing this next to the
settle service.

Dropping the **last** origin leaves a line with no origins, which `0055` section 6 makes settle
able, so nothing breaks. The line keeps `origin = DERIVED`, because it is still a line the run
composed and its history should say so.

## 6. The client is required to say what this is not

Because the same control, a reel, one screen up, means "bought".

The contract carries the difference rather than leaving it to copy: the response to this write
reports **no settlement refs and no skip report**, and the events it emits are `line.updated` and
never `line.settled`. A client that drew "got it" from this response would be drawing something
the server never said.

Velista `0055` section 5 carries the sentence on the sheet. It is named here because a second
client, or the assistant, would need the same warning and the contract is where they would look.

## 7. Contracts, events, migrations

- `GetGeneratedListLineOriginsRequest` and `SetGeneratedListOriginQuantityRequest` in
  `libs/luna-shopper/contracts`, with an `OriginUnavailableReason` constant set for section 3.2's
  table, per the constant sets rule.
- Events: `line.updated` on each affected zone list room, `generatedList.lineUpdated` on the
  basket room, and the claim event `0051` section 5.3 defines on adoption and on release.
- **No migration.** Every column exists. The read is composed from queries the run already
  carries, and the write moves numbers that are already there.
- The OpenAPI document is regenerated.

## 8. Open decisions

- **Lifting section 4.1's intersection**, so a co-shopper can put their own household's list into
  somebody else's basket. It needs `0051` section 6.4 to become per origin: a
  `GeneratedListLineOrigin.authorizedByUserId`, written at adoption, and a settle that checks the
  owner's access for the origins the run created and that user's for the ones they adopted. It is
  the right eventual answer and it is deliberately not built first, because it changes the
  security rule every settle in this product runs through, for a case that only appears when two
  households shop from one basket.
- Whether adopting should be offered for a line whose match is **text only**. The run merges on
  normalized text as its last resort and is deliberately conservative about it, and a sheet that
  offers to bind "milk" to "whole milk" is that conservatism read backwards. Leaning yes but
  drawn distinctly, so the reader confirms a match the run would have made rather than one it
  guessed.
- Whether an edit here should carry through to the **other** active baskets that hold the same
  origin. They cannot: `0050` section 3 says a line is carried by at most one active basket, so
  the case does not arise. Recorded because it looks like a gap and is not.
- Whether the read should page. A line with more than a handful of candidate lists is possible
  for somebody in many zones, and the answer today is one response. Leaning a cap with a count of
  what was not shown, rather than a cursor on a sheet nobody scrolls.

## 9. Exit criteria

- A reader who passes the all or nothing rule opens a line's origins and sees, per list, what it
  contributed, what it currently asks for, and what has already been settled against it.
- A guest is refused the read, and so is a registered participant who holds only `READ` on one
  source list.
- The candidate list contains every list in scope holding a line the run's own deduplication rule
  would have merged, and nothing else.
- A candidate another active basket already carries is shown, marked, and cannot be adopted.
- Raising one list's contribution raises that list's own line by the same number and the basket
  line by the same number, writes no settlement, and sets no bought indicator.
- Lowering one does the same in reverse, and the zone line lands at zero rather than being
  deleted.
- Setting a contribution to zero removes the list from the line and releases its claim.
- Adopting a list that was not in the run adds an origin, raises its zone line, claims it, and
  raises the basket line.
- A contribution cannot be set below what this basket has already settled against it, and the
  refusal names the floor.
- A basket line raised above the sum of its origins keeps the difference across an edit here.
- A stale `from` is refused and nothing is written.
- Nothing in this plan appears in any settlement history or moves any bought indicator.
