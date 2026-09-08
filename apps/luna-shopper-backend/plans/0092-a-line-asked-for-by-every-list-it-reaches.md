> **PR:** [#256](https://github.com/IchirokuXVI/nx-portfolio/pull/256)

# 0092: a line asked for by every list it reaches

> A line somebody added in an aisle can be sent to one list, once (`0058`). A line the run
> composed can have what each list asked for changed, but only for lists that already hold a
> matching line (`0057`). Those are two sheets, two routes and two rules for one question:
> **how many of this does each list want from this basket?**
>
> This plan makes it one write. Every list the reader can send the line to is a row with a
> number, the number is what that list asked for, and raising it from zero is what "send this
> line to that list" now means. A list with no such line gets one created. A list that already
> holds one, whether the run drew from it or not, is adopted. The bind route and its picker go.
>
> Prerequisite reading: `0057` (the read and the write this plan widens, and section 4 for the
> access rule that is unchanged), `0058` (the route this plan deletes, and section 4.3 for the
> approval rule that survives), `0091` (a list holds one line per name, which is what makes
> "create" and "land on the one that is there" the same call) and `0051` sections 5.2 and 6.4.
> `0093` re-homes purchases made before the line reached a list, and hooks into section 5
> here. Velista `0068` is the other half.

## 1. The rule

> **A basket line has one number per list: what that list asked for through this basket. Any
> list the reader and the owner can write is a row, at zero until somebody raises it.**

Everything in `0057` section 1 still holds. Moving one of these numbers is that household
changing what it wants, it writes no settlement, and it is not buying. What changes is only
which lists are rows, and what raising a row from zero does when the list has no line yet.

## 2. What goes

| Gone                                                     | Replaced by                              |
| -------------------------------------------------------- | ---------------------------------------- |
| `GET /v1/generated-lists/:id/lines/:lineId/targets`      | the widened `lineOrigins` read, section 3 |
| `POST /v1/generated-lists/:id/lines/:lineId/target`      | the widened `setOriginQuantity` write, section 4 |
| `GENERATED_LIST_SHARING_PATTERNS.lineTargets`, `bindLine` | the two patterns `0057` declared        |
| `GeneratedListBindService`, `generated-list-bind.spec.ts` | nothing                                 |
| `GetGeneratedListLineTargetsRequest`, `BindGeneratedListLineRequest`, `BindGeneratedListLineResult`, `GeneratedListLineTarget` | nothing |
| "binding is once" (`0058` section 4.2)                   | nothing. A line reaches as many lists as are raised |
| velista's `line-list-sheet` and its route                | velista `0068`                           |

`targetListId` stays as a column and is written once, on the first list an `ADDED` line
reaches, because `0050` section 5 reads it as "the owner said where this goes" and nothing
else needs to change today. It is never again read to refuse anything. Dropping it is section
8.

## 3. The read

`GENERATED_LIST_SHARING_PATTERNS.lineOrigins`, unchanged in name and route, answering a third
collection beside `origins` and `candidates`:

```ts
export interface GeneratedListLineOriginsResult {
  generatedListId: string;
  lineId: string;
  origins: GeneratedListLineOriginDetail[];
  candidates: GeneratedListOriginCandidate[];
  /** Lists in scope holding no matching line. Raising one creates the line (section 4.2). */
  others: GeneratedListListRef[];
}

export interface GeneratedListListRef {
  listId: string;
  zoneId: string;
  listName: string | null;
  zoneName: string | null;
  fromRun: boolean;
}
```

`fromRun` is added to the origin detail and the candidate too, because the client sorts the
run's own lists first (`0058` section 3 said why) and the server sorts nothing.

`GeneratedListLineOriginDetail` gains `approvalStatus`, so a row can say the list has not
agreed yet. That was one flag on the bind result, and it is now one field on every origin,
which is what it always was.

### 3.1 The read is offered for every line

`0057` served this read for a line with origins or candidates, and the client hid the entry
otherwise. It now answers for any line, including an `ADDED` line with nothing yet, whose
`origins` and `candidates` are empty and whose `others` is every list in scope. That is the
row set the old target picker showed, and it is now the same sheet at zero.

### 3.2 Three candidate refusals change

`checkAdoptable` and the candidate's `unavailable` reason are where `0057` decided which
matching lines could be taken, and two of its three refusals contradict rules made since.

| Reason         | Before                                                | Now                                                              |
| -------------- | ----------------------------------------------------- | ---------------------------------------------------------------- |
| `NOT_APPROVED` | refused, "the run would not have taken it either"     | **adoptable.** A pending origin is still claimed and still settled (`0058` section 4.3). The row says it is waiting |
| `SETTLED`      | refused, "this basket would be asking for nothing"    | **adoptable.** A list at zero is a list that can be asked again, and raising it is exactly that |
| `CLAIMED`      | refused, another active basket carries it            | kept, and **fixed**. The query tests `status = 'ACTIVE'`, which is never written (a live basket is `DRAFT`), so it has never fired. It must use `isLiveGeneratedList`'s statuses, and it must exclude this basket's own lines, because `0094` puts two siblings on one zone line on purpose |

`REJECTED` stays refused, and it is refused for the reason `0091` section 3.1 gives: the
household said no, and a basket must not raise a line the list will never buy. It gets its
own reason so the row can say so.

## 4. The write

`GENERATED_LIST_SHARING_PATTERNS.setOriginQuantity`, unchanged in name and route, with
`sourceLineId` made optional:

```ts
export interface SetGeneratedListOriginQuantityRequest {
  generatedListId: string;
  lineId: string;
  participantId: string;
  sourceListId: string;
  /** Absent for a list holding no matching line: the line is created (section 4.2). */
  sourceLineId?: string;
  quantity: number;
  from: number;
}
```

Three cases, decided by what exists, and the first is `0057` section 5 unchanged:

| Case                                                  | What happens                                   |
| ----------------------------------------------------- | ---------------------------------------------- |
| an origin row exists for `sourceLineId`               | edit, `0057` section 5, delta path             |
| no origin, `sourceLineId` names a matching zone line  | adopt, section 4.1                             |
| no origin, no `sourceLineId`                          | create, section 4.2                            |

### 4.1 Adoption takes over demand before it adds any

`0057` section 5 moves the zone line by the whole contribution on adoption, and for the case
`0057` had in mind, a list that already asked for one, adopting it at one pushed the list to
two. This basket is taking over demand that exists, not adding to it, and the run itself never
raised a list it drew from.

So on adoption, with `listQuantity` the zone line's quantity at the moment of the write:

- the zone line moves by `max(0, quantity - listQuantity)`. Up to what the list already asks
  for, nothing moves. Above it, the difference is new demand, exactly as an edit is.
- the origin row is written with `quantity`, as before.
- the basket line moves by the whole `quantity`, as before, because the basket will buy all
  of it.
- the claim is announced, as before.

An **edit** of an existing origin keeps `0057`'s pure delta, because after adoption the
contribution and the list's demand are the same number moving together, and lowering one is
the list changing its mind.

### 4.2 Creation is the ordinary add

With no `sourceLineId`, the write calls `GeneratedListLineService.promote` for that list, which
calls `line.add` with the basket line's content, `quantity` as the amount and the products
`0065` chose. After `0091`, `line.add` answers the line it landed on, and it may be an
existing line the candidate read did not offer, which happens when the names fold together
and the products do not. `promote` writes the origin row against whichever id it was answered,
with the added amount.

Two consequences, both deliberate:

- The created line starts under the list's own approval rule (`0058` section 4.3), and the
  answer says so through `approvalStatus` on the origin detail.
- If the answered line already has an origin on this basket line, the client was stale and
  the write is refused with `StaleQuantityException`, since a raise that lands on a row the
  client showed at zero has to be shown again before it means anything.

The write never creates a zone line for an amount of zero: with `quantity = 0` and no origin,
it is a no op and answers success, so a reel released where it started costs nothing.

### 4.3 Then the waiting purchases come home

After any origin row is inserted, whether by adoption or creation, the write calls the hook
`0093` defines, inside the same transaction, so units bought before the line reached this
list are recorded on it. This plan only leaves the seam. Before `0093` lands, the hook does
nothing, and the line's earlier purchases stay where `0055` section 6 left them.

### 4.4 Who may write

`0057` section 4 unchanged: the candidate and other lists are the intersection of the owner's
and the actor's `WRITE` access at request time, a guest sees none of it, and the write is
checked against both. `0058` section 3.1's argument for the intersection holds unchanged for
a created line, because a created line is an origin every later settle must reach.

## 5. `promote` after this plan

`promote` keeps its two callers, the owner's default target on an add (`0055` section 3.2)
and this write, and changes in two places: it reads `0091`'s `merged` answer to write the
origin row against the right line, and it calls `0093`'s hook after the row exists. The
`ON CONFLICT DO NOTHING` on the origin insert stays, and a conflict there is the stale case of
section 4.2 rather than a silent success, so the caller checks the row count.

## 6. Contracts, events, migrations

- `GeneratedListListRef` and the widened `GeneratedListLineOriginsResult` in
  `libs/luna-shopper/contracts`. `fromRun` on origin details and candidates, `approvalStatus`
  on origin details. `sourceLineId` optional on the write. A `REJECTED` value added to
  `OriginUnavailableReason`.
- The four bind contracts and both bind routes deleted, with their patterns and service.
- Events: `line.added` or `line.updated` on the zone room, per `0091`. `line.updated` on an
  adoption that raised the zone line, and nothing on the zone room when it did not. The claim
  event on adoption and on creation. `generatedList.lineUpdated` on the basket room.
- **No migration.** `targetListId` stays, every other column exists.
- The OpenAPI document and the admin wire types are regenerated.

## 7. Tests

In `generated-list-origins.spec.ts`, replacing `generated-list-bind.spec.ts`:

1. An added line with nothing answers empty origins and candidates and every list in scope in
   `others`, with `fromRun` set on the run's lists.
2. Raising a list in `others` creates the zone line at that amount through `line.add`, writes
   the origin row, claims the line, and answers the approval status.
3. Raising it on a list that folds the name into an existing line lands on that line.
4. Adopting a candidate that asks for five at five leaves its zone line at five, and at seven
   raises it to seven; an edit afterwards moves it by the delta.
5. A pending candidate and a candidate at zero are adoptable, and a rejected one is refused with
   its own reason.
6. The claimed check fires for a live basket of the owner's and ignores this basket's own
   siblings.
7. A zero quantity with no origin writes nothing and answers success.
8. A stale `from`, and a raise landing on a line that already has an origin here, are both
   refused and nothing is written.
9. A guest is refused the read and the write.

One integration assertion: through the gateway, an added line raised for two lists produces
two zone lines, two origins, two claims, and both routes of `0058` answer 404.

## 8. Open decisions

- **Dropping `targetListId`.** Nothing reads it after this plan except `0050` section 5's
  sentence about the owner's default. Leaning a migration in its own small plan once the
  default target itself is reconsidered.
- Whether a skipped list's row should be able to take over its whole demand in one tap rather
  than by dragging to it. The write already allows it, so it is velista `0068`'s question.
- Whether `others` should be capped for a reader in many zones. `0057` section 8 leaned a
  cap with a count, and this read now has more rows than that one did.

## 9. Exit criteria

- The two bind routes, their service and their contracts are gone, and the OpenAPI document
  says so.
- Any line's origins read answers every writable list as an origin, a candidate or an other,
  each saying whether the run drew from it.
- Raising a list with no matching line creates one through the ordinary add, under the list's
  approval rule, and the row says whether it is waiting.
- Adopting a list already asking for the amount raises nothing on its list, and above that the
  difference.
- A pending line and a line at zero can be adopted, a rejected line cannot, and a line another
  live basket carries cannot.
- A line can reach as many lists as are raised, and reaching one never refuses the next.
- The hook for `0093` runs after every origin insert and does nothing until `0093` exists.
