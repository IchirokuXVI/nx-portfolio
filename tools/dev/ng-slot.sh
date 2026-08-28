#!/usr/bin/env bash
#
# ng-slot.sh — run the Angular apps (shell plus the four remotes) from a git
# worktree on an isolated "slot", so several worktrees, and therefore several
# agents, can serve the front end at the same time without fighting over ports.
#
# It is the front end twin of k8s/e2e/luna-shopper-backend/luna-slot.sh and uses
# the same arithmetic, so "slot 2" means the same thing on both sides of the app.
#
#   tools/dev/ng-slot.sh <slot>          configure this worktree for that slot
#   tools/dev/ng-slot.sh --auto          configure it for the lowest free slot
#   tools/dev/ng-slot.sh --up [<slot>]   configure if needed, then serve
#   tools/dev/ng-slot.sh --down          stop what this worktree started
#   tools/dev/ng-slot.sh --list          every worktree's slot, and what is live
#
# --- what a slot is ----------------------------------------------------------
#
# An integer N. Every port is its default plus N*100:
#
#   shell 4200   (static remotes 4201)   odontogram 4202
#   damoclesSword 4203   landingV2 4204   velista 4205
#
# Slot 0 is the ports the project.json files already name, so a lone worktree
# needs no slot at all and the plain `npx nx serve shell` workflow is unchanged.
#
# --- why the ports are not simply overridden in project.json -----------------
#
# Because they cannot be. `nx serve shell` runs the module federation dev server,
# which starts the remotes itself and reads each one's port straight out of the
# project graph (`@nx/module-federation/src/utils/parse-static-remotes-config.js`
# and `get-remotes-for-host.js` both do `targets['serve'].options.port`). There is
# no flag and no environment variable for it, and project.json is committed, so a
# worktree cannot move those ports without a diff every branch would carry.
#
# So this script does not ask Nx to orchestrate the remotes. It serves each app as
# its own task with `--port` on the command line, which every app accepts, and
# hands the shell:
#
#   --skipRemotes  so the dev server serves only the host and leaves the remotes
#                  to the tasks started beside it, and
#   MFE_REMOTE_URLS  so the bundle it builds looks for those remotes on the
#                  slot's ports instead of the defaults baked into the graph.
#
# `--excludeTaskDependencies` goes on the remotes because three of them declare
# `dependsOn: ['shell:serve']`, which exists to stop somebody opening a remote on
# its own port and seeing a blank page. Here the shell is already being started
# beside them, on this slot's port, so letting Nx start a second one on 4200 would
# recreate exactly the collision this script exists to avoid.
#
# --- what it writes (all git ignored, so it is safe per worktree) ------------
#
#   tools/dev/.env.ng-slot   the slot descriptor, read back by --up/--down/--list
#   apps/shell/.env          MFE_REMOTE_URLS for this slot
#   apps/velista/.env        LUNA_GATEWAY_URL / LUNA_REALTIME_URL for the backend slot
#   tools/dev/.run/          one .pid and one .log per served app
#
# The two app level files are picked up on their own: Nx loads `{projectRoot}/.env`
# into the environment of that project's tasks, which is the same mechanism the
# luna services already rely on. Nothing has to be exported by the caller.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(cd "$here/../.." && pwd)"
cd "$root"

SLOT_ENV="$here/.env.ng-slot"
RUN_DIR="$here/.run"
PROBE="$here/probe-ports.mjs"

# Every app this script can serve, and its default port. The order is the order
# --up starts them and --list prints them. `shell` is first because it is the host.
APPS=(shell odontogram damoclesSword landingV2 velista)
declare -A BASE_PORT=(
  [shell]=4200
  [odontogram]=4202
  [damoclesSword]=4203
  [landingV2]=4204
  [velista]=4205
)
# Nx serves static remotes from a file server of its own at the host port plus one.
# --up skips every remote so nothing binds it, but it is still part of the slot's
# range and must not be handed to another app.
STATIC_REMOTES_OFFSET=1

# How high --auto and --list will look. Ten concurrent front ends is far past what
# a laptop will build, and an open ended scan makes --list slow for no one's
# benefit.
MAX_SLOT=9

# --auto never takes slot 0, which is the same rule the backend has had since
# `parallel-worktree-testing.md` was written: slot 0 is the developer's own
# checkout, on the ports project.json names, and a worker that took it would
# collide with the browser tab they already have open. `ng-slot.sh 0` is still
# accepted, because a person asking for it explicitly means it.
MIN_AUTO_SLOT=1

usage() {
  cat >&2 <<'EOF'
usage:
  ng-slot.sh <slot> [--backend-slot <n>]   configure this worktree for that slot
  ng-slot.sh --auto [--backend-slot <n>]   configure it for the lowest free slot
  ng-slot.sh --up [<slot>] [--apps a,b]    configure if needed, then serve
  ng-slot.sh --down                        stop what this worktree started
  ng-slot.sh --list                        every worktree's slot, and what is live

options:
  --apps a,b,c        limit --up to these apps (default: all five)
  --backend-slot <n>  which luna-shopper slot velista should talk to
                      (default: the same number as this slot)
  --timeout <secs>    how long --up waits for each app to answer (default 300)
EOF
}

# --- slot arithmetic ---------------------------------------------------------

port_for() { echo $(( BASE_PORT[$1] + $2 * 100 )); }

# Every port a slot occupies, including the static remote file server that --up
# never starts. Used by --down, --list and the free slot search, so all three agree
# on what "this slot is busy" means.
slot_ports() {
  local slot="$1" app
  for app in "${APPS[@]}"; do
    port_for "$app" "$slot"
  done
  echo $(( BASE_PORT[shell] + STATIC_REMOTES_OFFSET + slot * 100 ))
}

# --- reading the other worktrees ---------------------------------------------

# Every checkout of this repository, this one included. `git worktree list` is the
# only source of truth for that; scanning .claude/worktrees would miss a worktree
# created anywhere else and would list one that has already been removed.
worktree_paths() {
  git worktree list --porcelain 2>/dev/null | awk '/^worktree /{ $1=""; sub(/^ /,""); print }'
}

# The slot a checkout is configured for, or nothing. Read from the file the
# configure step writes, so a worktree states its own slot and no shared registry
# has to be kept in step with reality.
slot_of_worktree() {
  local wt="$1" file="$wt/tools/dev/.env.ng-slot"
  [[ -f "$file" ]] || return 0
  sed -n 's/^NG_SLOT=\([0-9]\+\)[[:space:]]*$/\1/p' "$file" | head -n 1
}

# port -> open|closed|unknown, for a batch of ports in one node process.
probe_ports() {
  (( $# )) || return 0
  node "$PROBE" "$@"
}

# --- configure ---------------------------------------------------------------

write_config() {
  local slot="$1" backend_slot="$2"
  local off=$(( slot * 100 )) boff=$(( backend_slot * 100 ))

  local shell_port odontogram_port damocles_port landing_port velista_port
  shell_port=$(port_for shell "$slot")
  odontogram_port=$(port_for odontogram "$slot")
  damocles_port=$(port_for damoclesSword "$slot")
  landing_port=$(port_for landingV2 "$slot")
  velista_port=$(port_for velista "$slot")

  local gateway_port=$(( 3000 + boff )) realtime_port=$(( 3001 + boff ))

  mkdir -p "$RUN_DIR"

  cat > "$SLOT_ENV" <<EOF
# Generated by ng-slot.sh for slot ${slot}. Git ignored.
# This file is what makes the slot durable: --up, --down and every other
# worktree's --list read this worktree's slot back out of it.
NG_SLOT=${slot}
NG_BACKEND_SLOT=${backend_slot}
NG_SHELL_PORT=${shell_port}
NG_STATIC_REMOTES_PORT=$(( shell_port + STATIC_REMOTES_OFFSET ))
NG_ODONTOGRAM_PORT=${odontogram_port}
NG_DAMOCLESSWORD_PORT=${damocles_port}
NG_LANDINGV2_PORT=${landing_port}
NG_VELISTA_PORT=${velista_port}
EOF

  # The shell resolves its remotes at build time (apps/shell/remote-urls.ts), and
  # already reads this variable in the dev config, so moving the remotes needs no
  # change to the shell at all. Every remote is named explicitly rather than left
  # to fall back, because a name absent from the map keeps the port the project
  # graph gave it, which on any slot but 0 is another worktree's.
  cat > "$root/apps/shell/.env" <<EOF
# Generated by ng-slot.sh (slot ${slot}). Git ignored.
# Nx loads {projectRoot}/.env into this project's tasks, so \`nx serve shell\`
# picks this up with nothing exported by the caller.
MFE_REMOTE_URLS=odontogram=http://localhost:${odontogram_port},damoclesSword=http://localhost:${damocles_port},landingV2=http://localhost:${landing_port},velista=http://localhost:${velista_port}
EOF

  # velista is the only front end that talks to a backend, so it is the only one
  # whose slot has a second half. The pair defaults to the matching luna slot,
  # which is what makes "slot 2" one idea rather than two.
  cat > "$root/apps/velista/.env" <<EOF
# Generated by ng-slot.sh (slot ${slot}, luna-shopper slot ${backend_slot}). Git ignored.
# Read by apps/velista/webpack.config.ts and substituted into environment.ts at
# compile time, the same way webpack.prod.config.ts supplies the deployed hosts.
LUNA_GATEWAY_URL=http://localhost:${gateway_port}
LUNA_REALTIME_URL=http://localhost:${realtime_port}
EOF

  cat <<EOF

Configured this worktree for Angular slot ${slot}.
  shell         http://localhost:${shell_port}
  odontogram    http://localhost:${odontogram_port}
  damoclesSword http://localhost:${damocles_port}
  landingV2     http://localhost:${landing_port}
  velista       http://localhost:${velista_port}   (own origin, plan 0013)
  reserved      $(( shell_port + STATIC_REMOTES_OFFSET )), held for Nx's static remote server
  backend       luna-shopper slot ${backend_slot}: gateway ${gateway_port}, realtime ${realtime_port}

Serve it:
  tools/dev/ng-slot.sh --up
EOF
}

# The lowest slot no other worktree claims and nothing is listening on. Both
# conditions matter: a claim with nothing running is a worktree that is configured
# but idle and would collide the moment it starts, and an open port with no claim
# is something outside this repository that would collide right now.
find_free_slot() {
  local -A claimed=()
  local wt s
  local self
  self="$(cd "$root" && pwd)"
  while IFS= read -r wt; do
    [[ -n "$wt" ]] || continue
    [[ "$(cd "$wt" 2>/dev/null && pwd)" == "$self" ]] && continue
    s="$(slot_of_worktree "$wt")"
    [[ -n "$s" ]] && claimed[$s]=1
  done < <(worktree_paths)

  local slot ports state busy
  for (( slot = MIN_AUTO_SLOT; slot <= MAX_SLOT; slot++ )); do
    [[ -n "${claimed[$slot]:-}" ]] && continue
    mapfile -t ports < <(slot_ports "$slot")
    busy=0
    while IFS=$'\t' read -r _ state; do
      [[ "$state" == "closed" ]] || busy=1
    done < <(probe_ports "${ports[@]}")
    if (( ! busy )); then
      echo "$slot"
      return 0
    fi
  done

  echo "no free Angular slot in ${MIN_AUTO_SLOT}..${MAX_SLOT}: every one is claimed by another worktree or has something listening on it" >&2
  echo "(slot 0 is the developer's own, and --auto never takes it)" >&2
  return 1
}

# --- serving -----------------------------------------------------------------

require_config() {
  [[ -f "$SLOT_ENV" ]] || return 1
  # shellcheck disable=SC1090
  . "$SLOT_ENV"
  [[ -n "${NG_SLOT:-}" ]]
}

serve_app() {
  local app="$1" slot="$2" port="$3"
  local log="$RUN_DIR/$app.log" pidfile="$RUN_DIR/$app.pid"
  local -a cmd=(npx nx run "$app:serve" --port "$port" --publicHost "http://localhost:$port")

  if [[ "$app" == "shell" ]]; then
    # Serve the host alone. The remotes are still in module-federation.config.ts,
    # so the bundle still fetches them; MFE_REMOTE_URLS is what redirects it to
    # this slot's ports, and the tasks started below are what answer there.
    cmd+=(--skipRemotes "odontogram,damoclesSword,landingV2,velista")
  else
    # See the note at the top: three remotes declare dependsOn shell:serve, and
    # honouring it here would start a second shell on the default port.
    cmd+=(--excludeTaskDependencies)
  fi

  echo "==> $app on http://localhost:$port  (log: tools/dev/.run/$app.log)"
  "${cmd[@]}" > "$log" 2>&1 &
  echo $! > "$pidfile"
  disown $! 2>/dev/null || true
}

# Wait until every port answers, or until the timeout. An `--up` that returned as
# soon as the processes were spawned would report success while webpack was still
# on its first build, which is the same lie `helm upgrade` without --wait tells.
wait_for_ports() {
  local timeout="$1"; shift
  local -a ports=("$@")
  local deadline=$(( SECONDS + timeout ))
  local pending state port

  while (( SECONDS < deadline )); do
    pending=0
    while IFS=$'\t' read -r port state; do
      [[ "$state" == "open" ]] || pending=$(( pending + 1 ))
    done < <(probe_ports "${ports[@]}")
    (( pending == 0 )) && return 0
    sleep 2
  done

  return 1
}

up() {
  local requested_slot="$1" backend_slot="$2" apps_csv="$3" timeout="$4"

  if [[ -n "$requested_slot" ]]; then
    write_config "$requested_slot" "${backend_slot:-$requested_slot}"
  elif ! require_config; then
    local slot
    slot="$(find_free_slot)"
    echo "==> this worktree has no slot yet; taking the lowest free one: ${slot}"
    write_config "$slot" "${backend_slot:-$slot}"
  elif [[ -n "$backend_slot" && "$backend_slot" != "${NG_BACKEND_SLOT:-}" ]]; then
    write_config "$NG_SLOT" "$backend_slot"
  fi

  require_config || { echo "could not read $SLOT_ENV after writing it" >&2; return 1; }

  local -a wanted=()
  if [[ -n "$apps_csv" ]]; then
    IFS=',' read -r -a wanted <<< "$apps_csv"
    local app
    for app in "${wanted[@]}"; do
      [[ -n "${BASE_PORT[$app]:-}" ]] || { echo "unknown app '$app'; known: ${APPS[*]}" >&2; return 2; }
    done
  else
    wanted=("${APPS[@]}")
  fi

  # Refuse rather than pile a second server onto a port somebody is already using.
  # A half started slot is harder to diagnose than one that never started.
  local app port state busy=0
  for app in "${wanted[@]}"; do
    port=$(port_for "$app" "$NG_SLOT")
    state="$(probe_ports "$port" | cut -f2)"
    if [[ "$state" != "closed" ]]; then
      echo "port $port ($app, slot $NG_SLOT) is already $state" >&2
      busy=1
    fi
  done
  if (( busy )); then
    echo "nothing was started. Run --down first, or --list to see who has this slot." >&2
    return 1
  fi

  mkdir -p "$RUN_DIR"
  local -a ports=()
  for app in "${wanted[@]}"; do
    port=$(port_for "$app" "$NG_SLOT")
    serve_app "$app" "$NG_SLOT" "$port"
    ports+=("$port")
  done

  echo "==> waiting up to ${timeout}s for the first build of each app"
  if wait_for_ports "$timeout" "${ports[@]}"; then
    echo
    echo "Angular slot $NG_SLOT is up."
    for app in "${wanted[@]}"; do
      printf '  %-14s http://localhost:%s\n' "$app" "$(port_for "$app" "$NG_SLOT")"
    done
    echo
    echo "Remember the shell owns the outlet: open a remote at the shell's URL"
    echo "(http://localhost:$NG_SHELL_PORT/<app>/<locale>), not at its own port."
    echo "velista is the exception and renders standalone on $NG_VELISTA_PORT."
    return 0
  fi

  echo >&2
  echo "timed out after ${timeout}s. These are not answering yet:" >&2
  while IFS=$'\t' read -r port state; do
    [[ "$state" == "open" ]] && continue
    for app in "${wanted[@]}"; do
      [[ "$(port_for "$app" "$NG_SLOT")" == "$port" ]] && echo "  $app ($port): $state, see tools/dev/.run/$app.log" >&2
    done
  done < <(probe_ports "${ports[@]}")
  echo "The processes are still running; --down stops them." >&2
  return 1
}

# --- stopping ----------------------------------------------------------------

# Kill whatever holds a port, rather than the pid this script recorded.
#
# `nx serve` is a wrapper: the process that binds the port is a grandchild, and on
# Windows the pid bash hands back is an MSYS pid that taskkill does not recognise.
# Killing the recorded pid therefore leaves the server running and the port taken,
# which is the one outcome --down must not produce. The port is the thing being
# freed, so the port is what to resolve.
kill_port() {
  local port="$1" pid killed=0
  case "$(uname -s)" in
    MINGW* | MSYS* | CYGWIN*)
      # Windows netstat: Proto, Local Address, Foreign Address, State, PID.
      while read -r pid; do
        [[ -n "$pid" && "$pid" != "0" ]] || continue
        # //F //T: the whole tree, because the node process that binds the port is
        # a child of the one npx started. The doubled slash is MSYS path escaping.
        taskkill //F //T //PID "$pid" >/dev/null 2>&1 && killed=1
      done < <(netstat -ano | tr -d '\r' | awk -v p=":$port\$" '$1=="TCP" && $2 ~ p && $4=="LISTENING" { print $5 }' | sort -u)
      ;;
    *)
      if command -v lsof >/dev/null 2>&1; then
        while read -r pid; do
          [[ -n "$pid" ]] || continue
          kill -TERM "$pid" 2>/dev/null && killed=1
        done < <(lsof -ti "tcp:$port" -sTCP:LISTEN 2>/dev/null | sort -u)
      elif command -v fuser >/dev/null 2>&1; then
        fuser -k "$port/tcp" >/dev/null 2>&1 && killed=1
      fi
      ;;
  esac
  return $(( killed ? 0 : 1 ))
}

down() {
  if ! require_config; then
    echo "this worktree has no slot configured, so there is nothing of its own to stop." >&2
    echo "Run --list to see which worktrees do." >&2
    return 0
  fi

  echo "==> stopping Angular slot $NG_SLOT"
  local port stopped=0
  while IFS= read -r port; do
    if kill_port "$port"; then
      echo "  freed $port"
      stopped=$(( stopped + 1 ))
    fi
  done < <(slot_ports "$NG_SLOT")

  rm -f "$RUN_DIR"/*.pid 2>/dev/null || true

  if (( stopped == 0 )); then
    echo "  nothing was listening on this slot's ports"
  fi

  # Say plainly if a port survived. A --down that reports success over a port it
  # could not free sends the next --up into a collision it was meant to prevent.
  local -a ports=()
  local state
  mapfile -t ports < <(slot_ports "$NG_SLOT")
  while IFS=$'\t' read -r port state; do
    [[ "$state" == "closed" ]] || echo "  WARNING: $port is still $state" >&2
  done < <(probe_ports "${ports[@]}")
}

# --- listing -----------------------------------------------------------------

list() {
  local -A claimed_by=()
  local wt s self
  self="$(cd "$root" && pwd)"

  while IFS= read -r wt; do
    [[ -n "$wt" ]] || continue
    s="$(slot_of_worktree "$wt")"
    [[ -n "$s" ]] || continue
    local label="$wt"
    [[ "$(cd "$wt" 2>/dev/null && pwd)" == "$self" ]] && label="$wt  (this one)"
    if [[ -n "${claimed_by[$s]:-}" ]]; then
      claimed_by[$s]="${claimed_by[$s]}"$'\n'"$label"
    else
      claimed_by[$s]="$label"
    fi
  done < <(worktree_paths)

  # One node process for every port of every slot, so --list costs one round trip
  # rather than one per port.
  local -a all_ports=()
  local slot
  for (( slot = 0; slot <= MAX_SLOT; slot++ )); do
    while IFS= read -r p; do all_ports+=("$p"); done < <(slot_ports "$slot")
  done
  local -A state_of=()
  local port state
  while IFS=$'\t' read -r port state; do
    state_of[$port]="$state"
  done < <(probe_ports "${all_ports[@]}")

  echo
  echo "Angular dev slots (ports are the default plus slot*100)"
  echo
  printf '  %-4s %-6s %-46s %s\n' 'SLOT' 'STATE' 'PORTS  shell/odtg/dsword/landing/velista' 'CLAIMED BY'
  for (( slot = 0; slot <= MAX_SLOT; slot++ )); do
    local -a ports=()
    mapfile -t ports < <(slot_ports "$slot")

    local open=0 unknown=0
    for port in "${ports[@]}"; do
      case "${state_of[$port]:-closed}" in
        open) open=$(( open + 1 )) ;;
        unknown) unknown=$(( unknown + 1 )) ;;
      esac
    done

    local claim="${claimed_by[$slot]:-}"
    local state_label
    if (( open == 0 && unknown == 0 )); then
      [[ -n "$claim" ]] && state_label='idle' || state_label='free'
    elif (( open == ${#ports[@]} - 1 )); then
      # The static remote port is reserved and never served, so a fully up slot
      # shows one closed port. Calling that "partial" would flag every healthy slot.
      state_label='up'
    else
      state_label='partial'
    fi

    # A free slot nobody claims is the common case and says nothing worth a line.
    if [[ "$state_label" == 'free' && -z "$claim" ]]; then
      continue
    fi

    local ports_col
    ports_col="$(printf '%s %s %s %s %s' \
      "$(port_for shell "$slot")" "$(port_for odontogram "$slot")" \
      "$(port_for damoclesSword "$slot")" "$(port_for landingV2 "$slot")" \
      "$(port_for velista "$slot")")"

    if [[ -z "$claim" ]]; then
      # Something is listening that no checkout of this repository configured.
      printf '  %-4s %-6s %-46s %s\n' "$slot" "$state_label" "$ports_col" '(no worktree claims it)'
      continue
    fi

    # Two worktrees on one slot is a real state and worth showing as two lines
    # rather than hiding one of them.
    local first=1 line
    while IFS= read -r line; do
      if (( first )); then
        printf '  %-4s %-6s %-46s %s\n' "$slot" "$state_label" "$ports_col" "$line"
        first=0
      else
        printf '  %-4s %-6s %-46s %s\n' '' '' '' "$line"
      fi
    done <<< "$claim"
  done

  echo
  echo "  free     nothing claims it and nothing is listening: --up can take it"
  echo "  idle     a worktree is configured for it but is not serving"
  echo "  up       every app of the slot is answering"
  echo "  partial  some ports answer and some do not, or something else holds one"
  echo
  echo "Slots 0..${MAX_SLOT} with neither a claim nor a listener are omitted."
}

# --- argument parsing --------------------------------------------------------

action=''
slot_arg=''
backend_slot=''
apps_csv=''
timeout=300

while (( $# )); do
  case "$1" in
    --list) action='list'; shift ;;
    --up) action='up'; shift ;;
    --down) action='down'; shift ;;
    # --auto names the slot, not the verb, so `--up --auto` stays an --up.
    --auto) slot_arg='auto'; [[ -n "$action" ]] || action='configure'; shift ;;
    --apps) apps_csv="${2:-}"; shift 2 ;;
    --apps=*) apps_csv="${1#*=}"; shift ;;
    --backend-slot) backend_slot="${2:-}"; shift 2 ;;
    --backend-slot=*) backend_slot="${1#*=}"; shift ;;
    --timeout) timeout="${2:-}"; shift 2 ;;
    --timeout=*) timeout="${1#*=}"; shift ;;
    -h | --help) usage; exit 0 ;;
    [0-9]*)
      slot_arg="$1"
      [[ -n "$action" ]] || action='configure'
      shift
      ;;
    *) echo "unknown argument: $1" >&2; usage; exit 2 ;;
  esac
done

if [[ -n "$backend_slot" && ! "$backend_slot" =~ ^[0-9]+$ ]]; then
  echo "--backend-slot takes a non-negative integer" >&2
  exit 2
fi
if [[ ! "$timeout" =~ ^[0-9]+$ ]]; then
  echo "--timeout takes a number of seconds" >&2
  exit 2
fi

if [[ "$slot_arg" == 'auto' ]]; then
  slot_arg="$(find_free_slot)"
fi

case "${action:-}" in
  list) list ;;
  down) down ;;
  up) up "$slot_arg" "$backend_slot" "$apps_csv" "$timeout" ;;
  configure) write_config "$slot_arg" "${backend_slot:-$slot_arg}" ;;
  *) usage; exit 2 ;;
esac
