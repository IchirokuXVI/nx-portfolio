<#
.SYNOPSIS
  Run the Angular apps (shell plus the four remotes) from a git worktree on an
  isolated "slot", so several worktrees, and therefore several agents, can serve
  the front end at once without fighting over ports. PowerShell twin of ng-slot.sh.

.EXAMPLE
  ./tools/dev/ng-slot.ps1 1          # configure this worktree for slot 1
  ./tools/dev/ng-slot.ps1 -Auto      # ...or for the lowest free slot
  ./tools/dev/ng-slot.ps1 -Up        # configure if needed, then serve
  ./tools/dev/ng-slot.ps1 -Down      # stop what this worktree started
  ./tools/dev/ng-slot.ps1 -List      # every worktree's slot, and what is live

.DESCRIPTION
  A slot is an integer N and every port is its default plus N*100: shell 4200
  (static remotes 4201), odontogram 4202, damoclesSword 4203, landingV2 4204,
  velista 4205. Slot 0 is the ports project.json already names, so a lone worktree
  needs no slot and `npx nx serve shell` is unchanged.

  The ports cannot simply be overridden in project.json: `nx serve shell` runs the
  module federation dev server, which starts the remotes itself and reads each
  one's port straight out of the project graph, with no flag and no environment
  variable for it. So this script serves each app as its own task with `--port`,
  gives the shell `--skipRemotes` so it serves only the host, and writes
  MFE_REMOTE_URLS into apps/shell/.env so the bundle it builds looks for the
  remotes on this slot's ports. `--excludeTaskDependencies` goes on the remotes
  because three of them declare dependsOn shell:serve, which would otherwise start
  a second shell on the default port.

  The backend slots are a SEPARATE numbering: front end slot 5 may talk to backend
  slot 1, or 2, or 8, and several front end slots may talk to one backend at the
  same time, which is the common case when nobody is changing the backend. See
  -BackendSlot for how the pairing is decided.

  Writes, all git ignored: tools/dev/.env.ng-slot (the slot descriptor),
  apps/shell/.env, apps/velista/.env, and tools/dev/.run (logs and pids). Nx loads
  {projectRoot}/.env into that project's tasks, so the two app files are picked up
  with nothing exported by the caller. Idempotent.
#>
[CmdletBinding()]
param(
  [Parameter(Position = 0)][string]$Slot,
  [switch]$List,
  [switch]$Up,
  [switch]$Restart,
  [switch]$Down,
  [switch]$Auto,
  [string]$Apps,
  [int]$BackendSlot = -1,
  [int]$Timeout = 300
)

$ErrorActionPreference = 'Stop'

$here = $PSScriptRoot
$root = (Resolve-Path (Join-Path $here '..\..')).Path
$slotEnv = Join-Path $here '.env.ng-slot'
$runDir = Join-Path $here '.run'
$probe = Join-Path $here 'probe-ports.mjs'

# Every app this script can serve, and its default port. The order is the order
# -Up starts them and -List prints them. shell is first because it is the host.
$appOrder = @('shell', 'odontogram', 'damoclesSword', 'landingV2', 'velista')
$basePort = @{
  shell         = 4200
  odontogram    = 4202
  damoclesSword = 4203
  landingV2     = 4204
  velista       = 4205
}
# Nx serves static remotes from a file server of its own at the host port plus one.
# -Up skips every remote so nothing binds it, but it is still part of the slot's
# range and must not be handed to another app.
$staticRemotesOffset = 1

# How high -Auto and -List will look. Ten concurrent front ends is far past what a
# laptop will build, and an open ended scan makes -List slow for no one's benefit.
$maxSlot = 9

# -Auto never takes slot 0, the same rule the backend has had since
# parallel-worktree-testing.md was written: slot 0 is the developer's own checkout,
# on the ports project.json names, and a worker that took it would collide with the
# browser tab they already have open. `ng-slot.ps1 0` is still accepted, because a
# person asking for it explicitly means it.
$minAutoSlot = 1

# Where velista points when nothing is running and nobody has said. Slot 0 is the
# developer's own backend, the one most likely to be up. It is the last rung of
# Find-BackendSlot, not a coupling to this slot's number.
$defaultBackendSlot = 0

function Get-PortFor([string]$app, [int]$slot) { return $basePort[$app] + $slot * 100 }

# Every port a slot occupies, the static remote file server included, so -Down,
# -List and the free slot search all agree on what "this slot is busy" means.
function Get-SlotPorts([int]$slot) {
  $ports = @()
  foreach ($app in $appOrder) { $ports += (Get-PortFor $app $slot) }
  $ports += ($basePort['shell'] + $staticRemotesOffset + $slot * 100)
  return $ports
}

# port -> open|closed|unknown, for a batch of ports in one node process. See the
# header of probe-ports.mjs for why this is not netstat.
function Get-PortStates([int[]]$ports) {
  $states = @{}
  if ($ports.Count -eq 0) { return $states }
  foreach ($line in (& node $probe @ports)) {
    $parts = $line -split "`t"
    if ($parts.Count -eq 2) { $states[[int]$parts[0]] = $parts[1] }
  }
  return $states
}

# Every checkout of this repository, this one included. `git worktree list` is the
# only source of truth; scanning .claude/worktrees would miss one created elsewhere
# and would list one already removed.
function Get-WorktreePaths {
  $paths = @()
  foreach ($line in (& git worktree list --porcelain 2>$null)) {
    if ($line -like 'worktree *') { $paths += $line.Substring(9).Trim() }
  }
  return $paths
}

# The slot a checkout is configured for, or $null. Read from the file the configure
# step writes, so a worktree states its own slot and no shared registry has to be
# kept in step with reality.
function Get-WorktreeSlot([string]$worktree) {
  $file = Join-Path $worktree 'tools/dev/.env.ng-slot'
  if (-not (Test-Path $file)) { return $null }
  foreach ($line in (Get-Content $file)) {
    if ($line -match '^NG_SLOT=(\d+)\s*$') { return [int]$Matches[1] }
  }
  return $null
}

function Write-EnvFile($path, $content) {
  Set-Content -Path $path -Value $content -Encoding utf8
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
# developer machine could be another worktree's dev server, the editor, or the
# thing the developer is actually working in. `/T` makes it worse by taking that
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

# --- which backend velista should talk to ------------------------------------
#
# Deliberately not "the same number as this slot". The two numberings are
# independent: a front end slot exists to stop two dev servers fighting over 4200,
# and a backend slot exists to stop two compose stacks fighting over 5432. Neither
# implies the other, and the usual arrangement is several front end worktrees all
# pointed at one backend, because most front end work needs a backend running, not
# a backend of its own.

# The luna slot this same worktree is configured for, if it runs its own backend.
# This is the real pairing when there is one: same worktree, not same number.
function Get-OwnBackendSlot {
  $file = Join-Path $root 'k8s/e2e/luna-shopper-backend/.env.slot'
  if (-not (Test-Path $file)) { return $null }
  foreach ($line in (Get-Content $file)) {
    if ($line -match '^LUNA_SLOT=(\d+)\s*$') { return [int]$Matches[1] }
  }
  return $null
}

# The backend slots whose gateway is answering right now.
function Get-RunningBackendSlots {
  $ports = @()
  for ($slot = 0; $slot -le $maxSlot; $slot++) { $ports += (3000 + $slot * 100) }
  $states = Get-PortStates $ports
  $slots = @()
  for ($slot = 0; $slot -le $maxSlot; $slot++) {
    if ($states[(3000 + $slot * 100)] -eq 'open') { $slots += $slot }
  }
  return $slots
}

# Returns the slot; explains the choice on the host, so the reason is visible
# without the value carrying it.
function Find-BackendSlot {
  $config = Read-SlotConfig
  if ($null -ne $config -and $config.ContainsKey('NG_BACKEND_SLOT')) {
    Write-Host 'keeping the backend slot this worktree already records'
    return [int]$config['NG_BACKEND_SLOT']
  }

  $own = Get-OwnBackendSlot
  if ($null -ne $own) {
    Write-Host "this worktree runs its own backend on luna slot $own"
    return $own
  }

  $running = @(Get-RunningBackendSlots)
  if ($running.Count -eq 1) {
    Write-Host "the only backend gateway listening is luna slot $($running[0])"
    return $running[0]
  }
  if ($running.Count -gt 1) {
    if ($running -contains 0) {
      Write-Host "several backends are up; taking slot 0, the shared one (-BackendSlot to pick another: $($running -join ', '))"
      return 0
    }
    Write-Host "several backends are up ($($running -join ', ')); taking the lowest, $($running[0]) (-BackendSlot to pick another)"
    return $running[0]
  }

  Write-Host 'no backend gateway is listening; pointing at luna slot 0, the default'
  return $defaultBackendSlot
}

function Write-SlotConfig([int]$slot, [int]$backendSlot) {
  $shellPort = Get-PortFor 'shell' $slot
  $odontogramPort = Get-PortFor 'odontogram' $slot
  $damoclesPort = Get-PortFor 'damoclesSword' $slot
  $landingPort = Get-PortFor 'landingV2' $slot
  $velistaPort = Get-PortFor 'velista' $slot
  $staticPort = $shellPort + $staticRemotesOffset
  $gatewayPort = 3000 + $backendSlot * 100
  $realtimePort = 3001 + $backendSlot * 100

  New-Item -ItemType Directory -Force -Path $runDir | Out-Null

  Write-EnvFile $slotEnv @"
# Generated by ng-slot.ps1 for slot $slot. Git ignored.
# This file is what makes the slot durable: -Up, -Down and every other worktree's
# -List read this worktree's slot back out of it.
NG_SLOT=$slot
NG_BACKEND_SLOT=$backendSlot
NG_SHELL_PORT=$shellPort
NG_STATIC_REMOTES_PORT=$staticPort
NG_ODONTOGRAM_PORT=$odontogramPort
NG_DAMOCLESSWORD_PORT=$damoclesPort
NG_LANDINGV2_PORT=$landingPort
NG_VELISTA_PORT=$velistaPort
"@

  # The shell resolves its remotes at build time (apps/shell/remote-urls.ts) and
  # already reads this variable in its dev config, so moving the remotes needs no
  # change to the shell at all. Every remote is named explicitly rather than left to
  # fall back, because a name absent from the map keeps the port the project graph
  # gave it, which on any slot but 0 is another worktree's.
  Write-EnvFile (Join-Path $root 'apps/shell/.env') @"
# Generated by ng-slot.ps1 (slot $slot). Git ignored.
# Nx loads {projectRoot}/.env into this project's tasks, so ``nx serve shell``
# picks this up with nothing exported by the caller.
MFE_REMOTE_URLS=odontogram=http://localhost:$odontogramPort,damoclesSword=http://localhost:$damoclesPort,landingV2=http://localhost:$landingPort,velista=http://localhost:$velistaPort
"@

  # velista is the only front end that talks to a backend, so it is the only one
  # whose slot has a second half. The pair defaults to the matching luna slot, which
  # is what makes "slot 2" one idea rather than two.
  Write-EnvFile (Join-Path $root 'apps/velista/.env') @"
# Generated by ng-slot.ps1 (slot $slot, luna-shopper slot $backendSlot). Git ignored.
# Read by apps/velista/webpack.config.ts and substituted into environment.ts at
# compile time, the same way webpack.prod.config.ts supplies the deployed hosts.
LUNA_GATEWAY_URL=http://localhost:$gatewayPort
LUNA_REALTIME_URL=http://localhost:$realtimePort
"@

  Write-Host ""
  Write-Host "Configured this worktree for Angular slot $slot."
  Write-Host "  shell         http://localhost:$shellPort"
  Write-Host "  odontogram    http://localhost:$odontogramPort"
  Write-Host "  damoclesSword http://localhost:$damoclesPort"
  Write-Host "  landingV2     http://localhost:$landingPort"
  Write-Host "  velista       http://localhost:$velistaPort   (own origin, plan 0013)"
  Write-Host "  reserved      $staticPort, held for Nx's static remote server"
  Write-Host "  backend       luna-shopper slot ${backendSlot}: gateway $gatewayPort, realtime $realtimePort"
  Write-Host ""
  Write-Host "Serve it:"
  Write-Host "  ./tools/dev/ng-slot.ps1 -Up"
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

  throw "no free Angular slot in ${minAutoSlot}..${maxSlot}: every one is claimed by another worktree or has something listening on it (slot 0 is the developer's own, and -Auto never takes it)"
}

function Read-SlotConfig {
  if (-not (Test-Path $slotEnv)) { return $null }
  $config = @{}
  foreach ($line in (Get-Content $slotEnv)) {
    if ($line -match '^([A-Z0-9_]+)=(.*)$') { $config[$Matches[1]] = $Matches[2].Trim() }
  }
  if (-not $config.ContainsKey('NG_SLOT')) { return $null }
  return $config
}

function Start-App([string]$app, [int]$port) {
  $nxArgs = @('nx', 'run', "${app}:serve", '--port', "$port", '--publicHost', "http://localhost:$port")
  if ($app -eq 'shell') {
    # Serve the host alone. The remotes are still in module-federation.config.ts so
    # the bundle still fetches them; MFE_REMOTE_URLS redirects it to this slot's
    # ports, and the tasks started beside it are what answer there.
    $nxArgs += @('--skipRemotes', 'odontogram,damoclesSword,landingV2,velista')
  }
  else {
    # Three remotes declare dependsOn shell:serve, which exists to stop somebody
    # opening a remote on its own port and seeing a blank page. The shell is already
    # being started beside them on this slot's port, so honouring it here would put a
    # second one on 4200 and recreate the collision this script exists to avoid.
    $nxArgs += '--excludeTaskDependencies'
  }

  Write-Host "==> $app on http://localhost:$port  (log: tools/dev/.run/$app.log)"
  # Two files, not one: PowerShell 5.1 refuses to redirect both streams to the same
  # path, and a webpack build writes progress to stderr even when it succeeds.
  $process = Start-Process -FilePath 'npx.cmd' -ArgumentList $nxArgs `
    -WorkingDirectory $root -NoNewWindow -PassThru `
    -RedirectStandardOutput (Join-Path $runDir "$app.log") `
    -RedirectStandardError (Join-Path $runDir "$app.err.log")
  Set-Content -Path (Join-Path $runDir "$app.pid") -Value $process.Id -Encoding utf8
}

# Wait until every port answers, or until the timeout. An -Up that returned as soon
# as the processes were spawned would report success while webpack was still on its
# first build, which is the same lie `helm upgrade` without --wait tells.
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

function Invoke-Up {
  $config = Read-SlotConfig

  # -Auto names the slot, not the verb, so `-Up -Auto` moves this worktree to a
  # fresh free slot rather than reusing the one it already claims.
  if ($Auto -and -not $Slot) { $Slot = "$(Find-FreeSlot)" }

  if ($Slot) {
    $backend = $BackendSlot
    if ($backend -lt 0) { $backend = Find-BackendSlot }
    Write-SlotConfig ([int]$Slot) $backend
    $config = Read-SlotConfig
  }
  elseif ($null -eq $config) {
    $free = Find-FreeSlot
    Write-Host "==> this worktree has no slot yet; taking the lowest free one: $free"
    $backend = $BackendSlot
    if ($backend -lt 0) { $backend = Find-BackendSlot }
    Write-SlotConfig $free $backend
    $config = Read-SlotConfig
  }
  elseif ($BackendSlot -ge 0 -and $BackendSlot -ne [int]$config['NG_BACKEND_SLOT']) {
    Write-SlotConfig ([int]$config['NG_SLOT']) $BackendSlot
    $config = Read-SlotConfig
  }

  $slotNumber = [int]$config['NG_SLOT']

  $wanted = $appOrder
  if ($Apps) {
    $wanted = $Apps -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ }
    foreach ($app in $wanted) {
      if (-not $basePort.ContainsKey($app)) {
        throw "unknown app '$app'; known: $($appOrder -join ', ')"
      }
    }
  }

  # Refuse rather than pile a second server onto a port somebody is already using. A
  # half started slot is harder to diagnose than one that never started.
  $ports = @()
  foreach ($app in $wanted) { $ports += (Get-PortFor $app $slotNumber) }
  $states = Get-PortStates $ports
  $busy = $false
  foreach ($app in $wanted) {
    $port = Get-PortFor $app $slotNumber
    if ($states[$port] -ne 'closed') {
      Write-Error "port $port ($app, slot $slotNumber) is already $($states[$port])" -ErrorAction Continue
      $busy = $true
    }
  }
  if ($busy) {
    throw 'nothing was started. Run -Down first, or -List to see who has this slot.'
  }

  New-Item -ItemType Directory -Force -Path $runDir | Out-Null
  foreach ($app in $wanted) { Start-App $app (Get-PortFor $app $slotNumber) }

  Write-Host "==> waiting up to ${Timeout}s for the first build of each app"
  if (Wait-ForPorts $ports $Timeout) {
    Write-Host ""
    Write-Host "Angular slot $slotNumber is up."
    foreach ($app in $wanted) {
      Write-Host ("  {0,-14} http://localhost:{1}" -f $app, (Get-PortFor $app $slotNumber))
    }
    Write-Host ""
    Write-Host "Remember the shell owns the outlet: open a remote at the shell's URL"
    Write-Host "(http://localhost:$($config['NG_SHELL_PORT'])/<app>/<locale>), not at its own port."
    Write-Host "velista is the exception and renders standalone on $($config['NG_VELISTA_PORT'])."
    return
  }

  $states = Get-PortStates $ports
  Write-Host ""
  Write-Host "timed out after ${Timeout}s. These are not answering yet:"
  foreach ($app in $wanted) {
    $port = Get-PortFor $app $slotNumber
    if ($states[$port] -ne 'open') {
      Write-Host "  $app ($port): $($states[$port]), see tools/dev/.run/$app.log"
    }
  }
  throw 'the processes are still running; -Down stops them.'
}

# Kill whatever holds a port, rather than the pid this script recorded. `nx serve`
# is a wrapper: the process that binds the port is a grandchild, so killing the
# recorded pid leaves the server running and the port taken, which is the one
# outcome -Down must not produce. The port is the thing being freed, so the port is
# what to resolve. /T takes the tree.
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

# Stop the recorded processes, then free the ports, then free them again.
#
# Killing by port alone is not enough, and the gap is not theoretical: an app that
# has been spawned but has not bound yet is invisible to a port sweep, so it
# survives the stop and binds a moment later, and the next -Up fails with "port
# 4300 is already open" over nothing visible.
#
# Scoped to the named apps rather than sweeping the whole .run directory, because
# `-Restart -Apps velista` must leave the shell's process and pid file alone.
function Stop-Apps([string[]]$apps, [int[]]$ports) {
  foreach ($app in $apps) {
    $pidFile = Join-Path $runDir "$app.pid"
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

# Bounce some of this slot's apps, leaving the rest of it serving.
#
# Almost nothing needs this. Every app is served with watch and live reload on, and
# watches its own files AND the libraries it consumes, so a source change anywhere
# recompiles and reaches the browser unaided. What does NOT reach a running server
# is the environment: Nx loads {projectRoot}/.env into a task when it starts it, and
# webpack evaluates MFE_REMOTE_URLS and the DefinePlugin values once while building
# its config. So after -BackendSlot or a slot move the server keeps the old URLs,
# and it does not look stuck: the write triggers a watch rebuild that silently
# reuses the startup values.
function Invoke-Restart {
  $config = Read-SlotConfig
  if ($null -eq $config) {
    throw 'this worktree has no slot configured, so there is nothing to restart.'
  }
  $slotNumber = [int]$config['NG_SLOT']

  $wanted = @()
  if ($Apps) {
    $wanted = $Apps -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ }
    foreach ($app in $wanted) {
      if (-not $basePort.ContainsKey($app)) {
        throw "unknown app '$app'; known: $($appOrder -join ', ')"
      }
    }
  }
  else {
    # Default to whatever this slot currently has up, so a restart never quietly
    # starts an app the worker had deliberately left out of -Up.
    $states = Get-PortStates (Get-SlotPorts $slotNumber)
    foreach ($app in $appOrder) {
      if ($states[(Get-PortFor $app $slotNumber)] -eq 'open') { $wanted += $app }
    }
    if ($wanted.Count -eq 0) {
      throw "nothing of Angular slot $slotNumber is running; use -Up to start it."
    }
  }

  $ports = @()
  foreach ($app in $wanted) { $ports += (Get-PortFor $app $slotNumber) }

  Write-Host "==> stopping $($wanted -join ', ')"
  [void](Stop-Apps $wanted $ports)

  New-Item -ItemType Directory -Force -Path $runDir | Out-Null
  foreach ($app in $wanted) { Start-App $app (Get-PortFor $app $slotNumber) }

  Write-Host "==> waiting up to ${Timeout}s for the restarted apps"
  if (Wait-ForPorts $ports $Timeout) {
    Write-Host "restarted on Angular slot ${slotNumber}: $($wanted -join ', ')"
    return
  }
  throw 'timed out; the processes are still running, see tools/dev/.run/*.log'
}

function Invoke-Down {
  $config = Read-SlotConfig
  if ($null -eq $config) {
    Write-Host 'this worktree has no slot configured, so there is nothing of its own to stop.'
    Write-Host 'Run -List to see which worktrees do.'
    return
  }

  $slotNumber = [int]$config['NG_SLOT']
  Write-Host "==> stopping Angular slot $slotNumber"
  if (-not (Stop-Apps $appOrder (Get-SlotPorts $slotNumber))) {
    Write-Host "  nothing was running on this slot's ports"
  }

  # Say plainly if a port survived. A -Down that reports success over a port it could
  # not free sends the next -Up into a collision it was meant to prevent.
  $states = Get-PortStates (Get-SlotPorts $slotNumber)
  foreach ($port in $states.Keys) {
    if ($states[$port] -ne 'closed') {
      Write-Warning "$port is still $($states[$port])"
    }
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

  # One node process for every port of every slot, so -List costs one round trip
  # rather than one per port.
  $allPorts = @()
  for ($slot = 0; $slot -le $maxSlot; $slot++) { $allPorts += (Get-SlotPorts $slot) }
  $states = Get-PortStates $allPorts

  Write-Host ""
  Write-Host 'Angular dev slots (ports are the default plus slot*100)'
  Write-Host ""
  Write-Host ('  {0,-4} {1,-7} {2,-40} {3}' -f 'SLOT', 'STATE', 'PORTS  shell/odtg/dsword/landing/velista', 'CLAIMED BY')

  for ($slot = 0; $slot -le $maxSlot; $slot++) {
    $slotPorts = Get-SlotPorts $slot
    $open = 0
    $unknown = 0
    foreach ($port in $slotPorts) {
      if ($states[$port] -eq 'open') { $open++ }
      elseif ($states[$port] -eq 'unknown') { $unknown++ }
    }

    $claim = @()
    if ($claimedBy.ContainsKey($slot)) { $claim = $claimedBy[$slot] }

    if ($open -eq 0 -and $unknown -eq 0) {
      if ($claim.Count -gt 0) { $stateLabel = 'idle' } else { $stateLabel = 'free' }
    }
    elseif ($open -eq $slotPorts.Count - 1) {
      # The static remote port is reserved and never served, so a fully up slot shows
      # one closed port. Calling that "partial" would flag every healthy slot.
      $stateLabel = 'up'
    }
    else { $stateLabel = 'partial' }

    if ($stateLabel -eq 'free' -and $claim.Count -eq 0) { continue }

    $portsCol = '{0} {1} {2} {3} {4}' -f (Get-PortFor 'shell' $slot), (Get-PortFor 'odontogram' $slot),
      (Get-PortFor 'damoclesSword' $slot), (Get-PortFor 'landingV2' $slot), (Get-PortFor 'velista' $slot)

    if ($claim.Count -eq 0) {
      # Something is listening that no checkout of this repository configured.
      Write-Host ('  {0,-4} {1,-7} {2,-40} {3}' -f $slot, $stateLabel, $portsCol, '(no worktree claims it)')
      continue
    }

    # Two worktrees on one slot is a real state and worth showing as two lines rather
    # than hiding one of them.
    for ($i = 0; $i -lt $claim.Count; $i++) {
      if ($i -eq 0) {
        Write-Host ('  {0,-4} {1,-7} {2,-40} {3}' -f $slot, $stateLabel, $portsCol, $claim[$i])
      }
      else {
        Write-Host ('  {0,-4} {1,-7} {2,-40} {3}' -f '', '', '', $claim[$i])
      }
    }
  }

  Write-Host ""
  Write-Host '  free     nothing claims it and nothing is listening: -Up can take it'
  Write-Host '  idle     a worktree is configured for it but is not serving'
  Write-Host '  up       every app of the slot is answering'
  Write-Host '  partial  some ports answer and some do not, or something else holds one'
  Write-Host ""
  Write-Host "Slots 0..$maxSlot with neither a claim nor a listener are omitted."
}

if ($List) { Invoke-List; return }
if ($Down) { Invoke-Down; return }
if ($Restart) { Invoke-Restart; return }
if ($Up) { Invoke-Up; return }

if ($Auto) {
  $free = Find-FreeSlot
  $backend = $BackendSlot
  if ($backend -lt 0) { $backend = Find-BackendSlot }
  Write-SlotConfig $free $backend
  return
}

if ($Slot -match '^\d+$') {
  $backend = $BackendSlot
  if ($backend -lt 0) { $backend = Find-BackendSlot }
  Write-SlotConfig ([int]$Slot) $backend
  return
}

Write-Host @'
usage:
  ng-slot.ps1 <slot> [-BackendSlot <n>]   configure this worktree for that slot
  ng-slot.ps1 -Auto [-BackendSlot <n>]    configure it for the lowest free slot
  ng-slot.ps1 -Up [<slot>] [-Apps a,b]    configure if needed, then serve
  ng-slot.ps1 -Restart [-Apps a,b]        bounce apps, keeping the rest serving
  ng-slot.ps1 -Down                       stop what this worktree started
  ng-slot.ps1 -List                       every worktree's slot, and what is live

Source changes need none of this: every app watches its own files and the
libraries it consumes, and live reloads. -Restart is for a changed .env (a slot
move, or -BackendSlot), which a running server cannot pick up.

options:
  -Apps a,b,c         limit -Up or -Restart to these apps
                      (-Up default: all five; -Restart default: whatever of this
                      slot is currently running)
  -BackendSlot <n>    which luna-shopper slot velista should talk to. It is NOT
                      this slot's number: the two numberings are independent, and
                      one backend can serve every front end slot at once. Left
                      out, the backend is worked out in this order:
                        1. the choice already recorded for this worktree
                        2. the luna slot this worktree runs itself, if any
                        3. the only backend gateway that is listening
                        4. backend slot 0 if it is listening
                        5. backend slot 0 anyway, with a note
  -Timeout <secs>     how long -Up waits for each app to answer (default 300)
'@
exit 2
