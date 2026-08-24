# 0004 Auth service

Builds `luna-shopper-auth`: the identity provider. It owns identity data, issues tokens, and
handles every way a user comes to exist. Its database is private to this service.

## 1. Responsibilities

- Mint access tokens (signed with the private key) and refresh tokens.
- Create **temporary** users and **registered** users, and let a temporary user upgrade into
  a registered one.
- Email + password registration with optional (not mandatory) email confirmation.
- Google login that creates or links an account.
- Publish identity events other services react to (notably the upgrade saga in 0007).

## 2. Data model (auth database)

All entities are TypeORM classes local to this service. Timestamps omitted for brevity.

**User** (the identity)
- `id` (uuid)
- `kind`: `UserKind` enum (`TEMPORARY`, `REGISTERED`)
- `email` (nullable, unique when set)
- `emailVerifiedAt` (nullable)
- `displayName` (nullable)

**Credential** (email + password login; only for registered users that chose email)
- `id` (uuid)
- `userId` -> User (unique)
- `passwordHash`

**OAuthIdentity** (external login)
- `id` (uuid)
- `userId` -> User
- `provider`: `AuthProvider` enum (`GOOGLE`, `EMAIL`)
- `providerUserId`
- unique (`provider`, `providerUserId`)

**EmailVerification** (outstanding confirmation)
- `id` (uuid)
- `userId` -> User
- `tokenHash`
- `expiresAt`
- `consumedAt` (nullable)

**RefreshToken** (rotating refresh token records)
- `id` (uuid)
- `userId` -> User
- `tokenHash`
- `expiresAt`
- `revokedAt` (nullable)

Enums used: `UserKind`, `AuthProvider`. Cross service enums (token `kind`, event names) live
in `libs/luna-shopper/contracts`.

## 3. Tokens

- Access token: short lived JWT signed RS256/EdDSA with the private key. Claims: `sub`
  (userId), `kind`, issued/expiry. Verified offline by gateway and core with the public key.
- Refresh token: opaque, stored hashed as `RefreshToken`, rotated on use. Endpoint to
  exchange a refresh token for a new access token.

## 4. Identity flows

### 4.1 Temporary user (token by creating or joining a zone)

There is no email step here. When a client with no token creates a zone or joins one by code,
the gateway asks auth to **mint a temporary identity**: auth creates a `User(kind =
TEMPORARY)` and returns an access + refresh token. The gateway then proceeds to the core
service to actually create or join the zone with that `userId`. The token is what the device
keeps; losing it loses the temporary user unless it was upgraded.

Message: `auth.createTemporaryUser` -> `{ userId, accessToken, refreshToken }`.

### 4.2 Email + password registration

- `auth.register` with `{ email, password, displayName? }`. Password is required. Rejects a
  taken email. Creates `User(kind = REGISTERED)` + `Credential` (password hashed with argon2)
  + an `OAuthIdentity`-free email record, and issues tokens.
- Email confirmation is optional: on register, create an `EmailVerification` and send a
  confirmation email (SMTP, plan 0002). A `auth.verifyEmail` message consumes the token and
  sets `emailVerifiedAt`. Unverified accounts still work; verification is a trust signal, not
  a gate (unless a later policy decides otherwise).

### 4.3 Login

- `auth.login` with `{ email, password }`: verify the hash, issue tokens.

### 4.4 Google login

- Passport `passport-google-oauth20` flow through the gateway callback. On success auth looks
  up `OAuthIdentity(GOOGLE, providerUserId)`:
  - found: issue tokens for the linked user.
  - not found: create `User(kind = REGISTERED)` + `OAuthIdentity`, or **link** onto the
    caller's current temporary user if a token was presented (upgrading it in place), then
    issue tokens.

### 4.5 Temp to account upgrade (new)

The user chooses to turn their temporary account into a real one while still holding the temp
token. Auth:
1. Verifies the caller is a `TEMPORARY` user (from the token).
2. Attaches the new identity to that same `User` row (set `email` + `Credential`, or link
   Google) and flips `kind` to `REGISTERED`. Doing it in place means the `userId` does not
   change, so **no reference rewriting is needed** and nothing is deleted.
3. Issues fresh tokens.

Note: this in place upgrade is the simple path and is distinct from the cross account **merge**
in 0007. Merge exists for the case where the user lost the temp token and cannot prove
ownership, so they register fresh and ask a zone owner to move the old account's data over.
If a future requirement needs upgrade to instead create a brand new `User` and delete the old
one (rewriting references), that is the same saga described in 0007 and would reuse it; the
default here keeps the row and avoids a distributed operation.

## 5. Events published

- `user.registered { userId }`
- `user.upgraded { userId }` (in place upgrade completed)
- `user.emailVerified { userId }`

Consumers are free to ignore these; core does not need them for the in place upgrade because
`userId` is stable.

## 6. Migrations

First migration creates the auth schema above. Every later change is a new committed
migration; none are ever deleted or edited after shipping. Applied by the deploy Job from
plan 0002, never by `synchronize`.

## 7. Exit criteria

- A no token client can obtain a temporary identity (driven by the zone create/join path in
  0005).
- Email + password registration works, with an optional confirmation email delivered to the
  local mail catcher and a working verify endpoint.
- Google login creates or links an account.
- A temporary user can upgrade in place to a registered user keeping the same `userId`.
- Access tokens verify offline against the public key; refresh rotation works.
