#!/usr/bin/env bash
#
# The velista unit's browser gate (k8s plan 0016 D3).
#
#   bash k8s/e2e/velista-luna/gate.sh <e2e projects, comma separated>
#
# velista-e2e stubs the network and needs only velista behind the proxy of
# compose.yml. velista-luna-e2e drives the same image against the Luna tier 2
# images, so when it is listed the gate also runs `stack.sh e2e-up` and the
# compose.luna.yml overlay, which answers the two backend hosts the staging
# bundle has compiled in. Either way the checks of velista plan 0165 D7 run
# against the image this run built: the base rewrite and the absent manifest
# under /velista, and the plain document on the own origin.
#
# The pipeline has already pointed the HOSTS of gate.env at 127.0.0.1 and
# installed Chromium. E2E_IMAGE_PREFIX and E2E_IMAGE_TAG pick the images.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LUNA_DIR="$HERE/../luna-shopper-backend"
PROJECTS=",${1:-},"
export E2E_IMAGE_PREFIX="${E2E_IMAGE_PREFIX:-ghcr.io/ichirokuxvi/nx-portfolio}"
export E2E_IMAGE_TAG="${E2E_IMAGE_TAG:-staging}"

with_luna=false
case "$PROJECTS" in *,velista-luna-e2e,*) with_luna=true ;; esac

COMPOSE=(docker compose -p velista-luna-e2e -f "$HERE/compose.yml")
if [ "$with_luna" = true ]; then
  COMPOSE+=(-f "$HERE/compose.luna.yml")
  export LUNA_IMAGE_PREFIX="$E2E_IMAGE_PREFIX"
  export LUNA_IMAGE_TAG="$E2E_IMAGE_TAG"
  export LUNA_REQUIRE_STACK=1
  export E2E_SEED=1
  export COMPOSE_PROJECT_NAME="luna-browser-${GITHUB_RUN_ID:-local}"
  # The one origin the gateway and realtime images have to allow.
  export CORS_ORIGINS=https://staging.velista.app
fi

teardown() {
  if [ "${GATE_FAILED:-}" = 1 ]; then
    mkdir -p test-output/velista-luna
    "${COMPOSE[@]}" logs --no-color > test-output/velista-luna/compose.log 2>&1 || true
  fi
  "${COMPOSE[@]}" down -v > /dev/null 2>&1 || true
  if [ "$with_luna" = true ]; then
    bash "$LUNA_DIR/stack.sh" e2e-down > /dev/null 2>&1 || true
  fi
}
trap 'GATE_FAILED=1' ERR
trap teardown EXIT

if [ "$with_luna" = true ]; then
  bash "$LUNA_DIR/luna-slot.sh" 0
  rm -f "$LUNA_DIR/.env.slot"
  docker compose -f "$LUNA_DIR/compose.yml" -f "$LUNA_DIR/compose.apps.yml" pull
  # Infrastructure, migrations and the images, and no suite: the stack stays
  # up for the browser suite below.
  bash "$LUNA_DIR/stack.sh" e2e-up
fi

"${COMPOSE[@]}" up -d --pull always

wait_for() {
  local url="$1" i
  for i in $(seq 1 45); do
    if curl -kfsS "$url" > /dev/null 2>&1; then
      echo "  ok  $url"
      return 0
    fi
    echo "waiting for $url ($i)..."
    sleep 2
  done
  echo "::error::$url did not answer through the e2e proxy"
  GATE_FAILED=1
  return 1
}

wait_for https://staging.velista.app/
if [ "$with_luna" = true ]; then
  wait_for https://api.staging.velista.app/health/ready
fi

fail() {
  echo "::error::$*"
  GATE_FAILED=1
  exit 1
}

# The portfolio path: velista's document with the base its nginx rewrote to
# /velista/ and no manifest link, and a script it names loading from under
# /velista/. A relative URL that resolved to the portfolio's root would fetch
# the shell's files.
velista_page=https://staging.ichirokuxvi.com/velista/en
body="$(curl -kfsS "$velista_page")" || fail "$velista_page did not answer 200"
grep -q 'app-velista-root' <<< "$body" \
  || fail "$velista_page is not velista's document (no app-velista-root)"
grep -q '<base href="/velista/"' <<< "$body" \
  || fail "$velista_page does not carry the base /velista/ (the sub_filter in apps/velista/src/nginx.conf matched nothing)"
if grep -q 'rel="manifest"' <<< "$body"; then
  fail "$velista_page still links the web app manifest"
fi
first_src="$(grep -o 'src="[^"]*"' <<< "$body" | head -n 1 | sed -e 's/^src="//' -e 's/"$//')"
case "$first_src" in
  '') fail "$velista_page names no script" ;;
  /* | *://*) fail "$velista_page names $first_src, which does not resolve under /velista/" ;;
esac
script_url="https://staging.ichirokuxvi.com/velista/$first_src"
content_type="$(curl -kfsS -o /dev/null -w '%{content_type}' "$script_url")" \
  || fail "$script_url did not answer 200"
grep -qi 'javascript' <<< "$content_type" \
  || fail "$script_url answered $content_type, not JavaScript"
echo "  ok  $velista_page ($script_url, $content_type)"

# The own origin passes through the same nginx with neither change.
own_page=https://staging.velista.app/
own_body="$(curl -kfsS "$own_page")" || fail "$own_page did not answer 200"
grep -q '<base href="/"' <<< "$own_body" || fail "$own_page does not carry the base /"
grep -q 'rel="manifest"' <<< "$own_body" || fail "$own_page does not link the web app manifest"
echo "  ok  $own_page (base /, manifest linked)"

rc=0
ran=''
case "$PROJECTS" in
  *,velista-e2e,*)
    echo "::group::e2e velista-e2e"
    VELISTA_BASE_URL=https://staging.velista.app \
      npx playwright test -c apps/velista-e2e/playwright.config.ts --project=chromium || rc=1
    echo "::endgroup::"
    ran="$ran velista-e2e"
    ;;
esac
if [ "$with_luna" = true ]; then
  # Uncached, like every suite whose result depends on a live stack.
  echo "::group::e2e velista-luna-e2e"
  VELISTA_BASE_URL=https://staging.velista.app \
    E2E_GATEWAY_URL=https://api.staging.velista.app \
    npx nx e2e velista-luna-e2e --skip-nx-cache || rc=1
  echo "::endgroup::"
  ran="$ran velista-luna-e2e"
fi

[ "$rc" -eq 0 ] || GATE_FAILED=1
echo "velista-luna: ran${ran:- no suite, the D7 checks only}, $([ "$rc" -eq 0 ] && echo passed || echo FAILED)"
exit "$rc"
