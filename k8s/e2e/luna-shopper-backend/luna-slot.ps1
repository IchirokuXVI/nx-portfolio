<#
.SYNOPSIS
  Configure this checkout (a git worktree, usually) to run the Luna Shopper
  backend on an isolated "slot", so several worktrees can run the compose stack
  and `nx serve` the five services at once without colliding on ports, container
  names, or databases. PowerShell twin of luna-slot.sh.

.EXAMPLE
  ./k8s/e2e/luna-shopper-backend/luna-slot.ps1 1       # configure for slot 1
  ./k8s/e2e/luna-shopper-backend/luna-slot.ps1 -Auto   # ...or the lowest free one
  ./k8s/e2e/luna-shopper-backend/luna-slot.ps1 -Up     # configure if needed, start it all
  ./k8s/e2e/luna-shopper-backend/luna-slot.ps1 -Down   # stop it all
  ./k8s/e2e/luna-shopper-backend/luna-slot.ps1 -List   # every worktree's slot, and what is live

.DESCRIPTION
  A slot is an integer N. The compose project (its containers, network, and named
  volumes) is "luna-slot<N>".

  Slot 0 keeps exactly the historic ports (gateway 3000, auth-db 5432, nats 4222,
  and the rest) and the "luna-shopper-backend" project name, so a lone worktree
  needs no slot and nothing here changes it.

  Every other slot gets a 100 port block up in the 43000s: slot 1 is 43000..43054,
  slot 2 is 43100..43154, and so on. That is a change from `default + N*100`, which
  scattered a slot across 5532, 4322, 6479, 1125 and 16786, most of them in the
  range everything else on the machine also wants, so slots collided with other
  software instead of with each other.

  tools/dev/ng-slot.ps1 does the same for the Angular apps, but the two numbers are
  INDEPENDENT and must not be assumed equal. A front end on slot 5 may point at
  this backend on slot 1, or 2, or 8, and several front end slots may point at ONE
  backend at the same time. The common case is exactly that: nobody is changing the
  backend, one instance is up, and every front end worktree uses it.

  Two consequences, pulling in opposite directions. CORS_ORIGINS is a LIST, so it
  names every front end slot's two origins rather than this slot's: a backend has
  no way to know which front ends will call it, and an origin it was not told about
  fails with a CORS error that says nothing about slots. APP_BASE_URL and the two
  MAIL_*_BASE_URL are SINGULAR, because a redirect can only have one target, so
  they name one front end, chosen with -AppSlot (default 0, the shared front end).
  Only the OAuth and mail round trips care; ordinary API calls from any slot work
  regardless.

  (Re)writes, all git ignored: .env.slot (compose),
  apps/luna-shopper-backend/.env.luna-shopper-backend, each service .env, the dev
  JWT keypair (generated once if absent), and .run (logs and pids of what -Up
  started). Idempotent.

  -Up and -Down delegate the compose stack and the migrations to stack.sh, which
  already does them properly, so they need Git Bash on PATH. Everything else here
  is pure PowerShell.
#>
[CmdletBinding()]
param(
  [Parameter(Position = 0)][string]$Slot,
  [switch]$List,
  [switch]$Up,
  [switch]$Restart,
  [switch]$Down,
  [switch]$Auto,
  [Alias('p','Profile')][string]$ComposeProfile,
  [string]$Services,
  [int]$AppSlot = -1,
  [switch]$KeepData,
  [int]$Timeout = 180
)

$ErrorActionPreference = 'Stop'

$here = $PSScriptRoot
$root = (Resolve-Path (Join-Path $here '..\..\..')).Path
$slotEnv = Join-Path $here '.env.slot'
$runDir = Join-Path $here '.run'
$probe = Join-Path $root 'tools/dev/probe-ports.mjs'

# The five Nest services, in the order -Up starts them. Their ports are not passed
# on the command line: each reads PORT out of its own .env, which this script wrote
# for this slot, so there is one place a port can be wrong.
$serviceNames = @('gateway', 'realtime', 'auth', 'core', 'catalog', 'assistant')

# How high -Auto and -List will look. See the same constant in ng-slot.ps1.
$maxSlot = 9

# -Auto never takes slot 0. parallel-worktree-testing.md has said so since it was
# written: slot 0 is the developer's own stack, on the ports their tools and their
# browser already point at, so a worker that took it would collide with the one
# checkout that cannot move. `luna-slot.ps1 0` is still accepted, because asking for
# it explicitly means it.
$minAutoSlot = 1

# Which front end slot the singular URLs (the Google callback, the mail links)
# point at when nobody says. Slot 0 is the developer's own front end, the one a
# shared backend is most likely to be driven from. A default, not an assumption
# about who may call: CORS allows every slot regardless.
$defaultAppSlot = 0

# The port an Angular app gets on a front end slot.
#
# It restates tools/dev/ng-slot.ps1's arithmetic, which is a duplication worth being
# explicit about: this script has to know the front end's ports (to allow their
# origins, and to aim the redirects), the two scripts are independent entry points
# with no shared library between them, and a function cannot be imported from a
# different tool without turning one into a dependency of the other. Both files name
# the same two constants and both say so; if either band moves, this moves with it.
# The two -List outputs printing different numbers for one slot is the symptom of
# getting it wrong.
$frontendSlotBand = 42000
$frontendDefaultPort = @{ shell = 4200; velista = 4205 }
$frontendSlotOffset = @{ shell = 0; velista = 5 }

function Get-FrontendPort([string]$app, [int]$slot) {
  if ($slot -eq 0) { return $frontendDefaultPort[$app] }
  return $frontendSlotBand + ($slot - 1) * 100 + $frontendSlotOffset[$app]
}

# Every origin any front end slot can serve on, as one comma separated list.
#
# Not this slot's, and not a guess at which front end will call: the numbering is
# independent, and several front end slots may point at one backend at the same
# time. `enableCors` is handed this as an array of exact origins, with no wildcard,
# so a missing origin is a request that fails. Twenty entries in a git ignored dev
# file is a cheap way to never think about it again. Production is unaffected: it
# gets CORS_ORIGINS from the chart, not from here.
function Get-FrontendOrigins {
  $origins = @()
  for ($slot = 0; $slot -le $maxSlot; $slot++) {
    $origins += "http://localhost:$(Get-FrontendPort 'shell' $slot)"
    $origins += "http://localhost:$(Get-FrontendPort 'velista' $slot)"
  }
  return ($origins -join ',')
}

# One table and one function, so every caller derives ports the same way.
#
# Slot 0 is exactly the historic ports, and nothing here may change them: they are
# the developer's own, the ones their tools, their Postman environment and their
# running containers already point at.
#
# Every other slot gets a 100 port block up in the 43000s. It used to be
# `default + N*100`, which scattered a slot across 5532, 4322, 6479, 1125, 8125,
# 3100 and 16786, most of them in the range everything else on a developer machine
# also wants, so slots collided with other software instead of with each other.
#
# 43000 is chosen against what this machine actually reserves rather than by feel.
# `netsh int ipv4 show dynamicport tcp` puts the Windows ephemeral range at 49152
# and up, and `netsh int ipv4 show excludedportrange protocol=tcp` puts every
# Hyper-V and WSL reservation at 50000 and up. So 40000..48000 is clear of both, and
# 43000 sits above the front end's 42000 band (tools/dev/ng-slot.ps1) with room for
# nine slots on each side.
#
# The offsets group by kind so a block stays readable: services at +0, databases at
# +10, messaging at +20, cache at +30, mail at +40, observability at +50.
$defaultPort = @{
  gateway = 3000; realtime = 3001; auth = 3002; core = 3003; catalog = 3004
  assistant = 3006
  auth_db = 5432; core_db = 5433; catalog_db = 5434
  nats = 4222; nats_mon = 8222
  redis = 6379
  smtp = 1025; mailpit = 8025
  otlp_grpc = 4317; otlp_http = 4318; jaeger = 16686; prometheus = 9090; grafana = 3010
}
$lunaSlotBand = 43000
$slotOffset = @{
  gateway = 0; realtime = 1; auth = 2; core = 3; catalog = 4
  assistant = 6
  auth_db = 10; core_db = 11; catalog_db = 12
  nats = 20; nats_mon = 21
  redis = 30
  smtp = 40; mailpit = 41
  otlp_grpc = 50; otlp_http = 51; jaeger = 52; prometheus = 53; grafana = 54
}

function Get-SlotProject([int]$slot) {
  # Slot 0 keeps the historic name so the no-slot workflow still matches.
  if ($slot -eq 0) { return 'luna-shopper-backend' }
  return "luna-slot$slot"
}

# The port one thing gets on one slot.
function Get-LunaPort([string]$name, [int]$slot) {
  if ($slot -eq 0) { return $defaultPort[$name] }
  return $lunaSlotBand + ($slot - 1) * 100 + $slotOffset[$name]
}

# The infrastructure compose brings up. `--wait` covers all of it, so a slot with
# some of these open and some closed is genuinely half started.
function Get-InfraPorts([int]$slot) {
  $ports = @()
  foreach ($name in @('auth_db', 'core_db', 'catalog_db', 'nats', 'nats_mon', 'redis', 'smtp', 'mailpit')) {
    $ports += (Get-LunaPort $name $slot)
  }
  return $ports
}

function Get-ServicePorts([int]$slot) {
  $ports = @()
  foreach ($name in $serviceNames) { $ports += (Get-LunaPort $name $slot) }
  return $ports
}

# Reserved per slot whether or not the `observability` profile is up, so two
# worktrees can each run a collector. Deliberately NOT counted when deciding whether
# a slot is up: the profile is opt in, and counting it would report every healthy
# slot as partial.
function Get-ObservabilityPorts([int]$slot) {
  $ports = @()
  foreach ($name in @('otlp_grpc', 'otlp_http', 'jaeger', 'prometheus', 'grafana')) {
    $ports += (Get-LunaPort $name $slot)
  }
  return $ports
}

function Get-SlotPorts([int]$slot) {
  return (Get-InfraPorts $slot) + (Get-ServicePorts $slot) + (Get-ObservabilityPorts $slot)
}

# port -> open|closed|unknown, for a batch of ports in one node process. See the
# header of tools/dev/probe-ports.mjs for why this is not netstat.
function Get-PortStates([int[]]$ports) {
  $states = @{}
  if ($ports.Count -eq 0) { return $states }
  foreach ($line in (& node $probe @ports)) {
    $parts = $line -split "`t"
    if ($parts.Count -eq 2) { $states[[int]$parts[0]] = $parts[1] }
  }
  return $states
}

function Get-WorktreePaths {
  $paths = @()
  foreach ($line in (& git worktree list --porcelain 2>$null)) {
    if ($line -like 'worktree *') { $paths += $line.Substring(9).Trim() }
  }
  return $paths
}

# The slot a checkout is configured for, or $null.
#
# LUNA_SLOT is written by this script. The COMPOSE_PROJECT_NAME fallback is for a
# .env.slot generated before that line existed: the project name has always encoded
# the slot, so an older file stays readable rather than becoming silently invisible
# to -List, which would be the worst way to lose a collision.
function Get-WorktreeSlot([string]$worktree) {
  $file = Join-Path $worktree 'k8s/e2e/luna-shopper-backend/.env.slot'
  if (-not (Test-Path $file)) { return $null }

  $project = $null
  foreach ($line in (Get-Content $file)) {
    if ($line -match '^LUNA_SLOT=(\d+)\s*$') { return [int]$Matches[1] }
    if ($line -match '^COMPOSE_PROJECT_NAME=(\S+)\s*$') { $project = $Matches[1] }
  }
  if ($project -eq 'luna-shopper-backend') { return 0 }
  if ($project -match '^luna-slot(\d+)$') { return [int]$Matches[1] }
  return $null
}

function Read-SlotConfig {
  if (-not (Test-Path $slotEnv)) { return $null }
  $config = @{}
  foreach ($line in (Get-Content $slotEnv)) {
    if ($line -match '^([A-Z0-9_]+)=(.*)$') { $config[$Matches[1]] = $Matches[2].Trim() }
  }
  if (-not $config.ContainsKey('LUNA_SLOT')) { return $null }
  return $config
}

function Write-EnvFile($path, $content) {
  Set-Content -Path $path -Value $content -Encoding utf8 -NoNewline
}

# -AppSlot if given, else the front end this worktree already points its redirects
# at, so re-running the script to move backend slots does not quietly reset a
# choice somebody made. Falls back to the default only on a fresh checkout.
function Resolve-AppSlot {
  if ($AppSlot -ge 0) { return $AppSlot }
  $config = Read-SlotConfig
  if ($null -ne $config -and $config.ContainsKey('LUNA_APP_SLOT')) {
    return [int]$config['LUNA_APP_SLOT']
  }
  return $defaultAppSlot
}

# Telemetry (plan 0016), written into every service's own .env rather than the
# shared file. That placement is load bearing, not tidiness: the SDK starts from
# process.env before Nest exists (section 4.1), and only @nestjs/config ever reads
# .env.luna-shopper-backend, whose custom name nothing else knows. Nx does load
# {projectRoot}/.env into the environment of that project's tasks, so a variable put
# here reaches the SDK under `nx serve`; the same variable in the shared file would
# be read too late and silently ignored.
function Get-TelemetryEnv($service, $otlpHttp) {
  return @"

# --- Telemetry (plan 0016) ---------------------------------------------------
# Read by the OpenTelemetry SDK before Nest boots, so it has to be in this file
# rather than the shared one (Nx loads a project's own .env; nothing loads the
# shared file into the environment). Pointed at this slot's collector, which
# exists only while the ``observability`` compose profile is up. With the profile
# down the batch processor drops spans and warns, requests are unaffected, so
# leaving this on costs nothing; set OTEL_ENABLED=false to silence it.
OTEL_SERVICE_NAME=luna-shopper-backend-$service
OTEL_ENABLED=true
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:$otlpHttp
OTEL_TRACES_SAMPLER_ARG=1.0
DEPLOYMENT_ENVIRONMENT=development
METRICS_ENABLED=true
"@
}

function Write-SlotConfig([int]$slot, [int]$appSlot) {
  # Every port comes from Get-LunaPort, so this function cannot drift from what
  # -List probes and -Down frees.
  $authDb = Get-LunaPort 'auth_db' $slot
  $coreDb = Get-LunaPort 'core_db' $slot
  $catalogDb = Get-LunaPort 'catalog_db' $slot
  $nats = Get-LunaPort 'nats' $slot
  $natsMon = Get-LunaPort 'nats_mon' $slot
  $redis = Get-LunaPort 'redis' $slot
  $smtp = Get-LunaPort 'smtp' $slot
  $mailUi = Get-LunaPort 'mailpit' $slot
  $gateway = Get-LunaPort 'gateway' $slot
  $realtime = Get-LunaPort 'realtime' $slot
  $auth = Get-LunaPort 'auth' $slot
  $core = Get-LunaPort 'core' $slot
  $catalog = Get-LunaPort 'catalog' $slot
  $assistant = Get-LunaPort 'assistant' $slot
  $otlpGrpc = Get-LunaPort 'otlp_grpc' $slot
  $otlpHttp = Get-LunaPort 'otlp_http' $slot
  $jaegerUi = Get-LunaPort 'jaeger' $slot
  $prometheus = Get-LunaPort 'prometheus' $slot
  $grafana = Get-LunaPort 'grafana' $slot

  # The one front end the singular URLs point at. See the header: this is a choice,
  # not an inference, because a redirect target cannot be a list.
  $shellPort = Get-FrontendPort 'shell' $appSlot
  $velistaPort = Get-FrontendPort 'velista' $appSlot

  $project = Get-SlotProject $slot

  $secrets = Join-Path $root 'apps/luna-shopper-backend/secrets'
  New-Item -ItemType Directory -Force -Path $secrets | Out-Null
  New-Item -ItemType Directory -Force -Path $runDir | Out-Null
  if (-not (Test-Path (Join-Path $secrets 'jwt.key'))) {
    Write-Host 'generating a throwaway dev JWT keypair in apps/luna-shopper-backend/secrets ...'
    & openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out (Join-Path $secrets 'jwt.key')
    & openssl pkey -in (Join-Path $secrets 'jwt.key') -pubout -out (Join-Path $secrets 'jwt.pub')
  }
  # The operator keypair (plan 0071, section 3), and a second one because it IS
  # separate: a token signed with the pair above is a velista user's and must not
  # verify on an admin route. Its own file, so a checkout that already has jwt.key
  # still gets one.
  if (-not (Test-Path (Join-Path $secrets 'admin-jwt.key'))) {
    Write-Host 'generating a throwaway dev admin JWT keypair in apps/luna-shopper-backend/secrets ...'
    & openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out (Join-Path $secrets 'admin-jwt.key')
    & openssl pkey -in (Join-Path $secrets 'admin-jwt.key') -pubout -out (Join-Path $secrets 'admin-jwt.pub')
  }

  Write-EnvFile $slotEnv @"
# Generated by luna-slot.ps1 for slot $slot. Git ignored.
# LUNA_SLOT is not read by compose. It is here so -List, -Up and -Down, and the
# same three in every other worktree, can read this worktree's slot back out of the
# one file that already describes it.
LUNA_SLOT=$slot
# Which front end slot the singular redirect and mail URLs point at. Independent
# of LUNA_SLOT on purpose (see the header); kept here so a plain re-run of this
# script preserves the choice instead of silently resetting it to the default.
LUNA_APP_SLOT=$appSlot
COMPOSE_PROJECT_NAME=$project
LUNA_AUTH_DB_PORT=$authDb
LUNA_CORE_DB_PORT=$coreDb
LUNA_CATALOG_DB_PORT=$catalogDb
LUNA_NATS_PORT=$nats
LUNA_NATS_MONITOR_PORT=$natsMon
LUNA_REDIS_PORT=$redis
LUNA_SMTP_PORT=$smtp
LUNA_MAILPIT_UI_PORT=$mailUi
LUNA_OTLP_GRPC_PORT=$otlpGrpc
LUNA_OTLP_HTTP_PORT=$otlpHttp
LUNA_JAEGER_UI_PORT=$jaegerUi
LUNA_PROMETHEUS_PORT=$prometheus
LUNA_GRAFANA_PORT=$grafana
# The collector scrapes the services on the host, so it needs their ports too.
LUNA_GATEWAY_PORT=$gateway
LUNA_REALTIME_PORT=$realtime
LUNA_AUTH_PORT=$auth
LUNA_CORE_PORT=$core
LUNA_CATALOG_PORT=$catalog
LUNA_ASSISTANT_PORT=$assistant
"@

  Write-EnvFile (Join-Path $root 'apps/luna-shopper-backend/.env.luna-shopper-backend') @"
# Generated by luna-slot.ps1 (slot $slot). Git ignored.
NATS_URL=nats://localhost:$nats
REDIS_URL=redis://localhost:$redis
LOG_LEVEL=debug
# Every front end slot's two origins, not this slot's: the front end numbering is
# independent of this one, and several front end slots may call one backend at the
# same time. Each slot contributes the portfolio shell, which mounts velista as a
# remote, and velista's own origin, which is a first class way to run it (plan
# 0013) and was missing from this list even on slot 0.
CORS_ORIGINS=$(Get-FrontendOrigins)
# Telemetry deliberately does NOT live here; see the note in each service's .env.
"@

  Write-EnvFile (Join-Path $root 'apps/luna-shopper-backend/gateway/.env') @"
# Generated by luna-slot.ps1 (slot $slot). Git ignored.
AUTH_JWT_PUBLIC_KEY_FILE=./apps/luna-shopper-backend/secrets/jwt.pub
# The operator trust root (plan 0071). Required, so a slot whose .env predates
# this line kills the gateway at boot rather than degrading: rerun -Up.
ADMIN_JWT_PUBLIC_KEY_FILE=./apps/luna-shopper-backend/secrets/admin-jwt.pub
# What GET /v1/admin/auth/me reports, and therefore the accent colour the back
# office renders. A local stack says development, which is the point of it.
ENVIRONMENT_NAME=development
# Sign the operator in with no password (plan 0071, section 8). Here and nowhere
# else: auth refuses to boot with it on against a non local database, and
# provision-release.ps1's counterpart refuses a deploy whose render mentions it.
# Create the admin it names with nx run luna-shopper-backend-auth:admin:create.
ADMIN_DEV_AUTOLOGIN=false
ADMIN_DEV_AUTOLOGIN_USERNAME=dev-admin
PORT=$gateway
# Google sign in runs at the gateway (plan 0023), so the OAuth variables live
# here as well as in auth's env. The credentials are placeholders: with a client
# id set the routes are live, which is what lets the state mint and the refusal
# of a bad state be driven locally without a real consent screen.
GOOGLE_CLIENT_ID=your-dev-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-dev-client-secret
GOOGLE_CALLBACK_URL=http://localhost:$gateway/v1/auth/google/callback
# Where the callback sends the browser. {locale} is substituted with the locale
# the flow started in; the app sits under a path that follows the locale segment.
APP_BASE_URL=http://localhost:$shellPort/{locale}/velista
# The byte cap the spoken turn route's multipart interceptor enforces (plan
# 0041). The gateway is where an upload is actually refused, so the number lives
# here as well as in the assistant's env.
ASSISTANT_AUDIO_MAX_BYTES=2097152
# Voice comments (plan 0045), a different route with its own cap. It is set on
# the multipart interceptor here, which is the only place a byte cap is actually
# a cap, and core checks the same number again on the far side of the broker.
# Both files carry it, so a slot cannot end up with a gateway that accepts what
# core refuses.
VOICE_COMMENT_MAX_BYTES=2097152
# Empty falls back to the contract's list, which is what browsers really produce:
# WebM/Opus in Chrome, Ogg/Opus in Firefox, MP4/AAC in Safari.
VOICE_COMMENT_CONTENT_TYPES=
VOICE_COMMENT_TRANSCRIBE_TIMEOUT_MS=45000
$(Get-TelemetryEnv 'gateway' $otlpHttp)
"@

  Write-EnvFile (Join-Path $root 'apps/luna-shopper-backend/realtime/.env') @"
# Generated by luna-slot.ps1 (slot $slot). Git ignored.
AUTH_JWT_PUBLIC_KEY_FILE=./apps/luna-shopper-backend/secrets/jwt.pub
PORT=$realtime
$(Get-TelemetryEnv 'realtime' $otlpHttp)
"@

  Write-EnvFile (Join-Path $root 'apps/luna-shopper-backend/auth/.env') @"
# Generated by luna-slot.ps1 (slot $slot). Git ignored.
AUTH_DB_URL=postgres://luna_auth:luna_auth@localhost:$authDb/luna_auth
AUTH_JWT_PRIVATE_KEY_FILE=./apps/luna-shopper-backend/secrets/jwt.key
AUTH_JWT_PUBLIC_KEY_FILE=./apps/luna-shopper-backend/secrets/jwt.pub
AUTH_JWT_KID=dev-1
ACCESS_TOKEN_TTL=15m
REFRESH_TOKEN_TTL=30d
# The operator identity (plan 0071). Auth holds the private half and nothing else
# does, exactly as with the pair above.
ADMIN_JWT_PRIVATE_KEY_FILE=./apps/luna-shopper-backend/secrets/admin-jwt.key
ADMIN_JWT_PUBLIC_KEY_FILE=./apps/luna-shopper-backend/secrets/admin-jwt.pub
ADMIN_JWT_KID=dev-admin-1
ADMIN_ACCESS_TOKEN_TTL=15m
ADMIN_LOGIN_LOCKOUT_THRESHOLD=5
ADMIN_LOGIN_LOCKOUT_WINDOW=15m
# Off by default even locally, and the two values have to agree with the
# gateway's: turning it on there and leaving it off here is a login that asks
# auth for a token it will refuse to mint.
ADMIN_DEV_AUTOLOGIN=false
ADMIN_DEV_AUTOLOGIN_USERNAME=dev-admin
SMTP_HOST=localhost
SMTP_PORT=$smtp
SMTP_USER=
SMTP_PASS=
MAIL_FROM=Luna Shopper <no-reply@luna.localhost>
# Where a confirmation mail sends the reader. velista's **own** origin, not the
# shell's, so a local link has the same shape production sends: on velista.app the
# app is standalone and the mount is empty, and 4205 is that same app on this
# machine (plan 0013). ``auth/verify`` is the route the app really has; the
# ``/verify-email`` this used to name matched nothing and every link 404'd.
#
# No locale segment, on purpose. ``localeGuard`` inserts one in front of a path
# that has none and carries the query string with it, so the link opens at
# ``/{locale}/auth/verify?token=...`` in the reader's own language.
MAIL_VERIFY_BASE_URL=http://localhost:$velistaPort/auth/verify
# A placeholder for a page that does not exist yet: nothing in ``feature-auth``
# routes a reset token. Auth requires the variable, so it is set and unusable.
MAIL_RESET_BASE_URL=http://localhost:$velistaPort/reset-password
GOOGLE_CLIENT_ID=your-dev-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-dev-client-secret
GOOGLE_CALLBACK_URL=http://localhost:$gateway/auth/google/callback
PORT=$auth
$(Get-TelemetryEnv 'auth' $otlpHttp)
"@

  Write-EnvFile (Join-Path $root 'apps/luna-shopper-backend/core/.env') @"
# Generated by luna-slot.ps1 (slot $slot). Git ignored.
CORE_DB_URL=postgres://luna_core:luna_core@localhost:$coreDb/luna_core
AUTH_JWT_PUBLIC_KEY_FILE=./apps/luna-shopper-backend/secrets/jwt.pub
PORT=$core
# The same two numbers the gateway is running with (plan 0045, section 6). Core
# owns the bytea a recording is written into, so it refuses a payload that
# reached the broker without passing the interceptor.
VOICE_COMMENT_MAX_BYTES=2097152
VOICE_COMMENT_CONTENT_TYPES=
# One number, two readers (plans 0052 and 0059): a live basket older than this
# claims none of its lines, and the sweep finishes it at the same age.
GENERATED_LIST_CLAIM_WINDOW=60h
GENERATED_LIST_SWEEP_ENABLED=true
GENERATED_LIST_SWEEP_INTERVAL=1h
GENERATED_LIST_SWEEP_BATCH=100
$(Get-TelemetryEnv 'core' $otlpHttp)
"@

  Write-EnvFile (Join-Path $root 'apps/luna-shopper-backend/catalog/.env') @"
# Generated by luna-slot.ps1 (slot $slot). Git ignored.
CATALOG_DB_URL=postgres://luna_catalog:luna_catalog@localhost:$catalogDb/luna_catalog
AUTH_JWT_PUBLIC_KEY_FILE=./apps/luna-shopper-backend/secrets/jwt.pub
# Writing the catalog by hand is a matter of holding an admin token, not of
# listing a uuid (plan 0072): catalog verifies the signature itself with this key.
ADMIN_JWT_PUBLIC_KEY_FILE=./apps/luna-shopper-backend/secrets/admin-jwt.pub
# Services allowed to write without a token, which is the harvester and nothing
# else. Empty here because this script does not bring the harvester up at all;
# luna-slot.sh does, and it writes the same uuid into both files.
SERVICE_ACTOR_IDS=
PORT=$catalog
$(Get-TelemetryEnv 'catalog' $otlpHttp)
"@

  # The assistant (plan 0039). No database url, because it has no database: rule
  # A1 says it reaches application data only through the API with the caller's
  # own token. GEMINI_API_KEY is EMPTY, and leaving it that way is a supported
  # setup: the service boots and /v1/assistant answers 501 not_configured (plan
  # 0026), and rule A4 means the suite never wants a key anyway.
  Write-EnvFile (Join-Path $root 'apps/luna-shopper-backend/assistant/.env') @"
# Generated by luna-slot.ps1 (slot $slot). Git ignored.
GATEWAY_INTERNAL_URL=http://localhost:$gateway
GEMINI_API_KEY=
ASSISTANT_MODEL=gemini-3.5-flash-lite
# Voice input (plan 0041). An empty transcription model means the model that
# answers the turn also transcribes it, which is the default everywhere.
ASSISTANT_TRANSCRIPTION_MODEL=
ASSISTANT_AUDIO_MAX_BYTES=2097152
ASSISTANT_AUDIO_MIME_TYPES=audio/webm,audio/ogg,audio/mp4,audio/wav,audio/mpeg,audio/aac,audio/flac
ASSISTANT_MAX_TURNS=20
ASSISTANT_MAX_CHARS=8000
ASSISTANT_MAX_TOOL_CALLS=6
ASSISTANT_TURNS_PER_MINUTE=8
ASSISTANT_CONCURRENCY=2
ASSISTANT_RETRY_AFTER_FALLBACK=30
PORT=$assistant
$(Get-TelemetryEnv 'assistant' $otlpHttp)
"@

  Write-Host ""
  Write-Host "Configured this worktree for Luna Shopper slot $slot."
  Write-Host "  compose project : $project"
  Write-Host "  auth-db localhost:$authDb   core-db localhost:$coreDb   catalog-db localhost:$catalogDb"
  Write-Host "  nats localhost:$nats (mon $natsMon)   redis localhost:$redis"
  Write-Host "  smtp $smtp   mailpit http://localhost:$mailUi"
  Write-Host "  gateway $gateway   realtime $realtime   auth $auth   core $core   catalog $catalog   assistant $assistant"
  Write-Host "  otlp http/grpc $otlpHttp / $otlpGrpc   jaeger http://localhost:$jaegerUi"
  Write-Host "  prometheus http://localhost:$prometheus   grafana http://localhost:$grafana"
  Write-Host "  cors            every front end slot (0..$maxSlot), shell and velista origins both."
  Write-Host "                  Any Angular slot can call this backend, and several can at once."
  Write-Host "  redirects       Angular slot $appSlot (http://localhost:$shellPort), for the Google"
  Write-Host "                  callback and the mail links only, which can name just one."
  Write-Host "                  Change it with -AppSlot <n>."
  Write-Host ""
  Write-Host 'Start the whole thing (compose, migrations, all five services):'
  Write-Host '  ./k8s/e2e/luna-shopper-backend/luna-slot.ps1 -Up'
}

# The lowest slot no other worktree claims and nothing is listening on. Both
# conditions matter: a claim with nothing running is a worktree that is configured
# but idle and would collide the moment it starts, and an open port with no claim is
# something outside this repository that would collide right now.
function Find-FreeSlot {
  $claimed = @{}
  $self = (Resolve-Path $root).Path
  foreach ($wt in (Get-WorktreePaths)) {
    if (-not (Test-Path $wt)) { continue }
    if ((Resolve-Path $wt).Path -eq $self) { continue }
    $s = Get-WorktreeSlot $wt
    if ($null -ne $s) { $claimed[$s] = $true }
  }

  for ($slot = $minAutoSlot; $slot -le $maxSlot; $slot++) {
    if ($claimed.ContainsKey($slot)) { continue }
    $states = Get-PortStates (Get-SlotPorts $slot)
    $busy = $false
    foreach ($state in $states.Values) { if ($state -ne 'closed') { $busy = $true } }
    if (-not $busy) { return $slot }
  }

  throw "no free Luna slot in ${minAutoSlot}..${maxSlot}: every one is claimed by another worktree or has something listening on it (slot 0 is the developer's own, and -Auto never takes it)"
}

# Kill a process tree, tolerating a pid that is already gone.
#
# cmd swallows taskkill's output, not PowerShell: redirecting a native command's
# stderr in 5.1 wraps each line in an ErrorRecord, which $ErrorActionPreference =
# 'Stop' then treats as terminating. "The process N not found" is an ordinary
# outcome here, not a failure, and it is the common one when a .pid file was
# written by the bash twin (whose pid is an MSYS pid this side cannot use) or by a
# run that has since exited.
function Invoke-TaskKill($processId) {
  & cmd.exe /c "taskkill /F /T /PID $processId >nul 2>&1"
  return ($LASTEXITCODE -eq 0)
}

# The image names a `.pid` file here can legitimately name. Anything else is a pid
# that has been recycled since it was recorded.
$killableImages = @('node', 'npx', 'npm', 'cmd', 'conhost', 'powershell', 'pwsh')

# Kill a recorded pid ONLY if it still looks like the process that was recorded.
#
# A .pid file outlives the process it names, and the operating system reuses pids.
# Killing one unverified means killing whatever inherited the number, which on a
# developer machine could be another worktree's services, the editor, or the thing
# the developer is actually working in. `/T` makes it worse by taking that
# process's whole tree.
#
# The port sweep is what actually guarantees the port is free. This is only here to
# stop a wrapper spawning a replacement first, so declining to kill an unrecognised
# pid costs nothing and removes the chance of killing a stranger.
function Stop-RecordedPid($recorded) {
  if (-not $recorded) { return }
  $process = Get-Process -Id $recorded -ErrorAction SilentlyContinue
  if ($null -eq $process) { return }
  if ($killableImages -notcontains $process.ProcessName.ToLower()) { return }
  [void](Invoke-TaskKill $recorded)
}

# The PORT a service will listen on, read back from the .env this script wrote for
# it. One source of truth: nothing passes a port on the command line, so a service
# and the wait that watches for it cannot disagree.
function Get-ServicePort([string]$svc) {
  $envPath = Join-Path $root "apps/luna-shopper-backend/$svc/.env"
  if (-not (Test-Path $envPath)) { return $null }
  foreach ($line in (Get-Content $envPath)) {
    if ($line -match '^PORT=(\d+)\s*$') { return [int]$Matches[1] }
  }
  return $null
}

# Start each named service in the background; returns the ports to wait on.
function Start-Services([string[]]$svcs, [int]$slotNumber) {
  New-Item -ItemType Directory -Force -Path $runDir | Out-Null
  $ports = @()
  foreach ($svc in $svcs) {
    $port = Get-ServicePort $svc
    if ($null -eq $port) {
      throw "no PORT in apps/luna-shopper-backend/$svc/.env; rerun luna-slot.ps1 $slotNumber"
    }

    $states = Get-PortStates @($port)
    if ($states[$port] -ne 'closed') {
      throw "port $port ($svc, slot $slotNumber) is already $($states[$port]); run -Down or -Restart"
    }

    Write-Host "==> serving $svc on :$port  (log: k8s/e2e/luna-shopper-backend/.run/$svc.log)"
    # Two files, not one: PowerShell 5.1 refuses to redirect both streams to the
    # same path, and Nest writes plenty to stderr on a healthy boot.
    $process = Start-Process -FilePath 'npx.cmd' `
      -ArgumentList @('nx', 'run', "luna-shopper-backend-${svc}:serve") `
      -WorkingDirectory $root -NoNewWindow -PassThru `
      -RedirectStandardOutput (Join-Path $runDir "$svc.log") `
      -RedirectStandardError (Join-Path $runDir "$svc.err.log")
    Set-Content -Path (Join-Path $runDir "$svc.pid") -Value $process.Id -Encoding utf8
    $ports += $port
  }
  return $ports
}

# Stop the recorded processes, then free the ports, then free them again.
#
# Killing by port alone is not enough, and the gap is not theoretical: a service
# spawned but not yet bound is invisible to a port sweep, so it survives the stop
# and binds a moment later, and the next -Up fails with "port 3100 is already open"
# over nothing visible. Scoped to the named services, so -Restart -Services gateway
# leaves the other four alone.
function Stop-Services([string[]]$svcs, [int[]]$ports) {
  foreach ($svc in $svcs) {
    $pidFile = Join-Path $runDir "$svc.pid"
    if (Test-Path $pidFile) {
      $recorded = (Get-Content $pidFile -ErrorAction SilentlyContinue | Select-Object -First 1)
      Stop-RecordedPid $recorded
      Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
    }
  }

  $freed = 0
  foreach ($pass in 1, 2) {
    foreach ($port in $ports) {
      if (Stop-Port $port) {
        Write-Host "  freed $port"
        $freed++
      }
    }
    if ($pass -eq 1) { Start-Sleep -Seconds 3 }
  }
  return ($freed -gt 0)
}

# Bounce the Nest services and leave the compose stack exactly where it is.
#
# Rarely needed. `nx run <svc>:serve` is @nx/js:node, whose watch defaults to true,
# so a change to a service or a library it consumes rebuilds and restarts that one
# process by itself. What it will not pick up is a rewritten .env, because Nx loads
# {projectRoot}/.env into the task when it starts it.
#
# It exists chiefly so that is not a reason to run -Down, which takes the databases
# and their volumes with it. Restarting a service should never cost the data
# somebody has been working with.
function Invoke-Restart {
  $config = Read-SlotConfig
  if ($null -eq $config) {
    throw 'this worktree has no slot configured, so there is nothing to restart.'
  }
  $slotNumber = [int]$config['LUNA_SLOT']

  $wanted = $serviceNames
  if ($Services) {
    $wanted = $Services -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ }
    foreach ($svc in $wanted) {
      if ($serviceNames -notcontains $svc) {
        throw "unknown service '$svc'; known: $($serviceNames -join ', ')"
      }
    }
  }

  Write-Host "==> restarting on Luna slot ${slotNumber}: $($wanted -join ', ')"
  Write-Host '    (the compose stack and its volumes are left alone)'
  $stopping = @()
  foreach ($svc in $wanted) {
    $port = Get-ServicePort $svc
    if ($null -ne $port) { $stopping += $port }
  }
  [void](Stop-Services $wanted $stopping)

  $ports = Start-Services $wanted $slotNumber

  Write-Host "==> waiting up to ${Timeout}s for them to listen"
  if (Wait-ForPorts $ports $Timeout) {
    Write-Host "restarted: $($wanted -join ', ')"
    return
  }
  throw 'timed out; see k8s/e2e/luna-shopper-backend/.run/*.log'
}

# Wait until every port answers, or until the timeout.
function Wait-ForPorts([int[]]$ports, [int]$timeoutSeconds) {
  $deadline = (Get-Date).AddSeconds($timeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    $states = Get-PortStates $ports
    $pending = 0
    foreach ($state in $states.Values) { if ($state -ne 'open') { $pending++ } }
    if ($pending -eq 0) { return $true }
    Start-Sleep -Seconds 2
  }
  return $false
}

function Invoke-Stack([string[]]$stackArgs) {
  if (-not (Get-Command bash -ErrorAction SilentlyContinue)) {
    throw 'stack.sh needs Git Bash on PATH. Install Git for Windows, or run the .sh twin.'
  }
  $all = @((Join-Path $here 'stack.sh'))
  if ($ComposeProfile) { $all += @('--profile', $ComposeProfile) }
  $all += $stackArgs
  & bash @all
  if ($LASTEXITCODE -ne 0) { throw "stack.sh $($stackArgs -join ' ') failed with exit code $LASTEXITCODE" }
}

function Invoke-Up {
  $config = Read-SlotConfig

  # -Auto names the slot, not the verb, so `-Up -Auto` moves this worktree to a
  # fresh free slot rather than reusing the one it already claims.
  if ($Auto -and -not $Slot) { $Slot = "$(Find-FreeSlot)" }

  if ($Slot) {
    Write-SlotConfig ([int]$Slot) (Resolve-AppSlot)
    $config = Read-SlotConfig
  }
  elseif ($null -eq $config) {
    # "-Up without generating the env file does that first" is the whole point: an
    # agent that has just made a worktree should need one command, not two.
    $free = Find-FreeSlot
    Write-Host "==> this worktree has no slot yet; taking the lowest free one: $free"
    Write-SlotConfig $free (Resolve-AppSlot)
    $config = Read-SlotConfig
  }

  $slotNumber = [int]$config['LUNA_SLOT']

  # The compose stack and the migrations are stack.sh's job and it already does them
  # properly (up --wait on the healthchecks, then every migration). Calling it rather
  # than repeating it is what keeps compose the single definition of what the
  # infrastructure is; it reads the same .env.slot just written.
  Invoke-Stack @('up')

  $ports = Start-Services $serviceNames $slotNumber

  Write-Host "==> waiting up to ${Timeout}s for the five services to listen"
  if (Wait-ForPorts $ports $Timeout) {
    Write-Host ""
    Write-Host "Luna Shopper slot $slotNumber is up."
    Write-Host "  gateway  http://localhost:$($config['LUNA_GATEWAY_PORT'])"
    Write-Host "  realtime http://localhost:$($config['LUNA_REALTIME_PORT'])"
    Write-Host "  mailpit  http://localhost:$($config['LUNA_MAILPIT_UI_PORT'])"
    Write-Host ""
    Write-Host "Serve the matching front end with:  ./tools/dev/ng-slot.ps1 -Up $slotNumber"
    return
  }

  $states = Get-PortStates $ports
  Write-Host ""
  Write-Host "timed out after ${Timeout}s. These are not listening yet:"
  for ($i = 0; $i -lt $serviceNames.Count; $i++) {
    if ($states[$ports[$i]] -ne 'open') {
      Write-Host "  $($serviceNames[$i]) ($($ports[$i])): $($states[$ports[$i]]), see k8s/e2e/luna-shopper-backend/.run/$($serviceNames[$i]).log"
    }
  }
  throw 'the processes are still running; -Down stops them.'
}

# Kill whatever holds a port, rather than the pid this script recorded: `nx run` is
# a wrapper and the process that binds is a grandchild, so killing the recorded pid
# leaves the server running and the port taken. /T takes the tree.
function Stop-Port([int]$port) {
  $owners = @()
  try {
    $owners = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction Stop |
      Select-Object -ExpandProperty OwningProcess -Unique
  }
  catch { return $false }

  $killed = $false
  foreach ($owningPid in $owners) {
    if ($owningPid -and $owningPid -ne 0) {
      if (Invoke-TaskKill $owningPid) { $killed = $true }
    }
  }
  return $killed
}

function Invoke-Down {
  $config = Read-SlotConfig
  if ($null -eq $config) {
    Write-Host 'this worktree has no slot configured, so there is nothing of its own to stop.'
    Write-Host 'Run -List to see which worktrees do.'
    return
  }

  $slotNumber = [int]$config['LUNA_SLOT']
  Write-Host "==> stopping the services of Luna Shopper slot $slotNumber"
  if (-not (Stop-Services $serviceNames (Get-ServicePorts $slotNumber))) {
    Write-Host '  none of the five were running'
  }

  # Containers only ever hold the infra ports, so they are taken down by compose
  # rather than by killing a pid.
  if ($KeepData) {
    Write-Host '==> stopping the compose stack, keeping its volumes'
    $composeArgs = @('compose', '--env-file', $slotEnv, '-f', (Join-Path $here 'compose.yml'))
    if ($ComposeProfile) { $composeArgs += @('--profile', $ComposeProfile) }
    $composeArgs += 'stop'
    & docker @composeArgs
  }
  else {
    Invoke-Stack @('down')
  }
}

function Invoke-List {
  $claimedBy = @{}
  $self = (Resolve-Path $root).Path
  foreach ($wt in (Get-WorktreePaths)) {
    if (-not (Test-Path $wt)) { continue }
    $s = Get-WorktreeSlot $wt
    if ($null -eq $s) { continue }
    $label = $wt
    if ((Resolve-Path $wt).Path -eq $self) { $label = "$wt  (this one)" }
    if ($claimedBy.ContainsKey($s)) { $claimedBy[$s] += $label } else { $claimedBy[$s] = @($label) }
  }

  # Every port of every slot in one node process, so -List is one round trip.
  $allPorts = @()
  for ($slot = 0; $slot -le $maxSlot; $slot++) { $allPorts += (Get-SlotPorts $slot) }
  $states = Get-PortStates $allPorts

  function Measure-Open([int[]]$ports) {
    $open = 0
    foreach ($port in $ports) { if ($states[$port] -eq 'open') { $open++ } }
    return "$open/$($ports.Count)"
  }

  Write-Host ""
  Write-Host 'Luna Shopper dev slots (slot 0 is the historic ports; 1 and up are a block at 43000 + (slot-1)*100)'
  Write-Host ""
  Write-Host ('  {0,-4} {1,-20} {2,-9} {3,-9} {4,-7} {5}' -f 'SLOT', 'COMPOSE PROJECT', 'INFRA', 'SERVICES', 'OBSERV', 'CLAIMED BY')

  for ($slot = 0; $slot -le $maxSlot; $slot++) {
    $infra = Measure-Open (Get-InfraPorts $slot)
    $svc = Measure-Open (Get-ServicePorts $slot)
    $observ = Measure-Open (Get-ObservabilityPorts $slot)

    $claim = @()
    if ($claimedBy.ContainsKey($slot)) { $claim = $claimedBy[$slot] }

    # Nothing running and nobody configured for it: not worth a line.
    if ($claim.Count -eq 0 -and $infra -like '0/*' -and $svc -like '0/*' -and $observ -like '0/*') {
      continue
    }

    if ($claim.Count -eq 0) {
      Write-Host ('  {0,-4} {1,-20} {2,-9} {3,-9} {4,-7} {5}' -f $slot, (Get-SlotProject $slot), $infra, $svc, $observ, '(no worktree claims it)')
      continue
    }

    for ($i = 0; $i -lt $claim.Count; $i++) {
      if ($i -eq 0) {
        Write-Host ('  {0,-4} {1,-20} {2,-9} {3,-9} {4,-7} {5}' -f $slot, (Get-SlotProject $slot), $infra, $svc, $observ, $claim[$i])
      }
      else {
        Write-Host ('  {0,-4} {1,-20} {2,-9} {3,-9} {4,-7} {5}' -f '', '', '', '', '', $claim[$i])
      }
    }
  }

  Write-Host ""
  Write-Host '  INFRA     the three databases, NATS and its monitor, Redis, SMTP, Mailpit'
  Write-Host '  SERVICES  gateway, realtime, auth, core, catalog, assistant'
  Write-Host '  OBSERV    collector, Jaeger, Prometheus, Grafana: opt in, so 0/5 is normal'
  Write-Host ""
  Write-Host 'A slot claimed with 0/8 infra is configured but not started: -Up will take it.'
  Write-Host "Slots 0..$maxSlot with neither a claim nor a listener are omitted."
}

if ($List) { Invoke-List; return }
if ($Down) { Invoke-Down; return }
if ($Restart) { Invoke-Restart; return }
if ($Up) { Invoke-Up; return }
if ($Auto) { Write-SlotConfig (Find-FreeSlot) (Resolve-AppSlot); return }
if ($Slot -match '^\d+$') { Write-SlotConfig ([int]$Slot) (Resolve-AppSlot); return }

Write-Host @'
usage:
  luna-slot.ps1 <slot>          configure this worktree for that slot
  luna-slot.ps1 -Auto           configure it for the lowest free slot
  luna-slot.ps1 -Up [<slot>]    configure if needed, then start everything
  luna-slot.ps1 -Restart        bounce the services, keeping the databases
  luna-slot.ps1 -Down           stop the services and take the stack down
  luna-slot.ps1 -List           every worktree's slot, and what is live

Source changes need none of this: `nx serve` watches each service and the
libraries it consumes and restarts that one process itself. -Restart is for a
changed .env, which a running service cannot pick up, and it leaves the compose
stack and its volumes alone so a restart never costs you the data.

options:
  -Profile <name>   compose profile for -Up / -Down (e.g. observability)
  -Services a,b     limit -Restart to these (default: all five)
  -AppSlot <n>      which Angular slot the Google callback and the mail links
                    send a browser to (default 0). Only those; CORS allows every
                    Angular slot no matter what this says.
  -KeepData         -Down stops the containers instead of removing them and
                    their volumes, so the databases survive
  -Timeout <secs>   how long -Up waits for each service (default 180)

The Angular slots are a separate numbering: any of them can call this backend,
and several can at the same time. Backend slot 3 does not imply front end slot 3.

-Up is the whole thing: it writes the .env files if they are missing, brings the
compose stack up and waits on its healthchecks, runs the migrations, then serves
all five services. -Down is its inverse, and by default it removes this slot's
volumes, which is what `stack.sh down` has always meant here.
'@
exit 2
