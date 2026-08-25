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
{{- end }}
{{- end }}
{{- end }}
