# 0036: the server decides approval

> Prerequisite reading: `0035` (the permission set, and `DECIDE` in particular), and
> `0007` sections 1 and 2 (`ListLine`, its two independent state machines, and the line
> mutations).
>
> Companion plan: `velista/plans/0027` section 5, which removes the client-side
> approval this plan makes unnecessary.
>
> Depends on `0035`: every rule below is keyed on `DECIDE`, which does not exist yet.

## 1. Two things the client is deciding that it should not be

### 1.1 The approve button that flashes

`LineService.add` (`line.service.ts:79`) creates every line `PENDING/PENDING`,
unconditionally. When the person adding it is a group admin, the client draws the row,
sees `approvalStatus: PENDING` and `canDecide: true`, renders the two decision buttons,
and they are then either pressed or, worse, resolved by a second request the client
sends itself. Either way the person who just typed the line watches an approve button
appear on their own line for a moment.

Nothing about that is a rendering bug. The screen is drawing exactly what the server
told it. The server told it something silly: that a line added by somebody entitled to
approve lines is awaiting their approval.

### 1.2 The list that does not want approval at all

Approval suits a household where one person keeps the budget. It is pure friction for
one where four people share a list and all four are trusted, and today that household
has no way to turn it off. Their only options are to leave every line `PENDING`, which
makes the caption "waiting to be approved" appear under every row forever, or to make
everybody an admin of the whole group, which grants far more than they meant.

## 2. A line is created approved when nobody is waiting on anybody

`LineService.add` decides `approvalStatus` from two facts, in this order:

1. **The adder holds `DECIDE` on the list.** The line is created `APPROVED`, with
   `approvedByUserId` set to the adder. They are the person the approval was going to be
   asked of, and adding the line is them giving it. Group staff hold `DECIDE` on every
   list (`0035` section 2.4), so this is the rule that fixes 1.1.
2. **Otherwise, the list has `autoApproveLines` set.** The line is created `APPROVED`
   with `approvedByUserId` **null**. Nobody decided; the list is configured not to ask.
   A null approver is the honest record of that, and it is a nullable column already.
3. **Otherwise**, `PENDING`, as today.

`status` is `PENDING` in all three cases. The two state machines stay independent, which
is the whole reason `0007` separated them: whether the group agreed to buy a thing and
whether it is in the trolley are different questions, and auto-approving the first
answers nothing about the second.

### 2.1 Why the adder's own permission, and not just the list option

Because rule 1 is the one that fixes the observed defect and rule 2 would not. A group
that wants approval, and therefore leaves `autoApproveLines` off, still does not want
its admins approving their own lines in a second step. Rule 1 is not a shortcut around
approval; it is approval, performed by the only person it could have been asked of.

### 2.2 Why not have the client send `approvalStatus` on add

It is the shape the current defect invites, and it is wrong twice over. It would let a
client claim an approval it has no right to, which means the server has to check the
permission anyway, at which point the server already knows the answer and the field is
redundant. And it would put the auto-approve option in the client's hands, so two
clients on different versions would create differently approved lines on the same list.
The requirement says this belongs in the backend, and it is right.

## 3. `autoApproveLines`, a list configuration

`ShoppingList` gains `autoApproveLines boolean NOT NULL DEFAULT false`. It appears on
`ListView`, and `UpdateListRequest` may set it. Changing it is `MANAGE`
(`0035` section 4), which is what makes it list configuration rather than a preference.

Three things it deliberately does **not** do:

- **It does not act retroactively.** Turning it on leaves existing `PENDING` lines
  pending. They are somebody's outstanding question, and a settings toggle is not an
  answer to it. A `DECIDE` holder clears them in the queue that already exists.
- **It does not remove approval from the list.** A `DECIDE` holder may still reject an
  auto-approved line, and editing a rejected line still returns it to `PENDING`
  (`0035` section 4.2) rather than straight back to `APPROVED`. The option governs what
  a **new** line starts as, and nothing else. A rejection made on purpose is not undone
  by a setting or by an edit.
- **It is not a zone-wide setting.** One household can perfectly well run a
  no-questions-asked weekly shop and a budgeted list for the big monthly one, in the same
  group. Per-list is where the answer actually varies.

## 4. Reducing an approved line's quantity leaves the remainder behind

The requirement, restated as an invariant: **the quantity a list asked for is not lost
when a shopper comes back with less.**

Somebody in the aisle holding `DECIDE` finds one tin where the list says three. They set
the quantity to 1. That is the only field `DECIDE` may change on an approved line
(`0035` section 4), and it is deliberately not a plain edit, because on its own it
silently rewrites history: the list now says somebody asked for one tin, and the two
they did not get have vanished with no record that they were ever wanted.

So when `line.update` lowers the quantity of an `APPROVED` line, core writes **two** rows
in one transaction:

- the original line, with the new lower quantity, otherwise untouched, `version + 1`;
- a **new line immediately below it**, same `content` and same `itemId`, quantity equal
  to the difference, `approvalStatus: APPROVED`, `status: NOT_AVAILABLE`, `version: 1`.

### 4.1 Why the server and not the client

Stated in the requirement and worth keeping: the caller who performs this edit holds
`DECIDE` and, in the ordinary case, nothing else. `DECIDE` cannot create a line. So the
client physically cannot produce the second row, and a permission model that needed it
to would have to grant every shopper `WRITE` to make one feature work. The whole point
of separating `WRITE` from `DECIDE` survives only if this happens server side.

### 4.2 The rule is about the line, not about who edited it

Any quantity reduction on an `APPROVED` line splits, whoever made it, including a
`MANAGE` holder and including a group admin. Keying it on the actor instead would mean
the same edit to the same line produces different data depending on who is signed in,
which is not explainable in any user interface and not testable in any useful way.

The one case that argument costs us is a list admin correcting a typo, who wanted 1 and
typed 3. They get a spurious "2 not available" line. Their remedy is to delete it, which
`MANAGE` may do to any line (`0035` section 4.1). One extra tap for the rare case is the
right trade against a rule that cannot be stated in a sentence.

### 4.3 Where the new line goes

`ListLine.position` is `double precision` for exactly this. The remainder takes the
midpoint between the original's position and the next line's, or `position + 1` when the
original is last. No other row is renumbered, so nothing else in the list moves and no
concurrent reorder is invalidated.

### 4.4 The cases, spelled out

| Situation | What happens |
| --- | --- |
| `APPROVED`, 3 to 1, list does not auto-approve | Original becomes 1. A remainder of 2, `APPROVED`/`NOT_AVAILABLE`, is inserted below it. |
| `APPROVED`, 3 to 1, list auto-approves | Original becomes 1. **No remainder.** Section 4.5. |
| `APPROVED`, 1 to 3 | Original becomes 3. No remainder: nothing was lost. |
| `APPROVED`, 3 to 0 | Refused. Quantity has a floor of 1; "none of it was there" is `NOT_AVAILABLE` on the whole line, which is a control the same caller already has. |
| `APPROVED`, 5 to 3, then 3 to 1 | Two remainders, of 2 each. They are not merged: two trips found two shortfalls, and one row of 4 would say something that never happened. |
| `PENDING` or `REJECTED`, any quantity change | An ordinary `WRITE` edit. No remainder, because nothing was agreed to yet. |

`createdByUserId` on the remainder is the **original line's author**, not the shopper
who split it. The remainder is the unfilled part of that person's request, and
attributing it to the shopper would put a line nobody asked for under the shopper's
name. `approvedByUserId` is copied from the original for the same reason: it carries the
approval the original already had.

### 4.5 Why the option turns the split off

Required, and it follows from what the option means. A list that auto-approves has
decided that approval carries no information on it, and the remainder line exists
entirely to preserve an approved request. With nothing to preserve, the split would
leave a trail of `NOT_AVAILABLE` rows nobody asked for, on precisely the lists whose
owners chose the setting to reduce ceremony.

The behaviour is keyed on the list's current setting at the moment of the edit, not on
how the line was approved. One reading of the state, in one place, and no per-line
provenance flag to keep.

## 5. What goes out on the wire

The transaction commits, then two events, in this order:

1. `line.updated` with the original line at its new quantity,
2. `line.added` with the remainder.

That order matters to a client rendering optimistically. A client that saw the add first
would draw a list momentarily summing to more than was ever asked for. Updating first
means every frame the client can paint is arithmetically true.

Both go to the list room, as the existing `emit` already routes them, and both are
existing event types, so no client needs a new handler to stay correct. A client that
knows nothing about this plan gets a correct list; the frontend work in
`velista/plans/0027` is about explaining it, not about receiving it.

## 6. Contracts and tests

- `ListView.autoApproveLines: boolean` and `UpdateListRequest.autoApproveLines?: boolean`
  in `libs/luna-shopper/contracts`, plus the gateway's `UpdateListDto`.
- One migration adding the column with its default. It can be the same migration as
  `0035` section 3 if the two land together, and should be if they do: one deploy, one
  lock on `shopping_lists` and `list_access`.
- **Regenerate the OpenAPI document** and commit it (`CLAUDE.md`, Luna Shopper backend).
- The split wants its own spec file beside `list-create-sharing.spec.ts`. Every row of
  the table in 4.4 is a case, and the position of the remainder relative to the next
  line is a case on its own, because it is the part a naive implementation gets wrong by
  appending to the end.

## 7. What is deliberately not built

- **A link between the remainder and the line it came from.** A `splitFromLineId` column
  would let the UI say "2 of the 3 you asked for", and it is a column, an index, a
  contract field and a rendering rule for a sentence nobody has asked for. The two rows
  are adjacent and identical in content, which reads correctly without it.
- **Merging repeated remainders.** Section 4.4.
- **Auto-approve applied retroactively.** Section 3.
- **A per-line "approve on add" override.** The permission and the list setting between
  them cover every case anybody has described.

## 8. Acceptance

1. A group admin adds a line. It arrives `APPROVED`, attributed to them, and no decision
   button is ever drawn on it.
2. A member holding `{READ, WRITE}` adds a line to the same list. It arrives `PENDING`.
3. A `MANAGE` holder turns `autoApproveLines` on. The `WRITE` holder's next line arrives
   `APPROVED` with no approver. The lines already pending are still pending.
4. On a list that does not auto-approve, a `DECIDE` holder lowers an approved line from 3
   to 1. Two rows come back: the original at 1, and a new one directly below it at 2,
   approved and not available, attributed to the original author. Every client watching
   sees the update before the add.
5. The same edit on an auto-approving list produces one row and no remainder.
6. Lowering a `PENDING` line from 3 to 1 produces no remainder.
7. A `DECIDE` holder attempting to change an approved line's **content** is refused, and
   attempting to set a quantity of 0 is refused.
