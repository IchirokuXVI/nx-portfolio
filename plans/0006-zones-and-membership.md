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
- `ownerUserId` (opaque userId)

**ZoneMembership**
- `id` (uuid)
- `zoneId` -> Zone
- `userId` (opaque)
- `username` (per zone display name, required at join time)
- `role`: `ZoneRole` enum (`OWNER`, `MEMBER`)
- `status`: `MembershipStatus` enum (`PENDING`, `APPROVED`, `KICKED`, `BANNED`)
- `approvedByUserId` (nullable)
- unique (`zoneId`, `userId`)
- unique (`zoneId`, `username`)

Enums: `ZoneRole`, `MembershipStatus`. Zone config keys become an enum once the concrete
flags are defined; the column exists now so nothing needs a schema change to start using it.

## 2. Create or join, and the token handshake

Both entry actions also produce a token for a client that has none, via the gateway (see
0005 section 4.1). The gateway orchestrates:

- **Create a space**: if the client has no token, gateway asks auth to mint a temporary user,
  then calls core `zone.create { name, username, ownerUserId }`. Core creates the `Zone` and
  an owner `ZoneMembership` already `APPROVED` with role `OWNER`. Response carries the token
  (if newly minted) and the zone.
- **Join by code**: same token handshake, then core `zone.join { joinCode, username, userId }`
  creates a `ZoneMembership` with status `PENDING`. The user has no access to zone data until
  an owner approves. A `BANNED` prior membership blocks rejoining.

Per zone `username` uniqueness is enforced by the unique constraint; a clash is a clean
validation error the client can retry.

## 3. Owner operations

- `zone.update { zoneId, name?, config? }`: owner only, edits name and configuration.
- `zone.delete { zoneId }`: owner only.
- `zone.regenerateJoinCode { zoneId }`: owner only.
- Membership governance (owner only):
  - `membership.approve` / `membership.reject` a `PENDING` member.
  - `membership.kick`: sets `KICKED` (access removed, may re request).
  - `membership.ban`: sets `BANNED` (rejoin blocked).

## 4. Authorization

Every core message resolves the caller's `ZoneMembership` for the target zone and checks:
- the member is `APPROVED` for read/data operations,
- the member is the `OWNER` for the owner operations above.
Tokens are verified offline; core trusts the `userId` claim and looks up membership locally.

## 5. Events published (for realtime, wired in 0009)

`zone.updated`, `zone.deleted`, `member.joined` (pending), `member.approved`, `member.rejected`,
`member.kicked`, `member.banned`. Names live in the `RealtimeEvent` enum in `contracts`.

## 6. Migrations

First core migration creates `Zone` and `ZoneMembership`. Append only thereafter.

## 7. Exit criteria

- A client with no token can create a space and receive a token in one round trip.
- A client can join by code with a per zone username and land in `PENDING`.
- Owner can approve, reject, kick, ban, edit the zone, delete it, and regenerate the code.
- Non owners cannot perform owner operations; unapproved members cannot read zone data.
- Every listed event is emitted on the matching mutation.
