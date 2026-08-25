# Auth service data model

Entity relationship and class diagrams for `luna-shopper-backend-auth`, the identity provider. This
service owns its own database and is the only place identity data lives. Source of truth for the
model is plan `0005-auth-service.md`; these diagrams are generated from it and should be updated
alongside the entities once they are coded.

Users in other services are referenced only by the opaque `userId` this service mints; no other
service reads this database.

## ER diagram

```mermaid
erDiagram
    USER ||--o| CREDENTIAL : "has (email login)"
    USER ||--o{ OAUTH_IDENTITY : "has"
    USER ||--o{ EMAIL_VERIFICATION : "has"
    USER ||--o{ REFRESH_TOKEN : "has"

    USER {
        uuid id PK
        UserKind kind
        string email UK "nullable, unique when set"
        timestamp emailVerifiedAt "nullable"
        string displayName "nullable"
        timestamp createdAt
        timestamp updatedAt
    }
    CREDENTIAL {
        uuid id PK
        uuid userId FK "unique, one per user"
        string passwordHash "argon2"
    }
    OAUTH_IDENTITY {
        uuid id PK
        uuid userId FK
        AuthProvider provider
        string providerUserId
        timestamp createdAt
    }
    EMAIL_VERIFICATION {
        uuid id PK
        uuid userId FK
        string tokenHash
        timestamp expiresAt
        timestamp consumedAt "nullable"
    }
    REFRESH_TOKEN {
        uuid id PK
        uuid userId FK
        string tokenHash
        timestamp expiresAt
        timestamp revokedAt "nullable"
    }
```

Constraints of note: `OAUTH_IDENTITY` is unique on (`provider`, `providerUserId`); `CREDENTIAL`
is unique on `userId` (at most one email password credential per user).

## Class diagram

```mermaid
classDiagram
    class User {
        +uuid id
        +UserKind kind
        +string email
        +Date emailVerifiedAt
        +string displayName
    }
    class Credential {
        +uuid id
        +uuid userId
        +string passwordHash
    }
    class OAuthIdentity {
        +uuid id
        +uuid userId
        +AuthProvider provider
        +string providerUserId
    }
    class EmailVerification {
        +uuid id
        +uuid userId
        +string tokenHash
        +Date expiresAt
        +Date consumedAt
    }
    class RefreshToken {
        +uuid id
        +uuid userId
        +string tokenHash
        +Date expiresAt
        +Date revokedAt
    }
    class UserKind {
        <<enumeration>>
        TEMPORARY
        REGISTERED
    }
    class AuthProvider {
        <<enumeration>>
        GOOGLE
        EMAIL
    }

    User "1" --> "0..1" Credential
    User "1" --> "0..*" OAuthIdentity
    User "1" --> "0..*" EmailVerification
    User "1" --> "0..*" RefreshToken
    User ..> UserKind
    OAuthIdentity ..> AuthProvider
```

## Notes

- `User.kind` distinguishes a `TEMPORARY` account (device token only) from a `REGISTERED` one
  (email or Google). The temp to account upgrade flips `kind` in place, keeping the same `id`.
- Access tokens are signed JWTs verified offline by other services; only refresh tokens are
  stored here (`REFRESH_TOKEN`, rotated on use).
- All enums are defined as constants and mirrored into `@portfolio/luna-shopper/contracts` where
  a value crosses a service boundary.
