# 0036: a list permission is a set, not a role

> Prerequisite reading: `0007` section 1 (`list_access` as the access table) and section
> 4 (the three `require*` checks), `0017` section 3.2 (`READABLE_LIST`, the one
> definition of a readable list), and `0034` (what creating a list grants).
>
> Companion plans: `0037`, which takes approval away from the client once this plan has
> a permission to hang it on, and `velista/plans/0030`, which is the screen half.
>
> Verified against the source on 2026-08-28.

## 1. What the model says today

`ListAccess.role` is a `ListRole`, and `ListRole` has two members, `READER` and
`WRITER`. Everything a caller may do on a list is decided from that one column plus the
caller's `ZoneRole`, in three methods on `ListAccessService`:

- `requireRead` (`list-access.service.ts:69`): an approved membership, and then either
  manager status or any `list_access` row.
- `requireWrite` (`:110`): an approved membership and a row whose role is exactly
  `WRITER`. **No manager bypass.**
- `requireManage` (`:126`): the list's creator, or a zone `OWNER`/`ADMIN`. Never a row.

Four things that model cannot say, each of which is a bug somebody has already hit.

### 1.1 A group admin can open a list they cannot add a line to

`READABLE_LIST` (`zone-summary.sql.ts:49`) lets `OWNER` and `ADMIN` read every list in
the zone, and `requireManage` lets them rename, share and delete one. `requireWrite`
lets them do neither of the two things the screen is actually for: add a line, tick one
off. The frontend documents the consequence rather than fixing it, because it cannot:
`ListAbilitiesVm` (`velista/models/src/lib/list-view.ts`) carries three separate
booleans and says in its own doc comment that a zone `OWNER` can rename and delete a
list they cannot add a single line to.

Group admins are supposed to have **full access to every list in their zone**. Today
they have an odd, unexplainable subset of it.

### 1.2 Approving is not a list permission at all

`LineService.setApproval` (`line.service.ts:127`) asks `zoneAuthz.requireRole(zoneId,
userId, [OWNER, ADMIN])`. Approval is therefore a property of the **group**, not of the
list, and cannot be delegated. The person who actually walks the aisle is exactly the
person who should be allowed to say "yes, that one goes in", and today they can only be
allowed to by being made an admin of the whole group.

### 1.3 Ticking off and writing are the same permission, and should not be

`setStatus` (`:144`) requires `WRITER`, the same as `add` (`:79`) and `delete` (`:191`).
So there is no way to describe the flatmate who does the shop but does not decide what
goes on the list, which is the commonest arrangement this product has.

### 1.4 There is no state between "can do everything" and "can do nothing"

`CommentService.add` (`comment.service.ts:41`) asks only for an approved zone
membership, so a caller with no access to a list at all can comment on its lines, and a
caller with `READER` can too. Meanwhile `READER` is otherwise inert. The two ends are
both wrong: read should mean read, and commenting should follow access to the list.

## 2. The permission set

`ListRole` is replaced by `ListPermission`, and a `list_access` row holds a **set** of
them rather than one:

```ts
export enum ListPermission {
  READ = 'READ',
  WRITE = 'WRITE',
  DECIDE = 'DECIDE',
  MANAGE = 'MANAGE',
}
```

| Permission | What it grants |
| --- | --- |
| `READ` | See the list and everything on it: lines with both their statuses, comments, the presence of other viewers and editors, the counts, the name. Write nothing, **including comments**. |
| `WRITE` | Add lines. Edit and delete lines that are `PENDING` or `REJECTED`. Reorder. Comment. |
| `DECIDE` | Approve, reject and un-approve lines. Set a line's item status to `PENDING`, `READY` or `NOT_AVAILABLE`. Change the quantity of an **approved** line, and nothing else about it. Comment. |
| `MANAGE` | Everything above, plus edit and delete **any** line whatever its approval, grant and revoke other people's permissions on this list, change its configuration, rename it and delete it. |

One reading of the requirement is recorded here rather than left implicit. It describes
the person who can see everything and write nothing as having "just write access", and
then describes write access, one sentence later, as creating lines, editing unapproved
ones and commenting. The two cannot both be true, and the first is read here as
**read**: it is the only reading under which the second sentence, and the requirement's
own rule that every other permission implies read, both stand.

### 2.1 A set, because these are not a ladder

`WRITE` and `DECIDE` are independent. Somebody may hold either alone, and the two
describe different people: the flatmate who adds "olive oil" to the list on Tuesday, and
the flatmate who is in the shop on Saturday deciding that the olive oil goes in the
trolley and that they are out of tinned tomatoes. Ordering them would force one of those
two people to be a subset of the other, and neither is.

`READ` and `MANAGE` are the two ends and could have been ordinal, but a set that is
ordered at the ends and unordered in the middle is worse than a set, so all four are
stored the same way and every check asks whether one member is present.

### 2.2 `READ` is implied, and also stored

Any permission implies `READ`, per the requirement. That invariant is enforced at the
**write** boundary rather than at every read: `setAccess` adds `READ` to any non-empty
set it is given, so a stored set that lacks `READ` cannot exist. Every predicate that
asks "may this caller see the list" therefore asks for `READ` literally and nothing has
to remember to imply it.

The other half of the invariant: **an empty set is not stored, it is a deleted row.**
Revoking everything removes the `list_access` row. "No row" is then the single
representation of no access, which is what keeps `READABLE_LIST` a one line predicate
and stops a zero-permission row silently satisfying an `EXISTS`.

### 2.3 `MANAGE`, and why the enum member is not called `ADMIN`

The requirement asks for a better name than "edit list properties" and suggests "list
admin". The **user-facing** name is List admin, in `velista/plans/0030`. The enum member
is `MANAGE` for one reason: `ZoneRole.ADMIN` already exists in the same codebase and
frequently in the same expression. A line reading `role === ADMIN` beside one reading
`permissions.includes(ADMIN)` is a misreading waiting to happen, and the two mean
different things about different scopes. `MANAGE` also continues a word this service
already uses: `requireManage` is the check it will gate.

### 2.4 Group staff hold all four, always, and it is never stored

A zone `OWNER` or `ADMIN` holds `{READ, WRITE, DECIDE, MANAGE}` on **every list in the
zone**, derived from `ZoneRole` at check time. Not written to `list_access`, not
revocable, and not returned as an entry by `GET .../access`.

Derived rather than stored because a stored grant would need writing when somebody is
promoted, for every list that exists, and unwriting when they are demoted, and the two
would drift the first time either path failed halfway. Deriving it makes promotion a
single `UPDATE` on one membership row that is instantly correct everywhere, which is
what it already is.

The consequence the requirement asks for follows for free: **a list admin cannot revoke
a group admin's access**, because there is nothing to revoke. `setAccess` rejects an
entry naming a staff membership rather than quietly dropping it, so the caller is told
rather than left believing they did something.

Group staff have one further power that is not a permission on any list: **only they may
grant or revoke `MANAGE`** (section 5, rule 3). Being a list admin is therefore something
the group hands out, and a list admin cannot mint another one, promote themselves out of
review, or demote the peer who was appointed beside them.

### 2.5 A group admin can revoke a list creator's permissions

The other direction is asked for explicitly and needs a change to how the creator's
power is held. Today the creator's manage right is derived from
`ShoppingList.createdByUserId` inside `isManager` (`list-access.service.ts:50`), which
makes it exactly as irrevocable as staff status.

So the creator's power becomes an ordinary **row**: `ListService.create` writes their
`list_access` row with `{READ, WRITE, DECIDE, MANAGE}` instead of `WRITER`, and the
`createdByUserId` clause is removed from `isManager`, from `READABLE_LIST`, and from
`ListService.list`'s inline copy of the predicate (`list.service.ts:250`). A group admin
can then rewrite that row like any other, down to and including deleting it.

`createdByUserId` stays on the entity. It is still the honest answer to who made the
list, it is still what the frontend attributes a list to, and `0037` uses it. It simply
stops being an authorization input.

### 2.6 What `shareWithZone` grants

`0034` grants every other approved membership `WRITER`, and argues at length (its
section 2.2) that a shared list is shopped from and a reader cannot shop. That argument
survives intact and now has the vocabulary it wanted: the grant becomes
`{READ, WRITE, DECIDE}`. The group can add lines and can tick them off. `MANAGE` is not
in it, because governing the list is the thing the creator kept.

**This is deliberately not the same answer as section 3.1**, and the difference is worth
defending because the two look like the same question. The migration reinterprets a
value somebody else chose years of product-decisions ago, under a vocabulary that had no
word for approving; inventing a grant there would be putting words in their mouth. This
grant is a decision being made now, by this plan, for a list created after it ships, and
`0034` already made the argument for what that decision should be: a newly shared list
on which only its creator can tick anything off is the exact failure `0034` exists to
prevent, one release later and with a better vocabulary.

A group that wants approval to mean something narrows the grant in the share sheet, once
per list, which is where every other exception to a default in this product lives.

## 3. Storage and migration

`list_access.role` (`list_role` enum) is replaced by `list_access.permissions`, a
`list_permission[]` that is `NOT NULL` with no default. A new migration beside the
squashed baseline (`1756000100000-InitialCoreSchema.ts`, plan `0025`), not an edit to
it: the baseline is deployed.

The migration:

1. creates the `list_permission` enum type,
2. adds `permissions list_permission[] NOT NULL DEFAULT '{}'`,
3. backfills `READER` to `{READ}` and `WRITER` to `{READ,WRITE}`,
4. inserts or widens a row for every list's creator so it contains all four,
5. deletes any row left with an empty set,
6. drops the default, drops `role`, drops the `list_role` type,
7. adds a GIN index on `permissions` only if section 3.2 turns out to need one.

`down` reverses it lossily: `MANAGE`-or-`WRITE` becomes `WRITER`, anything else becomes
`READER`. Stated rather than hidden, because a rollback that quietly promotes readers
would be worse than one that is known to flatten.

### 3.1 `WRITER` backfills to `{READ, WRITE}`, and what that costs

The name maps to the two permissions it names, and nothing else. A migration that
handed out `DECIDE` would be inventing a grant nobody made: approving a line is a
permission that has never existed on a `list_access` row, and inferring it from a role
called `WRITER` would mean the deploy quietly gave every writer in every group a power
their group had reserved to its admins. A migration may not do that.

**The cost, stated plainly.** Today's `WRITER` can set a line to `READY`, and after this
migration they cannot, because ticking off has moved into `DECIDE`. Every existing
member who does the shopping needs `DECIDE` granting once, from the share sheet, by a
list admin or a group admin. Until somebody does, the people who shop from a list can
add to it and cannot tick anything off.

Three things make that acceptable where it would not normally be:

- The share sheet is reachable in the same release (section 6), so the fix is available
  the moment the problem is, rather than being a wait for a follow-up.
- Group admins are unaffected. They hold all four on every list (section 2.4), so a
  group is never left with nobody who can complete a shop.
- Luna Shopper has no production traffic yet. The row this argument is about is a
  developer's seed data, not somebody's Saturday.

The frontend must not present the resulting state as a broken screen.
`velista/plans/0030` section 4 gives the `WRITE`-only caller a caption naming who does
the ticking, and that caption exists largely for the fortnight after this migration.

**Not solved by widening later.** If the first week shows the grant was needed after
all, the answer is a one-off script that adds `DECIDE` to the rows a group asks for, not
a re-run of the migration. A migration reinterprets a value somebody else chose; a
script carries out a choice somebody made today.

### 3.2 Cost

Every predicate gains an array containment test on a row it was already fetching.
`READ = ANY(permissions)` on a `list_access` row already located by
`uq_list_access (listId, membershipId)` is evaluated after the index lookup, on one row,
which is not measurable. `READABLE_LIST`'s `EXISTS` is unchanged in shape. No new index
is added speculatively; if the zone summary ever shows one is needed, GIN on
`permissions` is the answer and it is one migration.

## 4. What each check becomes

`ListAccessService` grows one private resolver and expresses every public check through
it:

```ts
/** The caller's effective permissions on a list. Empty means no access at all. */
async permissionsFor(list: ShoppingList, userId: string): Promise<Set<ListPermission>>
```

It resolves the membership once, returns all four for staff, and otherwise returns the
row's set, or an empty set. Every `require*` method is then one membership test against
it, and there is exactly one place that knows staff are special.

| Method | Was | Becomes |
| --- | --- | --- |
| `requireRead` | row exists, or manager | holds `READ` |
| `requireWrite` | row role is `WRITER` | holds `WRITE` |
| `requireManage` | creator or zone staff | holds `MANAGE` |
| *(new)* `requireDecide` | did not exist | holds `DECIDE` |
| `readableListIds` | `READABLE_LIST` | `READABLE_LIST`, rewritten for the array |

And the call sites:

| Operation | Was | Becomes |
| --- | --- | --- |
| `line.add` | `WRITER` | `WRITE` |
| `line.update` | `WRITER`, any line | `WRITE` on a `PENDING`/`REJECTED` line; `DECIDE` for the quantity of an `APPROVED` line and nothing else (`0037` section 4); `MANAGE` for any field of any line |
| `line.delete` | `WRITER`, any line | `WRITE` on a `PENDING`/`REJECTED` line; `MANAGE` for any line |
| `line.reorder` | `WRITER` | `WRITE` |
| `line.setStatus` | `WRITER` | `DECIDE` |
| `line.setApproval` | zone `OWNER`/`ADMIN` | `DECIDE` |
| `comment.add` | approved membership | `WRITE` or `DECIDE` |
| `comment.list` | read access | `READ` |
| `list.update` / `list.delete` / `list.setAccess` | creator or zone staff | `MANAGE` |

### 4.1 Who may touch an approved line

Three different answers, and the whole shape of the model is in them:

- **`WRITE` may not touch it at all.** `WRITE` covers `PENDING` and `REJECTED` lines
  only, which is the requirement stated exactly. A writer whose line has been agreed to
  cannot quietly change what was agreed to.
- **`DECIDE` may change its quantity, and nothing else.** That single field is what a
  person in the aisle learns that the list did not know, and `0037` section 4 is about
  what the server does with it. Content, item reference and position are untouched.
- **`MANAGE` may edit any field of any line**, whatever its approval, and delete any
  line. A list admin governs the list, and a governed thing needs somebody who can fix
  it: a line approved with a typo in it, an item the group agreed to that turns out to be
  the wrong one, an approved line that should never have existed at all.

`READ` may do none of it, which the table above already says and is worth saying twice
because "can see everything" is easy to read as "can correct a small thing".

There is a second path to editing an approved line that needs no `MANAGE`, and it is the
one a plain `DECIDE` holder uses: `DECIDE` includes putting a line back to `PENDING`, so
un-approve, edit, approve reads correctly and leaves the line's approval state saying
what happened. Somebody holding `WRITE` and `DECIDE` together does it in three taps. The
`MANAGE` bypass is the shortcut for the person who governs the list, not the only way
through.

### 4.2 Editing a rejected line puts it back to `PENDING`

Required, and it is what makes rejection a conversation rather than a dead end. On
`line.update`, when the line's `approvalStatus` is `REJECTED`, the save also sets
`approvalStatus` to `PENDING` and clears `approvedByUserId`. A `PENDING` line stays
`PENDING`. An `APPROVED` line is not reachable by this path at all (section 4.1).

This happens on **any** edit, including a quantity-only one, and including on a list
that auto-approves (`0037` section 3): the option decides what a **new** line starts as,
and a rejection somebody made on purpose is not undone by an edit.

### 4.3 `READ` is genuinely everything else

The requirement asks that a read-only caller see everything, and it is worth writing
down what everything is, because the answer is currently spread over four plans: the
list's name and configuration, its lines with `approvalStatus`, `status`, quantity,
position and author, its comments, its counts (`0017`), who is viewing it and who is
editing which line (`0022`, `0032`). All of those already flow from `requireRead` or
from `readableListIds`, so `READ` needs no new plumbing.

The one thing `READ` does **not** include is the access table itself. `GET .../access`
is `MANAGE` (section 6). Who else can write to a list is governance, not content.

## 5. `setAccess`, and who may grant what

`SetListAccessRequest.entries` becomes `{ membershipId, permissions: ListPermission[] }`.
The handler (`list.service.ts:166`) keeps its upsert-per-entry shape and gains five
rules, applied in this order:

1. **The caller holds `MANAGE`.** Unchanged in spirit, narrower in fact: it is now a
   permission rather than creator-or-staff.
2. **An entry naming a zone `OWNER` or `ADMIN` is rejected**, with a message saying group
   admins always have full access to every list. It is refused even when the caller is
   themselves staff, because the row would be meaningless either way; the difference the
   requirement draws between a list admin and a group admin is about **other** rows, not
   about staff rows.
3. **Only a zone `OWNER` or `ADMIN` may change the `MANAGE` bit**, in either direction.
   An entry from any other caller whose `MANAGE` differs from what the stored row already
   holds is rejected. Section 5.1.
4. **`READ` is added to any non-empty set.** Section 2.2.
5. **An empty set deletes the row.** Section 2.2. This is how access is revoked, and it
   is the same call, so a share sheet has one save button rather than a save and a
   remove.

Subject to those, a list admin who is not group staff may grant and revoke `READ`,
`WRITE` and `DECIDE` on any non-staff row, including the creator's. A group admin may do
that and set `MANAGE` as well. That is the whole of the asymmetry the requirement asks
for: **staff rows are untouchable, `MANAGE` is the group's to hand out, every other row
and bit is a list admin's, and the creator's row is an ordinary row** (section 2.5).

### 5.1 Why a list admin cannot appoint another one

`MANAGE` is grantable, unlike the derived staff grant, so somebody other than the creator
can be made a list admin. What they cannot then do is make a third.

The reason is that `MANAGE` is not a stronger version of the permissions beside it, it is
a different kind of thing: the other three say what you may do to the list's contents,
and `MANAGE` says who else may do anything at all. A permission that can grant itself has
no ceiling, and the first list admin appointed by mistake could appoint their way out of
being removed, or demote the person who appointed them. Reserving the bit to the group
keeps a fixed number of people who can settle any argument about a list, and that number
is the group's admins, which is where every other governance answer in this product
already lives.

The rule is symmetric on purpose. Revoking somebody's `MANAGE` is the same power as
granting it, so a list admin may do neither, which also means a list admin cannot strip
the creator's `MANAGE` while leaving the rest of the row alone.

Note the interaction with rule 5: an empty set deletes the row. A non-staff list admin
clearing a row that holds `MANAGE` is therefore a `MANAGE` change and is refused by rule
3, which is the right answer and would be an obvious hole if the rules were checked in
the other order.

### 5.2 Not a partial update

`setAccess` replaces each named membership's set outright and leaves unnamed memberships
alone. It is not `PATCH` semantics on the set (no add-these, remove-those), because a
share sheet holds the whole answer for a row in front of the person pressing save, and
two ways to express the same change is two ways for it to be expressed wrongly.

## 6. Reading the access table back

`GET /v1/lists/:id/access` lands, gated on `MANAGE`, returning:

```ts
{ listId: string; entries: { membershipId: string; permissions: ListPermission[] }[] }
```

Stored rows only. Group staff are absent by construction (section 2.4) and the client
already knows who they are from `MembershipStore`, so putting them in the payload would
be a second, staler copy of a fact the caller has.

This endpoint is the missing half of a feature that is already written: `velista`'s
share sheet, its `ListApi.getListAccess`, and its tests all exist behind the
`LIST_ACCESS_READABLE` constant, waiting for exactly this route
(`velista/plans/0012` section 5.5). `PUT` without `GET` is why: a sheet that cannot read
the current set would revoke everybody it did not happen to include.

## 7. The caller's own permissions ride on `ListView`

`ListView` gains `myPermissions: ListPermission[]`, the caller's effective set including
the derived staff grant, filled by every path that returns a `ListView`: `create`,
`update`, and each item of `list`.

This is the change that lets the screen stop guessing. Today `ListAbilitiesVm.canWrite`
is **optimistic**: the client offers the composer to everybody, and discovers a reader
by having their first write refused. That was the right call when the server told it
nothing, and it is the wrong call the moment the server can, because with four
permissions the number of controls a caller might be offered and refused goes from one
to most of the screen.

It rides on `ListView` rather than on a second request because it is per-caller data
about a resource the caller is already fetching, and a separate round trip would let the
two disagree for exactly as long as it took.

`ListPage` is a page of `ListView`, so the dashboard and the group page get it too, for
free, in the query they already run.

## 8. When permissions change, the screen changes

`velista/plans/0020` states the rule this section obeys, about zone roles:

> A role is a permission. If the server changes it, the screen showing what it permits
> changes with it, without being asked. A control left on screen for somebody who may no
> longer press it is not a cosmetic problem: every press of it is an error.

`setAccess` already emits `RealtimeEvent.ListAccessChanged` to the list room with
`{ listId }` and nothing else, which `room-sync.service.ts:35` calls out as the awkward
case: the payload names nobody, so every client in the room re-syncs. That is adequate
for people who **kept** access and useless for the two people it is actually about.

So `setAccess` additionally emits, on the **user channel** (`0030`), one event per
affected membership:

```
list.myAccessChanged -> { listId, zoneId, permissions: ListPermission[] }
```

Addressed to the user behind the membership, carrying their new effective set, including
an empty array for somebody who just lost the list entirely. Three things then work
without a refresh: a client whose set shrank redraws the screen it is on from the new
set, a client that lost access leaves for the `gone` state velista already has, and a
client that just **gained** access learns about it at all, which the room event by
construction cannot tell them because they were never in the room.

`ListAccessChanged` stays as it is. It still correctly says "the access table for this
list changed" to the people watching it, and `sweeps.ts:65` still uses it to re-evaluate
rooms.

## 9. Contracts, docs and fixtures

- `libs/luna-shopper/contracts`: `ListPermission` replaces `ListRole` in
  `enums/list.enums.ts`, `enums.schemas.ts`, `ListAccessEntry`, `SetListAccessRequest`,
  `ListView`, plus a new `GetListAccessRequest`/`ListAccessView`.
- `libs/luna-shopper/test-fixtures`: `demo-world.ts`, `factories.ts` and `types.ts` all
  name `ListRole` and all need the new shape. The demo world is the right place to make
  the four permissions concrete: give it one member holding `WRITE` alone and one
  holding `DECIDE` alone, because those two are the states nothing currently exercises.
- **Regenerate the OpenAPI document** (`npx nx run luna-shopper-backend-gateway:openapi`)
  and commit it. `openapi-document.spec.ts` fails on a stale one, so a forgotten
  regeneration is a red PR.

## 10. Testing this, and putting it away afterwards

This plan is the one that genuinely needs a backend slot of its own, and it is worth
saying why, because most work does not. It runs a migration, it rewrites rows in
`list_access` for every list in the database, and its acceptance needs four accounts in
one group holding four different permission sets. That is a disruptive migration and an
isolated database, which is exactly the case `CLAUDE.md` reserves a Luna slot for.

```sh
bash k8s/e2e/luna-shopper-backend/luna-slot.sh --list      # before claiming anything
bash k8s/e2e/luna-shopper-backend/luna-slot.sh --up        # compose, migrations, five services
bash k8s/e2e/luna-shopper-backend/luna-slot.sh --restart --services gateway,core
bash k8s/e2e/luna-shopper-backend/luna-slot.sh --down      # ALWAYS, including on an abandoned task
```

- **`--list` first, every time.** It reads every worktree's claim and probes the ports,
  so it is the only accurate answer to what is already running. A hand rolled
  `docker compose up` writes no claim and no per slot `.env`, so it collides with slot 0,
  which is the developer's own.
- **A front end to look at it with is a separate, cheaper claim.**
  `tools/dev/ng-slot.sh --up --apps velista --backend-slot <n>` points velista at this
  slot. The two numbers are independent and need not match.
- **`--down` when finished, not to check your work.** A Luna slot is five Nest services
  at roughly 230 MB each plus eight containers and its own Postgres volumes, and it is
  the half that exhausts a 32 GB machine first. Leaving one up after an abandoned task is
  the most expensive thing anybody does by accident here.
- **The migration is the part to run twice.** Once forward against a database seeded with
  both `READER` and `WRITER` rows, then `down`, then forward again. Section 3 says the
  reverse is lossy on purpose, and a lossy reverse is only safe if somebody has watched it
  happen. `luna-slot.sh --down` and a fresh `--up` is the cheapest way to get a clean
  database to try it against again.

## 11. What is deliberately not built

- **A zone-wide default permission set for new lists.** `0034`'s checkbox already
  carries the answer and remembers nothing, which is the version that cannot get out of
  step. Unchanged.
- **Retroactive grants when a member is approved.** Still the share sheet's job, still
  the same gap `0034` section 2.4 names.
- **Per-line permissions.** Nobody asked, and the approval state machine already
  provides the per-line answer.
- **A `MANAGE` holder editing an approved line in place.** Section 4.1.
- **Permission groups or named roles built out of the four.** A share sheet with four
  checkboxes is legible; a share sheet with four checkboxes and five presets built from
  them is not.

## 12. Acceptance

1. A zone admin who has never been granted anything on a list opens it, adds a line,
   ticks it off, approves somebody else's, renames the list and changes who may use it.
   All six succeed.
2. A member holding `{READ}` sees every line, every comment, the counts and the presence
   indicators. Every write they attempt is refused, **comments included**.
3. A member holding `{READ, WRITE}` adds a line, edits a pending one, deletes a rejected
   one, comments, and is refused when they try to approve a line, set one to `READY`, or
   touch an approved line in any way.
4. A member holding `{READ, DECIDE}` approves a line, rejects one, sets one to
   `NOT_AVAILABLE`, comments, and changes an approved line's quantity. They are refused
   when they try to add a line, edit an unapproved one, or change an approved line's
   content.
5. A member holding `{READ, MANAGE}` edits the content of an approved line and deletes
   another, both of which every other permission is refused.
6. Editing a `REJECTED` line returns it to `PENDING` and clears its approver.
7. A list admin who is not group staff tries to revoke a group admin's access and is
   refused with a message naming the reason. A group admin revokes the list creator's
   access entirely, and the creator's next request for the list is a 403.
8. That same list admin tries to grant `MANAGE` to a fourth member, and is refused. They
   try to remove `MANAGE` from the creator, and are refused. They grant that fourth member
   `{READ, WRITE}` in the same sheet and it succeeds. A group admin then grants the
   `MANAGE` that was refused, and it succeeds.
9. `GET /v1/lists/:id/access` returns the stored rows to a `MANAGE` holder and 403s for
   a `WRITE` holder. Group staff appear in no entry.
10. Changing a member's permissions while they have the list open redraws their screen
    without a refresh, and revoking them entirely moves them off it.
11. The migration runs against a database holding both `READER` and `WRITER` rows and
    produces sets matching section 3: `READER` to `{READ}`, `WRITER` to `{READ, WRITE}`
    with no `DECIDE`, and every list's creator holding `MANAGE`. Its `down` is run once
    and watched, per section 10.
12. The Luna slot all of this ran in is `--down` afterwards, and `--list` says so.
