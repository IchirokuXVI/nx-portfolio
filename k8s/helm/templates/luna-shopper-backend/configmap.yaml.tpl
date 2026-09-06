{{- if .Values.lunaShopperBackend.enabled }}
{{- $cfg := .Values.lunaShopperBackend.config }}
{{- $harvest := .Values.lunaShopperBackend.harvester | default dict }}
{{- $assistant := .Values.lunaShopperBackend.assistant | default dict }}
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
  # The operator identity (plan 0071). Its own kid, so a verification failure says
  # which key was expected rather than only "invalid signature", and its own TTL,
  # because the admin session holds no refresh token and renews itself while it is
  # still valid.
  ADMIN_JWT_KID: {{ $cfg.adminJwtKid | quote }}
  ADMIN_ACCESS_TOKEN_TTL: {{ $cfg.adminAccessTokenTtl | quote }}
  # Lockout (plan 0071, section 7). Separate from the gateway's throttling because
  # throttling limits a source and this protects an account: one admin username is
  # a far better brute force target than a user base.
  ADMIN_LOGIN_LOCKOUT_THRESHOLD: {{ $cfg.adminLoginLockoutThreshold | quote }}
  ADMIN_LOGIN_LOCKOUT_WINDOW: {{ $cfg.adminLoginLockoutWindow | quote }}
  # What the back office renders its accent colour from, read back through
  # GET /v1/admin/auth/me. Set per environment, in the values file, and nowhere
  # else: a build time constant is exactly what is wrong when the failure being
  # guarded against is believing you are in staging when you are in production.
  ENVIRONMENT_NAME: {{ $cfg.environmentName | quote }}
{{- /*
The development autologin is deliberately ABSENT from this ConfigMap, in every
environment. It signs an operator in with no password; auth refuses to boot with
it on against a non local database, and `provision-release.sh --check` greps the
whole render for its name and refuses the deploy if it appears anywhere (plan
0071, section 8).

A Go template comment rather than a YAML one, because a YAML comment would be
part of the render and would trip that very check.
*/}}
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
  # SERVICE_ACTOR_IDS and HARVESTER_ACTOR_ID ARE NOT HERE (plan 0081, section
  # 11). They are the same uuid, naming the one SERVICE allowed to write the
  # catalog with no token (plan 0072, section 4), and `provision-release.sh`
  # generates it once per cluster into the per environment Secret: this
  # ConfigMap belongs to the chart, and a helm upgrade would overwrite anything
  # written into it.
  #
  # That list replaced `PLATFORM_ADMIN_USER_IDS` and is not the same list under
  # a new name: an admin is now proved by a signature and cannot be granted from
  # a ConfigMap at all. What is left names machines, which is why a plain uuid
  # is still enough and why moving it into a Secret is storage rather than
  # secrecy.
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
  # --- Voice comments (plan 0045) -------------------------------------------
  #
  # Both the gateway and core receive these two, and the duplication is the design
  # rather than an oversight: the gateway's copy sets the limit on the multipart
  # interceptor, which is the only place a byte cap is actually a cap, and core's
  # copy stops a payload that reached the broker some other way being written to
  # the database. One ConfigMap key feeds both, so they cannot disagree.
  #
  # The content type list is empty by default and falls back to the contract's own
  # list, which is what browsers actually produce: WebM/Opus from Chrome,
  # Ogg/Opus from Firefox, MP4/AAC from Safari. Set it only to tighten.
  VOICE_COMMENT_MAX_BYTES: {{ $cfg.voiceCommentMaxBytes | default 2097152 | quote }}
  VOICE_COMMENT_CONTENT_TYPES: {{ $cfg.voiceCommentContentTypes | default "" | quote }}
  # How long the gateway waits for a transcript it is not holding a request open
  # for. The comment is already stored and playable; this only stops a hung
  # provider holding a task behind a request that was answered.
  VOICE_COMMENT_TRANSCRIBE_TIMEOUT_MS: {{ $cfg.voiceCommentTranscribeTimeoutMs | default 45000 | quote }}
  # --- The file import (plan 0086, section 10) -------------------------------
  #
  # The one route on this gateway with a body limit of its own. Nest's JSON
  # parser defaults to 100 KB and this gateway configured none, so every real
  # leaflet (337 KB and 349 KB for the two committed extractions) was refused
  # with a bare 413 before the route existed. The app is now created with no
  # built in parser and mounts this path's own ahead of the default one.
  #
  # 10 MB, because the file is no longer only a leaflet: a finished walk of a
  # chain's 4,232 products exports one, and a cluster that is not allowed to
  # crawl imports it. Gateway only, and the **broker had to be raised with it**:
  # the document crosses whole inside `harvest.spawn`, so `nats.maxPayload` is
  # 16 MB rather than the 8 MB this would have sat against.
  HARVESTER_FILE_IMPORT_MAX_BYTES: {{ $cfg.fileImportMaxBytes | default 10485760 | quote }}
  # --- The harvester (plan 0038) --------------------------------------------
  #
  # Rendered unconditionally, even with `harvester.enabled` false and no harvester
  # pod in the cluster. That is deliberate: a ConfigMap key costs nothing, and the
  # alternative is a chart where turning the harvester on is two changes in two
  # places with a CreateContainerConfigError in between if you forget one.
  #
  # HARVEST_ENABLED is a SECOND switch, separate from `harvester.enabled`: that one
  # decides whether the pod exists, this one whether it may fetch. Both default
  # false. There is no third: which chains may be fetched is a row per chain in
  # the harvester's own database, off by default, written from the back office
  # (plan 0083), so adding a chain never touches this file.
  #
  # HARVESTER_ACTOR_ID is not here either, for the reason SERVICE_ACTOR_IDS is
  # not (plan 0081, section 11): it is the same uuid, `provision-release.sh`
  # generates it once per cluster, and the Secret is the only per environment
  # store that script owns.
  HARVEST_ENABLED: {{ $harvest.harvestEnabled | default false | quote }}
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
  # The postal code discovery queue (plan 0063). The radius here is NOT the
  # profile expansion radius in core: that one decides which codes a person shops
  # in, this one how far around a code's centre to look for shops.
  HARVEST_DISCOVERY_RADIUS: {{ $harvest.discoveryRadiusMetres | default 5000 | quote }}
  HARVEST_DISCOVERY_COOLDOWN_DAYS: {{ $harvest.discoveryCooldownDays | default 30 | quote }}
  HARVEST_DISCOVERY_MAX_ATTEMPTS: {{ $harvest.discoveryMaxAttempts | default 3 | quote }}
  HARVEST_DISCOVERY_POLL_SECONDS: {{ $harvest.discoveryPollSeconds | default 60 | quote }}
  OVERPASS_URL: {{ $harvest.overpassUrl | default "" | quote }}
  NOMINATIM_URL: {{ $harvest.nominatimUrl | default "" | quote }}
  # Public, and shipped in LIDL's own store search bundle (plan 0089, section
  # 10). Empty means the value the library carries; a 401 means it rotated.
  LIDL_STORES_API_KEY: {{ $harvest.lidlStoresApiKey | default "" | quote }}
  # --- The assistant (plan 0039) ---------------------------------------------
  #
  # GATEWAY_INTERNAL_URL is where the assistant calls the app's own API on the
  # caller's behalf (rule A1). The cluster's internal service name, never the
  # public `api.` host: going out and back in would pay for TLS and the ingress
  # for a call that never leaves the cluster, and would put a user's turn through
  # the edge twice.
  #
  # The model is a value rather than a literal, so changing it is an env edit and
  # a restart. `gemini-3.1-flash-lite` is the first thing to try if quality
  # disappoints, and the version numbers do not order those two the way they look.
  GATEWAY_INTERNAL_URL: {{ $assistant.gatewayInternalUrl | default (printf "http://luna-shopper-backend-gateway.%s.svc.cluster.local" .Values.namespace) | quote }}
  ASSISTANT_MODEL: {{ $assistant.model | default "gemini-3.5-flash-lite" | quote }}
  # Voice input (plan 0041). The transcription model is its own key so a different
  # model can do that job than answers the turn without a code change; empty means
  # the same one, which is the default and the only setting anybody has evidence
  # for yet.
  ASSISTANT_TRANSCRIPTION_MODEL: {{ $assistant.transcriptionModel | default "" | quote }}
  # The byte cap on a recording, before base64. The gateway's multipart
  # interceptor enforces the same number on the upload; this one is applied to
  # what actually crossed the broker, because a cap the client could have chosen
  # is not a cap.
  # `int64` before `quote`, for the same reason the NATS template needs it: Sprig
  # carries a YAML integer as a float64, so `quote` alone writes 2097152 as
  # "2.097152e+06" into the ConfigMap.
  ASSISTANT_AUDIO_MAX_BYTES: {{ $assistant.audioMaxBytes | default 2097152 | int64 | quote }}
  # Containers this deployment will forward to the provider. A recording in
  # anything else is refused with a sentence, and the type is named in the log so
  # somebody can add it here rather than in a stack trace.
  ASSISTANT_AUDIO_MIME_TYPES: {{ $assistant.audioMimeTypes | default "audio/webm,audio/ogg,audio/mp4,audio/wav,audio/mpeg,audio/aac,audio/flac" | quote }}
  # Caps on the client supplied transcript. The service stores nothing between
  # turns (rule A2), so the whole conversation arrives on every request and is
  # untrusted input: these are applied on arrival, not trusted from the client.
  ASSISTANT_MAX_TURNS: {{ $assistant.maxTurns | default 20 | quote }}
  ASSISTANT_MAX_CHARS: {{ $assistant.maxChars | default 8000 | quote }}
  ASSISTANT_MAX_TOOL_CALLS: {{ $assistant.maxToolCalls | default 6 | quote }}
  # Both per instance and in memory: neither survives a restart and neither is
  # shared across replicas (section 9). A known weakness, written down rather than
  # discovered later; fixing it properly needs storage this plan declines.
  ASSISTANT_TURNS_PER_MINUTE: {{ $assistant.turnsPerMinute | default 8 | quote }}
  ASSISTANT_CONCURRENCY: {{ $assistant.concurrency | default 2 | quote }}
  # The floor for `retryAfterSeconds` when neither the provider's own RetryInfo
  # nor the local window can supply one, so the field is never absent (rule A5).
  ASSISTANT_RETRY_AFTER_FALLBACK: {{ $assistant.retryAfterFallbackSeconds | default 30 | quote }}
{{- end }}
