# 0005 Auth service

Builds `luna-shopper-backend-auth`: the identity provider. It owns identity data, issues tokens, and
handles every way a user comes to exist. Its database is private to this service.

## 1. Responsibilities

- Mint access tokens (signed with the private key) and refresh tokens.
- Create **temporary** users and **registered** users, and let a temporary user upgrade into
  a registered one.
- Email + password registration with optional (not mandatory) email confirmation.
- Google login that creates or links an account.
- Publish identity events other services react to (notably the upgrade saga in 0008).

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

There is no email step here. A temporary user is minted **only at the moment a client actually
creates or joins a zone**, never on merely opening the app, so a browsing visitor leaves no
account behind. When a client with no token creates a zone or joins one by code, the gateway
asks auth to **mint a temporary identity**: auth creates a `User(kind = TEMPORARY)` and returns
an access + refresh token. The gateway then proceeds to core to create or join the zone with
that `userId`, under one idempotency key (0004 section 9) so a retry never mints two users. The
token is what the device keeps; losing it loses the temporary user unless it was upgraded.

Message: `auth.createTemporaryUser` -> `{ userId, accessToken, refreshToken }`.

**Orphan cleanup (annotated, later):** a temporary user can still end up with no memberships
(it left every zone, or its zones were deleted). A scheduled job will delete temporary users
that hold no zone membership after a grace period. It is not built now; it is recorded so the
orphan case has an owner. Core is the authority on "has any membership", so the job coordinates
with core (an event or a periodic reconciliation) rather than auth guessing.

### 4.2 Email + password registration

- `auth.register` with `{ email, password, displayName? }`. Password is required. Rejects a
  taken email. Creates `User(kind = REGISTERED)` + `Credential` (password hashed with argon2)
  + an `OAuthIdentity`-free email record, and issues tokens.
- Email confirmation is optional: on register, create an `EmailVerification` and send a
  confirmation email. A `auth.verifyEmail` message consumes it and sets `emailVerifiedAt`.
  Unverified accounts still work; verification is a trust signal, not a gate (unless a later
  policy decides otherwise).
- **Email delivery**: mail is sent over SMTP from an `@ichirokuxvi.com` address, not through a
  third party provider API token. Auth details:
  - A **dedicated sending mailbox** (for example `no-reply@ichirokuxvi.com`) with its own
    username + password, separate from any personal mailbox, so the credential is scoped and a
    leak means rotating one account.
  - Connect **over TLS on the submission port** (587 with STARTTLS, or 465 implicit TLS) so the
    password is never sent in cleartext. This matters more than the choice of secret.
  - The password is a Kubernetes Secret (plan 0002), never in the image or repo. No rotation is
    required, though it stays rotatable at no cost.
  - Password auth is the right fit here; the alternatives do not apply (XOAUTH2 is only for
    Gmail/Microsoft 365 mailboxes, which this is not). If deliverability ever becomes the
    problem rather than auth, the upgrade is a transactional provider (Postmark/Mailgun/SES) with
    an API key, which is the third party being avoided for now.
  - **Deliverability, not auth, is the real risk**: `ichirokuxvi.com` needs SPF, DKIM, and DMARC
    DNS records or confirmation emails land in spam regardless of how the server authenticated.
    Recorded as a required setup step.
  - Note: "the email will not use a token" is read as this delivery detail (SMTP, no API token).
    If it instead means the verification should be a short numeric **code** the user types rather
    than a tokenized link, the `EmailVerification` record is unchanged and only the transport of
    the secret changes. Flagged for confirmation, not blocking.
- The confirmation email is localized to the user's locale (0004 section 12).

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
in 0008. Merge exists for the case where the user lost the temp token and cannot prove
ownership, so they register fresh and ask a zone owner to move the old account's data over.
If a future requirement needs upgrade to instead create a brand new `User` and delete the old
one (rewriting references), that is the same saga described in 0008 and would reuse it; the
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
  0006).
- Email + password registration works, with an optional confirmation email delivered to the
  local mail catcher and a working verify endpoint.
- Google login creates or links an account.
- A temporary user can upgrade in place to a registered user keeping the same `userId`.
- Access tokens verify offline against the public key; refresh rotation works.
