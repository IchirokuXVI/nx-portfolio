#!/usr/bin/env bash
#
# luna-slot.sh — configure this checkout (a git worktree, usually) to run the
# Luna Shopper backend on an isolated "slot" so several worktrees can bring up
# the compose stack and `nx serve` the backend services at the same time without
# fighting over ports, container names, or databases.
#
#   bash k8s/e2e/luna-shopper-backend/luna-slot.sh <slot>   configure for that slot
#   bash k8s/e2e/luna-shopper-backend/luna-slot.sh --auto    configure for the lowest free one
#   bash k8s/e2e/luna-shopper-backend/luna-slot.sh --up      configure if needed, then start it all
#   bash k8s/e2e/luna-shopper-backend/luna-slot.sh --restart bounce the services, keep the databases
#   bash k8s/e2e/luna-shopper-backend/luna-slot.sh --down    stop it all
#   bash k8s/e2e/luna-shopper-backend/luna-slot.sh --list    every worktree's slot, and what is live
#
# You almost never need --restart, and even less often --down. `nx serve` is
# `@nx/js:node` with `watch` defaulting to true, so a change to a service or to a
# library it consumes rebuilds and restarts that one process on its own. What a
# running service will not pick up is a rewritten .env, because Nx loads it into
# the task when it starts it. --restart replaces the processes and leaves compose
# and its volumes untouched, so it never costs the data in the databases.
#
# What a slot is: an integer N. The compose project (and therefore its containers,
# network, and named volumes) is "luna-slot<N>".
#
# Slot 0 is the original single stack, on exactly the historic ports (gateway 3000,
# auth-db 5432, nats 4222, and the rest) with the project still named
# "luna-shopper-backend", so the plain `docker compose ... up` workflow still
# matches and a lone worktree needs no slot at all. Nothing here changes it.
#
# Every other slot gets a 100 port block up in the 43000s: slot 1 is 43000..43054,
# slot 2 is 43100..43154, and so on. That is a change from `default + N*100`, which
# scattered a slot across 5532, 4322, 6479, 1125 and 16786, most of them in the
# range everything else on the machine also wants, so slots collided with other
# software instead of with each other. See the port table below for the band and
# for how it was chosen.
#
# --- the front end slots are a SEPARATE numbering ----------------------------
#
# `tools/dev/ng-slot.sh` does the same for the Angular apps, but the two numbers
# are independent and must not be assumed equal. A front end on slot 5 may point
# at this backend on slot 1, or 2, or 8, and several front end slots may point at
# ONE backend at the same time. The common case is exactly that: nobody is
# changing the backend, one instance is up, and every front end worktree uses it.
#
# Two consequences, and they pull in opposite directions:
#
#   CORS_ORIGINS is a LIST, so it names every front end slot's two origins, not
#   this slot's. A backend has no way to know which front ends will call it and no
#   reason to care, and an origin it has not been told about fails with a CORS
#   error that says nothing about slots. Listing them all costs a long line in a
#   git ignored file and removes the whole class of problem.
#
#   APP_BASE_URL and the two MAIL_*_BASE_URL are SINGULAR: they are where the
#   Google callback and the verification links send a browser, and a redirect can
#   only have one target. So they have to name one front end, which is what
#   `--app-slot <n>` chooses. It defaults to 0, the shared front end, because that
#   is the one a backend serving several worktrees is most likely to be driven
#   from. Only the OAuth and mail round trips are affected by getting it wrong;
#   ordinary API calls from any slot work regardless.
#
# This script (re)writes, all git ignored, so it is safe per worktree:
#   - k8s/e2e/luna-shopper-backend/.env.slot   (compose: project name + host ports)
#   - apps/luna-shopper-backend/.env.luna-shopper-backend       (shared service vars)
#   - apps/luna-shopper-backend/{gateway,realtime,auth,core,catalog,harvester,assistant}/.env
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
SERVICES=(gateway realtime auth core catalog harvester assistant)

# How high --auto and --list will look. See the same constant in ng-slot.sh.
MAX_SLOT=9

# --auto never takes slot 0. `parallel-worktree-testing.md` has said so since it
# was written: slot 0 is the developer's own stack, on the ports their tools and
# their browser already point at, so a worker that took it would collide with the
# one checkout that cannot move. `luna-slot.sh 0` is still accepted, because
# asking for it explicitly means it.
MIN_AUTO_SLOT=1

# Which front end slot the singular URLs (the Google callback, the mail links)
# point at when nobody says. Slot 0 is the developer's own front end, which is the
# one a shared backend is most likely to be driven from. A default, not an
# assumption about who may call: CORS allows every slot regardless.
DEFAULT_APP_SLOT=0

usage() {
  cat >&2 <<'EOF'
usage:
  luna-slot.sh <slot>              configure this worktree for that slot
  luna-slot.sh --auto              configure it for the lowest free slot
  luna-slot.sh --up [<slot>]       configure if needed, then start everything
  luna-slot.sh --restart           bounce the services, keeping the databases
  luna-slot.sh --down              stop the services and take the stack down
  luna-slot.sh --list              every worktree's slot, and what is live

Source changes need none of this: `nx serve` watches each service and the
libraries it consumes and restarts that one process itself. --restart is for a
changed .env, which a running service cannot pick up, and it leaves the compose
stack and its volumes alone so a restart never costs you the data.

options:
  -p, --profile <name>   compose profile for --up / --down (e.g. observability)
  --services a,b         limit --restart to these (default: all of them)
  --app-slot <n>         which Angular slot the Google callback and the mail
                         links send a browser to (default 0). Only those; CORS
                         allows every Angular slot no matter what this says.
  --keep-data            --down stops the containers instead of removing them
                         and their volumes, so the databases survive
  --timeout <secs>       how long --up waits for each service (default 180)

The Angular slots are a separate numbering: any of them can call this backend,
and several can at the same time. Backend slot 3 does not imply front end slot 3.

--up is the whole thing: it writes the .env files if they are missing, brings the
compose stack up and waits on its healthchecks, runs the migrations, then serves
all six services. --down is its inverse, and by default it removes this slot's
volumes, which is what `stack.sh down` has always meant here.
EOF
}

# --- slot arithmetic ---------------------------------------------------------
#
# One table and one function, so every caller (write, list, probe, wait) derives
# ports the same way and none of them can hold a stale copy.
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
# Hyper-V and WSL reservation at 50000 and up. So 40000..48000 is clear of both,
# and 43000 sits above the front end's 42000 band (tools/dev/ng-slot.sh) with room
# for nine slots on each side.
#
# The offsets group by kind so a block stays readable: services at +0, databases
# at +10, messaging at +20, cache at +30, mail at +40, observability at +50.
declare -A DEFAULT_PORT=(
  [gateway]=3000  [realtime]=3001  [auth]=3002  [core]=3003  [catalog]=3004
  [harvester]=3005 [assistant]=3006
  [auth_db]=5432  [core_db]=5433   [catalog_db]=5434 [harvester_db]=5435
  [nats]=4222     [nats_mon]=8222
  [redis]=6379
  [smtp]=1025     [mailpit]=8025
  [otlp_grpc]=4317 [otlp_http]=4318 [jaeger]=16686 [prometheus]=9090 [grafana]=3010
)
LUNA_SLOT_BAND=43000
declare -A SLOT_OFFSET=(
  [gateway]=0   [realtime]=1   [auth]=2   [core]=3   [catalog]=4
  [harvester]=5 [assistant]=6
  [auth_db]=10  [core_db]=11   [catalog_db]=12 [harvester_db]=13
  [nats]=20     [nats_mon]=21
  [redis]=30
  [smtp]=40     [mailpit]=41
  [otlp_grpc]=50 [otlp_http]=51 [jaeger]=52 [prometheus]=53 [grafana]=54
)

slot_project() {
  # Slot 0 keeps the historic name so the no-slot workflow still matches.
  if [[ "$1" == "0" ]]; then echo 'luna-shopper-backend'; else echo "luna-slot$1"; fi
}

# The port one thing gets on one slot.
luna_port() {
  local name="$1" slot="$2"
  if (( slot == 0 )); then
    echo "${DEFAULT_PORT[$name]}"
  else
    echo $(( LUNA_SLOT_BAND + (slot - 1) * 100 + SLOT_OFFSET[$name] ))
  fi
}

# The infrastructure compose brings up. `--wait` covers all of it, so a slot with
# some of these open and some closed is genuinely half started.
infra_ports() {
  local name
  for name in auth_db core_db catalog_db harvester_db nats nats_mon redis smtp mailpit; do
    luna_port "$name" "$1"
  done
}

service_ports() {
  local name
  for name in "${SERVICES[@]}"; do
    luna_port "$name" "$1"
  done
}

# Reserved per slot whether or not the `observability` profile is up, so two
# worktrees can each run a collector. Deliberately NOT counted when deciding
# whether a slot is up: the profile is opt in, and counting it would report every
# healthy slot as partial.
observability_ports() {
  local name
  for name in otlp_grpc otlp_http jaeger prometheus grafana; do
    luna_port "$name" "$1"
  done
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

# The port an Angular app gets on a front end slot.
#
# It restates tools/dev/ng-slot.sh's arithmetic, which is a duplication worth being
# explicit about: this script has to know the front end's ports (to allow their
# origins, and to aim the redirects), the two scripts are independent entry points
# with no shared library between them, and a shell function cannot be imported from
# a different tool without turning one into a dependency of the other. Both files
# name the same two constants and both say so; if either band moves, this moves
# with it. `ng-slot.sh --list` and this script's `--list` printing different
# numbers for the same slot is the symptom of getting it wrong.
FRONTEND_SLOT_BAND=42000
declare -A FRONTEND_DEFAULT_PORT=([shell]=4200 [velista]=4205)
declare -A FRONTEND_SLOT_OFFSET=([shell]=0 [velista]=5)

frontend_port() {
  local app="$1" slot="$2"
  if (( slot == 0 )); then
    echo "${FRONTEND_DEFAULT_PORT[$app]}"
  else
    echo $(( FRONTEND_SLOT_BAND + (slot - 1) * 100 + FRONTEND_SLOT_OFFSET[$app] ))
  fi
}

# Every origin any front end slot can serve on, as one comma separated list.
#
# Not this slot's, and not a guess at which front end will call: the numbering is
# independent, and several front end slots may point at one backend at the same
# time (the common case, when nobody is changing the backend). `enableCors` is
# handed this as an array of exact origins, with no wildcard, so an origin that is
# missing is a request that fails. Twenty entries in a git ignored dev file is a
# cheap way to never think about it again.
#
# Production is unaffected: it gets CORS_ORIGINS from the chart, not from here.
frontend_origins() {
  local slot origins=()
  for (( slot = 0; slot <= MAX_SLOT; slot++ )); do
    origins+=("http://localhost:$(frontend_port shell "$slot")")
    origins+=("http://localhost:$(frontend_port velista "$slot")")
  done
  local IFS=','
  echo "${origins[*]}"
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
  local slot="$1" app_slot="$2"

  # Host ports (compose). Every one of them comes from luna_port, so this function
  # cannot drift from what --list probes and --down frees.
  local AUTH_DB_PORT CORE_DB_PORT CATALOG_DB_PORT HARVESTER_DB_PORT
  local NATS_PORT NATS_MON_PORT
  local REDIS_PORT SMTP_PORT MAILPIT_UI_PORT
  AUTH_DB_PORT="$(luna_port auth_db "$slot")"
  CORE_DB_PORT="$(luna_port core_db "$slot")"
  CATALOG_DB_PORT="$(luna_port catalog_db "$slot")"
  HARVESTER_DB_PORT="$(luna_port harvester_db "$slot")"
  NATS_PORT="$(luna_port nats "$slot")"
  NATS_MON_PORT="$(luna_port nats_mon "$slot")"
  REDIS_PORT="$(luna_port redis "$slot")"
  SMTP_PORT="$(luna_port smtp "$slot")"
  MAILPIT_UI_PORT="$(luna_port mailpit "$slot")"

  # Observability stack (plan 0016, section 9). Opt in via the `observability`
  # compose profile; these ports are reserved per slot either way so two worktrees
  # can each run their own collector without colliding.
  local OTLP_GRPC_PORT OTLP_HTTP_PORT JAEGER_UI_PORT PROMETHEUS_PORT GRAFANA_PORT
  OTLP_GRPC_PORT="$(luna_port otlp_grpc "$slot")"
  OTLP_HTTP_PORT="$(luna_port otlp_http "$slot")"
  JAEGER_UI_PORT="$(luna_port jaeger "$slot")"
  PROMETHEUS_PORT="$(luna_port prometheus "$slot")"
  GRAFANA_PORT="$(luna_port grafana "$slot")"

  # Service listen ports.
  local GATEWAY_PORT REALTIME_PORT AUTH_PORT CORE_PORT CATALOG_PORT HARVESTER_PORT ASSISTANT_PORT
  GATEWAY_PORT="$(luna_port gateway "$slot")"
  REALTIME_PORT="$(luna_port realtime "$slot")"
  AUTH_PORT="$(luna_port auth "$slot")"
  CORE_PORT="$(luna_port core "$slot")"
  CATALOG_PORT="$(luna_port catalog "$slot")"
  HARVESTER_PORT="$(luna_port harvester "$slot")"
  ASSISTANT_PORT="$(luna_port assistant "$slot")"

  # The one front end the singular URLs point at. See the note at the top: this is
  # a choice, not an inference, because a redirect target cannot be a list.
  local SHELL_PORT VELISTA_PORT
  SHELL_PORT="$(frontend_port shell "$app_slot")"
  VELISTA_PORT="$(frontend_port velista "$app_slot")"

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

  # openssl writes a private key 0600, and this directory is bind mounted into
  # containers that run as the unprivileged `node` user, whose uid is not the uid
  # that generated the key. On Linux that is an EACCES the moment auth opens
  # jwt.key, and it hits auth alone: every other service reads jwt.pub, which
  # openssl leaves 0644, so most of the stack comes up healthy and one container
  # dies, which reads like an auth bug rather than a file mode. Docker Desktop
  # hides it because its bind mounts ignore the mode. Widen it here, on the
  # existing pair as well as a fresh one, since a key generated before this line
  # existed is still 0600. This is a throwaway pair, regenerated whenever it is
  # absent and never deployed: the real keys are Kubernetes Secrets that
  # provision-release.sh writes.
  if [[ -f "$secrets/jwt.key" ]]; then chmod 0644 "$secrets/jwt.key"; fi
  if [[ -f "$secrets/jwt.pub" ]]; then chmod 0644 "$secrets/jwt.pub"; fi

  # --- compose env-file ------------------------------------------------------
  cat > "$SLOT_ENV" <<EOF
# Generated by luna-slot.sh for slot ${slot}. Git ignored. Pass to compose with
#   docker compose --env-file k8s/e2e/luna-shopper-backend/.env.slot -f <compose> up -d
# LUNA_SLOT is not read by compose. It is here so --list, --up and --down, and the
# same three in every other worktree, can read this worktree's slot back out of the
# one file that already describes it.
LUNA_SLOT=${slot}
# Which front end slot the singular redirect and mail URLs point at. Independent
# of LUNA_SLOT on purpose (see the header); kept here so a plain re-run of this
# script preserves the choice instead of silently resetting it to the default.
LUNA_APP_SLOT=${app_slot}
COMPOSE_PROJECT_NAME=${project}
LUNA_AUTH_DB_PORT=${AUTH_DB_PORT}
LUNA_CORE_DB_PORT=${CORE_DB_PORT}
LUNA_CATALOG_DB_PORT=${CATALOG_DB_PORT}
LUNA_HARVESTER_DB_PORT=${HARVESTER_DB_PORT}
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
LUNA_HARVESTER_PORT=${HARVESTER_PORT}
LUNA_ASSISTANT_PORT=${ASSISTANT_PORT}
EOF

  # --- shared service env ----------------------------------------------------
  cat > "$root/apps/luna-shopper-backend/.env.luna-shopper-backend" <<EOF
# Generated by luna-slot.sh (slot ${slot}). Git ignored.
NATS_URL=nats://localhost:${NATS_PORT}
REDIS_URL=redis://localhost:${REDIS_PORT}
LOG_LEVEL=debug
# Every front end slot's two origins, not this slot's: the front end numbering is
# independent of this one, and several front end slots may call one backend at the
# same time. Each slot contributes the portfolio shell, which mounts velista as a
# remote, and velista's own origin, which is a first class way to run it (plan
# 0013) and was missing from this list even on slot 0.
CORS_ORIGINS=$(frontend_origins)
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
# The byte cap the voice route's multipart interceptor enforces (plan 0041). The
# gateway is where an upload is actually refused, so the number lives here as
# well as in the assistant's env.
ASSISTANT_AUDIO_MAX_BYTES=2097152
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

  # The uuid the harvester writes to catalog as (plan 0038, section 4.1). It has
  # to appear in BOTH files: catalog gates every write on its allowlist, and the
  # harvester sends this id on every call it makes. A fixed dev constant rather
  # than a generated one, so the two files cannot drift apart and a developer can
  # recognise it in a log.
  local HARVESTER_ACTOR_ID='ac700000-0000-4000-a000-000000000001'

  cat > "$root/apps/luna-shopper-backend/catalog/.env" <<EOF
# Generated by luna-slot.sh (slot ${slot}). Git ignored.
CATALOG_DB_URL=postgres://luna_catalog:luna_catalog@localhost:${CATALOG_DB_PORT}/luna_catalog
AUTH_JWT_PUBLIC_KEY_FILE=./apps/luna-shopper-backend/secrets/jwt.pub
# Your own user id goes here to write the catalog by hand. The harvester's actor
# id is listed so its imports pass the same gate as the owner's own writes.
PLATFORM_ADMIN_USER_IDS=${HARVESTER_ACTOR_ID}
PORT=${CATALOG_PORT}
EOF
  telemetry_env catalog >> "$root/apps/luna-shopper-backend/catalog/.env"

  # The harvester (plan 0038). Both switches are FALSE here, exactly as they are
  # in every cluster: bringing the service up is not the same decision as letting
  # it fetch from a third party. Flip HARVEST_ENABLED and MERCADONA_ENABLED by
  # hand when you actually want a run, and read section 8.1 first.
  cat > "$root/apps/luna-shopper-backend/harvester/.env" <<EOF
# Generated by luna-slot.sh (slot ${slot}). Git ignored.
HARVESTER_DB_URL=postgres://luna_harvester:luna_harvester@localhost:${HARVESTER_DB_PORT}/luna_harvester
AUTH_JWT_PUBLIC_KEY_FILE=./apps/luna-shopper-backend/secrets/jwt.pub
PLATFORM_ADMIN_USER_IDS=
HARVESTER_ACTOR_ID=${HARVESTER_ACTOR_ID}
HARVEST_ENABLED=false
MERCADONA_ENABLED=false
PORT=${HARVESTER_PORT}
EOF
  telemetry_env harvester >> "$root/apps/luna-shopper-backend/harvester/.env"

  # The assistant (plan 0039). No database url, because it has no database: rule
  # A1 says it reaches application data only through the API with the caller's
  # own token, and the absence of a connection string here is the cheapest place
  # for that to be visible.
  #
  # GEMINI_API_KEY is EMPTY, and leaving it that way is a supported setup: the
  # service boots and /v1/assistant answers 501 not_configured (plan 0026). The
  # suite never needs a key either, because rule A4 forbids any test here from
  # reaching a model provider. Paste your own key in by hand when you want to
  # talk to it, and remember the free tier's limits are per Google Cloud project
  # rather than per user.
  cat > "$root/apps/luna-shopper-backend/assistant/.env" <<EOF
# Generated by luna-slot.sh (slot ${slot}). Git ignored.
GATEWAY_INTERNAL_URL=http://localhost:${GATEWAY_PORT}
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
PORT=${ASSISTANT_PORT}
EOF
  telemetry_env assistant >> "$root/apps/luna-shopper-backend/assistant/.env"

  cat <<EOF

Configured this worktree for Luna Shopper slot ${slot}.
  compose project : ${project}
  auth-db         : localhost:${AUTH_DB_PORT}      core-db  : localhost:${CORE_DB_PORT}
  catalog-db      : localhost:${CATALOG_DB_PORT}
  harvester-db    : localhost:${HARVESTER_DB_PORT}
  nats            : localhost:${NATS_PORT} (mon ${NATS_MON_PORT})
  redis           : localhost:${REDIS_PORT}
  smtp / mailpit  : localhost:${SMTP_PORT} / http://localhost:${MAILPIT_UI_PORT}
  gateway ${GATEWAY_PORT}   realtime ${REALTIME_PORT}   auth ${AUTH_PORT}   core ${CORE_PORT}   catalog ${CATALOG_PORT}   harvester ${HARVESTER_PORT}   assistant ${ASSISTANT_PORT}
  otlp http/grpc  : localhost:${OTLP_HTTP_PORT} / ${OTLP_GRPC_PORT}
  jaeger / graf   : http://localhost:${JAEGER_UI_PORT} / http://localhost:${GRAFANA_PORT}
  prometheus      : http://localhost:${PROMETHEUS_PORT}
  cors            : every front end slot (0..${MAX_SLOT}), shell and velista origins both.
                    Any Angular slot can call this backend, and several can at once.
  redirects       : Angular slot ${app_slot} (http://localhost:${SHELL_PORT}), for the Google
                    callback and the mail links only, which can name just one.
                    Change it with --app-slot <n>.

Start the whole thing (compose, migrations, all six services):
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

# The front end this worktree already points its redirects at, so re-running the
# script to move slots does not quietly reset a choice somebody made.
current_app_slot() {
  local value=''
  if [[ -f "$SLOT_ENV" ]]; then
    value="$(sed -n 's/^LUNA_APP_SLOT=\([0-9]\+\)[[:space:]]*$/\1/p' "$SLOT_ENV" | head -n 1)"
  fi
  echo "${value:-$DEFAULT_APP_SLOT}"
}

# --- up ----------------------------------------------------------------------

# The PORT a service will listen on, read back from the .env this script wrote for
# it. One source of truth: nothing passes a port on the command line, so a service
# and the wait that watches for it cannot disagree.
service_port() {
  sed -n "s/^PORT=\([0-9]\+\)[[:space:]]*$/\1/p" \
    "$root/apps/luna-shopper-backend/$1/.env" 2>/dev/null | head -n 1
}

# Start each named service in the background and collect the ports to wait on.
# Both arguments are names of arrays in the caller, so the ports come back without
# a subshell swallowing the jobs.
serve_services() {
  local -n _svcs="$1"
  local -n _ports="$2"
  local svc port state

  mkdir -p "$RUN_DIR"
  for svc in "${_svcs[@]}"; do
    port="$(service_port "$svc")"
    if [[ -z "$port" ]]; then
      echo "no PORT in apps/luna-shopper-backend/$svc/.env; rerun luna-slot.sh ${LUNA_SLOT:-<slot>}" >&2
      return 1
    fi

    state="$(probe_ports "$port" | cut -f2)"
    if [[ "$state" != "closed" ]]; then
      echo "port $port ($svc, slot ${LUNA_SLOT:-?}) is already $state; run --down or --restart" >&2
      return 1
    fi

    echo "==> serving $svc on :$port  (log: k8s/e2e/luna-shopper-backend/.run/$svc.log)"
    npx nx run "luna-shopper-backend-$svc:serve" > "$RUN_DIR/$svc.log" 2>&1 &
    echo $! > "$RUN_DIR/$svc.pid"
    disown $! 2>/dev/null || true
    _ports+=("$port")
  done
}

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
  local requested_slot="$1" profile="$2" timeout="$3" app_slot="$4"

  if [[ -n "$requested_slot" ]]; then
    write_config "$requested_slot" "${app_slot:-$(current_app_slot)}"
  elif ! require_config; then
    # "--up without generating the env file does that first" is the whole point:
    # an agent that has just made a worktree should need one command, not two.
    local slot
    slot="$(find_free_slot)"
    echo "==> this worktree has no slot yet; taking the lowest free one: ${slot}"
    write_config "$slot" "${app_slot:-$DEFAULT_APP_SLOT}"
  elif [[ -n "$app_slot" && "$app_slot" != "${LUNA_APP_SLOT:-}" ]]; then
    write_config "$LUNA_SLOT" "$app_slot"
  fi

  require_config || { echo "could not read $SLOT_ENV after writing it" >&2; return 1; }

  # The compose stack and the migrations are stack.sh's job and it already does
  # them properly (up --wait on the healthchecks, then every migration). Calling it
  # rather than repeating it is what keeps compose the single definition of what
  # the infrastructure is; it reads the same .env.slot this script just wrote.
  local -a stack=(bash "$here/stack.sh")
  [[ -n "$profile" ]] && stack+=(--profile "$profile")
  "${stack[@]}" up

  local -a ports=()
  serve_services SERVICES ports || return 1

  echo "==> waiting up to ${timeout}s for the services to listen"
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

# Bounce the Nest services and leave the compose stack exactly where it is.
#
# Rarely needed. `nx run <svc>:serve` is `@nx/js:node`, whose `watch` defaults to
# true, so a change to a service or to a library it consumes rebuilds and restarts
# that one process by itself. What it will not pick up is a rewritten .env, because
# Nx loads `{projectRoot}/.env` into the task when it starts it: a new PORT, a new
# database URL, a changed CORS list or APP_BASE_URL all need the process replaced.
#
# It exists chiefly so that is not a reason to run `--down`, which takes the
# databases and their volumes with it. Restarting a service should never cost the
# data somebody has been working with.
restart_services() {
  local services_csv="$1" timeout="$2"

  if ! require_config; then
    echo "this worktree has no slot configured, so there is nothing to restart." >&2
    return 1
  fi

  local -a wanted=()
  local svc port state
  if [[ -n "$services_csv" ]]; then
    IFS=',' read -r -a wanted <<< "$services_csv"
    for svc in "${wanted[@]}"; do
      [[ " ${SERVICES[*]} " == *" $svc "* ]] || {
        echo "unknown service '$svc'; known: ${SERVICES[*]}" >&2; return 2; }
    done
  else
    wanted=("${SERVICES[@]}")
  fi

  echo "==> restarting on Luna slot $LUNA_SLOT: ${wanted[*]}"
  echo "    (the compose stack and its volumes are left alone)"
  local -a stopping=()
  for svc in "${wanted[@]}"; do
    port="$(service_port "$svc")"
    [[ -n "$port" ]] && stopping+=("$port")
  done
  stop_services wanted stopping || true

  local -a ports=()
  serve_services wanted ports || return 1

  echo "==> waiting up to ${timeout}s for them to listen"
  if wait_for_ports "$timeout" "${ports[@]}"; then
    echo "restarted: ${wanted[*]}"
    return 0
  fi
  echo "timed out; see k8s/e2e/luna-shopper-backend/.run/*.log" >&2
  return 1
}

# Stop the recorded wrapper processes, then free the ports, then free them again.
#
# Killing by port alone is not enough, and the gap is not theoretical: a service
# that has been spawned but has not bound yet is invisible to a port sweep, so it
# survives the stop and binds a moment later. That is how a `--down` followed by an
# `--up` ends in "port 3100 is already open" with nothing visibly running.
#
# So: kill the recorded pid first, which stops the `npx` wrapper before it can
# hand the port to a child, then sweep the ports for anything already listening,
# then pause and sweep once more for whatever bound during the first pass.
# Kill a recorded pid ONLY if it still looks like the process that was recorded.
#
# A .pid file outlives the process it names, and the operating system reuses pids.
# Killing one unverified means killing whatever inherited the number, which on a
# developer machine could be another worktree's services, the editor, or the thing
# the developer is actually working in.
#
# The port sweep below is what actually guarantees the port is free. This is only
# here to stop a wrapper spawning a replacement first, so declining to kill an
# unrecognised pid costs nothing and removes the chance of killing a stranger.
kill_recorded_pid() {
  local pid="$1" cmdline=''
  [[ "$pid" =~ ^[0-9]+$ ]] || return 0

  # Where /proc exists the command line settles it outright.
  if [[ -r "/proc/$pid/cmdline" ]]; then
    cmdline="$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null || true)"
    case "$cmdline" in
      *node*|*npx*|*npm*|*nx*) ;;
      *) return 0 ;;
    esac
  fi

  kill -TERM "$pid" 2>/dev/null || true
  kill -KILL "$pid" 2>/dev/null || true
}

# Both arguments name arrays in the caller: the services to stop, and their ports.
# It is scoped to those names rather than sweeping the whole .run directory,
# because `--restart --services gateway` must leave the other four alone.
stop_services() {
  local -n _svcs="$1"
  local -n _ports="$2"
  local svc pidfile pid port freed=0

  for svc in "${_svcs[@]}"; do
    pidfile="$RUN_DIR/$svc.pid"
    [[ -e "$pidfile" ]] || continue
    pid="$(cat "$pidfile" 2>/dev/null || true)"
    [[ -n "$pid" ]] && kill_recorded_pid "$pid"
    rm -f "$pidfile"
  done

  local pass
  for pass in 1 2; do
    for port in "${_ports[@]}"; do
      if kill_port "$port"; then
        echo "  freed $port"
        freed=$(( freed + 1 ))
      fi
    done
    (( pass == 1 )) && sleep 3
  done

  return $(( freed ? 0 : 1 ))
}

down() {
  local profile="$1" keep_data="$2"

  if ! require_config; then
    echo "this worktree has no slot configured, so there is nothing of its own to stop." >&2
    echo "Run --list to see which worktrees do." >&2
    return 0
  fi

  echo "==> stopping the services of Luna Shopper slot $LUNA_SLOT"
  local -a ports=()
  mapfile -t ports < <(service_ports "$LUNA_SLOT")
  stop_services SERVICES ports || echo "  none of them were running"

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
  echo "Luna Shopper dev slots (slot 0 is the historic ports; 1 and up are a block at 43000 + (slot-1)*100)"
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
  echo "  INFRA     the four databases, NATS and its monitor, Redis, SMTP, Mailpit"
  echo "  SERVICES  gateway, realtime, auth, core, catalog, harvester, assistant"
  echo "  OBSERV    collector, Jaeger, Prometheus, Grafana: opt in, so 0/5 is normal"
  echo
  echo "A slot claimed with 0/9 infra is configured but not started: --up will take it."
  echo "Slots 0..${MAX_SLOT} with neither a claim nor a listener are omitted."
}

# --- argument parsing --------------------------------------------------------

action=''
slot_arg=''
app_slot=''
services_csv=''
profile=''
keep_data=''
timeout=180

while (( $# )); do
  case "$1" in
    --list) action='list'; shift ;;
    --up) action='up'; shift ;;
    --restart) action='restart'; shift ;;
    --down) action='down'; shift ;;
    --services) services_csv="${2:-}"; shift 2 ;;
    --services=*) services_csv="${1#*=}"; shift ;;
    # --auto names the slot, not the verb, so `--up --auto` stays an --up.
    --auto) slot_arg='auto'; [[ -n "$action" ]] || action='configure'; shift ;;
    -p | --profile) profile="${2:-}"; shift 2 ;;
    -p=* | --profile=*) profile="${1#*=}"; shift ;;
    --app-slot) app_slot="${2:-}"; shift 2 ;;
    --app-slot=*) app_slot="${1#*=}"; shift ;;
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
if [[ -n "$app_slot" && ! "$app_slot" =~ ^[0-9]+$ ]]; then
  echo "--app-slot takes a non-negative integer" >&2
  exit 2
fi

if [[ "$slot_arg" == 'auto' ]]; then
  slot_arg="$(find_free_slot)"
fi

case "${action:-}" in
  list) list ;;
  down) down "$profile" "$keep_data" ;;
  restart) restart_services "$services_csv" "$timeout" ;;
  up) up "$slot_arg" "$profile" "$timeout" "$app_slot" ;;
  # An --app-slot given on its own keeps the slot this worktree already has, and a
  # re-run with neither keeps the front end it was already pointed at.
  configure) write_config "$slot_arg" "${app_slot:-$(current_app_slot)}" ;;
  *) usage; exit 2 ;;
esac
