# Core service data model

Entity relationship and class diagrams for `luna-shopper-core`: zones, membership, merges, and
shopping lists. This service owns its own database. Source of truth for the model is the plans
`0006-zones-and-membership.md`, `0007-shopping-lists.md`, and `0008-account-merge.md`; these
diagrams are generated from them and should be updated alongside the entities once coded.

Users are referenced only by an opaque `userId` minted by the auth service. Core never reads the
auth database, so those references are plain columns, not foreign keys. Likewise `ListLine.itemId`
is an opaque reference into the future catalog service (see the appendix), also not a foreign key.

## ER diagram (core database)

```mermaid
erDiagram
    ZONE ||--o{ ZONE_MEMBERSHIP : "has members"
    ZONE ||--o{ SHOPPING_LIST : "contains"
    ZONE ||--o{ MERGE_REQUEST : "scopes"
    SHOPPING_LIST ||--o{ LIST_ACCESS : "grants"
    ZONE_MEMBERSHIP ||--o{ LIST_ACCESS : "is granted"
    SHOPPING_LIST ||--o{ LIST_LINE : "has"
    LIST_LINE ||--o{ LINE_COMMENT : "has"

    ZONE {
        uuid id PK
        string name
        jsonb config "future flags"
        string joinCode UK
        ZoneStatus status
        uuid ownerUserId "opaque, nullable (ownerless allowed)"
        timestamp createdAt
        timestamp updatedAt
    }
    ZONE_MEMBERSHIP {
        uuid id PK
        uuid zoneId FK
        uuid userId "opaque"
        string username "unique per zone"
        ZoneRole role
        MembershipStatus status
        uuid approvedByUserId "opaque, nullable"
    }
    MERGE_REQUEST {
        uuid id PK
        uuid zoneId FK
        uuid sourceUserId "opaque, kicked on approve"
        uuid targetUserId "opaque, receives data"
        uuid requestedByUserId "opaque"
        MergeRequestStatus status
        uuid resolvedByUserId "opaque, nullable"
    }
    SHOPPING_LIST {
        uuid id PK
        uuid zoneId FK
        string name
        uuid createdByUserId "opaque"
    }
    LIST_ACCESS {
        uuid id PK
        uuid listId FK
        uuid membershipId FK
        ListRole role
    }
    LIST_LINE {
        uuid id PK
        uuid listId FK
        string content
        int quantity "default 1"
        uuid itemId "opaque catalog ref, nullable"
        int position
        LineApprovalStatus approvalStatus
        LineStatus status
        uuid createdByUserId "opaque"
        uuid approvedByUserId "opaque, nullable"
        int version "last-write-wins reconciliation"
    }
    LINE_COMMENT {
        uuid id PK
        uuid lineId FK
        uuid authorUserId "opaque"
        string body
    }
```

Constraints of note: `ZONE_MEMBERSHIP` is unique on (`zoneId`, `userId`) and on (`zoneId`,
`username`); `LIST_ACCESS` is unique on (`listId`, `membershipId`).

## Class diagram

```mermaid
classDiagram
    class Zone {
        +uuid id
        +string name
        +json config
        +string joinCode
        +ZoneStatus status
        +uuid ownerUserId
    }
    class ZoneMembership {
        +uuid id
        +uuid zoneId
        +uuid userId
        +string username
        +ZoneRole role
        +MembershipStatus status
        +uuid approvedByUserId
    }
    class MergeRequest {
        +uuid id
        +uuid zoneId
        +uuid sourceUserId
        +uuid targetUserId
        +uuid requestedByUserId
        +MergeRequestStatus status
        +uuid resolvedByUserId
    }
    class ShoppingList {
        +uuid id
        +uuid zoneId
        +string name
        +uuid createdByUserId
    }
    class ListAccess {
        +uuid id
        +uuid listId
        +uuid membershipId
        +ListRole role
    }
    class ListLine {
        +uuid id
        +uuid listId
        +string content
        +int quantity
        +uuid itemId
        +int position
        +LineApprovalStatus approvalStatus
        +LineStatus status
        +uuid createdByUserId
        +uuid approvedByUserId
        +int version
    }
    class LineComment {
        +uuid id
        +uuid lineId
        +uuid authorUserId
        +string body
    }

    class ZoneStatus {
        <<enumeration>>
        ACTIVE
        MARKED_FOR_DELETION
    }
    class ZoneRole {
        <<enumeration>>
        OWNER
        ADMIN
        MEMBER
    }
    class MembershipStatus {
        <<enumeration>>
        PENDING
        APPROVED
        KICKED
        BANNED
    }
    class MergeRequestStatus {
        <<enumeration>>
        PENDING
        APPROVED
        REJECTED
        CANCELLED
    }
    class ListRole {
        <<enumeration>>
        READER
        WRITER
    }
    class LineApprovalStatus {
        <<enumeration>>
        PENDING
        APPROVED
        REJECTED
    }
    class LineStatus {
        <<enumeration>>
        PENDING
        READY
        NOT_AVAILABLE
    }

    Zone "1" --> "0..*" ZoneMembership
    Zone "1" --> "0..*" ShoppingList
    Zone "1" --> "0..*" MergeRequest
    ShoppingList "1" --> "0..*" ListAccess
    ZoneMembership "1" --> "0..*" ListAccess
    ShoppingList "1" --> "0..*" ListLine
    ListLine "1" --> "0..*" LineComment
```

## Notes

- A line carries two independent state machines: `approvalStatus` (it must be approved) and
  `status` (the item state: pending, ready, not available). The `version` column backs the last
  write wins reconciliation used by realtime (plan 0009).
- `ownerUserId` is nullable: a zone can be temporarily ownerless (owner account deleted), which
  sets `status = MARKED_FOR_DELETION` until an admin claims ownership or a reaper removes it
  (plans 0006 and 0011).
- Cross service references (`ownerUserId`, `userId`, `createdByUserId`, and the merge user ids)
  point at auth `User.id`; `itemId` points at catalog `Item.id`. They are validated in
  application code, never by a database foreign key, because each service owns its own database.

## Appendix: catalog service (planned, separate database)

The catalog is its own service (`luna-shopper-catalog`, plan 0012) with its own database, built
last and owner curated. It is shown here because `ListLine.itemId` optionally references it. When
the catalog app is scaffolded this diagram moves to `apps/luna-shopper/catalog/docs/`.

```mermaid
erDiagram
    SUPERMARKET ||--o{ SUPERMARKET_LOCATION : "has locations"
    ITEM ||--o{ SUPERMARKET_ITEM : "priced as"
    SUPERMARKET_LOCATION ||--o{ SUPERMARKET_ITEM : "stocks"

    SUPERMARKET {
        uuid id PK
        json name "localized"
        json info "brand level"
    }
    SUPERMARKET_LOCATION {
        uuid id PK
        uuid supermarketId FK
        json label "localized, nullable"
        string address
        json info "location level"
    }
    ITEM {
        uuid id PK
        json name "localized"
        string brand
        string image
        string sku
        json info "item level"
    }
    SUPERMARKET_ITEM {
        uuid id PK
        uuid itemId FK
        uuid supermarketLocationId FK
        decimal price
        string positionInStore
        json info "per location"
    }
```

`SUPERMARKET` is the chain (Mercadona is one row); `SUPERMARKET_LOCATION` is each physical store
(50 rows for 50 Mercadonas); `SUPERMARKET_ITEM` is the per store price and position for an item,
unique on (`itemId`, `supermarketLocationId`).
