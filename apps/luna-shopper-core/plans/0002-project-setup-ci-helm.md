# 0002 Project setup: config, Docker, Helm, CI, zero downtime

Second plan. It turns the empty apps from 0001 into deployable, configurable services and
wires them into the existing docker/Helm/CI machinery, including zero downtime deploys. Still
no business logic. Application level cross cutting concerns (logging, versioning, Swagger,
health endpoints, tracing) are plan 0004; this plan covers the infrastructure they run on.

## 1. Configuration strategy

- Use `@nestjs/config` in every service, loaded once at the root module, with a typed and
  validated schema (validate on boot with `joi` or `class-validator`, and fail fast on a
  missing required variable). Configuration is per service and read from environment
  variables only, never hard coded.
- Nothing secret goes into images or build args. Secrets arrive at runtime through
  Kubernetes Secrets (and through a local `.env` for development, git ignored).

Variables per service (initial):

- **gateway**: `PORT`, `NATS_URL`, `AUTH_JWT_PUBLIC_KEY`, `CORS_ORIGINS`, `LOG_LEVEL`.
- **realtime**: `PORT`, `NATS_URL`, `AUTH_JWT_PUBLIC_KEY`, `CORS_ORIGINS`, `LOG_LEVEL`.
- **auth**: `PORT`, `NATS_URL`, `AUTH_DB_URL`, `AUTH_JWT_PRIVATE_KEY`, `AUTH_JWT_PUBLIC_KEY`,
  `AUTH_JWT_KID`, `ACCESS_TOKEN_TTL`, `REFRESH_TOKEN_TTL`, Google OAuth (`GOOGLE_CLIENT_ID`,
  `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL`), SMTP for confirmation email (`SMTP_HOST`,
  `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`, `MAIL_VERIFY_BASE_URL`), `LOG_LEVEL`.
- **core**: `PORT`, `NATS_URL`, `CORE_DB_URL`, `AUTH_JWT_PUBLIC_KEY`, `LOG_LEVEL`.

The JWT keypair is generated once and stored as a Secret; only auth holds the private half,
and every service holds the public half. `AUTH_JWT_KID` identifies the active key for
rotation (see 0004). A `REDIS_URL` is intentionally absent for now; it joins this list when
Redis is introduced later (cache and, if realtime scales out, the socket backplane).

## 2. Local development infrastructure

Add a `docker-compose.yml` (dev only) that brings up the dependencies a developer needs: a
Postgres instance for auth, a **separate** Postgres instance for core (separate databases,
enforcing the no shared database rule even locally), a **NATS server with JetStream enabled**,
and a local SMTP catcher (for example Mailhog) so confirmation emails are viewable without a
real provider. Nx `serve` targets run the four services against this stack. Redis is not part
of the compose stack yet.

## 3. Dockerfiles

Each service is a **long running Node process**, which is a new image shape for this repo
(the existing apps are static bundles served by nginx). Each service gets
`apps/luna-shopper-<svc>/src/Dockerfile`, multi stage:

1. Build stage `FROM` the repo `builder` image, run `npx nx build luna-shopper-<svc>`.
2. Runtime stage on a slim `node` image: copy the built output plus production dependencies,
   run as a non root user, handle `SIGTERM` for graceful shutdown (section 6),
   `CMD ["node", "main.js"]`, and expose the health port. No build time config is baked in;
   all config is runtime environment.

## 4. build:docker targets

Add a `build:docker` target to each service's `project.json` using `@portfolio/docker:build`,
mirroring the existing apps: `imageName` of `nx-portfolio/luna-shopper-<svc>`, and
development/production configurations (dev tags `dev`, production pushes `latest`). No
`MFE_*` forwarding, because these are not micro frontends and carry no build time config.

## 5. Helm

- Add production and staging entries under `apps` in `k8s/helm/values.yaml` for the gateway,
  realtime, auth, and core images, following the existing per app deployment/service pattern.
- **Routed public services**: the gateway (REST) and the realtime service (WebSocket/SSE).
  Give them hosts (for example `api.` and `rt.` under `ichirokuxvi.com` and
  `staging.ichirokuxvi.com`). The realtime route needs the WebSocket upgrade headers
  (`Upgrade`, `Connection`) and long read timeouts on the reverse proxy so sockets survive.
- auth and core are internal only (ClusterIP, reachable over NATS and by the gateway); they
  are not exposed through the reverse proxy.
- Add the stateful dependencies: two PostgreSQL instances (StatefulSets with PVCs, or managed
  databases) and NATS with JetStream (with a persistent volume so streams survive restarts).
  Database credentials, the JWT keypair, Google OAuth secrets, and SMTP credentials are
  Kubernetes Secrets. SMTP connects over TLS on the submission port (587/465). Separately from
  the cluster, `ichirokuxvi.com` needs SPF, DKIM, and DMARC DNS records so confirmation emails
  are not treated as spam (a DNS setup step, recorded in 0005).
- Run **database migrations on deploy** before new pods take traffic: a Helm pre upgrade Job
  (or init container) per stateful service that runs that service's `migration:run`. Never by
  app boot / `synchronize`.

## 6. Zero downtime deploys

A new release must not interrupt users. This is a first class requirement and touches several
layers:

- **Rolling updates** with a readiness gate: Kubernetes rolls pods one at a time, sending
  traffic to a new pod only once its **readiness probe** passes, and keeps old pods serving
  until then (`maxUnavailable: 0`, a small `maxSurge`). Liveness and readiness probes come
  from the health endpoints in 0004 (`@nestjs/terminus`).
- **Graceful shutdown**: enable Nest shutdown hooks; on `SIGTERM` stop accepting new work,
  finish in flight requests, then close DB and NATS connections. Kubernetes
  `terminationGracePeriod` is set long enough to drain.
- **Realtime draining**: on shutdown the realtime pod stops accepting new sockets and lets
  clients reconnect (socket.io auto reconnects) to a healthy pod; when Redis is later added as
  a backplane, in flight fan out survives a single pod cycling.
- **Backward compatible migrations (expand/contract)**: because old and new pods run at the
  same time during a rollout, and because migrations are append only and never deleted, every
  migration must be safe for the previous version too. Additive first (add columns/tables,
  backfill, dual write), and only remove the old shape in a **later** release once nothing
  references it. No destructive change ships in the same release as the code that stops using
  the old shape.
- **PodDisruptionBudget** per service so node maintenance never takes all replicas at once.

## 7. CI

- The four services already have `lint`/`test`/`build` targets from 0001, so `nx affected`
  picks them up like everything else with no special casing.
- Add their `build:docker` to the same staging (push to `main`) and release (GitHub Release)
  flows the other deployable apps use. They are not part of the shell micro frontend build
  loop.
- The deploy step gains the migration Job from section 5 so schema changes ship with the
  image that needs them.

## 8. Exit criteria

- `docker compose up` brings up both Postgres instances, NATS with JetStream, and the mail
  catcher, and all four services serve against them locally.
- `nx run luna-shopper-<svc>:build:docker` produces a runnable image for each service.
- `values.yaml` has production and staging entries for the four services, the gateway and
  realtime routes carry the right proxy settings, and a migration Job exists per stateful
  service.
- A deploy of a new version causes no dropped requests and no dropped socket sessions (rolling
  update with readiness gate, graceful shutdown, expand/contract migration).
- CI builds and (on the right triggers) pushes the four images.
