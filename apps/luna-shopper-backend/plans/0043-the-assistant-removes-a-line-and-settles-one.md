# 0043 The assistant removes a line, and settles one

> **Two more tools, and one of them is a deletion.** The assistant can take a line off a
> list, and it can mark a line as in the trolley or as not available in the shop. Both are
> things somebody says out loud with their hands full, and neither is expressible today.
>
> Deletion is absent from the catalog on purpose (plan `0039` section 12), so this plan is
> partly an argument for reopening that, narrowly, with the guards that make it safe. It
> reopens **lines** and nothing else: no lists, no zones, no accounts.
>
> Prerequisite reading: plan `0039` sections 6, 8 and 12, plan `0040` section 7 (why the
> tools take arrays), and plan `0036` section 4.1 (who may touch an approved line, which is
> the rule both of these run into).

## 1. What is being built

- **`remove_lines`**, deleting one or more lines from one list, behind a confirmation and
  behind a resolution rule that refuses to guess.
- **`set_line_status`**, moving lines between `PENDING`, `READY` and `NOT_AVAILABLE`.

Both take arrays, for plan `0040` section 5's reason: a person says "we have got the milk
and the bread" in one breath, and a tool that takes one line turns that into a loop of
round trips through the gateway inside a turn that is already being waited on.

Both call routes that already exist: `DELETE /v1/lines/:id` and `POST /v1/lines/:id/status`.
Nothing in core changes, no permission is invented, and no event is added.

## 2. Reopening deletion, and how far

Plan `0039` section 12 lists what the assistant may not do, and puts it in the catalog's
absence rather than in the prompt, on the argument that an absent capability is a much
harder boundary than an instruction. That argument is still right, and it is why this plan
adds a tool rather than a sentence.

What changes is the scope of the ban, and the reasoning that has to survive:

| Still absent | Why |
| --- | --- |
| deleting a list | it destroys other people's work, it is rare, and the settings sheet asks for the name to be typed |
| deleting a zone or an account | the same, an order of magnitude worse, and irreversible in a way a line is not |
| zone governance | approve, kick, ban, roles, ownership: none of it is said in passing while shopping |
| **approving or rejecting a line** | see section 4.2 |

**A line is different in kind from every one of those**, and the difference is what makes
this safe:

- **It is small and it is cheap to redo.** A line deleted by mistake is retyped in four
  seconds, and the person who deleted it is looking at the screen it disappeared from.
- **It is the ordinary opposite of the thing the assistant already does.** `upsert_lines`
  puts things on a list. A tool that can add and cannot remove is a tool people fight
  rather than use, and the fight ends with somebody typing anyway.
- **Everybody with `WRITE` can already do it by hand**, in two taps, from the row menu. This
  adds no capability to the caller. It adds a way to say it.

## 3. `remove_lines`

### 3.1 It never deletes by name

The model supplies **line ids**, and only ids that appeared in this turn's context. Not
free text, not a description, not a position.

This is rule A3 applied to writes. Plan `0039` section 8 refuses to parse ids out of the
model's prose for **references**, on the argument that an id that came back from the gateway
during this turn exists and the caller can see it, while an id the model wrote into a
sentence has neither property. Everything in that argument is stronger when the id is about
to be handed to a `DELETE`.

So the model has to have looked. If the lines are not in context, the tool call is refused
by the service before it reaches the gateway, and the model's own next move is to look them
up. The cost is one extra tool call on a turn that is about to delete something, which is
exactly the turn to spend it on.

### 3.2 Ambiguity ends the turn with a question

Plan `0039` section 6.1 case 4 already establishes the pattern: a write that cannot be
resolved to exactly one list **asks**, and the turn ends with no write. The same rule, one
level down.

"Take off the milk" against a list holding *whole milk* and *oat milk* is a question, not a
coin toss. The service does not resolve it; the model does, by asking, because the model is
the thing holding the conversation. What the service guarantees is that it cannot be
resolved by accident: an id is an id, so the model has to have picked one, and picking one
without saying which is a prompt level failure rather than a silent data loss.

### 3.3 It confirms, and the confirmation names what goes

`rename_me` confirms once, in a sentence, because it changes what other people see (plan
`0039` section 6.3). Deletion confirms for a stronger reason and in a stronger form:

- **The confirmation names the lines**, by their text, and says how many. "Remove olive oil
  and rice from the weekly list?" A confirmation that says "remove those two items?" is a
  confirmation of a pronoun.
- **It is one round trip, not a multi step gate.** The turn ends with the question, the
  person answers in the next turn, and the delete runs then. The transcript is the state
  (plan `0039` section 4), so nothing needs storing between the two.
- **On a voice turn it is read back**, which is the case this matters most in: somebody who
  cannot see the screen has heard what is about to happen before it happens.

### 3.4 Two things it will not do

- **There is no "empty the list".** A call with no ids is not a call to delete everything; it
  is refused. A person who says "clear the list" gets an explanation and the name of the
  screen that does it, which is what plan `0039` section 12's last line already provides for
  everything absent from the catalog.
- **There is a cap per call**, small enough that a plausible misunderstanding cannot take a
  whole list with it, and large enough for the way people actually talk. A request naming
  more lines than the cap is refused with a sentence, not truncated: a partially executed
  deletion is the worst possible outcome, and section 3.5 says why the whole call is all or
  nothing anyway.

### 3.5 All or nothing

Plan `0040` section 6.1 settles this for the batch add and the same answer holds. The
service refuses the call if any id fails to resolve, before deleting anything. Per item
results would mean the model has to explain a partial outcome in prose, and a person who
asked for two things to be removed and had one removed has to work out which.

The gateway calls themselves are one `DELETE` per line, because that is the route that
exists. If one of them fails after another succeeded, the reply says exactly what happened,
naming the lines that went. **It never claims a rollback it did not perform.** A wrong
sentence about what is on the list is the one output plan `0039` calls the worst this
feature can produce.

## 4. `set_line_status`

The lighter of the two, and it needs almost none of the above.

| | |
| --- | --- |
| what it sets | `PENDING`, `READY`, `NOT_AVAILABLE` |
| what people say | "got the milk", "we have got the bread", "they had no eggs" |
| resolution | line ids from this turn's context, exactly as section 3.1 |
| confirmation | **none**. It is reversible, it is visible, and confirming a tick is nagging |
| batching | yes, and it is the common case |

`READY` and `NOT_AVAILABLE` are two different answers to the same question and the model must
not collapse them. "They did not have it" is not "we got it", and a shopper reading the list
afterwards needs the difference: one means the errand is done, the other means somebody has
to go somewhere else. This is a tool description problem rather than a code one, and the
description says it in those words.

### 4.1 Un-ticking is the same tool

`PENDING` is in the enum and reachable, because "no, put the bread back" happens as often as
ticking does and a one way tick is a trap.

### 4.2 Approval is not status, and stays out

`POST /v1/lines/:id/approval` is a different route with a different meaning: it settles
whether a line somebody proposed belongs on the list at all, and plan `0037` is a whole plan
about the server owning that decision. It stays absent from the catalog.

The reason is not that it is dangerous. It is that **approving is an answer to somebody
else's question**, and a bot that answers on your behalf, from a sentence you said while
holding a trolley, is deciding something social. Status is about the shop. Approval is about
the group. The assistant is on the first one's side of that line, and if that turns out to
be the wrong call it is one tool and one plan to add later.

## 5. References, and the line that is no longer there

Rule A3 says every response carries what the turn genuinely read or wrote, and the client
draws links from it.

`set_line_status` emits a `line` reference per line it touched, which is the ordinary case
and needs no discussion.

**`remove_lines` emits none for what it deleted.** A reference is a link, the link opens a
line, and that line is gone: the one guarantee rule A3 makes, that a reference cannot 404,
would be broken by the only tool that can break it. The deleted lines are named in the
reply's prose, where they belong, and the reference the turn carries is the **list** they
came off, which is the screen the person wants next.

## 6. What the turn record says

Plan `0039` section 10's structured record already carries the tools called and their
outcomes. Two additions worth naming now rather than discovering when the data is read:

- **A deletion is recorded with the number of lines and the list**, never with the line
  contents. The record exists to answer how the feature is used, and the text of a deleted
  shopping list line is not part of that question.
- **A refused call is recorded as a refusal**, separately from a failure. "The model tried to
  delete lines it had not read" and "the gateway said no" are different facts about the
  prompt, and the first one is the number to watch.

## 7. Configuration and CI

Nothing new. No secret, no environment variable, no values file entry, no NATS change. Two
tool definitions, two gateway calls the client already knows how to make, and the tool
catalog's length goes from three to five.

The OpenAPI document does not change, because no route changes. That is worth stating
because it is the check that would otherwise be run pointlessly.

## 8. Testing

Every test runs against `FakeModelProvider` (rule A4) and no test reaches a provider.

- A turn where the model calls `remove_lines` with an id that was never in context is
  refused, and no `DELETE` is issued.
- A turn where the model deletes without having confirmed first ends with a question and no
  `DELETE`.
- A confirmed deletion issues exactly the calls for the ids named, and the reply names the
  lines.
- A call with no ids, and a call over the cap, are both refused with a sentence.
- A partial failure across two deletes reports exactly which line went, and does not claim
  the other did.
- `set_line_status` sets each of the three values, batches, and needs no confirmation.
- A caller holding only `READ` gets the gateway's refusal surfaced in words, and the turn is
  a successful turn (plan `0039` section 7: a refusal is not retried).
- The reference rules: a status change emits line references, a deletion emits the list and
  no lines.

## 9. Acceptance

- "Take the olive oil off the weekly list" removes it, after asking, in two turns.
- "We have got the milk and the bread" ticks two lines in one call, without asking.
- "They had no eggs" marks one line `NOT_AVAILABLE` and not `READY`.
- A line the assistant was not shown is never deleted.
- "Clear the list" deletes nothing and names the screen that does.
- No reference in any reply points at a line that was just deleted.
- Approving and rejecting are still not callable, and neither is deleting anything larger
  than a line.
