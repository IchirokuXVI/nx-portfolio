#!/usr/bin/env bash
#
# Run the release tasks of one environment (README.md in this directory).
#
#   run-release-tasks.sh --env <staging|production> --phase pre    # before helm upgrade
#   run-release-tasks.sh --env <staging|production> --phase post   # after the rollout
#
# A task is a directory under tasks/, named NNNN-kebab-title, holding task.env
# and at least one of pre.sh and post.sh. Tasks run in name order.
#
# pre:  for every task that is due, dump each database it names to object
#       storage, record the dump keys, then run its pre.sh. A dump that fails
#       stops the deploy before the task has changed anything.
# post: for every task whose pre phase finished, run its post.sh and mark it
#       done.
#
# The ledger is the ConfigMap `release-tasks`: one key per task holding its state
# (`pre-done`, `done` or `skipped`, then a UTC timestamp), and `<task>.dumps`
# holding `<database>=<dump key>` pairs, separated by spaces. A task in state
# `done` or `skipped` never runs again. Removing its keys from the ConfigMap runs
# it again, which every task must survive (the second rule in README.md).
#
# Environment overrides:
#   NAMESPACE     kubernetes namespace          (default: nx-portfolio)
#   RELEASE_NAME  helm release                  (default: nx-portfolio)
#   KUBECONFIG    kubeconfig path               (default: /etc/rancher/k3s/k3s.yaml)
#   DUMP_TIMEOUT  seconds to wait for one dump  (default: 900)

set -euo pipefail
# `key="$(dump ...)"` must stop at the first failing command inside dump, and
# without this a command substitution runs with errexit off.
shopt -s inherit_errexit

usage() {
  echo "usage: run-release-tasks.sh --env <staging|production> --phase <pre|post>" >&2
  exit 1
}

ENVIRONMENT=''
PHASE=''
while [ $# -gt 0 ]; do
  case "$1" in
    --env) ENVIRONMENT="${2:-}"; shift 2 ;;
    --phase) PHASE="${2:-}"; shift 2 ;;
    *) usage ;;
  esac
done
case "$ENVIRONMENT" in staging | production) ;; *) usage ;; esac
case "$PHASE" in pre | post) ;; *) usage ;; esac

NAMESPACE="${NAMESPACE:-nx-portfolio}"
RELEASE_NAME="${RELEASE_NAME:-nx-portfolio}"
DUMP_TIMEOUT="${DUMP_TIMEOUT:-900}"
export KUBECONFIG="${KUBECONFIG:-/etc/rancher/k3s/k3s.yaml}"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
K8S_DIR="$(dirname "$HERE")"
LEDGER=release-tasks

now() { date -u +%Y-%m-%dT%H:%M:%SZ; }

ledger_get() {
  # go-template rather than jsonpath: `index` reads a key with dots and a
  # leading digit as it is.
  kubectl -n "$NAMESPACE" get configmap "$LEDGER" \
    -o go-template="{{if .data}}{{with index .data \"$1\"}}{{.}}{{end}}{{end}}"
}

ledger_set() {
  # Every value this script writes is task names, dates, words and s3 keys, so
  # nothing in it needs JSON escaping. Refuse anything that would.
  case "$2" in *[!A-Za-z0-9:./_=\ -]*)
    echo "refusing to write '$2' to the ledger" >&2
    return 1
    ;;
  esac
  kubectl -n "$NAMESPACE" patch configmap "$LEDGER" --type merge \
    -p "{\"data\":{\"$1\":\"$2\"}}" > /dev/null
}

state_of() { ledger_get "$1" | cut -d' ' -f1; }

# Reads ENVIRONMENTS or DATABASES from a task's task.env, in a subshell so one
# task's values cannot leak into the next.
task_field() {
  (
    ENVIRONMENTS=''
    DATABASES=''
    # shellcheck disable=SC1090,SC1091
    . "$1/task.env"
    case "$2" in
      ENVIRONMENTS) printf '%s' "$ENVIRONMENTS" ;;
      DATABASES) printf '%s' "$DATABASES" ;;
    esac
  )
}

applies_here() {
  case " $(task_field "$1" ENVIRONMENTS) " in *" $ENVIRONMENT "*) return 0 ;; esac
  return 1
}

run_hook() {
  local dir="$1" hook="$2"
  [ -f "$dir/$hook" ] || return 0
  echo "  running $hook"
  ENVIRONMENT="$ENVIRONMENT" NAMESPACE="$NAMESPACE" KUBECONFIG="$KUBECONFIG" \
    K8S_DIR="$K8S_DIR" TASK_NAME="$(basename "$dir")" \
    bash "$dir/$hook"
}

# Dump one database through its backup CronJob and print the uploaded key. The
# CronJob prints `uploaded s3://...` last, and that line is what is read here.
dump() {
  local task="$1" db="$2" cronjob job key conditions waited=0
  cronjob="luna-shopper-backend-${db}-db-backup"
  job="rt-${task%%-*}-${db}-$(date -u +%Y%m%d%H%M%S)"
  if ! kubectl -n "$NAMESPACE" get cronjob "$cronjob" > /dev/null 2>&1; then
    echo "  no cronjob/$cronjob, so $db cannot be dumped and $task is not reversible" >&2
    return 1
  fi
  kubectl -n "$NAMESPACE" create job "$job" --from="cronjob/$cronjob" > /dev/null
  # Polled rather than `kubectl wait`, which watches one condition and would sit
  # out the whole timeout on a Job that has already failed.
  while :; do
    conditions="$(kubectl -n "$NAMESPACE" get "job/$job" \
      -o jsonpath='{.status.conditions[?(@.status=="True")].type}')"
    case " $conditions " in
      *' Complete '*) break ;;
      *' Failed '*) waited=-1; break ;;
    esac
    if [ "$waited" -ge "$DUMP_TIMEOUT" ]; then
      waited=-1
      break
    fi
    sleep 5
    waited=$((waited + 5))
  done
  if [ "$waited" -lt 0 ]; then
    echo "  job/$job did not complete. Its log:" >&2
    kubectl -n "$NAMESPACE" logs "job/$job" --tail=50 >&2 || true
    return 1
  fi
  key="$(kubectl -n "$NAMESPACE" logs "job/$job" | sed -n 's/^uploaded //p' | tail -1)"
  if [ -z "$key" ]; then
    echo "  job/$job completed but printed no uploaded key" >&2
    return 1
  fi
  printf '%s' "$key"
}

# The ledger exists before anything reads it.
kubectl -n "$NAMESPACE" create configmap "$LEDGER" --dry-run=client -o yaml \
  | kubectl -n "$NAMESPACE" apply -f - > /dev/null

# A first install has no data for a task to change. Every due task is recorded
# as skipped, so a task written for an existing cluster never runs on a new one.
FRESH=false
if [ "$PHASE" = pre ] && ! helm status "$RELEASE_NAME" --namespace "$NAMESPACE" > /dev/null 2>&1; then
  FRESH=true
fi

shopt -s nullglob
TASKS=("$HERE"/tasks/[0-9][0-9][0-9][0-9]-*/)
echo "release tasks, $ENVIRONMENT, phase $PHASE: ${#TASKS[@]} defined"

for dir in "${TASKS[@]}"; do
  dir="${dir%/}"
  task="$(basename "$dir")"
  applies_here "$dir" || continue
  state="$(state_of "$task")"

  case "$PHASE:$state" in
    *:done | *:skipped) continue ;;

    pre:pre-done)
      # A deploy failed between the phases. The dumps and pre.sh are already
      # behind it, and post runs once this deploy's rollout succeeds.
      echo "$task: pre phase already done"
      ;;

    pre:)
      if [ "$FRESH" = true ]; then
        echo "$task: skipped, first install"
        ledger_set "$task" "skipped $(now) first-install"
        continue
      fi
      echo "$task: due"
      dumps="$(ledger_get "$task.dumps")"
      for db in $(task_field "$dir" DATABASES); do
        echo "  dumping $db"
        key="$(dump "$task" "$db")"
        echo "  $key"
        dumps="${dumps:+$dumps }$db=$key"
        # Written after every dump, so a later failure cannot lose an earlier key.
        ledger_set "$task.dumps" "$dumps"
      done
      run_hook "$dir" pre.sh
      ledger_set "$task" "pre-done $(now)"
      ;;

    post:pre-done)
      echo "$task: finishing"
      run_hook "$dir" post.sh
      ledger_set "$task" "done $(now)"
      echo "$task: done. The dumps that revert it:"
      for entry in $(ledger_get "$task.dumps"); do
        echo "  $entry"
      done
      ;;

    post:)
      # Added to the checkout after the pre phase of this deploy ran. It is
      # due at the next deploy, whose pre phase takes its dumps first.
      echo "$task: not started in the pre phase, so it waits for the next deploy"
      ;;

    *)
      echo "$task: unknown state '$state' in configmap/$LEDGER" >&2
      exit 1
      ;;
  esac
done
