# 0053: four reads the shipped screens still need

> Four backend absences, each of which leaves a screen that is already in front of users
> drawing something incomplete, vague, or wrong. None of them is a large piece of work. They
> are collected because they share a diagnosis: in each case a client was built to a plan, the
> read it needed did not exist, and the client shipped with the honest degradation rather than
> the feature.
>
> Two of them (sections 1 and 2) are the direct cause of a defect and a piece of hedged copy in
> velista. The other two close gaps their plans named and left.

## 1. Reading a set of product names, over HTTP

`ITEM_PATTERNS.getMany` exists in `libs/luna-shopper/contracts`, with a documented cap on how
many products one call may name (`catalog.messages.ts:503`). It has exactly one consumer,
`generated-list-sharing.controller.ts:334`, added by velista `0044` so a guest with no account
could read the names in a basket. **There is no general HTTP route in front of it.**

The consequence is a live defect. Velista's line detail sheet and line page resolve product
names through `catalogItemById`, a hand written fixture in `catalog-memory.ts` holding a few
Spanish products, because no service method existed to ask. Against a real catalog every id
misses and both screens tell the user their line has no products when it does. Velista `0047`
section 1 is the other half of this fix and consumes what this section adds.

`GET /v1/catalog/items/:id` already exists, and is the wrong shape: a line carries a **set** of
products (`0048`'s `itemSetHash` hashes that set), so resolving one line's names through it is
one request per product from a sheet that opens on a tap.

**Add a batch read on the account authenticated catalog surface**, in front of the existing
pattern. Notes that matter:

- The existing cap is enforced at the route, not just documented. A batch read with no ceiling
  is a listing, and `0049` section 3 deliberately stopped the catalog being listable.
- **Unknown ids are omitted, not an error.** A line can outlive a product. A sheet that fails
  to open because one of five products was withdrawn is a worse failure than a sheet that names
  four.
- This route is account authenticated and is **not** the guest path. The basket's composition
  stays where it is, inside the participant authenticated surface, for the reason `0044` put it
  there: a guest reaching a general catalog route is a wider hole than a guest reading the names
  in the basket they were invited to.

## 2. What a run actually finished

`GeneratedListSummaryView` carries `lineCount` and `settledLineCount`, and nothing else
(`generated-list.messages.ts:170`). `SettlementOutcome` distinguishes `BOUGHT` from
`NOT_AVAILABLE`, and both close a line's outstanding amount, so `settledLineCount` merges two
different outcomes into one number.

Velista `0045` therefore ships its history rows reading "N of M finished" rather than the mock's
"3 of 4 got, 1 not available". That was the right call: a summary cannot claim a purchase it
cannot distinguish from a shop having none of it.

**The summary gains the breakdown.** `settledLineCount` stays, so nothing that reads it today
changes; the counts of each outcome sit beside it. The per line `lastOutcome` already exists on
the basket's own view (`generated-list-sharing.messages.ts:655`) and on `list.messages.ts:269`,
so this is an aggregate over a fact the row already carries rather than a new fact.

**One field more, while the projection is being touched.** Velista `0049` section 4 wants a
count of people present on a basket for the home card, and explicitly refuses to spend a request
per card on it. Once velista `0048` gives the basket real presence, that count is cheap here and
expensive anywhere else. It is a count, never a list of who: the card is a card.

## 3. Which other lists hold this item

Velista's line detail sheet draws `alsoOn`, "this is also on these other lists", computed from
whatever lists the session happens to have already loaded, because no endpoint answers the
question. It under reports, and it draws nothing when empty, so "nobody asked" and "it is on no
other list" are the same picture.

**Add the query.** Given an item, answer the lists holding a pending line for it, filtered by
the caller's read access **at request time**, which is the rule plan `0047` section 6 already
applies to the cross list item history and is the same privacy question with the same answer.

The read is bounded and it is not a search: it answers for one item, for one caller, and it caps
what it returns. A line with no item has no answer and the endpoint says so rather than
returning an empty list, because those are different (velista `0047` section 5 draws them
differently and needs to be able to tell).

## 4. Naming a list the settle could not reach

When a settle cannot reach every origin, the report carries `skipped[].listId` for a privileged
reader. Velista renders a count and never a name, for every reader, because the basket screen
reaches no zone list store and `settle-sheet.ts:333` records the deliberate refusal to give it
one.

That refusal is correct: coupling the basket screen to a zone list store to render an error
would be a real architectural cost for a rare path. The right fix is on this side. **The report
carries the names**, composed by the gateway for readers entitled to them, exactly as `0044`
already composes `sourceNames` for a basket's source lists.

The redaction rule is unchanged and is the whole point: a guest's report keeps the count and
gains nothing. Velista `0049` section 1.2 consumes this.

## 5. Contracts, events, migrations

- A batch item route on the catalog surface, in front of the existing pattern, with the existing
  cap enforced.
- Outcome counts and a presence count on `GeneratedListSummaryView`, additive; `settledLineCount`
  is unchanged and nothing that reads it breaks.
- A new read for section 3, with request and response contract schemas so `/docs` describes it
  with no hand written DTOs.
- `sourceNames`-style composition of skipped origin list names on the settle response, for
  privileged readers only.
- **No migration.** All four are reads over data that already exists.
- The OpenAPI document is regenerated and committed. It is generated output; the generator is
  the only thing allowed to write it, and `openapi-document.spec.ts` fails when it is stale.

## 6. Open decisions

- Whether the section 3 read should also answer for a **group** rather than an item, since a
  line can carry several products. Leaning item only for now, with the client asking per product
  and merging, because the group case needs a rule for partial overlap that nothing yet needs.
- Whether the section 2 presence count should be live on the summary or resolved at read time
  from the presence store. Leaning read time, since a stale "2 shopping" on a card is the exact
  failure velista `0048` section 5 refuses to draw.
- Whether the section 1 route should accept item ids **and** group ids. Leaning items only:
  groups are a search time concept and a line references no group after the composer copies its
  members (`0048` exit criteria).

## 7. Exit criteria

- A set of product names is readable in one account authenticated request, capped, with unknown
  ids omitted rather than failing.
- Velista's two line screens name products from the catalog and no feature library imports a
  fixture to do it.
- A run's summary distinguishes what was bought from what the shop did not have, and
  `settledLineCount` still means what it meant.
- A basket's summary carries how many people are present, as a count and never a list.
- Asking which other lists hold an item is answered, filtered by read access at request time,
  and distinguishes "no other list" from "the line has no item".
- A skipped origin is named to a reader entitled to the name and is a bare count to a guest.
- The OpenAPI document reflects all four.
