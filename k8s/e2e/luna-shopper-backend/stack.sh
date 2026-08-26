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
#
# Every command that starts something configures the checkout first (see
# bootstrap_config below), so a fresh clone needs no manual .env copying and no
# keypair ceremony: `stack:up` is the first and only command.
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

compose() {
  if [[ -f "$SLOT_ENV" ]]; then
    docker compose --env-file "$SLOT_ENV" -f "$COMPOSE_FILE" "$@"
  else
    docker compose -f "$COMPOSE_FILE" "$@"
  fi
}

# Infrastructure plus the five service images (tier 2). The overlay is always
# applied on top of compose.yml, never on its own, so there is still exactly one
# definition of the infrastructure.
compose_apps() {
  if [[ -f "$SLOT_ENV" ]]; then
    docker compose --env-file "$SLOT_ENV" -f "$COMPOSE_FILE" -f "$APPS_FILE" "$@"
  else
    docker compose -f "$COMPOSE_FILE" -f "$APPS_FILE" "$@"
  fi
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
MIGRATED_SERVICES=(auth core catalog)

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

# Every file luna-slot.sh writes. The services read all six; the migrations below
# read only their own.
ENV_FILES=(
  'apps/luna-shopper-backend/.env.luna-shopper-backend'
  'apps/luna-shopper-backend/gateway/.env'
  'apps/luna-shopper-backend/realtime/.env'
  'apps/luna-shopper-backend/auth/.env'
  'apps/luna-shopper-backend/core/.env'
  'apps/luna-shopper-backend/catalog/.env'
)

# The subset `up` cannot proceed without, because each migration resolves its
# database URL from its own service file.
REQUIRED_ENV_FILES=(
  'apps/luna-shopper-backend/auth/.env'
  'apps/luna-shopper-backend/core/.env'
  'apps/luna-shopper-backend/catalog/.env'
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
  echo "==> bringing the compose stack up (waiting on healthchecks)"
  compose up -d --wait

  for svc in "${MIGRATED_SERVICES[@]}"; do
    echo "==> migrating $svc"
    npx nx run "luna-shopper-backend-$svc:migration:run"
  done

  echo "==> stack is up and migrated"
}

down() {
  echo "==> tearing the compose stack down (including volumes)"
  # -v on purpose: nothing survives between runs, so a suite can never pass on
  # data a previous run left behind.
  compose down -v --remove-orphans
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

# Configuration is a precondition of every command that starts something, so it
# is dispatched here rather than from inside up(): a checkout that cannot be
# configured has started nothing, and should not reach up_or_clean's teardown.
# `down` is exempt on purpose, since tearing down needs no service config.
case "${1:-}" in
  bootstrap) bootstrap_config ;;
  up) bootstrap_config && up ;;
  down) down ;;
  test-integration) bootstrap_config && test_integration ;;
  e2e) bootstrap_config && e2e ;;
  e2e-images) bootstrap_config && e2e_images ;;
  *)
    echo "usage: stack.sh {bootstrap | up | down | test-integration | e2e | e2e-images}" >&2
    exit 2
    ;;
esac
