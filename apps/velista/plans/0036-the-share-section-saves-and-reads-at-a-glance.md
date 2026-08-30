# 0036: the share section saves, and reads at a glance

> **Nobody can change who uses a list.** The section built by `0012` and switched on by
> `0030` refuses every save, and it refuses it for a reason that is entirely the client's:
> it sends back rows it never touched and is not allowed to send. That is section 2.
>
> The rest of the sheet is the other half of the report. It has two scrollbars fighting
> each other, its buttons scroll away below the fold, and "Who can use this list" is a wall
> of four checkboxes per member that has to be read in full to learn anything. Sections 4
> to 6 rebuild it: one scroll, a footer that stays put, and a row that says what somebody
> can do in one word before it offers to let you change it.
>
> Prerequisite reading: backend `0036` sections 5, 5.1 and 5.2, velista `0030` section 6,
> and backend plan `0042`, which fixes the server's half of section 2 and adds the state
> section 7 needs.

## 1. What is wrong, in four parts

1. **Saving access always fails.** Press Save under "Who can use this list" and the sheet
   shows an error. It has never worked for anybody whose group has an owner, which is every
   group.
2. **Two scrollbars.** The sheet scrolls, and the member list inside it scrolls separately
   at `32vh`. On a phone the inner one catches the thumb first, so the sheet feels stuck.
3. **The buttons are below the fold.** Save and Cancel are ordinary elements at the bottom
   of a scrolling panel, so with more than about four members the primary action of the
   sheet is off screen and has to be hunted for through a nested scroll.
4. **The member list cannot be skimmed.** Every member is four checkboxes, expanded, always.
   Twelve members is forty eight checkboxes and no summary, and the question people actually
   open this sheet with, who can do what here, has to be answered by reading all of them.

## 2. Why the save fails

`ListSettingsSheet` seeds `_access` from `GET /v1/lists/:id/access` and, on save, sends
`this._access()` back in full:

```ts
await this._listService.setListAccess(this.listId(), this._access());
```

That payload contains **every stored row**, including rows for the group's owner and
admins. Backend `0036` section 5 rule 2 rejects any entry naming a zone `OWNER` or `ADMIN`,
refused even when the caller is themselves staff, and the handler throws inside the
transaction on the first one it meets. So the whole save fails, and nothing is written.

The step everybody misses is why staff rows are in the table at all. Backend `0036` section
6 says the `GET` returns "stored rows only. Group staff are absent by construction", and
that sentence is not true of the data:

- `ListService.create` writes the creator's row with all four permissions. Create a group,
  and you are its `OWNER`; create a list in it, and there is now a stored access row for a
  staff membership.
- `shareWithZone` writes a `{READ, WRITE, DECIDE}` row for **every other approved member**,
  which includes every other admin in the group.

So the first list anybody makes has a staff row in its access table, the `GET` hands it to
the sheet, and the sheet hands it back to a `PUT` that refuses it. The report's guess, that
the sheet "also sends its own permissions", is exactly right in shape: the row that most
often trips rule 2 is the caller's own, because the caller is usually the owner who made
the list.

**This is a defect on both sides and both are fixed.** The server stops returning rows that
cannot be sent back (backend plan `0042`). The client stops sending rows it did not change,
which is section 3 and is worth doing on its own merits regardless.

## 3. Send what changed, and nothing else

`PUT /v1/lists/:id/access` replaces each named membership's set outright and leaves unnamed
memberships alone (backend `0036` section 5.2). **So a payload of only the rows somebody
edited is not an optimisation. It is the correct expression of the change**, and the
complete resend was always a larger claim than the sheet had any reason to make.

Three rules, and each one closes a different hole:

- **Only edited rows are sent.** `changeAccess` is the only thing that may put an entry into
  the payload. The set read at open is kept separately, as what the rows are drawn from and
  what an edit is compared against.
- **A row edited back to where it started is dropped.** Otherwise opening a row, ticking a
  box and unticking it sends an entry that says nothing, and against a staff row that
  nothing is a 403.
- **A fixed row can never be sent.** Group staff rows are drawn fully ticked and immovable
  (velista `0030` section 6), so no edit can originate from one. That is true today by
  construction; with the payload now built only from edits, it is true by the same
  construction rather than by luck.

An **empty set stays an entry**, exactly as the current code comments say: it is how access
is revoked, the server deletes the row for it, and dropping it would silently leave the
person as they were. An empty set is an edit like any other. What changes is only that an
untouched row is no longer an edit.

## 4. One scroll, and a footer that stays

The sheet's own panel already scrolls, with `max-block-size` and `overflow-y: auto`, and
that is the scroll to keep. `SheetShell` owns it and every other sheet in the app behaves
that way.

- **The `32vh` inner scroll on `.share` goes.** "Who can use this list" grows to whatever
  height it needs and the panel scrolls past it. A nested scroll inside a sheet that also
  scrolls has no good gesture on a phone: the thumb lands in one of them and the other one
  is unreachable without knowing which.
- **A footer, stuck to the bottom of the panel.** Save and Cancel move out of the flow into
  a footer that stays visible while the body scrolls, with the panel's own background behind
  it and a hairline border above so it does not float over content ambiguously.
- **The body between the title and the footer is what scrolls**, which is the one scroll
  region in the sheet. The safe area padding the panel already carries belongs to the footer
  once the footer is the bottom of the sheet.

Collapsing the rows (section 6) also removes most of the height that made this urgent. Both
are still worth doing: collapsed rows make it short, and the footer makes it right when
somebody expands four of them.

### 4.1 One Save, two requests

There are two Save buttons today, one for the name and one for access, and the footer has
room for one. **One Save, which commits whatever the sheet is holding**, and the split into
requests stays exactly as it is:

| Changed | Sent |
| --- | --- |
| the name only | `PATCH /v1/lists/:id` with `{ name }` |
| access only | `PUT /v1/lists/:id/access` with the edited rows |
| both | both, name first |
| neither | nothing, and Save is disabled |

**A changes object carrying only what its button owns** is the existing rule and it survives
untouched, for the reason the current code gives: the gateway validates with
`forbidNonWhitelisted`, and a body carrying every field would let a rename overwrite a
setting somebody else had just changed.

Two things stay where they are:

- **The auto approve switch keeps saving on the flip.** velista `0030` section 6.5 argues it
  is a rule about what happens to the next line anybody adds, not a preference somebody is
  proposing, and a switch that waits for a Save button reads as the second. It is the one
  control in the sheet that is not gathered by the footer, deliberately.
- **Delete stays in the body**, at the end, as a danger action with its own confirmation. It
  is not a save, and putting a destructive action into a footer beside Cancel is how
  somebody deletes a list they meant to close.

## 5. What a person can do, in one word

Four checkboxes say what a row *can be changed to*. They are a poor way to say what it *is*,
which is what somebody scanning the list wants. So each row gets a summary beside the name,
and the summary is the row when it is collapsed.

**The labels are `READ`, `WRITE`, `DECIDE` and `ADMIN`.** `ADMIN` is the label for the
`MANAGE` permission. The enum member is not renamed: backend `0036` section 2.3 argues at
length that the stored name is `MANAGE` because `ADMIN` collides with the zone role of the
same name, and that argument holds for the wire and the database. It does not hold for a
label in a sheet, where the person reading has one list in front of them and "list admin" is
what the app already calls this in its own copy.

The rule, which is the requirement's rule:

| Effective set | Shown |
| --- | --- |
| holds `MANAGE` | `ADMIN`, alone |
| holds `WRITE` and `DECIDE` | `WRITE` and `DECIDE`, both |
| holds `WRITE` only | `WRITE` |
| holds `DECIDE` only | `DECIDE` |
| holds `READ` only | `READ` |
| empty | no access, in words rather than as a badge |

**`WRITE` and `DECIDE` together are the only pair that is ever shown**, because they are the
only two that are genuinely independent: the person who puts olive oil on the list on
Tuesday and the person who decides in the aisle on Saturday are two people, and neither is a
subset of the other. Everything else collapses to the highest thing held, because everything
else implies what is below it. `READ` is not shown beside `WRITE`, because the server adds
`READ` to any non empty set and a badge every row carries says nothing about any row.

`MANAGE` shows alone for the same reason and one more: the server expands `MANAGE` to
`{READ, WRITE, DECIDE, MANAGE}` on the way in, so a list admin holds all four and drawing
all four would make every admin row the noisiest thing on screen while saying the least.

**Group staff rows read `ADMIN` too**, and keep the sentence they already carry about group
admins having full access to every list. Their four permissions are derived rather than
stored, and the summary is about what somebody can do, not about where it came from.

This is a pure function of the permission set, so it lives beside the other selectors as a
tested function rather than inside the component, and `ShareRowVm` gains the summary as a
field the container computes.

## 6. Rows are closed until somebody opens one

Every row is collapsed on load. The row shows the name, the creator label if it applies, and
the summary from section 5. Pressing the name toggles the four checkboxes open, and pressing
it again closes them.

- **The whole header is the control**, not a chevron beside it. The target is then the full
  width of the row, which is what a thumb needs, and the chevron becomes what it should be,
  a state indicator rather than a hit area.
- **It is a `button` with `aria-expanded`**, and the checkboxes it controls are the region it
  names. This is a disclosure, and the platform has a shape for a disclosure.
- **Nothing is open on load, including rows that were edited in this session.** An edited row
  is marked in its summary rather than left open, so the sheet does not grow as somebody
  works through it and Save does not walk away from the thumb.
- **Collapsing a row never discards its edit.** The edit lives in the sheet, not in the row
  component, which is already true: `changed` emits the whole set for the membership and the
  sheet holds it.

The count and the search that a group of forty would need are not built. Groups in this
product are households, `0010` sizes the member list for that, and a filter over eight rows
is a control looking for a problem. If a real group turns up that needs one, it is a small
addition to a row list that is by then short enough to see.

## 7. Making a list shared after it was created

The third part of the report is that a list marked public should be visible to somebody who
joins the group later, and today it is not, for a reason no screen can fix: **`shareWithZone`
is an action taken once at creation, not a property of the list.** It grants
`{READ, WRITE, DECIDE}` to every member approved at that instant and is then over. A member
approved a minute later gets nothing, and there is no state anywhere that says the list was
meant to be open to the group.

Backend plan `0042` makes it state: a list carries whether it is shared with its zone, and
an approved member gets access to the zone's shared lists when they are approved. This sheet
is where that state is read and changed after creation.

- A control in the settings body, above "Who can use this list", in the same shape as the
  auto approve switch and saved on the flip for the same reason: it decides what happens to
  the next person who joins, and there is nothing to preview.
- Its copy says what it does to people, not what it does to rows: everybody in this group can
  use this list, including people who join later.
- **Turning it off does not revoke anybody.** It stops new members being granted, and the
  rows that exist stay exactly as they are, which is what the individual rows below are for.
  The hint under the control says so, because the opposite reading is the natural one and it
  is the reading that loses somebody their access.

The create sheet's existing toggle is unchanged and now sets a value that persists rather
than performing a one time grant.

## 8. What is tested

- **The payload**, which is the defect: open the sheet against an access set that includes a
  staff row, change one ordinary row, save, and assert the request body contains exactly one
  entry and no staff membership. This test fails today.
- **A row edited and put back** sends nothing, and Save is disabled when nothing is pending.
- **An empty set is still sent** for a row somebody cleared.
- **The summary function**, as a table test over the six cases in section 5, including the
  pair and the `MANAGE` collapse.
- **The disclosure**: rows are collapsed on first render, the header toggles `aria-expanded`,
  and an edit survives a collapse and reopen.
- **The footer** is present with the body scrolled, which is a DOM assertion about where the
  buttons live rather than a visual one.
- The sheet's existing specs stay green: none of this changes what the sheet does, only what
  it sends and how it is laid out.

## 9. Exit criteria

- A group owner can change another member's permissions and save, and the change survives a
  reopen.
- The request contains only the rows the person edited.
- The sheet has exactly one scroll region, and Save and Cancel are on screen at every scroll
  position and at every member count.
- A member's permissions can be read without opening their row, and every row is closed when
  the sheet opens.
- A list can be marked shared with the group after it was created, and the control says what
  turning it off does and does not do.
- Deleting is still a separate, confirmed action and is not reachable from the footer.
