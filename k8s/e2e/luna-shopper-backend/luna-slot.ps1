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
  A slot is an integer N. Every host port is default + N*100, the compose project
  (its containers, network, and named volumes) is "luna-slot<N>", and the five
  services listen on 300{0..4}+N*100. Slot 0 keeps the original ports and the
  "luna-shopper-backend" project name, so a lone worktree needs no slot.

  The front end has the same idea with the same arithmetic in tools/dev/ng-slot.ps1,
  so "slot 2" means one thing across the whole app: shell 4400, velista 4405,
  gateway 3200, realtime 3201. That pairing is not decoration: the origins written
  into CORS_ORIGINS and APP_BASE_URL are derived from the same slot number, so a
  worktree that takes slot 2 on both sides has a browser the gateway will answer.

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
  [switch]$Down,
  [switch]$Auto,
  [Alias('p','Profile')][string]$ComposeProfile,
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
$services = @('gateway', 'realtime', 'auth', 'core', 'catalog')

# How high -Auto and -List will look. See the same constant in ng-slot.ps1.
$maxSlot = 9

# -Auto never takes slot 0. parallel-worktree-testing.md has said so since it was
# written: slot 0 is the developer's own stack, on the ports their tools and their
# browser already point at, so a worker that took it would collide with the one
# checkout that cannot move. `luna-slot.ps1 0` is still accepted, because asking for
# it explicitly means it.
$minAutoSlot = 1

function Get-SlotProject([int]$slot) {
  # Slot 0 keeps the historic name so the no-slot workflow still matches.
  if ($slot -eq 0) { return 'luna-shopper-backend' }
  return "luna-slot$slot"
}

# The infrastructure compose brings up. `--wait` covers all of it, so a slot with
# some of these open and some closed is genuinely half started.
function Get-InfraPorts([int]$slot) {
  $off = $slot * 100
  return @(
    (5432 + $off),   # auth-db
    (5433 + $off),   # core-db
    (5434 + $off),   # catalog-db
    (4222 + $off),   # nats
    (8222 + $off),   # nats monitoring
    (6379 + $off),   # redis
    (1025 + $off),   # smtp
    (8025 + $off)    # mailpit ui
  )
}

function Get-ServicePorts([int]$slot) {
  $off = $slot * 100
  return @((3000 + $off), (3001 + $off), (3002 + $off), (3003 + $off), (3004 + $off))
}

# Reserved per slot whether or not the `observability` profile is up, so two
# worktrees can each run a collector. Deliberately NOT counted when deciding whether
# a slot is up: the profile is opt in, and counting it would report every healthy
# slot as partial.
function Get-ObservabilityPorts([int]$slot) {
  $off = $slot * 100
  return @((4317 + $off), (4318 + $off), (16686 + $off), (9090 + $off), (3010 + $off))
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

function Write-SlotConfig([int]$slot) {
  $off = $slot * 100

  $authDb = 5432 + $off
  $coreDb = 5433 + $off
  $catalogDb = 5434 + $off
  $nats = 4222 + $off
  $natsMon = 8222 + $off
  $redis = 6379 + $off
  $smtp = 1025 + $off
  $mailUi = 8025 + $off
  $gateway = 3000 + $off
  $realtime = 3001 + $off
  $auth = 3002 + $off
  $core = 3003 + $off
  $catalog = 3004 + $off
  $otlpGrpc = 4317 + $off
  $otlpHttp = 4318 + $off
  $jaegerUi = 16686 + $off
  $prometheus = 9090 + $off
  $grafana = 3010 + $off

  # The front end of the same slot (tools/dev/ng-slot.ps1). These are the origins a
  # browser will actually be on, so they are what CORS has to allow and what the
  # Google callback and the mail links have to point back at. Hardcoding 4200 here
  # meant every worktree past the first got a gateway that refused its own browser,
  # with a CORS error that says nothing about slots.
  $shellPort = 4200 + $off
  $velistaPort = 4205 + $off

  $project = Get-SlotProject $slot

  $secrets = Join-Path $root 'apps/luna-shopper-backend/secrets'
  New-Item -ItemType Directory -Force -Path $secrets | Out-Null
  New-Item -ItemType Directory -Force -Path $runDir | Out-Null
  if (-not (Test-Path (Join-Path $secrets 'jwt.key'))) {
    Write-Host 'generating a throwaway dev JWT keypair in apps/luna-shopper-backend/secrets ...'
    & openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out (Join-Path $secrets 'jwt.key')
    & openssl pkey -in (Join-Path $secrets 'jwt.key') -pubout -out (Join-Path $secrets 'jwt.pub')
  }

  Write-EnvFile $slotEnv @"
# Generated by luna-slot.ps1 for slot $slot. Git ignored.
# LUNA_SLOT is not read by compose. It is here so -List, -Up and -Down, and the
# same three in every other worktree, can read this worktree's slot back out of the
# one file that already describes it.
LUNA_SLOT=$slot
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
"@

  Write-EnvFile (Join-Path $root 'apps/luna-shopper-backend/.env.luna-shopper-backend') @"
# Generated by luna-slot.ps1 (slot $slot). Git ignored.
NATS_URL=nats://localhost:$nats
REDIS_URL=redis://localhost:$redis
LOG_LEVEL=debug
# Both front end origins of this slot: the portfolio shell, which mounts velista as
# a remote, and velista's own origin, which is a first class way to run it (plan
# 0013) and was missing from this list even on slot 0.
CORS_ORIGINS=http://localhost:$shellPort,http://localhost:$velistaPort
# Telemetry deliberately does NOT live here; see the note in each service's .env.
"@

  Write-EnvFile (Join-Path $root 'apps/luna-shopper-backend/gateway/.env') @"
# Generated by luna-slot.ps1 (slot $slot). Git ignored.
AUTH_JWT_PUBLIC_KEY_FILE=./apps/luna-shopper-backend/secrets/jwt.pub
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
SMTP_HOST=localhost
SMTP_PORT=$smtp
SMTP_USER=
SMTP_PASS=
MAIL_FROM=Luna Shopper <no-reply@luna.localhost>
MAIL_VERIFY_BASE_URL=http://localhost:$shellPort/verify-email
MAIL_RESET_BASE_URL=http://localhost:$shellPort/reset-password
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
$(Get-TelemetryEnv 'core' $otlpHttp)
"@

  Write-EnvFile (Join-Path $root 'apps/luna-shopper-backend/catalog/.env') @"
# Generated by luna-slot.ps1 (slot $slot). Git ignored.
CATALOG_DB_URL=postgres://luna_catalog:luna_catalog@localhost:$catalogDb/luna_catalog
AUTH_JWT_PUBLIC_KEY_FILE=./apps/luna-shopper-backend/secrets/jwt.pub
PLATFORM_ADMIN_USER_IDS=
PORT=$catalog
$(Get-TelemetryEnv 'catalog' $otlpHttp)
"@

  Write-Host ""
  Write-Host "Configured this worktree for Luna Shopper slot $slot."
  Write-Host "  compose project : $project"
  Write-Host "  auth-db localhost:$authDb   core-db localhost:$coreDb   catalog-db localhost:$catalogDb"
  Write-Host "  nats localhost:$nats (mon $natsMon)   redis localhost:$redis"
  Write-Host "  smtp $smtp   mailpit http://localhost:$mailUi"
  Write-Host "  gateway $gateway   realtime $realtime   auth $auth   core $core   catalog $catalog"
  Write-Host "  otlp http/grpc $otlpHttp / $otlpGrpc   jaeger http://localhost:$jaegerUi"
  Write-Host "  prometheus http://localhost:$prometheus   grafana http://localhost:$grafana"
  Write-Host "  browser origins http://localhost:$shellPort (shell) and http://localhost:$velistaPort (velista)"
  Write-Host "                  matching Angular slot $slot; see tools/dev/ng-slot.ps1"
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
    Write-SlotConfig ([int]$Slot)
    $config = Read-SlotConfig
  }
  elseif ($null -eq $config) {
    # "-Up without generating the env file does that first" is the whole point: an
    # agent that has just made a worktree should need one command, not two.
    $free = Find-FreeSlot
    Write-Host "==> this worktree has no slot yet; taking the lowest free one: $free"
    Write-SlotConfig $free
    $config = Read-SlotConfig
  }

  $slotNumber = [int]$config['LUNA_SLOT']

  # The compose stack and the migrations are stack.sh's job and it already does them
  # properly (up --wait on the healthchecks, then every migration). Calling it rather
  # than repeating it is what keeps compose the single definition of what the
  # infrastructure is; it reads the same .env.slot just written.
  Invoke-Stack @('up')

  New-Item -ItemType Directory -Force -Path $runDir | Out-Null
  $ports = @()
  foreach ($svc in $services) {
    $envPath = Join-Path $root "apps/luna-shopper-backend/$svc/.env"
    $port = $null
    foreach ($line in (Get-Content $envPath)) {
      if ($line -match '^PORT=(\d+)\s*$') { $port = [int]$Matches[1]; break }
    }
    if ($null -eq $port) {
      throw "no PORT in apps/luna-shopper-backend/$svc/.env; rerun luna-slot.ps1 $slotNumber"
    }

    $states = Get-PortStates @($port)
    if ($states[$port] -ne 'closed') {
      throw "port $port ($svc, slot $slotNumber) is already $($states[$port]); run -Down first"
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
  for ($i = 0; $i -lt $services.Count; $i++) {
    if ($states[$ports[$i]] -ne 'open') {
      Write-Host "  $($services[$i]) ($($ports[$i])): $($states[$ports[$i]]), see k8s/e2e/luna-shopper-backend/.run/$($services[$i]).log"
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
      & taskkill /F /T /PID $owningPid *> $null
      if ($LASTEXITCODE -eq 0) { $killed = $true }
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
  $stopped = 0
  foreach ($port in (Get-ServicePorts $slotNumber)) {
    if (Stop-Port $port) {
      Write-Host "  freed $port"
      $stopped++
    }
  }
  if ($stopped -eq 0) { Write-Host '  none of the five were listening' }

  Get-ChildItem -Path $runDir -Filter '*.pid' -ErrorAction SilentlyContinue |
    Remove-Item -Force -ErrorAction SilentlyContinue

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
  Write-Host 'Luna Shopper dev slots (ports are the default plus slot*100)'
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
  Write-Host '  SERVICES  gateway, realtime, auth, core, catalog'
  Write-Host '  OBSERV    collector, Jaeger, Prometheus, Grafana: opt in, so 0/5 is normal'
  Write-Host ""
  Write-Host 'A slot claimed with 0/8 infra is configured but not started: -Up will take it.'
  Write-Host "Slots 0..$maxSlot with neither a claim nor a listener are omitted."
}

if ($List) { Invoke-List; return }
if ($Down) { Invoke-Down; return }
if ($Up) { Invoke-Up; return }
if ($Auto) { Write-SlotConfig (Find-FreeSlot); return }
if ($Slot -match '^\d+$') { Write-SlotConfig ([int]$Slot); return }

Write-Host @'
usage:
  luna-slot.ps1 <slot>          configure this worktree for that slot
  luna-slot.ps1 -Auto           configure it for the lowest free slot
  luna-slot.ps1 -Up [<slot>]    configure if needed, then start everything
  luna-slot.ps1 -Down           stop the services and take the stack down
  luna-slot.ps1 -List           every worktree's slot, and what is live

options:
  -Profile <name>   compose profile for -Up / -Down (e.g. observability)
  -KeepData         -Down stops the containers instead of removing them and
                    their volumes, so the databases survive
  -Timeout <secs>   how long -Up waits for each service (default 180)

-Up is the whole thing: it writes the .env files if they are missing, brings the
compose stack up and waits on its healthchecks, runs the migrations, then serves
all five services. -Down is its inverse, and by default it removes this slot's
volumes, which is what `stack.sh down` has always meant here.
'@
exit 2
