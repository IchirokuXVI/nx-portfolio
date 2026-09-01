# 0058: binding an added line to a list

> `0055` lets anybody in the shop put a line in the basket, and that line lives in the basket
> alone. This plan is the one gesture that takes it out: somebody with an account and the access
> says which shopping list it belongs in, and it becomes a line in that list like any other.
>
> The promotion itself already exists. `GeneratedListLineService.promote` creates the zone line
> through the ordinary `line.add` path, with ordinary access checks and ordinary approval, and
> records the provenance row. What is missing is a way to reach it that is not the owner's
> account surface, and a read that says which lists may be chosen.
>
> Prerequisite reading: `0050` section 5 (the write back rule, and `targetListId`), `0055`
> (which creates the lines this plan is about), `0051` sections 5.2 and 6.4 (the all or nothing
> rule and whose access authorizes a write) and `0057` section 4, whose access argument this
> follows exactly. Velista `0056` is the other half.

## 1. The rule this is an instance of

> An edit inside a basket changes the shared lists **only** when somebody has said which list
> should receive it.

That is `0050` section 5, and it is the sentence the entire generated list feature turns on. This
plan is the "has said which list" half, made reachable from the screen where the person holding
the basket actually is.

Everything restrictive below follows from it. The gesture is deliberate, it is one way, and it is
not available to somebody who cannot be told which lists exist.

## 2. What is being built

1. **A read**: which lists this line may be sent to.
2. **A write**: send it, once.

Both under `ParticipantGuard`, both refused for a participant who does not pass `0051` section
5.2's all or nothing rule.

**A guest never sees either**, and the reason is not that a guest is untrusted. It is that both
of them name lists, and naming a list to a guest is exactly the disclosure section 5.2 exists to
prevent. A guest's line stays in the basket, which is where they put it, and anybody with an
account can bind it afterwards.

## 3. The read

**`GENERATED_LIST_SHARING_PATTERNS.lineTargets`**, and
`GET /v1/generated-lists/:id/lines/:lineId/targets`.

Answers the lists that may receive this line, grouped by zone, each with its zone name, its list
name, and a flag saying whether the run drew from it.

The flag is the whole ergonomics of the picker. The line was almost certainly remembered while
shopping for the lists this basket came from, so those are drawn first (velista `0056` section
3), and everything else is below. The server sorts nothing else: the client groups and orders,
and this read stays a set.

### 3.1 The scope is the same intersection `0057` uses

Lists the **actor** holds `WRITE` on and the **owner** holds `WRITE` on, at request time.

The actor's half is what the requirement asks for: any list they can write to, not only the ones
the run drew from, and a zone the basket has never heard of is a perfectly ordinary answer.

The owner's half is `0051` section 6.4 again. Binding creates an origin, and every settle on that
origin is authorized by the **owner's** access. A line bound into a list the owner cannot write
would be reported as skipped on every purchase for the life of the basket: the household would
see the line and never see it bought, and the shopper would get a skip report they cannot act on.
A picker that can offer such a list is a picker that can create a permanently broken row.

This narrows the literal requirement, which said any list the acting user has access to, and it
narrows it only for a registered co-shopper binding into a zone the basket's owner is not in. For
the owner, who is the person doing this nearly every time, it is no restriction at all. `0057`
section 8 carries the open decision that would lift it for both plans at once, and it is one
decision rather than two on purpose.

## 4. The write

**`GENERATED_LIST_SHARING_PATTERNS.bindLine`**, and
`POST /v1/generated-lists/:id/lines/:lineId/target` with `{ listId }`.

Preconditions, each with its own code so the client can say which one it hit:

| Precondition | Why |
| ------------ | --- |
| The line's `origin` is `ADDED` | A `DERIVED` line is already in the lists its origins name. `updateLine` refuses this today and the message is reused |
| The line's `targetListId` is null | Binding is once. Section 4.2 |
| The actor passes the all or nothing rule | Section 2 |
| Both the actor and the owner hold `WRITE` on the list, now | Section 3.1 |
| The basket is not `COMPLETED` or `ARCHIVED` | `0055` section 3.3 |

Then `promote` runs as it does today: the zone line is created through `line.add`, with the
list's ordinary approval behaviour, and the provenance row is written. The claim follows, so the
household's list says somebody is out buying it.

### 4.1 A partly settled line is bound at what is outstanding

Somebody adds "batteries" in the shop, buys them, and then says they belong in the flat's list.
The units are already gone. Creating a zone line asking for four batteries would be asking the
household for something already in the cupboard.

**The zone line is created with the line's outstanding amount**, `quantity - settledQuantity`,
which may be zero. A zone line at zero is `0047` section 2.2's line: the household now knows
about batteries, does not currently need any, and will keep the history from here on.

**No settlement is backfilled** for the units bought before the binding, and this is the decision
most worth arguing. We know who bought them, when, and how many, so a backfill would be
possible in a way `0047` section 8's migration was not. It is still wrong: the household never
asked for those units, and `0047` section 6.3 computes a purchase interval from exactly these
rows. Seeding that series with a purchase that satisfied no demand of theirs makes the first
estimate the household ever sees a worse one.

### 4.2 Binding is one way, and the plan says so rather than the button

`0050` section 5 already established that clearing `targetListId` does not delete the line it
created, because a shared list is not something a basket may take things back out of. That holds
here and is the reason the write has no inverse.

Removing the line from the target list is done **on the target list**, by somebody with access,
as an ordinary delete. That is the same person and the same gesture as removing anything else
from that list, which is the property that makes this safe to offer: the basket can put something
in front of a household, and only the household can decide what stays.

Velista `0056` section 4 puts that sentence in front of the reader before they commit.

### 4.3 Approval is not waived

The created line starts `PENDING` approval unless the list auto approves, exactly like a line
typed on the list page. `0037`'s rule that the server decides is untouched, and the actor's
`DECIDE` access, if they have it, is not consulted here: binding is an add, and an add does not
approve itself.

**The response says which**, so velista can tell the reader their line is waiting rather than
letting them believe it landed. This is one field on an existing view and is the whole of the
work.

The basket keeps the line regardless. An unapproved zone line is still an origin, still claimed,
and still settle able, because the basket's shopper is buying it either way and the household's
decision is about their own list.

## 5. Contracts, events, migrations

- `GetGeneratedListLineTargetsRequest` and `BindGeneratedListLineRequest` in
  `libs/luna-shopper/contracts`.
- Events: `line.added` on the target list's zone room, the claim event from `0051` section 5.3,
  and `generatedList.lineUpdated` on the basket room, carrying the line now that it has an origin
  and a target.
- **No migration.** `targetListId` and the provenance table are `0050`'s and unchanged.
- The OpenAPI document is regenerated.

## 6. Open decisions

- **Whether the owner's `defaultTargetListId` should be offered as a suggestion** in the picker
  rather than only applying to the owner's own adds (`0055` section 3.2). Leaning yes as a
  preselected row and never as a default that commits without a tap, since the whole gesture is
  about somebody saying which list.
- **Binding several lines at once.** Somebody comes home from a trip with four added lines and
  wants them all in the flat's list. Leaning yes eventually, as a separate message rather than an
  array on this one, because the partial failure reporting is the entire design of it.
- Whether a line bound into a list should carry the guest's typed name into the zone side.
  Leaning no: a household's list may name only accounts, and the account that bound it is the
  honest author. The basket keeps the guest's attribution, where it belongs.
- Whether to allow binding a `DERIVED` line to an **additional** list. That is not this gesture,
  it is `0057`'s adoption, and it is recorded here because the two look alike from the outside
  and must not be built as one message.

## 7. Exit criteria

- The owner opens an added line and is offered every list they and the basket's owner can write
  to, grouped by zone, with the run's own lists first.
- A registered participant who passes the all or nothing rule is offered the intersection of
  their access and the owner's, and a guest is refused both the read and the write.
- Binding creates the line in that list through the ordinary add path, with the list's ordinary
  approval behaviour, and the response says whether it is waiting for approval.
- The created line's quantity is what was outstanding on the basket line, and no settlement is
  written for units bought before the binding.
- The basket line gains an origin, is claimed on the zone side, and becomes editable by `0057`'s
  sheet.
- Binding a second time is refused, and clearing the target does not delete the created line.
- Binding a `DERIVED` line is refused with a code that says why.
- Binding to a list either party may no longer write is refused at request time, not at settle
  time.
- The OpenAPI document covers both routes.
