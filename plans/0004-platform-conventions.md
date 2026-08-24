# 0004 Platform conventions (cross cutting)

Fourth plan. It defines the conventions every service follows before any feature controller is
written: logging, error handling, request context, API versioning, Swagger, health, graceful
shutdown, rate limiting, and idempotency. These are built as shared building blocks (a small
platform library plus per service wiring) so all four services behave consistently, and so a
future .NET or Spring service has a written spec to match.

## 1. Logging

Library from 0003: `nestjs-pino` (structured JSON in production, `pino-pretty` **colored**
console in development).

- **Everything unplanned goes to the log.** A global exception filter is the backstop: any
  error that is not a deliberately handled domain outcome is logged at `error` with full
  context. Handled domain outcomes (validation failures, permission denials, not found) log at
  `warn`/`info` as designed. Nothing unexpected is ever swallowed silently.
- **Reproducible from the log.** When an unexpected error is logged it carries everything
  needed to reproduce it: HTTP method and versioned path (or the NATS message pattern),
  route params, query, the request body, the resolved user and zone, and the correlation id.
  A developer reading one log entry can recreate the exact call.
- **Redaction.** Secrets never reach the log: pino `redact` strips passwords, access/refresh
  tokens, `authorization` headers, cookies, and OAuth secrets. Reproducibility must never mean
  logging a credential.

### 1.1 Per request context (IP, username, zone)

Each request runs inside an AsyncLocalStorage scope that pins a child logger, so every line
emitted while handling a request is automatically tagged with:

- `correlationId` (see section 3),
- `ip`: the client IP (from the proxy `X-Forwarded-For`, trusting the reverse proxy), logged
  whenever known,
- `userId` / `username`: **only if available** (a token was presented and resolved),
- `zoneId`: **only if available** (the request targets or resolves to a zone).

Username and zone are omitted, not blank, when they cannot be resolved, so their presence in a
log line is meaningful.

## 2. Error handling and API responses

- A **house error envelope** (aligned with RFC 7807 problem+json) is returned for every error:
  `type`, `title`, `status`, `detail`, and always the `correlationId`. The client shows the
  correlation id to the user, so a user reported error maps to exactly one log entry (this is
  the other half of "reproducible from the log").
- The global `ValidationPipe` turns DTO violations into a 400 with per field detail.
- Each service has a small domain exception hierarchy (for example `NotFound`, `Forbidden`,
  `Conflict`) mapped to HTTP status codes at the gateway; broker errors carry a code the
  gateway translates rather than leaking a raw stack to the client.

## 3. Request context across services (correlation and tracing)

- The gateway generates a `correlationId` per incoming request (or honors one supplied by a
  trusted client) and propagates it on **NATS message headers** to auth and core, into their
  logs, and onto any domain event they emit. The realtime service carries it through to the
  fan out. One id therefore threads a single user action across every service and into the
  realtime push.
- This is tracing in its lightest form. Full distributed tracing (OpenTelemetry spans exported
  to a collector) is a natural later addition and is called out as the extension point; the
  correlation id is designed so adding OTel does not change the log or event contracts.

## 4. API versioning

- NestJS **URI versioning** (`VersioningType.URI`), **major only**: `/v1/...`, `/v2/...`. No
  minor or patch versions in the URL.
- **Per controller versioning**: each controller declares its own version
  (`@Controller({ version: '1' })`), and controllers version **independently**. Zones can be at
  `v2` while lists are still at `v1`. A version bump on one controller never forces a bump on
  another.
- Only the gateway's public HTTP surface is URL versioned. Internal broker message patterns
  carry their own version token in the subject so message contracts can evolve separately from
  the public API.

## 5. Swagger

- `@nestjs/swagger` on the gateway, served at a documented path. DTOs are decorated so request
  and response shapes are complete. Bearer auth is described so the docs are usable against a
  live token.
- Because controllers are independently versioned, the document groups endpoints by version,
  and each version is browsable. Internal services may expose their own Swagger for their HTTP
  health/debug surface; the canonical public docs live on the gateway.

## 6. Health and probes

- `@nestjs/terminus` on every service exposes `GET /health/live` (process is up) and
  `GET /health/ready` (dependencies reachable: DB for auth/core, NATS for all, downstream
  readiness for the gateway/realtime). Kubernetes liveness and readiness probes point at these,
  which is what makes the zero downtime rollout in 0002 safe.

## 7. Graceful shutdown (application side)

- Enable Nest shutdown hooks. On `SIGTERM`: flip readiness to not ready (so the proxy stops
  routing new traffic), stop accepting new work, finish in flight requests, then close NATS and
  DB connections in `onModuleDestroy`. The realtime service additionally stops accepting new
  sockets and lets clients reconnect elsewhere. This is the app half of the zero downtime
  contract whose infra half lives in 0002 section 6.

## 8. Rate limiting and abuse protection

- `@nestjs/throttler` globally, with **stricter buckets** on the open surfaces: anonymous zone
  create/join, login, registration, and email verification resend. Join code redemption is
  rate limited per client to prevent code enumeration (which pairs with high entropy,
  non guessable join codes designed in 0006).

## 9. Idempotency

- Because JetStream delivers **at least once**, every event consumer (notably the realtime
  service and any cross service saga in 0008) must be idempotent: dedupe by event id or by a
  natural key so a redelivered event has no extra effect.
- Orchestrated commands that span services (mint temporary user then create zone, in 0006)
  carry an idempotency key so a retry after a partial failure does not create a second
  temporary user or a duplicate zone.

## 10. Token verification, key rotation, and revocation

- Every service verifies access tokens **offline** with the auth public key; there is no per
  request call to auth. This is the independence lever from 0001 section 3.2.
- **Rotation**: tokens carry a `kid`. Auth can introduce a new signing key while verifiers hold
  both the current and previous public keys (or fetch them from a JWKS endpoint), so a rotation
  never invalidates tokens already in flight. The retired key is dropped after the maximum
  access token TTL has elapsed.
- **Revocation tradeoff (important with offline verification)**: an offline verified token
  cannot be revoked centrally on the instant. The chosen posture: short access token TTL plus
  refresh rotation (a ban or logout is enforced the next time a refresh is attempted), backed
  by **domain level checks** (core already refuses data operations from a `BANNED`/`KICKED`
  member using its own membership table, so a banned user holding a still valid access token
  cannot act in that zone anyway). If instant global revocation is ever required, the
  alternative is a shared deny list checked on each request, which trades away some
  independence; it is not adopted now.

## 11. Where this lives

A small `libs/luna-shopper/platform` library (or a set of shared Nest modules) provides the
logging setup, exception filter, correlation middleware/interceptor, versioning bootstrap, and
health module, so each service imports the same behavior rather than re implementing it. The
written specs in this plan are the contract a non Node service reimplements.

## 12. Exit criteria

- Every service logs structured, colored (in dev) lines tagged with correlation id, IP, and
  (when available) username and zone; secrets are redacted.
- An unexpected error is fully logged with reproduction context and returns a correlation id to
  the client; nothing unexpected is swallowed.
- The public API is URL versioned major only, per controller independently, and documented in
  Swagger.
- Health endpoints exist and back the k8s probes; graceful shutdown drains cleanly.
- Rate limits protect the open endpoints; event consumers and cross service commands are
  idempotent.
