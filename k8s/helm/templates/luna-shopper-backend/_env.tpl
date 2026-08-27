{{/*
Luna Shopper container env (plan 0002, section 1 and 5).

Emits the env vars a backend service needs, chosen by its `role`, so each pod
receives only what it should: only the auth pod ever gets the JWT private key,
the DB URLs stay with the service that owns the database, etc. Non secret values
come from the per environment ConfigMap; secret values from the per environment
Secret.

Call with a dict:
  (dict "svc" <service> "cfg" <configMapName> "sec" <secretName>
        "env" <production|staging> "tag" <imageTag>)
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
# role rather than the deployment name (a staging pod is the same service, told
# apart by deployment.environment), and the version is the image tag already
# being deployed. The switches come from the per environment ConfigMap and are
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
{{- range $key := (list "GOOGLE_CLIENT_ID" "GOOGLE_CALLBACK_URL" "APP_BASE_URL") }}
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
