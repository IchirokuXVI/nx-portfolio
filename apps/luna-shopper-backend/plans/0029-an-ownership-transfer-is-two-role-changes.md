# 0029 An ownership transfer is two role changes

> Depends on 0006 (zones and membership) and 0009 (realtime).
>
> Companion plan: `apps/velista/plans/0020`, the client half. Neither needs the other to
> deploy; section 5 says why that is deliberate.
>
> Verified against the source on 2026-08-28.

## 1. The defect

`ZoneService.transferOwnership` (`core/src/app/zones/zone.service.ts:262`) runs one
transaction that:

1. sets the outgoing owner's membership to `ADMIN`,
2. sets the target's membership to `OWNER` and `APPROVED`,
3. sets `zone.ownerUserId`,
4. emits `RealtimeEvent.ZoneOwnershipChanged` with the `ZoneView`.

**Two memberships changed role and no membership event was published.**
`ZoneService.claimOwnership` (`:290`) has the same shape: an admin becomes owner, and only
`zone.ownershipChanged` goes out.

It is a three line fix and it is worth its own plan because of what it costs while it is
unfixed, which is section 2.

## 2. What every client believes in the meantime

The velista client applies `zone.ownershipChanged` in the same branch as `zone.updated`,
patching `name`, `joinCode`, `status` and `ownerUserId`. It does not touch the caller's
own role, because for `zone.updated` there is nothing to touch. So after a transfer:

- **The new owner is never told.** Their role chip still reads Admin, the owner-only
  actions never appear, and their client never re-syncs the staff room.
- **The outgoing owner is never told either, and this is the damaging half.** They still
  hold `myRole: 'OWNER'`, so their group settings sheet still offers Delete group and the
  member action sheet still offers Transfer ownership. Both call an endpoint that answers
  `requireRole(..., [OWNER])` with a forbidden. The screen invites an action and the
  server refuses it.
- The members screen shows both people's old roles, and every row's action menu is built
  from a role that is wrong.

The rule this violates is worth stating in the terms the client plans use, because it is
the same rule in both codebases:

> A role is a permission. If the server changes it, it publishes the change. A control
> left on screen for somebody who may no longer press it is not a cosmetic problem: every
> press of it is an error.

## 3. The fix

Inside `transferOwnership`'s transaction, after the two memberships are saved, emit
`RealtimeEvent.MemberRoleChanged` twice, once per membership, through the existing
`emitMember` helper, so the payload is the same `MembershipView` every other membership
event carries and every consumer already understands.

Emitted after the transaction commits, not inside it, for the reason every other emit in
this service is: an event for a transaction that then rolls back is a lie every client
acts on.

`claimOwnership` emits one, for the admin who became owner.

**Nothing is added to the contract.** `MemberRoleChanged` exists, is in
`DOMAIN_EVENT_SUBJECTS`, is in `ACCESS_INVALIDATING_EVENTS`, is routed to the zone room,
and is already applied by the velista client's `ZoneStore` and `MembershipStore`. The
event was simply never sent for this path, which is why the repair is three lines and the
client-side inference in velista `0020` section 2.3 is a safety net rather than the fix.

### 3.1 Ordering

The three events go out in the order: both `MemberRoleChanged`, then
`ZoneOwnershipChanged`. Roles first so that a client applying them in order never has a
frame where `ownerUserId` names somebody whose role still says otherwise. JetStream
preserves per-subject order and not cross-subject order, so this is a best effort rather
than a guarantee, which is exactly why velista `0020` also derives the caller's role from
`ownerUserId` and both writers compute the same value.

### 3.2 One consequence to check rather than assume

`ZoneOwnershipChanged` and two `MemberRoleChanged` now arrive for one action, and the
realtime service invalidates the zone and staff access caches for each. That is three
`DEL`s where there was one, on an action taken perhaps twice in a group's lifetime, and
`realtime/constants.ts` already states the tradeoff it is happy with ("a false entry here
costs one `DEL`").

## 4. Tests

- `transferOwnership` emits exactly three events, and the two `MemberRoleChanged` payloads
  carry the outgoing owner as `ADMIN` and the target as `OWNER` and `APPROVED`.
- `claimOwnership` emits one `MemberRoleChanged` carrying the claimant as `OWNER`.
- A rolled back transfer emits nothing.
- The integration spec asserts a socket in the zone room receives all three.

## 5. What is not in this plan

**The join code stays as it is.** An earlier draft of this plan made `ZoneView.joinCode`
nullable and filled it only for a caller who manages the zone, so that an ordinary member's
browser never held it. That was removed on the product decision that the code is not a
secret: any member could obtain it by asking, and the requirement is only that the group
page not draw a governance surface for somebody it does not belong to. That is a UI
decision and it lives entirely in velista `0020` section 5.

Recorded here rather than deleted, because the change it describes is the kind a reader
proposes twice. If it is ever wanted, the pattern is `pendingRequestCount` from 0017: the
mapper takes a viewer, `null` means "not yours to have" rather than "no code", and the
realtime fan out splits the zone-view events across the plain and staff rooms exactly as
`fanOutZoneCounts` already splits the counts.

## 6. The OpenAPI document

Nothing here changes an HTTP request or response DTO, so the gateway's document should be
byte identical. Run the generator anyway and confirm the empty diff, rather than assuming
it:

```sh
npx nx run luna-shopper-backend-gateway:openapi
```

## 7. Acceptance

1. Transferring ownership emits two `member.roleChanged` events and one
   `zone.ownershipChanged`, and the memberships in them carry the new roles.
2. Claiming an ownerless zone emits one `member.roleChanged`.
3. A client in the zone room sees both people's roles change without a reload, and the
   outgoing owner is no longer offered Delete group or Transfer ownership.
4. This plan deploys with no client change, and velista `0020` deploys with no server
   change.
