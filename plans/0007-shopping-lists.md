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
- `quantity` (integer, default 1)
- `itemId` (nullable, opaque reference to a catalog Item; the catalog is built later in plan
  0012, so this column arrives with that plan or as a nullable placeholder before it. A line is
  never required to have an item.)
- `position` (ordering within the list)
- `approvalStatus`: `LineApprovalStatus` enum (`PENDING`, `APPROVED`, `REJECTED`)
- `status`: `LineStatus` enum (`PENDING`, `READY`, `NOT_AVAILABLE`)
- `createdByUserId` (opaque)
- `approvedByUserId` (nullable)
- `version` (integer, bumped on each edit; supports the last write wins reconciliation in 0009)

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
- `list.setAccess { listId, entries: [{ membershipId, role }] }`: choose which zone members can
  write (`WRITER`) or only read (`READER`). Restricted to the list creator, a zone admin, or the
  owner.
- `list.update` / `list.delete` (list creator, admin, or owner).
- `line.add { listId, content, quantity? }`: writers only. New line starts
  `approvalStatus = PENDING` and `status = PENDING`, `quantity` defaults to 1.
- `line.update { lineId, content?, quantity? }`: writers edit text/quantity (bumps `version`).
- `line.setApproval { lineId, approvalStatus }`: approve or reject a line (records
  `approvedByUserId`). Default approver is a zone admin or the owner; confirmed when
  implementing.
- `line.setStatus { lineId, status }`: writers move a line between `PENDING`, `READY`,
  `NOT_AVAILABLE`.
- `line.reorder`, `line.delete`.
- `comment.add { lineId, body }`: any approved member of the zone may comment.

## 3. Listing, pagination, and ordering

Pagination is a first class requirement here, following the cursor based convention in 0004.

- **Shopping lists** in a zone: paginated **and** orderable (for example by name or by created
  or updated time), order configurable by the caller.
- **Lines** in a list: paginated **and** orderable; the default order is `position` (the manual
  order), with other orders available.
- **Comments** on a line: paginated, with a **fixed order of newest to oldest** (no caller
  chosen ordering).

## 4. Authorization

- Reading a list requires approved membership in the zone and a `ListAccess` row (reader or
  writer).
- Writing lines requires `WRITER` access on that list.
- Setting access and list update/delete are limited to the list creator, a zone admin, or the
  owner.
- All checks run against core's own membership and access tables using the token `userId`.

## 5. Events published (realtime, wired in 0009)

`list.created`, `list.updated`, `list.deleted`, `list.accessChanged`, `line.added`,
`line.updated` (covers content, quantity, approval, and status changes; carries `version`),
`line.reordered`, `line.deleted`, `comment.added`. Names in the `RealtimeEvent` enum in
`contracts`.

## 6. Migrations

New core migration adds `ShoppingList`, `ListAccess`, `ListLine`, `LineComment`. The `itemId`
foreign relationship to the catalog is introduced in plan 0012; here `itemId` is a plain
nullable column so lines can carry it once the catalog exists. Append only.

## 7. Exit criteria

- An approved member can create a list and pick which members may write.
- Writers can add lines with a quantity; lines carry independent approval and item states and
  can be reordered, edited, approved/rejected, and moved between pending/ready/not available.
- Members can comment on lines.
- Lists and lines are paginated and orderable; comments are paginated newest to oldest.
- Read/write authorization is enforced from core's own tables.
- Every listed event is emitted on the matching mutation.
