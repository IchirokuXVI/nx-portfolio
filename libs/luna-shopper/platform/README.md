# @portfolio/luna-shopper/platform

The cross cutting platform conventions every Luna Shopper service follows, built
once here so all four services (gateway, auth, core, realtime) behave identically
and a future .NET or Spring service has a written spec to match. Implements
**plan 0004**.

## Wiring (per service)

```ts
// app.module.ts
imports: [
  ConfigModule.forRoot({ /* ... */ }),
  PlatformModule.forRoot({ serviceName: 'luna-shopper-backend-gateway' }),
  PlatformHealthModule.forRoot(/* { readiness } */),
]

// main.ts
const app = await NestFactory.create(AppModule, { bufferLogs: true });
bootstrapPlatform(app, { versioning: true }); // versioning: gateway only
setupSwagger(app, { title, description });     // gateway only
```

- **`PlatformModule.forRoot`** installs pino logging (`nestjs-pino`), the global
  `GlobalExceptionFilter` (problem+json envelope, HTTP and NATS), and the global
  `ValidationPipe`. Log level comes from the validated `LOG_LEVEL` env var.
- **`bootstrapPlatform`** routes Nest's logs through pino, installs the
  correlation middleware before the router, optionally enables URI versioning, and
  enables shutdown hooks.
- **`PlatformHealthModule.forRoot`** exposes `GET /health/live` and
  `GET /health/ready` (Terminus). Pass `readiness` to add the service's dependency
  checks (DB, NATS) as those clients land in later plans.

## Building blocks (used by feature plans 0005+)

| Concern | Export |
| --- | --- |
| Request context (ALS) | `runWithRequestContext`, `getRequestContext`, `setRequestContext`, `getCorrelationId` |
| Correlation / idempotency headers | `CORRELATION_ID_HEADER`, `IDEMPOTENCY_KEY_HEADER` |
| Domain errors | `DomainException` + `NotFoundException` / `ForbiddenException` / `ConflictException` / `ValidationException` / `UnauthorizedException` |
| Error envelope | `ProblemDetails`, `buildProblemDetails`, `ERROR_CODES`, `ERROR_STATUS` |
| Error catalog (en/es) | `ERROR_CATALOG`, `resolveErrorMessage` |
| Localization | `resolveLocale`, `SUPPORTED_LOCALES`, `DEFAULT_LOCALE` |
| Pagination | `Page`, `PageQueryDto`, `encodeCursor`, `decodeCursor`, `clampPageSize`, `buildPage` |
| Idempotency | `IdempotencyStore`, `runOnce`, `commandStepKey` |
| Rate limit buckets | `THROTTLE_BUCKETS`, `createThrottlerOptions` |
| NATS correlation | `buildNatsHeaders`, `readCorrelationFromHeaders`, `readLocaleFromHeaders` |

## Guarantees (plan 0004 exit criteria)

- Structured, colored (dev) logs tagged with correlation id, IP, and — when known
  — username and zone; secrets redacted (`REDACTION_PATHS`).
- Every error returns the house problem+json envelope with a `correlationId` and a
  message already localized to the request locale; unexpected errors are logged at
  `error` with reproduction context, nothing is swallowed.
- Public API is URI versioned (major only, per controller) and documented in
  Swagger on the gateway.
- Health endpoints back the k8s probes; readiness flips to not ready on `SIGTERM`
  so shutdown drains cleanly.
- Rate limits protect the open surfaces; cursor pagination and idempotency
  primitives are ready for the feature controllers and event consumers.

## What is deferred

The primitives above exist and are unit tested, but are applied to real
controllers, DTOs, DB and NATS clients in the feature plans (0005+). Readiness
currently checks liveness, the shutdown gate and a heap ceiling; DB and NATS
indicators are added with those clients.

## Test

```sh
npx nx test luna-shopper/platform
```
