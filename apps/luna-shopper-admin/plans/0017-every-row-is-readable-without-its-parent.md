> **PR:** [#274](https://github.com/IchirokuXVI/nx-portfolio/pull/274)

# 0017 Every row is readable without its parent

Two lists in the back office refuse to draw anything until a parent is named. Memberships want a
zone, and list lines want a list. The filter that names the parent is not a filter at all: it is a
question the screen asks before it will work, and there is no answer to it that means "all of them".

An operator looking for one person's memberships across every household, or for the lines somebody
wrote across every list, has no way to ask. The zone or the list is exactly the thing they do not
know yet, which is why they came to a list screen.

This plan lifts that requirement. It is the second half of `0012`: that plan gave a reference filter
a way to say "none", and this one gives the two filters that cannot be left unset a way to be left
unset.

Depends on `0004` for the list, the descriptors and the reference filter, on `0009` for the two
screens it edits, and on `0012` for the filter vocabulary it borrows.

## 1. What was asked, and what the tables answer

The request named four filters:

| Screen         | Filter       | Asked for            |
| -------------- | ------------ | -------------------- |
| Memberships    | zone         | no zone              |
| Lists          | zone, author | no zone, no author   |
| List lines     | list         | no list              |
| Shopping lists | owner        | belonging to no user |

**Every column behind those filters is `NOT NULL`.** `zone_memberships.zoneId`,
`shopping_lists.zoneId`, `shopping_lists.createdByUserId`, `list_lines.listId` and
`generated_lists.ownerUserId` are all declared without `nullable`, and the first four cascade with
their parent. There is no row in any of those tables that points at nothing, and there is no way to
make one. A "None" choice over them would be a control whose only answer is an empty list, which is
what `0012` section 4 refused to build and still refuses.

So the request is not about null columns. It is about two screens that will not open, and the
distinction matters because the fix is on the other side of the app. Lists and shopping lists have
no such problem: neither declares `requires`, both open unfiltered, and a blank picker on either
already means every zone and every author. **Those two bullets need no work, and this section is the
record of why.**

What memberships and list lines have that lists and shopping lists do not is `requires`
(`libs/luna-shopper-admin/feature-people/src/lib/memberships.ts`, `list-lines.ts`). It is not a
filter that is hard to clear. It is a screen that states a missing filter instead of listing
anything, because the collection behind it is addressed under its parent and there is no address to
send a request to until the parent is known.

## 2. The row has to carry its own parent

The reason the requirement exists is one property of the gateway contract, and it has to be fixed
first or nothing else in this plan works.

`AdminZoneMemberView` carries no `zoneId` and `AdminListLineView` carries no `listId`
(`libs/luna-shopper/contracts/src/lib/messages/admin-core.messages.ts`). The parent is in the URL, so
the response leaves it out. The app puts it back:

```ts
// resource-api.ts
// The rows come back without the values that addressed them, so they go
// back on. Otherwise a membership has no address and cannot be opened.
const stamped = this._stampValues(query.filters ?? {});
```

`_stampValues` reads the parent out of **the filter**, and stamps it onto every row
(`libs/luna-shopper-admin/data-access/src/lib/resource/resource-api.ts`). A membership's row id is
the pair `(zoneId, membershipId)`, so without the stamp `compositeIdOf` produces nothing and the row
cannot be opened, edited or acted on.

That machinery works only because the filter is always set. Lift the requirement and the stamp has
nothing to copy: an unscoped read would return rows with no zone on them, and every one of them would
be unopenable. A cross zone list where no row can be clicked is worse than no cross zone list.

**So both views gain their parent, and a name to draw it by.** `AdminZoneMemberView` gains `zoneId`
and `zoneName`. `AdminListLineView` gains `listId` and `listName`. This is the shape
`AdminListView` already has: `AdminListService.list` joins `zones` for `zoneName` so that a list can
be read without its zone being known, and the two reads here do the same join for the same reason.

The name is not decoration. A cross zone membership list whose rows show only a username and a role
is a list an operator cannot use, because the one fact that distinguishes two rows is the household
they are in.

Once the views carry the parent, `_stampValues` copies a value the row already holds. The machinery
is left alone rather than deleted, because `locations` and `location-items` still lean on it, and
narrowing it is not this plan's job.

## 3. Two flat collections, and two that go away

**`GET /v1/admin/memberships` and `GET /v1/admin/list-lines`**, each taking its parent as an ordinary
optional query parameter, `zoneId` and `listId`. Both live in
`apps/luna-shopper-backend/gateway/src/app/admin/admin-core.controller.ts` as two small controllers
beside the four already in that file, because a path prefix is what makes a controller and neither
new path sits under an existing one.

**`GET /v1/admin/zones/:id/members` and `GET /v1/admin/lists/:id/lines` are removed.** They answer
exactly the question the new routes answer with the parameter set, and two ways to ask one question
is the shape that drifts. Nothing else reads them: the zone detail screen renders its members from
the embedded `members` array on the zone read, the list detail screen renders its lines the same way,
and the collections exist only to feed these two descriptors.

**Everything that addresses one row stays nested and stays exactly as it is.**
`GET`, `PATCH` and the four membership verbs under `admin/zones/:id/members/:membershipId`, and the
line reads and writes under `admin/lists/:id/lines/:lineId`, are untouched. A membership's address is
genuinely the pair, `0009` section 3.2 says why, and this plan does not disagree with it. What
changes is where the app learns the first half of the pair: from the row, not from the filter.

### 3.1 One order, whether or not the parent is named

`AdminZoneService.listMemberships` orders by `("createdAt", id)` and
`AdminListService.listLines` orders by `(position, id)`, the household's own order.

A cross list read cannot order by `position` alone. It is a `double precision` that means a place
inside one list, so ordering four lists by it interleaves them into an order that means nothing.

**Both reads order by their parent first**: `("zoneId", "createdAt", id)` and
`("listId", position, id)`, with the cursor carrying all three. Inside one parent that is identical
to the order each read uses today, so a scoped read is unchanged down to the row order and the
cursor. Across parents it groups the rows by the list or the zone they belong to, which is the only
grouping either list is readable in. One order, one cursor shape, no branch.

`requireZone` and `requireList` run only when the parameter is given. Without it there is no parent
to prove exists, and an unknown parent is still a 404 rather than an empty page.

### 3.2 What the contracts gain

`ListAdminMembershipsRequest.zoneId` and `ListAdminListLinesRequest.listId` become optional.
`AdminMembershipPage` and `AdminListLinePage` are unchanged: only the view inside them grows the two
fields of section 2.

This plan adds no filter beyond the parent. A cross zone membership list would read better with a
status choice and a cross list line list with an approval choice, and both are cheap, but neither was
asked for and each is a filter on a route this plan is already changing. They belong in the plan that
wants them.

## 4. The two descriptors

`MEMBERSHIPS` and `LIST_LINES` drop `requires`, and their gateway sources drop `collectionPath`,
`pathParams` and the `ADMIN_ZONE_MEMBERS_PATH` placeholder that was never a URL. The collection is
now a plain path with a plain query parameter, so `path` says what it always meant:
`admin/memberships`, `admin/list-lines`. `memberPath` stays, because the member address is still the
nested one, and `compositeParts` still splits the pair. `key` and `idField` are unchanged.

Dropping `pathParams` is what takes the parent out of the path and puts it on the query string, and
it is a deletion rather than an edit because there is no longer a path segment to keep it out of.

Each list gains one column, the parent's name, and each filter keeps its label. `MEMBERSHIPS`
columns become `zoneName, username, role, status, createdAt` with `compact: ['zoneName', 'role']`,
because on a phone the household is the fact that tells two rows apart. `LIST_LINES` gains
`listName` at the front for the same reason.

The `zoneId` and `listId` **fields** on both descriptors stay `editable: false` and stay reference
fields. They are drawn on the form, they now arrive from the server rather than from a stamp, and
nothing about them changes.

## 5. The memory gateway

`ResourceMemoryGateways` serves both resources from `MEMBERSHIP_SEED` and `LIST_LINE_SEED`, and both
seeds already stamp the parent onto every row:

```text
export const MEMBERSHIP_SEED: readonly MembershipRow[] = ZONE_SEED.flatMap(
  (zone) => zone.members.map((member) => ({ ...member, zoneId: zone.id }))
);
```

So the in memory rows are already the shape section 2 asks the gateway for, and the only change is
that `zoneId` and `listId` arrive as ordinary filter parameters rather than as a path. The memory
gateway already matches a parameter against a column of the same name, so an unset one lists
everything and a set one narrows, with no new code. `zoneName` and `listName` go on the two seeds
beside the ids they belong to.

`MembershipRow` and `ListLineRow` in `people-seed.ts` are `Wire...View & { readonly zoneId: string }`
today. Once the wire type carries the field the intersection is redundant, and both aliases collapse
to the wire type plus the name field, or to the wire type alone once the name is on it too.

## 6. Testing

- `people-descriptors.spec.ts`: neither descriptor declares `requires`, neither declares
  `pathParams`, both still build a member path from the pair, and both list their parent's name.
- `resource-api.spec.ts`: a collection read with no filter set sends no parent parameter and returns
  rows whose id is still a valid pair, taken from the row rather than from the stamp.
- `admin-zone.service.spec.ts` and a new `admin-list.service` case: with the parent given, the rows
  and the cursor are exactly what they were. With it absent, rows from two parents come back grouped
  by parent and paging through the whole set visits each row once.
- The same two: an unknown parent is a 404, and an absent one is not.
- `admin-core-query.http.spec.ts`: both new routes accept the parameter, accept its absence, and
  refuse a value that is not a uuid. The two removed routes answer 404.
- `resource-memory.spec.ts`: the unscoped read lists every seeded row, and the scoped read lists one
  parent's.

## 7. Exit criteria

- Opening Memberships with no zone chosen lists memberships from every zone, each showing the
  household it belongs to, and clicking one opens it.
- Opening List lines with no list chosen does the same across every list.
- Choosing a zone or a list narrows the same list, in the same order it is in today.
- Lists and Shopping lists are untouched, and neither picker gained a "None" choice.
- `openapi.json` and `wire-types.ts` are regenerated and committed, and the gateway's document spec
  passes.
