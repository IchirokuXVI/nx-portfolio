{{- if .Values.lunaShopperBackend.enabled }}
{{- $cfg := .Values.lunaShopperBackend.config }}
---
# One ConfigMap, because this release is one environment (plan 0002). The
# `range $env, $cfg :=` loop that rendered a production and a staging copy side
# by side is gone with the `env` dimension, and so is the `-production` /
# `-staging` suffix on the name: each cluster holds one.
apiVersion: v1
kind: ConfigMap
metadata:
  name: luna-shopper-backend-config
  namespace: {{ .Values.namespace }}
data:
  NATS_URL: {{ $cfg.natsUrl | quote }}
  # The cache, presence store and socket backplane (plan 0028). Not a secret:
  # the instance is cluster local with no auth, exactly like NATS above.
  REDIS_URL: {{ $cfg.redisUrl | quote }}
  LOG_LEVEL: {{ $cfg.logLevel | quote }}
  CORS_ORIGINS: {{ $cfg.corsOrigins | quote }}
  AUTH_JWT_KID: {{ $cfg.authJwtKid | quote }}
  ACCESS_TOKEN_TTL: {{ $cfg.accessTokenTtl | quote }}
  REFRESH_TOKEN_TTL: {{ $cfg.refreshTokenTtl | quote }}
  GOOGLE_CLIENT_ID: {{ $cfg.googleClientId | default "" | quote }}
  GOOGLE_CALLBACK_URL: {{ $cfg.googleCallbackUrl | default "" | quote }}
  # Where the Google callback sends the browser back to (plan 0023, section 3.4).
  # The redirect is built from this and never from anything the client supplied.
  APP_BASE_URL: {{ $cfg.appBaseUrl | default "" | quote }}
  SMTP_HOST: {{ $cfg.smtpHost | default "" | quote }}
  SMTP_PORT: {{ $cfg.smtpPort | quote }}
  SMTP_USER: {{ $cfg.smtpUser | default "" | quote }}
  MAIL_FROM: {{ $cfg.mailFrom | quote }}
  MAIL_VERIFY_BASE_URL: {{ $cfg.mailVerifyBaseUrl | quote }}
  MAIL_RESET_BASE_URL: {{ $cfg.mailResetBaseUrl | quote }}
  # Comma-separated platform-admin (app owner) user ids allowed to write the
  # catalog (plan 0012). Empty by default so no one can write until it is set.
  PLATFORM_ADMIN_USER_IDS: {{ $cfg.platformAdminUserIds | default "" | quote }}
  # Telemetry (plan 0016, section 7). Tracing is off by default because there is
  # no collector in this cluster yet (section 8); with no endpoint a service
  # constructs no exporter and attempts no network call, so it runs exactly as it
  # does today. Point otelExporterEndpoint at a collector and flip otelEnabled to
  # turn it on, with no new image.
  OTEL_ENABLED: {{ $cfg.otelEnabled | default false | quote }}
  OTEL_EXPORTER_OTLP_ENDPOINT: {{ $cfg.otelExporterEndpoint | default "" | quote }}
  # Sampling ratio, 0..1. Parent based, so this only decides at the trace root.
  OTEL_TRACES_SAMPLER_ARG: {{ $cfg.otelSamplerArg | default 1 | quote }}
  # /metrics on each service's health port. On unless explicitly disabled; note
  # `default` cannot express that, because it would turn an intentional `false`
  # back into `true`.
  METRICS_ENABLED: {{ if hasKey $cfg "metricsEnabled" }}{{ $cfg.metricsEnabled | quote }}{{ else }}"true"{{ end }}
{{- end }}
