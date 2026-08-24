# 0008 Account merge (per zone)

Adds the owner approved, single zone account merge to `luna-shopper-core`, plus the note on
how it relates to the in place upgrade from 0005. Depends on 0006 and 0007 because merge
reassigns data those plans created.

## 1. What merge is for

A user who lost their temporary token cannot upgrade in place (0005 section 4.5), because they
can no longer prove they own that old account. Instead they register a fresh account, join the
zone, and ask the zone owner to **merge** the old account's data into the new one. Because a
user is claiming another account's data, it requires owner approval. Merge is scoped to a
single zone: it moves that zone's data and kicks the source from that zone; the accounts
themselves are not deleted, and other zones are untouched.

## 2. Data model (core database)

**MergeRequest**
- `id` (uuid)
- `zoneId` -> Zone
- `sourceUserId` (opaque; data is taken FROM here, this membership is kicked on approval)
- `targetUserId` (opaque; data is moved INTO here)
- `requestedByUserId` (opaque)
- `status`: `MergeRequestStatus` enum (`PENDING`, `APPROVED`, `REJECTED`, `CANCELLED`)
- `resolvedByUserId` (nullable)

Enum: `MergeRequestStatus`. Both `sourceUserId` and `targetUserId` must have a
`ZoneMembership` in the zone for the request to be valid.

## 3. Flow

- `merge.request { zoneId, sourceUserId, targetUserId }`: created by a member (typically the
  target, claiming the source's data), status `PENDING`.
- `merge.approve { mergeId }`: owner only. In **one core transaction**:
  1. Reassign the source member's zone scoped data to the target: `ShoppingList.createdBy`,
     `ListAccess.membership` (dedupe against existing target access), `ListLine.createdBy` and
     `approvedBy`, `LineComment.author`, all filtered to this `zoneId`.
  2. Set the source `ZoneMembership` to `KICKED` (the source is removed from the zone).
  3. Mark the request `APPROVED` with `resolvedByUserId`.
- `merge.reject` / `merge.cancel`: no data changes.

Because everything the merge touches lives in core's own database and is scoped to one zone,
the whole operation is a single local transaction with no distributed coordination. That is a
deliberate design benefit of keeping per zone usernames and zone data in core.

## 4. Relationship to the in place upgrade

- In place upgrade (0005): user still holds the temp token, keeps the same `userId`, nothing
  is reassigned, temp row is kept and flipped to registered.
- Merge (this plan): user lost the temp token, two distinct `userId`s exist, owner approves,
  per zone data is reassigned and the source is kicked from that zone.

If a future requirement wants an upgrade that truly deletes the old account and rewrites every
reference across all zones, that becomes a cross service saga: auth deletes the source user and
emits `user.merged { fromUserId, toUserId }`; core subscribes and rewrites references in every
zone in a transaction. It is documented here as the extension point but is not built now,
since the two mechanisms above cover the stated requirements without a distributed write.

## 5. Events published (realtime, wired in 0009)

`merge.requested`, `merge.approved` (also implies a `member.kicked` for the source),
`merge.rejected`. Names in the `RealtimeEvent` enum in `contracts`.

## 6. Migrations

New core migration adds `MergeRequest`. Append only.

## 7. Exit criteria

- A member can request a merge naming source and target; only the owner can approve.
- Approval reassigns the source's zone data to the target and kicks the source from the zone,
  atomically, with the accounts left intact.
- Reject and cancel leave data unchanged.
- Events are emitted for realtime consumers.
