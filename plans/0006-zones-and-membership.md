# 0006 Zones and membership

First domain slice of `luna-shopper-core`: zones (spaces) and the governance around who is in
them. Depends on auth (0005) for identities and on the gateway to orchestrate the token plus
zone flows.

## 1. Data model (core database)

TypeORM classes local to core. Users are referenced by opaque `userId` (JWT subject); core
never reads the auth database. Timestamps omitted.

**Zone** (a space)
- `id` (uuid)
- `name`
- `config` (jsonb, typed configuration object; empty for now, future boolean flags such as
  "allow new members" land here with their keys defined in an enum)
- `joinCode` (unique, regenerable)
- `status`: `ZoneStatus` enum (`ACTIVE`, `MARKED_FOR_DELETION`)
- `ownerUserId` (opaque userId, **nullable**: a zone may temporarily have no owner)

**ZoneMembership**
- `id` (uuid)
- `zoneId` -> Zone
- `userId` (opaque)
- `username` (per zone display name, required at join time)
- `role`: `ZoneRole` enum (`OWNER`, `ADMIN`, `MEMBER`)
- `status`: `MembershipStatus` enum (`PENDING`, `APPROVED`, `KICKED`, `BANNED`)
- `approvedByUserId` (nullable)
- unique (`zoneId`, `userId`)
- unique (`zoneId`, `username`)

Enums: `ZoneStatus`, `ZoneRole`, `MembershipStatus`. Zone config keys become an enum once the
concrete flags are defined; the column exists now so nothing needs a schema change to start
using it.

## 2. Roles and powers

- **OWNER** (at most one per zone, may be absent): everything an admin can do, plus delete the
  zone, promote/demote admins, and transfer ownership.
- **ADMIN** (any number): governance (approve/reject/kick/ban members, approve merges from
  0008), manage lists and list access, edit the zone name and config. Cannot delete the zone,
  manage admins, or change ownership.
- **MEMBER**: participates according to list access (0007).

## 3. Create or join, and the token handshake

The temporary identity is minted **only when a client actually creates or joins a zone**, never
before (this is the fix for orphaned temp users; a client that only opens the app and does
nothing gets no account). The gateway orchestrates, with an idempotency key (0004 section 9) so
a retry never mints two users:

- **Create a space**: if the client has no token, gateway asks auth to mint a temporary user,
  then calls core `zone.create { name, username, ownerUserId }`. Core creates the `Zone`
  (`status = ACTIVE`) and an owner `ZoneMembership` already `APPROVED` with role `OWNER`.
  Response carries the token (if newly minted) and the zone.
- **Join by code**: same token handshake, then core `zone.join { joinCode, username, userId }`
  creates a `ZoneMembership` with status `PENDING`. The user has no access to zone data until an
  owner or admin approves. A `BANNED` prior membership blocks rejoining.

Per zone `username` uniqueness is enforced by the unique constraint; a clash is a clean
validation error the client can retry.

## 4. Owner and admin operations

- `zone.update { zoneId, name?, config? }`: owner or admin.
- `zone.delete { zoneId }`: owner only.
- `zone.regenerateJoinCode { zoneId }`: owner or admin.
- `zone.setRole { zoneId, membershipId, role }`: owner only (promote a member to admin or
  demote an admin).
- `zone.transferOwnership { zoneId, membershipId }`: owner only.
- Membership governance (owner or admin):
  - `membership.approve` / `membership.reject` a `PENDING` member.
  - `membership.kick`: sets `KICKED` (access removed, may re request).
  - `membership.ban`: sets `BANNED` (rejoin blocked).

## 5. Ownerless zones and deletion fallback

When a zone loses its owner (triggered later by account deletion, plan 0011), core:
1. Sets `ownerUserId = null` and `status = MARKED_FOR_DELETION`, and emits an event so members
   see the zone is scheduled for deletion and can act.
2. If the zone has any `ADMIN`, an admin may `zone.claimOwnership { zoneId }`, which makes them
   `OWNER` and returns `status` to `ACTIVE`.
3. If no admin claims it, members are notified and a cleanup job (plan 0011) eventually deletes
   the zone. The model and the claim path are built here; the delete trigger and the job land
   with account deletion.

## 6. Authorization

Every core message resolves the caller's `ZoneMembership` for the target zone and checks:
- the member is `APPROVED` for read/data operations,
- the member is `OWNER` or `ADMIN` for governance operations, and `OWNER` for the owner only
  operations in section 4.
Tokens are verified offline; core trusts the `userId` claim and looks up membership locally.

## 7. Listing zones

- **My zones** (built now): a user lists the zones they belong to, both owned and joined.
  Creating a zone auto joins it with role `OWNER`, so owned zones are simply the memberships
  where `role = OWNER`; there is no separate "owned" concept. The listing returns every zone
  where the user holds a membership that is `APPROVED` or `PENDING` (so a user also sees a zone
  they are waiting to be approved into), each annotated with the caller's membership `role` and
  `status`. It is **cursor paginated and orderable** per 0004: the caller chooses the order (for
  example by name, by joined time, or by recent activity). Message:
  `zone.listMine { cursor?, order? }`.
- **Admin listing (deferred)**: a back office listing of **all** zones with usage info, gated
  behind the platform admin role (0012 section 3). Not built now.

## 8. Join codes (simple now, richer later)

For now the join code is a short, human typeable code, adequate for a closed group of under ten
testers. **Annotated future work, not implemented now:**
- higher entropy codes once the app is public,
- joining only through a **share link with the code embedded**, where sharing is configurable:
  custom expiry up to infinite, and a use policy of single use, limited uses, or infinite uses,
- per user rate limits on creation and joining, configurable (for example no more than 2 zones
  created per 10 minutes), enforced via the throttler from 0004 with values read from config.

## 9. Events published (for realtime, wired in 0009)

`zone.updated`, `zone.deleted`, `zone.markedForDeletion`, `zone.ownershipChanged`,
`member.joined` (pending), `member.approved`, `member.rejected`, `member.kicked`,
`member.banned`, `member.roleChanged`. Names live in the `RealtimeEvent` enum in `contracts`.

## 10. Migrations

First core migration creates `Zone` and `ZoneMembership` with the enums above. Append only
thereafter.

## 11. Exit criteria

- A client with no token can create a space and receive a token in one round trip, and no token
  is issued to a client that does not create or join.
- A client can join by code with a per zone username and land in `PENDING`.
- Owner and admins can approve, reject, kick, ban, edit the zone, and regenerate the code; only
  the owner can delete, manage admins, or transfer ownership.
- Losing the owner marks the zone for deletion and lets an admin claim ownership.
- A user can list their own zones (owned and joined), cursor paginated and orderable.
- Non privileged members cannot perform governance; unapproved members cannot read zone data.
- Every listed event is emitted on the matching mutation.
