# 0054: a participant has a name, and a settled line can be reopened

> Three backend absences behind a batch of reported defects on velista's basket screen. Each
> one is small, and each one is the reason the client currently draws something the reporter
> called wrong.
>
> A participant row for somebody with an **account** is created with a null `displayName`, so
> the basket carries no name for the person who made it or for a signed in joiner. Velista
> covers that by falling back to the word "Owner" or "Member", and a reader looking at four
> faces in a shop sees a role where a name belongs.
>
> A settle is **append only and one way**. There is no message that takes a basket line back to
> outstanding, so the status control velista `0052` section 6 asks for can mark a line got and
> can never unmark it.
>
> And settling a line with nothing outstanding raises `validation_failed`, which is the same
> code a malformed quantity raises, so a client cannot tell a state it can explain from a bug it
> cannot.
>
> Prerequisite reading: `0051` sections 3.2, 3.5 and 6 (participants, their names, and the
> settle), and `0047` section 3 (a settlement is an append). Velista `0052` is the other half
> of this plan and the only consumer of everything below.

## 1. What is being built

1. **A participant carries the account holder's username**, resolved by the gateway and written
   by core, so no screen has to name somebody by their role.
2. **Reopening a settled basket line**, which takes a line back to outstanding without deleting
   the history that got it there.
3. **A distinct code for a line that is already finished**, so a client can say which of the
   things that can go wrong went wrong.

Sections 2 and 4 are independent of each other and of section 3. Section 3 is the largest and
is the only one that touches zone data.

## 2. A participant carries the account holder's username

### 2.1 What is wrong

`GeneratedListParticipant.displayName` is filled from `JoinGeneratedListRequest.displayName`,
which is the **name a guest types on the join screen**. Two rows never get one:

- The **owner**. `ensureOwnerParticipant` creates the row with `displayName: null`
  (`generated-list-sharing.service.ts`), which is correct as far as core is concerned: core owns
  no usernames, and `0018` section 9 forbids it reaching into auth for one.
- A **registered joiner**. Velista's join page sends the guest name field, which a signed in
  person never fills in, because section 3 of `0044` takes them straight through the screen
  without asking.

So a basket with an owner and two signed in friends carries three null names, and velista's
`participantName` falls through to `basket.people.owner` and `basket.people.member`. Every face
in the header drew the same two letters until `0051` split that fallback, and it still draws a
role rather than a person.

### 2.2 The rule this follows

**Core is told the name and never asks for it.** That is `0018` section 9's rule for
`CreateZoneRequest.username` and `JoinZoneRequest.username`, and it applies unchanged here: the
gateway holds a verified token that already carries the caller's global username, so resolving
it there is one field on a message rather than a fan out read from core into auth.

The alternative, enriching participant views at read time in the gateway, is rejected. A basket
read returns up to `maxParticipants` rows and would become a second request per read, on the
one screen in this product that is refetched every time somebody in a shop settles anything.

### 2.3 The change

**`JoinGeneratedListRequest` gains `username: string | null`**, as a separate field rather than
a value written into `displayName`. They are different facts: one is unverified text typed on an
unauthenticated link, the other is an account's own name, and `0051` section 3.5 rests on being
able to tell them apart. Merging them would make a guest's typed "Dani" indistinguishable on the
wire from an account called Dani.

- The gateway fills `username` from the verified token for a signed in joiner, and sends `null`
  for a guest, exactly as it fills `CreateZoneRequest.username`.
- Core writes it to a new `username` column beside `displayName`.
- `ensureOwnerParticipant` needs the same value, so **`GENERATED_LIST_SHARING_PATTERNS.share`
  and the participants read both carry the caller's username**, and the lazily created owner row
  is created with it. An owner row that predates this plan is backfilled on the next share,
  which is the same lazy repair `0051` chose for the row's existence in the first place.

**`GeneratedListParticipantView` gains `username: string | null`.** It is served to every reader
of the basket, guests included, and that is a deliberate disclosure: the people on one basket
are shopping together and already see each other's faces, join times and typed names. What
stays private is everything on the other side of the all or nothing rule, and a username is not
zone data.

### 2.4 What it costs

One nullable column, one migration, and one field on two messages. No read gets slower, because
the name arrives on a row that was already being read.

Two things it deliberately does not do:

- **It does not rename anybody retroactively.** A username is a snapshot taken at join time, as
  a zone membership's is. Somebody who changes their account name keeps the old one on baskets
  they have already joined, which is what `0018` gives a zone member and for the same reason:
  the alternative is a join at read time.
- **It does not make `displayName` unnecessary.** A signed in participant may still type a name
  on the join screen, and if they do it wins, because they said it on purpose.

## 3. Reopening a settled basket line

### 3.1 What is wrong

`GeneratedListLine.settledQuantity` only ever grows. `generated-list-settle.service.ts` adds to
it and clamps it at the line's quantity, and no message lowers it. A basket line marked got by
mistake, or got by somebody who then put the tin back, stays got for the life of the basket, and
velista `0052` section 6's status control can only ever be a one way switch.

This is harder than it looks, because a settle does **three** things and only one of them is on
the basket:

1. It advances `GeneratedListLine.settledQuantity`.
2. It appends a `LineSettlement` per origin, which is the household's consumption history.
3. It **decrements `ListLine.quantity`** on every origin, which is the household's own list.

Undoing the first alone would leave a line outstanding on the basket that the origin lists
believe was bought.

### 3.2 What is being built

**`GENERATED_LIST_SHARING_PATTERNS.reopenLine`, and
`POST /v1/generated-lists/:id/lines/:lineId/reopen`.**

It takes the basket line back to fully outstanding: `settledQuantity` to zero, and every unit
this basket took off an origin list put back. It is the whole line rather than a number of
units, because that is the gesture the control makes, and because a partial reopen has no honest
answer to which of several settlements it is undoing.

### 3.3 The history is not deleted

**A settlement is an append (`0047` section 3), and that does not change here.** A reopen does
not delete `LineSettlement` rows. Instead:

- Each settlement this basket line produced gains **`revertedAt: Date | null`** and
  **`revertedByParticipantId: string | null`**, both nullable, both null for every row written
  before this plan.
- A reverted settlement is **excluded from every consumption total**, and is **still served by
  the settlement history**, marked, because "somebody said they got this and then took it back"
  is a truer history than a gap.
- `LineSettlementView` gains `revertedAt: string | null`. Velista `0052` section 8 draws it.

The alternative, appending a compensating settlement with a negative quantity, is rejected. It
keeps the ledger append only at the cost of making every existing sum over `quantity` wrong
until it is taught about signs, and there are such sums in stats, in reconciliation and in
`0047`'s indicators. A nullable timestamp changes each of those by one `WHERE` clause.

### 3.4 Putting the units back

For each settlement being reverted, in one transaction, taking the same pessimistic write lock
on the origin `ListLine` that the settle takes:

```
zoneLine.quantity += settlement.quantity   // BOUGHT only; NOT_AVAILABLE moved nothing
zoneLine.version  += 1
```

Three cases that are not errors:

- **The origin line was deleted.** There is nothing to put back. The settlement is still marked
  reverted, and the origin is reported the way `0051` section 6.4 reports a skip, for the same
  reason: the caller has to know something did not land.
- **The origin line moved on.** Somebody edited its quantity, or another basket settled against
  it, between the settle and the reopen. Adding back is still correct: the units this basket
  took off are the units this basket puts back, and the line's current value is whatever else
  has happened to it since.
- **`NOT_AVAILABLE`.** It moved no units, so it puts none back. It is still marked reverted,
  because the indicator `0047` section 5 derives has to stop saying the shop had none.

### 3.5 Who may

**The same authorization the settle has, and no more.** Any live participant of the basket,
guests included. A reopen is not a wider act than a settle: it touches exactly the origins that
this basket line's own settlements touched, it is scoped to one basket line, and refusing it to
the person who just made the mistake would leave the mistake standing.

**It does not require the all or nothing rule.** That rule gates *naming* zone data (`0051`
section 5.2), and this response names nothing: it answers with the basket line and a count of
origins it could not reach, which is the shape `0051` section 6.4 already settled on.

### 3.6 What it announces

- Each touched zone list hears **`RealtimeEvent.LineSettled`** with the restored line and the
  recomputed settlement summary, which is the event the household already handles for a line
  whose numbers moved. A new event type would mean every list screen in the product needing a
  case for it before any of them could show the right number.
- The basket room hears the ordinary line update it hears after a settle.

### 3.7 What it does not do

It does not reopen a **finished basket**, and it does not touch `GeneratedList.status`. Whether
a run reopens when one of its lines does is a question about runs, and it belongs with whoever
takes on `0053` section 2.

## 4. Already finished is a conflict, not a validation failure

`generated-list-settle.service.ts` raises `ValidationException('This line is already finished')`
when `outstanding === 0`. That is the same `validation_failed` code as a malformed quantity, an
over allocation and an unknown product option, and `messageArgs.field` does not reach the
client: `problem-factory.ts` fills `errors` from its own `errors` input and never from
`messageArgs`.

So a client wanting to say "this line is already done" has to infer it from which button was
pressed, which is the kind of reasoning `0004` section 4.4 exists to prevent.

**It becomes `ConflictException`.** The request is well formed and the state refuses it, which
is what `conflict` means everywhere else in this product. Velista `0052` section 7 keys its copy
on that code.

This is a **response code change on a shipped route**, 422 to 409, so it is worth stating that
nothing depends on the old one: velista's settle sheet treats every failure identically today,
which is the defect that started this.

## 5. Migrations

Three, all additive, none rewriting a row:

1. `generated_list_participants.username`, nullable text, the same length cap `display_name`
   carries.
2. `line_settlements.reverted_at`, nullable timestamptz, and `reverted_by_participant_id`,
   nullable, with the check constraint shape `settled_by_participant_id` already carries.
3. A partial index on `line_settlements (generated_list_line_id) WHERE reverted_at IS NULL`, so
   the reopen's read and the totals that now exclude reverted rows do not scan.

## 6. What velista does with it

Velista `0052` is the consumer, and it consumes the three in different places:

- Its section 2 deletes the "Owner" and "Member" fallbacks, because section 2 here makes them
  unreachable for a live participant.
- Its section 6 gets the second half of its status control.
- Its section 7 gets a sentence that says what actually happened.

**Neither side waits for the other.** Against a backend without this plan, `username` is absent
and velista falls back exactly as it does today; the reopen route answers 404 and the status
control stays a state indicator on a finished line; and the already finished failure keeps
arriving as `validation_failed`, which velista's error table already has a row for.

## 7. Out of scope

- **Reopening a zone list line directly.** `POST /v1/lines/:id/settle` has the same one way
  problem and is not fixed here. It is a different screen with a different authorization story,
  and doing both at once would double the surface of section 3.
- **Partial reopen.** See section 3.2.
- **Renaming a participant after they joined.** See section 2.4.
