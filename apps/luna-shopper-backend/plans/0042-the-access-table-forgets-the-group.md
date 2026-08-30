# 0042 The access table forgets the group

> **Two reports, one table, and the same root cause under both.** Nobody can save the share
> sheet, and a member who joins a group sees none of the lists that group already has.
>
> The access table is written once, when a list is created, from the membership list as it
> stood at that instant, and nothing reconciles it afterwards. So it contains rows it should
> never have contained, which is why saving fails, and it is missing rows for everybody who
> arrived since, which is why a new member sees an empty group.
>
> Prerequisite reading: plan `0036` sections 2.4, 5 and 6, plan `0034`, and velista `0036`,
> which is the client half of both fixes.

## 1. Saving the share sheet always fails

Reproduced in four steps, in a group that has an owner, which is every group:

1. Create a group. You are its `OWNER`.
2. Create a list in it.
3. Open the list's settings, change one member's permissions, press Save.
4. `403`. Nothing is written.

The `PUT` carries every row the sheet read back from `GET /v1/lists/:id/access`, and one of
those rows names the owner. **Rule 2 rejects any entry naming a zone `OWNER` or `ADMIN`**,
refused even when the caller is themselves staff, and `setAccess` throws inside the
transaction on the first one it meets. The rest of the payload is never reached.

### 1.1 The sentence that is not true

Plan `0036` section 6 says of the read:

> Stored rows only. Group staff are absent by construction (section 2.4)...

Section 2.4's construction is that staff hold all four permissions by derivation, so nothing
needs to store a row for them. That is true of what the *checks* read. It is not true of what
the table *contains*, because two paths write rows without ever asking what role the
membership holds:

- **`ListService.create` writes the creator's row** with all four permissions. The creator of
  the first list in a new group is that group's owner.
- **`shareWithZone` writes a `{READ, WRITE, DECIDE}` row for every other approved member**,
  which includes every other admin.

So a staff row exists in the access table of essentially every list in the product, the read
returns it because the read has no filter, and the write refuses it. The three pieces are
each defensible and together they are a feature that has never worked.

### 1.2 The fix: never write one, never return one

Three ways out, and the third is the tempting one:

| | |
| --- | --- |
| **(a) do not write rows for staff memberships** | stops the table growing new ones |
| **(b) do not return rows for staff memberships** | stops the ones already there from reaching a client |
| (c) let rule 2 accept an entry that matches the stored row | rejected, see below |

**(a) and (b), and not (c).** Relaxing rule 2 would make the rule "staff rows are untouchable,
unless you send exactly what is already there", which is a rule about payload equality rather
than about authority, and it would keep the sheet in the business of echoing back rows it does
not own. Rule 2 as written says something true and simple: a staff row is meaningless, so
naming one is an error. It stays exactly as it is.

**(a)** is two lines: `create` skips the creator's row when the creator is staff, and the
`shareWithZone` grant excludes staff memberships. Neither loses anything, because a staff
membership holds all four by derivation whether a row exists or not.

**(b)** is a join. The read filters by the membership's **current** role, not by anything
recorded on the access row:

```sql
select a.* from list_access a
join zone_memberships m on m.id = a."membershipId"
where a."listId" = $1 and m.role not in ('OWNER', 'ADMIN')
```

Current role, deliberately, and this is the part worth reading twice. A member with an
ordinary stored row can be promoted to admin later. Their row is then inert, because the
derived grant is wider than anything it says, and it must not be returned. If they are
demoted again the same row becomes meaningful again and comes back, holding exactly the
permissions they had before they were promoted, which is the best available answer and is
free.

**No migration deletes anything.** The inert rows are the same rows that become meaningful
again on a demotion, and deleting data whose meaning can return is a worse trade than
filtering it at the one place it is read. The table keeps them, the read hides them, and the
write is now the only thing that could create a new one and no longer does.

### 1.3 The client stops sending what it did not change

velista `0036` section 3. The sheet sends only edited rows, which is what `PUT`'s
per-membership replace semantics were designed for (`0036` section 5.2). That alone would fix
the reported symptom, and it is not enough on its own: an ordinary member promoted to admin
between the read and the write would still produce a refused entry, and any other client
written against this API would hit the same wall. **Both halves ship**, and each is correct on
its own terms.

## 2. A member who joins later sees nothing

The second report: a list that is shared with the group should be visible to somebody who
joins afterwards, and it is not.

`shareWithZone` is **an action, not a property**. `CreateListRequest` carries it, `create`
reads it once, grants `{READ, WRITE, DECIDE}` to every member approved at that instant, and it
is then over. Nothing on the list records that it was meant to be open to the group, so
nothing can act on it later, and there is no query that can recover the intent afterwards: a
list shared with a group of one looks exactly like a list shared with nobody.

The consequence is worse than it first sounds. The ordinary way a household uses this product
is that one person sets it up, makes the lists, and then invites everybody else. **Every one
of those invitations produces a member who can see nothing at all**, and the only cure is for
somebody to open each list's settings and tick four boxes per person.

### 2.1 It becomes state on the list

`shopping_lists` gains `sharedWithZone`, a boolean, beside `autoApproveLines`, which is the
column it most resembles: list configuration, changed with `MANAGE`, governing what happens to
the next thing rather than acting on what is already there.

- **`create` stores it** instead of only acting on it. The grant it performs today is
  unchanged.
- **`update` may change it**, gated on `MANAGE` like every other field on that route.
- **`ListView` carries it**, so the settings sheet can draw it.

### 2.2 What each transition does

This is the whole of the behaviour and every row of it is a decision:

| | |
| --- | --- |
| **a member is approved into the zone** | they are granted `{READ, WRITE, DECIDE}` on every list in the zone with `sharedWithZone` true |
| **`sharedWithZone` goes false to true** | every currently approved non staff member is granted the same set, exactly as creation does |
| **`sharedWithZone` goes true to false** | **nobody is revoked.** New members stop being granted, and every existing row stays |
| **a member is kicked or leaves** | out of scope, and unchanged: their rows are dealt with by the membership path as they are today |

**Turning it off revokes nobody**, and that is the row most likely to be argued with. The
switch is about who arrives next. Somebody who turns it off to stop new members getting in,
and thereby silently removes eight people from a list they have been using all week, has been
handed a control that does something other than what it says. Removing a person is a row in
the share sheet, and it is one action for one person, which is what revocation should look
like. The copy on the control says so (velista `0036` section 7).

**A grant never narrows an existing row.** Somebody who already holds `MANAGE` on a list, and
is then granted the shared set because the switch was flipped on, keeps `MANAGE`. The grant is
a union with what is there, not a replacement, and this is the same rule `create` follows when
it grants to everybody except the creator.

### 2.3 Where the approval grant runs

`MembershipService.approve`, in one transaction with the status change. Approval is the only
door: `join` always writes a `PENDING` membership regardless of who is joining, so there is no
second path where a member becomes approved without passing through here.

One corner: `ZoneService.transferOwnership` sets the target to `APPROVED` if they were not.
That target is by definition about to be `OWNER`, and staff hold everything by derivation, so
there is nothing to grant and no branch is needed. It is written down because the absence of a
branch there will otherwise look like an oversight.

**No burst of events.** A member approved into a zone with nine shared lists does not produce
nine `list.my_access_changed` events. Their client is transitioning from pending to a member
and fetches the zone's lists as a matter of course, and the event exists for the case plan
`0036` section 8 names: access changing under somebody who is already looking. The approval
event they already receive is the signal, and the list query that follows returns the lists.

### 2.4 Backfilling the column

Every existing list needs a value, and the honest one can be recovered: **a list was shared if
it has an access row for an approved membership other than its creator's.** That row exists
only because `shareWithZone` ran, so it is the observable trace of the intent rather than a
guess about it.

```sql
update shopping_lists l set "sharedWithZone" = exists (
  select 1 from list_access a
  join zone_memberships m on m.id = a."membershipId"
  where a."listId" = l.id and m."userId" <> l."createdByUserId"
);
```

A list in a group of one comes out false, which is the one case where the trace cannot
distinguish a shared list from a private one. It is also the case where the answer does not
matter yet and where the first person to open the settings sheet will see the switch and set
it. `default false` on the column covers a row the statement misses.

## 3. What is not built

- **No list level public flag beyond the zone.** "Public" here means "open to this group", and
  a list visible outside its zone is a different product with a different threat model.
- **No retroactive grant for members kicked and re-approved** beyond what section 2.2 already
  gives them, which is the shared set. Their old row was deleted when they were kicked and
  nothing here brings it back.
- **No per member default.** A group where one person should always be a reader is a share
  sheet exercise, and inventing a membership level default would put two answers in the
  system for one question.

## 4. Contracts, docs and fixtures

- `ListView` gains `sharedWithZone`, and `UpdateListRequest` accepts it. Both in
  `libs/luna-shopper/contracts`.
- One migration: the column, its default, and the backfill statement in section 2.4.
- **`gateway/docs/openapi.json` regenerated in the same commit.** `ListView` is on several
  responses, so the diff is wider than the change and should be read rather than trusted.
- The seeded fixtures (`0013`) gain a group with a member approved *after* its lists were
  made, because that is the shape neither the fixtures nor the tests currently contain and it
  is the shape this plan is about.

## 5. Testing

- **The share sheet's save**, as an integration test through the gateway: an owner creates a
  list, changes a member's permissions, and the call succeeds. It fails today, and it is the
  test this plan exists to turn green.
- `GET /access` on a list whose creator is the owner returns **no** entry for the owner.
- A member with a stored row who is promoted to admin disappears from the read; demoted, they
  come back holding what they held.
- `setAccess` still rejects an entry naming staff, unchanged, which is the assertion that
  rule 2 was not quietly relaxed.
- A member approved into a zone with two shared lists and one unshared list can read exactly
  two.
- Flipping `sharedWithZone` on grants to everybody currently approved; flipping it off grants
  and revokes nobody, asserted by counting rows before and after.
- A member who already holds `MANAGE` still holds it after a grant.
- The backfill, against a fixture containing one shared and one private list, sets one true
  and one false.

## 6. Acceptance

- A group owner can change a member's list permissions and the call succeeds.
- No response from this API ever contains an access row for a group `OWNER` or `ADMIN`.
- No new access row is written for a staff membership.
- A member who joins a group can immediately see every list that group shares, and none that
  it does not.
- Turning sharing off removes nobody's access.
- The committed OpenAPI document is current in the same commit as the routes.
