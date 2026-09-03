> **PR:** [#192](https://github.com/IchirokuXVI/nx-portfolio/pull/192)

# 0007 The people and what they share

Users, zones, lists and shopping lists. The last of the screens, and the one that deliberately does
less than the rest of the app.

Depends on `0004` and on `apps/luna-shopper-backend/plans/0074`, which builds the reads and the
named actions this renders. It is last because it is the most backend work for the least frequent
use, and the app is useful without it.

## 1. Read, and a short list of actions

Every other part of the back office is a full editor. This part is not, and the reason is that
these rows are not editable in the way catalog rows are.

A catalog item's name is a name: writing it is safe and complete. A list line participates in
settlements, generated list bindings, permission sets and realtime broadcasts other clients have
already applied. Deleting a user runs `account-deletion.service` across three databases. The
invariants live in services rather than in constraints, so a generic row editor over them offers a
way to corrupt state that no code path can repair.

So: listings, detail reads, and the named actions from `0074` section 1. Each action calls the
service the user facing app calls. Nothing writes a row directly.

| Action                    | On         |
| ------------------------- | ---------- |
| Delete a user's account   | user       |
| Resend email verification | user       |
| Ban a member              | membership |
| Kick a member             | membership |
| Transfer zone ownership   | membership |
| Regenerate a join code    | zone       |
| Delete a zone             | zone       |

An action with no service behind it does not appear. If an operator needs something not on this
list, it is a backend plan, not a form.

## 2. The screens

**Users.** Filterable by username, email, kind, verified state and creation date. `ix_users_username`
exists specifically so this search is possible. The detail view shows the account, its zones, and
the named actions.

Two things the list must get right. `username` is the global handle and is **not unique**, so the
screen never treats it as an identifier: rows are keyed and linked by id, and two identical
usernames are an ordinary result rather than a bug. And `displayName` is whatever an identity
provider supplied, which for a Google sign in is a real full name, so it is shown in the detail
view where an operator has a reason to look and not in a list anybody might screenshot.

**Zones.** Listable, and **filterable by a single user**. That is the whole requirement and the
screen does not exceed it: there is no usage dashboard, no ranking and no cross zone statistics.
The detail view shows membership with roles and states, and the zone's lists by name and count.

**Lists and shopping lists.** By zone and by owner. The detail view shows the list and its lines
read only. Reading the lines is a deliberate navigation, not something that happens while browsing
zones.

**Admins.** A short read only table: username, display name, whether disabled, and last login.
`0071` and `0074` both state the rule and this screen implements the visible half of it: **an admin
can be seen and cannot be created, edited or deleted from here, ever.** The screen says so in
place, naming the server command as the way to change anything, so an operator looking for a
missing button finds the answer instead.

## 3. What is not shown

- **Password hashes**, which `0074` never selects in the first place.
- **List contents inside a zone listing.** Counts, not contents.
- **Anything from `0071`'s failed login records.** They are being written from the day that plan
  ships, and the screen that reads them belongs with a dashboard that is explicitly low priority
  and is not in this plan set.

## 4. The username that will not resolve

Users live in auth's database and zones live in core's, with no foreign key between them, so any
screen showing a name beside a zone is doing a second call and a join in the gateway.

Where an id does not resolve, because a user was reaped or a race lost, the screen **renders the
id**. A listing never fails because a decoration failed, and a missing name is not an error state.

## 5. Confirmation

Every action in section 1 is destructive or hard to reverse, and several are irreversible. Each is
confirmed, and the confirmation names the specific thing being acted on rather than asking a
generic question. Deleting an account says whose, and says what goes with it.

## 6. Tests

- Zone filtering by user returns zones where the user is a member as well as those they own.
- No response rendered by these screens contains a password hash, asserted at the data layer.
- An unresolvable user id renders the id and the listing succeeds.
- Each named action calls its route and reflects the result.
- The admin table offers no create, edit or delete control.
- Two users with the same username render as two distinct rows.

## 7. Exit criteria

- Users, zones, lists and shopping lists can be found and read.
- Zones can be filtered to one user.
- The seven named actions work and are confirmed.
- Admins are visible and unmanageable.

## 8. Out of scope

- Editing any core or auth row directly, now and permanently.
- A dashboard of any kind, including failed logins.
- Support tooling beyond the seven actions.
