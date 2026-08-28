# 0020: a role, and everything it decides

> Prerequisite reading: `0010` (the group page, rules G2 and G3) and `0018` section 2
> (the audit rule this plan reuses).
>
> Companion plan: `luna-shopper-backend/plans/0029`, which withholds the join code from
> a caller who may not use it and emits the two role changes an ownership transfer
> currently swallows. Section 6 says which half is which and what order they land in.
>
> Verified against the source on 2026-08-28.

## 1. Goal

Rule G2 says a control on the group screens exists because of `myRole` and never because
of a count. This plan takes the rule at its word in the two places it is not honoured:

- **`myRole` is wrong after an ownership transfer**, on both people's screens, because
  the two role changes it makes are never published. Every control the old owner sees
  afterwards fails against a role they no longer hold.
- **Two things `myRole` decides are not decided by it at all**: the join code is drawn
  for everybody, and being an admin is drawn identically to being a member on the
  dashboard.

Stated as the rule `0018` wrote for events, extended to what an event is for:

> A role is a permission. If the server changes it, the screen showing what it permits
> changes with it, without being asked. A control left on screen for somebody who may no
> longer press it is not a cosmetic problem: every press of it is an error.

## 2. An ownership transfer publishes nothing about either role

### 2.1 What the server does

`ZoneService.transferOwnership` (`core/src/app/zones/zone.service.ts:262`) runs one
transaction that:

1. sets the outgoing owner's membership to `ADMIN`,
2. sets the target's membership to `OWNER` and `APPROVED`,
3. sets `zone.ownerUserId`,
4. emits `RealtimeEvent.ZoneOwnershipChanged` with the `ZoneView`.

**Two memberships changed role and no membership event was published.**
`ZoneService.claimOwnership` (`:290`) has the same shape: an admin becomes owner, and
only `zone.ownershipChanged` goes out.

### 2.2 What every client then believes

`ZoneStore._apply` handles `zone.ownershipChanged` in the same branch as `zone.updated`,
patching `name`, `joinCode`, `status` and `ownerUserId` (`zones/zone-store.ts:586`). It
does not touch `myRole`, because for `zone.updated` there is nothing to touch. So:

- **The new owner is never told.** Their chip still says Admin, the owner-only actions
  (transfer, delete) never appear, and `_syncRooms` is never re-run for them.
- **The old owner is never told either, and this is the damaging half.** They still hold
  `myRole: 'OWNER'`, so the group settings sheet still offers Delete group and the member
  action sheet still offers Transfer ownership. Both call an endpoint that answers
  `requireRole(..., [OWNER])` with a forbidden. The screen invites an action and the
  server refuses it, which is the exact failure rule G2 exists to prevent.
- `MembershipStore` (`0018`) never sees either change, so the members screen shows both
  people's old roles, and `memberActionsFor` builds every row's menu from a `myRole` that
  is wrong.

### 2.3 The fix has a server half and a client half, and both are wanted

**Server (backend `0029`).** The transaction emits `member.roleChanged` for the outgoing
owner and for the target, alongside `zone.ownershipChanged`. That is the honest fix: two
memberships changed, so two membership events exist. It also repairs the members screen
and the staff-room resync for free, because both already listen for that event.

**Client (this plan).** `ZoneStore` additionally derives `myRole` from `ownerUserId` on
`zone.ownershipChanged`:

- `event.zone.ownerUserId === session.userId()` → `myRole` becomes `OWNER`.
- the caller held `OWNER` and the new `ownerUserId` is somebody else → `myRole` becomes
  `ADMIN`, which is what the server just wrote and is not a guess: `transferOwnership`
  demotes the outgoing owner to `ADMIN` unconditionally.
- otherwise → unchanged.

Then `_syncRooms()`, for the reason the `member.roleChanged` branch already calls it.

The client half is not redundant once the server half lands, and it is worth saying why
rather than deleting it later as duplication. This app already makes exactly this
inference for its own action: `claimZone` patches `myRole: 'OWNER'` locally after a
successful claim (`zone-store.ts:393`) instead of waiting for an event. The store
therefore already asserts that `ownerUserId` and `myRole` cannot disagree; doing it in
one place for a local write and not in the other for a remote one is how they came to
disagree here. Two writers to `myRole` in the same branch are idempotent: both compute
the same value from the same fact.

`ZoneStore` gets a spec for each of the three cases, and one that asserts the staff room
is re-synced on becoming owner.

## 3. A promotion to admin, which should already work

Promoting a member to admin goes through `ZoneService.setRole`, which **does** emit
`member.roleChanged` with a `MembershipView` carrying `zoneId`, `userId`, `role` and
`status`. The client path was read end to end and each hop is correct: the subject is in
`DOMAIN_EVENT_SUBJECTS`; the consumer routes it to `zone:{zoneId}`, which the promoted
member is in; `toMembership` maps every field it needs and the role strings on both sides
are the same three uppercase values; `_apply` matches `isMe` on `userId` and patches
`myRole`; `zoneById` reads a signal inside a computed, so the group header, the dashboard
card and the members screen all re-render.

So this plan does not change that path on a hypothesis. **The first task is a
reproduction**, and it is a real task with a real deliverable:

1. Two sessions, two accounts, one group, one an owner and one a member.
2. Promote the member to admin.
3. On the promoted session, capture: whether the frame arrived (the socket log), whether
   `toRealtimeEvent` returned null (the drop counter `0004` requires), and what
   `ZoneStore.zoneById(id)?.myRole` reads afterwards.

That tells you which hop is wrong in one run, and each answer has a different fix:

- **No frame** → the promoted client is not in the zone room. Look at the re-subscribe on
  reconnect, not at the store.
- **Frame, mapper returned null** → a payload field is absent or a different shape than
  `MembershipView`. Fix the mapper or the emit, and add a contract schema assertion.
- **Frame mapped, `myRole` correct, screen unchanged** → nothing is wrong with realtime
  and the report is section 4, which is the likeliest answer and is why section 4 is in
  this plan.

Write down whichever it was in this file's section 7 before closing the plan. A defect
that turned out to be a different defect is worth one sentence to the next reader.

## 4. Being an admin looks exactly like being a member

On the dashboard, the role beside a group's name is drawn inline by `zone-card.html`
rather than by `RoleChip`, and its three branches are:

```
@case ('OWNER')  <span class="badge badge-owner">
@case ('ADMIN')  <span class="badge">
@default         <span class="badge">
```

`zone-card.scss` defines `.badge`, `.badge-owner` and `.badge-pending`. **There is no
`.badge-admin`**, so Admin and Member render as the same grey chip with different text.

`RoleChip`, used on the group page and the members screen, does have `chip-admin`, tinted
with the info role, and its comment states the intent:

> An admin is somebody with powers, and reading as neither the owner nor an ordinary
> member is the whole job. Info rather than attention.

So the dashboard is the odd one out and the fix is to give it `.badge-admin` with the
same info tokens the chip uses. That also means a member promoted to admin **does** see
their dashboard card change, rather than a word changing in a chip that stays the same
colour, which is the observation this defect was reported from.

Not merged into `RoleChip`: the card's badge sits in a name row beside a pending badge
and truncating name, and `RoleChip`'s own header already records the decision to keep the
two apart rather than give the component a variant per caller. What is shared is the
design token, not the component, and that is enough for the two to agree.

## 5. The join code is shown to people who cannot regenerate it

`GroupPage.showInvite` (`feature-zones/src/lib/group-page/group-page.ts:150`) is:

```ts
const kind = this.state().kind;
return kind !== 'error' && kind !== 'pending' && kind !== 'ownerless';
```

Every approved member of an active group therefore sees the invite card, the code and the
Share the link button. Ordinary members should not: inviting is a governance action here,
the code can only be **regenerated** by an owner or an admin
(`ZoneService.regenerateJoinCode` requires `[OWNER, ADMIN]`), and a member who hands the
code around cannot undo it.

### 5.1 The client half

`showInvite` gains `&& header.isStaff`. `isStaff` is already on `GroupHeaderVm`, already
computed in `toHeader` from `myRole` alone, and already documented there as rule G2. It is
the same fact the Settings action is drawn from, so the invite card and the settings entry
appear and disappear together, which is correct: they are the two halves of governing a
group.

Because `isStaff` comes from `myRole`, and section 2 makes `myRole` live, this is
automatically live: promoted to admin, the card appears; demoted, it goes. `GroupPage`
gets a spec for both directions driven by a role event, because "it disappears on the next
reload" is exactly the behaviour that would satisfy a lazier test and not the requirement.

### 5.2 The server half is the real fix (backend `0029`)

Hiding the card leaves the code itself in the client. `ZoneView.joinCode` is a non-nullable
string on every zone response and on every `zone.updated` / `zone.ownershipChanged`
payload, so an ordinary member's browser holds it and anyone opening devtools reads it.
A permission enforced only by a template is not enforced.

Backend `0029` makes `joinCode` nullable and fills it only for a caller who manages the
zone, exactly as `pendingRequestCount` already works. The principle is already written
down in `select-group-state.ts` and this plan reuses it verbatim:

> `pendingRequestCount` is non-null only for a caller the backend considers staff, so
> **the value is the permission** and nothing here re-derives it from a role.

**Once that lands**, this app's `joinCode` becomes `string | null`, `toZone` maps it with
`nullableStr`, and `showInvite` is `header.joinCode !== null`: the value, not a second
opinion about a role. The `isStaff` check in 5.1 is the interim, and this plan's last task
is to replace it rather than keep both. Which is also the order they must land in: the
client tolerates a null before the server can send one, never after.

## 6. Sequencing with the backend

| Step | Where     | What                                                                  |
| ---- | --------- | --------------------------------------------------------------------- |
| 1    | this plan | Sections 3 and 4, and 5.1. Nothing here needs the server to change.    |
| 2    | this plan | Section 2.3's client half. Correct on its own, on today's server.      |
| 3    | `0029`    | The two `member.roleChanged` emits, and a nullable `joinCode`.         |
| 4    | this plan | `joinCode: string \| null` in the models, and 5.2 replacing 5.1.       |

Steps 1 and 2 are shippable with no backend deploy, which matters: staging deploys only
the affected projects, so a client that requires a server change to be correct is a client
that is wrong for the length of a deploy window.

## 7. What was found while building it

_To be filled in when section 3's reproduction runs. If the promote-to-admin path turns
out to be section 4 all along, say so here in one sentence; if it is a real transport or
mapper defect, say which hop and what fixed it._

## 8. Acceptance

1. Owner A transfers ownership to member B. Without a reload: B's chip reads Owner and B
   is offered the owner-only actions; A's chip reads Admin and A is offered neither
   Delete group nor Transfer ownership; the members screen on both shows both new roles.
2. An admin claims an ownerless group. Without a reload their role reads Owner on the
   dashboard, the group page and the members screen.
3. A member promoted to admin sees a distinctly tinted Admin badge on the dashboard card,
   not the member grey, and the tint matches `RoleChip`'s admin tint.
4. An ordinary member's group page shows no invite card, no code and no share button. The
   group's owner and admins still do.
5. Promoting that member to admin makes the invite card appear without a reload, and
   demoting them makes it go.
6. After backend `0029`, an ordinary member's `GET /v1/zones/{id}` response carries
   `joinCode: null`, and the app renders correctly against it.
