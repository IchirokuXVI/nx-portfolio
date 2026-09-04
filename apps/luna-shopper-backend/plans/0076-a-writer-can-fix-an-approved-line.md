> **PR:** [#188](https://github.com/IchirokuXVI/nx-portfolio/pull/188)

# 0076: a writer can fix an approved line

> Client half: `apps/velista/plans/0066`, which opens the sheet this plan makes reachable
> and warns about what the save will do.
>
> Prerequisite reading: `0036` section 4.1, which wrote the rule this plan revises, and
> section 4.2, which built the rejected to pending reset that this generalises. `0040`
> section 3.4 matters too, because the quantity delta shares `authorizeEdit` with the
> edit and must come out of this unchanged.

`WRITE` may edit a `PENDING` or `REJECTED` line and never an `APPROVED` one. The
sentence reads well and was written for a good reason, and in the product it lands on a
person who typed "Mile" and cannot fix it. Two ordinary configurations make it certain:
a list with `autoApproveLines` set approves every line at creation, and a member holding
`DECIDE` has theirs approved at creation too, so the line is `APPROVED` before its
author has read it back. The author then holds `WRITE`, the line holds a typo, and the
only way through is to find somebody with `MANAGE`.

This plan lets a writer edit an approved line, and makes the edit say so by putting the
line back in front of whoever approves.

## 1. What changes

| Caller                            | Today, on an `APPROVED` line | After                                                    |
| --------------------------------- | ---------------------------- | -------------------------------------------------------- |
| `MANAGE`                          | every field                  | every field, unchanged, and no reversion                 |
| `DECIDE` alone                    | quantity alone               | quantity alone, unchanged, and no reversion              |
| `WRITE` and `DECIDE`              | quantity alone               | every field, and no reversion                            |
| `WRITE` alone                     | nothing                      | every field except quantity, and it returns to `PENDING` |
| `WRITE` alone, list auto approves | nothing                      | every field except quantity, and no reversion            |
| `READ`                            | nothing                      | nothing                                                  |

`PENDING` and `REJECTED` lines are not touched by any of this. Nor is creation, nor
approval, nor deletion.

## 2. The rule, stated once

**An edit to an approved line returns it to `PENDING` and clears its approver, unless
the caller holds `DECIDE` or `MANAGE`, or the list has `autoApproveLines` set.**

It is one sentence and it generalises `0036` section 4.2 rather than sitting beside it.
That section already says an edit to a `REJECTED` line reopens it, for the reason that a
rejection should be a conversation rather than a dead end. An approval is the other side
of the same conversation, and an edit after it is the same act: somebody changed what
the group was asked to agree to, so the group is asked again.

### 2.1 Why `DECIDE` is exempt

Because the reversion would be ceremony. A `DECIDE` holder can reach the same end state
today in three requests, un-approve then edit then approve, and section 4.1 says so in
as many words. Sending them through a `PENDING` state they are about to leave adds two
requests, two events and a row that flickers into "awaiting approval" on every open list
in the household.

This is the half of the current rule that is deleted rather than kept: the branch
refusing a `DECIDE` holder any field but the quantity goes, along with the sentence
saying that holding `WRITE` and `DECIDE` together does not add up to editing an approved
line. It does now, and it adds up through `DECIDE` alone.

> **Correction, after the fact.** That last sentence, and the `DECIDE` row of section 1's
> table, read as though `DECIDE` on its own were enough to edit an approved line's
> content. Section 4.1 says the opposite in the same document: the quantity needs `DECIDE`
> or `MANAGE`, and **everything else needs `WRITE`**. Section 4.1 is right and this
> paragraph is loose, for two reasons. The exemption's own argument is that such a caller
> reaches the same end state by un-approving, editing and approving again, which needs the
> `WRITE` that makes the edit possible at all, so for a caller without it there is no end
> state and no ceremony to save. And `DECIDE` alone reaching an approved line's content
> would leave that caller able to edit the more protected state and not the less protected
> one, since a `PENDING` line's content is a writer's field and always was. Read every
> mention of `DECIDE` in this plan as `WRITE` held together with `DECIDE`, except in
> section 3, where a `DECIDE` holder reaches an approved line's quantity on their own and
> plan 0040's delta path depends on it.

### 2.2 Why `MANAGE` is exempt

Because `MANAGE` exists for exactly this. The current comment says a governed thing
needs somebody who can fix a line that was approved with a typo in it, and a fix that
un-approves the line is not a fix. `MANAGE` does not grant approval, so a `MANAGE` holder
who does not also hold `DECIDE` would put the line into a state they cannot get it out
of.

**This is the one place the plan goes past what was asked for**, and it is a one line
condition either way. The argument for reverting instead is that a list admin changing
"Milk" to "Oat milk" has changed what the group agreed to as surely as a writer has. If
that reading is preferred, drop `MANAGE` from the exemption and nothing else in this plan
moves.

### 2.3 Why `autoApproveLines` is exempt

Because the reversion would strand the line. `autoApproveLines` decides what a **new**
line starts as, at creation, in `LineService.add`. Nothing re-reads it afterwards, so a
line put back to `PENDING` on such a list stays `PENDING` until a person approves it, on
a list whose whole configuration says nobody is expected to be watching for that. The
list would slowly fill with lines awaiting an approval that its owner switched off.

Note the asymmetry with the rejected to pending reset, which fires **even** on an auto
approving list. That is deliberate in both directions and the two are not in conflict: a
rejection is a decision somebody made on purpose, and an edit does not undo it. An
approval on an auto approving list is not a decision anybody made.

## 3. Quantity is not part of this

**Who may change an approved line's quantity does not change, and a quantity change never
reverts anything.** `DECIDE` and `MANAGE`, exactly as today.

Two reasons, and the first is the sharper one:

- **The delta path shares this code.** `addQuantity` reaches the same `authorizeEdit` and
  the same reset (`0040` section 3.4), and it is what velista's quantity reel writes, one
  request per unit the thumb passes over. A reversion on that path would un-approve a line
  several times while a finger is still moving.
- **Quantity is not what was agreed to.** `0043` made it how many the household wants
  right now, and settling decrements it, so it moves without anybody deciding anything.
  Content and the product set are the agreement.

That leaves a writer who can rewrite an approved line's content but cannot add one unit
to it, which is odd read aloud and correct in practice. It also resolves itself: the
content edit returns the line to `PENDING`, and a `PENDING` line's quantity is a writer's
to change.

## 4. The code

Two changes in `apps/luna-shopper-backend/core/src/app/lists/line.service.ts`, and
nothing outside it.

### 4.1 `authorizeEdit` stops refusing the writer

The `APPROVED` branch currently refuses a caller without `DECIDE` outright, then refuses
a `DECIDE` holder any field but the quantity. Both refusals go. What replaces them is one
check, in the same place: a request naming `quantity` or reaching through the delta path
needs `DECIDE` or `MANAGE` on an approved line, and everything else needs `WRITE`.

The `MANAGE` early return at the top stays exactly where it is.

### 4.2 `reopenIfRejected` becomes `reopenAfterEdit`

It takes the list and the caller's permissions alongside the line, and it holds both
transitions:

- `REJECTED` to `PENDING`, on any edit, unconditionally, as today.
- `APPROVED` to `PENDING`, when the caller holds neither `DECIDE` nor `MANAGE` and the
  list does not auto approve.

Both clear `approvedByUserId`. A `PENDING` line stays `PENDING`.

One function and not two, because it is one question asked at one moment, and because
its two callers (`update` and `addQuantity`) must not be able to answer it differently.
`addQuantity` passes the same arguments and, by section 3, never satisfies the second
condition: it is authorized only for a caller holding `DECIDE` or `MANAGE`, who is
exempt. That is worth a test rather than a comment.

### 4.3 The doc comment on `update`

Its "three different answers about who may touch a line" section is now wrong in two of
its three bullets, and the paragraph about un-approve, edit, approve describes a path
nobody needs any more. Rewrite it against this plan rather than patching the bullets.

## 5. What does not change

- **No new event.** The reversion rides the `LineUpdated` this edit already emits,
  carrying the new `approvalStatus` like any other field. Velista's store replaces the
  whole line on it.
- **No new error code.** A refusal is still `ForbiddenException`, and the one refusal
  left on this path is the quantity one, whose message says which field it is about.
- **No migration.** No column, no enum value, no default.
- **No change to `setApproval`**, to `add`, or to the `autoApproveLines` option itself.

## 6. The OpenAPI document

`PATCH /v1/generated-lists/:id/lines/:lineId` and the list line update route are
unchanged in shape, so the document may well not move. Regenerate it anyway and commit
whatever comes out, because the response schema carries `approvalStatus` and the
contract's own descriptions are generated from these doc comments:

```sh
npx nx run luna-shopper-backend-gateway:openapi
```

## 7. Tests

In `line.service.spec.ts`, or the file beside it that already covers `0036` section 4:

1. A `WRITE` only caller edits an approved line's content: it saves, and the line comes
   back `PENDING` with `approvedByUserId` null.
2. The same edit on a list with `autoApproveLines` set: it saves and the line stays
   `APPROVED` with its approver intact.
3. A `DECIDE` holder edits an approved line's content: it saves, stays `APPROVED`, and
   keeps its approver.
4. A `MANAGE` only caller edits an approved line's content: it saves and stays
   `APPROVED`.
5. A `WRITE` only caller changing an approved line's quantity is refused, and the message
   names the quantity rather than the line.
6. `addQuantity` on an approved line by a `DECIDE` holder leaves it `APPROVED`, which is
   the delta path proving it did not pick up the new transition.
7. A `READ` only caller is still refused every field.
8. A `REJECTED` line still reopens on a quantity only edit, on a delta, and on an auto
   approving list, which is `0036` section 4.2 unchanged and the regression this plan is
   most likely to cause.
9. The version is bumped exactly once on an edit that also reverts.

## 8. Out of scope

- **Letting a writer change an approved line's quantity**, per section 3.
- **Re-reading `autoApproveLines` at approval time**, which would make section 2.3's
  exemption unnecessary and is a change to what the option means.
- **Telling anybody that an edit un-approved a line.** The row draws its own "awaiting
  approval" caption already, which is the whole of the explanation offered. Velista
  `0066` warns the person doing it, before the save, and that is the only announcement.
- **A history of edits.** `0075` is where that conversation lives.
- **Deletion, approval and creation**, all unchanged.
