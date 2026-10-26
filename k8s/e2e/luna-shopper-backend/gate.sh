#!/usr/bin/env bash
#
# The velista unit's API gate (k8s plan 0016 D3): the Luna Shopper e2e suite
# against the service images, not against `node dist/...`. pr.yml already proved
# the logic on this commit; this proves the images: entrypoint, non root user,
# the runtime dependency install, baked config, and SIGTERM reaching PID 1.
#
#   bash k8s/e2e/luna-shopper-backend/gate.sh [<e2e projects>]
#
# The suite runs whenever the gate does, so the argument is ignored.
# E2E_IMAGE_PREFIX and E2E_IMAGE_TAG pick the images. A skip, an empty suite or
# a stack that fails to come up fails the gate.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export LUNA_IMAGE_PREFIX="${E2E_IMAGE_PREFIX:-ghcr.io/ichirokuxvi/nx-portfolio}"
export LUNA_IMAGE_TAG="${E2E_IMAGE_TAG:-staging}"
export LUNA_REQUIRE_STACK=1
export E2E_SEED=1
export COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-luna-tier2-${GITHUB_RUN_ID:-local}}"
COMPOSE=(docker compose -f "$HERE/compose.yml" -f "$HERE/compose.apps.yml")

teardown() { "${COMPOSE[@]}" down -v --remove-orphans > /dev/null 2>&1 || true; }
trap teardown EXIT

# The service .env files the migration CLI reads, and a throwaway JWT keypair
# the images mount: the same definition of a booting service as a dev slot.
bash "$HERE/luna-slot.sh" 0
rm -f "$HERE/.env.slot"

# Every image at the run's tag: the affected ones were rebuilt by this run and
# the rest are the deployed ones, which is the combination about to roll out.
"${COMPOSE[@]}" pull
bash "$HERE/stack.sh" e2e-images
echo "luna-shopper-backend: luna-shopper-backend-e2e passed"
