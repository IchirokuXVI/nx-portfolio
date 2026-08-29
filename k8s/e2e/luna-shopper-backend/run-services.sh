#!/usr/bin/env bash
#
# run-services.sh — start, health gate, and stop the five Luna Shopper services
# as plain Node processes out of `dist` (plan 0015, section 5).
#
# There is no service orchestrator in this repo: the slot harness deliberately
# leaves service lifecycle to the developer, which is fine at a keyboard and no
# good in CI. This script is that missing piece, and it is deliberately shared
# rather than inlined into a workflow, so the CI path and the local path cannot
# drift apart.
#
#   bash k8s/e2e/luna-shopper-backend/run-services.sh start [--no-build]
#   bash k8s/e2e/luna-shopper-backend/run-services.sh stop
#
# `start` builds the five services, launches each one in the background with its
# stdout and stderr captured, polls `GET /health/ready` on each until it passes,
# then checks that each one serves `GET /metrics` in Prometheus format (plan
# 0016, section 5.1). Readiness, not liveness: readiness is the probe that already means
# "dependencies reachable" (plan 0004, section 6), which is exactly the condition
# the suites need, so there is no second readiness signal to invent. On timeout it
# prints the tail of every service log and exits non zero, so a boot failure is
# diagnosable from the CI output alone instead of from a bare timeout.
#
# `stop` sends SIGTERM, which also exercises the graceful shutdown path from plan
# 0004, section 7 — the run gets that coverage for free.
#
# Ports come from each service's `.env` (written by luna-slot.sh), so a worktree
# on a slot is started on its own port band without passing anything extra.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(cd "$here/../../.." && pwd)"
cd "$root"

# Nx project name per service; the dist directory matches it.
#
# The harvester (plan 0038) is deliberately NOT here. This script is what CI's
# e2e job starts, and the e2e suite exercises the app: the harvester answers no
# subject the app calls, refuses to spawn with HARVEST_ENABLED false, and would
# only add a sixth process and a sixth boot to wait for. Start it by hand with
# `npx nx serve luna-shopper-backend-harvester` when working on it.
SERVICES=(gateway realtime auth core catalog)

# Slot 0 defaults, used when a service has no .env yet.
declare -A DEFAULT_PORT=(
  [gateway]=3000
  [realtime]=3001
  [auth]=3002
  [core]=3003
  [catalog]=3004
)

run_dir="$root/test-output/luna-shopper-backend/services"

# How long a service gets to answer /health/ready before the run is called a
# failure. Generous: a cold Nest boot plus a TypeORM connect is a few seconds,
# and a CI runner under load is slower than a laptop.
READY_TIMEOUT_SECONDS="${LUNA_SERVICE_READY_TIMEOUT:-90}"

port_of() {
  local svc="$1"
  local env_file="$root/apps/luna-shopper-backend/$svc/.env"
  if [[ -f "$env_file" ]]; then
    local from_env
    from_env="$(sed -n 's/^[[:space:]]*PORT=\([0-9][0-9]*\).*/\1/p' "$env_file" | tail -n 1)"
    if [[ -n "$from_env" ]]; then
      echo "$from_env"
      return
    fi
  fi
  echo "${DEFAULT_PORT[$svc]}"
}

# The telemetry variables from a service's .env, as NAME=VALUE lines (plan 0016).
#
# They have to be in the real process environment, not merely in a file
# @nestjs/config will read later: the OpenTelemetry SDK starts before Nest exists
# (section 4.1) and can only see `process.env`. Under `nx serve` Nx loads a
# project's own `.env` and that happens for free, but this script launches plain
# `node`, so it does the same job explicitly. Without it a service would run with
# telemetry off and the wrong service name, which shows up only as a mislabelled
# dashboard weeks later.
telemetry_env_of() {
  local svc="$1"
  local env_file="$root/apps/luna-shopper-backend/$svc/.env"
  # A canonical service name regardless of what the .env says, so a trace is
  # never attributed to the wrong service from here.
  echo "OTEL_SERVICE_NAME=luna-shopper-backend-$svc"
  [[ -f "$env_file" ]] || return 0
  sed -n 's/^[[:space:]]*\(OTEL_ENABLED\|OTEL_EXPORTER_OTLP_[A-Z_]*\|OTEL_TRACES_[A-Z_]*\|DEPLOYMENT_ENVIRONMENT\|SERVICE_VERSION\|METRICS_ENABLED\)=\(.*\)$/\1=\2/p' "$env_file"
}

# Whether a service was told to serve /metrics. Default on (plan 0016,
# section 7), so the check below runs unless it was deliberately switched off.
metrics_enabled() {
  local value
  value="$(telemetry_env_of "$1" | sed -n 's/^METRICS_ENABLED=//p' | tail -n 1 | tr -d '[:space:]')"
  [[ "${value:-true}" != "false" ]]
}

# The /metrics contract, on every service (plan 0016, sections 5.1 and 10).
#
# It is checked here rather than in the e2e suite because /metrics lives on each
# service's own health port, and the e2e suite deliberately never touches a
# service's internal port. Checking it where the five services are already known
# to be up is the cheapest place that covers all of them, and it fails the run
# loudly if a service ever stops answering: a scrape that silently 404s looks
# exactly like a healthy service with no traffic.
check_metrics() {
  for svc in "${SERVICES[@]}"; do
    local port body
    port="$(port_of "$svc")"
    if ! metrics_enabled "$svc"; then
      echo "$svc has METRICS_ENABLED=false: skipping its /metrics check."
      continue
    fi
    if ! body="$(curl -fsS --max-time 5 "http://127.0.0.1:$port/metrics" 2>/dev/null)"; then
      echo "$svc did not answer GET :$port/metrics." >&2
      dump_logs
      stop || true
      exit 1
    fi
    # Prometheus exposition format always names the type of a series it exports.
    if ! grep -q '^# TYPE ' <<<"$body"; then
      echo "$svc answered :$port/metrics but not in Prometheus exposition format." >&2
      exit 1
    fi
    echo "$svc serves /metrics on :$port"
  done
}

dump_logs() {
  echo
  echo "--- service logs (last 60 lines each) ------------------------------"
  for svc in "${SERVICES[@]}"; do
    echo "::group::$svc"
    tail -n 60 "$run_dir/$svc.log" 2>/dev/null || echo "(no log for $svc)"
    echo "::endgroup::"
  done
}

start() {
  local build=1
  if [[ "${1:-}" == "--no-build" ]]; then
    build=0
  fi

  mkdir -p "$run_dir"

  if [[ "$build" == "1" ]]; then
    local projects=""
    for svc in "${SERVICES[@]}"; do
      projects+="${projects:+,}luna-shopper-backend-$svc"
    done
    echo "building: $projects"
    npx nx run-many -t build --projects "$projects"
  fi

  for svc in "${SERVICES[@]}"; do
    local main="$root/dist/apps/luna-shopper-backend-$svc/main.js"
    if [[ ! -f "$main" ]]; then
      echo "missing build output: $main (run without --no-build)" >&2
      exit 1
    fi
    # Started from the workspace root on purpose: each service's ConfigModule
    # resolves its envFilePath relative to the process cwd, the same way `nx
    # serve` runs it. The telemetry variables are passed through the environment
    # rather than left to that config load, because the SDK reads them before
    # Nest exists (plan 0016, section 4.1).
    local -a service_env=()
    while IFS= read -r assignment; do
      service_env+=("$assignment")
    done < <(telemetry_env_of "$svc")
    env "${service_env[@]}" node "$main" >"$run_dir/$svc.log" 2>&1 &
    echo $! >"$run_dir/$svc.pid"
    echo "started $svc (pid $(cat "$run_dir/$svc.pid"), port $(port_of "$svc"))"
  done

  local deadline=$(( SECONDS + READY_TIMEOUT_SECONDS ))
  for svc in "${SERVICES[@]}"; do
    local port
    port="$(port_of "$svc")"
    echo -n "waiting for $svc on :$port/health/ready "
    until curl -fsS --max-time 2 "http://127.0.0.1:$port/health/ready" >/dev/null 2>&1; do
      if (( SECONDS >= deadline )); then
        echo
        echo "$svc did not become ready within ${READY_TIMEOUT_SECONDS}s." >&2
        dump_logs
        stop || true
        exit 1
      fi
      # A service that died will never answer; say so now rather than at the
      # deadline, since the log tail is the useful part either way.
      local pid
      pid="$(cat "$run_dir/$svc.pid" 2>/dev/null || true)"
      if [[ -n "$pid" ]] && ! kill -0 "$pid" 2>/dev/null; then
        echo
        echo "$svc exited before becoming ready." >&2
        dump_logs
        stop || true
        exit 1
      fi
      echo -n '.'
      sleep 1
    done
    echo "ready"
  done

  echo "all five services are ready."

  check_metrics
}

stop() {
  [[ -d "$run_dir" ]] || return 0

  local pids=()
  for svc in "${SERVICES[@]}"; do
    local pid_file="$run_dir/$svc.pid"
    [[ -f "$pid_file" ]] || continue
    local pid
    pid="$(cat "$pid_file")"
    if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
      # SIGTERM, not SIGKILL: the graceful shutdown hooks flip readiness off and
      # drain, so stopping the stack exercises that path too.
      echo "stopping $svc (pid $pid)"
      kill "$pid" 2>/dev/null || true
      pids+=("$pid")
    fi
    rm -f "$pid_file"
  done

  # Give the shutdown hooks a moment, then make sure nothing is left behind.
  if (( ${#pids[@]} > 0 )); then
    sleep 3
    for pid in "${pids[@]}"; do
      kill -9 "$pid" 2>/dev/null || true
    done
  fi
}

# Print the resolved ports as shell assignments, so a caller can point a test
# suite at the services this script actually started rather than guessing. The
# port lookup stays in one place, which is the difference between "the suite ran
# against our stack" and "the suite ran against whatever answers :3000".
ports() {
  for svc in "${SERVICES[@]}"; do
    echo "LUNA_$(echo "$svc" | tr '[:lower:]' '[:upper:]')_PORT=$(port_of "$svc")"
  done
}

case "${1:-}" in
  start) shift; start "$@" ;;
  stop) stop ;;
  logs) dump_logs ;;
  ports) ports ;;
  *)
    echo "usage: run-services.sh {start [--no-build] | stop | logs | ports}" >&2
    exit 2
    ;;
esac
