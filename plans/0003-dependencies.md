# 0003 Dependencies and libraries

Third plan. Decide the libraries every service needs, add them to the root `package.json`
(this is a single Nx workspace with one `package.json`), and install. This plan is a
checklist; it introduces no code beyond wiring modules that the libraries provide. The code
level conventions those libraries enable (logging format, error envelope, versioning, Swagger,
health) are designed in plan 0004.

## 1. Principles

- Prefer the official NestJS packages and well maintained community standards, since this is
  a learning project meant to follow common best practices.
- Keep each service's runtime footprint minimal: a service only pulls what it actually uses
  (only realtime needs socket.io; only auth and core need the ORM).
- Pin versions and let Nx's single lockfile manage them.

## 2. Shared / all services

- `@nestjs/config` (typed configuration) and a validator for it (`joi` or `class-validator`).
- `@nestjs/microservices` plus the NATS client (`nats`). JetStream is used through the NATS
  transporter and the `nats` client's JetStream API.
- `class-validator` and `class-transformer` for DTO validation (global `ValidationPipe`).
- **Logging**: `nestjs-pino` + `pino` + `pino-http`, with `pino-pretty` for colored,
  human readable console output in development (structured JSON in production). This backs the
  logging requirements designed in 0004 (colored console, request context, error
  reproducibility).
- **Health checks**: `@nestjs/terminus` (liveness/readiness for the zero downtime probes).
- **Rate limiting**: `@nestjs/throttler` (protects the open anonymous endpoints).
- **API docs**: `@nestjs/swagger` (exposed on the gateway; auth/core/realtime may expose their
  own internal docs).
- Testing already present in the workspace (jest via `@nx/jest`).

## 3. Persistence (auth + core)

- `@nestjs/typeorm`, `typeorm`, and `pg` (PostgreSQL driver). ORM confirmed as **TypeORM**.
- The TypeORM CLI ships with `typeorm`; each service gets a `data-source.ts` and
  `migration:generate` / `migration:run` / `migration:revert` Nx targets.

## 4. auth-service specific

- `@nestjs/jwt` and `@nestjs/passport` with `passport-jwt` (token verification) and
  `passport-google-oauth20` (Google login).
- `argon2` for password hashing (confirmed).
- Email: `@nestjs-modules/mailer` + `nodemailer` (confirmed), with a template engine
  (`handlebars`) for the confirmation email. SMTP config from plan 0002.
- Asymmetric JWT signing (RS256/EdDSA) uses keys from config; `@nestjs/jwt` covers signing and
  verification. `jose` is optional if a JWKS endpoint is added for key distribution/rotation.

## 5. realtime-service specific

- `@nestjs/websockets` and `@nestjs/platform-socket.io` (plus `socket.io`) for the socket
  server. SSE uses Nest's built in `@Sse()` (no extra dependency).
- `@nestjs/passport` + `passport-jwt` to authenticate the socket handshake with the auth
  public key.
- Subscribes to NATS/JetStream via the shared `@nestjs/microservices` client. No ORM.
- (Later) `@socket.io/redis-adapter` + `ioredis` when Redis is added for multi replica fan out.

## 6. gateway specific

- `@nestjs/swagger` for the public API docs and `@nestjs/passport` + `passport-jwt` to verify
  the access token on incoming requests. No ORM, no socket.io.

## 7. core-service specific

- Persistence stack from section 3 only. Core publishes and consumes NATS/JetStream events
  with the shared `@nestjs/microservices` client; no realtime or auth provider libraries.

## 8. Steps

1. Add `@nx/nest` (dev dependency) if not already added in 0001.
2. Add the runtime and dev dependencies above to `package.json`.
3. Install and verify the lockfile updates cleanly.
4. Smoke test: each service still builds and boots with its module set registered (config +
   pino logging + terminus health everywhere; TypeORM in auth/core; JWT/Passport/Mailer in
   auth; socket.io in realtime; Swagger on the gateway).

## 9. Exit criteria

- `package.json` lists every dependency above, installed and locked.
- Each service boots with its module set wired (config validated on boot, structured colored
  logging active, health endpoints responding, DB connected for auth/core, NATS/JetStream
  connected, gateway serving Swagger, realtime accepting a socket).
- The remaining open library choices are confirmed (see 0004 for tracing/APM if added).

## 10. Confirmed choices

TypeORM (ORM), NATS + JetStream (broker, from the start), Redis (cache/backplane, added
later), argon2 (hashing), `@nestjs-modules/mailer` + nodemailer (email), `nestjs-pino`
(logging), `@nestjs/swagger` (docs), `@nestjs/terminus` (health), `@nestjs/throttler`
(rate limiting).
