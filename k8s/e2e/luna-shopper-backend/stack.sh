#!/usr/bin/env bash
#
# stack.sh — one command per infra-backed suite (plan 0015, section 4).
#
# `docs/testing-strategy.md` used to spell this sequence out by hand: bring
# compose up, wait, migrate, export LUNA_INTEGRATION, run the suite, tear down.
# Written out it is easy to get subtly wrong, and CI and a developer had no way
# to run the *same* thing. This script is that one thing, and the Nx targets on
# the `luna-shopper-backend` umbrella project are thin wrappers over it:
#
#   nx run luna-shopper-backend:stack:bootstrap
#   nx run luna-shopper-backend:stack:up
#   nx run luna-shopper-backend:stack:down
#   nx run luna-shopper-backend:test-integration:stack
#   nx run luna-shopper-backend:e2e:stack
#   nx run luna-shopper-backend:observability:up
#   nx run luna-shopper-backend:observability:down
#
# Every command that starts something configures the checkout first (see
# bootstrap_config below), so a fresh clone needs no manual .env copying and no
# keypair ceremony: `stack:up` is the first and only command.
#
# --- the -p flag ------------------------------------------------------------
#
# `-p <name>` (or `--profile <name>`) scopes the verb that follows to one compose
# profile, so the optional groups in compose.yml get the same one command
# treatment as the base stack:
#
#   stack.sh -p observability up      # start ONLY collector/Jaeger/Prometheus/
#                                     # Grafana, leaving the base stack alone
#   stack.sh -p observability down    # remove ONLY those four, keep the databases
#
# In both directions -p means the same thing: operate on that profile and
# nothing else. Neither direction can be a plain passthrough of --profile to get
# there, because compose treats profiles as a filter on top of the unprofiled
# services rather than as a selection:
#
#   up   `--profile X up` also starts every unprofiled service, so it would drag
#        the whole base stack along and then migrate it. Naming the profile's
#        services explicitly is what scopes it. Dependencies still resolve.
#   down `--profile X down` is worse than additive: unprofiled services are
#        always in the active set, so it would take the three databases and NATS
#        with it. A profiled `down` is a `stop` + `rm` over exactly the services
#        the profile adds, and it leaves the volumes alone, because losing six
#        hours of Grafana history to a teardown of something else is not a
#        tradeoff anybody chose.
#
# So a profiled `up` does NOT migrate. The base stack is what owns databases,
# and `stack.sh up` is still the command that brings it up and migrates it.
#
# Which services a profile adds is DERIVED, never hardcoded: see
# profile_services. Adding a profile to compose.yml is therefore enough to make
# `-p <that profile>` work, with no matching edit here.
#
# Infrastructure deliberately stays unprofiled. Putting it behind an `infra`
# profile would make teardown scoping fall out for free, but a service with no
# profile that `depends_on` one that has a profile makes the whole project
# invalid ("service X depends on undefined service Y: invalid compose project")
# whenever that profile is inactive, and all five services in compose.apps.yml
# depend on nats and the databases. The alternative, profiling those too, buys a
# bare `docker compose up` that silently starts nothing and exits 0, which is
# the exact green-run-that-did-nothing failure this script exists to prevent.
#
# Compose stays the single definition of what the infrastructure IS (plan 0015,
# section 1): the same file backs local development, the slot harness, and both
# CI tiers. Nothing here re-describes a Postgres version or a NATS flag.
#
# The wait is `docker compose up --wait`, never a sleep: compose reports a
# container started long before Postgres accepts connections, and the
# healthchecks in compose.yml already encode the right condition.
#
# `.env.slot` is honored when luna-slot.sh has written one, so a worktree on a
# slot runs its own isolated copy with no extra flags. CI has the runner to
# itself and writes no slot file, so it gets the defaults.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(cd "$here/../../.." && pwd)"
cd "$root"

COMPOSE_FILE="$here/compose.yml"
APPS_FILE="$here/compose.apps.yml"
SLOT_ENV="$here/.env.slot"

# The profile named by -p, or empty. Parsed at the bottom, before dispatch.
PROFILE=""

# The base invocations, which own the one thing every caller needs to get right:
# honoring .env.slot when luna-slot.sh has written one. They take an explicit
# --profile from the caller, which is what lets profile_services below ask about
# a profile other than the selected one.
compose_base() {
  if [[ -f "$SLOT_ENV" ]]; then
    docker compose --env-file "$SLOT_ENV" -f "$COMPOSE_FILE" "$@"
  else
    docker compose -f "$COMPOSE_FILE" "$@"
  fi
}

# Infrastructure plus the five service images (tier 2). The overlay is always
# applied on top of compose.yml, never on its own, so there is still exactly one
# definition of the infrastructure.
compose_apps_base() {
  if [[ -f "$SLOT_ENV" ]]; then
    docker compose --env-file "$SLOT_ENV" -f "$COMPOSE_FILE" -f "$APPS_FILE" "$@"
  else
    docker compose -f "$COMPOSE_FILE" -f "$APPS_FILE" "$@"
  fi
}

# What the verbs call: the base invocation with -p applied, if one was given.
compose() {
  if [[ -n "$PROFILE" ]]; then
    compose_base --profile "$PROFILE" "$@"
  else
    compose_base "$@"
  fi
}

compose_apps() {
  if [[ -n "$PROFILE" ]]; then
    compose_apps_base --profile "$PROFILE" "$@"
  else
    compose_apps_base "$@"
  fi
}

# The services a profile ADDS, as the difference between the project with it and
# without it. Compose has no "list a profile's services" query, and asking it
# with the profile active returns the unprofiled services too, so the diff is
# the query. Deriving it this way keeps the service names in compose.yml and
# nowhere else, which is the same rule the rest of this script follows about
# Postgres versions and NATS flags.
profile_services() {
  comm -13 <(compose_base config --services | sort) \
           <(compose_base --profile "$1" config --services | sort)
}

# Export the service ports (and the matching E2E_* URLs) that the suite on the
# host should talk to. run-services.sh owns the lookup, so a slotted worktree and
# a bare CI runner both get it right without recomputing offsets here.
export_service_ports() {
  eval "$(bash "$here/run-services.sh" ports)"
  export LUNA_GATEWAY_PORT="${LUNA_GATEWAY_PORT:-3000}"
  export LUNA_REALTIME_PORT="${LUNA_REALTIME_PORT:-3001}"
  export LUNA_AUTH_PORT="${LUNA_AUTH_PORT:-3002}"
  export LUNA_CORE_PORT="${LUNA_CORE_PORT:-3003}"
  export LUNA_CATALOG_PORT="${LUNA_CATALOG_PORT:-3004}"
  export E2E_GATEWAY_URL="http://localhost:$LUNA_GATEWAY_PORT"
  export E2E_REALTIME_URL="http://localhost:$LUNA_REALTIME_PORT"
}

# Services with their own database and their own committed migrations.
MIGRATED_SERVICES=(auth core catalog harvester)

# --- configuration bootstrap ------------------------------------------------
#
# None of what a service needs to boot is committed: the six .env files and the
# dev JWT keypair are all git ignored (the keypair must never be shared, and the
# .env files are per developer). A fresh checkout therefore has none of it, and
# the failure that produces is actively misleading rather than merely annoying.
# With no AUTH_DB_URL the migration CLI hands `undefined` to node-postgres, which
# falls back to its own defaults, finds this stack's auth-db on localhost:5432,
# and dies with "SASL: client password must be a string". That reads as a
# credentials problem for a connection string that was never set, and it only
# gets that far because the compose stack is up and listening.
#
# So the commands that start things configure the checkout first, from the same
# single definition of the defaults everything else uses: luna-slot.sh. The PR
# workflow already calls it for exactly this reason. Slot 0 is the plain default
# ports, which is what a developer's own machine wants.

# Every file luna-slot.sh writes. The services read all seven; the migrations
# below read only their own.
ENV_FILES=(
  'apps/luna-shopper-backend/.env.luna-shopper-backend'
  'apps/luna-shopper-backend/gateway/.env'
  'apps/luna-shopper-backend/realtime/.env'
  'apps/luna-shopper-backend/auth/.env'
  'apps/luna-shopper-backend/core/.env'
  'apps/luna-shopper-backend/catalog/.env'
  'apps/luna-shopper-backend/harvester/.env'
)

# The subset `up` cannot proceed without, because each migration resolves its
# database URL from its own service file.
REQUIRED_ENV_FILES=(
  'apps/luna-shopper-backend/auth/.env'
  'apps/luna-shopper-backend/core/.env'
  'apps/luna-shopper-backend/catalog/.env'
  'apps/luna-shopper-backend/harvester/.env'
)

KEYPAIR="$root/apps/luna-shopper-backend/secrets/jwt.key"

# luna-slot.sh sends openssl's stderr to /dev/null, so a missing openssl would
# abort it under `set -e` with nothing printed at all. Check for it up front and
# say what to do, rather than inheriting a silent exit.
require_openssl() {
  if ! command -v openssl >/dev/null 2>&1; then
    cat >&2 <<'EOF'
openssl is not on PATH, so the throwaway dev JWT keypair cannot be generated.
Git for Windows ships it; on Linux install the `openssl` package. Or create the
pair by hand from the workspace root and rerun:
  openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 \
    -out apps/luna-shopper-backend/secrets/jwt.key
  openssl pkey -in apps/luna-shopper-backend/secrets/jwt.key -pubout \
    -out apps/luna-shopper-backend/secrets/jwt.pub
EOF
    return 1
  fi
}

bootstrap_config() {
  local missing=() present=() file
  for file in "${ENV_FILES[@]}"; do
    if [[ -f "$root/$file" ]]; then
      present+=("$file")
    else
      missing+=("$file")
    fi
  done

  # A fresh checkout: there is no configuration to preserve, so write all of it.
  # This is the case that used to fail, and it is the common one.
  if (( ${#present[@]} == 0 )); then
    echo "==> no service .env files found: configuring this checkout for slot 0 (the default ports)"
    if [[ ! -f "$KEYPAIR" ]]; then
      require_openssl || return 1
    fi
    bash "$here/luna-slot.sh" 0
    return 0
  fi

  # Past this point something is already configured, and luna-slot.sh rewrites
  # all six files, so running it now would silently discard hand edits in the
  # ones that do exist. From here we only ever add what is absent.
  if [[ ! -f "$KEYPAIR" ]]; then
    require_openssl || return 1
    echo "==> generating the missing dev JWT keypair in apps/luna-shopper-backend/secrets"
    openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out "$KEYPAIR" 2>/dev/null
    openssl pkey -in "$KEYPAIR" -pubout -out "${KEYPAIR%.key}.pub" 2>/dev/null
  fi

  # Readable by the `node` user the images run as, for the reason luna-slot.sh
  # spells out where it generates the same pair. Applied to an existing key too,
  # not only one this branch just wrote.
  if [[ -f "$KEYPAIR" ]]; then chmod 0644 "$KEYPAIR"; fi
  if [[ -f "${KEYPAIR%.key}.pub" ]]; then chmod 0644 "${KEYPAIR%.key}.pub"; fi

  if (( ${#missing[@]} == 0 )); then
    return 0
  fi

  # Refuse only over the files this command genuinely cannot work without. A
  # checkout that only ever serves one service is a legitimate state, so the
  # rest are a note and not a failure.
  local blocking=()
  for file in "${REQUIRED_ENV_FILES[@]}"; do
    if [[ ! -f "$root/$file" ]]; then
      blocking+=("$file")
    fi
  done

  if (( ${#blocking[@]} > 0 )); then
    {
      echo
      echo "This checkout is partly configured, and the missing files include ones the"
      echo "migrations need:"
      printf '  %s\n' "${blocking[@]}"
      echo
      echo "Nothing was written, because luna-slot.sh rewrites all six .env files and"
      echo "would discard whatever is in the ones you already have. Either take the slot"
      echo "defaults for all of them:"
      echo "  bash k8s/e2e/luna-shopper-backend/luna-slot.sh 0"
      echo "or copy just the missing ones from their .example sibling."
    } >&2
    return 1
  fi

  echo "==> note: these are not configured, and this command does not need them:"
  printf '      %s\n' "${missing[@]}"
  echo "    copy each from its .example sibling, or run luna-slot.sh 0 to rewrite all six."
}

up() {
  # With -p this is scoped to that profile's own containers, so it never starts
  # the base stack and never migrates. See up_profile.
  if [[ -n "$PROFILE" ]]; then
    up_profile "$PROFILE"
    return
  fi

  echo "==> bringing the compose stack up (waiting on healthchecks)"
  compose up -d --wait

  for svc in "${MIGRATED_SERVICES[@]}"; do
    echo "==> migrating $svc"
    npx nx run "luna-shopper-backend-$svc:migration:run"
  done

  echo "==> stack is up and migrated"
}

# Bring up ONLY what a profile adds, naming its services explicitly.
#
# `--profile X up` on its own is additive: compose starts every unprofiled
# service too, so it would bring the whole base stack along and then migrate it.
# That is a surprising amount of work to ask for by typing `observability:up`,
# and it makes the flag mean one thing to `up` and another to `down`. Naming the
# services keeps both directions the same promise: -p operates on that profile.
#
# Dependencies still resolve, so a profile whose services depend on each other
# (otel-collector on jaeger) comes up in the right order.
up_profile() {
  local profile="$1" svcs
  svcs="$(profile_services "$profile")"
  if [[ -z "$svcs" ]]; then
    echo "no services are gated behind a '$profile' profile in compose.yml" >&2
    return 1
  fi

  echo "==> starting the '$profile' profile: $(tr '\n' ' ' <<<"$svcs")"
  # Word splitting is the point here: $svcs is a newline separated service list.
  # shellcheck disable=SC2086
  compose_base --profile "$profile" up -d --wait $svcs
  print_profile_hints
}

down() {
  echo "==> tearing the compose stack down (including volumes)"
  # -v on purpose: nothing survives between runs, so a suite can never pass on
  # data a previous run left behind.
  compose down -v --remove-orphans
}

# Tear down ONLY what a profile adds. See the -p notes at the top for why this
# cannot just be `compose --profile X down`.
down_profile() {
  local profile="$1" svcs
  svcs="$(profile_services "$profile")"
  if [[ -z "$svcs" ]]; then
    echo "no services are gated behind a '$profile' profile in compose.yml" >&2
    return 1
  fi

  echo "==> removing the '$profile' profile: $(tr '\n' ' ' <<<"$svcs")"
  # Word splitting is the point here: $svcs is a newline separated service list.
  # No -v: a scoped teardown that silently dropped prometheus-data and
  # grafana-data would destroy the history somebody kept the stack up to collect.
  # shellcheck disable=SC2086
  compose_base --profile "$profile" stop $svcs
  # shellcheck disable=SC2086
  compose_base --profile "$profile" rm -f $svcs
}

# A published port as compose resolves it: from .env.slot when luna-slot.sh has
# written one, otherwise the same default compose.yml falls back to.
slot_port() {
  local key="$1" default="$2" val=""
  if [[ -f "$SLOT_ENV" ]]; then
    val="$(grep -E "^$key=" "$SLOT_ENV" 2>/dev/null | tail -1 | cut -d= -f2- || true)"
  fi
  echo "${val:-$default}"
}

# Where to look once a profile is up. A running container and a developer who
# knows the URL are not the same thing, and for the observability profile the
# distance between the two is most of what the profile is worth.
print_profile_hints() {
  [[ "$PROFILE" == 'observability' ]] || return 0
  cat <<EOF

  Grafana      http://localhost:$(slot_port LUNA_GRAFANA_PORT 3010)  (anonymous admin, datasources provisioned)
  Jaeger       http://localhost:$(slot_port LUNA_JAEGER_UI_PORT 16686)
  Prometheus   http://localhost:$(slot_port LUNA_PROMETHEUS_PORT 9090)
  OTLP intake  localhost:$(slot_port LUNA_OTLP_GRPC_PORT 4317) grpc, localhost:$(slot_port LUNA_OTLP_HTTP_PORT 4318) http

  Metrics are pulled, not pushed: the collector scrapes /metrics on each service's
  own port, so any service you are not running shows up as a down scrape target in
  Prometheus. Traces need traffic, so send a request before expecting a span.
EOF
}

# Write the container logs somewhere durable BEFORE the teardown removes the
# containers (plan 0015, section 8). An infra backed suite that fails opaquely
# gets disabled within a month, so this runs on the local path too, not only in
# CI: whoever hits the failure gets the same evidence.
collect_logs() {
  local out="$root/test-output/luna-shopper-backend"
  mkdir -p "$out"
  echo "==> writing container logs to test-output/luna-shopper-backend"
  "$@" logs --no-color >"$out/compose.log" 2>&1 || true
}

# Bring the stack up, and leave nothing behind if it cannot come up. Without this
# a healthcheck that never passes aborts the script under `set -e` with half a
# stack still running, which the next run then inherits.
up_or_clean() {
  if ! up; then
    collect_logs compose
    down || true
    return 1
  fi
}

test_integration() {
  local projects="${LUNA_INTEGRATION_PROJECTS:-luna-shopper-backend-auth,luna-shopper-backend-core,luna-shopper-backend-catalog}"

  up_or_clean || return 1

  # The suite's exit code is the script's exit code, but teardown runs either
  # way: a failing suite must still leave the machine clean.
  #
  # LUNA_REQUIRE_STACK for the same reason CI sets it: this target stood the stack
  # up itself, so a suite that decides to skip is a bug, not a courtesy.
  local rc=0
  LUNA_INTEGRATION=1 LUNA_REQUIRE_STACK=1 \
    npx nx run-many -t test-integration --projects "$projects" || rc=$?

  # Whatever ran, prove it actually executed specs rather than matching none.
  node apps/luna-shopper-backend/tools/ci/assert-integration-ran.js "$projects" || rc=1

  if [[ $rc -ne 0 ]]; then
    collect_logs compose
  fi

  down
  return $rc
}

e2e() {
  up_or_clean || return 1

  local rc=0
  bash "$here/run-services.sh" start || rc=$?

  if [[ $rc -eq 0 ]]; then
    run_suite || rc=$?
  fi

  if [[ $rc -ne 0 ]]; then
    collect_logs compose
    bash "$here/run-services.sh" logs || true
  fi

  bash "$here/run-services.sh" stop || true
  down
  return $rc
}

# Tier 2: the same suite, against the five built images (plan 0015, section 2).
e2e_images() {
  up_or_clean || return 1

  export_service_ports

  local rc=0
  echo "==> starting the five service images"
  compose_apps up -d --wait || rc=$?

  if [[ $rc -eq 0 ]]; then
    run_suite || rc=$?
  fi

  if [[ $rc -ne 0 ]]; then
    # The image logs are the whole point of tier 2: a service that dies on boot
    # inside its image says so here and nowhere else.
    compose_apps logs --tail 100 || true
    collect_logs compose_apps
  fi

  compose_apps down -v --remove-orphans
  return $rc
}

# Run the Playwright suite against whatever is listening on the resolved ports.
#
# Pointing the suite explicitly is not optional. Left to its defaults the config
# falls back to :3000/:3001, which on a slotted worktree is either nothing — so
# the suite skips itself and reports a green run that tested nothing — or, far
# worse, somebody else's stack.
run_suite() {
  export_service_ports
  echo "==> running e2e against gateway :$LUNA_GATEWAY_PORT / realtime :$LUNA_REALTIME_PORT"

  # Seed by default so this runs the same suite CI runs, and mark the stack
  # throwaway so global-setup skips the pg_dump round trip: the teardown destroys
  # the databases anyway, so a snapshot would buy a slower run and one more
  # failure mode.
  #
  # LUNA_REQUIRE_STACK for the same reason CI sets it: we stood the stack up
  # ourselves, so a suite that decides to skip is a bug, not a courtesy.
  E2E_SEED="${E2E_SEED:-1}" \
    E2E_THROWAWAY=1 \
    LUNA_REQUIRE_STACK=1 \
    npx nx e2e luna-shopper-backend-e2e
}

usage() {
  echo "usage: stack.sh [-p|--profile <name>] {bootstrap | up | down | test-integration | e2e | e2e-images}" >&2
}

# Options come before the verb. The loop stops at the first non-option so the
# verb and anything after it reach the dispatch below untouched.
while [[ $# -gt 0 ]]; do
  case "$1" in
    -p | --profile)
      if [[ $# -lt 2 || -z "$2" ]]; then
        echo "$1 needs a profile name (for example: -p observability)" >&2
        usage
        exit 2
      fi
      PROFILE="$2"
      shift 2
      ;;
    -p=* | --profile=*)
      PROFILE="${1#*=}"
      shift
      ;;
    --)
      shift
      break
      ;;
    -*)
      echo "unknown option: $1" >&2
      usage
      exit 2
      ;;
    *) break ;;
  esac
done

# Configuration is a precondition of every command that starts something, so it
# is dispatched here rather than from inside up(): a checkout that cannot be
# configured has started nothing, and should not reach up_or_clean's teardown.
# `down` is exempt on purpose, since tearing down needs no service config.
#
# A profiled `up` is exempt for the same reason: it starts containers that read
# none of the six service .env files, and refusing to start Grafana over a
# missing auth/.env would be a confusing failure for a command that touches no
# database. `stack.sh up` remains the command that configures a fresh checkout.
case "${1:-}" in
  bootstrap) bootstrap_config ;;
  # With -p both of these are scoped to that profile's own containers. Without
  # it, `up` is the base stack plus its migrations and `down` is the whole
  # project including volumes, both unchanged.
  up)
    if [[ -n "$PROFILE" ]]; then
      up
    else
      bootstrap_config && up
    fi
    ;;
  down)
    if [[ -n "$PROFILE" ]]; then
      down_profile "$PROFILE"
    else
      down
    fi
    ;;
  test-integration) bootstrap_config && test_integration ;;
  e2e) bootstrap_config && e2e ;;
  e2e-images) bootstrap_config && e2e_images ;;
  *)
    usage
    exit 2
    ;;
esac
