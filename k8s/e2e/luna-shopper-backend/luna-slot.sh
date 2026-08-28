#!/usr/bin/env bash
#
# luna-slot.sh — configure this checkout (a git worktree, usually) to run the
# Luna Shopper backend on an isolated "slot" so several worktrees can bring up
# the compose stack and `nx serve` the five services at the same time without
# fighting over ports, container names, or databases.
#
#   bash k8s/e2e/luna-shopper-backend/luna-slot.sh <slot>   configure for that slot
#   bash k8s/e2e/luna-shopper-backend/luna-slot.sh --auto    configure for the lowest free one
#   bash k8s/e2e/luna-shopper-backend/luna-slot.sh --up      configure if needed, then start it all
#   bash k8s/e2e/luna-shopper-backend/luna-slot.sh --down    stop it all
#   bash k8s/e2e/luna-shopper-backend/luna-slot.sh --list    every worktree's slot, and what is live
#
# What a slot is: an integer N. Every host port is its default + N*100, the
# compose project (and therefore its containers, network, and named volumes) is
# "luna-slot<N>", and the five services listen on 300{0..4}+N*100. Slot 0 is the
# original single stack (default ports, project "luna-shopper-backend" is kept for N=0
# so the plain `docker compose ... up` workflow still matches), so a lone
# worktree needs no slot at all.
#
# The front end has the same idea with the same arithmetic in `tools/dev/ng-slot.sh`,
# so "slot 2" means one thing across the whole app: shell 4400, velista 4405,
# gateway 3200, realtime 3201. That pairing is not decoration. The origins this
# script writes into CORS_ORIGINS and APP_BASE_URL are derived from the *same* slot
# number, so a worktree that takes slot 2 on both sides has a browser the gateway
# will actually answer. `--backend-slot` on ng-slot.sh is the escape hatch for the
# uncommon case where they differ.
#
# This script (re)writes, all git ignored, so it is safe per worktree:
#   - k8s/e2e/luna-shopper-backend/.env.slot   (compose: project name + host ports)
#   - apps/luna-shopper-backend/.env.luna-shopper-backend       (shared service vars)
#   - apps/luna-shopper-backend/{gateway,realtime,auth,core,catalog}/.env
#   - apps/luna-shopper-backend/secrets/jwt.{key,pub}   (generated once if absent)
#   - k8s/e2e/luna-shopper-backend/.run/       (logs and pids of what --up started)
#
# It is idempotent: run it again with the same slot to refresh, or a different
# slot to move this worktree.
set -euo pipefail

# Resolve the workspace root from this script's location (…/k8s/e2e/luna-shopper-backend).
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(cd "$here/../../.." && pwd)"
cd "$root"

SLOT_ENV="$here/.env.slot"
RUN_DIR="$here/.run"
PROBE="$root/tools/dev/probe-ports.mjs"

# The five Nest services, in the order --up starts them. Their ports are not passed
# on the command line: each service reads PORT out of its own .env, which this
# script wrote for this slot, so there is one place a port can be wrong.
SERVICES=(gateway realtime auth core catalog)

# How high --auto and --list will look. See the same constant in ng-slot.sh.
MAX_SLOT=9

# --auto never takes slot 0. `parallel-worktree-testing.md` has said so since it
# was written: slot 0 is the developer's own stack, on the ports their tools and
# their browser already point at, so a worker that took it would collide with the
# one checkout that cannot move. `luna-slot.sh 0` is still accepted, because
# asking for it explicitly means it.
MIN_AUTO_SLOT=1

usage() {
  cat >&2 <<'EOF'
usage:
  luna-slot.sh <slot>              configure this worktree for that slot
  luna-slot.sh --auto              configure it for the lowest free slot
  luna-slot.sh --up [<slot>]       configure if needed, then start everything
  luna-slot.sh --down              stop the services and take the stack down
  luna-slot.sh --list              every worktree's slot, and what is live

options:
  -p, --profile <name>   compose profile for --up / --down (e.g. observability)
  --keep-data            --down stops the containers instead of removing them
                         and their volumes, so the databases survive
  --timeout <secs>       how long --up waits for each service (default 180)

--up is the whole thing: it writes the .env files if they are missing, brings the
compose stack up and waits on its healthchecks, runs the migrations, then serves
all five services. --down is its inverse, and by default it removes this slot's
volumes, which is what `stack.sh down` has always meant here.
EOF
}

# --- slot arithmetic ---------------------------------------------------------
#
# One function, so every caller (write, list, probe, wait) derives ports the same
# way and none of them can hold a stale copy of the table.

slot_project() {
  # Slot 0 keeps the historic name so the no-slot workflow still matches.
  if [[ "$1" == "0" ]]; then echo 'luna-shopper-backend'; else echo "luna-slot$1"; fi
}

# The infrastructure compose brings up. `--wait` covers all of it, so a slot with
# some of these open and some closed is genuinely half started.
infra_ports() {
  local off=$(( $1 * 100 ))
  echo $(( 5432 + off ))   # auth-db
  echo $(( 5433 + off ))   # core-db
  echo $(( 5434 + off ))   # catalog-db
  echo $(( 4222 + off ))   # nats
  echo $(( 8222 + off ))   # nats monitoring
  echo $(( 6379 + off ))   # redis
  echo $(( 1025 + off ))   # smtp
  echo $(( 8025 + off ))   # mailpit ui
}

service_ports() {
  local off=$(( $1 * 100 )) i
  for i in 0 1 2 3 4; do echo $(( 3000 + i + off )); done
}

# Reserved per slot whether or not the `observability` profile is up, so two
# worktrees can each run a collector. Deliberately NOT counted when deciding
# whether a slot is up: the profile is opt in, and counting it would report every
# healthy slot as partial.
observability_ports() {
  local off=$(( $1 * 100 ))
  echo $(( 4317 + off ))    # otlp grpc
  echo $(( 4318 + off ))    # otlp http
  echo $(( 16686 + off ))   # jaeger ui
  echo $(( 9090 + off ))    # prometheus
  echo $(( 3010 + off ))    # grafana
}

slot_ports() {
  infra_ports "$1"
  service_ports "$1"
  observability_ports "$1"
}

probe_ports() {
  (( $# )) || return 0
  node "$PROBE" "$@"
}

# --- reading the other worktrees ---------------------------------------------

worktree_paths() {
  git worktree list --porcelain 2>/dev/null | awk '/^worktree /{ $1=""; sub(/^ /,""); print }'
}

# The slot a checkout is configured for, or nothing.
#
# LUNA_SLOT is written by this script. The COMPOSE_PROJECT_NAME fallback is for a
# .env.slot generated before that line existed: the project name has always encoded
# the slot, so an older file is still readable rather than silently invisible to
# --list, which would be the worst way to lose a collision.
slot_of_worktree() {
  local wt="$1" file="$wt/k8s/e2e/luna-shopper-backend/.env.slot" value
  [[ -f "$file" ]] || return 0

  value="$(sed -n 's/^LUNA_SLOT=\([0-9]\+\)[[:space:]]*$/\1/p' "$file" | head -n 1)"
  if [[ -n "$value" ]]; then echo "$value"; return 0; fi

  value="$(sed -n 's/^COMPOSE_PROJECT_NAME=\(.*\)$/\1/p' "$file" | head -n 1 | tr -d '\r')"
  case "$value" in
    luna-shopper-backend) echo 0 ;;
    luna-slot*) echo "${value#luna-slot}" ;;
  esac
}

# --- configure ---------------------------------------------------------------

require_openssl() {
  command -v openssl >/dev/null 2>&1 && return 0
  cat >&2 <<'EOF'
openssl is not on PATH, so the throwaway dev JWT keypair cannot be generated.
Git for Windows ships it; on Linux install the `openssl` package.
EOF
  return 1
}

write_config() {
  local slot="$1"
  local off=$(( slot * 100 ))

  # Host ports (compose). Kept > 100 apart per service so slots never overlap.
  local AUTH_DB_PORT=$(( 5432 + off ))
  local CORE_DB_PORT=$(( 5433 + off ))
  local CATALOG_DB_PORT=$(( 5434 + off ))
  local NATS_PORT=$(( 4222 + off ))
  local NATS_MON_PORT=$(( 8222 + off ))
  local REDIS_PORT=$(( 6379 + off ))
  local SMTP_PORT=$(( 1025 + off ))
  local MAILPIT_UI_PORT=$(( 8025 + off ))

  # Observability stack (plan 0016, section 9). Opt in via the `observability`
  # compose profile; these ports are reserved per slot either way so two worktrees
  # can each run their own collector without colliding.
  local OTLP_GRPC_PORT=$(( 4317 + off ))
  local OTLP_HTTP_PORT=$(( 4318 + off ))
  local JAEGER_UI_PORT=$(( 16686 + off ))
  local PROMETHEUS_PORT=$(( 9090 + off ))
  local GRAFANA_PORT=$(( 3010 + off ))

  # Service listen ports.
  local GATEWAY_PORT=$(( 3000 + off ))
  local REALTIME_PORT=$(( 3001 + off ))
  local AUTH_PORT=$(( 3002 + off ))
  local CORE_PORT=$(( 3003 + off ))
  local CATALOG_PORT=$(( 3004 + off ))

  # The front end of the same slot (tools/dev/ng-slot.sh). These are the origins a
  # browser will actually be on, so they are what CORS has to allow and what the
  # Google callback and the mail links have to point back at. Hardcoding 4200 here
  # meant every worktree past the first got a gateway that refused its own browser,
  # with a CORS error that says nothing about slots.
  local SHELL_PORT=$(( 4200 + off ))
  local VELISTA_PORT=$(( 4205 + off ))

  local project
  project="$(slot_project "$slot")"

  local secrets="$root/apps/luna-shopper-backend/secrets"
  mkdir -p "$secrets" "$RUN_DIR"
  if [[ ! -f "$secrets/jwt.key" ]]; then
    require_openssl || return 1
    echo "generating a throwaway dev JWT keypair in apps/luna-shopper-backend/secrets ..."
    openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out "$secrets/jwt.key" 2>/dev/null
    openssl pkey -in "$secrets/jwt.key" -pubout -out "$secrets/jwt.pub" 2>/dev/null
  fi

  # --- compose env-file ------------------------------------------------------
  cat > "$SLOT_ENV" <<EOF
# Generated by luna-slot.sh for slot ${slot}. Git ignored. Pass to compose with
#   docker compose --env-file k8s/e2e/luna-shopper-backend/.env.slot -f <compose> up -d
# LUNA_SLOT is not read by compose. It is here so --list, --up and --down, and the
# same three in every other worktree, can read this worktree's slot back out of the
# one file that already describes it.
LUNA_SLOT=${slot}
COMPOSE_PROJECT_NAME=${project}
LUNA_AUTH_DB_PORT=${AUTH_DB_PORT}
LUNA_CORE_DB_PORT=${CORE_DB_PORT}
LUNA_CATALOG_DB_PORT=${CATALOG_DB_PORT}
LUNA_NATS_PORT=${NATS_PORT}
LUNA_NATS_MONITOR_PORT=${NATS_MON_PORT}
LUNA_REDIS_PORT=${REDIS_PORT}
LUNA_SMTP_PORT=${SMTP_PORT}
LUNA_MAILPIT_UI_PORT=${MAILPIT_UI_PORT}
LUNA_OTLP_GRPC_PORT=${OTLP_GRPC_PORT}
LUNA_OTLP_HTTP_PORT=${OTLP_HTTP_PORT}
LUNA_JAEGER_UI_PORT=${JAEGER_UI_PORT}
LUNA_PROMETHEUS_PORT=${PROMETHEUS_PORT}
LUNA_GRAFANA_PORT=${GRAFANA_PORT}
# The collector scrapes the services on the host, so it needs their ports too.
LUNA_GATEWAY_PORT=${GATEWAY_PORT}
LUNA_REALTIME_PORT=${REALTIME_PORT}
LUNA_AUTH_PORT=${AUTH_PORT}
LUNA_CORE_PORT=${CORE_PORT}
LUNA_CATALOG_PORT=${CATALOG_PORT}
EOF

  # --- shared service env ----------------------------------------------------
  cat > "$root/apps/luna-shopper-backend/.env.luna-shopper-backend" <<EOF
# Generated by luna-slot.sh (slot ${slot}). Git ignored.
NATS_URL=nats://localhost:${NATS_PORT}
REDIS_URL=redis://localhost:${REDIS_PORT}
LOG_LEVEL=debug
# Both front end origins of this slot: the portfolio shell, which mounts velista as
# a remote, and velista's own origin, which is a first class way to run it (plan
# 0013) and was missing from this list even on slot 0.
CORS_ORIGINS=http://localhost:${SHELL_PORT},http://localhost:${VELISTA_PORT}
# Telemetry deliberately does NOT live here; see the note in each service's .env.
EOF

  # Telemetry (plan 0016), written into every service's own .env rather than the
  # shared file above. That placement is load bearing, not tidiness: the SDK starts
  # from `process.env` before Nest exists (section 4.1), and only @nestjs/config
  # ever reads `.env.luna-shopper-backend`, whose custom name nothing else knows.
  # Nx *does* load `{projectRoot}/.env` into the environment of that project's
  # tasks, so a variable put here reaches the SDK under `nx serve`; the same
  # variable in the shared file would be read too late and silently ignored.
  telemetry_env() {
    cat <<EOF

# --- Telemetry (plan 0016) ---------------------------------------------------
# Read by the OpenTelemetry SDK before Nest boots, so it has to be in this file
# rather than the shared one (Nx loads a project's own .env; nothing loads the
# shared file into the environment). Pointed at this slot's collector, which
# exists only while the \`observability\` compose profile is up. With the profile
# down the batch processor drops spans and warns, requests are unaffected, so
# leaving this on costs nothing; set OTEL_ENABLED=false to silence it.
OTEL_SERVICE_NAME=luna-shopper-backend-$1
OTEL_ENABLED=true
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:${OTLP_HTTP_PORT}
OTEL_TRACES_SAMPLER_ARG=1.0
DEPLOYMENT_ENVIRONMENT=development
METRICS_ENABLED=true
EOF
  }

  # --- per service env -------------------------------------------------------
  cat > "$root/apps/luna-shopper-backend/gateway/.env" <<EOF
# Generated by luna-slot.sh (slot ${slot}). Git ignored.
AUTH_JWT_PUBLIC_KEY_FILE=./apps/luna-shopper-backend/secrets/jwt.pub
PORT=${GATEWAY_PORT}
# Google sign in runs at the gateway (plan 0023), so the OAuth variables live
# here as well as in auth's env. The credentials are placeholders: with a client
# id set the routes are live, which is what lets the state mint and the refusal
# of a bad state be driven locally without a real consent screen.
GOOGLE_CLIENT_ID=your-dev-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-dev-client-secret
GOOGLE_CALLBACK_URL=http://localhost:${GATEWAY_PORT}/v1/auth/google/callback
# Where the callback sends the browser. {locale} is substituted with the locale
# the flow started in; the app sits under a path that follows the locale segment.
APP_BASE_URL=http://localhost:${SHELL_PORT}/{locale}/velista
EOF
  telemetry_env gateway >> "$root/apps/luna-shopper-backend/gateway/.env"

  cat > "$root/apps/luna-shopper-backend/realtime/.env" <<EOF
# Generated by luna-slot.sh (slot ${slot}). Git ignored.
AUTH_JWT_PUBLIC_KEY_FILE=./apps/luna-shopper-backend/secrets/jwt.pub
PORT=${REALTIME_PORT}
EOF
  telemetry_env realtime >> "$root/apps/luna-shopper-backend/realtime/.env"

  cat > "$root/apps/luna-shopper-backend/auth/.env" <<EOF
# Generated by luna-slot.sh (slot ${slot}). Git ignored.
AUTH_DB_URL=postgres://luna_auth:luna_auth@localhost:${AUTH_DB_PORT}/luna_auth
AUTH_JWT_PRIVATE_KEY_FILE=./apps/luna-shopper-backend/secrets/jwt.key
AUTH_JWT_PUBLIC_KEY_FILE=./apps/luna-shopper-backend/secrets/jwt.pub
AUTH_JWT_KID=dev-1
ACCESS_TOKEN_TTL=15m
REFRESH_TOKEN_TTL=30d
SMTP_HOST=localhost
SMTP_PORT=${SMTP_PORT}
SMTP_USER=
SMTP_PASS=
MAIL_FROM=Luna Shopper <no-reply@luna.localhost>
MAIL_VERIFY_BASE_URL=http://localhost:${SHELL_PORT}/verify-email
MAIL_RESET_BASE_URL=http://localhost:${SHELL_PORT}/reset-password
GOOGLE_CLIENT_ID=your-dev-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-dev-client-secret
GOOGLE_CALLBACK_URL=http://localhost:${GATEWAY_PORT}/auth/google/callback
PORT=${AUTH_PORT}
EOF
  telemetry_env auth >> "$root/apps/luna-shopper-backend/auth/.env"

  cat > "$root/apps/luna-shopper-backend/core/.env" <<EOF
# Generated by luna-slot.sh (slot ${slot}). Git ignored.
CORE_DB_URL=postgres://luna_core:luna_core@localhost:${CORE_DB_PORT}/luna_core
AUTH_JWT_PUBLIC_KEY_FILE=./apps/luna-shopper-backend/secrets/jwt.pub
PORT=${CORE_PORT}
EOF
  telemetry_env core >> "$root/apps/luna-shopper-backend/core/.env"

  cat > "$root/apps/luna-shopper-backend/catalog/.env" <<EOF
# Generated by luna-slot.sh (slot ${slot}). Git ignored.
CATALOG_DB_URL=postgres://luna_catalog:luna_catalog@localhost:${CATALOG_DB_PORT}/luna_catalog
AUTH_JWT_PUBLIC_KEY_FILE=./apps/luna-shopper-backend/secrets/jwt.pub
PLATFORM_ADMIN_USER_IDS=
PORT=${CATALOG_PORT}
EOF
  telemetry_env catalog >> "$root/apps/luna-shopper-backend/catalog/.env"

  cat <<EOF

Configured this worktree for Luna Shopper slot ${slot}.
  compose project : ${project}
  auth-db         : localhost:${AUTH_DB_PORT}      core-db  : localhost:${CORE_DB_PORT}
  catalog-db      : localhost:${CATALOG_DB_PORT}
  nats            : localhost:${NATS_PORT} (mon ${NATS_MON_PORT})
  redis           : localhost:${REDIS_PORT}
  smtp / mailpit  : localhost:${SMTP_PORT} / http://localhost:${MAILPIT_UI_PORT}
  gateway ${GATEWAY_PORT}   realtime ${REALTIME_PORT}   auth ${AUTH_PORT}   core ${CORE_PORT}   catalog ${CATALOG_PORT}
  otlp http/grpc  : localhost:${OTLP_HTTP_PORT} / ${OTLP_GRPC_PORT}
  jaeger / graf   : http://localhost:${JAEGER_UI_PORT} / http://localhost:${GRAFANA_PORT}
  prometheus      : http://localhost:${PROMETHEUS_PORT}
  browser origins : http://localhost:${SHELL_PORT} (shell) and http://localhost:${VELISTA_PORT} (velista)
                    matching Angular slot ${slot}; see tools/dev/ng-slot.sh

Start the whole thing (compose, migrations, all five services):
  bash k8s/e2e/luna-shopper-backend/luna-slot.sh --up

Or just the infrastructure, the way it has always worked:
  docker compose --env-file k8s/e2e/luna-shopper-backend/.env.slot \\
    -f k8s/e2e/luna-shopper-backend/compose.yml up -d
EOF
}

# The lowest slot no other worktree claims and nothing is listening on. Both
# conditions matter: a claim with nothing running is a worktree that is configured
# but idle and would collide the moment it starts, and an open port with no claim
# is something outside this repository that would collide right now.
find_free_slot() {
  local -A claimed=()
  local wt s self
  self="$(cd "$root" && pwd)"
  while IFS= read -r wt; do
    [[ -n "$wt" ]] || continue
    [[ "$(cd "$wt" 2>/dev/null && pwd)" == "$self" ]] && continue
    s="$(slot_of_worktree "$wt")"
    [[ -n "$s" ]] && claimed[$s]=1
  done < <(worktree_paths)

  local slot busy state
  local -a ports
  for (( slot = MIN_AUTO_SLOT; slot <= MAX_SLOT; slot++ )); do
    [[ -n "${claimed[$slot]:-}" ]] && continue
    mapfile -t ports < <(slot_ports "$slot")
    busy=0
    while IFS=$'\t' read -r _ state; do
      [[ "$state" == "closed" ]] || busy=1
    done < <(probe_ports "${ports[@]}")
    if (( ! busy )); then echo "$slot"; return 0; fi
  done

  echo "no free Luna slot in ${MIN_AUTO_SLOT}..${MAX_SLOT}: every one is claimed by another worktree or has something listening on it" >&2
  echo "(slot 0 is the developer's own, and --auto never takes it)" >&2
  return 1
}

require_config() {
  [[ -f "$SLOT_ENV" ]] || return 1
  # shellcheck disable=SC1090
  . "$SLOT_ENV"
  [[ -n "${LUNA_SLOT:-}" ]]
}

# --- up ----------------------------------------------------------------------

wait_for_ports() {
  local timeout="$1"; shift
  local -a ports=("$@")
  local deadline=$(( SECONDS + timeout ))
  local pending port state

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
  local requested_slot="$1" profile="$2" timeout="$3"

  if [[ -n "$requested_slot" ]]; then
    write_config "$requested_slot"
  elif ! require_config; then
    # "--up without generating the env file does that first" is the whole point:
    # an agent that has just made a worktree should need one command, not two.
    local slot
    slot="$(find_free_slot)"
    echo "==> this worktree has no slot yet; taking the lowest free one: ${slot}"
    write_config "$slot"
  fi

  require_config || { echo "could not read $SLOT_ENV after writing it" >&2; return 1; }

  # The compose stack and the migrations are stack.sh's job and it already does
  # them properly (up --wait on the healthchecks, then every migration). Calling it
  # rather than repeating it is what keeps compose the single definition of what
  # the infrastructure is; it reads the same .env.slot this script just wrote.
  local -a stack=(bash "$here/stack.sh")
  [[ -n "$profile" ]] && stack+=(--profile "$profile")
  "${stack[@]}" up

  mkdir -p "$RUN_DIR"
  local svc port
  local -a ports=()
  for svc in "${SERVICES[@]}"; do
    port="$(sed -n "s/^PORT=\([0-9]\+\)[[:space:]]*$/\1/p" "$root/apps/luna-shopper-backend/$svc/.env" | head -n 1)"
    if [[ -z "$port" ]]; then
      echo "no PORT in apps/luna-shopper-backend/$svc/.env; rerun luna-slot.sh $LUNA_SLOT" >&2
      return 1
    fi

    local state
    state="$(probe_ports "$port" | cut -f2)"
    if [[ "$state" != "closed" ]]; then
      echo "port $port ($svc, slot $LUNA_SLOT) is already $state; run --down first" >&2
      return 1
    fi

    echo "==> serving $svc on :$port  (log: k8s/e2e/luna-shopper-backend/.run/$svc.log)"
    npx nx run "luna-shopper-backend-$svc:serve" > "$RUN_DIR/$svc.log" 2>&1 &
    echo $! > "$RUN_DIR/$svc.pid"
    disown $! 2>/dev/null || true
    ports+=("$port")
  done

  echo "==> waiting up to ${timeout}s for the five services to listen"
  if wait_for_ports "$timeout" "${ports[@]}"; then
    echo
    echo "Luna Shopper slot $LUNA_SLOT is up."
    echo "  gateway  http://localhost:${LUNA_GATEWAY_PORT}"
    echo "  realtime http://localhost:${LUNA_REALTIME_PORT}"
    echo "  mailpit  http://localhost:${LUNA_MAILPIT_UI_PORT}"
    echo
    echo "Serve the matching front end with:  tools/dev/ng-slot.sh --up $LUNA_SLOT"
    return 0
  fi

  echo >&2
  echo "timed out after ${timeout}s. These are not listening yet:" >&2
  local i=0
  while IFS=$'\t' read -r port state; do
    [[ "$state" == "open" ]] || echo "  ${SERVICES[$i]} ($port): $state, see k8s/e2e/luna-shopper-backend/.run/${SERVICES[$i]}.log" >&2
    i=$(( i + 1 ))
  done < <(probe_ports "${ports[@]}")
  echo "The processes are still running; --down stops them." >&2
  return 1
}

# --- down --------------------------------------------------------------------

# Kill whatever holds a port, rather than the pid this script recorded: `nx run`
# is a wrapper, the process that binds is a grandchild, and on Windows the pid bash
# hands back is an MSYS pid taskkill does not recognise. The port is what has to be
# freed, so the port is what to resolve. Same reasoning as tools/dev/ng-slot.sh.
kill_port() {
  local port="$1" pid killed=0
  case "$(uname -s)" in
    MINGW* | MSYS* | CYGWIN*)
      while read -r pid; do
        [[ -n "$pid" && "$pid" != "0" ]] || continue
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
  local profile="$1" keep_data="$2"

  if ! require_config; then
    echo "this worktree has no slot configured, so there is nothing of its own to stop." >&2
    echo "Run --list to see which worktrees do." >&2
    return 0
  fi

  echo "==> stopping the services of Luna Shopper slot $LUNA_SLOT"
  local port stopped=0
  while IFS= read -r port; do
    if kill_port "$port"; then
      echo "  freed $port"
      stopped=$(( stopped + 1 ))
    fi
  done < <(service_ports "$LUNA_SLOT")
  (( stopped )) || echo "  none of the five were listening"
  rm -f "$RUN_DIR"/*.pid 2>/dev/null || true

  # Containers only ever hold the infra ports, so they are taken down by compose
  # rather than by killing a pid.
  if [[ -n "$keep_data" ]]; then
    echo "==> stopping the compose stack, keeping its volumes"
    local -a compose=(docker compose --env-file "$SLOT_ENV" -f "$here/compose.yml")
    [[ -n "$profile" ]] && compose+=(--profile "$profile")
    "${compose[@]}" stop
  else
    local -a stack=(bash "$here/stack.sh")
    [[ -n "$profile" ]] && stack+=(--profile "$profile")
    "${stack[@]}" down
  fi
}

# --- list --------------------------------------------------------------------

list() {
  local -A claimed_by=()
  local wt s self label
  self="$(cd "$root" && pwd)"

  while IFS= read -r wt; do
    [[ -n "$wt" ]] || continue
    s="$(slot_of_worktree "$wt")"
    [[ -n "$s" ]] || continue
    label="$wt"
    [[ "$(cd "$wt" 2>/dev/null && pwd)" == "$self" ]] && label="$wt  (this one)"
    if [[ -n "${claimed_by[$s]:-}" ]]; then
      claimed_by[$s]="${claimed_by[$s]}"$'\n'"$label"
    else
      claimed_by[$s]="$label"
    fi
  done < <(worktree_paths)

  # Every port of every slot in one node process, so --list is one round trip.
  local -a all_ports=()
  local slot p
  for (( slot = 0; slot <= MAX_SLOT; slot++ )); do
    while IFS= read -r p; do all_ports+=("$p"); done < <(slot_ports "$slot")
  done
  local -A state_of=()
  local port state
  while IFS=$'\t' read -r port state; do state_of[$port]="$state"; done \
    < <(probe_ports "${all_ports[@]}")

  # open/total for one group of ports, e.g. "3/8".
  count_open() {
    local open=0 total=0 pt
    while IFS= read -r pt; do
      total=$(( total + 1 ))
      [[ "${state_of[$pt]:-closed}" == "open" ]] && open=$(( open + 1 ))
    done < <("$@")
    echo "$open/$total"
  }

  echo
  echo "Luna Shopper dev slots (ports are the default plus slot*100)"
  echo
  printf '  %-4s %-20s %-9s %-9s %-7s %s\n' \
    'SLOT' 'COMPOSE PROJECT' 'INFRA' 'SERVICES' 'OBSERV' 'CLAIMED BY'

  local infra services observ claim first line
  for (( slot = 0; slot <= MAX_SLOT; slot++ )); do
    infra="$(count_open infra_ports "$slot")"
    services="$(count_open service_ports "$slot")"
    observ="$(count_open observability_ports "$slot")"
    claim="${claimed_by[$slot]:-}"

    # Nothing running and nobody configured for it: not worth a line.
    if [[ -z "$claim" && "$infra" == 0/* && "$services" == 0/* && "$observ" == 0/* ]]; then
      continue
    fi

    if [[ -z "$claim" ]]; then
      printf '  %-4s %-20s %-9s %-9s %-7s %s\n' \
        "$slot" "$(slot_project "$slot")" "$infra" "$services" "$observ" '(no worktree claims it)'
      continue
    fi

    first=1
    while IFS= read -r line; do
      if (( first )); then
        printf '  %-4s %-20s %-9s %-9s %-7s %s\n' \
          "$slot" "$(slot_project "$slot")" "$infra" "$services" "$observ" "$line"
        first=0
      else
        printf '  %-4s %-20s %-9s %-9s %-7s %s\n' '' '' '' '' '' "$line"
      fi
    done <<< "$claim"
  done

  echo
  echo "  INFRA     the three databases, NATS and its monitor, Redis, SMTP, Mailpit"
  echo "  SERVICES  gateway, realtime, auth, core, catalog"
  echo "  OBSERV    collector, Jaeger, Prometheus, Grafana: opt in, so 0/5 is normal"
  echo
  echo "A slot claimed with 0/8 infra is configured but not started: --up will take it."
  echo "Slots 0..${MAX_SLOT} with neither a claim nor a listener are omitted."
}

# --- argument parsing --------------------------------------------------------

action=''
slot_arg=''
profile=''
keep_data=''
timeout=180

while (( $# )); do
  case "$1" in
    --list) action='list'; shift ;;
    --up) action='up'; shift ;;
    --down) action='down'; shift ;;
    # --auto names the slot, not the verb, so `--up --auto` stays an --up.
    --auto) slot_arg='auto'; [[ -n "$action" ]] || action='configure'; shift ;;
    -p | --profile) profile="${2:-}"; shift 2 ;;
    -p=* | --profile=*) profile="${1#*=}"; shift ;;
    --keep-data) keep_data=1; shift ;;
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

if [[ ! "$timeout" =~ ^[0-9]+$ ]]; then
  echo "--timeout takes a number of seconds" >&2
  exit 2
fi

if [[ "$slot_arg" == 'auto' ]]; then
  slot_arg="$(find_free_slot)"
fi

case "${action:-}" in
  list) list ;;
  down) down "$profile" "$keep_data" ;;
  up) up "$slot_arg" "$profile" "$timeout" ;;
  configure) write_config "$slot_arg" ;;
  *) usage; exit 2 ;;
esac
