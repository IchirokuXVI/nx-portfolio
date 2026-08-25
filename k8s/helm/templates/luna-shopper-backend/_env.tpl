{{/*
Luna Shopper container env (plan 0002, section 1 and 5).

Emits the env vars a backend service needs, chosen by its `role`, so each pod
receives only what it should: only the auth pod ever gets the JWT private key,
the DB URLs stay with the service that owns the database, etc. Non secret values
come from the per environment ConfigMap; secret values from the per environment
Secret.

Call with a dict: (dict "svc" <service> "cfg" <configMapName> "sec" <secretName>)
*/}}
{{- define "lunaShopperBackend.env" -}}
{{- $svc := .svc -}}
{{- $cfg := .cfg -}}
{{- $sec := .sec -}}
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
{{- range $key := (list "AUTH_JWT_KID" "ACCESS_TOKEN_TTL" "REFRESH_TOKEN_TTL" "GOOGLE_CLIENT_ID" "GOOGLE_CALLBACK_URL" "SMTP_HOST" "SMTP_PORT" "SMTP_USER" "MAIL_FROM" "MAIL_VERIFY_BASE_URL") }}
- name: {{ $key }}
  valueFrom:
    configMapKeyRef:
      name: {{ $cfg }}
      key: {{ $key }}
{{- end }}
{{- end }}
{{- end }}
