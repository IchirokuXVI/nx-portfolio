# 0001 Luna Shopper Backend

Plan for the first backend service in this monorepo: **Luna Shopper**, a collaborative
shopping list app. This document covers the backend only (NestJS + database + realtime +
docker/CI wiring). The frontend is out of scope for now.

## 1. Goals and scope

Build `luna-shopper-backend`, a NestJS application under `apps/`, that provides:

- An **optional user system**. A user can act anonymously through a device token, or
  upgrade to a real account via email or Google. Losing the device token loses access
  unless the user has upgraded to a real account.
- **Spaces (zones)**: a user can start their own zone or join others via a code. A user
  can belong to many zones.
- **Zone lifecycle**: create, edit (name + configuration), delete, generate/regenerate a
  join code, and join with a per zone username.
- **Membership governance**: owner approval before access, kick, ban, and account merge
  requests (approved by the owner).
- **Shopping lists** inside a zone, with per user write permissions.
- **List lines** with an approval state and an item state (pending, ready, not available),
  plus threaded comments.
- **Realtime** propagation of zone and list changes over WebSocket (primary) and SSE
  (secondary / read only fallback).

Non goals for this plan: the Angular frontend, push notifications, offline sync, and the
concrete zone configuration flags (only the storage for configuration is added now; the
individual flags arrive later).

## 2. Key decisions (please confirm)

These are the decisions that are expensive to reverse. Recommendations are made so work can
start, but flag any you want changed.

### 2.1 Database: PostgreSQL

The domain is strongly relational: users, devices, zones, memberships, merge requests,
lists, list permissions, lines, and comments, all tied together by foreign keys and by
rules that need transactional integrity (approval, ban, and merge all mutate several rows
at once and must not half apply). A relational database fits this far better than a
document store, and gives real uniqueness constraints (one username per zone, one
membership per user per zone) for free.

**Recommendation: PostgreSQL.**

### 2.2 ORM: TypeORM

Requirements that steer the choice:

- "The data model must be clearly visible from the models in the code."
- "All constant values must be in enums."
- "All changes to the database must be in migrations and migrations are never to be deleted."

**Recommendation: TypeORM**, because its entities are decorated TypeScript classes that
double as the data model (so the model lives directly in code), its enum columns bind to
native TypeScript enums (so the "constants in enums" rule is satisfied by construction),
and it has first party NestJS integration (`@nestjs/typeorm`). We run it with
`synchronize: false` and drive every schema change through committed migration files.

Alternatives considered:

- **Prisma**: excellent migration workflow and the single `schema.prisma` file is very
  readable, but the model lives in a DSL rather than in TypeScript classes, which reads
  slightly against "models in the code".
- **MikroORM**: also decorated entity classes with a strong migration story; a fair second
  choice if TypeORM's migration generation proves painful.

If you prefer Prisma or MikroORM, say so before implementation starts, since it changes the
entity layer and the migration tooling.

### 2.3 Realtime transport: WebSocket first (Socket.IO), SSE second

Interactive list editing benefits from a bidirectional channel (presence, acknowledgements,
low latency line updates), so the primary transport is a NestJS WebSocket gateway backed by
Socket.IO (`@nestjs/websockets` + `@nestjs/platform-socket.io`), using one room per zone and
one room per list. A read only SSE endpoint (`@Sse()`) is added as a lightweight fallback
for clients that cannot hold a socket. Both carry the same event payloads, and every event
name lives in an enum.

### 2.4 Identity model interpretation

The brief mixes "codes" for two things. The interpretation used here:

- A **zone join code** is how you join someone else's space. "Start your own space" creates
  a zone; "enter a code" joins one.
- On first contact the backend issues a **device token** (a JWT) tied to a freshly created
  temporary user, so a user can start using the app with no account and no code.
- Optionally, a **device pairing code** lets a temporary user link a second device to the
  same identity without registering (lower priority, modeled but can ship later).

If the intended meaning of "link devices using codes" is different, this is the thing to
correct early.

## 3. Data model

All entities are TypeORM classes under the backend app; pure enums and shared DTO
interfaces are extracted into a framework agnostic library so a future frontend can import
the exact same types. Timestamps (`createdAt`, `updatedAt`) are on every entity and omitted
from the field lists below for brevity.

### 3.1 Identity

**User** (the persistent identity)
- `id` (uuid)
- `kind`: `UserKind` enum (`TEMPORARY`, `REGISTERED`)
- `email` (nullable, unique when set)
- `displayName` (nullable, a global display name)

**Device** (a device token that authenticates a user)
- `id` (uuid)
- `userId` -> User
- `tokenHash` (the issued token is stored hashed, never in clear)
- `label` (nullable, e.g. "Pixel 8")
- `lastSeenAt`

**OAuthIdentity** (external login linkage, currently Google)
- `id` (uuid)
- `userId` -> User
- `provider`: `AuthProvider` enum (`GOOGLE`, `EMAIL`)
- `providerUserId` (Google subject id)
- unique (`provider`, `providerUserId`)

**EmailCredential** (optional, only when email registration uses a password)
- `id` (uuid)
- `userId` -> User (unique)
- `passwordHash`

Registering with Google creates a `User(kind = REGISTERED)` plus an `OAuthIdentity`, or
links the identity onto the current temporary user (upgrading it in place). Registering with
email sets `email` and (if password based) an `EmailCredential`, and flips `kind` to
`REGISTERED`. Temporary vs real is therefore always answerable from `User.kind`.

### 3.2 Zones and membership

**Zone** (a "space")
- `id` (uuid)
- `name`
- `config` (jsonb; typed configuration object, empty for now, future boolean flags such as
  "allow new members" land here with their keys defined in an enum)
- `joinCode` (unique, regenerable)
- `ownerUserId` -> User

**ZoneMembership** (a user's presence in a zone)
- `id` (uuid)
- `zoneId` -> Zone
- `userId` -> User
- `username` (per zone display name, required when joining)
- `role`: `ZoneRole` enum (`OWNER`, `MEMBER`)
- `status`: `MembershipStatus` enum (`PENDING`, `APPROVED`, `KICKED`, `BANNED`)
- `approvedByUserId` (nullable) -> User
- unique (`zoneId`, `userId`)
- unique (`zoneId`, `username`)

Creating a zone makes the creator an `OWNER` membership already `APPROVED`. Joining creates
a `PENDING` membership with a username; the owner approves it before the user reaches any
app data. Kick sets `KICKED` (the user may re request). Ban sets `BANNED` (rejoin blocked).

### 3.3 Merge requests

**MergeRequest** (merge one member's data into another, inside one zone)
- `id` (uuid)
- `zoneId` -> Zone
- `sourceUserId` -> User (data is taken FROM here; this membership is kicked afterward)
- `targetUserId` -> User (data is moved INTO here)
- `requestedByUserId` -> User
- `status`: `MergeRequestStatus` enum (`PENDING`, `APPROVED`, `REJECTED`, `CANCELLED`)
- `resolvedByUserId` (nullable) -> User

On approval, in a single transaction: reassign the source member's zone scoped data (lines
they created, comments they authored, list permissions) from source to target, then set the
source's `ZoneMembership` to `KICKED`. Merge is per zone; a global cross zone identity merge
is not in scope now.

### 3.4 Shopping lists

**ShoppingList**
- `id` (uuid)
- `zoneId` -> Zone
- `name`
- `createdByUserId` -> User

**ListAccess** (which members may write to a list)
- `id` (uuid)
- `listId` -> ShoppingList
- `membershipId` -> ZoneMembership
- `role`: `ListRole` enum (`READER`, `WRITER`)
- unique (`listId`, `membershipId`)

"Select which users of the zone can write in the list" maps to `ListAccess` rows with
`role = WRITER`.

### 3.5 Lines and comments

**ListLine**
- `id` (uuid)
- `listId` -> ShoppingList
- `content`
- `position` (ordering)
- `approvalStatus`: `LineApprovalStatus` enum (`PENDING`, `APPROVED`, `REJECTED`)
- `status`: `LineStatus` enum (`PENDING`, `READY`, `NOT_AVAILABLE`)
- `createdByUserId` -> User
- `approvedByUserId` (nullable) -> User

**LineComment**
- `id` (uuid)
- `lineId` -> ListLine
- `authorUserId` -> User
- `body`

A line carries two independent state machines: approval (it "has to be approved") and item
state (pending, ready, not available). Comments hang off a line.

### 3.6 Enums (single source of constants)

Collected in the shared models library, imported everywhere:

- `UserKind`: `TEMPORARY`, `REGISTERED`
- `AuthProvider`: `GOOGLE`, `EMAIL`
- `ZoneRole`: `OWNER`, `MEMBER`
- `MembershipStatus`: `PENDING`, `APPROVED`, `KICKED`, `BANNED`
- `MergeRequestStatus`: `PENDING`, `APPROVED`, `REJECTED`, `CANCELLED`
- `ListRole`: `READER`, `WRITER`
- `LineApprovalStatus`: `PENDING`, `APPROVED`, `REJECTED`
- `LineStatus`: `PENDING`, `READY`, `NOT_AVAILABLE`
- `RealtimeEvent`: zone and list event names (see section 6)
- `RealtimeRoom`: room name prefixes (`zone:`, `list:`)

## 4. Project structure

```
apps/
  luna-shopper-backend/
    src/
      main.ts
      app/                     # root module, config
      auth/                    # device tokens, Google OAuth, guards
      users/                   # user + device + identity entities & services
      zones/                   # zone + membership + merge modules, entities
      lists/                   # shopping list + access + line + comment modules
      realtime/                # websocket gateway + SSE controller + events
      database/
        data-source.ts         # TypeORM DataSource for CLI + app
        migrations/            # committed, append only, never deleted
    src/Dockerfile
    project.json
libs/
  luna-shopper/
    models/                    # enums + shared DTO interfaces (no framework deps)
```

Add the `@nx/nest` plugin to the workspace to generate the app and libs. Entities stay in
the app (they carry TypeORM decorators and DB coupling); the pure enums and DTO shapes live
in `libs/luna-shopper/models` so a future frontend imports the same types via a
`@portfolio/luna-shopper/models` path alias in `tsconfig.base.json`.

## 5. Modules and endpoints (first cut)

- **AuthModule**
  - `POST /auth/device` start anonymous: create temporary user + device, return token.
  - `POST /auth/device/pair` (optional) redeem a device pairing code.
  - `GET  /auth/google` / `GET /auth/google/callback` Google OAuth; creates or links a
    `REGISTERED` user and returns a token.
  - `POST /auth/register` email registration (upgrade current temporary user).
  - Guards: a device/JWT guard for every protected route; a zone membership guard that
    resolves the caller's approved membership and role.
- **ZonesModule**
  - `POST /zones` create (caller becomes approved owner).
  - `PATCH /zones/:id` edit name and config (owner only).
  - `DELETE /zones/:id` delete (owner only).
  - `POST /zones/:id/join-code` regenerate join code (owner only).
  - `POST /zones/join` join by code with a username (creates pending membership).
  - `GET /zones` list the caller's zones.
- **MembershipModule**
  - `POST /zones/:id/members/:membershipId/approve` | `/reject`
  - `POST /zones/:id/members/:membershipId/kick` | `/ban`
  - `POST /zones/:id/merge-requests` request a merge; `/:mergeId/approve` | `/reject`.
- **ListsModule**
  - `POST /zones/:id/lists` create; `PATCH`/`DELETE` a list.
  - `PUT /lists/:id/access` set which members can write.
  - `POST /lists/:id/lines` add a line; `PATCH /lines/:id` set approval and item state.
  - `POST /lines/:id/comments` add a comment.
- **RealtimeModule**: gateway + SSE (section 6).

Every write validates the caller's membership status and role (approved members only, owner
only where noted, list writers only for line writes) before mutating.

## 6. Realtime design

- **Gateway (Socket.IO)**: authenticate the socket from the same token on connect, then let
  the client subscribe to rooms it is authorized for (`zone:{zoneId}`, `list:{listId}`).
  Services emit domain events into the relevant rooms after a successful mutation.
- **SSE**: `GET /zones/:id/stream` and `GET /lists/:id/stream` return an observable of the
  same events for read only consumers.
- **Events** (`RealtimeEvent` enum), emitted on the matching mutation: zone updated, member
  joined, member approved, member kicked, member banned, merge requested, merge resolved,
  list created, list updated, list deleted, line added, line updated, comment added.
- Emission is centralized so both transports publish identical payloads (a single event bus
  the gateway and the SSE controller both subscribe to).

## 7. Migrations

- `synchronize: false` always. `database/data-source.ts` is the single DataSource used by
  both the app and the TypeORM CLI.
- Nx targets on the app: `migration:generate`, `migration:run`, `migration:revert`.
- Every schema change is a committed migration under `database/migrations/`. Migrations are
  append only and never deleted or edited after they ship, per the requirement.
- Deploy runs `migration:run` before the new server accepts traffic (an init container or a
  one shot job; see section 8).

## 8. Docker, Helm, and CI

The existing apps are static Angular bundles served by nginx. This backend is different in
two ways that the plan must handle explicitly: it is a **long running Node process**, and it
**needs a database and runtime configuration**.

- **Dockerfile** (`apps/luna-shopper-backend/src/Dockerfile`): multi stage. Stage one builds
  from the repo `builder` image and runs `npx nx build luna-shopper-backend`. Stage two is a
  slim `node` runtime that copies the built output plus production dependencies and runs
  `CMD ["node", "main.js"]`. Unlike the MFE images it does not embed a build time base URL;
  its configuration (database URL, JWT secret, Google client id/secret, allowed origins)
  arrives at runtime as environment variables.
- **build:docker target** in `project.json` using `@portfolio/docker:build`, with `imageName`
  `nx-portfolio/luna-shopper-backend` and development/production configurations mirroring the
  other apps. No `MFE_*` forwarding; instead any build args stay minimal since config is
  runtime, not build time.
- **Database deployment**: add PostgreSQL to the cluster (a StatefulSet with a PVC in Helm, or
  a managed instance). This is its own infrastructure task and should be decided alongside
  the ORM choice. Secrets (DB credentials, JWT secret, Google OAuth secret) go through k8s
  Secrets, not build args.
- **Helm**: add production and staging entries under `apps` in `values.yaml`. The reverse
  proxy routes the API on its own host or path (for example `api.ichirokuxvi.com`), and the
  nginx config for that route needs the WebSocket upgrade headers (`Upgrade`, `Connection`)
  so Socket.IO can hold a connection.
- **CI**: the backend gets standard `lint`/`test`/`build` targets so `nx affected` picks it
  up like everything else, plus its `build:docker`. It is not a micro frontend, so it stays
  out of the shell MFE build loop; its image builds on the same staging (push to `main`) and
  release (GitHub Release) triggers as the other deployable apps. The deploy must run
  database migrations before routing traffic to the new pods.

## 9. Delivery order (suggested)

1. Scaffold: add `@nx/nest`, generate the app and `libs/luna-shopper/models`, wire the
   TypeORM DataSource and a local Postgres (docker compose for dev).
2. Identity + auth: users, devices, device token issuance, guards. First migration.
3. Zones + membership: create/join/edit/delete, approval, kick, ban.
4. Lists + access + lines + comments.
5. Merge requests.
6. Realtime gateway + SSE, wired into the mutations above.
7. Dockerfile, `build:docker`, Helm entries, CI, and the Postgres deployment.

Each of steps 2 through 6 lands its own migration (never edited afterward) and its own
realtime events where relevant.

## 10. Open questions

- ORM confirmation (TypeORM vs Prisma vs MikroORM), section 2.2.
- Email registration: passwordless (magic link / code) or password based? Affects
  `EmailCredential`.
- "Link devices using codes": is the device pairing code (link a second device to one
  temporary identity) the intended meaning, or something else? Section 2.4.
- Merge scope: per zone only (this plan) or a global identity merge as well?
- Where should the API be exposed (dedicated `api.` host vs a path under an existing host),
  and is a managed Postgres acceptable or must it run in cluster?
