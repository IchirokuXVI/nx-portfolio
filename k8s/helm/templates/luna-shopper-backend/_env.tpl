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
Voice comments (plan 0045). The gateway holds the cap because it holds the
multipart interceptor, and a byte cap that is not on the interceptor is not a cap:
the global ValidationPipe never sees a file and Express's body limits do not apply
to a multipart stream. Core receives the same two keys and checks them again.
*/}}
{{- range $key := (list "GOOGLE_CLIENT_ID" "GOOGLE_CALLBACK_URL" "APP_BASE_URL" "MIN_CLIENT_VERSION" "VOICE_COMMENT_MAX_BYTES" "VOICE_COMMENT_CONTENT_TYPES" "VOICE_COMMENT_TRANSCRIBE_TIMEOUT_MS") }}
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
# The platform-admin allowlist (the app owner) that may write the catalog.
- name: PLATFORM_ADMIN_USER_IDS
  valueFrom:
    configMapKeyRef:
      name: {{ $cfg }}
      key: PLATFORM_ADMIN_USER_IDS
{{- end }}
{{- if eq $svc.role "harvester" }}
# The harvester (plan 0038). It owns the third database, verifies tokens offline
# with the auth public key like catalog does, and gates EVERY subject it exposes
# on the platform admin allowlist rather than only its writes.
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
{{- range $key := (list "PLATFORM_ADMIN_USER_IDS" "HARVESTER_ACTOR_ID" "HARVEST_ENABLED" "HARVEST_USER_AGENT" "HARVEST_BATCH_SIZE" "HARVEST_DEFAULT_WORKERS" "HARVEST_DEFAULT_MAX_RPS" "HARVEST_STALE_AFTER" "HARVEST_FAILURE_RATIO" "MERCADONA_ENABLED" "OVERPASS_URL" "NOMINATIM_URL") }}
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
{{- range $key := (list "GATEWAY_INTERNAL_URL" "ASSISTANT_MODEL" "ASSISTANT_MAX_TURNS" "ASSISTANT_MAX_CHARS" "ASSISTANT_MAX_TOOL_CALLS" "ASSISTANT_TURNS_PER_MINUTE" "ASSISTANT_CONCURRENCY" "ASSISTANT_RETRY_AFTER_FALLBACK") }}
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
{{- range $key := (list "AUTH_JWT_KID" "ACCESS_TOKEN_TTL" "REFRESH_TOKEN_TTL" "GOOGLE_CLIENT_ID" "GOOGLE_CALLBACK_URL" "SMTP_HOST" "SMTP_PORT" "SMTP_USER" "MAIL_FROM" "MAIL_VERIFY_BASE_URL" "MAIL_RESET_BASE_URL") }}
- name: {{ $key }}
  valueFrom:
    configMapKeyRef:
      name: {{ $cfg }}
      key: {{ $key }}
{{- end }}
{{- end }}
{{- end }}
