# 0001 Create the Luna Shopper apps

First execution plan. It sets the overall architecture and scaffolds the empty
NestJS applications and shared libraries. No business logic yet; later plans fill each
service in.

> Housekeeping: once the apps exist, this whole `plans/` set moves next to the code (into
> `apps/luna-shopper-*/plans/` or a shared `plans/` under the Luna Shopper apps), following
> the repo convention that plan files live beside what they describe. It lives at the repo
> root only until there is an app folder to move it into.

## 1. Why microservices

Luna Shopper is a learning project aimed at practicing best practices, and the brief
requires the authentication concern to be an independent service with its own database.
So the backend is split into small services that each own their data and talk to each
other over a message broker rather than by sharing a database. The guiding rule is
**maximum independence**: a service should keep working, and keep serving requests it can
answer from its own data, even when its siblings are down.

## 2. Service topology

Three deployable NestJS apps to start, plus a message broker and per service databases.

### 2.1 api-gateway (public entry point)

- The only service exposed to clients. Speaks HTTP (REST) and holds the realtime channels
  (WebSocket primary, SSE fallback).
- Verifies JWTs **locally** using the auth service's public key (see 3.2), so it does not
  call auth on every request.
- Translates client requests into broker messages (request/reply) to auth and core, and
  relays core's domain events out to the connected sockets.
- Owns no database.

### 2.2 auth-service (identity provider)

- Owns its own database. Stores users, credentials (email + password), OAuth identities
  (Google), email verification state, and issued/refresh token records.
- Issues signed JWTs (access tokens) and handles: anonymous/temporary users, email + password
  registration, optional email confirmation, Google login, and the temp to account upgrade.
- Sends confirmation emails through an outgoing email (SMTP) configuration.
- Publishes identity events (for example `user.upgraded`) that other services react to.

### 2.3 core-service (domain)

- Owns its own database. Stores zones, memberships, merge requests, shopping lists, list
  access, lines, and comments.
- References users only by their `userId` (the JWT subject). It never reads the auth
  database. Per zone usernames live here, so core almost never needs anything from auth.
- Publishes domain events (member approved, line added, comment added, ...) that the gateway
  turns into realtime messages.

### 2.4 Supporting infrastructure

- **Message broker**: recommended **NATS** (light, first class NestJS transporter, good for
  both request/reply and pub/sub). A single Redis instance is a valid simpler alternative
  that also covers realtime fan out and caching; see 3.3.
- **Databases**: PostgreSQL for both auth and core (both domains are strongly relational).
  Polyglot persistence is applied where it genuinely fits rather than for its own sake:
  Redis backs realtime pub/sub and presence. A future notifications or audit service is the
  natural place to introduce a document store if one is ever wanted.

```
             +-------------+       WS / SSE / REST
  clients -->| api-gateway |<--------------------------
             +------+------+
                    | broker (request/reply + events)
        +-----------+-----------+
        |                       |
 +------v------+         +------v------+
 | auth-service|         | core-service|
 |  Postgres   |         |  Postgres   |
 +-------------+         +-------------+
        \___ publishes identity events ___/  (consumed where relevant)
```

## 3. Cross cutting decisions

### 3.1 Data ownership and independence

Each service owns its schema and never reaches into another service's database. Shared
knowledge travels as messages/events, not as foreign keys across service boundaries. Core
stores `userId` values but treats them as opaque identifiers minted by auth.

### 3.2 Token strategy (the key decoupling)

Auth signs access tokens with an asymmetric key (RS256 or EdDSA). Every other service holds
only the **public** key and verifies tokens offline. This is what lets the gateway and core
authenticate a request without a synchronous call to auth, which is the single most
important independence lever. Token contents: `sub` (userId), `kind` (temporary or
registered), issued/expiry. Refresh tokens and their storage live in auth.

### 3.3 Inter service communication

- **Commands / queries**: gateway to service uses broker request/reply (NestJS
  `@MessagePattern`). Keeps the gateway thin and services transport agnostic.
- **Events**: services publish domain events (NestJS `@EventPattern` / broker pub/sub);
  interested services subscribe. Used for realtime and for cross service sagas (the temp to
  account upgrade in plan 0007).
- Decision to confirm: **NATS vs Redis** as the transport. NATS teaches the message broker
  model more cleanly; Redis needs one fewer component since it doubles as the realtime
  backend. Default recommendation is NATS.

### 3.4 Shared contracts

A single small library, `libs/luna-shopper/contracts`, holds the cross service message
shapes, event names, and the enums that more than one service needs (token claim shapes,
event name enums). Service private entities and DTOs stay inside each app. The tradeoff
(a shared lib is a light coupling point) is accepted because it keeps message contracts in
one authoritative place, which matters more on a learning project than absolute zero
sharing.

### 3.5 Enums everywhere

Every constant set is a TypeScript enum. Domain enums that only one service uses live in
that service; enums crossing a boundary (event names, token kind, provider) live in
`contracts`. The concrete enum lists appear in the service plans (0004 through 0008).

## 4. Nx scaffolding steps

1. Add the `@nx/nest` plugin to the workspace (dev dependency + install happens in plan
   0003; here we only record what to generate).
2. Generate the apps under `apps/`:
   - `luna-shopper-gateway`
   - `luna-shopper-auth`
   - `luna-shopper-core`
   Each as a NestJS application (`@nx/nest:application`) with jest and eslint targets, so
   `nx affected` treats them like every other project.
3. Generate the shared library `libs/luna-shopper/contracts`
   (`@nx/nest:library` or `@nx/js:library`), exported through the
   `@portfolio/luna-shopper/contracts` path alias in `tsconfig.base.json`.
4. Give each app a minimal bootable `main.ts`: the gateway boots an HTTP app; auth and core
   boot as NestJS microservices (with a small HTTP health port if useful). No feature
   modules yet beyond a health check.
5. Confirm each app builds, serves, lints, and tests green before moving on.

Databases, Dockerfiles, config, and CI are intentionally **not** in this plan; they are
plan 0002. Library selection and installation are plan 0003.

## 5. Naming note

The original brief named a single `luna-shopper-backend` app. That name is superseded by the
three service names above. If a single umbrella name is still wanted for docs, "Luna Shopper
backend" refers to the gateway + auth + core trio collectively.

## 6. Exit criteria

- `apps/luna-shopper-gateway`, `apps/luna-shopper-auth`, `apps/luna-shopper-core` exist and
  boot.
- `libs/luna-shopper/contracts` exists and is importable.
- `nx run-many --target=build --projects=luna-shopper-*` is green.
- The architecture in sections 2 and 3 is agreed (broker choice in 3.3 confirmed).
