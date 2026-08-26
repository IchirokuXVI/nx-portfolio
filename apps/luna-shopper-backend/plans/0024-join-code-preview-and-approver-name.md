# 0024 Previewing a join code, and naming the approver

Two small, purely additive reads. Neither fixes a defect; both remove a place where a screen that
is already built has to be vaguer than its design.

- **Nothing can resolve a join code to a zone**, so the join sheet cannot say which group is
  behind the code somebody just pasted.
- **A pending member cannot name their approver**, so the waiting card cannot say who to nudge.

Both are recorded as backend work in the velista plans that hit them
(`0008-creating-and-joining-a-group.md` section 5.7, and the approved mock in `0003`), and
neither is assumed by anything shipped. This plan is last in the set for that reason.

Depends on nothing in 0020 to 0023.

## 1. `GET /v1/zones/by-code/:code`

### 1.1 What is missing

`POST /v1/zones/join` is the only route in the gateway that accepts a join code, and it joins
with it. There is no way to look one up, so velista 0008 made it **rule E2**: nothing may preview
the group behind a code, the join sheet may not say "You are joining Flat 3B", and no
speculative call may be added to fake it.

The consequence is a screen that asks somebody to commit before it tells them what to. That is
also mildly unsafe: a mistyped or stale code produces a pending request in a group of strangers,
visible to that group's owner, with no step at which the person could have noticed.

### 1.2 The route

Public, no auth, `GET /v1/zones/by-code/:code`, returning **exactly**:

```ts
interface ZoneByCodeView {
  name: string;
  memberCount: number;
}
```

No id, no status, no owner, no created date, no echo of the code. Every one of those was
considered and dropped, because this is an unauthenticated endpoint keyed on a low entropy secret
and the correct default is that it answers the question the screen asks and nothing else. The id
in particular buys nothing: joining is by code, so the client never needs it, and withholding it
means a scraped code cannot be turned into a stable handle for the zone.

Active zones only. Anything else, including a code that never existed and a zone that was
archived, is a `not_found` with one generic message, so the route cannot be used to tell "wrong
code" from "code that used to work".

New `ZONE_PATTERNS.getByCode` in `libs/luna-shopper/contracts`, its request and response
interfaces, and their JSON Schemas; plan 0010's completeness spec fails without them. Core
answers it from `zone.service.ts` beside `join`, which already does the same lookup
(`WHERE joinCode = :code AND status = ACTIVE`, line 125) before it does anything else.

### 1.3 Ordering, because the router will eat it

Declared **before** `@Get(':id')` in `zone.controller.ts`, for the same reason `count` is
(line 181, and the comment there says so): a path segment route declared after a parameter route
is swallowed by the parameter. `by-code/:code` has two segments and `:id` has one, so this
particular pair would not actually collide, but the file has a convention and a future single
segment sibling would collide silently. Keep the static routes together, above `:id`.

### 1.4 The enumeration question, answered honestly

`core/src/app/zones/join-code.ts` generates eight characters from a 31 symbol alphabet, roughly
40 bits, and its own comment says it is "adequate for a closed group of testers" with a richer
scheme (higher entropy, expiry, use policies) recorded as future work rather than built.

An unauthenticated lookup is a cheaper oracle than the join route, because it leaves no
membership row and nothing for an owner to notice. So:

- The route carries `THROTTLE_LIMITS.joinCode`, the bucket that exists for exactly this
  (five per thirty seconds, "enumeration protection"), and it is not given a looser one.
- The response is two fields, so a successful guess yields a group name and a number rather than
  a way in. Joining still requires `POST /v1/zones/join` and still lands in PENDING behind an
  owner's approval (plan 0006, section 3). The approval step is what actually protects the zone,
  and this route does not touch it.
- Recorded here so it is not rediscovered: **if join codes are ever shortened, or the throttle is
  ever loosened, this route is the first thing to re-examine.** Raising the entropy of the code
  is the fix, not removing the lookup.

The honest summary is that this route makes an existing weakness slightly cheaper to probe and
does not create one, and the mitigation is the code length that was already flagged as
provisional.

## 2. `ownerUsername` on `MyZoneView`

### 2.1 What is missing

The approved `0003` mock says "Waiting for Marc to let you in". `MyZoneView` carries
`ownerUserId` and no name, and there is no endpoint a pending member may read that would give
them one. So the built card falls back to the name free "Waiting to be let in" and passes a name
parameter that nothing can fill.

The choice is to fill it or to delete it. **Fill it.** Naming the person turns a wait into a
thing the user can act on, they can go and ask Marc, and the difference costs a subquery.

### 2.2 Core already has the name, and does not need auth for it

This is the part that makes it cheap. Core does not have to ask auth who the owner is: the
owner's `zone_memberships` row already carries their per zone `username`, written on create and
maintained by plan 0018's rename flows. So the answer is one correlated subselect over an index
core already owns, and no cross service call.

`MyZoneView` gains:

```ts
/** The owner's per zone name, or null when the zone has no owner. */
ownerUsername: string | null;
```

It goes on `MyZoneView` and **not** on `ZoneView`. `ZoneView` is what the mutation endpoints
return (create, update, regenerate code, transfer ownership), and they would pay for a join none
of them reads. `MyZoneView` is the summary bearing view, it already carries computed fields, and
it is what both screens that need this actually receive.

Null is a real case, not a defensive habit: `ZoneView.ownerUserId` is already nullable and plan
0011 makes an unowned zone reachable when an owner deletes their account. The card's existing
name free string is the correct rendering for that.

### 2.3 Where it is computed

`core/src/app/zones/zone-summary.sql.ts`, as a scalar subquery beside the ones already there. It
is the same shape as `firstPendingRequesterName` (the oldest pending requester's name, ordered
and limited), and it is simpler, because the owner is identified by role rather than by ordering:

> the `username` of the APPROVED membership on this zone whose role is OWNER, or null.

Two conventions in that file are load bearing and both apply:

- **Every camelCase column is quoted by hand.** TypeORM does not rewrite `alias.property` inside
  a raw `addSelect` the way it does inside `where`, so an unquoted `z."ownerUserId"` reaches
  Postgres as `owneruserid` and fails at runtime with "column does not exist", which no mocked
  repository catches. The module's own header comment says this; it is repeated here because
  this is the next person to edit that file.
- The aliases `m` (the caller's membership) and `z` (the zone) are the ones to correlate against.

Adding it there means `listMine` and `get` both gain the field in one place, which is what the
two screens need: the group card in a list, and the detail view a pending member lands on.

### 2.4 Privacy

A PENDING applicant learns the owner's per zone handle. That is the right answer in both
directions: plan 0018 establishes the username as a public, non unique, freely chosen handle
that is deliberately not the person's real name (`user.entity.ts` says why `displayName` is not
reused for it), and the owner already sees the applicant's handle in their pending list. The
exchange is symmetric and neither side learns anything they did not publish.

Nothing else changes. `pendingRequestCount` and `firstPendingRequesterName` stay governance data,
null for anyone who is not OWNER or ADMIN, exactly as plan 0017 section 6 has them.

## 3. Tests

- **By code**: an active zone resolves to its name and APPROVED member count; an archived zone,
  and a code that never existed, both return the same `not_found`; the response body has exactly
  two keys, asserted as an equality on the object rather than field by field, so a later addition
  cannot leak in unnoticed; the throttle bucket is the join code one.
- **Owner name**: an owned zone returns the owner's per zone username through both `listMine` and
  `get`; a zone whose owner deleted their account returns null; a PENDING caller receives the
  name while still receiving null governance counts, which is the combination the waiting screen
  needs and the one most likely to be broken by a careless authorization change.
- One of the owner name tests must run against a real Postgres rather than a mocked repository,
  for the quoting reason in section 2.3. The integration setup from plan 0015 is where it goes.

Then `npx nx run luna-shopper-backend-gateway:openapi` with the diff committed.

## 4. Acceptance criteria

- [ ] `GET /v1/zones/by-code/:code` returns a name and a member count for an active zone, and
      `not_found` for everything else, with no way to distinguish the "everything else" cases.
- [ ] The response carries no id, status, owner or join code.
- [ ] The route is throttled with `THROTTLE_LIMITS.joinCode` and is declared above `:id`.
- [ ] `MyZoneView.ownerUsername` is populated from the OWNER membership, in `listMine` and `get`
      alike, and is null for an unowned zone.
- [ ] A PENDING member reading their own zone gets `ownerUsername` and still gets null for the
      governance counts.
- [ ] `npx nx run-many --all --target=lint` and `--target=test` pass, and `openapi.json` is
      regenerated and committed.

## 5. What velista can do once this lands

Recorded, not designed here. Rule E2 in its 0008 can be relaxed to allow the join sheet and the
shared link screen to name the group, which that plan says is a copy change on two screens and
nothing structural. The waiting card's name parameter starts rendering and its 0003 mock stops
being aspirational. Both are small enough to fold into whichever velista plan is open at the
time.

## 6. Out of scope

- **Raising join code entropy**, or giving codes expiry and use policies. Recorded as future work
  by plan 0006 section 8 and still is; section 1.4 says when it becomes urgent.
- **Any authenticated variant of the by code lookup.** A member who already belongs to the zone
  has `GET /v1/zones/:id` and does not need this.
- **The owner's email, display name, or anything else about them.** The per zone handle is what
  the screen shows and the only thing core holds without asking auth.
- **A "request to join" preview showing who else is in the group.** Member names are for members.
