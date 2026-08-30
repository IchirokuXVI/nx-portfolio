{{- if .Values.lunaShopperBackend.enabled }}
{{- $cfg := .Values.lunaShopperBackend.config }}
{{- $harvest := .Values.lunaShopperBackend.harvester | default dict }}
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
  # The oldest velista build the gateway serves (velista plan 0034). Empty is the
  # resting value and switches it off entirely: no floor advertised, nobody refused.
  MIN_CLIENT_VERSION: {{ $cfg.minClientVersion | default "" | quote }}
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
  # --- The harvester (plan 0038) --------------------------------------------
  #
  # Rendered unconditionally, even with `harvester.enabled` false and no harvester
  # pod in the cluster. That is deliberate: a ConfigMap key costs nothing, and the
  # alternative is a chart where turning the harvester on is two changes in two
  # places with a CreateContainerConfigError in between if you forget one.
  #
  # HARVEST_ENABLED is a SECOND switch, separate from `harvester.enabled`: that one
  # decides whether the pod exists, this one whether it may fetch. Both default
  # false. MERCADONA_ENABLED narrows it again to the one storefront (section 8.1),
  # so the chain can be dropped without dropping the service.
  HARVESTER_ACTOR_ID: {{ $harvest.actorId | default "" | quote }}
  HARVEST_ENABLED: {{ $harvest.harvestEnabled | default false | quote }}
  MERCADONA_ENABLED: {{ $harvest.mercadonaEnabled | default false | quote }}
  # An honest User-Agent naming the app and a contact address, never a browser
  # impersonation.
  HARVEST_USER_AGENT: {{ $harvest.userAgent | default "" | quote }}
  # Two knobs, two jobs: workers bound concurrency, the rate bounds our impact on
  # the source, and one shared token bucket is what keeps them independent.
  HARVEST_DEFAULT_WORKERS: {{ $harvest.defaultWorkers | default 4 | quote }}
  HARVEST_DEFAULT_MAX_RPS: {{ $harvest.defaultMaxRps | default 4 | quote }}
  HARVEST_BATCH_SIZE: {{ $harvest.batchSize | default 200 | quote }}
  HARVEST_STALE_AFTER: {{ $harvest.staleAfterSeconds | default 900 | quote }}
  HARVEST_FAILURE_RATIO: {{ $harvest.failureRatio | default "0.25" | quote }}
  OVERPASS_URL: {{ $harvest.overpassUrl | default "" | quote }}
  NOMINATIM_URL: {{ $harvest.nominatimUrl | default "" | quote }}
{{- end }}
