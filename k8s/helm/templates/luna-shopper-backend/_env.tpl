{{/*
Luna Shopper container env (plan 0002, section 1 and 5).

Emits the env vars a backend service needs, chosen by its `role`, so each pod
receives only what it should: only the auth pod ever gets the JWT private key,
the DB URLs stay with the service that owns the database, etc. Non secret values
come from the per environment ConfigMap; secret values from the per environment
Secret.

Call with a dict:
  (dict "svc" <service> "cfg" <configMapName> "sec" <secretName>
        "env" <environment label> "tag" <imageTag>)

`env` is now a telemetry label read from .Values.environment rather than a
dimension the chart branches on: this release is one environment (plan 0002), so
there is one ConfigMap and one Secret and nothing here has to choose between
them.
*/}}
{{- define "lunaShopperBackend.env" -}}
{{- $svc := .svc -}}
{{- $cfg := .cfg -}}
{{- $sec := .sec -}}
{{- $env := .env -}}
{{- $tag := .tag -}}
# Common to every service.
- name: PORT
  value: {{ $svc.port | quote }}
- name: NATS_URL
  valueFrom:
    configMapKeyRef:
      name: {{ $cfg }}
      key: NATS_URL
- name: LOG_LEVEL
  valueFrom:
    configMapKeyRef:
      name: {{ $cfg }}
      key: LOG_LEVEL
# Telemetry (plan 0016, section 7). The identity is per pod and comes from the
# release, so one image still serves both environments: the service name is the
# role rather than the deployment name (which is now identical in both clusters
# anyway; the two are told apart by deployment.environment alone), and the
# version is the image tag already being deployed. The switches come from the per environment ConfigMap and are
# off by default, because there is no collector in the cluster yet (section 8).
- name: OTEL_SERVICE_NAME
  value: {{ printf "luna-shopper-backend-%s" $svc.role | quote }}
- name: SERVICE_VERSION
  value: {{ $tag | quote }}
- name: DEPLOYMENT_ENVIRONMENT
  value: {{ $env | quote }}
{{- range $key := (list "OTEL_ENABLED" "OTEL_EXPORTER_OTLP_ENDPOINT" "OTEL_TRACES_SAMPLER_ARG" "METRICS_ENABLED") }}
- name: {{ $key }}
  valueFrom:
    configMapKeyRef:
      name: {{ $cfg }}
      key: {{ $key }}
{{- end }}
{{- if or (eq $svc.role "gateway") (eq $svc.role "realtime") }}
# Redis (plan 0028). Only these two roles receive it, and both **require** it:
# realtime is incorrect at more than one replica without the backplane, and a
# gateway that starts with no working rate limiter is the outcome section 5
# refuses. auth, core and catalog hold no shared state and are not given it.
- name: REDIS_URL
  valueFrom:
    configMapKeyRef:
      name: {{ $cfg }}
      key: REDIS_URL
- name: CORS_ORIGINS
  valueFrom:
    configMapKeyRef:
      name: {{ $cfg }}
      key: CORS_ORIGINS
- name: AUTH_JWT_PUBLIC_KEY
  valueFrom:
    secretKeyRef:
      name: {{ $sec }}
      key: AUTH_JWT_PUBLIC_KEY
{{- end }}
{{- if eq $svc.role "gateway" }}
# The operator trust root (plan 0071, section 3), and a SECOND key rather than the
# auth key with a different audience. Five services hold AUTH_JWT_PUBLIC_KEY, so one
# key for both kinds of token would leave every one of them treating an admin token
# as structurally valid, rejecting it only if it remembered to check the audience.
# Only the gateway receives this one today; catalog and harvester join it in plan
# 0072, and realtime never does.
- name: ADMIN_JWT_PUBLIC_KEY
  valueFrom:
    secretKeyRef:
      name: {{ $sec }}
      key: ADMIN_JWT_PUBLIC_KEY
# The name this deployment answers with under GET /v1/admin/auth/me, which is where
# the back office gets its accent colour from (apps/luna-shopper-admin/plans/0001,
# section 6). It comes from the API rather than the bundle because the failure being
# guarded against is believing you are in staging when you are in production, and a
# build time constant is exactly what is wrong in that scenario.
- name: ENVIRONMENT_NAME
  valueFrom:
    configMapKeyRef:
      name: {{ $cfg }}
      key: ENVIRONMENT_NAME
# Google sign in (plan 0023). The passport dance runs at the gateway, so it needs
# the same OAuth credentials auth holds, plus the app URL its callback redirects
# to. All four are empty by default, and with an empty client id the routes stay
# registered but inert, so boot is unaffected until Google is actually set up.
- name: GOOGLE_CLIENT_SECRET
  valueFrom:
    secretKeyRef:
      name: {{ $sec }}
      key: GOOGLE_CLIENT_SECRET
{{- /*
The oldest velista build this deployment serves (velista plan 0034). Gateway only,
because it is the only public HTTP surface: the realtime service carries no request
bodies and reads no floor, and a stale client is caught on its next REST call.
*/}}
{{- /*
The two byte caps a multipart interceptor enforces, for the two routes that take
an upload: a spoken assistant turn (plan 0041) and a voice comment (plan 0045).
Gateway only, because the interceptor is the one thing standing between a phone
and this pod's memory, and a cap that is not on it is not a cap: the global
ValidationPipe never sees a file and Express's body limits do not apply to a
multipart stream. The assistant and core each apply their own number again to
what actually crossed the broker.
*/}}
{{- /*
The third byte cap, and the only one that is not a multipart interceptor's (plan
0081, section 7). The leaflet upload is JSON, so what enforces it is the route's
own body parser, mounted ahead of the 100 KB default because Nest's built in one
cannot vary per route. Gateway only: the harvester reads the document off a
broker message, and NATS carries 8 MB.
*/}}
{{- range $key := (list "GOOGLE_CLIENT_ID" "GOOGLE_CALLBACK_URL" "APP_BASE_URL" "MIN_CLIENT_VERSION" "ASSISTANT_AUDIO_MAX_BYTES" "VOICE_COMMENT_MAX_BYTES" "VOICE_COMMENT_CONTENT_TYPES" "VOICE_COMMENT_TRANSCRIBE_TIMEOUT_MS" "LEAFLET_MAX_BYTES") }}
- name: {{ $key }}
  valueFrom:
    configMapKeyRef:
      name: {{ $cfg }}
      key: {{ $key }}
{{- end }}
{{- end }}
{{- if eq $svc.role "core" }}
- name: CORE_DB_URL
  valueFrom:
    secretKeyRef:
      name: {{ $sec }}
      key: CORE_DB_URL
- name: AUTH_JWT_PUBLIC_KEY
  valueFrom:
    secretKeyRef:
      name: {{ $sec }}
      key: AUTH_JWT_PUBLIC_KEY
# What proves a caller may read somebody else's household (plan 0074). Core
# verifies the operator token the gateway forwarded against this key, for itself,
# so a gateway route that forgets its guard still cannot read a stranger's list.
# The same key catalog and the harvester have held since plan 0072, and a
# different keypair from the one above: an operator and a velista user are
# different principals signed by different keys.
- name: ADMIN_JWT_PUBLIC_KEY
  valueFrom:
    secretKeyRef:
      name: {{ $sec }}
      key: ADMIN_JWT_PUBLIC_KEY
{{- /*
The second half of plan 0045 section 6's cap, from the same two ConfigMap keys the
gateway reads. Core owns the `bytea` the recording is written into, so it refuses a
payload that reached the broker without passing the interceptor.
*/}}
{{- range $key := (list "VOICE_COMMENT_MAX_BYTES" "VOICE_COMMENT_CONTENT_TYPES") }}
- name: {{ $key }}
  valueFrom:
    configMapKeyRef:
      name: {{ $cfg }}
      key: {{ $key }}
{{- end }}
{{- end }}
{{- if eq $svc.role "catalog" }}
- name: CATALOG_DB_URL
  valueFrom:
    secretKeyRef:
      name: {{ $sec }}
      key: CATALOG_DB_URL
- name: AUTH_JWT_PUBLIC_KEY
  valueFrom:
    secretKeyRef:
      name: {{ $sec }}
      key: AUTH_JWT_PUBLIC_KEY
# What proves a caller may write the catalog (plan 0072). Catalog verifies the
# operator token the gateway forwarded against this key, for itself, so a gateway
# route that forgets its guard still cannot write.
- name: ADMIN_JWT_PUBLIC_KEY
  valueFrom:
    secretKeyRef:
      name: {{ $sec }}
      key: ADMIN_JWT_PUBLIC_KEY
# The other door, for callers that are machines rather than people (section 4).
# The harvester's actor id is its only member, and it names a service rather than
# a person, which is precisely why it no longer grants admin.
#
# From the Secret rather than the ConfigMap since plan 0081 section 11, and not
# because a uuid is secret. It is generated once per cluster by
# `provision-release.sh`, and the Secret is the only per environment store that
# script owns: the chart owns the ConfigMap and a helm upgrade would overwrite
# anything written there. One key feeds this and the harvester's own copy, so
# the two cannot name different actors.
- name: SERVICE_ACTOR_IDS
  valueFrom:
    secretKeyRef:
      name: {{ $sec }}
      key: HARVESTER_ACTOR_ID
{{- end }}
{{- if eq $svc.role "harvester" }}
# The harvester (plan 0038). It owns the fourth database, verifies tokens offline
# with the auth public key like catalog does, and gates EVERY subject it exposes
# on a valid operator token rather than only its writes (plan 0072).
- name: HARVESTER_DB_URL
  valueFrom:
    secretKeyRef:
      name: {{ $sec }}
      key: HARVESTER_DB_URL
- name: AUTH_JWT_PUBLIC_KEY
  valueFrom:
    secretKeyRef:
      name: {{ $sec }}
      key: AUTH_JWT_PUBLIC_KEY
# Required here, and required for more than the writes: with every subject gated,
# a harvester without this key answers nothing at all.
- name: ADMIN_JWT_PUBLIC_KEY
  valueFrom:
    secretKeyRef:
      name: {{ $sec }}
      key: ADMIN_JWT_PUBLIC_KEY
# The same uuid catalog is told to accept, from the same Secret key.
- name: HARVESTER_ACTOR_ID
  valueFrom:
    secretKeyRef:
      name: {{ $sec }}
      key: HARVESTER_ACTOR_ID
{{- range $key := (list "HARVEST_ENABLED" "HARVEST_USER_AGENT" "HARVEST_BATCH_SIZE" "HARVEST_DEFAULT_WORKERS" "HARVEST_DEFAULT_MAX_RPS" "HARVEST_STALE_AFTER" "HARVEST_FAILURE_RATIO" "HARVEST_DISCOVERY_RADIUS" "HARVEST_DISCOVERY_COOLDOWN_DAYS" "HARVEST_DISCOVERY_MAX_ATTEMPTS" "HARVEST_DISCOVERY_POLL_SECONDS" "OVERPASS_URL" "NOMINATIM_URL") }}
- name: {{ $key }}
  valueFrom:
    configMapKeyRef:
      name: {{ $cfg }}
      key: {{ $key }}
{{- end }}
{{- end }}
{{- if eq $svc.role "assistant" }}
# The assistant (plan 0039). The shortest block here, and the shape of it is the
# point: **no database url of any kind**, because rule A1 says the service reaches
# application data only through the API carrying the caller's own token, and it
# holds no credential of its own beyond the provider key below.
#
# GEMINI_API_KEY is in `OPTIONAL_EMPTY_KEYS` in provision-release.sh, so an
# operator with no key gets a service that boots and answers 501 on its one route
# rather than a pod stuck in CreateContainerConfigError and a cluster that never
# comes up (plan 0026). Nothing here may be made required without breaking that.
- name: GEMINI_API_KEY
  valueFrom:
    secretKeyRef:
      name: {{ $sec }}
      key: GEMINI_API_KEY
{{- range $key := (list "GATEWAY_INTERNAL_URL" "ASSISTANT_MODEL" "ASSISTANT_TRANSCRIPTION_MODEL" "ASSISTANT_AUDIO_MAX_BYTES" "ASSISTANT_AUDIO_MIME_TYPES" "ASSISTANT_MAX_TURNS" "ASSISTANT_MAX_CHARS" "ASSISTANT_MAX_TOOL_CALLS" "ASSISTANT_TURNS_PER_MINUTE" "ASSISTANT_CONCURRENCY" "ASSISTANT_RETRY_AFTER_FALLBACK") }}
- name: {{ $key }}
  valueFrom:
    configMapKeyRef:
      name: {{ $cfg }}
      key: {{ $key }}
{{- end }}
{{- end }}
{{- if eq $svc.role "auth" }}
- name: AUTH_DB_URL
  valueFrom:
    secretKeyRef:
      name: {{ $sec }}
      key: AUTH_DB_URL
# Auth is the only service that receives the private half of the keypair.
- name: AUTH_JWT_PRIVATE_KEY
  valueFrom:
    secretKeyRef:
      name: {{ $sec }}
      key: AUTH_JWT_PRIVATE_KEY
- name: AUTH_JWT_PUBLIC_KEY
  valueFrom:
    secretKeyRef:
      name: {{ $sec }}
      key: AUTH_JWT_PUBLIC_KEY
# Auth is the only service that receives the operator private key, exactly as it is
# the only one that receives the user facing one (plan 0071, section 3).
- name: ADMIN_JWT_PRIVATE_KEY
  valueFrom:
    secretKeyRef:
      name: {{ $sec }}
      key: ADMIN_JWT_PRIVATE_KEY
- name: ADMIN_JWT_PUBLIC_KEY
  valueFrom:
    secretKeyRef:
      name: {{ $sec }}
      key: ADMIN_JWT_PUBLIC_KEY
- name: GOOGLE_CLIENT_SECRET
  valueFrom:
    secretKeyRef:
      name: {{ $sec }}
      key: GOOGLE_CLIENT_SECRET
- name: SMTP_PASS
  valueFrom:
    secretKeyRef:
      name: {{ $sec }}
      key: SMTP_PASS
{{- range $key := (list "AUTH_JWT_KID" "ACCESS_TOKEN_TTL" "REFRESH_TOKEN_TTL" "ADMIN_JWT_KID" "ADMIN_ACCESS_TOKEN_TTL" "ADMIN_LOGIN_LOCKOUT_THRESHOLD" "ADMIN_LOGIN_LOCKOUT_WINDOW" "GOOGLE_CLIENT_ID" "GOOGLE_CALLBACK_URL" "SMTP_HOST" "SMTP_PORT" "SMTP_USER" "MAIL_FROM" "MAIL_VERIFY_BASE_URL" "MAIL_RESET_BASE_URL") }}
- name: {{ $key }}
  valueFrom:
    configMapKeyRef:
      name: {{ $cfg }}
      key: {{ $key }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Luna Shopper migration Job env (plan 0002, section 5; the failure below is plan
0045).

Deliberately NOT `lunaShopperBackend.env` above. A migrate.js reads exactly one
variable, its own `<ROLE>_DB_URL`, and the Job that runs it is a pre upgrade
hook, which is what makes handing it the full runtime env actively harmful.

Helm applies hooks BEFORE the chart's own resources, so when this Job's pod is
created the `luna-shopper-backend-config` ConfigMap is still the one the
PREVIOUS release left behind. A release that adds a ConfigMap key and gives it to
a service whose role also migrates therefore dies on a key the chart renders
perfectly well:

  Error: couldn't find key VOICE_COMMENT_MAX_BYTES in ConfigMap
  nx-portfolio/luna-shopper-backend-config
  CreateContainerConfigError, x26 over 10m

which is what staging did when voice comments shipped, retrying for the full ten
minute timeout until --atomic rolled the release back. It is invisible before the
fact: `provision-release.sh --check` compares the render against itself, and in
the render the key is present, so preflight passes and the deploy still fails.

The Secret carries no such hazard, because the chart does not render it.
provision-release.sh creates it out of band before helm runs at all, so a
secretKeyRef in a hook resolves against a Secret that is already current. That is
why the one variable a migration needs is safe to take from there, and why
nothing else is passed.

Anything a migration genuinely needs in future has to come from the Secret for
the same reason. Reaching for a ConfigMap key here brings the failure straight
back.

Call with a dict:
  (dict "svc" <service> "sec" <secretName>)
*/}}
{{- define "lunaShopperBackend.migrationEnv" -}}
{{- $key := printf "%s_DB_URL" (upper .svc.role) -}}
- name: {{ $key }}
  valueFrom:
    secretKeyRef:
      name: {{ .sec }}
      key: {{ $key }}
{{- end -}}
