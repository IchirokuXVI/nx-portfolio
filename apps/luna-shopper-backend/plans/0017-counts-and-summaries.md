# 0017 Zone summaries, counts and the member read surface

The frontend cannot render its approved home screen against this API. Every summary number the
design draws is absent, and two of them have no source at all, not even an expensive client
side fan out. `MyZoneView` is `{id, name, joinCode, status, ownerUserId, config, myRole,
myStatus}` and `ListView` is `{id, zoneId, name, createdByUserId}`.

Verified against the frontend's own audit of the mock:

| Mock element | Field needed | Status today |
| --- | --- | --- |
| "3 members" | `memberCount` | missing, and **unobtainable** |
| "2 lists" | `listCount` | missing, obtainable at one request per zone |
| "12 items" | `lineCount` per list | missing |
| "7 of 12 ready" | `readyCount` per list | missing, needs a `LineStatus.READY` count |
| "Ines and 2 more want to join" | `pendingRequestCount` + `firstPendingRequesterName` | missing, and **unobtainable** |

The two marked unobtainable are unobtainable for the same underlying reason, which is a larger
gap than the counts: **there is no way to read a zone's members at all.** The zone controller
has approve, reject, kick, ban, set role and transfer ownership, and no `GET
/v1/zones/:id/members`. A `MembershipView` only ever reaches a client as the result of an action
the client itself performed, or as a realtime event it happened to be connected for. So this
plan delivers three things, in order of how badly they are needed:

1. A member read surface (section 5), which is the missing endpoint the other two depend on.
2. The counts, on the read models that already exist (sections 2 to 4).
3. A lists preview on the zone, so the home screen is one request rather than one per zone
   (section 3.3).

Plus two corrections to the existing read models that the frontend hit while building: missing
timestamps (section 7) and the platform totals (section 8).

Depends on 0006 (zones and membership), 0007 (lists and lines), 0009 (realtime), 0011
(account deletion, which retires memberships and so moves these numbers). Companion plans:
0018 removes the mandatory username from zone create and join, and 0019 documents the response
schemas so the frontend can verify its mappers against the contract instead of against the
source.

## 1. The numbers, and where each one comes from

| Number | Owner | Scope |
| --- | --- | --- |
| Users in the app | auth | platform total |
| Members of a zone | core | per zone |
| Zones in the app | core | platform total |
| Zones of a user | core | per user |
| Join requests for a zone, plus the first requester's name | core | per zone, governance only |
| Lists in a zone | core | per zone, filtered to what the caller may read |
| Lines in a list, and how many are ready | core | per list |

Two families with different requirements fall out, and they get different treatments in
sections 2 and 8:

- **Scoped counts** sit next to a record the caller is already fetching. They must be exact,
  must not cost a round trip per row, and must stay live while the screen is open.
- **Platform totals** span the auth and core databases, are read by nobody who needs them to
  the second, and must never be able to slow a page down.

## 2. Scoped counts are computed on read, not denormalized

The alternative considered was counter columns on `zones` and `shopping_lists` maintained inside
each mutation's transaction. It is rejected:

- Every count here has a bounded, indexed source. `memberships WHERE zoneId = ? AND status = ?`
  and `lines WHERE listId = ?` are index only counts over tens or hundreds of rows, not
  millions. A zone with enough members to make `count(*)` expensive does not exist in this
  product.
- A page of zones is at most `clampPageSize` rows, so a lateral subquery per count is a fixed
  small multiple of one query, not an N+1. The counts ride the query that was already running.
- Counter columns introduce drift as a permanent possibility, which then needs a reconciliation
  job, which needs its own tests, to protect numbers that Postgres produces correctly for free.
  That trade is worth making when the read path cannot afford the count. Here it can.
- `firstPendingRequesterName` is not a count and could not be maintained as a counter anyway; it
  needs an ordered lookup on every change, because approving the first requester makes the
  answer the second requester. Computing it on read is the only formulation that is correct by
  construction.
- `listCount` is access filtered (section 3.1), so a counter column would need one value per
  caller, which is not a counter column at all.

So: **one `LEFT JOIN LATERAL` per count, attached to the listing query that already runs.** No
new columns, no new tables, no reconciliation job, and no way for a number to be wrong.

## 3. The zone summary

### 3.1 Counts

```ts
/** The summary numbers shown on a zone card (plan 0017, section 3). */
export interface ZoneCounts {
  /** APPROVED memberships. Pending members are not members yet. */
  memberCount: number;
  /**
   * Lists in the zone **that the caller may read** (section 3.2). Not the zone's
   * total list count.
   */
  listCount: number;
  /**
   * PENDING memberships. `null` for a caller who is not OWNER or ADMIN of the
   * zone: who is waiting to join is governance data (section 6).
   */
  pendingRequestCount: number | null;
  /**
   * The per zone username of the oldest PENDING membership, or `null` when there
   * are none, or when the caller may not see governance data. Oldest by
   * `createdAt`, tie broken by `id`, so it is stable across pages and refreshes.
   */
  firstPendingRequesterName: string | null;
}
```

`MyZoneView` gains `counts: ZoneCounts`. It is not optional and there is no `?counts=true`
switch: a client that fetches a zone always wants them, and an optional field just produces two
shapes to test.

### 3.2 `listCount` counts what the caller can open

An earlier draft of this plan had `listCount` count every list in the zone, on the reasoning
that it is the zone's size. That is wrong once section 3.3 puts a preview of those same lists
directly underneath the number: a card reading "3 lists" above a preview showing one is a bug
in the user's eyes, and no explanation makes it not one. The number and the preview must be
drawn from the same set.

So `listCount` counts the lists the caller may read, which `ListAccessService.requireRead`
defines as: an APPROVED zone membership, and then either a `ListAccess` row for that membership
or manager status (the list's creator, or a zone `OWNER`/`ADMIN`, who can always see a list they
govern).

The consequence is that two members of one zone can correctly see different list counts for it.
That is the truth about what each of them can open.

### 3.3 Lists preview

Counts alone still cost one request per zone to render the home screen, because the list names
and their line counts live behind `GET /v1/zones/:id/lists`. The zone therefore carries a short
preview inline:

```ts
/** A list as it appears in a zone's inline preview (plan 0017, section 3.3). */
export interface ZoneListPreview {
  id: string;
  name: string;
  lineCount: number;
  readyCount: number;
}
```

`MyZoneView` gains `lists: ZoneListPreview[]`.

- **At most three**, a fixed server side cap. It is not client configurable: a preview is a
  preview, and a `?previewLimit=` parameter is an invitation to fetch the whole zone through
  the summary endpoint.
- **Ordered by `updatedAt` descending**, so the preview is the lists that are actually in use.
  Tie broken by `id` for stability.
- **Filtered exactly as `listCount` is** (section 3.2). The array and the number always agree,
  which is the point.
- An empty array is a legitimate value and means the caller can read no lists in that zone. It
  does not mean the zone is empty; `listCount` is `0` in the same breath and the two are
  consistent.

The preview is a convenience, not a replacement: a client showing more than three lists still
pages `GET /v1/zones/:id/lists`, which returns full `ListView`s.

### 3.4 List and line counts on the list itself

```ts
/** The counts shown alongside a full list (plan 0017, section 3.4). */
export interface ListCounts {
  /** Every line, whatever its approval or item status. */
  lineCount: number;
  /** Lines whose `status` is `LineStatus.READY`. Drives "7 of 12 ready". */
  readyCount: number;
}
```

`ListView` gains `counts: ListCounts`. The field names match `ZoneListPreview` deliberately, so
the frontend maps one shape whichever endpoint it came from.

`readyCount` counts `LineStatus.READY` only, and ignores `approvalStatus` entirely. The two
state machines are independent by 0007's design, and the mock's "7 of 12 ready" is about
shopping progress, not moderation.

### 3.5 The caller's own zone counts

```ts
export const ZONE_PATTERNS = {
  // ...existing
  countsMine: 'zone.countsMine',
} as const;

export interface MyZoneCountsRequest {
  userId: string;
}

/** How many zones the caller is in, split the way the UI groups them. */
export interface MyZoneCounts {
  /** Zones where the caller holds an APPROVED membership with role OWNER. */
  owned: number;
  /** APPROVED memberships that are not OWNER. */
  joined: number;
  /** PENDING memberships: zones the caller has asked to join. */
  pending: number;
  /** `owned + joined`, the number `zone.listMine` would return with no cursor. */
  total: number;
}
```

`total` excludes `pending` on purpose: a zone the caller has merely asked to join is not one of
their zones. `zone.listMine` returns both, which is a deliberate choice from 0006 section 7 so
the client can show a "waiting for approval" card; the count keeps them apart so a header does
not claim the user has a zone they cannot open.

### 3.6 Fetching a single zone

There is no `zone.get` today; the only way to see a zone is to page through `zone.listMine`. The
summary makes that gap worse, because a zone detail screen would have to find its own zone in a
paginated list to read its numbers. Add:

```ts
export const ZONE_PATTERNS = {
  // ...existing
  get: 'zone.get',
} as const;
// Request is the existing ZoneIdRequest; response is MyZoneView, summary included.
```

Authorization is the existing `ZoneAuthzService.requireApproved`, plus the PENDING caller case
that `listMine` already allows: a pending applicant may see the zone's name and status, gets
`null` for both governance fields, an empty `lists` array and `listCount` of `0`, because they
have no membership through which to hold list access.

## 4. Queries and indexes

### 4.1 The zone summary laterals

Attached to `ZoneService.listMine`'s existing query builder and to the new `get`, so both use
one code path. `m` is the caller's membership row, already joined by `listMine`; `z` is the
zone. `$manages` is `m.role IN ('OWNER','ADMIN')`, resolved from the row rather than re queried.

```sql
-- Members and pending requests: one scan of the membership index, two aggregates.
LEFT JOIN LATERAL (
  SELECT
    count(*) FILTER (WHERE m2.status = 'APPROVED') AS member_count,
    count(*) FILTER (WHERE m2.status = 'PENDING')  AS pending_count
  FROM zone_memberships m2
  WHERE m2."zoneId" = z.id
) mc ON true

-- The oldest pending requester's name.
LEFT JOIN LATERAL (
  SELECT m3.username
  FROM zone_memberships m3
  WHERE m3."zoneId" = z.id AND m3.status = 'PENDING'
  ORDER BY m3."createdAt" ASC, m3.id ASC
  LIMIT 1
) pr ON true

-- Readable lists: the count and the preview come from ONE definition of
-- readability, expressed once as a CTE-like inline view so the two can never
-- diverge (section 3.2).
LEFT JOIN LATERAL (
  SELECT sl.id, sl.name, sl."updatedAt"
  FROM shopping_lists sl
  WHERE sl."zoneId" = z.id
    AND (
      $manages
      OR sl."createdByUserId" = :userId
      OR EXISTS (
        SELECT 1 FROM list_access la
        WHERE la."listId" = sl.id AND la."membershipId" = m.id
      )
    )
) readable ON true
```

`readable` is then consumed twice, as `count(*)` for `listCount` and as a `json_agg` over an
ordered `LIMIT 3` subselect for the preview. The `json_agg` matters: a lateral returning three
rows per zone would multiply the zone rows and break the paging. It returns one JSON array per
zone, or `NULL`, mapped to `[]`.

The preview's `lineCount`/`readyCount` are a further lateral inside the preview subselect,
against at most three lists per zone:

```sql
LEFT JOIN LATERAL (
  SELECT
    count(*) AS line_count,
    count(*) FILTER (WHERE ll.status = 'READY') AS ready_count
  FROM list_lines ll
  WHERE ll."listId" = sl.id
) lc ON true
```

Cost for a page of twenty zones: twenty membership index scans, twenty pending lookups, twenty
readable list scans, and sixty line count scans, all index backed, in one round trip. That is
the whole home screen.

### 4.2 List counts on the full list read

The same line count lateral, attached to `ListService.list` and to any single list read, so
`ListView.counts` and `ZoneListPreview` are produced by one helper.

### 4.3 Migration `1756000600000-CountIndexes`

Indexes only, no schema change:

- `ix_memberships_zone_status` on `zone_memberships (zoneId, status)`. Serves the member and
  pending counts as an index only scan.
- `ix_memberships_user_status` on `zone_memberships (userId, status)`. Serves `zone.countsMine`
  and the existing `listMine` filter, which today uses `ix_membership_user` on `(userId)` alone
  and then filters the status in the heap. The existing index is a strict prefix of the new one
  and is dropped in the same migration.
- `ix_memberships_zone_pending_created` on `zone_memberships (zoneId, "createdAt", id)`, partial
  `WHERE status = 'PENDING'`. Serves the first requester lookup as a one row index read. Partial
  because pending rows are a small minority and the index should stay tiny.
- `ix_lines_list_status` on `list_lines (listId, status)`. Serves both line counts. The existing
  `ix_lines_list` becomes a redundant prefix and is dropped in the same migration.
- `ix_lists_zone_updated` on `shopping_lists (zoneId, "updatedAt" DESC, id)`. Serves the preview
  ordering. The existing `ix_lists_zone` becomes a redundant prefix and is dropped.
- `list_access` already has `uq_list_access` on `(listId, membershipId)`, which serves the
  `EXISTS` probe. Nothing to add.

Note that the uniqueness in `1756000100000-InitialCoreSchema` is declared as table
**constraints**, not standalone indexes, so anything removing one uses `ALTER TABLE ... DROP
CONSTRAINT` rather than `DROP INDEX`. Nothing here does; plan 0018 does.

### 4.4 The one change to working code

`listMine` stops using `getMany()` and moves to `getRawAndEntities()`, because the counts arrive
as raw columns alongside the entities. That is mechanical, but it is the only place this plan
edits a working query, so it gets a dedicated regression test: same page contents, same
ordering, same cursor behaviour as before for each of the three orders, with the summary added.

## 5. Reading a zone's members

The missing endpoint. Without it there is no members screen, no join request screen, and no
source for the two "unobtainable" rows in the opening table.

```ts
export const MEMBERSHIP_PATTERNS = {
  // ...existing
  list: 'membership.list',
} as const;

export interface ListMembersRequest extends PageQuery {
  userId: string;
  zoneId: string;
  /**
   * Which statuses to return. Defaults to `[APPROVED]`. Any value other than
   * APPROVED requires the caller to be OWNER or ADMIN (section 6).
   */
  statuses?: MembershipStatus[];
}

export type MembershipPage = Paginated<MembershipView>;

/** Fields a caller may order the member listing by. */
export const MEMBER_ORDERS = ['joined', 'name', 'role'] as const;
export type MemberOrder = (typeof MEMBER_ORDERS)[number];
```

Cursor paginated exactly like every other collection (0004 section 11). `joined` orders by
`createdAt` ascending, which for the PENDING filter makes the first page start with the same
person `firstPendingRequesterName` names. That is deliberate: the summary names the oldest
requester, and tapping through must show that person at the top, not somewhere in the middle.

`role` orders OWNER, then ADMIN, then MEMBER, then by `joined` within each. Postgres orders a
native enum by declaration order, and `ZoneRole` is declared `OWNER, ADMIN, MEMBER`, so this is
a plain `ORDER BY role`. Worth a test, because it silently depends on that declaration order.

`MembershipView` already carries `{id, zoneId, userId, username, role, status}`, so no new view
type is needed.

## 6. Who may see the join requests

`pendingRequestCount`, `firstPendingRequesterName`, and any member listing filtered to a status
other than APPROVED, are the governance data in this plan. Someone who asked to join a zone and
has not been approved has not agreed to be visible to that zone's existing members; only the
people who can act on the request need to see them.

The rule, enforced in core from the caller's already resolved membership:

- Both summary fields are non `null` only when the caller's membership is `APPROVED` **and**
  their role is `OWNER` or `ADMIN`. Everyone else, including a PENDING applicant looking at the
  zone they applied to, gets `null` for both.
- `membership.list` with the default `[APPROVED]` filter is open to any APPROVED member.
  Requesting `PENDING`, `KICKED` or `BANNED` requires `OWNER` or `ADMIN`, and is a
  `ForbiddenException` otherwise, not a silently empty page. A silent empty page would read as
  "nobody is waiting" and is the worse failure.

`null` and `0` mean different things and the client must render them differently: `null` is
"not your business", `0` is "nobody is waiting".

**Product consequence the frontend must absorb:** the "Ines and 2 more want to join" row renders
only for owners and admins. A plain member sees no such row on the same zone card, because the
fields are `null` rather than zero. If the approved mock intends that row for every member, that
is a product decision to revisit, and it is a decision about privacy rather than about the API.
This plan takes the conservative side, and changing it later is a one line change to the mapper.

Never enforce this in the gateway or the client: the data would already have crossed the service
boundary.

## 7. Timestamps on the read models

`ListView` and `LineView` carry no timestamps, yet `LIST_ORDERS` and `LINE_ORDERS` already offer
`created` and `updated`. A client can therefore sort by a field it cannot read, and anything
showing "last updated" has to reconstruct it from realtime events it happened to observe. The
data exists: every core entity extends `BaseEntity`, which has `createdAt` and `updatedAt`.

Add `createdAt: string` and `updatedAt: string` (ISO 8601, UTC) to `ZoneView`, `MyZoneView`,
`MembershipView`, `ListView` and `LineView`. `CommentView` already has `createdAt` and gains
nothing, since a comment is immutable.

This is a pure addition to five view mappers with no query change, and it removes a whole class
of client side workaround.

## 8. Platform totals

### 8.1 Contracts

```ts
export const STATS_PATTERNS = {
  /** Answered by auth: identity totals. */
  identity: 'stats.identity',
  /** Answered by core: zone and content totals. */
  core: 'stats.core',
} as const;

export interface IdentityStats {
  /** Every user row, both kinds. */
  users: number;
  /** `kind = REGISTERED`. */
  registeredUsers: number;
  /** `kind = TEMPORARY`: guests holding a zone token. */
  temporaryUsers: number;
}

export interface CoreStats {
  /** Every zone row, both statuses. */
  zones: number;
  /** `status = ACTIVE`: excludes zones marked for deletion. */
  activeZones: number;
}
```

Reporting `users` as one number would mislead in this product: a guest who created one zone and
never came back is a row in `users`, so the honest headline is `registeredUsers` and the client
picks. Same reasoning for `activeZones` against `zones`.

### 8.2 The read path

`GET /v1/stats` on the gateway fans out to both patterns in parallel and composes. Each service
answers with a plain `count(*)` over its own table. There is no shared table, no scheduled
snapshot and no cross database join, because the two databases belong to two services and the
architecture rests on them never being joined.

The endpoint is public and unauthenticated, because the numbers are a landing page figure shown
to a visitor with no token. That makes it the only public read in the API, so it gets both
guards:

- **An in memory TTL cache in the gateway**, 60 seconds, one entry. A burst of a thousand
  visitors produces one pair of NATS calls per minute. `measuredAt` reports when the snapshot
  was taken, so staleness is visible rather than hidden.
- **A named throttler bucket** sized tighter than the default, since an unauthenticated
  endpoint is the cheapest thing to hammer.

If either service fails to answer, the endpoint returns the block it did get rather than failing
the whole response; a broken auth service must not take down a public page:

```ts
export interface PlatformStatsResponse {
  identity: IdentityStats | null;
  core: CoreStats | null;
  measuredAt: string;
}
```

### 8.3 The escape hatch, written down but not built

`count(*)` on Postgres scans the visible tuples. At the size this product will plausibly reach
that is a millisecond. If the users table ever grows past the point where a one minute cache
miss is noticeable, the replacement is the planner's estimate (`pg_class.reltuples`, or
`pg_stat_user_tables.n_live_tup`), which is free and accurate to within a percent for a vanity
figure. Do not build it now; note it here so the fix is not rediscovered under pressure.

## 9. Keeping the numbers live

Every mutation that changes one of these numbers already emits a realtime event: `member.joined`
raises the pending count, `member.approved` moves one from pending to member, `list.created`
raises the list count, `line.added` raises a line count. A client holding a zone open can derive
most of them from events it already receives.

One value cannot be derived: `firstPendingRequesterName`. When the first requester is approved or
rejected, the correct new value is the second requester's name, which appears in no event
payload. Refetching the zone on every membership event to recover one string is the wrong shape.

So core emits one new event carrying the whole block:

```ts
export enum RealtimeEvent {
  // ...existing
  ZoneCountsUpdated = 'zone.countsUpdated',
}

export interface ZoneCountsUpdatedPayload {
  zoneId: string;
  counts: ZoneCounts;
}
```

Add it to `DOMAIN_EVENT_SUBJECTS` (0009 requires that explicit list to stay in sync; the subject
`zone.countsUpdated` is safely distinct from every command subject).

**The governance leak, and the staff room.** The zone realtime room is every approved member, so
publishing a payload containing `pendingRequestCount` and `firstPendingRequesterName` into
`zone:{id}` would hand every member exactly what section 6 withholds. Two rooms are needed:

- `zone:{zoneId}` receives the event with the governance fields `null`.
- `zone:{zoneId}:staff` receives it with them filled.

This adds to 0009: a `RealtimeRoom.ZoneStaff` value, a `zoneStaffRoom(zoneId)` helper beside
`zoneRoom`, a `realtime.checkZoneStaffAccess` pattern core answers by requiring `OWNER`/`ADMIN`,
and a socket that joins both rooms when the staff check passes. A member promoted mid session
does not retroactively join the staff room; they join on the next reconnect or resubscribe,
which is acceptable because `member.roleChanged` already tells the client its role changed.

`counts` in this payload deliberately omits the per caller `listCount` and the `lists` preview:
both depend on who is asking, and a room broadcast has no single asker. A client updates
`memberCount` and the governance fields from the event, and refreshes the rest on the next
fetch. `listCount` is instead derived client side from `list.created` / `list.deleted`, which
the client only receives for lists it can see, so the derivation stays consistent with the
filter.

Emission points, all of which already exist and gain one call: `ZoneService.join`,
`MembershipService.approve/reject/kick/ban`, `ListService.create/delete`, and the `user.deleted`
saga in `AccountDeletionService`, which retires memberships so the member count drops with no
user action.

Line counts are not pushed. `line.added` and `line.deleted` already reach the zone room (0009
routes list scoped events to both rooms), so the client adjusts `lineCount` and `readyCount`
itself, and any divergence is corrected by the next fetch. A second counts event for a number
the client can already track would be noise.

## 10. Gateway surface

| Route | Returns |
| --- | --- |
| `GET /v1/zones` (existing) | `ZonePage`, each `MyZoneView` now carrying `counts` and `lists` |
| `GET /v1/zones/:id` (new) | `MyZoneView` with `counts` and `lists` |
| `GET /v1/zones/:id/members` (new) | `MembershipPage`, `?statuses=`, `?order=`, cursor paged |
| `GET /v1/zones/:id/lists` (existing) | `ListPage`, each `ListView` now carrying `counts` |
| `GET /v1/zones/count` (new) | `MyZoneCounts` for the authenticated caller |
| `GET /v1/stats` (new, public) | `PlatformStatsResponse` |

Route ordering hazard in the Nest controller: `count` must be declared before `:id` or it is
swallowed as a zone id.

`GET /v1/zones/count` sits under `zones` rather than on an account resource because the number
is about zones. When `GET /v1/account/me` lands (plan 0018 section 12) it may embed
`MyZoneCounts` as a field; the message `zone.countsMine` is the same either way, so that later
decision costs nothing now.

## 11. Testing

- **Contract schemas are mandatory.** The completeness spec in
  `libs/luna-shopper/contracts/src/schemas` asserts every pattern and event enum value has a
  schema, so adding `zone.get`, `zone.countsMine`, `membership.list`, `stats.identity`,
  `stats.core` and `zone.countsUpdated` without schemas fails CI. Write them in the same commit
  and extend the zone, membership, list and line view schemas with the new fields.
- **Counts**, against `libs/luna-shopper/test-fixtures`: correct with zero rows; `memberCount`
  excludes pending, kicked and banned; `pendingRequestCount` counts only pending;
  `firstPendingRequesterName` follows `createdAt`, moves to the next requester when the first is
  approved and again when the first is rejected, and is `null` with no pending rows.
- **Access filtering**, which is the subtle one: two members of the same zone with different
  `ListAccess` rows get different `listCount` values and different previews; a manager sees
  lists they hold no access row for; the preview array and `listCount` agree in every one of
  those cases. That last assertion is the guard on section 3.2 and must be a real test, not a
  comment.
- **Preview shape**: capped at three; ordered by `updatedAt` descending; empty array rather than
  `null` when nothing is readable; `lineCount` and `readyCount` correct per previewed list, with
  `readyCount` ignoring `approvalStatus` entirely.
- **Governance gating**: both summary fields `null` for a MEMBER and for a PENDING caller,
  filled for OWNER and ADMIN; `membership.list` with a non default status filter is forbidden
  for a MEMBER and allowed for an ADMIN; the default filter works for any approved member.
- **Member listing**: cursor paging is stable across the three orders; `role` ordering really is
  OWNER, ADMIN, MEMBER (the test that catches someone reordering the `ZoneRole` enum); the
  `joined` order on the PENDING filter starts with the person `firstPendingRequesterName` names.
- **`listMine` regression** for the `getRawAndEntities` change: identical contents, ordering and
  cursor behaviour to the pre change implementation, for each of the three orders.
- **Timestamps**: every view that gained them serializes ISO 8601 UTC strings, and `updatedAt`
  actually moves after a mutation.
- **Gateway**: the stats cache serves a second call with no second NATS round trip, TTL expiry
  refetches, and a rejected downstream call yields a `null` block rather than a 500.
- **Realtime**: the staff room receives filled governance fields and the plain zone room
  receives `null` for the same event. This is the test that catches a leak, so it is not
  optional.
- **Integration** (`*.integration.spec.ts`, `LUNA_INTEGRATION` gated): the index backed queries
  return the same numbers as naive `count(*)` over a seeded zone, which is the only way to catch
  a partial index whose predicate does not match the query. Include an `EXPLAIN` assertion, or
  record the plans in the PR.

## 12. What this unblocks on the frontend

Every row of the opening table becomes one `GET /v1/zones` call:

| Mock element | Now served by |
| --- | --- |
| "3 members" | `counts.memberCount` |
| "2 lists" | `counts.listCount` |
| "12 items" | `lists[n].lineCount` |
| "7 of 12 ready" | `lists[n].readyCount` of `lists[n].lineCount` |
| "Ines and 2 more want to join" | `counts.firstPendingRequesterName` plus `counts.pendingRequestCount - 1` |

The join request row's rule (name the oldest requester, add "and X more" only when there is more
than one, the count excluding the named person) maps to `pendingRequestCount - 1`, and the row
is hidden entirely when either field is `null`, per section 6.

The frontend's proposed mapping target is met exactly, with two naming notes: the summary is
split across `counts` and `lists` on `MyZoneView` rather than being one flat block, because the
preview is an array and the counts are scalars; and `readyCount` and `firstPendingRequesterName`
use the frontend's names rather than the ones an earlier draft of this plan used.

Velista rule D4 is unchanged: the frontend still maps these into its own models from `unknown`
and never passes a contract type into a component. Plan 0019 makes that mapping verifiable
against the published schema instead of against the backend source.

## 13. Exit criteria

- `GET /v1/zones` renders the entire home screen in one request: member count, readable list
  count, a preview of up to three lists with their line and ready counts, and the join request
  summary for owners and admins.
- `GET /v1/zones/:id/members` exists, is cursor paged, supports the three orders, and gates non
  APPROVED statuses to owners and admins with a forbidden error rather than an empty page.
- `listCount` and the `lists` preview are drawn from one definition of readability and never
  disagree, proven by test.
- `pendingRequestCount` and `firstPendingRequesterName` are `null` for every caller who is not
  OWNER or ADMIN, over REST and over realtime.
- `zone.countsUpdated` reaches the plain zone room without governance fields and the staff room
  with them, on join, approve, reject, kick, ban, list create, list delete and account deletion.
- `ZoneView`, `MyZoneView`, `MembershipView`, `ListView` and `LineView` all carry `createdAt` and
  `updatedAt`, so every value in `LIST_ORDERS` and `LINE_ORDERS` corresponds to a readable
  field.
- `GET /v1/stats` answers without a token, is cached 60 seconds, is throttled, and degrades to a
  partial response when one service is down.
- Migration `1756000600000-CountIndexes` applies and reverts cleanly, and every count query is
  index backed.
- `nx run-many --all --target=test|lint|build` green for the luna projects.
