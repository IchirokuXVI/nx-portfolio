> **PR:** [#206](https://github.com/IchirokuXVI/nx-portfolio/pull/206)

# 0077 The operator can change a row, through the service that owns it

`0074` gave the back office listings, detail reads and seven named actions over auth and core. Its
out of scope list then said "editing core rows directly, now and permanently". That decision is
reversed here, and the reason it was made is not.

The reason was never "core rows must not change". It was the **generic row editor**. The invariants
live in services rather than in constraints, so a raw editor over core offers a way to corrupt state
that no code path can repair. A list line participates in settlements, in generated list bindings, in
permission sets and in realtime broadcasts other clients have already applied. Writing the column
does none of that.

So this plan lets an operator change nearly everything they can currently only read, and it never
writes a row. Every new write calls the service method the user facing route calls, with the
authorization check removed and nothing else changed.

Depends on `0073` (the admin namespace), `0074` (the listings these writes sit beside) and `0075`
(there is an audit shape to copy).

## 1. The rule

**Write through the service, never through the row.**

The pattern already exists and this plan generalizes it rather than inventing it.
`ZoneService.regenerateJoinCodeAsOperator`, `ZoneService.transferOwnershipAsOperator`,
`MembershipService.kickAsOperator` and `MembershipService.banAsOperator` were all written by `0074`,
and each one is the same shape: a public method that skips the role check and calls the private
method the member facing path calls.

`regenerateJoinCodeAsOperator` says why in its own doc comment, and it is the whole argument for
this plan:

> The whole difference is the missing role check, and the write below is the one the zone's own
> admins reach. It matters that this is the same write: a regenerated code invalidates every
> invitation already handed out, and a second implementation that forgot `ZoneUpdated` would leave
> every open client showing a code that no longer works.

Three consequences follow, and they decide the whole design:

- **A field with no service behind it is not editable.** Not "editable with care", not "editable
  because the column allows it". It does not appear as a field an operator can change, and section 6
  lists every one of them with the reason.
- **An operator write emits the same events a member write emits.** Section 7.
- **An operator write validates what a member write validates.** A refusal an operator sees is the
  refusal a member gets, which means it is already tested.

## 2. Where the authorization goes instead

Removing the role check does not remove the check. It moves it up one level. `AdminJwtGuard` gates
every route under `/v1/admin/**` after `0073`, and `CorePlatformAdminService` and its auth twin
resolve the admin credential into an actor id.

So an `AsOperator` method is not "unauthenticated". Its caller has already proved it is an admin. Its
job is to be the same write, with a different question answered before it.

Naming is not decoration here. Every one of these methods ends in `AsOperator`. A reader of
`zone.service.ts` then sees which methods skip a role check from the method names alone, and a
future author cannot add a bypass without saying so in the name.

## 3. Users

Auth's `users` table has five columns worth an operator's attention and **two** of them become
editable.

| Column            | Editable | Through                                                              |
| ----------------- | -------- | -------------------------------------------------------------------- |
| `username`        | yes      | `IdentityService.setUsernameAsOperator`, wrapping the existing write |
| `displayName`     | yes      | a direct column write, section 3.2                                   |
| `email`           | no       | section 6.1                                                          |
| `emailVerifiedAt` | no       | section 6.1                                                          |
| `kind`            | no       | section 6.2                                                          |

### 3.1 The username is not a column

`IdentityService.setUsername` commits the name and publishes `user.usernameChanged`. Core consumes
that event in `UsernamePropagationService`. That service rewrites the per zone
`zone_memberships.username` of every membership the user holds, and emits a realtime event for each.

A direct write to `users.username` therefore produces a user whose global name changed and whose
name in every zone did not. The two then disagree forever, because the propagation is driven by the
event and nothing reconciles them afterwards.

`setUsernameAsOperator` takes the same `propagation` argument the user facing path takes, and
defaults it the same way. An operator renaming somebody is doing what that person could do to
themselves, so it behaves the same.

### 3.2 The display name is a column, and that is the point

`displayName` has no service, no event and no consumer. Nothing derives from it, nothing copies it,
and core has never seen it. So a direct column write is correct here, and writing it that way is
not an exception to section 1: there is no invariant to route around.

It carries one rule from `0074` section 4 that this plan does not relax. `displayName` holds
whatever an identity provider supplied, which for a Google sign in is somebody's real full name. So
it stays off every listing and appears only on the detail screen.

## 4. Zones and memberships

### 4.1 The zone

`ZoneService.updateAsOperator` wraps the write inside `update`, which sets `name` and `config` and
emits `ZoneUpdated`. Those two columns are the whole of what a zone's own owner may change, and an
operator gets exactly the same two.

The other four columns are not fields:

| Column                | Why not                                                                   |
| --------------------- | ------------------------------------------------------------------------- |
| `joinCode`            | unique, and random on purpose. Regenerating it is the action that exists. |
| `ownerUserId`         | two role changes and a column in one transaction. Transfer is the action. |
| `status`              | the reaper's state machine, section 4.2                                   |
| `markedForDeletionAt` | the same state machine, and half of it                                    |

### 4.2 Marking a zone for deletion is a pair, so it is an action

`status` and `markedForDeletionAt` are written together and read together. `AccountDeletionService`
sets both when a zone loses its owner. The zone reaper reads both to decide what to remove after the
grace period. `claimOwnership` clears both when an admin rescues the zone.

Typing either one alone produces one of two broken zones. A `MARKED_FOR_DELETION` zone with no
marker, which the reaper never removes. Or an `ACTIVE` zone with a marker, which it removes anyway.
Neither state is reachable through any existing code path and neither has a repair.

So this plan adds **one** new service method rather than a field:
`ZoneService.setDeletionMarkAsOperator(zoneId, marked)`, which writes the pair in one transaction and
emits `ZoneUpdated`. It surfaces as two named actions, "mark for deletion" and "restore". Those are
the two things an operator wants, and the pair is what makes each of them correct.

### 4.3 A membership's role and its per zone name

`role` goes through `ZoneService.setRoleAsOperator`, which keeps the refusal `setRole` already
carries: assigning `OWNER` is refused, because ownership is a transfer and the transfer is a
transaction. Demoting the current owner is refused for the same reason.

The per zone `username` goes through `MembershipService.setUsername`, which already exists and
already emits. An operator variant is the same missing role check.

### 4.4 A membership's status is four verbs, not one field

`MembershipStatus` moves along a state machine with a service method for each edge, and each edge
does more than write the enum. Approving a member emits `MemberApproved` and writes
`approvedByUserId`. Banning emits and keeps the row so the ban survives. Rejecting removes a
pending row.

A `PATCH` carrying `status` would have to dispatch to four methods by inspecting the value, which
is a switch statement whose branches drift. So `status` is not a form field. `kickAsOperator` and
`banAsOperator` exist already. This plan adds `approveAsOperator` and `rejectAsOperator` beside
them, and the four together are the whole state machine.

`approvedByUserId` on an operator approval is a question the plan has to answer rather than leave.
It is **null**, and it stays nullable for exactly this. An operator is not a member of the zone, so
there is no membership id to record. Every other reader treats that column as a `users.id`, so the
admin's id there would be a value that resolves to nothing.

## 5. Shopping lists and their lines

### 5.1 The list

`ListService.updateAsOperator` reaches `name`, `autoApproveLines` and `sharedWithZone`, which is
everything `UpdateListRequest` carries. `deleteAsOperator` wraps `delete`.

`sharedWithZone` is a real field and not a trap, but it is asymmetric and the screen has to say so.
Its contract states it: turning it on grants `{READ, WRITE, DECIDE}` to every currently approved non
staff member, and turning it off **revokes nobody**. That is deliberate and it is the member facing
behaviour. The mistake to prevent is an operator who toggles it off and expects the list to close.
The field carries that sentence.

The per member grant set behind `SetListAccessRequest` is **not** in this plan. It is a set of
entries rather than a field, and editing it well needs a screen of its own. An operator already
reaches the two ends of it through `sharedWithZone`. Section 12 records it.

### 5.2 A line, and the permissions an operator does not have

This is the hardest write in the plan and the one most worth getting right.
`LineService.update` takes the caller's resolved permissions and uses them **twice**.

`authorizeEdit` decides whether the caller may make this particular edit, and `reopenAfterEdit`
decides what the edit does to the line's approval: a `REJECTED` line reopens on any edit, and an
`APPROVED` one falls back to `PENDING` unless the caller decides, manages, or the list auto approves.

An operator resolves to no membership and therefore to no permissions, so both calls need an answer
rather than a default. The answer this plan chooses:

**An operator edits with `MANAGE`.**

That decides both. `authorizeEdit` allows the edit, and `reopenAfterEdit` leaves an approved line
approved, because `MANAGE` is one of its exemptions. Both halves are what an operator wants. They
are correcting a line on somebody's behalf. A correction that silently un-approved the line is a
second change nobody asked for, visible to every member in the zone.

The alternative, resolving the operator as a plain writer, was rejected for the second half alone.
An operator fixing a typo in an approved line moves it to `PENDING`. The household then has to
approve their own line again, for reasons no screen can explain.

The reachable writes are then:

| Write             | Service                             |
| ----------------- | ----------------------------------- |
| content, quantity | `LineService.updateAsOperator`      |
| the product set   | the same call, same bounds          |
| approval          | `LineService.setApprovalAsOperator` |
| delete            | `LineService.deleteAsOperator`      |

Reordering is not included. It is a whole order rather than a field, and it has no meaning outside
the screen a member drags rows on. No operator has ever wanted it.

Adding a line is not included either, and that is section 6.4.

## 6. What an operator still cannot change, and why

Every item here is a decision. Each one is on this list because a column exists and editing it is
wrong. The back office **shows** each of these fields and says in place why it is fixed. An operator
looking for a missing control then finds the reason, instead of concluding the screen is unfinished.

### 6.1 A user's email, and whether it is verified

There is no service that changes a registered user's email, because velista does not offer it. Four
paths touch the column: `register`, `upgrade`, `verifyEmail` and `googleLogin`. Each of them writes
it while it establishes an identity.

Writing the column alone would leave four things wrong at once, because the partial unique index
would be checked and nothing else would. The `Credential` row keeps the identity it was created
with. Any `OAuthIdentity` keeps the address the provider asserted. Outstanding
`email_verifications` rows keep pointing at an address the account no longer claims. Existing
refresh tokens stay valid for an account whose owner is now somebody else.

`emailVerifiedAt` is the same problem with a shorter description. Setting it by hand asserts that
somebody proved control of an address. That is the one thing the column exists to record, and the
one thing an operator cannot observe.

An operator who needs this today has "resend verification", which exists. Making the address itself
changeable is a backend plan of its own, because the work is a service and a flow rather than a
route.

### 6.2 A user's kind

`TEMPORARY` to `REGISTERED` is `IdentityService.upgrade`, which needs a password or a linked
provider and writes a `Credential` in the same transaction. Flipping the enum alone produces a
registered account with no way to sign in, and no error anywhere. The user cannot get back in and
nothing says why.

The reverse direction does not exist at all. Nothing in the codebase demotes a registered account.
Inventing it here means deciding what happens to the credential, the OAuth identities and the
verified email. That is a design and not a field.

### 6.3 Admins

`0071` section 6 states the rule and `0074` section 5 implements the read half:
**an admin can be seen and cannot be created, edited or deleted through any route, ever.**

This plan does not touch that. It is the one entry on this list that is not a "not yet". Managing
admins requires the server, because a back office that can create back office accounts is a back
office where one compromised session is permanent. The screen names the server command in place.

### 6.4 Baskets, their lines, and adding a line to a list

A `GeneratedList` is **output**. It is composed from the wanted, approved lines of the zones and
lists a person chose, at a moment recorded in `sourceSnapshot`. Every line in it carries a
`GeneratedListLineOrigin` that names the list line it came from. Lines accumulate claims and
settlements as the person walks around the shop.

Editing a basket line has no service behind it, because the app does not offer one either. A changed
`content` contradicts the origin that explains where it came from. A changed `quantity` contradicts
settlement rows already written against it. `sourceSnapshot` then describes a basket that no longer
matches it. None of that is repairable, and a basket is readable only by its owner, so the change
lands silently inside one person's private working document.

Adding a **list** line is refused on a narrower ground: `createdByUserId` is not nullable and an
operator is not a user. Every existing writer of that column is the person who typed the line. A
line attributed to nobody, or to an admin id that resolves to no user, breaks the attribution every
list screen renders.

So baskets stay read only in full, and lists gain edit, approval and delete on existing lines and
not creation. Deleting a whole basket is the one basket write worth having, and it needs a service
that does not exist. Section 12 records it.

### 6.5 Postal codes

Catalog's postal code listing is derived from location data by the harvester. There is nothing to
curate, and the row an operator would want to fix is the **location**, which is already fully
editable through `0005`.

## 7. An operator edit is a broadcast

Every write in sections 4 and 5 emits the realtime event its member facing twin emits. A member with
the app open sees the change arrive with no explanation attached to it. A line's content changes
under somebody's thumb while they are shopping.

That is accepted, for a specific reason: the alternative is worse. Suppressing the event leaves every
open client showing stale data until it happens to refetch, which for a zone room is possibly never.
Two clients then disagree about what the list says. The broadcast is what keeps them agreeing, and it
is the same broadcast a zone admin's edit produces.

What this does mean is that these writes are not quiet, and the back office says so before it makes
one. Section 9 of `apps/luna-shopper-admin/plans/0009` carries that half.

## 8. The trail

`0075` writes `catalog_audit` for every write behind `/v1/admin/catalog/**`, in the same transaction
as the change. Its section 9 leaves core and auth out, on the grounds that `0074`'s named actions
delegate to services whose behaviour is unchanged.

That reasoning held while the operator could only run seven named actions. It does not hold once an
operator can change a household's list. So this plan extends the trail, and the shape is copied
rather than redesigned.

- **One table per database**, `core_audit` and `auth_audit`, with `catalog_audit`'s columns and
  indexes exactly. Not one shared table: the audit row is written in the same transaction as the
  change, and a transaction does not span two Postgres instances. A trail that is sometimes written
  and sometimes not is worse than none, because it gets trusted.
- **Every write in sections 3, 4 and 5 is audited.** Reads are not, for `0075`'s reason.
- **The named actions from `0074` become audited too**, which they are not today. They are writes by
  an operator against somebody else's data, which is the whole category this table exists for. They
  are cheap to add once the table exists in their database.
- The diff holds changed fields only, and a write that changes nothing writes no row.

Nothing reads these tables in this plan, exactly as `0075` section 5 decided for its own.

## 9. The routes

All under `/v1/admin`, all behind `AdminJwtGuard`, all added to the existing controllers rather than
to new ones.

| Route                                          | Calls                                       |
| ---------------------------------------------- | ------------------------------------------- |
| `PATCH users/:id`                              | `setUsernameAsOperator`, display name write |
| `PATCH zones/:id`                              | `ZoneService.updateAsOperator`              |
| `POST zones/:id/deletion-mark`                 | `setDeletionMarkAsOperator`, marked true    |
| `DELETE zones/:id/deletion-mark`               | `setDeletionMarkAsOperator`, marked false   |
| `GET zones/:id/members`                        | a page of memberships                       |
| `GET zones/:id/members/:membershipId`          | one membership                              |
| `PATCH zones/:id/members/:membershipId`        | `setRoleAsOperator`, membership name write  |
| `POST zones/:id/members/:membershipId/approve` | `approveAsOperator`                         |
| `POST zones/:id/members/:membershipId/reject`  | `rejectAsOperator`                          |
| `PATCH lists/:id`                              | `ListService.updateAsOperator`              |
| `DELETE lists/:id`                             | `ListService.deleteAsOperator`              |
| `GET lists/:id/lines`                          | a page of lines                             |
| `GET lists/:id/lines/:lineId`                  | one line                                    |
| `PATCH lists/:id/lines/:lineId`                | `LineService.updateAsOperator`              |
| `POST lists/:id/lines/:lineId/approval`        | `LineService.setApprovalAsOperator`         |
| `DELETE lists/:id/lines/:lineId`               | `LineService.deleteAsOperator`              |

The four `GET` routes exist because the back office lists and reads a resource through its own
collection. Memberships and lines are currently embedded arrays on a zone or list detail read. Those
arrays **stay**, unchanged: the zone screen renders its membership without a second call, and the
new collection routes serve the screens that edit one row.

`openapi.json` is regenerated and committed, and so are the wire types the admin app reads from it.

## 10. Tests

- Every new route refuses a velista user token and accepts an admin token.
- Each `AsOperator` method produces the same end state as its member facing twin, asserted against
  the same fixture, and emits the same event.
- Renaming a user through the operator route propagates to every one of that user's memberships.
- A direct write to `users.username` is not reachable from any route, asserted by searching the admin
  controllers for a repository save on that column.
- An operator edit of an `APPROVED` line leaves it `APPROVED`.
- An operator edit of a `REJECTED` line reopens it, which is the rule that applies to everyone.
- An operator approval writes a null `approvedByUserId` and the membership is `APPROVED`.
- Marking a zone for deletion writes both columns, and restoring clears both.
- Turning `sharedWithZone` off revokes no grant, asserted on `list_access`.
- No route accepts `email`, `emailVerifiedAt` or `kind` on a user, asserted on the DTO.
- There is no create, update or delete route for an admin, asserted over the whole route table.
- Each audited write records one row with the right actor, entity, id and diff, and a rolled back
  write records none.

## 11. Exit criteria

- An operator can change a user's username and display name. A zone's name and config. A
  membership's role and per zone name. A list's name and its two flags. A line's content, quantity,
  product set and approval.
- Every one of those goes through the service that owns the invariant, and emits what a member write
  emits.
- The four membership status verbs are reachable.
- Core and auth writes are audited transactionally, and so are `0074`'s named actions.
- Nothing in section 6 is reachable through any route.
- `openapi.json` and the admin wire types are regenerated and committed.

## 12. Out of scope

- A user's email address, verified state and kind. Section 6.1 and 6.2. A separate plan if wanted.
- Creating, editing or deleting an admin. Permanently, by `0071`.
- Editing a basket or a basket line. Section 6.4.
- Deleting a whole basket, which needs a service that does not exist.
- Creating a list line as an operator. Section 6.4.
- The per member list access grant set, which needs its own screen.
- Reordering lines.
- Any viewer over the three audit tables. `0075` section 5 applies unchanged.
