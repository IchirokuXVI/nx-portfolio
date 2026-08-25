# 0016 Distributed tracing and metrics in the platform library

Plan 0004 section 3 designed the correlation id as "tracing in its lightest form" and named full
OpenTelemetry as the extension point, with an explicit promise: **adding OTel must not change the
log or event contracts.** This plan cashes that in. It adds distributed tracing and a Prometheus
metrics surface to `libs/luna-shopper/platform`, in one place, so every service inherits both the
way it already inherits pino logging, the problem+json exception filter, the request context, and
the health endpoints.

The shape is the same as the existing platform work: a module a service imports once, a bootstrap
helper it calls once, and building blocks the feature plans use. Nothing service specific is
encoded in the library, so the written spec here is also what a future .NET or Spring service
reimplements.

## 1. Why this belongs in the platform library

The system is five Node services talking over NATS. A single user action already threads a
correlation id from the gateway through auth or core and out to the realtime fan out. What the
correlation id cannot answer is *where the time went* and *which hop failed*, because it is a
label on log lines, not a causal tree with durations. Tracing supplies exactly that, and it is
worth having precisely because the architecture is distributed: a slow list load could be the
gateway, the broker, a core query, or a Postgres index, and the log alone will not say which.

Putting it in the platform library rather than per service matters more here than it did for
logging. Tracing is only useful if **every** hop is instrumented and every hop propagates context
identically. One service that drops the trace context on a NATS publish breaks the tree for every
request that passes through it. A single shared implementation makes uniform propagation the
default rather than a thing five services each have to remember.

## 2. Dependencies

None of these are in the workspace today, so this plan adds them to the root `package.json`
following plan 0003's principles.

- `@opentelemetry/api` (the instrumentation API; the only thing application code imports).
- `@opentelemetry/sdk-node` (SDK bootstrap for traces and metrics).
- `@opentelemetry/resources` and `@opentelemetry/semantic-conventions` (resource attributes and
  standard attribute names).
- `@opentelemetry/auto-instrumentations-node` (the bundle: http, express, nestjs-core, pg,
  and others).
- `@opentelemetry/exporter-trace-otlp-http` (OTLP over HTTP to a collector).
- `@opentelemetry/exporter-prometheus` (the `/metrics` scrape endpoint, see section 5).
- `@opentelemetry/instrumentation-runtime-node` for Node runtime metrics (event loop lag, GC,
  heap).

`pino-opentelemetry-transport` is **not** adopted. Logs keep going to stdout and are collected
there; correlating logs to traces is done by putting the ids **in** the log line (section 4.4),
which is simpler and does not add a second delivery path that can fail.

## 3. Decision: one SDK for both signals

Metrics could be done with `prom-client` directly, which is simpler and extremely well proven.
The OpenTelemetry metrics SDK with the Prometheus exporter is adopted instead, for three reasons:

1. **One instrumentation API for both signals.** Application code imports `@opentelemetry/api`
   and nothing else, whether it is starting a span or incrementing a counter.
2. **One resource definition.** `service.name`, `service.version`, and
   `deployment.environment` are declared once and appear identically on traces and metrics, so a
   dashboard and a trace search filter on the same values.
3. **The exporter is a config change, not a rewrite.** Today Prometheus scrapes `/metrics`. If
   push based OTLP metrics to a collector ever become preferable, that swaps one exporter and
   touches no instrumentation.

The auto instrumentations emit both spans and metrics from the same hooks, so this also avoids
instrumenting HTTP timing twice.

**Fallback, recorded so it is a decision and not a surprise:** if the Prometheus exporter proves
awkward for a specific metric shape, `prom-client` may be used for that metric behind the same
platform module surface. Services must never import either library directly.

## 4. Tracing

### 4.1 Initialization must happen before anything else loads

This is the detail that most commonly makes an OTel setup silently do nothing. The auto
instrumentations work by patching modules **as they are required**. If `@nestjs/core`, `pg`, or
`http` is imported before the SDK starts, those modules are already resolved and never get
patched, so the traces come out empty or missing whole layers.

So the SDK starts in its own module with no other imports, and it is loaded first:

- The library exports `libs/luna-shopper/platform/src/lib/telemetry/tracing.ts`, whose side effect
  on import is starting the `NodeSDK`.
- Each service's `main.ts` imports it **as the very first import**, before `@nestjs/core` and
  before `./app/app.module`. A lint rule or a comment convention keeps the ordering from being
  "tidied" by an import organizer, which is a live risk here because this repo runs
  `prettier-plugin-organize-imports` and that plugin sorts imports. The safe form is therefore a
  bare side effect import placed so sorting cannot move it below the others, and if that proves
  fragile the fallback is `node --require` in the Dockerfile `CMD`, which cannot be reordered at
  all.

The Dockerfile fallback is worth keeping in mind: it is the only form that is immune to source
level reordering.

### 4.2 Resource attributes

Every span and metric carries `service.name` (for example `luna-shopper-backend-gateway`),
`service.version` (the release version already baked as the image tag), and
`deployment.environment` (`production`, `staging`, or `development`). These come from environment
variables so one image serves both environments, consistent with plan 0002's rule that nothing
environment specific is baked in outside the shell.

### 4.3 What is instrumented automatically, and the one gap that matters

The auto instrumentation bundle covers inbound and outbound HTTP, Express, Nest's own controller
and provider layer, and `pg`. That gives the gateway's REST surface and auth/core/catalog's
database work for free.

**It does not cover NATS.** There is no official OpenTelemetry instrumentation for the `nats`
client, and NATS is the backbone of this system: nearly every interesting trace crosses it at
least once. Without manual work, every trace would stop dead at the gateway and restart
disconnected in auth or core, which is the failure that makes tracing worthless in a broker based
system. So this is the plan's core work item, not an afterthought.

The existing `libs/luna-shopper/platform/src/lib/nats/correlation-headers.ts` is already the one
place where NATS headers are written and read, which makes it the natural seam:

- **On send**, `buildNatsHeaders` additionally injects the **W3C `traceparent`** (and `tracestate`)
  using the OTel propagator API, alongside the correlation id and locale it already writes.
- **On receive**, a counterpart extracts the remote context and runs the handler inside it, so the
  handler's spans are children of the caller's span rather than roots of a new trace.
- Both sides create a span per message with the standard messaging attributes (`messaging.system`
  = `nats`, the subject as the destination, and the operation), so a request/reply round trip
  shows as a producer span and a consumer span rather than one opaque gap.
- The **realtime fan out** is instrumented the same way, which is what lets a trace run all the
  way from the user's HTTP request to the push that another user's browser receives. That is the
  single most valuable trace in the system and it is the whole reason to bother with propagation.

Because the header names and the injection point live in one file that every service already
uses, no service has to know any of this happened.

### 4.4 Correlation id and trace id coexist

Plan 0004 promised the log and event contracts would not change, and the correlation id is
user facing: it is returned in the problem+json envelope and users quote it in bug reports. So
the correlation id **stays exactly as it is**, and the trace id is added beside it:

- `RequestContext` gains nothing mandatory; the trace context lives in OTel's own context, which
  is already an AsyncLocalStorage, and the two propagate together.
- The pino logger's mixin adds `trace_id` and `span_id` to every log line when a span is active,
  so a log line points at a trace.
- The correlation id is set as a **span attribute** on the root span, so a trace can be found from
  a correlation id a user quoted.

That gives navigation in both directions without changing the error envelope, the NATS message
schemas, or the event payloads. Nothing in `libs/luna-shopper/contracts` moves.

### 4.5 Sampling

Sampling is `ParentBased(TraceIdRatioBased(ratio))` with the ratio from an environment variable:
`1.0` in development, lower in production once traffic justifies it. Parent based is required, not
optional: it is what keeps a sampling decision consistent across a whole request. If the gateway
samples a trace and core independently decides not to, the trace arrives permanently broken.

Head sampling cannot preferentially keep errors, because the decision is made before the outcome
is known. The correct answer to "always keep failing traces" is **tail sampling in the collector**,
and it is recorded here as the intended approach rather than attempted in the SDK.

### 4.6 Exporter and failure posture

Spans are exported over OTLP HTTP to a collector, batched, using the standard `OTEL_EXPORTER_*`
environment variables rather than bespoke names, so anything that already knows OpenTelemetry
configures this without reading code.

**Telemetry must never take a service down.** This is a hard requirement:

- If no endpoint is configured, telemetry is **off** and the service behaves exactly as it does
  today. That is what lets the library work ship before any collector exists (section 8).
- If the collector is unreachable or slow, the batch processor drops spans and logs at `warn`. It
  never blocks a request, never grows unboundedly, and never propagates an error into the request
  path.
- The SDK is shut down in the graceful shutdown sequence from plan 0004 section 7, flushing
  pending spans with a bounded timeout, so a rollout does not lose the traces that explain why it
  was rolled.

### 4.7 Never trace a secret

Plan 0004 section 1 established that secrets never reach the log, and span attributes are a new
place they could leak that the pino `redact` config does not cover. So the same discipline is
applied deliberately: request bodies are not attached to spans, the `http` instrumentation is
configured not to capture `authorization` and `cookie` headers, and the shared span helpers
reuse the redaction list from `logging/redaction.ts` rather than keeping a second one that can
drift out of sync.

## 5. Metrics

### 5.1 The endpoint

Every service already runs an HTTP port for health probes, including auth, core, and catalog,
which are otherwise NATS microservices. `GET /metrics` is served on that same port by the
Prometheus exporter, wired through the platform module so no service configures it.

Three exclusions have to be deliberate, because each one is a real bug if forgotten:

- **Not URL versioned.** Prometheus scrapes a fixed path; `/v1/metrics` would break the scrape
  config on the next major version. The route is registered outside the versioning scheme, the
  same way health already is.
- **Excluded from the throttler.** A scrape every fifteen seconds must never consume a rate limit
  bucket, and a throttled scrape shows up as a gap in the graphs rather than as an error.
- **Excluded from Swagger.** It is not part of the public API surface.

`/metrics` is not routed through the reverse proxy. It is reachable inside the cluster only,
because it exposes internal timing and cardinality that has no business being public.

### 5.2 What is measured

The default set, provided by the library so it is identical everywhere:

- **HTTP (RED)**: request count, error count, and duration histogram, labelled by method, **route
  template**, and status code. The auto instrumentation emits these.
- **NATS messaging**: messages handled, failures, and a handling duration histogram, labelled by
  subject and outcome. Emitted from the same seam as the tracing spans in section 4.3, so the two
  cannot disagree about what a message is.
- **Node runtime**: event loop lag, heap usage, and GC pauses.

Per service additions, contributed by the service rather than the library:

- **auth and core and catalog**: TypeORM connection pool saturation, which is the first thing to
  check when latency rises and is invisible from HTTP metrics alone.
- **realtime**: currently connected sockets, and fan out latency from event receipt to push.
- **JetStream consumer lag** wherever a durable consumer exists. Because delivery is at least
  once and consumers are idempotent (plan 0004 section 9), a consumer falling behind is silent by
  design until it is severe. A lag metric is the only early warning.

### 5.3 The cardinality rule

Stated as a rule because it is the standard way a metrics system becomes unusable and expensive:
**never label a metric with an unbounded value.** Specifically, `userId`, `zoneId`, `listId`,
`correlationId`, and raw request paths are forbidden as labels. Every one of them grows without
bound and each distinct combination creates a permanent time series.

The route **template** (`/v1/zones/:zoneId/lists`) is used, never the resolved path. High
cardinality identifiers belong on **spans**, where they are free and genuinely useful, and that
division of labour is the point: traces answer "what happened to this one request", metrics
answer "how is the system doing overall".

The platform's metric helpers make this hard to get wrong by taking a declared label set rather
than an open object.

## 6. Where it lives

Following the existing layout of the library, a new `telemetry` folder:

```
libs/luna-shopper/platform/src/lib/telemetry/
  tracing.ts               # NodeSDK bootstrap, side effect import, no other imports
  telemetry.config.ts      # env parsing, on/off, endpoint, sampling ratio, resource attrs
  telemetry.module.ts      # /metrics controller wiring + meter providers
  nats-propagation.ts      # traceparent inject/extract + messaging spans
  metrics/
    http.metrics.ts
    nats.metrics.ts
    runtime.metrics.ts
  span-attributes.ts       # safe attribute helpers, reusing logging/redaction.ts
```

Exported from `src/index.ts` under a `// Telemetry` heading, matching how the existing groups are
laid out.

`PlatformModule.forRoot` gains a `telemetry` option so a service opts in with the service name it
already passes for logging. `bootstrapPlatform` gains the SDK shutdown registration. The intended
end state is that a service's `main.ts` changes by **one import line**, and its `app.module.ts`
does not change at all.

## 7. Configuration

Added to plan 0002 section 1's per service variable list, for every service:

- `OTEL_ENABLED` (default off, so absence of configuration is a working service),
- `OTEL_EXPORTER_OTLP_ENDPOINT`,
- `OTEL_TRACES_SAMPLER_ARG` (the ratio),
- `DEPLOYMENT_ENVIRONMENT`,
- `METRICS_ENABLED` (default on; `/metrics` costs nothing when nothing scrapes it).

All are validated by the existing `@nestjs/config` schema and fail fast on a malformed value,
consistent with plan 0002.

## 8. Scope boundary: the library ships before the backend does

There is **no monitoring stack in the cluster today**. Nothing in `k8s/helm` runs Prometheus,
Grafana, Tempo, Jaeger, or a collector. That is a genuine piece of infrastructure work with its
own storage, retention, and resource cost on a single node k3s cluster, and it is deliberately
**not** in this plan's critical path.

The split is what makes that safe: because telemetry is off when unconfigured and `/metrics` is
inert when unscraped, the library work is complete, testable, and mergeable on its own. Local
development gets the full experience immediately (section 9), and the cluster side lands when it
lands.

When it does, the expected shape is an OpenTelemetry Collector as the single ingestion point (so
services know one endpoint and the backends behind it can change), Prometheus scraping `/metrics`
via pod annotations, and a trace backend such as Tempo or Jaeger. Retention on a single node
cluster should be short by default. That work gets its own plan; this section exists so the
dependency is written down rather than assumed.

## 9. Local development

An opt in `observability` profile is added to `k8s/e2e/luna-shopper-backend/compose.yml`,
alongside the existing `test` profile so a plain `docker compose up` is unchanged:

- an OpenTelemetry Collector receiving OTLP, mirroring the cluster's eventual topology so local
  and deployed configuration match,
- Jaeger all in one for trace viewing,
- Prometheus scraping the five services,
- Grafana, optional, for dashboards.

Ports follow the existing `LUNA_*_PORT` override convention so the slot harness keeps working and
several worktrees can each run their own observability stack without colliding.

Being able to see a trace cross the broker on a laptop is most of this plan's practical value:
it turns "the list page feels slow" into a picture within seconds.

## 10. Testing

Telemetry is easy to write and easy to leave silently broken, so it gets real tests rather than a
manual check:

- **Unit**: the propagation helpers round trip a `traceparent` through NATS headers and rebuild
  the same trace id and parent span id; the span attribute helpers redact everything
  `logging/redaction.ts` lists; the metric helpers reject an undeclared label.
- **Integration**: with the SDK exporting to an in memory span exporter, a request through a real
  NATS round trip produces **one trace** containing the gateway span, the messaging spans, and the
  handler span, with the correct parent/child links. This is the test that actually protects the
  feature: it is exactly what breaks when someone adds a new publish path and forgets the headers.
- **Contract**: `/metrics` responds with valid Prometheus exposition format on every service, and
  the endpoint is reachable without a token and without consuming a throttle bucket.
- **Regression guard**: with `OTEL_ENABLED` unset, no exporter is constructed and no network call
  is attempted, so the default path stays clean.

## 11. Overhead

Instrumentation is not free and the honest posture is to measure rather than assume. Auto
instrumentation of HTTP, Nest, and `pg` typically costs single digit percent CPU; the batch
processor keeps export off the request path. Noisy instrumentations that add volume without
insight (filesystem calls, DNS) are disabled explicitly rather than left on. The sampling ratio
is the primary lever if production cost becomes a concern, and it is a config change requiring no
deploy of new code.

## 12. Exit criteria

- A single user action produces **one trace** spanning the gateway, the NATS hops, the database
  work, and the realtime push, with correct parent/child structure across every service boundary.
- Traces and metrics come from `libs/luna-shopper/platform`. A service opts in by importing one
  module and one side effect import; no service imports an OpenTelemetry package directly.
- The correlation id, the problem+json envelope, the NATS message schemas, and the event payloads
  are **unchanged**, honoring plan 0004 section 3's promise. Log lines gain `trace_id` and
  `span_id`; spans carry the correlation id.
- Every service serves `GET /metrics` in Prometheus format on its health port, unversioned,
  unthrottled, absent from Swagger, and not routed publicly.
- No metric is labelled with a user id, zone id, correlation id, or raw path.
- No secret appears in a span attribute; the redaction list has exactly one definition.
- With telemetry unconfigured, every service runs exactly as it does today; with the collector
  down, requests still succeed.
- A shutdown flushes pending spans within a bounded timeout without delaying the rollout.
- `docker compose --profile observability up` gives a local trace view and a local Prometheus.
- The propagation integration test fails if a new publish path forgets to inject the trace
  context.
