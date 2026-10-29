{{- if .Values.lunaShopperBackend.enabled }}
{{- $cfg := .Values.lunaShopperBackend.config }}
{{- $harvest := .Values.lunaShopperBackend.harvester | default dict }}
{{- $assistant := .Values.lunaShopperBackend.assistant | default dict }}
{{- $transcriber := .Values.lunaShopperBackend.transcriber | default dict }}
---
# One ConfigMap, because this release is one environment (plan 0002). The
# `range $env, $cfg :=` loop that rendered a production and a staging copy side
# by side is gone with the `env` dimension, and so is the `-production` /
# `-staging` suffix on the name: each cluster holds one.
apiVersion: v1
kind: ConfigMap
metadata:
  name: luna-shopper-backend-config
  namespace: {{ .Release.Namespace }}
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
  # Support sessions (plan 0194): an operator opens the app as a user. Auth
  # alone enforces it. The gateway reads the same key only to report it to the
  # privacy policy (plan 0231), so the two cannot disagree. False unless the
  # values file of the environment says true. Staging says true. Production
  # does not name it, and stays off until the owner turns it on, after the
  # privacy policy names support access.
  IMPERSONATION_ENABLED: {{ $cfg.impersonationEnabled | default false | quote }}
  # --- The legal documents (plan 0231, section 5.3) --------------------------
  #
  # The shape of this deployment, fine to commit. Who runs it is NOT here: the
  # operator's values come from lunaShopperBackend.legal or the operator
  # Secret, per key, in _env.tpl. Auth and the gateway both read the switch.
  TERMS_ACCEPTANCE_REQUIRED: {{ $cfg.termsAcceptanceRequired | default false | quote }}
  # True exactly where the backup CronJobs run nightly.
  LEGAL_OFFSITE_BACKUPS: {{ and .Values.lunaShopperBackend.backups.enabled (not .Values.lunaShopperBackend.backups.suspend) | quote }}
  {{- /*
  The three periods in days. Not `default`: Sprig reads 0 as empty, so an
  explicit 0 would render the default, and the policy would state a period that
  k8s plan 0018 does not enforce. Only an absent or null key falls back. A Go
  template comment, so the render (and the config checksum) stays as it was.
  */}}
  {{- $legalDays := $cfg.legal | default dict }}
  {{- $backupDays := .Values.lunaShopperBackend.backups.retentionDays }}
  LEGAL_BACKUP_RETENTION_DAYS: {{ if kindIs "invalid" $backupDays }}"14"{{ else }}{{ $backupDays | quote }}{{ end }}
  LEGAL_APPLICATION_LOG_DAYS: {{ if kindIs "invalid" $legalDays.applicationLogDays }}"30"{{ else }}{{ $legalDays.applicationLogDays | quote }}{{ end }}
  LEGAL_ASSISTANT_LOG_DAYS: {{ if kindIs "invalid" $legalDays.assistantLogDays }}"7"{{ else }}{{ $legalDays.assistantLogDays | quote }}{{ end }}
  # The retention periods (plan 0233). Auth, core and catalog enforce them,
  # and the gateway reports them to the privacy policy.
  RETENTION_AUDIT: {{ ($cfg.retention | default dict).audit | default "180d" | quote }}
  RETENTION_ADMIN_LOGIN_FAILURES: {{ ($cfg.retention | default dict).adminLoginFailures | default "90d" | quote }}
  RETENTION_EXPIRED_GRANTS: {{ ($cfg.retention | default dict).expiredGrants | default "14d" | quote }}
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
  # 120 seconds because it must outlast the assistant's own deadline for a
  # comment, TRANSCRIBER_COMMENT_TIMEOUT_MS below (plan 0235, section 6.2).
  VOICE_COMMENT_TRANSCRIBE_TIMEOUT_MS: {{ $cfg.voiceCommentTranscribeTimeoutMs | default 120000 | quote }}
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
  # false. Which chains may be fetched is not a switch here: it is a row per chain
  # in the harvester's own database, off by default, written from the back office
  # (plan 0083), so adding a chain never touches this file.
  #
  # HARVEST_SCHEDULER_ENABLED (plan 0206) decides whether a due schedule starts
  # its preset with nobody asking. A tick needs it and HARVEST_ENABLED both.
  # False by default and on in production only, so two clusters never fetch one
  # chain on one timer.
  #
  # HARVESTER_ACTOR_ID is not here either, for the reason SERVICE_ACTOR_IDS is
  # not (plan 0081, section 11): it is the same uuid, `provision-release.sh`
  # generates it once per cluster, and the Secret is the only per environment
  # store that script owns.
  HARVEST_ENABLED: {{ $harvest.harvestEnabled | default false | quote }}
  HARVEST_SCHEDULER_ENABLED: {{ $harvest.schedulerEnabled | default false | quote }}
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
  # a restart. Empty means the default of the provider that answers (plan 0224,
  # section 5): the default moved into the service because it depends on
  # ASSISTANT_PROVIDER, and a Gemini name written here would reach Claude the day
  # the switch flips.
  GATEWAY_INTERNAL_URL: {{ $assistant.gatewayInternalUrl | default (printf "http://luna-shopper-backend-gateway.%s.svc.cluster.local" .Release.Namespace) | quote }}
  ASSISTANT_MODEL: {{ $assistant.model | default "" | quote }}
  # Which provider answers a turn (plan 0224). Neither hears: the transcriber
  # below does (plan 0235). Empty effort and
  # thinking mean the service's own defaults (Haiku, adaptive thinking, effort
  # low), which the evaluation of 2026-10-22 chose.
  ASSISTANT_PROVIDER: {{ $assistant.provider | default "gemini" | quote }}
  ASSISTANT_CLAUDE_EFFORT: {{ $assistant.claudeEffort | default "" | quote }}
  ASSISTANT_CLAUDE_THINKING: {{ $assistant.claudeThinking | default "" | quote }}
  # Voice input (plan 0235). The transcriber's address exactly when the chart
  # runs it, and empty otherwise, so the one value `transcriber.enabled` decides
  # whether the assistant hears and what `hears` reports (plan 0231, section 3).
  # Empty is a supported deployment: the voice route answers 501 and a voice
  # comment settles UNAVAILABLE.
  TRANSCRIBER_URL: {{ if $transcriber.enabled }}{{ printf "http://luna-shopper-backend-transcriber:%v" ($transcriber.port | default 3007 | int) | quote }}{{ else }}""{{ end }}
  # How long the assistant waits on a transcription, the transcriber's queue
  # included (plan 0235, section 6.2). Written whether or not it runs, so the
  # keys every assistant pod refers to always exist.
  TRANSCRIBER_TURN_TIMEOUT_MS: {{ $transcriber.turnTimeoutMs | default 45000 | int64 | quote }}
  TRANSCRIBER_COMMENT_TIMEOUT_MS: {{ $transcriber.commentTimeoutMs | default 110000 | int64 | quote }}
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
  # How long one whole turn may run before the loop stops rather than calling
  # another tool. It is one decision with the assistant's `slowPaths` timeout on
  # the gateway route, which must stay above this plus a provider timeout: the
  # deadline stops new work and does not abort a call in flight, and a proxy that
  # gives up first is what let the assistant write lines after the app had told
  # its reader that nothing arrived. Raise one and raise the other.
  ASSISTANT_TURN_TIMEOUT_MS: {{ $assistant.turnTimeoutMs | default 60000 | quote }}
{{- end }}
