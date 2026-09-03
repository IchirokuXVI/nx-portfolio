> **PR:** [#185](https://github.com/IchirokuXVI/nx-portfolio/pull/185)

# 0074 What the admin cannot yet reach

`0073` puts every existing admin capability behind `/v1/admin/**`. This plan adds the ones that were
never built.

The catalog half of the back office is close to complete already, because plan `0012` built it
owner curated from the start. The other half is not built at all: **there is no way to see a user,
a zone, a list or a shopping list that is not your own.** Every route in `zone.controller.ts` and
`list.controller.ts` is scoped to the caller, by design, and plan `0006` deferred the alternative
explicitly:

> **Admin listing (deferred)**: a back office listing of **all** zones with usage info, gated ...

Depends on `0073`. Deliberately last of the four before the audit trail, because it is the most
backend work for the least frequent use, and the admin app is useful without it.

## 1. Read, plus named actions. Not CRUD.

The rest of the back office is a generic resource editor, and this part is not. That is a decision,
not an inconsistency.

Catalog rows are flat, owner curated, and safe to edit as rows: an item's name is a name. Core rows
are not. A list line participates in settlements, generated list bindings, permission sets and
realtime broadcasts that other clients have already applied, and deleting a user runs
`account-deletion.service` across three databases. Handing an operator a raw row editor over that
is offering them a way to corrupt state that no code path can repair, in a system where the
invariants live in services rather than in constraints.

So core and auth get **listings and detail reads**, plus a small set of **named actions** which
call the same service methods the app calls. A named action reuses the code that maintains the
invariant. A row editor bypasses it.

| Named action              | Reuses                                                                    |
| ------------------------- | ------------------------------------------------------------------------- |
| Delete a user's account   | `account-deletion.service`                                                |
| Ban a member from a zone  | the existing `POST /v1/zones/:id/members/:membershipId/ban` path          |
| Kick a member             | the existing kick path                                                    |
| Transfer zone ownership   | the existing transfer path, which plan `0029` defines as two role changes |
| Regenerate a join code    | the existing regenerate path                                              |
| Resend email verification | auth's existing resend, bypassing the user facing throttle                |
| Delete a zone             | `zone-reaper.service`                                                     |

Nothing here writes a row directly. If an action has no service behind it, it is not in this plan.

## 2. The listings

| Surface        | Lives in | Filters                                                                                                           |
| -------------- | -------- | ----------------------------------------------------------------------------------------------------------------- |
| Users          | auth     | username (the plain `ix_users_username` exists for exactly this), email, `kind`, verified or not, created between |
| Admins         | auth     | none. A short read only list, see section 5                                                                       |
| Zones          | core     | **by a single user id**, plus created between                                                                     |
| Lists          | core     | by zone, by owner                                                                                                 |
| Shopping lists | core     | by zone, by owner                                                                                                 |
| Postal codes   | catalog  | by code, by whether anything serves them                                                                          |

Zones are filtered by one user and nothing else, which is what was asked for and is the whole
requirement. A general zone search with usage statistics is a different feature and is not here.

## 3. The join that does not exist

Users live in **auth's** Postgres. Zones and lists live in **core's**. There is no foreign key
between them and there deliberately never has been, which is the same seam `catalog-client.service`
keeps on the other side: ids cross the boundary as opaque values and no query mentions another
service's table.

So "list zones, filtered by user" is a core query taking a `userId` it does not validate, and any
screen wanting to show a username beside a zone is a **second call to auth and a join in the
gateway**, not a SQL join. Two consequences to design for rather than discover:

- The filter is cheap. Pass the id, core filters on `zone_memberships.userId`. No fan out.
- Decorating a list of zones with owner names is a fan out, N ids to auth in one batched call. Keep
  it to one batched call, and prefer screens that do not need it. The admin app was specified as
  not needing it.

Where an id cannot be resolved (a reaped user, a race), render the id. Never fail the listing
because the decoration failed.

## 4. Redaction

An operator listing users sees more than any user facing route returns, which is the point, but two
things stay out:

- **`passwordHash`, always.** It is never selected, not merely never serialized.
- **Nothing from another user's list content in a zone listing.** Counts, not contents. A zone
  detail screen may show membership and list names; reading the lines of a list belongs to the list
  detail read and should be a deliberate click, not a side effect of browsing zones.

The guest reachable composition problem from plan `0051` does not apply here (there is no
participant token in this surface), but its lesson does: redaction is by omission at the source,
not by a client choosing not to render a field.

## 5. Admins are visible and not editable

`0071` section 6 states the rule and this plan implements the read half: `GET /v1/admin/admins`
returns username, display name, `disabledAt` and `lastLoginAt` for every admin.

There is **no create, update or delete route**, and none may be added later without changing
`0071`. Managing admins requires the server. The screen exists so an operator can answer "who has
access", which is a question you want answerable from a browser and an action you do not.

The failed login attempts recorded by `0071` section 7 are **not** surfaced in this plan. They are
being written from the day `0071` ships, and the screen that reads them belongs to a dashboard that
is explicitly low priority.

## 6. Deliberately still missing after this plan

Two review queues that the data already supports and nothing yet reads. Both are noted here so the
next person does not conclude they were forgotten:

- **Price disagreements.** The rule that an automated fetch never overwrites an `ADMIN` price is
  implemented (plan `0038`, section 6.5), but the disagreement it is supposed to report has nowhere
  to live. Adding that is a schema decision, not a screen. Until then,
  `apps/luna-shopper-admin/plans/0005` mitigates the consequence by showing `priceSourceKind` and
  offering a revert.
- **Derived postal codes.** `SupermarketLocation.postalCodeSource = DERIVED` exists precisely as a
  review flag, and its own comment says it "is what an eventual admin queue sorts on". Nothing
  sorts on it. The admin location list in `0005` exposes it as a filter, which is most of the value
  for none of the work.

## 7. Tests

- Every listing refuses a velista user token and accepts an admin token.
- Zone filtering by user id returns only that user's zones, including ones where they are a member
  rather than the owner.
- `passwordHash` never appears in any response, asserted directly.
- Each named action produces the same end state as the equivalent user facing route.
- An unresolvable user id in a decorated listing renders the id and does not fail the request.

## 8. Exit criteria

- The admin app can list and read users, zones, lists, shopping lists and postal codes.
- Zones can be filtered to a single user.
- The named actions in section 1 exist and delegate to existing services.
- Admins are listable and not writable through any route.
- `openapi.json` regenerated and committed.

## 9. Out of scope

- Editing core rows directly, now and permanently.
- The price disagreement queue and the derived postal code queue, section 6.
- Any dashboard, including failed logins.
- The audit trail: `0075`.
