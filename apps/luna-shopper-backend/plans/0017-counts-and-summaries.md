# 0017 Counts and summaries

Every screen the frontend has designed needs numbers the API does not return today: how many
members a zone has, how many people are waiting to join it and who asked first, how many lists
it holds, how many lines a list holds, how many zones the caller belongs to, and the two
platform totals (all users, all zones). None of these exist. `MyZoneView` is
`{id, name, joinCode, status, ownerUserId, config, myRole, myStatus}` and `ListView` is
`{id, zoneId, name, createdByUserId}`, so rendering the home screen as drawn costs one request
per zone plus a full line fetch per list.

This plan adds every count as a first class part of the existing read models rather than as a
separate statistics endpoint, because the numbers are always wanted alongside the row they
describe. It also settles how the counts stay live, and where the governance sensitive ones
(pending join requests) are allowed to travel.

Depends on 0006 (zones and membership), 0007 (lists and lines), 0009 (realtime), 0011
(processed events inbox, reused for nothing here but the precedent for cross service reads).

## 1. The seven numbers, and where each one comes from

| Number | Owner | Scope |
| --- | --- | --- |
| Users in the app | auth | platform total |
| Users in a zone | core | per zone |
| Zones in the app | core | platform total |
| Zones of a user | core | per user |
| Join requests for a zone, plus the first requester's name | core | per zone, governance only |
| Lists in a zone | core | per zone |
| Lines in a list | core | per list |

Two families with different requirements fall out of that table, and they get different
treatments in sections 2 and 6:

- **Scoped counts** (rows 2, 4, 5, 6, 7) sit next to a record the caller is already fetching.
  They must be exact, must not cost a round trip per row, and must stay live while the screen
  is open.
- **Platform totals** (rows 1 and 3) span the auth and core databases, are read by nobody who
  needs them to the second, and must never be able to slow a page down.

## 2. Scoped counts are computed on read, not denormalized

The alternative considered was counter columns on `zones` and `shopping_lists` maintained
inside each mutation's transaction. It is rejected:

- Every count here has a bounded, indexed source. `memberships WHERE zoneId = ? AND status = ?`
  and `lines WHERE listId = ?` are index only counts over tens or hundreds of rows, not
  millions. A zone with enough members to make `count(*)` expensive does not exist in this
  product.
- A page of zones is at most `clampPageSize` rows, so a lateral subquery per count is a fixed
  small multiple of one query, not an N+1. The counts ride the query that was already running.
- Counter columns introduce drift as a permanent possibility, which then needs a reconciliation
  job, which needs its own tests, to protect numbers that Postgres can produce correctly for
  free. That trade is worth making when the read path cannot afford the count. Here it can.
- The first pending requester's name is not a count and cannot be maintained as a counter
  anyway; it needs an ordered lookup on every change (approve the first requester and the
  answer becomes the second). Computing it on read is the only formulation that is correct by
  construction.

So: **one `LEFT JOIN LATERAL` per count, attached to the existing listing queries.** No new
columns, no new tables, no reconciliation job, and no way for a number to be wrong.

The word "cached" in the requirement is satisfied by section 6: the first requester's name
arrives in the same payload as the count and is refreshed by a push, so the client never issues
a second request for it. It is not a stored cache with an invalidation problem.

## 3. Contract additions

### 3.1 Zone counts

```ts
/** The counts shown alongside a zone (plan 0017, section 2). */
export interface ZoneCounts {
  /** APPROVED memberships. Pending members are not members yet. */
  memberCount: number;
  /** Lists in the zone, regardless of the caller's access to them. */
  listCount: number;
  /**
   * PENDING memberships. `null` for a caller who is not OWNER or ADMIN of the
   * zone: who is waiting to join is governance data (section 5).
   */
  pendingRequestCount: number | null;
  /**
   * The per zone username of the oldest PENDING membership, or `null` when there
   * are none, or when the caller may not see governance data. Oldest by
   * `createdAt`, tie broken by `id`, so it is stable across pages and refreshes.
   */
  firstPendingUsername: string | null;
}
```

`MyZoneView` gains `counts: ZoneCounts`. It is not optional, and there is no `?counts=true`
switch: a client that fetches a zone always wants them, and an optional field just produces two
shapes to test.

`listCount` deliberately counts every list in the zone, not only the lists the caller may read.
It is the zone's size, it is what an admin sees when deciding whether the zone is busy, and
filtering it per caller would make two members of the same zone disagree about the same number
for no benefit. The lists the caller can actually open are what `list.list` already returns.

### 3.2 List counts

```ts
/** The counts shown alongside a list (plan 0017, section 2). */
export interface ListCounts {
  /** Every line, whatever its approval or item status. */
  lineCount: number;
  /**
   * Lines whose `status` is READY. Beyond the stated requirement but free: it is
   * the same lateral with one extra filtered aggregate, and the home page mock
   * already draws "4 of 11". Drop this field and its aggregate if the progress
   * figure is cut from the design.
   */
  readyLineCount: number;
}
```

`ListView` gains `counts: ListCounts`.

### 3.3 The caller's own zone counts

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
their zones. `zone.listMine` returns both, which is a separate and deliberate choice made in
0006 section 7 so the client can show a "waiting for approval" card; the count keeps them
apart so the header does not claim the user has a zone they cannot open.

### 3.4 Platform totals

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

/** What the gateway composes and serves. */
export interface PlatformStats extends IdentityStats, CoreStats {
  /** When the underlying counts were taken, so a client can show staleness. */
  measuredAt: string;
}
```

Reporting `users` as one number would be misleading in this product: a guest who created one
zone and never came back is a row in `users`, so the honest headline number is
`registeredUsers` and the client chooses which to show. Same reasoning for `activeZones` versus
`zones`.

### 3.5 Fetching a single zone

There is no `zone.get` today; the only way to see a zone is to page through `zone.listMine`.
The counts make that gap worse, because a zone detail screen would have to find its own zone in
a paginated list to read its numbers. Add:

```ts
export const ZONE_PATTERNS = {
  // ...existing
  get: 'zone.get',
} as const;
// Request is the existing ZoneIdRequest; response is MyZoneView, counts included.
```

Authorization is the existing `ZoneAuthzService.requireApproved`, plus the PENDING caller case
that `listMine` already allows (a pending applicant may see the zone's name and status, and
gets `null` for both governance fields and `0` for nothing else, since section 5 gates by role
and a PENDING caller has no role).

## 4. Queries and indexes

### 4.1 Zone counts lateral

Attached to `ZoneService.listMine`'s existing query builder and to the new `get`, so both use
one code path. Sketch, in the shape the query builder produces:

```sql
LEFT JOIN LATERAL (
  SELECT
    count(*) FILTER (WHERE m2.status = 'APPROVED') AS member_count,
    count(*) FILTER (WHERE m2.status = 'PENDING')  AS pending_count
  FROM zone_memberships m2
  WHERE m2."zoneId" = z.id
) c ON true
LEFT JOIN LATERAL (
  SELECT count(*) AS list_count FROM shopping_lists sl WHERE sl."zoneId" = z.id
) l ON true
LEFT JOIN LATERAL (
  SELECT m3.username
  FROM zone_memberships m3
  WHERE m3."zoneId" = z.id AND m3.status = 'PENDING'
  ORDER BY m3."createdAt" ASC, m3.id ASC
  LIMIT 1
) f ON true
```

The first two counts come from one scan of the membership index rather than two, which is why
they are a single lateral with filtered aggregates rather than two subqueries.

Because the query stops using `getMany()` and starts needing the extra columns, `listMine`
moves to `getRawAndEntities()` and the mapper joins entity to raw counts by index. That is a
mechanical change but it is the one place this plan touches existing working code, so it gets
its own test: same page, same order, same cursor behaviour as before, with counts added.

### 4.2 List counts lateral

Attached to `ListService.list` and to any single list read:

```sql
LEFT JOIN LATERAL (
  SELECT
    count(*) AS line_count,
    count(*) FILTER (WHERE ll.status = 'READY') AS ready_count
  FROM list_lines ll
  WHERE ll."listId" = sl.id
) c ON true
```

### 4.3 Migration `1756000600000-CountIndexes`

Indexes only, no schema change:

- `ix_memberships_zone_status` on `zone_memberships (zoneId, status)`. Serves the member and
  pending counts as an index only scan.
- `ix_memberships_user_status` on `zone_memberships (userId, status)`. Serves `zone.countsMine`
  and the existing `listMine` filter, which today uses `ix_membership_user` on `(userId)` alone
  and then filters the status in the heap. The existing index is a strict prefix of the new one
  and is dropped in the same migration.
- `ix_memberships_zone_pending_created` on `zone_memberships (zoneId, "createdAt", id)`,
  partial `WHERE status = 'PENDING'`. Serves the first requester lookup as a one row index
  read. Partial because pending rows are a small minority and the index should stay tiny.
- `ix_lines_list_status` on `list_lines (listId, status)`. Serves both line counts. The
  existing `ix_lines_list` becomes redundant as a prefix of this one and is dropped in the same
  migration.
- `ix_lists_zone` already exists and needs nothing.

`zone_memberships` already carries `uq_membership_zone_user` on `(zoneId, userId)`, which does
not serve any of these because status is not in it. Note that the uniqueness in
`1756000100000-InitialCoreSchema` is declared as table **constraints**, not as standalone
indexes, so anything that has to remove one uses `ALTER TABLE ... DROP CONSTRAINT` rather than
`DROP INDEX`. Nothing in this plan drops one; plan 0018 does.

## 5. Who may see the join requests

`pendingRequestCount` and `firstPendingUsername` are the only governance data in this plan. A
person who asked to join a zone and has not been approved has not agreed to be visible to the
zone's existing members; only the people who can act on the request need to see it.

Rule: both fields are non `null` only when the caller's own membership in that zone is
`APPROVED` and role is `OWNER` or `ADMIN`. Everyone else, including a PENDING applicant looking
at the zone they applied to, gets `null` for both. `null` and `0` mean different things and the
client must render them differently: `null` is "not your business", `0` is "nobody is
waiting".

This is enforced in core, in the mapper, from the caller's already resolved membership. It is
never enforced in the gateway or the client, because the number would still have crossed the
service boundary.

## 6. Keeping the numbers live

Every mutation that changes one of these numbers already emits a realtime event: `member.joined`
raises the pending count, `member.approved` moves one from pending to member, `list.created`
raises the list count, `line.added` raises the line count. A client holding a zone open can
derive most of the numbers from the events it already receives.

One value cannot be derived: `firstPendingUsername`. When the first requester is approved or
rejected, the correct new value is the second requester's name, which is in no event payload.
Refetching the zone on every membership event to recover one string is the wrong shape.

So core emits one new event carrying the whole block:

```ts
export enum RealtimeEvent {
  // ...existing
  ZoneCountsUpdated = 'zone.countsUpdated',
}

/** Payload of {@link RealtimeEvent.ZoneCountsUpdated}. */
export interface ZoneCountsUpdatedPayload {
  zoneId: string;
  counts: ZoneCounts;
}
```

Add it to `DOMAIN_EVENT_SUBJECTS` (0009 requires the explicit list to stay in sync, and the
subject `zone.countsUpdated` is safely distinct from every command subject).

**The governance leak, and the staff room.** The zone realtime room is every approved member,
so publishing a payload containing `pendingRequestCount` and `firstPendingUsername` into
`zone:{id}` would hand every member exactly the data section 5 withholds. Two rooms are needed:

- `zone:{zoneId}` receives the event with the governance fields set to `null`.
- `zone:{zoneId}:staff` receives the event with them filled.

This adds to 0009: a `RealtimeRoom.ZoneStaff` value, a `zoneStaffRoom(zoneId)` helper next to
`zoneRoom`, a `realtime.checkZoneStaffAccess` pattern that core answers by requiring
`OWNER`/`ADMIN`, and a socket that joins both rooms when the staff check passes. A member
promoted to admin mid session does not retroactively join the staff room; they join it on the
next reconnect or resubscribe, which is acceptable because `member.roleChanged` already tells
the client its role changed and the client resubscribes on it.

Emission points in core, all of which already exist and just gain one call:
`ZoneService.join`, `MembershipService.approve/reject/kick/ban`, `ListService.create/delete`,
and the `user.deleted` saga in `AccountDeletionService` (it retires memberships, so the member
count drops without any user action). Computing the block costs the same two laterals against
one zone.

List line counts are not pushed. `line.added` / `line.deleted` already reach the zone room
(0009 routes list scoped events to both rooms), so the client adjusts `lineCount` itself, and a
divergence is corrected by the next fetch. Adding a second counts event for a number the client
can already track would be noise.

## 7. Platform totals

### 7.1 The read path

`GET /v1/stats` on the gateway. It fans out to `stats.identity` on auth and `stats.core` on
core in parallel, composes `PlatformStats`, and returns it.

Each service answers with plain `count(*)` over its own table, filtered by kind or status.
There is no shared table, no scheduled snapshot, and no cross database join, because the two
databases belong to two services and the whole architecture rests on them never being joined.

### 7.2 Caching and protection

The endpoint is public (unauthenticated), because the numbers are a landing page figure shown
to a visitor who has no token yet. That makes it the only public unauthenticated read in the
API, so it gets both guards:

- **An in memory TTL cache in the gateway**, 60 seconds, one entry, refreshed on miss. A burst
  of a thousand visitors produces one pair of NATS calls per minute. Stale by up to a minute is
  the correct trade for a number nobody acts on. `measuredAt` reports when the cached snapshot
  was taken so the staleness is visible rather than hidden.
- **A named throttler bucket** (0004 section on throttling) sized tighter than the default,
  since an unauthenticated endpoint is the cheapest thing to hammer.

If either service fails to answer, the endpoint returns the fields it did get and omits the
others rather than failing the whole response; a broken auth service must not take down a
public page. The composed type therefore treats the two blocks as independently optional at the
HTTP layer:

```ts
export interface PlatformStatsResponse {
  identity: IdentityStats | null;
  core: CoreStats | null;
  measuredAt: string;
}
```

This is the one place the wire shape deliberately differs from the internal `PlatformStats`,
and it is why `PlatformStats` in section 3.4 is the composed convenience type rather than the
response.

### 7.3 The escape hatch, written down but not built

`count(*)` on Postgres is a full scan of the visible tuples. At the size this product will
plausibly reach, that is a millisecond. If the users table ever grows past the point where a
one minute cache miss is noticeable, the replacement is the planner's estimate
(`pg_class.reltuples` for the table, or `pg_stat_user_tables.n_live_tup`), which is free and
accurate to within a percent for a vanity figure. Do not build it now; note it here so the fix
is not rediscovered under pressure.

## 8. Gateway surface

| Route | Returns |
| --- | --- |
| `GET /v1/zones` (existing) | `ZonePage`, each `MyZoneView` now carrying `counts` |
| `GET /v1/zones/:id` (new) | `MyZoneView` with `counts` |
| `GET /v1/zones/:id/lists` (existing) | `ListPage`, each `ListView` now carrying `counts` |
| `GET /v1/zones/count` (new) | `MyZoneCounts` for the authenticated caller |
| `GET /v1/stats` (new, public) | `PlatformStatsResponse` |

`GET /v1/zones/count` is placed under `zones` rather than on an account resource on purpose:
the number is about zones, and `GET /v1/account/me` does not exist yet. When it does, it may
embed `MyZoneCounts` as a field; the message `zone.countsMine` is the same either way, so that
later decision costs nothing. Note the route ordering hazard in the Nest controller: `count`
must be declared before `:id` or it is swallowed as a zone id.

## 9. Testing

- **Contract schemas are mandatory.** `libs/luna-shopper/contracts/src/schemas` has a
  completeness spec asserting that every value in every pattern and event enum has a schema, so
  adding `zone.get`, `zone.countsMine`, `stats.identity`, `stats.core` and
  `zone.countsUpdated` without their schemas fails CI. Write the schemas in the same commit,
  and extend the existing zone and list view schemas with the counts objects.
- **Unit tests in core**, against the fixtures in `libs/luna-shopper/test-fixtures`: counts are
  correct with zero rows; pending count excludes approved; member count excludes pending,
  kicked and banned; `firstPendingUsername` follows `createdAt` and moves to the next requester
  when the first is approved and again when the first is rejected; `firstPendingUsername` is
  `null` with no pending rows; both governance fields are `null` for a MEMBER caller and for a
  PENDING caller, and filled for OWNER and ADMIN.
- **A regression test on `listMine`** covering the `getRawAndEntities` change: identical
  ordering and cursor paging to the pre change behaviour for each of the three orders.
- **`zone.countsMine`**: owned, joined and pending are disjoint and `total = owned + joined`.
- **Gateway tests**: the stats cache serves a second call without a second NATS round trip, the
  TTL expiry refetches, and a rejected downstream call yields a `null` block instead of a 500.
- **Realtime**: the staff room receives filled governance fields and the plain zone room
  receives `null` for the same event. This is the test that would catch a leak, so it is not
  optional.
- **Integration** (`*.integration.spec.ts`, `LUNA_INTEGRATION` gated): the index backed queries
  return the same numbers as naive `count(*)` over a seeded zone, which is the only way to
  catch a partial index whose predicate does not match the query.

## 10. Frontend consequence

This closes the gap recorded in `apps/velista/plans/0003-home-page.md` section 5.2: the home
screen's member count, list count, line count, ready count and join request row all become one
`GET /v1/zones` call. The join request row's design (name the oldest requester, add "and X more
want to join" only when there is more than one, count excluding the named person) maps to
`firstPendingUsername` plus `pendingRequestCount - 1`.

Velista rule D4 is unchanged: the frontend still maps these into its own models from `unknown`
and never passes a contract type into a component.

## 11. Exit criteria

- `MyZoneView.counts` and `ListView.counts` are returned by every existing listing route, with
  no extra round trip per row.
- `zone.get`, `zone.countsMine`, `stats.identity` and `stats.core` exist, are schema backed,
  and the completeness spec passes.
- `GET /v1/stats` answers without a token, is cached for 60 seconds, is throttled, and degrades
  to a partial response when one service is down.
- `pendingRequestCount` and `firstPendingUsername` are `null` for every caller who is not
  OWNER or ADMIN of the zone, over REST and over realtime.
- `zone.countsUpdated` reaches the plain zone room without governance fields and the staff room
  with them, on join, approve, reject, kick, ban, list create, list delete and account
  deletion.
- Migration `1756000600000-CountIndexes` applies and reverts cleanly, and every count query is
  index backed (verified with `EXPLAIN` in the integration spec or by inspection, recorded in
  the PR).
- `nx run-many --all --target=test|lint|build` green for the luna projects.
