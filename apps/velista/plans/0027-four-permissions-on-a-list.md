# 0027: four permissions on a list

> Prerequisite reading: `0012` (the list page, its state union, and section 5.5 on why
> the share sheet is built and not offered), `0020` (rule G2, and the sentence in section
> 1 this plan quotes), and `0010` section 5.4 (how a member row decides its own menu).
>
> Companion plans: `luna-shopper-backend/plans/0035`, which replaces the two list roles
> with a set of four permissions and finally tells the client which of them the caller
> holds, and `0036`, which moves approval into the server.
>
> Depends on both. Nothing here can be built against today's API.

## 1. Goal

`0020` wrote the rule this plan is an application of:

> A role is a permission. If the server changes it, the screen showing what it permits
> changes with it, without being asked. A control left on screen for somebody who may no
> longer press it is not a cosmetic problem: every press of it is an error.

`0020` applied it to the group screens, where `myRole` had always been on the wire. The
list page has never had the equivalent, and `ListAbilitiesVm` says so in its own doc
comment: `canWrite` is **optimistic**, because `ListView` carried no permission and
there was no `GET /v1/lists/:id/access`. So the page offers the composer to everybody
and learns the truth from a refused write.

`0035` puts the answer on the wire. This plan spends it, in four places:

- the abilities stop being a guess (section 3),
- the row menus, the tick gesture and the decision buttons follow four permissions
  instead of two booleans (section 4),
- the share sheet, already written and switched off, is switched on and grows the
  permissions it can now express (section 6),
- the approve button stops flashing on the adder's own line (section 5).

## 2. What arrives, and what leaves

`ListView` gains `myPermissions` and `autoApproveLines`. `ListRole` and its two members
leave `velista/models`, replaced by:

```ts
export const LIST_PERMISSIONS = ['READ', 'WRITE', 'DECIDE', 'MANAGE'] as const;
export type ListPermission = (typeof LIST_PERMISSIONS)[number];
```

Rule D4 applies as it always does: the wire is `unknown` and the mapper owns the enum. An
unrecognised permission string is **dropped**, not defaulted. `LIST_ROLE_FALLBACK` had a
sensible fallback because a role is a single value and something had to be picked;
a set has a strictly correct answer to an unknown member, which is to ignore it and keep
the ones it understood. Dropping is also the safe direction: a client that does not
understand a permission does not draw the control for it, and the server refuses what
the client would have sent anyway.

A `myPermissions` that is absent or unreadable maps to the **empty set**, and the empty
set is read-only. That inverts today's optimism deliberately, and section 3.2 argues it.

## 3. `ListAbilitiesVm`, rebuilt

The type keeps its name and its shape as derived booleans, because every component
downstream already renders from those and none of them should learn what a permission
is. What changes is where the booleans come from and how many there are:

```ts
export interface ListAbilitiesVm {
  /** Add a line, edit or delete an unapproved one, reorder. `WRITE`. */
  readonly canWrite: boolean;
  /** Tick off, mark unavailable, approve, reject, change an approved quantity. `DECIDE`. */
  readonly canDecide: boolean;
  /** Comment. `WRITE` or `DECIDE`; a read-only caller may not. */
  readonly canComment: boolean;
  /** Rename, configure, share and delete the list. `MANAGE`. */
  readonly canManage: boolean;
  /** Nothing but `READ`. Drives the one banner that explains the state. */
  readonly readOnly: boolean;
}
```

`knownReader` is **deleted**, along with the machinery behind it: the
`_knownReader` signal on `ListPage`, the branch in `_applyEffect` that sets it from a
refused write, and the doc comments in `select-list-state.ts` explaining the optimism.
There is nothing left to infer, and an inference kept alongside a fact is a second
answer that will eventually disagree with the first.

`selectAbilities` becomes four membership tests on a set and stops taking
`caller.isStaff` at all: staff hold all four permissions on every list in the zone
(`0035` section 2.4), so the server sends them `['READ','WRITE','DECIDE','MANAGE']` and
the client has nothing left to special-case. That deletes the last place on this screen
where the client re-derived an authorization rule the server already applied, which is
the same cleanup `0020` did for the group page.

### 3.1 `canComment` is new and is a real restriction

Commenting used to require only an approved membership on the zone, so it was the one
thing `0012` could confidently offer a reader (`actionsFor` returns exactly
`['comments']` for a non-writer). After `0035` a read-only caller may **read** comments
and may not write one. The comments sheet therefore opens for everybody with `READ` and
draws its composer only for `canComment`, with the read-only note in its place.

This is worth flagging as a **visible removal** for existing users: somebody who has
`READER` on a list today can comment on it and will not be able to afterwards. The
migration's backfill (`0035` section 3.1) keeps it rare, since today's `WRITER` becomes
`{READ, WRITE, DECIDE}` and keeps commenting.

### 3.2 Empty means read-only, and the composer is drawn from certainty now

`0012` argued for optimism and was right at the time: hiding the composer from everybody
unproven would have taken the screen away from the people who use it, to spare a rare
reader one refused request. That argument had one premise, that the client cannot know.
The premise is gone.

Optimism now costs more than it did, too. With two roles there was one control to be
wrong about. With four permissions there are the composer, the tick gesture, the two
decision buttons, the restore action, the edit and delete entries in every row menu, the
comment composer, and the settings sheet. Guessing all of that and correcting it from
refusals would be a screen that rearranges itself as the user works.

So: no permissions means read-only, and the page says so in one banner rather than by
having each control fail in turn.

## 4. What a row offers, per permission

`toRow` and `actionsFor` (`select-list-state.ts`) take the new abilities. An empty action
list still means **no overflow button at all**, never a disabled one, exactly as
`MemberRowVm.actions` decided it: a disabled control says "you could do this, later"
about something that will never be permitted.

| | read only | `WRITE` | `DECIDE` | `WRITE` + `DECIDE` |
| --- | --- | --- | --- | --- |
| Tap a row to tick it off | no | no | yes | yes |
| Add a line (the composer) | no | yes | no | yes |
| Reorder | no | yes | no | yes |
| Edit / delete a `PENDING` or `REJECTED` line | no | yes | no | yes |
| Edit an `APPROVED` line | no | no | quantity only | quantity only |
| Approve, reject, restore | no | no | yes | yes |
| Mark not available / back to pending | no | no | yes | yes |
| Comment | read only | yes | yes | yes |
| Open the settings sheet | no | no | no | `MANAGE` only |

Three consequences worth stating because they are not obvious from the table:

- **`interactive` splits from `canWrite`.** Today a row is tappable when the caller can
  write, because writing and ticking were the same permission. Ticking is `DECIDE` now,
  so `interactive` follows `canDecide`. A `WRITE`-only caller has a full composer and
  rows that do not respond to a tap, which is correct and needs the caption to say so
  rather than reading as a broken screen (section 7).
- **`decidable` and `restorable` stop meaning "staff".** They mean `canDecide`, and their
  doc comments, which currently say "True only for staff", change with them.
- **The edit sheet has two modes.** For `WRITE` on an unapproved line it is what it is
  today. For `DECIDE` on an approved line it shows the content read-only and offers only
  the quantity stepper. Two modes of one sheet rather than a second sheet, because they
  are the same gesture from the same row and the difference is which fields are live.

### 4.1 The edit sheet warns before it splits

When the quantity stepper on an approved line is taken **below** its current value, and
the list does not auto-approve, the sheet says what the server is about to do, in the
sheet, before the save: something to the effect that the 2 that are not coming home stay
on the list marked as not available. `0036` creates that row whether or not the sheet
mentions it, and a row appearing out of nowhere under the one you just edited is
confusing exactly once per user, which is once too many for a sentence this cheap.

On an auto-approving list the sentence is absent, because the split is (`0036`
section 4.5).

## 5. The approve button stops flashing

`0036` creates a line `APPROVED` when its author holds `DECIDE`. So the row that used to
arrive `PENDING` and immediately grow two decision buttons now arrives approved, and the
frontend work is subtraction:

- The **optimistic add** must construct its placeholder row with the approval the server
  is going to give it, not with `PENDING`. It can, and from a fact it already holds:
  `canDecide` plus `autoApproveLines`, the same two inputs `0036` section 2 uses. Getting
  this wrong is the whole defect, one frame narrower.
- Any client-side approve-after-add is removed outright.

`autoApproveLines` reaching the client matters for this reason alone, which is why it
rides on `ListView` rather than being a server-only setting.

## 6. The share sheet, switched on

`LIST_ACCESS_READABLE` (`list-service.ts:102`) becomes `true`, and the section it hides
becomes reachable. `0012` section 5.5 called flipping it "the whole of the remaining
work"; with four permissions instead of three role choices, it is that plus the three
rules below.

### 6.1 Four checkboxes, not a segmented control

`ShareRowVm.role: ListRole | null` becomes
`ShareRowVm.permissions: readonly ListPermission[]`, and the row draws a checkbox per
grantable permission. A segmented control was right for three mutually exclusive states
and cannot express a set where `WRITE` and `DECIDE` are independent.

**`MANAGE` is not offered.** The list's creator holds it from creation, and group admins
hold it always; nobody else can be given it from this sheet. That is the requirement's
own reading, and it keeps the sheet to three checkboxes and one legible question. The
wire accepts `MANAGE` (`0035` section 5), so offering it later is one checkbox and one
label, not a redesign.

### 6.2 Ticking anything ticks read

Required, and it matches the server, which adds `READ` to any non-empty set it is given
(`0035` section 2.2). The client does it **in the checkbox handler**, so the person sees
Can view tick itself the moment they tick Can add, rather than seeing it appear after a
save. Unticking the last of the others leaves Can view ticked; unticking Can view itself
clears the row to no access, because that is the only thing "cannot view" can mean.

Doing it client-side as well as server-side is not duplication of the rule, it is
duplication of the **feedback**. The server enforces; the sheet explains.

### 6.3 Group admins are rows that cannot be changed

`ShareRowVm` already has `fixed` and `fixedReasonKey`, and the sheet already builds staff
rows with `list.settings.access.staffNote`. That survives with its meaning corrected: the
note used to say staff can always open the list, and now says group admins always have
full access to every list in the group and it cannot be changed here.

Shown and fixed rather than hidden. A hidden row invites the question "why can Marc still
edit this?", and the sheet is the only place that answers it. The checkboxes render all
ticked and non-interactive, with the sentence underneath, which is the same shape
`0010`'s member rows use for an action that will never be permitted.

The list creator's row is **no longer fixed**. `0035` section 2.5 makes their power an
ordinary `list_access` row, so a group admin can change it. `fixedReasonKey`'s
`list.settings.access.creator` case goes with it, and the creator instead gets a plain
"Created this list" label beside their name so the row still reads as theirs.

Whether the sheet lets a non-staff list admin *attempt* a change to a staff row: no. The
row is fixed for everybody, because for everybody the answer is the same and the server
refuses it identically (`0035` section 5, rule 2).

### 6.4 The auto-approve toggle lives here too

`autoApproveLines` is a switch in the settings sheet, above the share section, with a
line of copy saying that new lines will not need approving and that the ones already
waiting are unaffected (`0036` section 3). `MANAGE` only, which the sheet already is.

## 7. Copy

New or rewritten keys, all under the existing `list.` namespace:

- The read-only banner, replacing the one section 5.7 of `0012` wrote for a caller
  discovered to be a reader. Same sentence, drawn from certainty instead of from a
  refusal, and drawn on arrival rather than after a failed write.
- A caption for the `WRITE`-only caller whose rows do not respond to a tap. Without it,
  a screen that lets you add a line and ignores your tap on it reads as broken. Something
  that names who does the ticking, not an apology.
- The comments sheet's read-only note, in place of its composer (section 3.1).
- The quantity-reduction warning in the edit sheet (section 4.1).
- The three checkbox labels and the corrected staff note (section 6).
- The auto-approve switch and its explanation (section 6.4).

Both locales, as always, and the keys belong to `models-localization` beside the ones
they sit with.

## 8. When permissions change while the page is open

`0035` section 8 adds `list.myAccessChanged` on the user channel, carrying the caller's
new effective set for one list. `RealtimeEventMapper` maps it, `ListStore` applies it to
the held `ListView`, and three behaviours fall out with no further work:

- a set that **shrank** redraws the page from `selectAbilities`, so a control the caller
  may no longer press is gone before they press it, which is rule G2 for this screen;
- a set that became **empty** is the existing `gone: 'unshared'` state, which
  `list-page.ts` already reaches from a refused read;
- a set that **grew**, including from nothing, is the case the room event could never
  deliver, because somebody with no access was never in the room.

`list.accessChanged` keeps doing what it does today: `ListStore` refetches the zone's
lists on it (`list-store.ts:197`), which is right for everybody else in the room.

## 9. The mock backend

`ListMemory` holds `_access` as `ListAccessEntry[]` per list and `SEED_LIST_ACCESS`
seeds it. Both take permission sets, and `ListMemory` must now actually **enforce** them
rather than only storing them: `getListAccess` was written against an endpoint that did
not exist and nothing in the mock has ever refused a write.

That is more work than a type change and it is the point of having the mock. The four
permissions are exactly the thing that is tedious to reach against a real backend (it
needs four accounts, a group, and a share sheet), and the states worth exercising, a
`WRITE`-only caller and a `DECIDE`-only caller, are the two nothing has ever rendered.
Seed the mock world with one of each.

## 10. What is deliberately not built

- **Per-list permission badges on the dashboard or the group page.** `myPermissions`
  arrives on every `ListView` in the page, so it is available, and a "read only" chip on a
  card answers a question nobody asks until they open the list.
- **A request-access flow.** Somebody with no access does not see the list at all, so
  there is nowhere to put the button.
- **Explaining the split in the timeline.** `0036` section 7 declined the column that
  would make it possible; the adjacent row plus the warning in 4.1 is the whole story
  this screen tells.
- **Offering `MANAGE` from the share sheet.** Section 6.1.

## 11. Acceptance

1. A caller with no permissions opens a list by its URL. They see every line, both
   statuses, every comment, the counts and who else is viewing. There is no composer, no
   tick, no overflow on any row, no comment composer, and one banner saying why.
2. A `WRITE`-only caller adds a line, edits a pending one, deletes a rejected one and
   comments. Tapping a row does nothing and the screen says who does that. No decision
   buttons appear anywhere.
3. A `DECIDE`-only caller ticks lines off, approves, rejects, restores, marks one not
   available and comments. There is no composer and no edit entry on an unapproved row.
   The edit sheet on an approved row offers the quantity and nothing else.
4. That caller lowers an approved quantity from 3 to 1, having been told what will
   happen, and the remainder appears directly below with no refresh and no reorder.
5. A group admin who was never granted anything on the list has every control on the
   screen, including the settings sheet.
6. A group admin adds a line and no approve button is ever drawn on it, on any frame.
7. In the share sheet, ticking Can add ticks Can view. Group admin rows are drawn, fully
   ticked, unchangeable, with the reason. The creator's row is changeable by a group
   admin.
8. Turning on auto-approve leaves the lines already waiting waiting, and the next line
   anybody adds arrives approved.
9. Revoking a member's access while they have the list open moves them off it. Granting
   access to somebody who had none makes the list appear for them without a refresh.
