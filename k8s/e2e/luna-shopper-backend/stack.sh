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
#   nx run luna-shopper-backend:stack:up
#   nx run luna-shopper-backend:stack:down
#   nx run luna-shopper-backend:test-integration:stack
#   nx run luna-shopper-backend:e2e:stack
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

case "${1:-}" in
  up) up ;;
  down) down ;;
  test-integration) test_integration ;;
  e2e) e2e ;;
  e2e-images) e2e_images ;;
  *)
    echo "usage: stack.sh {up | down | test-integration | e2e | e2e-images}" >&2
    exit 2
    ;;
esac
