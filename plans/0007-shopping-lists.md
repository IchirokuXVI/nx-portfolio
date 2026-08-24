# 0007 Shopping lists, lines, and comments

Second domain slice of `luna-shopper-core`: the actual shopping lists inside a zone, their per
user write permissions, the lines with their two state machines, and comments. Depends on
0006 (zones and approved memberships).

## 1. Data model (core database)

TypeORM classes local to core. Timestamps omitted.

**ShoppingList**
- `id` (uuid)
- `zoneId` -> Zone
- `name`
- `createdByUserId` (opaque)

**ListAccess** (which zone members may write to a list)
- `id` (uuid)
- `listId` -> ShoppingList
- `membershipId` -> ZoneMembership
- `role`: `ListRole` enum (`READER`, `WRITER`)
- unique (`listId`, `membershipId`)

**ListLine**
- `id` (uuid)
- `listId` -> ShoppingList
- `content`
- `position` (ordering within the list)
- `approvalStatus`: `LineApprovalStatus` enum (`PENDING`, `APPROVED`, `REJECTED`)
- `status`: `LineStatus` enum (`PENDING`, `READY`, `NOT_AVAILABLE`)
- `createdByUserId` (opaque)
- `approvedByUserId` (nullable)

**LineComment**
- `id` (uuid)
- `lineId` -> ListLine
- `authorUserId` (opaque)
- `body`

Enums: `ListRole`, `LineApprovalStatus`, `LineStatus`. A line carries two independent states:
approval (it has to be approved) and item state (pending, ready, not available).

## 2. Operations

- `list.create { zoneId, name }`: an approved member creates a list; creator gets `WRITER`
  access by default.
- `list.setAccess { listId, entries: [{ membershipId, role }] }`: choose which zone members
  can write (`WRITER`) or only read (`READER`). Restricted to the list creator or the zone
  owner.
- `list.update` / `list.delete`.
- `line.add { listId, content }`: writers only. New line starts `approvalStatus = PENDING`
  and `status = PENDING`.
- `line.setApproval { lineId, approvalStatus }`: approve or reject a line (records
  `approvedByUserId`). Who may approve is a policy choice; default is zone owner or a
  designated approver, confirmed when implementing.
- `line.setStatus { lineId, status }`: writers move a line between `PENDING`, `READY`,
  `NOT_AVAILABLE`.
- `line.reorder`, `line.delete`.
- `comment.add { lineId, body }`: any approved member of the zone may comment.

## 3. Authorization

- Reading a list requires approved membership in the zone and a `ListAccess` row (reader or
  writer).
- Writing lines requires `WRITER` access on that list.
- Setting access and list update/delete are limited to the list creator or the zone owner.
- All checks run against core's own membership and access tables using the token `userId`.

## 4. Events published (realtime, wired in 0009)

`list.created`, `list.updated`, `list.deleted`, `list.accessChanged`, `line.added`,
`line.updated` (covers approval and status changes), `line.reordered`, `line.deleted`,
`comment.added`. Names in the `RealtimeEvent` enum in `contracts`.

## 5. Migrations

New core migration adds `ShoppingList`, `ListAccess`, `ListLine`, `LineComment`. Append only.

## 6. Exit criteria

- An approved member can create a list and pick which members may write.
- Writers can add lines; lines carry independent approval and item states and can be
  reordered, approved/rejected, and moved between pending/ready/not available.
- Members can comment on lines.
- Read/write authorization is enforced from core's own tables.
- Every listed event is emitted on the matching mutation.
