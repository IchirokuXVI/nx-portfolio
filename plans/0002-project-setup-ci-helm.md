# 0002 Project setup: config, Docker, Helm, CI

Second plan. It turns the empty apps from 0001 into deployable, configurable services and
wires them into the existing docker/Helm/CI machinery. Still no business logic.

## 1. Configuration strategy

- Use `@nestjs/config` in every service, loaded once at the root module, with a typed and
  validated schema (validate on boot with `joi` or `class-validator`, and fail fast on a
  missing required variable). Configuration is per service and read from environment
  variables only, never hard coded.
- Nothing secret goes into images or build args. Secrets arrive at runtime through
  Kubernetes Secrets (and through a local `.env` for development, git ignored).

Variables per service (initial):

- **gateway**: `PORT`, `NATS_URL` (or `REDIS_URL`), `AUTH_JWT_PUBLIC_KEY`, `CORS_ORIGINS`.
- **auth**: `PORT`, `NATS_URL`, `AUTH_DB_URL`, `AUTH_JWT_PRIVATE_KEY`, `AUTH_JWT_PUBLIC_KEY`,
  `ACCESS_TOKEN_TTL`, `REFRESH_TOKEN_TTL`, Google OAuth (`GOOGLE_CLIENT_ID`,
  `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL`), and SMTP for confirmation email
  (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`, `MAIL_VERIFY_BASE_URL`).
- **core**: `PORT`, `NATS_URL`, `CORE_DB_URL`, `AUTH_JWT_PUBLIC_KEY` (to verify tokens on
  event handling if needed).

The JWT keypair is generated once and stored as a Secret. The public half is distributed to
gateway and core; only auth holds the private half.

## 2. Local development infrastructure

Add a `docker-compose.yml` (dev only, next to the apps) that brings up the dependencies a
developer needs without deploying anything: a Postgres instance for auth, a separate Postgres
instance for core (separate databases, enforcing the no shared database rule even locally),
the NATS (or Redis) broker, and a local SMTP catcher (for example Mailhog) so confirmation
emails are viewable without a real mail provider. Nx `serve` targets run the three services
against this compose stack.

## 3. Dockerfiles

Each service is a **long running Node process**, which is a new image shape for this repo
(the existing apps are static bundles served by nginx). Each service gets
`apps/luna-shopper-<svc>/src/Dockerfile`, multi stage:

1. Build stage `FROM` the repo `builder` image, run `npx nx build luna-shopper-<svc>`.
2. Runtime stage on a slim `node` image: copy the built output plus production
   dependencies, run as a non root user, `CMD ["node", "main.js"]`, and expose the health
   port. No build time base URL is embedded; all config is runtime environment.

## 4. build:docker targets

Add a `build:docker` target to each service's `project.json` using `@portfolio/docker:build`,
mirroring the existing apps: `imageName` of `nx-portfolio/luna-shopper-<svc>`, and
development/production configurations (dev tags `dev`, production pushes `latest`). No
`MFE_*` forwarding, because these are not micro frontends and carry no build time config.

## 5. Helm

- Add production and staging entries under `apps` in `k8s/helm/values.yaml` for the gateway,
  auth, and core images, following the existing per app deployment/service pattern.
- The **gateway** is the routed public service: give it a host (for example
  `api.ichirokuxvi.com` and `api.staging.ichirokuxvi.com`). Its reverse proxy route needs the
  WebSocket upgrade headers (`Upgrade`, `Connection`) so Socket.IO connections survive.
- auth and core are internal only (ClusterIP services reachable over the broker and by the
  gateway); they are not exposed through the reverse proxy.
- Add the stateful dependencies: two PostgreSQL instances (StatefulSets with PVCs, or a
  managed database if preferred) and the NATS (or Redis) broker. Database credentials, the
  JWT keypair, Google OAuth secrets, and SMTP credentials are Kubernetes Secrets.
- Run **database migrations on deploy** before the new pods take traffic: a Helm pre upgrade
  Job (or an init container) per service that runs that service's `migration:run`. Migrations
  are never applied by app boot with `synchronize`.

## 6. CI

- The three services already have `lint`/`test`/`build` targets from 0001, so `nx affected`
  picks them up like everything else with no special casing.
- Add their `build:docker` to the same staging (push to `main`) and release (GitHub Release)
  flows the other deployable apps use. They are not part of the shell micro frontend build
  loop.
- The deploy step gains the migration Job from section 5 so schema changes ship with the
  image that needs them.

## 7. Exit criteria

- `docker compose up` brings up both Postgres instances, the broker, and the mail catcher,
  and all three services serve against them locally.
- `nx run luna-shopper-<svc>:build:docker` produces a runnable image for each service.
- `values.yaml` has production and staging entries for gateway/auth/core, the gateway route
  carries WebSocket upgrade headers, and a migration Job exists per service.
- CI builds and (on the right triggers) pushes the three images.
