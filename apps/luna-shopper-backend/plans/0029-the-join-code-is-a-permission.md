# 0029 The join code is a permission, and an ownership transfer is two role changes

> Depends on 0006 (zones and membership), 0009 (realtime) and 0017 (counts and
> summaries, whose "the value is the permission" pattern this plan copies exactly).
>
> Companion plan: `apps/velista/plans/0020`, which is the client half. Section 6 gives
> the order the two land in.
>
> Verified against the source on 2026-08-28.

## 1. Two defects, one principle

**The join code goes to everyone.** `ZoneView.joinCode` is a non-nullable string on every
zone response and inside every `zone.updated` and `zone.ownershipChanged` payload, so an
ordinary member holds the code for every group they are in. Only an owner or an admin can
regenerate it (`ZoneService.regenerateJoinCode` requires `[OWNER, ADMIN]`), so a member
who hands it around has done something nobody can undo.

**An ownership transfer changes two roles and publishes neither.**
`ZoneService.transferOwnership` demotes the outgoing owner to `ADMIN`, promotes the target
to `OWNER`, and emits only `RealtimeEvent.ZoneOwnershipChanged`. The same is true of
`ZoneService.claimOwnership`.

They are one plan because they are one principle, which 0017 already established for the
governance counts and this plan extends to the code and to the roles themselves:

> A field a caller may not act on is not sent to them, and a field that changes is
> published as the change it is.

## 2. `joinCode` becomes nullable, and is filled only for a manager

### 2.1 The contract

`ZoneView.joinCode` becomes `string | null`, documented in the shape 0017 documents
`pendingRequestCount`: **`null` means "not yours to have", never "this zone has no code"**.
Every zone always has one. The schema in
`libs/luna-shopper/contracts/src/schemas/` is updated with it, and
`ZonePreview` (the unauthenticated join-code lookup from 0024) is untouched: it never
carried the code and deliberately does not echo it back.

### 2.2 The mapper needs a viewer, and that is the substance of this change

`toZoneView(zone: Zone): ZoneView` takes the entity alone. It cannot gate anything,
because it does not know who is asking. It gains a second parameter:

```ts
export function toZoneView(zone: Zone, viewer: SummaryViewer | null): ZoneView
```

`SummaryViewer` and `managesZone` already exist in `zone.mappers.ts` and already encode
exactly the right question; 0017 wrote `managesZone` so that "the REST mapper and the
realtime staff room both read it from here", and this is a third reader of the same rule
rather than a fourth opinion about it. `viewer === null` yields `joinCode: null`.

A required parameter and not an optional one. An optional viewer defaults to "not staff",
which is safe, and a required one makes the compiler enumerate the call sites, which is
what actually gets this right: there are eight, and three of them are events rather than
responses.

The call sites, and what each passes:

| Call site                              | Viewer                                  |
| -------------------------------------- | --------------------------------------- |
| `ZoneService.create` (`:118`)           | the creator's membership; they are OWNER |
| `ZoneService.update` (`:214`)           | the caller's membership from `requireRole` |
| `regenerateJoinCode` (`:235`)           | the caller's; owner or admin by definition |
| `transferOwnership` (`:281`)            | see 2.3                                 |
| `claimOwnership` (`:308`)               | see 2.3                                 |
| `toMyZoneView` (`:96`)                  | the membership it is already given      |
| `AccountDeletionService` (`:58`)        | `null`; see 2.4                         |
| `ZoneService.delete`'s event            | carries `{ id }` only; unaffected        |

`toMyZoneView` is the important one and it is free: it already receives the caller's
membership in order to fill `myRole` and `myStatus`, so it passes what it holds. That
single change covers both list-my-zones and get-one-zone, which is every screen the client
draws a group from.

### 2.3 The events carry the code, and the realtime service is where that is split

`zone.updated`, `zone.ownershipChanged` and `zone.markedForDeletion` publish a `ZoneView`
into `zone:{id}`, which every approved member is in. Filling the code for the actor who
caused the change would broadcast it to the whole room, so the domain service **publishes
the view filled** and the split happens at fan out, which is precisely how
`ZoneCountsUpdated` already works:

> Core publishes the counts filled, and the split happens here, because this is where room
> routing lives: the staff room gets it as sent, the plain zone room gets a copy with both
> governance fields nulled.
> (`jetstream.consumer.ts`, `fanOutZoneCounts`)

So `JetStreamConsumer` grows a second two-room fan out, for the three zone-view events:
`zone:{id}:staff` receives the payload as sent; `zone:{id}` receives a copy with
`joinCode: null`. `fanOutZoneCounts` and this one are written as one helper taking the
list of fields to null, because they are now two instances of the same rule and a second
hand-rolled copy is how the two drift.

The HTTP response for `regenerateJoinCode` still returns the new code to the admin who
asked; that is a response to a request, not a broadcast, and 2.2 already fills it.

### 2.4 Account deletion passes `null`, and it is right to

`AccountDeletionService` emits `zone.markedForDeletion` for zones whose owner deleted their
account. There is no viewer: the owner is gone. `null` is correct on its own terms, since
the code is not the news in that event and the marking is, and 2.3 would null it for the
plain room anyway.

### 2.5 Tests

- `zone-summary.spec.ts` gains: a member's `MyZoneView` has `joinCode: null`; an admin's and
  an owner's do not.
- A consumer test asserting the plain zone room's `zone.updated` copy has `joinCode: null`
  while the staff room's has the code, in the shape of the existing counts-split test.
- The integration spec asserts an ordinary member's `GET /v1/zones/{id}` never contains the
  code, which is the assertion that would fail today.

## 3. An ownership transfer emits the two role changes it makes

Inside `transferOwnership`'s transaction, after the two memberships are saved, emit
`RealtimeEvent.MemberRoleChanged` twice, once per membership, using the existing
`emitMember` helper, so the payload is the same `MembershipView` every other membership
event carries and every consumer already understands. Emitted after the transaction
commits, not inside it, for the reason every other emit in this service is: an event for a
transaction that then rolls back is a lie every client acts on.

`claimOwnership` emits one, for the admin who became owner.

Nothing new is added to the contract. `MemberRoleChanged` exists, is in
`DOMAIN_EVENT_SUBJECTS`, is in `ACCESS_INVALIDATING_EVENTS`, is routed to the zone room and
is already applied by the client's `ZoneStore` and `MembershipStore`. **The event was
simply never sent for this path**, which is why the fix is three lines and the client half
in velista `0020` is a safety net rather than the repair.

One consequence to check rather than assume: `ZoneOwnershipChanged` and two
`MemberRoleChanged` now arrive for one action, and the realtime service invalidates the
zone and staff access caches for each. That is three `DEL`s where there was one, on an
action taken perhaps twice in a group's lifetime, and the constants file already states the
tradeoff it is happy with ("a false entry here costs one `DEL`").

### 3.1 Ordering

The three events go out in the order: both `MemberRoleChanged`, then `ZoneOwnershipChanged`.
Roles first so that a client applying them in order never has a frame where `ownerUserId`
names somebody whose `myRole` still says otherwise. JetStream preserves per-subject order
and not cross-subject order, so this is a best effort rather than a guarantee, which is
exactly why velista `0020` also derives `myRole` from `ownerUserId` and both writers
compute the same value.

## 4. What is deliberately not changed

- **Members can still join with a code.** This plan changes who can *read* the code, not
  who can use one. The unauthenticated `getByCode` preview from 0024 is untouched.
- **No new "invite" permission.** The permission already exists and is `managesZone`. A
  second concept that means the same thing is how two of them come to disagree.
- **`joinCode` stays on `ZoneView` rather than moving to a staff-only view.** A second view
  type would fork every response shape and every mapper to express one nullable field, and
  0017 already chose nullability for the same problem.

## 5. The OpenAPI document

`ZoneView.joinCode` becoming nullable changes the gateway's document, so:

```sh
npx nx run luna-shopper-backend-gateway:openapi
```

and commit the diff in the same change. `openapi-document.spec.ts` fails on a stale file
and the PR checks run it, so a forgotten regeneration is a red PR rather than silent drift.

## 6. Landing order with the client

The client must tolerate a null before the server can send one. So:

1. velista `0020` steps 1 and 2 (client-only, correct against today's server).
2. This plan. A client that still types `joinCode` as `string` reads `null` as a falsy
   string and renders an empty code box for a member: visible, harmless, and short-lived.
3. velista `0020` step 4: `joinCode: string | null` in the models, and the invite card
   gated on the value rather than on a role.

Reversing 2 and 3 is the failure case worth naming: a client that requires a nullable code
against a server that still sends a string is not broken, but a client typed `string` that
meets a `null` after step 2 is only safe because the app renders the code and nothing
parses it. Do not rely on that a second time.

## 7. Acceptance

1. An ordinary member's `GET /v1/zones/{id}` and `GET /v1/zones` both carry
   `joinCode: null`. An admin's and an owner's carry the code.
2. A `zone.updated` observed on a plain member's socket carries `joinCode: null`; the same
   event observed by an owner carries the code.
3. `POST /v1/zones/{id}/join-code` still returns the new code to the admin who called it.
4. Transferring ownership emits two `member.roleChanged` events and one
   `zone.ownershipChanged`, and the two memberships in them carry the new roles.
5. Claiming an ownerless zone emits one `member.roleChanged`.
6. The committed `openapi.json` is regenerated and the gateway suite is green.
