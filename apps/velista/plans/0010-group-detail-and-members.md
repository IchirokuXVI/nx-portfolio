# 0010. The group: its lists, and the people in it

> Prerequisite reading: `0003` (the zone card, its counts, and what each one means),
> `0004` (the transport and rules D1 to D5), and `0008` (rule E1, and the route
> ordering trap that this plan walks straight back into from the other side).
>
> **This is a page plan** and follows the template in `0001` section 9.
>
> **Status: written 2026-08-27. The mock is not drawn yet**, so by `0001` section 9
> this plan is not ready for development. Everything below the mock section is
> settled against the backend as it stands and does not depend on how the screens
> end up looking.
>
> It covers two routes, `zones/:zoneId` and `zones/:zoneId/members`, in one plan.
> Section 1 says why they cannot be split.

## 1. Purpose

Every group on the dashboard is a dead end. `0003` drew the card with a member count,
a list count, up to three list previews and a join request row, and none of it is
tappable through, because the screen behind it did not exist. This plan builds that
screen: **the group, which is where lists live**, and behind it **the members screen,
which is where a request to join finally gets an answer**.

The second one is why these are one plan and not two. `0008` built both ways in and
said plainly that it could produce a pending membership and could not resolve one. An
app built to the plans that exist today has people standing in a queue that nothing
can serve: the owner sees "Ana wants to join" on a card, taps Review, and arrives
nowhere. Shipping the group page alone would move that dead end one screen deeper
rather than removing it, so approving a member is in scope here or the group page is
not worth building yet.

This is also the first plan whose screens are mostly **governance**: renaming,
promoting, removing, handing the group over, and deleting it. Section 5.4 takes every
one of those rules from core rather than from a reasonable guess about them, because
almost all of them are more restrictive than they look.

## 2. Mock

**Not drawn.** It belongs in `mocks/zone/`, built and published the way `mocks/README.md`
describes, and this plan is not ready for development until it is approved.

What it has to contain, so the drawing has a brief:

| Artboard | Frames |
| --- | --- |
| `Group.dc.html` | The group with lists, as a plain member and as an owner. The two differ by the governance row and nothing else |
| `GroupEmpty.dc.html` | Two different empties: a group with no lists at all, and a group whose lists the caller may not read (section 3.2). They must not look the same |
| `GroupPending.dc.html` | The group as somebody still waiting to be let in sees it (section 3.3) |
| `Members.dc.html` | The member list, the pending requests above it, and the row menu open |
| `MemberActions.dc.html` | The confirm sheets: remove, ban, hand over the group, regenerate the code, delete the group |
| `GroupOwnerless.dc.html` | `MARKED_FOR_DELETION`, for an admin who can rescue it and for a member who cannot (section 3.5) |

Phone frames are 390 by 844, per the mock conventions.

**Night only, with one exception to check for.** Every role this needs is one `0003`
proved: amber primary, coral for destructive, violet for pending. The exception is that
`0003` never drew a **destructive** control, only an error message in coral. If the
destructive treatment turns out to want a role that is not already in `0002`, that role
gets a Day artboard, per the rule in `mocks/README.md`.

## 3. States

### 3.1 The group page

| State | Behaviour |
| --- | --- |
| Loading | Skeleton in the shape of the header plus three list rows. The header can be drawn from `ZoneStore`'s cache when the caller arrived from the dashboard, so the common path shows a named group immediately and skeletons only the lists |
| Loaded | Header, the governance row for staff, the lists, and the invite code |
| Empty | The group has no lists. One sentence and one primary, since any member may make the first one (section 5.5) |
| No readable lists | Not the same state. See 3.2 |
| Pending | The caller is in the group but not approved. See 3.3 |
| Failed | The `0003` error panel, reused unchanged, with the correlation id and a retry |
| Stale | The realtime room was refused, so the page is correct but not live. `ZoneStore.staleZoneIds` already computes this and `0003` already renders a treatment for it |
| Gone | The group was deleted, or the caller was kicked or banned, while the page was open. See 3.5 |

### 3.2 The state that is empty and is not

`ListPreview` in `libs/velista/models/src/lib/domain.ts` already carries the warning,
and this is the screen it was written for:

> **Empty means the caller can read no list in this zone, never that the zone has
> none.**

Both states render zero rows and they mean opposite things. A member of a busy
household who has not been given access to anything would be told "No lists yet" and
invited to start the first one, which is false and slightly insulting: there are four,
and nobody has shared one with them.

The two are distinguishable without a new endpoint, and section 5.5 gives the test:
`counts.listCount` is filtered per caller, so it cannot separate them, but
`counts.memberCount` can. A group with one member and no lists is genuinely empty. A
group with several members and no readable lists is the other case, and its copy asks
the person to speak to somebody rather than offering them a button.

That test is a heuristic and this plan says so rather than pretending otherwise: a
group of four people who genuinely have no lists yet reads as the second case. It errs
towards telling somebody to ask, which is harmless, instead of towards telling them a
populated group is empty, which is not. Section 5.8 records the endpoint that would
settle it properly.

### 3.3 While you are still waiting

A PENDING membership can reach this route: the dashboard renders the group as a card
with a waiting badge, and a card that is tappable everywhere else being inert here is
worse than a screen that explains itself.

The page renders the name, the waiting state, and nothing else. It must not request
the lists or the members. Core answers `forbidden` to both for a caller who is not
APPROVED, and firing two requests to be refused twice is how a person ends up reading
an error panel about a situation that is not an error.

`ZoneStore` already holds `myStatus`, so this branch is decided before any request is
made, which is the point.

### 3.4 The members screen

| State | Behaviour |
| --- | --- |
| Loading | Skeleton rows |
| Loaded, staff | Pending requests first, each with approve and reject, then the approved members with their roles |
| Loaded, member | The approved members and their roles. No pending section, and no row menu |
| Empty pending | The section is absent, not an empty state with a message |
| Paging | Cursor paged. A group large enough to page is rare and the screen still has to do it |
| Row acting | The acting row's controls go busy; the rest of the screen stays usable |
| Row resolved elsewhere | Somebody else answered the request first. The row leaves, and nothing reports an error. See 5.6 |

### 3.5 The states that arrive without being asked for

These are realtime, they land on a page that is already open, and each has one correct
response:

| Event | What the page does |
| --- | --- |
| `member.kicked` / `member.banned` for the caller | Leave for the dashboard with a plain notice. `ZoneStore` already removes the zone from the cache, so the card is gone when they arrive |
| `zone.deleted` | The same, with different copy. There is nothing to render and no error to report: somebody with the right to do it did it |
| `member.roleChanged` for the caller | Stay. The governance row appears or disappears in place. This is the one that must not navigate |
| `zone.markedForDeletion` | Switch to the ownerless treatment below, in place |
| `zone.ownershipChanged` | Re-render the header. An admin who claimed the group is now the owner, and the caller may be the one who was demoted by a transfer |

**The ownerless group.** `0003` skipped `MARKED_FOR_DELETION` and `0008` inherited the
skip. This is the plan that has to answer it, because the only action anywhere in the
product that gets a group out of that state is on this screen.

A zone lands there when its owner deletes their account (`account-deletion.service.ts`),
and core's reaper deletes it for good once a grace period passes with no owner. An
**ADMIN**, and only an admin, may claim it, which makes them the owner and returns it
to ACTIVE. So there are two screens:

- **An admin** sees the group is unowned, that it will be deleted, and one primary
  that takes it over.
- **Anybody else** sees the same warning and no action, because there is none. The copy
  tells them to ask an admin, and it does not invent a way out that the backend does
  not have.

Neither screen may show a countdown. The grace period is core's configuration, no
endpoint reports it, and a number invented on the client is the kind of thing people
plan around.

## 4. Anatomy

### 4.1 Rule G1: `zones/:zoneId` must not eat `zones/new`

`0008` section 4.1.1 established that every non empty path is declared before the `''`
front door, and predicted this plan by name: "`zones/:zoneId`, when it lands, would be
shadowed by `zones/new` if it were ever appended after this." That is true, and it is
the smaller half of the problem. The larger half runs the other way.

`zones/new` and `zones/join` are children of `''` and of `home` (rule E1). `''` is
declared last. So a `zones/:zoneId` added in the obvious place, before `''`, is offered
the URL `/zones/new` first, matches it with `zoneId` set to the string `new`, consumes
every segment, and wins. The front door's create sheet becomes unreachable, and the
person who tapped Create a group gets a group page that fires
`GET /v1/zones/new` and renders the not found panel.

Reordering cannot fix this. The sheets have to stay children of the pages they cover or
rule E1 is gone, and `''` has to stay last or `0008`'s rule is gone. The two constraints
are not in conflict, they just mean the parameterised route needs to be able to
**decline** a URL rather than to be ordered around it.

> **Rule G1.** `zones/:zoneId` matches only when the segment is a UUID, enforced by a
> `canMatch` guard.

`canMatch` and not `canActivate`, and that is the whole mechanism: a false `canActivate`
aborts the navigation, while a false `canMatch` makes the router carry on to the next
route, which is exactly the fall through this needs. `/zones/new` is declined, matching
continues, `''` accepts it, and its child renders the sheet.

The shape is checkable rather than agreed: core's ids come from
`@PrimaryGeneratedColumn('uuid')` on `BaseEntity`, so every zone id in the product is a
UUID and no reserved word can ever collide with one. It pays twice, because
`/en/velista/zones/whatever` from a mistyped link now falls through to the front door
instead of spending a request to be told `not_found`.

`zones/:zoneId/members` carries the same guard, and is declared before `zones/:zoneId`
out of habit rather than necessity: a route with children absent and segments left over
does not match anyway, but the specific before the general is the ordering that stays
correct when somebody later gives the group page children.

The `routes.spec.ts` assertions this adds:

- `/zones/new` still resolves to `CreateGroupSheet`, over the front door.
- `zones/:zoneId` declares a `canMatch`.
- A non UUID segment does not match the group page.

### 4.2 Members is a route; the confirms are sheets

The members screen has its own scroll, its own paging and its own deep link, which is
what makes it a destination and not something drawn over the group. It is a sibling
route, and the group page keeps a plain link to it.

The confirms are the opposite. Each one is a single decision about a row that is on
screen, it must not lose the page underneath, and Android's back button has to dismiss
it, which is the whole of rule E1's argument. So they reuse `SheetShell` and they are
routes:

| Route | Renders | Access |
| --- | --- | --- |
| `zones/:zoneId` | `GroupPage` | Authenticated, member |
| `zones/:zoneId/members` | `MembersPage` | Authenticated, member |
| `zones/:zoneId/lists/new` | `CreateListSheet`, over the group page | Authenticated, approved member |
| `zones/:zoneId/settings` | `GroupSettingsSheet`: rename, regenerate the code, delete | Authenticated, staff |
| `zones/:zoneId/members/:membershipId/confirm` | `MemberActionSheet`, the action in `data` | Authenticated, staff |

Approve and reject are **not** in that table. They are one tap on the row, they are
reversible in the sense that matters (a rejected person can ask again), and putting a
confirm in front of the most common action on the screen would make an owner tap twice
for every person who ever joins their household.

Guarding these routes at the route rather than in a template is rule C1 from `0009`,
applied to a different kind of permission. `authenticatedGuard` is not enough on its
own, since being signed in says nothing about this group, and section 4.3 is what the
extra guard reads.

### 4.3 Rule G2: hide an affordance from the caller's own role, and let the server decide

> **Rule G2.** Every governance control is shown or hidden from `myRole` on the zone the
> store already holds. That decides what is *drawn*. It never decides what is
> *allowed*, which core decides on every request regardless.

The distinction is not pedantic here. `ZoneAuthzService` resolves the caller's
membership from its own table on every call, so a demoted admin holding a valid access
token is refused, and the client hiding the button is a courtesy to the person rather
than a security boundary. Any code comment that suggests otherwise is wrong and should
be corrected when found.

There is a second, tempting source for the same fact and it must not be used for this.
`counts.pendingRequestCount` is non-null exactly when the caller is staff, which is
already documented in `domain.ts` as "a non-null value **is** the permission". That is
true and it is the right test for **whether to render the number**, which is what
`0003` uses it for. It is the wrong test for whether to render a button, because the
counts and `myRole` update from different events: a `member.roleChanged` that demotes
the caller updates `myRole` immediately, while the counts on the card do not change
until something else refreshes them. Reading a button's visibility from the stale one
leaves an approve control on screen for somebody who is no longer allowed to press it.

So: **`myRole` gates controls, a non-null count gates the number.** Never a null count
as a proxy for a role.

### 4.4 Libraries

| Library | Adds |
| --- | --- |
| `libs/velista/feature-zones` **(new)** | `GroupPage`, `MembersPage`, `CreateListSheet`, `GroupSettingsSheet`, `MemberActionSheet`. The only things here that touch a store, per rule D1 |
| `libs/velista/ui` | `GroupHeader`, `ListRow`, `MemberRow`, `PendingRequestRow`, `RoleChip`, `ConfirmSheet` (a `SheetShell` with a destructive primary and a typed confirmation mode), `OwnerlessPanel` |
| `libs/velista/data-access` | `ListApi` / `ListMemory` / `LIST_SERVICE`, `MembershipApi` / `MembershipMemory` / `MEMBERSHIP_SERVICE`, `ListStore`, and `zone.get` plus the governance writes on `ZoneServiceI`. This is most of the plan. See section 5.1 |
| `libs/velista/models` | `ZoneDetail` if the header needs anything the existing `MyZone` lacks, which it should not |
| `libs/velista/feature-home` | The zone card and the join request row become real links. `pendingRoutes` loses two more entries |
| `libs/velista/feature-shell` | The five route entries, the `canMatch` guard, and a `zoneMemberGuard` |

Layering is unchanged: `models -> platform -> {ui, data-access} -> feature-*`.
`feature-zones` is lazy loaded by `feature-shell` and must never import it back.

Icons needed: a person, a chevron, an ellipsis for the row menu, and a warning
triangle. All four go in `libs/velista/ui/src/lib/icons`, which is where this app keeps
its own set.

## 5. Data

### 5.1 Unlike `0008`, this plan is mostly transport

`0008` opened by saying the network layer was already built and the plan was what sat
above it. The opposite is true here. `ZoneServiceI` declares three operations:
`listMyZones`, `createZone`, `joinZone`. Every call these two screens make is new.

| Call | Route | Answers |
| --- | --- | --- |
| Get one group | `GET /v1/zones/:id` | `MyZoneView`, so the header, the counts and up to three list previews arrive together |
| Its lists | `GET /v1/zones/:id/lists` | `ListPage` of `ListView`, cursor paged, orderable by name, created or updated |
| Create a list | `POST /v1/zones/:id/lists` | `ListView` |
| Its members | `GET /v1/zones/:id/members?statuses=` | `MembershipPage`, cursor paged, orderable by joined, name or role |
| Approve, reject | `POST /v1/zones/:id/members/:mid/approve`, `/reject` | `MembershipView`, and `{ id }` for reject |
| Kick, ban | `POST /v1/zones/:id/members/:mid/kick`, `/ban` | `MembershipView` |
| Change a role | `PATCH /v1/zones/:id/members/:mid/role` | `MembershipView` |
| Hand the group over | `POST /v1/zones/:id/members/:mid/transfer-ownership` | `ZoneView` |
| Claim an ownerless group | `POST /v1/zones/:id/claim-ownership` | `ZoneView` |
| Rename the group | `PATCH /v1/zones/:id` | `ZoneView` |
| Regenerate the code | `POST /v1/zones/:id/regenerate-code` | `ZoneView` |
| Delete the group | `DELETE /v1/zones/:id` | `{ id }` |
| Rename a member | `PATCH /v1/zones/:id/members/:mid/username` | `MembershipView`, throttled at `usernameChange` |

All of them require a bearer token, all of them map through rule D4 into this app's own
models, and all of the writes go through `Mutations.run` per rule D2, which is what
keeps the offline queue a change to one file. `ListMemory` and `MembershipMemory`
mirror the lot, so both screens and every state in section 3 are buildable and testable
with no gateway running, exactly as `ZoneMemory` already allows for the dashboard.

`ZoneListPreview` and `ListView.counts` carry the same field names on purpose, which
the contract says out loud: the frontend maps one shape whichever endpoint it came
from. There is one `toListPreview` and it takes both.

### 5.2 `ListStore`, which `ZoneStore` already named

`ZoneStore._apply` has a case that ignores eight list and line events with the comment
"`ListStore` owns these". This plan is where that store appears. It goes in
`data-access` and not in `feature-zones`, for the reason `ZoneStore`'s own header gives:
a store owned by a feature library is destroyed on navigation, so the room would be
left and rejoined on every screen change and the cache thrown away. Lists survive being
navigated away from.

It holds lists by zone, applies `list.created`, `list.updated`, `list.deleted` and
`list.accessChanged`, and it is the thing the shopping list plan will extend rather
than replace.

`list.accessChanged` is the awkward one and it deserves naming now. It carries only a
`listId`, and its meaning for the caller is "your access to this list may have changed,
including to none". There is no way to tell from the event whether the list should now
appear or disappear, so `ListStore` refetches the zone's lists on it. That is a whole
request for a rare event, and it is still cheaper than either alternative: dropping the
list from the cache would flicker it off screen for a caller whose access only widened,
and keeping it would leave a list on screen that the caller can no longer open.

### 5.3 Rule G3: only staff may join the staff room

> **Rule G3.** `subscribeZoneStaff` is called only when `myRole` is OWNER or ADMIN.

The staff room `zone:{id}:staff` is what carries `zone.countsUpdated` with the
governance fields filled; the plain room delivers the same event with both of them
null, and `ZoneStore` already reads a null as "this broadcast could not say" rather
than as zero.

The hazard is on the other side. The server refuses a room the caller may not have, and
`RealtimeClientI.refusedRooms()` feeds `ZoneStore.staleZoneIds`, which is what `0003`
renders as "this group is not live". So a members screen that subscribes to the staff
room unconditionally would put a permanent stale badge on every group where the caller
is an ordinary member. The permission is already in the cache, so there is no reason to
find it out by being refused.

The group page joins `zone:{id}`. The members screen joins the staff room in addition,
under the rule. Both are refcounted and released on destroy, which the client already
handles.

### 5.4 The permission table, taken from core

Every row below is read from `zone-authz.service.ts`, `zone.service.ts`,
`membership.service.ts` and `list.service.ts`, not inferred. Rule G2 draws the UI from
this table.

| Action | Who may |
| --- | --- |
| Read the group, its lists, its members | An **APPROVED** member. PENDING is refused |
| Create a list | Any **APPROVED** member. The creator becomes its WRITER |
| See who is pending | **OWNER or ADMIN**. Any `statuses` other than APPROVED is staff only |
| Approve, reject | **OWNER or ADMIN**, and only on a membership that is actually PENDING |
| Kick, ban | **OWNER or ADMIN**. The owner can be neither |
| Change a role | **OWNER only**. May not set OWNER, and may not change the owner's role |
| Hand the group over | **OWNER only**. The old owner becomes ADMIN |
| Claim an ownerless group | **ADMIN only**, and only while `ownerUserId` is null |
| Rename the group, regenerate the code | **OWNER or ADMIN** |
| Delete the group | **OWNER only** |
| Rename a member | Themselves, APPROVED **or PENDING**, or OWNER or ADMIN. An admin may not rename the owner |
| Rename, share or delete a list | Its creator, or an admin, or the owner |
| **Leave a group** | **Nobody.** There is no route. See 5.8 |

Three of these are more restrictive than a designer would assume, and each one changes
a screen:

- **An admin cannot promote anybody**, because `setRole` is owner only. The row menu
  for an admin has remove and ban in it and no role control at all.
- **The owner cannot be removed or renamed by an admin**, so the owner's row has no
  menu when an admin is looking at it. Not a disabled menu: an absent one.
- **A member cannot leave.** There is no way to say so on this screen that is not a
  lie, so the screen says nothing, and section 5.8 records it as the gap it is.

### 5.5 Any member may make a list, and not every member can see it

`ListService.create` requires only `requireApproved`, and gives the creator WRITER
access. `ListService.list` then returns, for a manager, every list in the zone, and for
anybody else, only the lists they created or were explicitly granted.

Two consequences the UI has to respect:

1. **The list count is a property of the caller, not of the group.** Two members can
   open the same group and correctly see different numbers. Nothing on either screen
   may phrase it as a fact about the group, and the existing `home.zone.lists_one` and
   `_other` keys are already worded to survive this, so they are reused as they are.
2. **The primary on the empty state is honest.** Any member really can make the first
   list, so the button belongs there, and it belongs there for a plain member too.

Section 3.2's heuristic follows from the same asymmetry: `listCount` cannot separate
"none" from "none you may read", because it is the filtered number in both cases.

### 5.6 What a failure means, per operation

The gateway has seven codes and one message per code, so the server's `message` is
unusable as copy and the client keys its own on **code plus operation**, which `0004`
settled and `0008` section 5.4 first applied.

| Code | Where | Means | Copy |
| --- | --- | --- | --- |
| `not_found` | Any group call | No membership at all, since core answers not found rather than forbidden to a stranger, so the two are indistinguishable on purpose | This group is not available to you. It may have been deleted, or you may have been removed |
| `forbidden` | Reading the group | A PENDING membership | Never reached: section 3.3 decides this before the request |
| `forbidden` | A governance write | The caller's role changed underneath them | Your role in this group changed. Reloading, then the page refetches |
| `validation_failed` | Approve, reject | The membership is no longer PENDING, so somebody else answered first | **No message.** The row leaves, quietly. See below |
| `validation_failed` | Change a role | An attempt to set OWNER through the role route | Not reachable from the UI, which offers ADMIN and MEMBER only |
| `conflict` | Claim ownership | Another admin claimed it first | Somebody else has already taken this group on |
| `rate_limited` | Rename a member | The `usernameChange` bucket | Too many changes. Wait a minute and try again |
| `internal` | Anywhere | The generic panel, with the correlation id `0003` already renders | |

The `validation_failed` on approve is the one worth arguing for. Two admins looking at
the same queue is the normal case, not the exotic one, and the second one to tap has
done nothing wrong. Showing them an error for having been half a second slower is
noise about somebody else's success. The row disappears, which is what the realtime
event was about to do anyway, and nothing is said.

### 5.7 The three writes that get a confirm, and the one that gets typed

Reversibility decides this, not severity of tone:

| Write | Treatment | Why |
| --- | --- | --- |
| Approve, reject | None | Common, and a rejected person may ask again |
| Kick | Confirm sheet | They lose the group, and can rejoin with the code |
| Ban | Confirm sheet, destructive styling | They cannot rejoin. `zone.service.join` refuses a BANNED membership outright |
| Regenerate the code | Confirm sheet | Not destructive to data, and it strands every invite already sent, which is invisible unless the copy says it |
| Hand the group over | Confirm sheet, naming the person | The caller is demoted to ADMIN by the same call and cannot undo it alone |
| Delete the group | Confirm sheet **and the group's name typed in** | Every list, line and comment for every member, gone, with no undo anywhere in the product |

The typed name is deliberate friction and it is worth its cost exactly once. The
alternative, an ordinary destructive confirm, is a two tap gesture that a phone in a
pocket or a misread row can complete, and the thing it destroys belongs to other people
as much as to the person pressing it. `ConfirmSheet` takes it as a mode so that nothing
else in the app grows one by imitation.

### 5.8 What this plan needs from the backend, and what it does without

Recorded, not assumed. Nothing here blocks the plan.

1. **There is no way to leave a group.** No route, no message pattern, nothing. The only
   exit is for an owner or admin to remove you, and the owner has no exit at all short
   of deleting their account, which marks the group for deletion. This is the most
   likely thing a real user will look for on this screen and not find. It wants
   `DELETE /v1/zones/:id/members/me`, with the owner refused unless they transfer first.
2. **Nothing separates "no lists" from "no lists you may read".** A `hasLists` boolean
   on `MyZoneView`, or a total alongside the filtered `listCount`, would replace section
   3.2's heuristic with a fact. It leaks nothing: the member count already tells you the
   group is not empty.
3. **The grace period on an ownerless group is not reported.** Core knows it, the client
   cannot, so section 3.5 shows no countdown.
4. **Still no preview by join code**, unchanged from `0008` section 5.7. The invite card
   on this page has the same limits it has on the dashboard.

## 6. Localization

New keys nested under `zone` in `libs/velista/ui/assets/i18n/{en,es}.json`, which
already holds `zone.role` and `zone.status`. Rule N2 holds: the keys say zone, the
values say group and grupo. Rule N1 holds: no key contains the product name.

The existing `home.zone.members_one` / `_other`, `home.zone.lists_one` / `_other`,
`home.list.items_one` / `_other`, `home.progress.ready`, `home.pending.waiting`,
`home.request.wantsToJoin` and the whole of `home.error` are reused unchanged. They were
written as counts and states rather than as sentences about the dashboard, which is what
makes them portable to this screen.

| Key | English | Spanish |
| --- | --- | --- |
| `zone.detail.lists` | Lists | Listas |
| `zone.detail.members` | Members | Miembros |
| `zone.detail.newList` | New list | Nueva lista |
| `zone.detail.settings` | Group settings | Ajustes del grupo |
| `zone.detail.empty.title` | No lists yet | Todavía no hay listas |
| `zone.detail.empty.body` | Start one and everyone here can shop from it | Empieza una y todos los del grupo podrán comprar con ella |
| `zone.detail.noAccess.title` | Nothing shared with you yet | Aún no han compartido nada contigo |
| `zone.detail.noAccess.body` | This group has lists, and none of them are shared with you. Ask someone here to add you, or start your own | Este grupo tiene listas y ninguna está compartida contigo. Pide que te añadan o empieza la tuya |
| `zone.detail.pending.title` | Waiting to be let in | Esperando a que te dejen entrar |
| `zone.detail.pending.body` | Whoever runs the group decides. The lists appear here as soon as they do | Quien lleva el grupo decide. Las listas aparecerán aquí en cuanto lo haga |
| `zone.detail.gone.kicked` | You are no longer in that group | Ya no estás en ese grupo |
| `zone.detail.gone.deleted` | That group was deleted | Ese grupo se ha eliminado |
| `zone.ownerless.title` | This group has no owner | Este grupo no tiene dueño |
| `zone.ownerless.body` | Whoever set it up deleted their account. It will be deleted unless an admin takes it on | Quien lo creó eliminó su cuenta. Se borrará a menos que un administrador se haga cargo |
| `zone.ownerless.claim` | Take this group on | Hacerme cargo del grupo |
| `zone.ownerless.askAdmin` | Ask an admin here to take it on | Pide a un administrador del grupo que se haga cargo |
| `zone.members.title` | Members of {{name}} | Miembros de {{name}} |
| `zone.members.requests` | Waiting to join | Esperando entrar |
| `zone.members.approve` | Let in | Dejar entrar |
| `zone.members.reject` | Turn down | Rechazar |
| `zone.members.remove` | Remove from group | Sacar del grupo |
| `zone.members.ban` | Remove and block | Sacar y bloquear |
| `zone.members.makeAdmin` | Make admin | Hacer administrador |
| `zone.members.makeMember` | Make an ordinary member | Hacer miembro normal |
| `zone.members.transfer` | Hand the group over | Ceder el grupo |
| `zone.members.rename` | Change name here | Cambiar el nombre aquí |
| `zone.members.you` | You | Tú |
| `zone.confirm.remove.title` | Remove {{name}}? | ¿Sacar a {{name}} del grupo? |
| `zone.confirm.remove.body` | They lose this group and its lists. They can ask to join again with the code | Perderá este grupo y sus listas. Podrá pedir entrar otra vez con el código |
| `zone.confirm.ban.title` | Remove and block {{name}}? | ¿Sacar y bloquear a {{name}}? |
| `zone.confirm.ban.body` | They lose this group and cannot ask to join again, even with the code | Perderá este grupo y no podrá volver a pedir entrar, ni con el código |
| `zone.confirm.transfer.title` | Hand the group to {{name}}? | ¿Ceder el grupo a {{name}}? |
| `zone.confirm.transfer.body` | They become the owner and you become an admin. Only they can hand it back | Pasará a ser el dueño y tú administrador. Solo esa persona podrá devolvértelo |
| `zone.confirm.regenerate.title` | Make a new code? | ¿Crear un código nuevo? |
| `zone.confirm.regenerate.body` | The old code stops working, so anyone you already sent it to will need the new one | El código antiguo dejará de funcionar, así que quien ya lo tenga necesitará el nuevo |
| `zone.confirm.delete.title` | Delete {{name}}? | ¿Eliminar {{name}}? |
| `zone.confirm.delete.body` | Every list in this group goes, for everyone in it. This cannot be undone | Se irán todas las listas del grupo, para todos sus miembros. Esto no se puede deshacer |
| `zone.confirm.delete.typeName` | Type the group's name to confirm | Escribe el nombre del grupo para confirmar |
| `zone.settings.rename` | Group name | Nombre del grupo |
| `zone.settings.save` | Save | Guardar |
| `zone.error.notAvailable` | This group is not available to you. It may have been deleted, or you may have been removed | Este grupo no está disponible para ti. Puede que se haya eliminado o que te hayan sacado |
| `zone.error.roleChanged` | Your role in this group changed | Tu papel en este grupo ha cambiado |
| `zone.error.alreadyClaimed` | Somebody else has already taken this group on | Otra persona ya se ha hecho cargo del grupo |
| `zone.error.tooManyRenames` | Too many changes. Wait a minute and try again | Demasiados cambios. Espera un minuto e inténtalo de nuevo |

`zone.members.title` and every confirm title interpolate a name, which is the pattern
`0006` fixed in the Angular wrapper. Each is a whole phrase with the name inside rather
than a noun glued to a frame, per the Spanish gender rule in `0001`.

`zone.role.owner`, `.admin` and `.member` are placeholders today (`"OWNER"`, `"ADMIN"`,
`"MEMBER"`, shouted in both locales) because `0003` had nowhere to render them properly.
This is that screen, so they become **Owner / Admin / Member** and **Dueño /
Administrador / Miembro**. That is a change to existing values, and the zone card picks
it up for free.

## 7. Accessibility and input

- **The row menu is a menu.** `role="menu"` with `role="menuitem"` children, opened from
  a button with `aria-haspopup="menu"` and `aria-expanded`, closed on Escape, and focus
  returns to the button that opened it.
- **A destructive item is not red alone.** Remove and block reads as remove and block in
  its text, so the meaning survives both a colourblind reader and a screen reader.
- **Every target is at least 44 by 44**, matching `0008`. A member row is a 56 tall row
  and its menu button is 44 square inside it.
- **Approve and reject are side by side and far enough apart** that a thumb aiming at
  one cannot reach the other. They are the two most consequential adjacent controls in
  the app and the only pair where a misfire is not correctable by the person who made
  it.
- **A row that is acting is `aria-busy`** and keeps its accessible name, rather than
  swapping the label for a spinner.
- **A row that leaves announces why**, through one `aria-live="polite"` region on the
  screen, so somebody who cannot see the animation is told the request was answered.
- **The typed delete confirmation** compares after trimming and case folding. It is
  friction on purpose and it is not a spelling test.
- **The pending section is a landmark**, labelled by its heading, so a screen reader
  user can jump to the thing they opened the screen for.
- **Reduced motion.** Rows leave by fading rather than collapsing under
  `prefers-reduced-motion: reduce`, and the sheets keep `0008`'s treatment.

## 8. Acceptance criteria

- [ ] `/en/velista/zones/<uuid>` renders the group, and `/en/velista/zones/new` still
      renders the create sheet over the front door. A spec covers both, and a third
      asserts that a non UUID segment does not match the group page (rule G1).
- [ ] `zones/:zoneId` and `zones/:zoneId/members` both declare a `canMatch`, and
      `routes.spec.ts`'s existing "every non empty path before `''`" assertion still
      passes.
- [ ] Arriving from the dashboard shows the group's name immediately, from the cache,
      and skeletons only the lists.
- [ ] A PENDING member sees section 3.3 and **no request is sent** for lists or members.
      Verified by asserting on the service double, not by inspection.
- [ ] A group with one member and no lists says "No lists yet". A group with four
      members and no readable lists says the other thing (section 3.2).
- [ ] A plain member sees the new list primary; an admin sees no role control on any
      row; nobody sees a menu on the owner's row except the owner themselves.
- [ ] `subscribeZoneStaff` is called for an owner and an admin and **not** for a member,
      and no group shows the stale treatment because of a refused staff room (rule G3).
- [ ] Approving a member removes the pending row and increases the member count without
      a reload.
- [ ] Approving a member who was already approved elsewhere removes the row and shows
      **no** error (section 5.6).
- [ ] `member.kicked` for the caller navigates to the dashboard and the group's card is
      already gone. `member.roleChanged` for the caller does **not** navigate, and the
      governance row appears or disappears in place.
- [ ] An ownerless group offers the claim primary to an admin, offers nothing to a
      member, and shows no countdown to either.
- [ ] Delete stays disabled until the typed name matches, trimmed and case folded.
- [ ] Regenerating the code updates the invite card on this page and on the dashboard,
      from the `zone.updated` event rather than from a refetch.
- [ ] Every row of the section 5.6 table renders its own copy, verified against the
      in-memory services rather than a live gateway.
- [ ] `zone.role.*` renders as Owner, Admin and Member in English and Dueño,
      Administrador and Miembro in Spanish, on this screen and on the zone card.
- [ ] No component in `libs/velista/ui` injects a store or a service token (rule D1).
- [ ] `npx nx lint velista feature-zones` and `npx nx test` pass for every touched
      project, and `npx nx build velista` succeeds, which is the only real type gate in
      this workspace.

## 9. Out of scope

- **The shopping list itself.** `lists/:listId` and `lists/:listId/lines/:lineId` are
  the next plan, and they are the bigger half of the product. A list row here navigates
  to a route that does not exist yet, so it stays in `pendingRoutes` until it does.
- **Choosing who can see a list.** `PUT /v1/lists/:id/access` exists and its screen does
  not. Until then a list is visible to its creator and to staff, which is what
  `ListService.create` already does on its own, and section 3.2's copy is written to
  make sense in that world.
- **Renaming, sharing or deleting a list.** They belong with the list screen, where the
  list is the subject rather than a row.
- **Leaving a group**, which section 5.8 shows is impossible today.
- **Merges.** `merge.requested` and its siblings arrive on the zone room, `ZoneStore`
  ignores them, and this plan keeps ignoring them. There is no merge screen anywhere yet.
- **Presence.** `presence.zoneUpdated` would let this page say who is here now. It is
  advisory (`0004` section 6.7), the dashboard already has the keys for it, and it is
  not worth a first pass on a screen this size.
- **The account and settings screens**, `account` and `settings`, which are still later
  and still unnumbered.
