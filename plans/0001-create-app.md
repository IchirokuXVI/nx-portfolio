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

### 1.1 Polyglot on purpose

This backend is deliberately **not single language**. Some services will be NestJS; others
may be written in .NET or Spring later, as a way to practice those stacks. The design must
therefore never assume JavaScript across a service boundary. The contract between services
is the **message broker and its event/message schemas**, which every language can speak
equally. Anything that is Node specific (notably socket.io, see 0009) is confined to a
single service so it never leaks across a boundary.

## 2. Service topology

Four deployable services to start, plus a message broker and per service databases.

### 2.1 api-gateway (public HTTP entry point)

- The public REST entry point. Verifies JWTs **locally** using the auth service's public key
  (see 3.2), so it does not call auth on every request.
- Translates client requests into broker messages (request/reply) to auth and core.
- Hosts the API documentation (Swagger) and the URL versioning scheme (see 0004).
- Owns no database.

### 2.2 realtime-service (WebSocket + SSE)

- A dedicated service that holds all client realtime connections (WebSocket primary, SSE
  fallback). This is the standard microservice pattern: **one realtime server for all
  domains**, not one socket server per service.
- It subscribes to domain events on the broker (published by any service, in any language)
  and fans them out to the clients authorized to receive them.
- It stays Node/NestJS because it uses socket.io; the polyglot services never speak
  socket.io, only the broker. See 0009 for the full rationale and the socket.io caveat.
- Owns no database (optionally a Redis backplane later, see 2.4).

### 2.3 auth-service (identity provider)

- Owns its own database. Stores users, credentials (email + password), OAuth identities
  (Google), email verification state, and issued/refresh token records.
- Issues signed JWTs and handles: anonymous/temporary users, email + password registration,
  optional email confirmation, Google login, and the temp to account upgrade.
- Sends confirmation emails through an outgoing email (SMTP) configuration.
- Publishes identity events (for example `user.upgraded`) that other services react to.

### 2.4 core-service (domain)

- Owns its own database. Stores zones, memberships, merge requests, shopping lists, list
  access, lines, and comments.
- References users only by their `userId` (the JWT subject). It never reads the auth
  database. Per zone usernames live here, so core almost never needs anything from auth.
- Publishes domain events (member approved, line added, comment added, ...) that the
  realtime service turns into client messages.

### 2.5 Supporting infrastructure

- **Message broker: NATS with JetStream, enabled from the start.** JetStream (durable
  streams, at least once delivery, replay) is more than a first cut strictly needs, but it is
  included from day one on purpose as a learning goal and because it gives durable domain
  events and a foundation for reliable sagas. Request/reply commands and pub/sub events both
  run over NATS.
- **Databases**: PostgreSQL for both auth and core (both domains are strongly relational),
  each private to its service.
- **Redis: planned, not now.** A Redis instance will be added later purely as a fast cache
  (and, if the realtime service ever runs multiple replicas, as the socket backplane and
  presence store). It is intentionally out of the initial setup; plans only note where it
  will slot in.

```
                 +-------------+   REST + Swagger
   clients ----> | api-gateway |----------------------+
        |        +------+------+                       |
        | WS/SSE        | broker (request/reply)       | broker
        v               v                              v
 +---------------+   NATS + JetStream  ---->  +--------+------+   +--------------+
 | realtime-svc  |<---- domain events -------| auth-service  |   | core-service |
 |  (socket.io)  |                           |  Postgres     |   |  Postgres    |
 +---------------+                           +---------------+   +--------------+
   (Redis backplane later)
```

## 3. Cross cutting decisions

### 3.1 Data ownership and independence

Each service owns its schema and never reaches into another service's database. Shared
knowledge travels as messages/events, not as foreign keys across service boundaries. Core
stores `userId` values but treats them as opaque identifiers minted by auth.

### 3.2 Token strategy (the key decoupling)

Auth signs access tokens with an asymmetric key (RS256 or EdDSA). Every other service (in any
language) holds only the **public** key and verifies tokens offline. This is what lets the
gateway, realtime, and core authenticate a request without a synchronous call to auth, which
is the single most important independence lever. Token contents: `sub` (userId), `kind`
(temporary or registered), a key id (`kid`) for rotation, issued/expiry. Refresh tokens and
their storage live in auth. Key rotation and revocation are detailed in 0004.

### 3.3 Inter service communication

- **Commands / queries**: gateway to service uses NATS request/reply (NestJS
  `@MessagePattern`).
- **Events**: services publish domain events onto JetStream (`@EventPattern` / durable
  consumers); interested services (notably realtime) subscribe. Because JetStream is at least
  once, **every event consumer must be idempotent** (see 0004).

### 3.4 Shared contracts

A single small library, `libs/luna-shopper/contracts`, holds the cross service message
shapes, event names, and the enums that more than one service needs. Because the backend is
polyglot, this library is the **canonical schema for the JavaScript services only**; the
authoritative cross language contract is the documented message/event schema itself, so a
future .NET or Spring service can implement the same shapes. Keeping the schemas written down
(not just as TypeScript types) is therefore a requirement, not a nicety.

### 3.5 Enums everywhere

Every constant set is a TypeScript enum. Domain enums that only one service uses live in that
service; enums crossing a boundary (event names, token kind, provider) live in `contracts`.
Concrete enum lists appear in the service plans (0005 through 0009).

## 4. Nx scaffolding steps

1. Add the `@nx/nest` plugin to the workspace (dev dependency + install in plan 0003).
2. Generate the apps under `apps/` as NestJS applications (`@nx/nest:application`) with jest
   and eslint targets:
   - `luna-shopper-gateway`
   - `luna-shopper-realtime`
   - `luna-shopper-auth`
   - `luna-shopper-core`
3. Generate the shared library `libs/luna-shopper/contracts`, exported through the
   `@portfolio/luna-shopper/contracts` path alias in `tsconfig.base.json`.
4. Give each app a minimal bootable `main.ts`: gateway and realtime boot HTTP apps (realtime
   also opens its socket server); auth and core boot as NestJS microservices bound to NATS,
   with a small HTTP health port. No feature modules yet beyond a health check.
5. Confirm each app builds, serves, lints, and tests green before moving on.

Databases, Dockerfiles, config, CI, and zero downtime deploy are plan 0002. Library selection
and installation are plan 0003. Logging, error handling, API versioning, Swagger, health, and
tracing are plan 0004.

## 5. Naming note

The original brief named a single `luna-shopper-backend` app. That name is superseded by the
four service names above. "Luna Shopper backend" refers to the gateway + realtime + auth +
core set collectively.

## 6. Exit criteria

- The four `apps/luna-shopper-*` services exist and boot; `libs/luna-shopper/contracts`
  exists and is importable.
- `nx run-many --target=build --projects=luna-shopper-*` is green.
- NATS with JetStream runs locally and each service connects to it.
- The architecture in sections 2 and 3 is agreed.
