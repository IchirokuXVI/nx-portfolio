# 0003 Dependencies and libraries

Third plan. Decide the libraries every service needs, add them to the root `package.json`
(this is a single Nx workspace with one `package.json`), and install. This plan is a
checklist; it introduces no code beyond wiring modules that the libraries provide.

## 1. Principles

- Prefer the official NestJS packages and well maintained community standards, since this is
  a learning project meant to follow common best practices.
- Keep each service's runtime footprint minimal: a service only pulls what it actually uses
  (the gateway does not need the ORM; auth and core do not need Socket.IO).
- Pin versions and let Nx's single lockfile manage them.

## 2. Shared / all services

- `@nestjs/config` (typed configuration) and a validator for it (`joi` or reuse
  `class-validator`).
- `@nestjs/microservices` plus the chosen transporter client:
  - NATS: `nats` (the transporter is built into `@nestjs/microservices`).
  - or Redis: `ioredis`.
- `class-validator` and `class-transformer` for DTO validation (global `ValidationPipe`).
- Testing already present in the workspace (jest via `@nx/jest`).

## 3. Persistence (auth + core)

- `@nestjs/typeorm`, `typeorm`, and `pg` (PostgreSQL driver).
- TypeORM CLI is included with `typeorm`; each service gets a `data-source.ts` and
  `migration:generate` / `migration:run` / `migration:revert` Nx targets.
- If the confirmed ORM is Prisma or MikroORM instead (see 0001/earlier decision), swap this
  section accordingly. Default is TypeORM.

## 4. auth-service specific

- `@nestjs/jwt` and `@nestjs/passport` with:
  - `passport-jwt` for token verification.
  - `passport-google-oauth20` for Google login.
- `bcrypt` (or `argon2`) for password hashing. `argon2` is the stronger default; `bcrypt` is
  the more common tutorial choice. Recommendation: `argon2`.
- Email sending for confirmation mails: `nodemailer` via `@nestjs-modules/mailer` (template
  support included). SMTP config from plan 0002.
- Key handling for the asymmetric JWT signing (RS256/EdDSA): keys come from config; no extra
  library beyond `@nestjs/jwt` is required, though `jose` is an option if JWKS distribution
  is added later.

## 5. gateway specific

- `@nestjs/websockets` and `@nestjs/platform-socket.io` (plus `socket.io`) for the realtime
  gateway.
- SSE uses Nest's built in `@Sse()` (no extra dependency).
- `@nestjs/passport` + `passport-jwt` for verifying the access token on incoming requests and
  socket connections using the auth public key.
- No ORM or database driver.

## 6. core-service specific

- Persistence stack from section 3 only. Core publishes and consumes broker events with the
  shared `@nestjs/microservices` transporter; no realtime or auth provider libraries.

## 7. Steps

1. Add `@nx/nest` (dev dependency) if not already added in 0001.
2. Add the runtime and dev dependencies above to `package.json`.
3. Install and verify the lockfile updates cleanly.
4. Smoke test: each service still builds and boots with the new modules registered
   (ConfigModule everywhere; TypeORM in auth/core; JWT/Passport/Mailer in auth; WebSockets in
   gateway).

## 8. Exit criteria

- `package.json` lists every dependency above, installed and locked.
- Each service boots with its module set wired (config validated on boot, DB connection
  established for auth/core, broker client connected, gateway accepting a WebSocket).
- The list of chosen libraries is confirmed (notably ORM, broker, and password hasher).

## 9. Decisions captured here (confirm)

- ORM: TypeORM (default) vs Prisma vs MikroORM.
- Broker transport: NATS (default) vs Redis.
- Password hashing: argon2 (default) vs bcrypt.
- Mailer: `@nestjs-modules/mailer` + nodemailer (default).
