#!/usr/bin/env bash
#
# The portfolio unit's gate (k8s plan 0016 D3): the published images behind the
# proxy of compose.yml, the remote entry checks, the /velista path, then the
# affected suites.
#
#   bash k8s/e2e/portfolio-frontend/gate.sh <e2e projects, comma separated>
#
# The pipeline has already pointed the HOSTS of gate.env at 127.0.0.1 and
# installed the browsers. E2E_IMAGE_PREFIX and E2E_IMAGE_TAG pick the images.
# The stack is torn down on exit, pass or fail.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE=(docker compose -f "$HERE/compose.yml")
PROJECTS="${1:-}"

teardown() { "${COMPOSE[@]}" down -v > /dev/null 2>&1 || true; }
trap teardown EXIT

"${COMPOSE[@]}" up -d --pull always

up=''
for i in $(seq 1 45); do
  if curl -kfsS https://staging.ichirokuxvi.com/en > /dev/null 2>&1; then
    up=1
    break
  fi
  echo "waiting for the portfolio e2e stack ($i)..."
  sleep 2
done
if [ -z "$up" ]; then
  echo "::error::https://staging.ichirokuxvi.com/en did not answer through the e2e proxy"
  "${COMPOSE[@]}" logs --no-color --tail=50 || true
  exit 1
fi

# The shell answers 200 for any path, so the wait above cannot see a missing
# remote. Each remoteEntry the shell asks for is checked by name.
missing=''
for entry in \
  https://mfe.staging.ichirokuxvi.com/odontogram/remoteEntry.mjs \
  https://mfe.staging.ichirokuxvi.com/damoclesSword/remoteEntry.mjs \
  https://mfe.staging.ichirokuxvi.com/landingV2/remoteEntry.mjs; do
  if curl -kfsS -o /dev/null "$entry"; then
    echo "  ok  $entry"
  else
    echo "  MISSING  $entry"
    missing="$missing $entry"
  fi
done
if [ -n "$missing" ]; then
  echo "::error::the e2e stack does not serve every remote the shell loads:$missing"
  exit 1
fi

# The /velista route is the portfolio's, and the image behind it is the other
# unit's and may be mid change. So this gate asserts only that the route
# reaches velista; the velista-luna gate tests velista's own nginx.
velista_page=https://staging.ichirokuxvi.com/velista/en
if ! body="$(curl -kfsS "$velista_page")"; then
  echo "::error::$velista_page did not answer 200"
  exit 1
fi
if ! grep -q 'app-velista-root' <<< "$body"; then
  echo "::error::$velista_page is not velista's document (no app-velista-root)"
  exit 1
fi
echo "  ok  $velista_page reaches velista"

# odontogram-e2e still triggers this gate and is not run: its deep links need a
# history fallback that no served shell gives it (k8s/README.md).
rc=0
ran=''
IFS=',' read -ra list <<< "$PROJECTS"
for p in "${list[@]}"; do
  [ -n "$p" ] || continue
  if [ "$p" = odontogram-e2e ]; then
    echo "skipping odontogram-e2e (see k8s/README.md)"
    continue
  fi
  # A project name can differ from its directory (landingV2-e2e lives in
  # apps/landing-v2-e2e).
  root="$(npx nx show project "$p" --json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).root))')"
  echo "::group::e2e $p ($root)"
  if [ -f "$root/playwright.config.ts" ]; then
    E2E_BASE_URL=https://staging.ichirokuxvi.com \
      npx playwright test -c "$root/playwright.config.ts" --project=chromium || rc=1
  else
    E2E_BASE_URL=https://staging.ichirokuxvi.com \
      npx cypress run --project "$root" --browser electron || rc=1
  fi
  echo "::endgroup::"
  ran="$ran $p"
done

echo "portfolio-frontend: ran${ran:- no suite}, $([ "$rc" -eq 0 ] && echo passed || echo FAILED)"
exit "$rc"
