{{- if .Values.lunaShopperBackend.enabled }}
{{- range $env, $cfg := .Values.lunaShopperBackend.config }}
{{- if or (ne $env "staging") $.Values.staging.enabled }}
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: luna-shopper-backend-config-{{ $env }}
  namespace: {{ $.Values.namespace }}
data:
  NATS_URL: {{ $cfg.natsUrl | quote }}
  LOG_LEVEL: {{ $cfg.logLevel | quote }}
  CORS_ORIGINS: {{ $cfg.corsOrigins | quote }}
  AUTH_JWT_KID: {{ $cfg.authJwtKid | quote }}
  ACCESS_TOKEN_TTL: {{ $cfg.accessTokenTtl | quote }}
  REFRESH_TOKEN_TTL: {{ $cfg.refreshTokenTtl | quote }}
  GOOGLE_CLIENT_ID: {{ $cfg.googleClientId | quote }}
  GOOGLE_CALLBACK_URL: {{ $cfg.googleCallbackUrl | quote }}
  SMTP_HOST: {{ $cfg.smtpHost | quote }}
  SMTP_PORT: {{ $cfg.smtpPort | quote }}
  SMTP_USER: {{ $cfg.smtpUser | quote }}
  MAIL_FROM: {{ $cfg.mailFrom | quote }}
  MAIL_VERIFY_BASE_URL: {{ $cfg.mailVerifyBaseUrl | quote }}
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
{{- end }}
{{- end }}
